import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Miniflare} from 'miniflare';
import {digest} from '../../scripts/release-stage.mjs';
import {verifyRemote} from '../../scripts/release-http.mjs';

const releaseId = 'c'.repeat(24);
const origin = 'https://editor.example';
const prefix = `/releases/${releaseId}/`;
const files = {
	'index.html': '<h1>Editor</h1>'
	, 'extensions/github-authentication/media/index.html': '<h1>Authentication</h1>'
	, 'out/vs/loader.js': 'console.log("loader");'
};
let server, stage;

before(async () => {
	const script = (await fs.readFile(new URL('../../pages/_worker.js', import.meta.url), 'utf8')).replace('__VSCODE_RELEASE_ID__', releaseId);
	server = new Miniflare({modules: true, script, compatibilityDate: '2026-04-30', r2Buckets: ['BUCKET']});
	const bucket = await server.getR2Bucket('BUCKET');
	const manifest = {releaseId, assets: Object.entries(files).map(([path, content]) => ({path, bytes: Buffer.byteLength(content), sha256: digest(content)}))};
	const manifestBytes = Buffer.from(JSON.stringify(manifest));
	stage = {manifest, fingerprint: digest(manifestBytes)};
	for(const [path, content] of Object.entries(files)) await bucket.put(prefix.slice(1) + path, content);
	await bucket.put(prefix.slice(1) + 'release.json', manifestBytes);
});
after(async () => { await server?.dispose(); });

/** Put an observable edge-response filter after the actual worker and R2 binding. */
function edge(transform = () => {})
{
	const calls = [];
	const transport = async (url, options = {}) => {
		const call = {path: new URL(url).pathname, method: options.method || 'GET', headers: new Headers(options.headers)};
		calls.push(call);
		const response = await server.dispatchFetch(url, {...options, redirect: 'manual'});
		const result = {status: response.status, headers: new Headers(response.headers), bytes: Buffer.from(await response.arrayBuffer())};
		transform(result, call);
		result.json = () => JSON.parse(result.bytes.toString());
		return result;
	};
	return {calls, transport};
}

test('remote verification uses ETag validation when the edge preserves it', async () => {
	const {transport, calls} = edge();
	assert.equal((await verifyRemote(stage, origin, transport)).files, 3);
	assert.ok(calls.at(-1).headers.has('If-None-Match'));
	assert.equal(calls.at(-1).headers.has('If-Modified-Since'), false);
});

test('Cloudflare can strip HTML ETags while preserving bytes and Last-Modified', async () => {
	const {transport, calls} = edge((response, call) => {
		if(call.path.endsWith('.html')) response.headers.delete('ETag');
	});
	assert.equal((await verifyRemote(stage, origin, transport)).files, 3);
	assert.ok(calls.at(-1).headers.has('If-Modified-Since'));
	assert.equal(calls.at(-1).headers.has('If-None-Match'), false);
});

test('conditional smoke chooses the validator exposed by HEAD', async () => {
	const {transport, calls} = edge((response, call) => {
		if(call.method === 'HEAD') response.headers.delete('ETag');
	});
	await verifyRemote(stage, origin, transport);
	assert.ok(calls.at(-1).headers.has('If-Modified-Since'));
	assert.notEqual(calls.at(-1).headers.get('If-None-Match'), 'null');
});

test('weak ETags still exercise conditional GET', async () => {
	const {transport, calls} = edge(response => {
		if(response.headers.has('ETag')) response.headers.set('ETag', 'W/' + response.headers.get('ETag'));
	});
	await verifyRemote(stage, origin, transport);
	assert.match(calls.at(-1).headers.get('If-None-Match'), /^W\//);
});

test('missing or unusable validators still fail verification', async () => {
	for(const lastModified of [null, 'invalid date'])
	{
		const {transport} = edge((response, call) => {
			if(!call.path.endsWith('.html')) return;
			response.headers.delete('ETag');
			if(lastModified) response.headers.set('Last-Modified', lastModified);
			else response.headers.delete('Last-Modified');
		});
		await assert.rejects(verifyRemote(stage, origin, transport), /validator.*index\.html/i);
	}
});

test('Last-Modified fallback does not bypass immutable caching or content hashes', async () => {
	for(const failure of ['cache', 'bytes'])
	{
		const {transport} = edge((response, call) => {
			if(!call.path.endsWith('.html')) return;
			response.headers.delete('ETag');
			if(failure === 'cache') response.headers.set('Cache-Control', 'no-store');
			else response.bytes[0] = '!'.charCodeAt(0);
		});
		await assert.rejects(verifyRemote(stage, origin, transport), failure === 'cache' ? /immutable.*index\.html/i : /Asset verification failed: .*index\.html/);
	}
});

test('a server ignoring If-Modified-Since fails the conditional smoke', async () => {
	const {transport} = edge((response, call) => {
		if(call.path.endsWith('.html')) response.headers.delete('ETag');
		if(call.headers.has('If-Modified-Since')) response.status = 200;
	});
	await assert.rejects(verifyRemote(stage, origin, transport), /Conditional GET smoke failed.*If-Modified-Since.*200/);
});
