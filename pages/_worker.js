export default {
	async fetch(request, env) {
		const url = new URL(request.url);
		// Clean path
		let key = url.pathname.replace(/^\/+/, "");
		if (key === "") key = "index.html";

		// Fetch object from R2
		const obj = await env.BUCKET.get(key);
		if (!obj) {
			return new Response("Not found", { status: 404 });
		}

		// Infer MIME type
		const headers = new Headers();
		if (obj.httpMetadata?.contentType) {
			headers.set("Content-Type", obj.httpMetadata.contentType);
		} else if (key.endsWith(".js")) {
			headers.set("Content-Type", "application/javascript");
		} else if (key.endsWith(".css")) {
			headers.set("Content-Type", "text/css");
		} else if (key.endsWith(".html")) {
			headers.set("Content-Type", "text/html");
		}

		return new Response(obj.body, { headers });
	},
};
