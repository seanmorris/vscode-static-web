import {setTimeout as delay} from 'node:timers/promises';
import {assert, digest} from './release-stage.mjs';

/** Fetch and consume a bounded response, retaining endpoint details on failure. */
export async function request(url, options = {})
{
	try
	{
		const signal = AbortSignal.any([AbortSignal.timeout(20_000), ...(options.signal ? [options.signal] : [])]);
		const response = await fetch(url, {...options, redirect: 'manual', signal});
		const chunks = [];
		let length = 0;
		if(response.body) for await(const chunk of response.body)
		{
			length += chunk.length;
			assert(length <= 64 * 1024 * 1024, 'Response exceeds release limit');
			chunks.push(chunk);
		}
		const bytes = Buffer.concat(chunks);
		return {status: response.status, headers: response.headers, bytes, json: () => JSON.parse(new TextDecoder().decode(bytes))};
	}
	catch(error) { throw new Error(`${options.method || 'GET'} ${new URL(url).origin}${new URL(url).pathname}: ${error.message}`); }
}

/** Retry transient readiness failures for a bounded window. */
export async function retry(operation, label, timeout = 120_000)
{
	const deadline = Date.now() + timeout;
	let failure;
	do
	{
		try { return await operation(); }
		catch(error) { failure = error; }
		await delay(Math.min(2000, Math.max(0, deadline - Date.now())));
	} while(Date.now() < deadline);
	throw new Error(`${label}: ${failure?.message}`);
}

/** Check release routing and every asset, including both extension bundles. */
export async function verifyRemote(stage, baseUrl, transport = request)
{
	const controller = new AbortController;
	const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)]);
	const fetch = (url, options = {}) => transport(url, {...options, signal});
	try { return await verifyAssets(stage, baseUrl, fetch); }
	finally { controller.abort(); }
}

/** Verify one immutable asset inventory within the caller's deadline. */
async function verifyAssets(stage, baseUrl, transport)
{
	const {manifest, fingerprint} = stage;
	const origin = new URL(baseUrl).origin;
	const prefix = `${origin}/releases/${manifest.releaseId}/`;
	const health = await transport(`${origin}/__release`);
	assert(health.status === 200 && health.json().releaseId === manifest.releaseId, 'Worker release identity mismatch');
	const redirect = await transport(`${origin}/?release-probe=1`);
	assert(redirect.status === 307 && redirect.headers.get('location') === prefix + '?release-probe=1', 'Release redirect lost its path or query');
	const remoteManifest = await transport(prefix + 'release.json');
	assert(remoteManifest.status === 200 && digest(remoteManifest.bytes) === fingerprint, 'Remote release manifest mismatch');
	let next = 0;
	await Promise.all(Array.from({length: 6}, async () => {
		while(next < manifest.assets.length)
		{
			const file = manifest.assets[next++];
			const response = await transport(prefix + file.path.split('/').map(encodeURIComponent).join('/'), {headers: {'Accept-Encoding': 'identity'}});
			assert(response.status === 200 && response.bytes.length === file.bytes && digest(response.bytes) === file.sha256, `Asset verification failed: ${file.path} (HTTP ${response.status})`);
			assert(response.headers.get('cache-control')?.includes('immutable') && response.headers.has('etag'), `Missing immutable asset headers: ${file.path}`);
		}
	}));
	const head = await transport(prefix + 'index.html', {method: 'HEAD'});
	assert(head.status === 200 && head.bytes.length === 0, 'HEAD smoke failed');
	const conditional = await transport(prefix + 'index.html', {headers: {'If-None-Match': head.headers.get('etag')}});
	assert(conditional.status === 304, 'Conditional GET smoke failed');
	return {releaseId: manifest.releaseId, files: manifest.assets.length, url: origin};
}
