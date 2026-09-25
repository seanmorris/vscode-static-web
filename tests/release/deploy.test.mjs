import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {inventory, digest, verifyStage} from '../../scripts/release-stage.mjs';
import {deployRelease, rollbackRelease, deploymentAdapters, run} from '../../scripts/deploy-release.mjs';

const previousId = '11111111-1111-1111-1111-111111111111';
const previewId = '22222222-2222-2222-2222-222222222222';
const productionId = '33333333-3333-3333-3333-333333333333';

/** Create a small complete release and an observable Pages simulator. */
async function fixture(t)
{
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'vscode-release-test-'));
	t.after(() => fs.rm(directory, {recursive: true, force: true}));
	await fs.mkdir(path.join(directory, 'assets'));
	await fs.mkdir(path.join(directory, 'pages'));
	await fs.writeFile(path.join(directory, 'assets/index.html'), 'index');
	await fs.writeFile(path.join(directory, 'pages/_worker.js'), 'worker');
	await fs.writeFile(path.join(directory, 'assets/release.json'), JSON.stringify({schema: 1, releaseId: 'a'.repeat(24), assets: await inventory(path.join(directory, 'assets')), worker: digest('worker')}));
	const deployments = new Map([[previousId, {id: previousId, environment: 'production', latest_stage: {name: 'deploy', status: 'success'}}]]);
	const state = {canonical: previousId, calls: [], failSmoke: false, failPublish: false, otherRelease: false};
	const adapters = {
		publicUrl: 'https://editor.example', retry: operation => operation()
		, api: async (suffix = '', method = 'GET') => {
			state.calls.push([method, suffix]);
			if(!suffix) return {production_branch: 'master', canonical_deployment: deployments.get(state.canonical)};
			const [, , id, action] = suffix.split('/');
			if(action === 'rollback') state.canonical = id;
			return deployments.get(id);
		}
		, upload: async () => { state.calls.push(['upload']); }
		, publish: async (stage, branch, tag) => {
			state.calls.push(['publish', branch, stage.fingerprint]);
			if(branch === 'master' && state.failPublish) throw new Error('Lost upload acknowledgement');
			const id = branch === 'master' ? productionId : previewId;
			deployments.set(id, {id, environment: branch === 'master' ? 'production' : 'preview', latest_stage: {name: 'deploy', status: 'success'}, deployment_trigger: {metadata: {branch, commit_message: tag}}});
			if(branch === 'master') state.canonical = id;
			return {id, url: `https://${id}.editor.pages.dev`};
		}
		, smoke: async (stage, url) => {
			state.calls.push(['smoke', url]);
			if(state.otherRelease && url.includes(productionId))
			{
				state.canonical = 'someone-else';
				deployments.set(state.canonical, {id: state.canonical});
			}
			if(state.failSmoke && url.includes(productionId)) throw new Error('Workbench failed');
		}
	};
	return {directory, adapters, state, deployments};
}

test('preview uploads once and never selects the production branch', async t => {
	const {directory, adapters, state} = await fixture(t);
	const result = await deployRelease(directory, 'preview', adapters);
	assert.equal(result.preview.id, previewId);
	assert.equal(state.canonical, previousId);
	assert.equal(state.calls.filter(call => call[0] === 'upload').length, 1);
	assert.equal(state.calls.filter(call => call[0] === 'publish').length, 1);
	assert.match(state.calls.find(call => call[0] === 'publish')[1], /^verify-/);
});

test('production promotes the same fingerprint only after preview smoke', async t => {
	const {directory, adapters, state} = await fixture(t);
	await deployRelease(directory, 'production', adapters);
	const publishes = state.calls.filter(call => call[0] === 'publish');
	assert.equal(publishes.length, 2);
	assert.equal(publishes[0][2], publishes[1][2]);
	assert.ok(state.calls.findIndex(call => call[0] === 'smoke') < state.calls.findIndex(call => call[0] === 'publish' && call[1] === 'master'));
	assert.equal(state.canonical, productionId);
});

test('production smoke failure restores the previous deployment', async t => {
	const {directory, adapters, state} = await fixture(t);
	state.failSmoke = true;
	await assert.rejects(deployRelease(directory, 'production', adapters), /prior production retained or restored/);
	assert.equal(state.canonical, previousId);
});

test('a pending upload is never incorrectly reported as retained production', async t => {
	const {directory, adapters, state} = await fixture(t);
	state.failPublish = true;
	await assert.rejects(deployRelease(directory, 'production', adapters), /Rollback unconfirmed/);
});

test('rollback never overwrites a different operator release', async t => {
	const {directory, adapters, state} = await fixture(t);
	state.otherRelease = state.failSmoke = true;
	await assert.rejects(deployRelease(directory, 'production', adapters), /Another release owns production/);
	assert.equal(state.canonical, 'someone-else');
	assert.equal(state.calls.filter(call => call[0] === 'POST').length, 0);
});

test('changed assets, worker, additions and symlinks fail stage verification', async t => {
	for(const kind of ['asset', 'worker', 'extra', 'symlink'])
	{
		const {directory} = await fixture(t);
		await verifyStage(directory);
		if(kind === 'symlink') await fs.symlink('index.html', path.join(directory, 'assets/link'));
		else await fs.writeFile(path.join(directory, kind === 'worker' ? 'pages/_worker.js' : kind === 'extra' ? 'assets/extra' : 'assets/index.html'), 'changed');
		await assert.rejects(verifyStage(directory), /changed|symlink/);
	}
});

test('changing the artifact during preview prevents production publication', async t => {
	const {directory, adapters, state} = await fixture(t);
	adapters.smoke = () => fs.writeFile(path.join(directory, 'assets/index.html'), 'changed');
	await assert.rejects(deployRelease(directory, 'production', adapters), /changed/);
	assert.equal(state.canonical, previousId);
	assert.equal(state.calls.filter(call => call[0] === 'publish').length, 1);
});

test('failed upload stops before a Pages deployment', async t => {
	const {directory, adapters, state} = await fixture(t);
	adapters.upload = async () => { throw new Error('R2 unavailable'); };
	await assert.rejects(deployRelease(directory, 'preview', adapters), /R2 unavailable/);
	assert.equal(state.calls.filter(call => call[0] === 'publish').length, 0);
});

test('manual rollback accepts successful production only', async t => {
	const {directory, adapters, state} = await fixture(t);
	await deployRelease(directory, 'production', adapters);
	await assert.rejects(rollbackRelease(previewId, adapters), /successful production/);
	await rollbackRelease(previousId, adapters);
	assert.equal(state.canonical, previousId);
});

test('lost acknowledgement after publication still rolls back the owned deployment', async t => {
	const {directory, adapters, state} = await fixture(t);
	const publish = adapters.publish;
	adapters.publish = async (...args) => {
		const deployment = await publish(...args);
		if(args[1] === 'master') throw new Error('Lost acknowledgement');
		return deployment;
	};
	await assert.rejects(deployRelease(directory, 'production', adapters), /prior production retained or restored/);
	assert.equal(state.canonical, previousId);
});

test('CLI adapters upload only the release prefix and isolate generated Wrangler configuration', async t => {
	const {directory} = await fixture(t);
	const stage = await verifyStage(directory);
	const environment = {
		PROJECT_NAME: 'editor', BUCKET_NAME: 'editor-assets', CLOUDFLARE_ACCOUNT_ID: 'f'.repeat(32)
		, ENDPOINT: `https://${'f'.repeat(32)}.r2.cloudflarestorage.com`
		, CLOUDFLARE_API_TOKEN: 'fixture-token', AWS_ACCESS_KEY_ID: 'fixture-key', AWS_SECRET_ACCESS_KEY: 'fixture-secret'
		, UNRELATED_SECRET: 'must-not-reach-tools'
	};
	let uploads = 0, publishedDirectory;
	const adapters = await deploymentAdapters(environment, {run: async (command, args, options) => {
		assert.equal(options.env.UNRELATED_SECRET, undefined);
		if(command === 'aws')
		{
			uploads++;
			assert.ok(args.includes(`s3://editor-assets/releases/${stage.manifest.releaseId}/`));
			assert.ok(!args.includes('--delete'));
			assert.equal(args[1], 'cp');
			assert.equal(options.env.AWS_SHARED_CREDENTIALS_FILE, undefined);
			return;
		}
		publishedDirectory = options.cwd;
		assert.notEqual(publishedDirectory, directory);
		const config = JSON.parse(await fs.readFile(path.join(publishedDirectory, 'wrangler.json')));
		assert.equal(config.pages_build_output_dir, './pages');
		assert.deepEqual(config.r2_buckets, [{binding: 'BUCKET', bucket_name: 'editor-assets'}]);
		assert.equal(await fs.readFile(path.join(publishedDirectory, 'pages/_worker.js'), 'utf8'), 'worker');
		assert.equal(args[args.indexOf('--branch') + 1], 'verify-fixture');
		await fs.writeFile(options.env.WRANGLER_OUTPUT_FILE_PATH, JSON.stringify({type: 'pages-deploy', version: 1, pages_project: 'editor', deployment_id: previewId, url: 'https://unique.editor.pages.dev'}));
	}});
	await adapters.upload(stage);
	assert.equal(uploads, 1);
	assert.equal((await adapters.publish(stage, 'verify-fixture', 'fixture')).id, previewId);
	await assert.rejects(fs.access(publishedDirectory), {code: 'ENOENT'});
	await verifyStage(directory);
});

test('subprocess failure diagnostics redact credentials', async () => {
	await assert.rejects(run(process.execPath, ['-e', 'console.error(process.env.CLOUDFLARE_API_TOKEN); process.exit(2)'], {env: {CLOUDFLARE_API_TOKEN: 'fixture-sensitive-token'}, capture: true}), error => {
		assert.ok(error.message.includes('[redacted]'));
		assert.ok(!error.message.includes('fixture-sensitive-token'));
		return true;
	});
});
