import { setTimeout as delay } from 'node:timers/promises';
import { readFileSync } from 'node:fs';

const port = Number(process.argv[2]);
const pageUrl = process.argv[3];
const timeoutMs = Number(process.argv[4] || 60000);

async function fetchJson(path)
{
	const response = await fetch(`http://127.0.0.1:${port}${path}`);

	if (!response.ok)
	{
		throw new Error(`Failed to fetch ${path}: ${response.status}`);
	}

	return response.json();
}

async function waitForTarget()
{
	const deadline = Date.now() + timeoutMs;

	while (Date.now() < deadline)
	{
		const targets = await fetchJson('/json/list');
		const target = targets.find(candidate => candidate.type === 'page' && candidate.url.startsWith(pageUrl));

		if (target)
		{
			return target;
		}

		await delay(500);
	}

	throw new Error(`Timed out waiting for Chrome target for ${pageUrl}`);
}

async function main()
{
	const target = await waitForTarget();
	const socket = new WebSocket(target.webSocketDebuggerUrl);
	const pending = new Map();
	let nextId = 0;

	function send(method, params = {})
	{
		const id = ++nextId;
		socket.send(JSON.stringify({ id, method, params }));

		return new Promise((resolve, reject) =>
		{
			const timer = setTimeout(() => {
				pending.delete(id);
				reject(new Error(`Timed out waiting for ${method}`));
			}, timeoutMs);
			pending.set(id, { resolve, reject, timer });
		});
	}

	socket.addEventListener('message', event =>
	{
		const payload = JSON.parse(event.data);

		if (!payload.id)
		{
			return;
		}

		const deferred = pending.get(payload.id);

		if (!deferred)
		{
			return;
		}

		pending.delete(payload.id);
		clearTimeout(deferred.timer);

		if (payload.error)
		{
			deferred.reject(new Error(payload.error.message || `CDP error for ${payload.id}`));
			return;
		}

		deferred.resolve(payload.result);
	});

	await new Promise((resolve, reject) =>
	{
		socket.addEventListener('open', resolve, { once: true });
		socket.addEventListener('error', reject, { once: true });
	});

	await send('Runtime.enable');
	await send('Page.enable');
	await send('Page.addScriptToEvaluateOnNewDocument', {
		source: readFileSync(new URL('./filebus-host.js', import.meta.url), 'utf8')
	});
	const loaded = new Promise((resolve, reject) => {
		const onMessage = event => {
			if(JSON.parse(event.data).method !== 'Page.loadEventFired') return;
			clearTimeout(timer);
			socket.removeEventListener('message', onMessage);
			resolve();
		};
		const timer = setTimeout(() => {
			socket.removeEventListener('message', onMessage);
			reject(new Error('Timed out waiting for the instrumented page to load'));
		}, timeoutMs);
		socket.addEventListener('message', onMessage);
	});
	await send('Page.reload', {ignoreCache: true});
	await loaded;

	const deadline = Date.now() + timeoutMs;

	while (Date.now() < deadline)
	{
		const result = await send('Runtime.evaluate', {
			expression: `Boolean(
				window.vscodeEditor
				&& window.vscodeEditor.commands
				&& window.vscodeEditor.env
				&& window.vscodeEditor.window
				&& window.vscodeEditor.workspace
				&& document.querySelector(".monaco-workbench")
				&& document.querySelectorAll('[id^="workbench.parts."]').length >= 5
				&& (!JSON.parse(document.getElementById('vscode-workbench-builtin-extensions').dataset.settings)
					.some(entry => entry.packageJSON.name === 'file-bus') || window.fileBusTestHost?.activated)
			)`,
			returnByValue: true,
			awaitPromise: true
		});

		if (result.result?.value === true)
		{
			break;
		}

		await delay(1000);
	}

	const detailsResult = await send('Runtime.evaluate', {
		expression: `(() => ({
			href: location.href,
			hasWorkbench: Boolean(document.querySelector(".monaco-workbench")),
			hasEditor: Boolean(window.vscodeEditor),
			exposedKeys: window.vscodeEditor ? Object.keys(window.vscodeEditor) : [],
			hasCommands: Boolean(window.vscodeEditor && window.vscodeEditor.commands),
			hasEnv: Boolean(window.vscodeEditor && window.vscodeEditor.env),
			hasWindow: Boolean(window.vscodeEditor && window.vscodeEditor.window),
			hasWorkspace: Boolean(window.vscodeEditor && window.vscodeEditor.workspace),
			title: document.title,
			parts: [...document.querySelectorAll("[id^='workbench.parts.']")].map(node => node.id)
		}))()`,
		returnByValue: true,
		awaitPromise: true
	});

	const details = detailsResult.result?.value;

	if (!details?.hasEditor || !details?.hasWorkbench || !details?.hasCommands || !details?.hasEnv || !details?.hasWindow || !details?.hasWorkspace)
	{
		throw new Error(`Workbench did not finish booting: ${JSON.stringify(details)}`);
	}

	if (!Array.isArray(details.parts) || details.parts.length === 0)
	{
		throw new Error(`Workbench parts were not rendered: ${JSON.stringify(details)}`);
	}

	const probe = await send('Runtime.evaluate', {
		expression: `(async () => {
			const packages = JSON.parse(document.getElementById('vscode-workbench-builtin-extensions').dataset.settings);
			const hasFileBus = packages.some(entry => entry.packageJSON.name === 'file-bus');
			const scriptCount = [...document.scripts].filter(script => script.src).length;
			if(scriptCount > 100) throw new Error('Workbench loaded individual source modules instead of production bundles: ' + scriptCount);
			if(hasFileBus) {
				if(!window.fileBusTestHost.activated) throw new Error('File Bus did not activate in the production build');
				await window.vscodeEditor.commands.executeCommand('fileBus.openFile', 'busfs:/latency-probe.txt');
				await window.vscodeEditor.commands.executeCommand('type', {text: 'saved through File Bus\\n'});
				await window.vscodeEditor.commands.executeCommand('workbench.action.files.save');
				const reads = window.fileBusTestHost.calls.filter(call => call.action === 'readFile' && call.params[0] === '/latency-probe.txt');
				const writes = window.fileBusTestHost.calls.filter(call => call.action === 'writeFile' && call.params[0] === '/latency-probe.txt');
				if(!reads.length || !writes.length) throw new Error('File Bus provider did not read and save the probe');
				const saved = new TextDecoder().decode(Uint8Array.from(writes.at(-1).params[1]));
				if(!saved.includes('saved through File Bus') || !saved.includes('production build probe')) throw new Error('Saved content did not preserve the edit and original file');
				const waitForPicker = async text => {
					const deadline = Date.now() + 10000;
					while(Date.now() < deadline) {
						if(document.querySelector('.quick-input-widget')?.innerText.includes(text)) return;
						await new Promise(resolve => setTimeout(resolve, 20));
					}
					throw new Error('Quick Open did not display: ' + text);
				};
				await window.vscodeEditor.commands.executeCommand('workbench.action.quickOpen', 'no-such-file-for-filebus-test');
				await waitForPicker('No matching results');
				const listingCount = window.fileBusTestHost.calls.filter(call => call.action === 'readdir').length;
				const input = document.querySelector('.quick-input-widget input[type="text"]');
				input.value = 'search-only';
				input.dispatchEvent(new Event('input', {bubbles: true}));
				await waitForPicker('search-only.txt');
				if(window.fileBusTestHost.calls.filter(call => call.action === 'readdir').length !== listingCount) throw new Error('Typing a new Quick Open query repeated filesystem traversal');
			}
			return {
				scriptCount, fileBus: hasFileBus ? 'read, save, and search reuse passed' : 'not staged',
				marks: performance.getEntriesByType('mark').filter(mark => ['code/didStartWorkbench', 'filebus/activated'].includes(mark.name)).map(mark => ({name: mark.name, ms: mark.startTime}))
			};
		})()`,
		returnByValue: true,
		awaitPromise: true,
		timeout: timeoutMs
	});

	if(probe.exceptionDetails)
	{
		throw new Error(probe.exceptionDetails.exception?.description || probe.exceptionDetails.text);
	}

	console.log(JSON.stringify(probe.result?.value, null, 2));

	socket.close();
}

main().catch(error =>
{
	console.error(error.stack || error.message);
	process.exit(1);
});
