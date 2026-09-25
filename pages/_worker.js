const RELEASE_ID = '__VSCODE_RELEASE_ID__';
const immutable = 'public, max-age=31536000, immutable';
const types = {
	js: 'application/javascript; charset=utf-8'
	, mjs: 'application/javascript; charset=utf-8'
	, css: 'text/css; charset=utf-8'
	, html: 'text/html; charset=utf-8'
	, json: 'application/json; charset=utf-8'
	, wasm: 'application/wasm'
	, svg: 'image/svg+xml'
	, woff: 'font/woff'
	, woff2: 'font/woff2'
	, ttf: 'font/ttf'
	, png: 'image/png'
	, jpg: 'image/jpeg'
	, jpeg: 'image/jpeg'
	, gif: 'image/gif'
	, ico: 'image/x-icon'
};

/** Construct validators and representation headers from R2 metadata. */
function objectHeaders(object, key, versioned)
{
	const headers = new Headers;
	object.writeHttpMetadata(headers);
	headers.set('Content-Type', types[key.split('.').pop()] || headers.get('Content-Type') || 'application/octet-stream');
	headers.set('ETag', object.httpEtag);
	headers.set('Last-Modified', object.uploaded.toUTCString());
	headers.set('Cache-Control', versioned ? immutable : 'no-cache');
	headers.set('Accept-Ranges', 'bytes');
	headers.set('Content-Length', object.size);
	headers.set('X-Content-Type-Options', 'nosniff');
	return headers;
}

/** Evaluate an ETag list, using weak comparison only for If-None-Match. */
function matches(value, etag, weak = false)
{
	return value.split(',').some(part => part.trim() === '*' || (weak ? part.trim().replace(/^W\//, '') : part.trim()) === etag);
}

/** Serve immutable release assets; unversioned assets remain readable during migration. */
async function serve(request, env, context)
{
	const url = new URL(request.url);
	if(!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', {status: 405, headers: {Allow: 'GET, HEAD'}});
	if(url.pathname === '/__release') return new Response(request.method === 'HEAD' ? null : JSON.stringify({releaseId: RELEASE_ID}), {headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}});
	if(url.pathname === '/' || url.pathname === '/index.html')
	{
		url.pathname = `/releases/${RELEASE_ID}/`;
		return new Response(null, {status: 307, headers: {Location: url.href, 'Cache-Control': 'no-store'}});
	}
	let key;
	try { key = decodeURIComponent(url.pathname).slice(1); }
	catch { return new Response('Bad path', {status: 400}); }
	if(key.split('/').some(part => part === '..' || part === '.' || part.startsWith('.')) || /[\\\x00-\x1f]/.test(key)) return new Response('Bad path', {status: 400});
	const versioned = /^releases\/[a-f0-9]{24}\//.test(key);
	if(key.startsWith('releases/') && !versioned) return new Response('Not found', {status: 404});
	if(key.endsWith('/')) key += 'index.html';
	const conditional = ['if-match', 'if-none-match', 'if-modified-since', 'if-unmodified-since'].some(name => request.headers.has(name));
	const partial = request.headers.has('range');
	const cacheable = versioned && request.method === 'GET' && !conditional && !partial;
	url.search = '';
	const cacheKey = new Request(url, {method: 'GET'});
	if(cacheable)
	{
		const cached = await caches.default.match(cacheKey);
		if(cached) return cached;
	}
	let object, range;
	if(request.method === 'HEAD' || conditional || partial)
	{
		object = await env.BUCKET.head(key);
		if(!object) return new Response('Not found', {status: 404});
		const headers = objectHeaders(object, key, versioned);
		const h = request.headers;
		const modified = Math.floor(object.uploaded.getTime() / 1000) * 1000;
		if((h.has('if-match') && !matches(h.get('if-match'), object.httpEtag))
			|| (!h.has('if-match') && h.has('if-unmodified-since') && modified > Date.parse(h.get('if-unmodified-since'))))
		{
			headers.delete('Content-Length');
			return new Response(null, {status: 412, headers});
		}
		if((h.has('if-none-match') && matches(h.get('if-none-match'), object.httpEtag, true))
			|| (!h.has('if-none-match') && h.has('if-modified-since') && modified <= Date.parse(h.get('if-modified-since'))))
		{
			headers.delete('Content-Length');
			return new Response(null, {status: 304, headers});
		}
		if(request.method === 'HEAD') return new Response(null, {headers});
		const ifRange = h.get('if-range');
		if(partial && (!ifRange || ifRange === object.httpEtag || modified <= Date.parse(ifRange)))
		{
			const match = /^bytes=(\d*)-(\d*)$/.exec(h.get('range'));
			// Ignore unsupported or multipart ranges; reject unsatisfiable single ranges.
			if(match && (match[1] || match[2]))
			{
				const start = match[1] ? Number(match[1]) : Math.max(0, object.size - Number(match[2]));
				const end = match[1] && match[2] ? Math.min(object.size - 1, Number(match[2])) : object.size - 1;
				if(!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= object.size)
				{
					return new Response(null, {status: 416, headers: {'Content-Range': `bytes */${object.size}`}});
				}
				range = {offset: start, length: end - start + 1};
			}
		}
	}
	object = await env.BUCKET.get(key, range ? {range} : {});
	if(!object) return new Response('Not found', {status: 404});
	const headers = objectHeaders(object, key, versioned);
	if(range)
	{
		headers.set('Content-Range', `bytes ${range.offset}-${range.offset + range.length - 1}/${object.size}`);
		headers.set('Content-Length', range.length);
	}
	const response = new Response(object.body, {status: range ? 206 : 200, headers});
	if(cacheable) context.waitUntil(caches.default.put(cacheKey, response.clone()));
	return response;
}

export default {fetch: serve};
