import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(await fs.readFile(path.join(root, 'release-extensions.json')));
const destination = path.join(root, '.release-extensions');

/** Run a source/build command without modifying the developer's extension checkout. */
function run(command, args, cwd, capture = false)
{
	return execFileSync(command, args, {cwd, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit'});
}

await fs.mkdir(destination, {recursive: true});
for(const [name, source] of Object.entries(manifest))
{
	if(!/^[a-z][a-z0-9-]+$/.test(name) || !/^[a-f0-9]{40}$/.test(source.revision)) throw new Error('Invalid extension source pin');
	const checkout = path.join(destination, name);
	const local = path.join(root, 'extra_extensions', name);
	await fs.rm(checkout, {recursive: true, force: true});
	let repository = source.repository;
	try
	{
		if(run('git', ['rev-parse', `${source.revision}^{commit}`], local, true).trim() === source.revision) repository = local;
	}
	catch {}
	try
	{
		run('git', ['clone', '--no-checkout', '--no-hardlinks', repository, checkout], root);
		try { run('git', ['checkout', '--detach', source.revision], checkout); }
		catch
		{
			run('git', ['fetch', 'origin', source.revision], checkout);
			run('git', ['checkout', '--detach', source.revision], checkout);
		}
		run('npm', ['ci', '--no-audit', '--no-fund'], checkout);
		const metadata = JSON.parse(await fs.readFile(path.join(checkout, 'package.json')));
		run('npm', ['run', metadata.scripts.test ? 'test' : 'compile'], checkout);
		for(const file of ['dist/index.js', 'hack.js']) await fs.access(path.join(checkout, file));
	}
	catch(error)
	{
		throw new Error(`Cannot prepare ${name} at ${source.revision}; the pinned commit must be available to CI`, {cause: error});
	}
}
