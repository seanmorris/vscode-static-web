import fs from 'node:fs/promises';
import path from 'node:path';
import {Miniflare} from 'miniflare';
import {root, verifyStage} from './release-stage.mjs';
import {verifyRemote} from './release-http.mjs';
import {run} from './deploy-release.mjs';

const stage = await verifyStage(process.argv[2]);
const server = new Miniflare({modules: true, scriptPath: path.join(stage.directory, 'pages/_worker.js'), compatibilityDate: '2026-04-30', r2Buckets: ['BUCKET'], host: '127.0.0.1', port: 0});
try
{
	const bucket = await server.getR2Bucket('BUCKET');
	let next = 0;
	const files = [...stage.manifest.assets.map(file => file.path), 'release.json'];
	await Promise.all(Array.from({length: 8}, async () => {
		while(next < files.length)
		{
			const name = files[next++];
			await bucket.put(`releases/${stage.manifest.releaseId}/${name}`, await fs.readFile(path.join(stage.directory, 'assets', name)));
		}
	}));
	const url = String(await server.ready);
	console.log(await verifyRemote(stage, url));
	await run('bash', [path.join(root, 'tests/real-e2e/run.sh')], {env: {...process.env, E2E_URL: url, E2E_REQUIRE_BUSES: '1'}});
}
finally { await server.dispose(); }
