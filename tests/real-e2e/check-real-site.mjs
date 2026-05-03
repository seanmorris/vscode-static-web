import { setTimeout as delay } from 'node:timers/promises';

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
			pending.set(id, { resolve, reject });
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

	socket.close();
}

main().catch(error =>
{
	console.error(error.stack || error.message);
	process.exit(1);
});
