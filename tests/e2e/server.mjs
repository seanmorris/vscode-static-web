import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, createReadStream, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..', '..');
const port = Number(process.env.VSCODE_WEB_STATIC_E2E_PORT || 4173);
const fixtureDir = mkdtempSync(path.join(tmpdir(), 'vscode-web-static-e2e-'));

const repoTemplate = path.join(rootDir, 'source', 'index-template.html.php');
const publicDir = path.join(fixtureDir, 'public');

function writeJson(file, value)
{
	writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function ensureDir(dir)
{
	mkdirSync(dir, { recursive: true });
}

function buildFixture()
{
	ensureDir(path.join(publicDir, 'extensions', 'ext-a'));
	ensureDir(path.join(publicDir, 'extensions', 'ext-skip'));
	ensureDir(path.join(publicDir, 'out', 'vs', 'workbench'));
	ensureDir(path.join(publicDir, 'out', 'vs'));

	writeJson(path.join(publicDir, 'extensions', 'ext-a', 'package.json'), {
		name: 'ext-a',
		version: '1.2.3',
		publisher: 'acme',
		hacks: ['hack.js']
	});

	writeJson(path.join(publicDir, 'extensions', 'ext-a', 'package.nls.json'), {
		displayName: 'Extension A'
	});

	writeFileSync(
		path.join(publicDir, 'extensions', 'ext-a', 'hack.js'),
		'function(config){config.commands.push("ext-a-hack");}'
	);

	writeJson(path.join(publicDir, 'extensions', 'ext-skip', 'package.json'), {
		name: 'ext-skip',
		version: '9.9.9',
		publisher: 'acme',
		hacks: ['hack.js']
	});

	writeFileSync(
		path.join(publicDir, 'extensions', 'ext-skip', 'hack.js'),
		'function(config){config.commands.push("ext-skip-hack");}'
	);

	writeFileSync(
		path.join(publicDir, 'out', 'vs', 'loader.js'),
		[
			'(function(){',
			'  function writeE2EState(config){',
			'    const packagesMeta = document.getElementById("vscode-workbench-builtin-extensions");',
			'    const packages = JSON.parse(packagesMeta.dataset.settings);',
			'    const existing = document.getElementById("e2e-state");',
			'    if (existing) {',
			'      existing.remove();',
			'    }',
			'    const stateNode = document.createElement("script");',
			'    stateNode.id = "e2e-state";',
			'    stateNode.type = "application/json";',
			'    stateNode.textContent = JSON.stringify({',
			'      editor: self.vscodeEditor,',
			'      commands: config.commands,',
			'      gallery: config.productConfiguration.extensionsGallery,',
			'      requireBaseUrl: self.__requireConfig?.baseUrl,',
			'      baseHref: document.querySelector("base")?.getAttribute("href"),',
			'      extensionPaths: packages.map(entry => entry.extensionPath),',
			'      packageNls: packages.find(entry => entry.extensionPath === "ext-a")?.packageNLS',
			'    });',
			'    document.body.appendChild(stateNode);',
			'  }',
			'  function require(deps, callback){',
			'    if (Array.isArray(deps)) {',
			'      const config = {',
			'        commands: [],',
			'        productConfiguration: {',
			'          extensionsGallery: {',
			'            itemUrl: "https://default.item",',
			'            serviceUrl: "https://default.service",',
			'            resourceUrlTemplate: "https://default.resource/{path}"',
			'          }',
			'        }',
			'      };',
			'      if (typeof self.vscodeAlterConfig === "function") {',
			'        self.vscodeAlterConfig(config);',
			'      }',
			'      self.__alteredConfig = config;',
			'      if (typeof self.vscodeExposeEditor === "function") {',
			'        self.vscodeExposeEditor({ kind: "mock-editor" });',
			'      }',
			'      writeE2EState(config);',
			'      if (typeof callback === "function") {',
			'        callback();',
			'      }',
			'    }',
			'  }',
			'  require.config = function(config){ self.__requireConfig = config; };',
			'  self.require = require;',
			'})();',
			''
		].join('\n')
	);

	writeFileSync(
		path.join(publicDir, 'out', 'vs', 'webPackagePaths.js'),
		'self.webPackagePaths = {};\n'
	);

	writeFileSync(
		path.join(publicDir, 'out', 'vs', 'workbench', 'workbench.web.main.css'),
		'body { background: #111; color: #eee; }\n'
	);

	writeFileSync(path.join(publicDir, 'favicon.ico'), '');

	const templateOutput = spawnSync(
		'php',
		[repoTemplate],
		{
			cwd: fixtureDir,
			env: {
				...process.env,
				VSCODE_BASEPATH: '/editor',
				VSCODE_SKIP_EXTENSIONS: 'ext-skip',
				VSCODE_RESOURCE_URL_TEMPLATE: 'https://assets.example/{path}',
				VSCODE_SERVICE_URL: 'https://service.example',
				VSCODE_ITEM_URL: 'https://item.example'
			},
			encoding: 'utf8'
		}
	);

	if (templateOutput.status !== 0)
	{
		throw new Error(templateOutput.stderr || 'Failed to render PHP template');
	}

	writeFileSync(path.join(publicDir, 'index.html'), templateOutput.stdout);
}

function contentTypeFor(file)
{
	if (file.endsWith('.html')) return 'text/html; charset=utf-8';
	if (file.endsWith('.js')) return 'application/javascript; charset=utf-8';
	if (file.endsWith('.css')) return 'text/css; charset=utf-8';
	if (file.endsWith('.json')) return 'application/json; charset=utf-8';
	if (file.endsWith('.ico')) return 'image/x-icon';
	return 'application/octet-stream';
}

function resolvePath(urlPath)
{
	const cleanPath = urlPath.split('?')[0];

	if (cleanPath === '/' || cleanPath === '/editor' || cleanPath === '/editor/')
	{
		return path.join(publicDir, 'index.html');
	}

	const withoutPrefix = cleanPath.startsWith('/editor/')
		? cleanPath.slice('/editor/'.length)
		: cleanPath.replace(/^\/+/, '');

	return path.join(publicDir, withoutPrefix || 'index.html');
}

buildFixture();

const server = http.createServer((request, response) =>
{
	const file = resolvePath(request.url || '/');

	if (!existsSync(file))
	{
		response.statusCode = 404;
		response.end('Not found');
		return;
	}

	response.setHeader('Content-Type', contentTypeFor(file));
	createReadStream(file).pipe(response);
});

function cleanup()
{
	server.close(() => {});
	rmSync(fixtureDir, { recursive: true, force: true });
}

process.on('SIGINT', () => {
	cleanup();
	process.exit(130);
});

process.on('SIGTERM', () => {
	cleanup();
	process.exit(143);
});

server.listen(port, '127.0.0.1', () => {
	process.stdout.write(`E2E fixture server listening on ${port}\n`);
});
