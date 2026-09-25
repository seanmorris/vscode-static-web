import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export const assert = (condition, message) => { if(!condition) throw new Error(message); };
const hidden = part => part.startsWith('.');
const bootstrap = ['vs/loader.js', 'vs/webPackagePaths.js', 'vs/workbench/workbench.web.main.css', 'vs/workbench/workbench.web.main.nls.js', 'vs/workbench/workbench.web.main.js', 'vs/code/browser/workbench/workbench.js'];

/** Inventory regular files deterministically; symlinks never enter a release. */
export async function inventory(directory, prefix = '')
{
	const files = [];
	for(const entry of (await fs.readdir(directory, {withFileTypes: true})).sort((a, b) => a.name.localeCompare(b.name, 'en')))
	{
		const name = prefix + entry.name;
		assert(!entry.isSymbolicLink(), `Release contains a symlink: ${name}`);
		if(entry.isDirectory()) files.push(...await inventory(path.join(directory, entry.name), name + '/'));
		else
		{
			assert(entry.isFile(), `Release contains a non-file: ${name}`);
			const bytes = await fs.readFile(path.join(directory, entry.name));
			files.push({path: name, bytes: bytes.length, sha256: digest(bytes)});
		}
	}
	return files;
}

/** Stage a deterministic release, keeping its assets and worker bound by a manifest. */
export async function stageRelease({project = root, source = path.join(project, 'public'), output = path.join(project, '.releases'), environment = process.env} = {})
{
	source = path.resolve(source);
	output = path.resolve(output);
	assert(output !== source && !output.startsWith(source + path.sep), 'Release destination must be outside the source tree');
	await fs.mkdir(output, {recursive: true});
	const temporary = await fs.mkdtemp(path.join(output, '.stage-'));
	try
	{
		const assets = path.join(temporary, 'assets');
		await fs.cp(source, assets, {recursive: true, filter: file => file === source || !path.relative(source, file).split(path.sep).some(hidden)});
		await inventory(assets);
		await fs.rm(path.join(assets, 'release.json'), {force: true});
		for(const file of bootstrap) assert((await fs.stat(path.join(assets, 'out', file))).size > 0, `Missing packaged bootstrap: ${file}`);
		const extensions = JSON.parse(await fs.readFile(path.join(project, 'release-extensions.json')));
		const builtins = await fs.readdir(path.join(project, 'third_party/vscode-web/extensions'));
		for(const name of await fs.readdir(path.join(assets, 'extensions')))
		{
			assert(Object.hasOwn(extensions, name) || builtins.includes(name), `Unselected extra extension: ${name}`);
		}
		for(const name of Object.keys(extensions))
		{
			const checkout = path.join(project, '.release-extensions', name);
			assert(execFileSync('git', ['rev-parse', 'HEAD'], {cwd: checkout, encoding: 'utf8'}).trim() === extensions[name].revision, `Wrong source revision: ${name}`);
			assert(!execFileSync('git', ['status', '--porcelain'], {cwd: checkout, encoding: 'utf8'}).trim(), `Dirty release extension source: ${name}`);
			for(const file of ['dist/index.js', 'hack.js'])
			{
				assert(digest(await fs.readFile(path.join(assets, 'extensions', name, file))) === digest(await fs.readFile(path.join(checkout, file))), `Stale extension build: ${name}/${file}`);
			}
		}
		const render = base => execFileSync('php', [path.join(project, 'source/index-template.html.php')], {
			cwd: project, maxBuffer: 8 * 1024 * 1024
			, env: {...environment, VSCODE_PUBLIC_DIR: assets, VSCODE_BASEPATH: base, VSCODE_SKIP_EXTENSIONS: ''}
		});
		await fs.writeFile(path.join(assets, 'index.html'), render(''));
		const worker = await fs.readFile(path.join(project, 'pages/_worker.js'), 'utf8');
		const releaseId = digest(JSON.stringify({assets: await inventory(assets), extensions, worker})).slice(0, 24);
		await fs.writeFile(path.join(assets, 'index.html'), render(`/releases/${releaseId}`));
		await fs.mkdir(path.join(temporary, 'pages'));
		await fs.writeFile(path.join(temporary, 'pages/_worker.js'), worker.replace('__VSCODE_RELEASE_ID__', releaseId));
		const manifest = {schema: 1, releaseId, extensions, assets: await inventory(assets), worker: digest(await fs.readFile(path.join(temporary, 'pages/_worker.js')))};
		await fs.writeFile(path.join(assets, 'release.json'), JSON.stringify(manifest, null, '\t') + '\n');
		const destination = path.join(output, releaseId);
		try
		{
			await fs.access(destination);
			assert((await verifyStage(destination)).fingerprint === (await verifyStage(temporary)).fingerprint, 'Release ID collision');
		}
		catch(error)
		{
			if(error.code !== 'ENOENT') throw error;
			await fs.rename(temporary, destination);
		}
		await verifyStage(destination);
		await fs.writeFile(path.join(output, 'latest'), releaseId + '\n');
		return destination;
	}
	finally { await fs.rm(temporary, {recursive: true, force: true}); }
}

/** Reject additions, removals or changes before uploading or promoting a stage. */
export async function verifyStage(directory)
{
	directory = path.resolve(directory);
	const manifestBytes = await fs.readFile(path.join(directory, 'assets/release.json'));
	const manifest = JSON.parse(manifestBytes);
	assert(manifest.schema === 1 && /^[a-f0-9]{24}$/.test(manifest.releaseId), 'Invalid release manifest');
	assert(JSON.stringify((await inventory(path.join(directory, 'assets'))).filter(file => file.path !== 'release.json')) === JSON.stringify(manifest.assets), 'Release assets changed');
	assert(JSON.stringify((await inventory(path.join(directory, 'pages'))).map(file => file.path)) === JSON.stringify(['_worker.js']), 'Unexpected Pages files');
	assert(digest(await fs.readFile(path.join(directory, 'pages/_worker.js'))) === manifest.worker, 'Release worker changed');
	return {directory, manifest, fingerprint: digest(manifestBytes)};
}

if(process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
{
	try { console.log(await stageRelease()); }
	catch(error) { console.error(error.message); process.exitCode = 1; }
}
