import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {root, stageRelease, verifyStage} from '../../scripts/release-stage.mjs';

/** Build a miniature source checkout with real Git pins and PHP index generation. */
async function fixture(t)
{
	const project = await fs.mkdtemp(path.join(os.tmpdir(), 'vscode-stage-test-'));
	t.after(() => fs.rm(project, {recursive: true, force: true}));
	await fs.mkdir(path.join(project, 'source'));
	await fs.mkdir(path.join(project, 'pages'));
	await fs.mkdir(path.join(project, 'third_party/vscode-web/extensions'), {recursive: true});
	await fs.copyFile(path.join(root, 'source/index-template.html.php'), path.join(project, 'source/index-template.html.php'));
	await fs.copyFile(path.join(root, 'pages/_worker.js'), path.join(project, 'pages/_worker.js'));
	for(const name of ['vs/loader.js', 'vs/webPackagePaths.js', 'vs/workbench/workbench.web.main.css', 'vs/workbench/workbench.web.main.nls.js', 'vs/workbench/workbench.web.main.js', 'vs/code/browser/workbench/workbench.js'])
	{
		const file = path.join(project, 'public/out', name);
		await fs.mkdir(path.dirname(file), {recursive: true});
		await fs.writeFile(file, 'fixture bundle');
	}
	const extensions = {};
	for(const name of ['file-bus', 'dbg-bus'])
	{
		const checkout = path.join(project, '.release-extensions', name);
		await fs.mkdir(path.join(checkout, 'dist'), {recursive: true});
		await fs.writeFile(path.join(checkout, 'package.json'), JSON.stringify({name, version: '1.0.0', publisher: 'fixture', browser: 'dist/index', hacks: ['hack.js']}));
		await fs.writeFile(path.join(checkout, 'dist/index.js'), 'console.log("fixture");');
		await fs.writeFile(path.join(checkout, 'hack.js'), 'function() {}');
		const git = args => execFileSync('git', args, {cwd: checkout, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
		git(['init']);
		git(['add', '.']);
		git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Fixture']);
		extensions[name] = {revision: git(['rev-parse', 'HEAD']).trim(), repository: 'https://example.invalid/fixture.git'};
		await fs.cp(checkout, path.join(project, 'public/extensions', name), {recursive: true, filter: file => !file.split(path.sep).includes('.git')});
	}
	await fs.writeFile(path.join(project, 'release-extensions.json'), JSON.stringify(extensions));
	return project;
}

test('stage is deterministic, versioned, isolated from source and excludes metadata', async t => {
	const project = await fixture(t);
	await fs.writeFile(path.join(project, 'public/.gitignore'), 'private metadata');
	const directory = await stageRelease({project});
	const stage = await verifyStage(directory);
	assert.equal(await stageRelease({project}), directory);
	const html = await fs.readFile(path.join(directory, 'assets/index.html'), 'utf8');
	assert.ok(html.includes(`<base href="/releases/${stage.manifest.releaseId}/">`));
	assert.ok(html.includes('file-bus') && html.includes('dbg-bus'));
	assert.equal(stage.manifest.assets.some(file => file.path.startsWith('.')), false);
	assert.match(await fs.readFile(path.join(directory, 'pages/_worker.js'), 'utf8'), new RegExp(stage.manifest.releaseId));
	await assert.rejects(fs.access(path.join(project, 'public/index.html')));
	await fs.writeFile(path.join(project, 'public/out/vs/loader.js'), 'new bundle');
	assert.notEqual(await stageRelease({project}), directory);
	await verifyStage(directory);
});

test('staging rejects unselected extra extensions', async t => {
	const project = await fixture(t);
	await fs.mkdir(path.join(project, 'public/extensions/local-example'));
	await assert.rejects(stageRelease({project}), /Unselected extra extension/);
});

test('staging rejects stale compiled extensions and dirty pinned sources', async t => {
	const project = await fixture(t);
	const source = path.join(project, 'public/extensions/file-bus/dist/index.js');
	const original = await fs.readFile(source);
	await fs.writeFile(source, 'old compiled extension');
	await assert.rejects(stageRelease({project}), /Stale extension build/);
	await fs.writeFile(source, original);
	await fs.writeFile(path.join(project, '.release-extensions/file-bus/hack.js'), 'changed source');
	await assert.rejects(stageRelease({project}), /Dirty release extension source/);
});

test('symlinks fail before index generation can follow them', async t => {
	const project = await fixture(t);
	await fs.symlink('/etc/hostname', path.join(project, 'public/external'));
	await assert.rejects(stageRelease({project}), /symlink/);
});
