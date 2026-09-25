import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {root, assert, verifyStage} from './release-stage.mjs';
import {request, retry, verifyRemote} from './release-http.mjs';

const idPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

/** Execute a bounded subprocess; credential-bearing deployment output stays private. */
export function run(command, args, options = {})
{
	return new Promise((resolve, reject) => {
		const {capture = false, ...spawnOptions} = options;
		let output = '';
		const child = spawn(command, args, {stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit', timeout: 300_000, killSignal: 'SIGKILL', ...spawnOptions});
		if(capture) for(const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output = (output + chunk).slice(-8192); });
		child.once('error', reject);
		child.once('close', code => {
			for(const [key, value] of Object.entries(spawnOptions.env || {})) if(/TOKEN|SECRET|KEY/.test(key) && value) output = output.replaceAll(value, '[redacted]');
			code === 0 ? resolve() : reject(new Error(`${path.basename(command)} failed (${code ?? 'timeout'})${output ? ':\n' + output.trim() : ''}`));
		});
	});
}

/** Limit tool environments to deployment settings and ordinary process paths. */
function toolEnvironment(environment)
{
	const names = ['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'SYSTEMROOT', 'USERPROFILE', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_SHARED_CREDENTIALS_FILE', 'AWS_CONFIG_FILE', 'AWS_PROFILE', 'AWS_DEFAULT_REGION'];
	return {...Object.fromEntries(names.filter(name => environment[name]).map(name => [name, environment[name]])), CI: 'true', WRANGLER_SEND_METRICS: 'false', WRANGLER_SEND_ERROR_REPORTS: 'false', CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false'};
}

/** Provide the real Pages, R2 and browser adapters used by the release state machine. */
export async function deploymentAdapters(environment, {run: execute = run, request: transport = request} = {})
{
	for(const key of ['PROJECT_NAME', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN']) assert(environment[key], `Missing ${key}`);
	assert(/^[a-z0-9][a-z0-9-]+$/.test(environment.PROJECT_NAME), 'Invalid Pages project name');
	assert(/^[a-f0-9]{32}$/.test(environment.CLOUDFLARE_ACCOUNT_ID), 'Invalid Cloudflare account ID');
	const env = toolEnvironment(environment);
	const apiRoot = `https://api.cloudflare.com/client/v4/accounts/${environment.CLOUDFLARE_ACCOUNT_ID}/pages/projects/${environment.PROJECT_NAME}`;
	const api = async (suffix = '', method = 'GET') => {
		const response = await transport(apiRoot + suffix, {method, headers: {Authorization: `Bearer ${environment.CLOUDFLARE_API_TOKEN}`}});
		assert(response.status === 200, `Pages API ${method} ${suffix || '/'} failed (HTTP ${response.status})`);
		const body = response.json();
		assert(body.success && body.result, 'Pages API reported failure');
		return body.result;
	};
	return {
		api, retry
		, publicUrl: environment.PRODUCTION_URL || `https://${environment.PROJECT_NAME}.pages.dev`
		, upload: async stage => {
			assert(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(environment.BUCKET_NAME || ''), 'Missing or invalid BUCKET_NAME');
			assert(new URL(environment.ENDPOINT).href === `https://${environment.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com/`, 'ENDPOINT must be the account R2 endpoint');
			if(!env.AWS_ACCESS_KEY_ID && !env.AWS_SHARED_CREDENTIALS_FILE)
			{
				env.AWS_SHARED_CREDENTIALS_FILE = path.join(root, '.aws/credentials');
				env.AWS_CONFIG_FILE = path.join(root, '.aws/config');
				env.AWS_PROFILE = environment.AWS_PROFILE || 'r2';
				await fs.access(env.AWS_SHARED_CREDENTIALS_FILE);
			}
			await execute('aws', ['s3', 'cp', path.join(stage.directory, 'assets'), `s3://${environment.BUCKET_NAME}/releases/${stage.manifest.releaseId}/`, '--recursive', '--only-show-errors', '--endpoint-url', environment.ENDPOINT, '--cache-control', 'public,max-age=31536000,immutable'], {env, capture: true});
		}
		, publish: async (stage, branch, tag) => {
			const metadata = JSON.parse(await fs.readFile(path.join(root, 'node_modules/wrangler/package.json')));
			assert(metadata.version === '4.87.0', 'Run npm ci to install pinned Wrangler 4.87.0');
			const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'vscode-pages-'));
			try
			{
				await fs.cp(path.join(stage.directory, 'pages'), path.join(temporary, 'pages'), {recursive: true});
				await fs.writeFile(path.join(temporary, 'wrangler.json'), JSON.stringify({name: environment.PROJECT_NAME, pages_build_output_dir: './pages', compatibility_date: '2026-04-30', r2_buckets: [{binding: 'BUCKET', bucket_name: environment.BUCKET_NAME}]}));
				const output = path.join(temporary, 'output.ndjson');
				await execute(process.execPath, [path.join(root, 'node_modules/wrangler/bin/wrangler.js'), 'pages', 'deploy', './pages', '--project-name', environment.PROJECT_NAME, '--branch', branch, '--no-bundle', '--commit-message', tag, '--commit-dirty=true', '--env-file', '/dev/null', '--experimental-provision=false', '--experimental-auto-create=false'], {cwd: temporary, env: {...env, WRANGLER_OUTPUT_FILE_PATH: output}, capture: true});
				const records = (await fs.readFile(output, 'utf8')).trim().split('\n').map(line => JSON.parse(line)).filter(item => item.type === 'pages-deploy' && item.version === 1);
				assert(records.length === 1 && records[0].pages_project === environment.PROJECT_NAME && idPattern.test(records[0].deployment_id), 'Invalid Wrangler deployment output');
				const result = records[0];
				const url = new URL(result.url);
				assert(url.protocol === 'https:' && url.hostname.endsWith(`.${environment.PROJECT_NAME}.pages.dev`) && !url.username && !url.password && !url.port, 'Unexpected deployment URL');
				return {id: result.deployment_id, url: result.url};
			}
			finally { await fs.rm(temporary, {recursive: true, force: true}); }
		}
		, smoke: async (stage, url) => {
			const result = await retry(() => verifyRemote(stage, url), 'Release HTTP verification');
			const browserEnvironment = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'PLAYWRIGHT_CHROMIUM_PATH'].filter(name => environment[name]).map(name => [name, environment[name]]));
			await execute('bash', [path.join(root, 'tests/real-e2e/run.sh')], {cwd: root, env: {...browserEnvironment, E2E_URL: new URL(url).origin + '/', E2E_REQUIRE_BUSES: '1'}});
			return result;
		}
	};
}

/** Preview first, then promote unchanged bytes and restore the prior deployment on failure. */
export async function deployRelease(directory, mode, adapters)
{
	assert(['preview', 'production'].includes(mode), 'Deploy mode must be preview or production');
	const {api, upload, publish, smoke, report = () => {}} = adapters;
	const poll = adapters.retry || retry;
	const stage = await verifyStage(directory);
	const project = await api();
	assert(project.production_branch, 'Pages project has no production branch');
	const previous = project.canonical_deployment;
	report(`Preparing ${stage.manifest.releaseId}; current production: ${previous?.id || 'none'}`);
	if(mode === 'production') assert(previous?.environment === 'production' && previous.latest_stage?.status === 'success' && idPattern.test(previous.id), 'A successful prior production deployment is required for rollback');
	const tag = `vscode ${stage.manifest.releaseId} ${randomUUID()}`;
	const branch = `verify-${randomUUID().slice(0, 18)}`;
	assert(branch !== project.production_branch, 'Preview branch cannot be the production branch');
	const unchanged = async () => assert((await verifyStage(directory)).fingerprint === stage.fingerprint, 'Release changed after preview');
	const ready = async (deployment, expectedBranch) => poll(async () => {
		const current = await api(`/deployments/${deployment.id}`);
		assert(current.id === deployment.id && current.deployment_trigger?.metadata?.branch === expectedBranch && current.environment === (expectedBranch === project.production_branch ? 'production' : 'preview') && current.latest_stage?.name === 'deploy' && current.latest_stage?.status === 'success', 'Deployment is not ready or has the wrong identity');
	}, 'Pages deployment readiness');
	await upload(stage);
	await unchanged();
	const preview = await publish(stage, branch, tag);
	report(`Preview: ${preview.id} ${preview.url}`);
	await ready(preview, branch);
	await smoke(stage, preview.url);
	await unchanged();
	if(mode === 'preview') return {mode, releaseId: stage.manifest.releaseId, preview};
	assert((await api()).canonical_deployment?.id === previous.id, 'Production changed during preview; refusing promotion');
	let production;
	try
	{
		production = await publish(stage, project.production_branch, tag);
		report(`Production: ${production.id} ${production.url}`);
		await ready(production, project.production_branch);
		await smoke(stage, production.url);
		await smoke(stage, adapters.publicUrl);
		await unchanged();
		assert((await api()).canonical_deployment?.id === production.id, 'Another release took over production');
		return {mode, releaseId: stage.manifest.releaseId, previous: previous.id, preview, production};
	}
	catch(error)
	{
		try
		{
			const current = (await api()).canonical_deployment;
			if(current?.id === previous.id)
			{
				const pending = production && await api(`/deployments/${production.id}`);
				assert(pending?.latest_stage?.status === 'failure', 'An accepted upload could still become production');
			}
			else
			{
				assert(current?.id === production?.id || current?.deployment_trigger?.metadata?.commit_message === tag, 'Another release owns production');
				await api(`/deployments/${previous.id}/rollback`, 'POST');
				await poll(async () => assert((await api()).canonical_deployment?.id === previous.id, 'Prior production not restored'), 'Rollback');
			}
		}
		catch(recovery) { throw new Error(`Release failed: ${error.message}. Rollback unconfirmed: ${recovery.message}. Prior deployment: ${previous.id}; attempted: ${production?.id || tag}. Inspect Pages deployments before retrying.`); }
		throw new Error(`Release failed; prior production retained or restored (${previous.id}): ${error.message}`);
	}
}

/** Roll back only to an existing, successful production deployment. Assets remain in R2. */
export async function rollbackRelease(id, {api, retry: poll = retry})
{
	assert(idPattern.test(id), 'A Pages deployment UUID is required');
	const target = await api(`/deployments/${id}`);
	assert(target.id === id && target.environment === 'production' && target.latest_stage?.status === 'success', 'Rollback target must be a successful production deployment');
	await api(`/deployments/${id}/rollback`, 'POST');
	await poll(async () => assert((await api()).canonical_deployment?.id === id, 'Rollback has not taken effect'), 'Rollback');
	return {rollback: id};
}

if(process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
{
	let temporary;
	try
	{
		try { process.loadEnvFile(path.join(root, '.env')); } catch(error) { if(error.code !== 'ENOENT') throw error; }
		const [mode, input, url] = process.argv.slice(2);
		assert(['preview', 'production', 'verify', 'rollback'].includes(mode) && input, 'Use Make: deploy, deploy-production, deploy-verify or rollback');
		const adapters = await deploymentAdapters(process.env);
		adapters.report = message => console.log(message);
		let result;
		if(mode === 'rollback') result = await rollbackRelease(input, adapters);
		else
		{
			const original = await verifyStage(input);
			temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'vscode-release-'));
			await fs.cp(input, temporary, {recursive: true});
			assert((await verifyStage(temporary)).fingerprint === original.fingerprint, 'Release changed while preparing upload');
			result = mode === 'verify' ? await adapters.smoke(await verifyStage(temporary), url) : await deployRelease(temporary, mode, adapters);
		}
		console.log(JSON.stringify(result, null, '\t'));
	}
	catch(error)
	{
		console.error(process.env.CLOUDFLARE_API_TOKEN ? error.message.replaceAll(process.env.CLOUDFLARE_API_TOKEN, '[redacted]') : error.message);
		process.exitCode = 1;
	}
	finally { if(temporary) await fs.rm(temporary, {recursive: true, force: true}); }
}
