// An isolated host for exercising the real extension without a PHP installation.
(() => {
	const files = new Map([
		['/latency-probe.txt', new TextEncoder().encode('File Bus production build probe\n')]
		, ['/search-only.txt', new TextEncoder().encode('A file that is not in editor history\n')]
	]);
	const directories = new Set(['/']);
	const state = window.fileBusTestHost = {calls: [], activated: false, files, directories};
	const handlers = {
		activate()
		{
			state.activated = true;
			performance.mark('filebus/activated');
		}

		, analyzePath(path)
		{
			return {exists: files.has(path) || directories.has(path), object: {isFolder: directories.has(path)}};
		}

		, readdir(path, options)
		{
			const prefix = path.endsWith('/') ? path : path + '/';
			const entries = [...directories, ...files.keys()]
				.filter(name => name.startsWith(prefix) && name !== path && !name.slice(prefix.length).includes('/'))
				.map(name => ({name: name.slice(prefix.length), isFolder: directories.has(name)}));
			return options?.withFileTypes ? entries : entries.map(entry => entry.name);
		}

		, readFile(path)
		{
			if(!files.has(path))
			{
				throw new Error(`Missing fixture file: ${path}`);
			}

			return Array.from(files.get(path));
		}

		, writeFile(path, bytes)
		{
			files.set(path, Uint8Array.from(bytes));
		}

		, mkdir(path)
		{
			directories.add(path);
		}
	};

	window.addEventListener('message', event => {
		if(event.source !== window || event.origin !== location.origin)
		{
			return;
		}

		const {action, params = [], token} = event.data || {};
		if(!Object.hasOwn(handlers, action) || !token)
		{
			return;
		}

		state.calls.push({action, params});
		state.lastCallTime = performance.now();

		try
		{
			window.postMessage({re: token, result: handlers[action](...params)}, location.origin);
		}
		catch(error)
		{
			window.postMessage({re: token, error: {message: error.message}}, location.origin);
		}
	});
})();
