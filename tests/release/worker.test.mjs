import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Miniflare} from 'miniflare';

const releaseId = 'a'.repeat(24);
const oldId = 'b'.repeat(24);
let server, bucket;
const url = path => `https://editor.example${path}`;
const get = (path, options) => server.dispatchFetch(url(path), options);
const prefix = `/releases/${releaseId}/`;

before(async () => {
	server = new Miniflare({modules: true, script: (await fs.readFile(new URL('../../pages/_worker.js', import.meta.url), 'utf8')).replace('__VSCODE_RELEASE_ID__', releaseId), compatibilityDate: '2026-04-30', r2Buckets: ['BUCKET']});
	bucket = await server.getR2Bucket('BUCKET');
	await bucket.put(`releases/${releaseId}/index.html`, 'new index');
	await bucket.put(`releases/${releaseId}/out/test.js`, '0123456789');
	await bucket.put(`releases/${oldId}/out/test.js`, 'old script');
	await bucket.put('out/test.js', 'legacy script');
});
after(async () => { await server?.dispose(); });

test('root preserves iframe configuration while selecting an immutable release', async () => {
	const response = await get('/?origin=https%3A%2F%2Fhost.example&x=1', {redirect: 'manual'});
	assert.equal(response.status, 307);
	assert.equal(response.headers.get('location'), url(prefix + '?origin=https%3A%2F%2Fhost.example&x=1'));
	assert.equal(response.headers.get('cache-control'), 'no-store');
	assert.deepEqual(await (await get('/__release')).json(), {releaseId});
});

test('old releases and migration assets remain readable after a promotion', async () => {
	assert.equal(await (await get(`/releases/${oldId}/out/test.js`)).text(), 'old script');
	const response = await get('/out/test.js');
	assert.equal(await response.text(), 'legacy script');
	assert.equal(response.headers.get('cache-control'), 'no-cache');
	assert.equal(await (await get(prefix)).text(), 'new index');
});

test('versioned responses preserve validators, types and cache policy', async () => {
	const response = await get(prefix + 'out/test.js?v=one');
	assert.equal(await response.text(), '0123456789');
	assert.match(response.headers.get('content-type'), /^application\/javascript/);
	assert.match(response.headers.get('cache-control'), /immutable/);
	assert.match(response.headers.get('etag'), /^".+"$/);
	assert.ok(response.headers.get('last-modified'));
	const head = await get(prefix + 'out/test.js', {method: 'HEAD'});
	assert.equal(await head.text(), '');
	assert.equal(head.headers.get('content-length'), '10');
	for(const headers of [
		{'If-None-Match': `W/${head.headers.get('etag')}`}
		, {'If-Modified-Since': head.headers.get('last-modified')}
	]) assert.equal((await get(prefix + 'out/test.js', {headers})).status, 304);
	assert.equal((await get(prefix + 'out/test.js', {headers: {'If-Match': '"wrong"'}})).status, 412);
	assert.equal((await get(prefix + 'out/test.js', {headers: {'If-Match': `W/${head.headers.get('etag')}`}})).status, 412);
});

test('ranges support media and never poison the complete-object cache', async () => {
	for(const [range, body, contentRange] of [
		['bytes=2-4', '234', 'bytes 2-4/10']
		, ['bytes=-3', '789', 'bytes 7-9/10']
		, ['bytes=7-', '789', 'bytes 7-9/10']
	])
	{
		const response = await get(prefix + 'out/test.js', {headers: {Range: range}});
		assert.equal(response.status, 206);
		assert.equal(await response.text(), body);
		assert.equal(response.headers.get('content-range'), contentRange);
	}
	assert.equal((await get(prefix + 'out/test.js', {headers: {Range: 'bytes=10-'}})).status, 416);
	assert.equal((await get(prefix + 'out/test.js', {headers: {Range: 'bytes=-0'}})).status, 416);
	assert.equal((await get(prefix + 'out/test.js', {headers: {Range: 'bytes=1-2', 'If-Range': '"old"'}})).status, 200);
	assert.equal(await (await get(prefix + 'out/test.js?v=two')).text(), '0123456789');
});

test('missing assets are not cached and unsupported methods cannot write', async () => {
	assert.equal((await get(prefix + 'late.txt')).status, 404);
	await bucket.put(`releases/${releaseId}/late.txt`, 'arrived');
	assert.equal(await (await get(prefix + 'late.txt')).text(), 'arrived');
	assert.equal((await get(prefix + 'late.txt', {method: 'POST', body: 'changed'})).status, 405);
	assert.equal((await get('/releases/not-an-id/index.html')).status, 404);
	assert.equal((await get(prefix + '%2eenv')).status, 400);
});
