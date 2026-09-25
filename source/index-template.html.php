#!/usr/bin/env php
<!-- Copyright (C) Microsoft Corporation. All rights reserved. -->
<!-- Modifications for EDUCATIONAL PURPOSES by Sean Morris. -->
<?php
$basePath = rtrim(getenv('VSCODE_BASEPATH') ?: '', '/');
$publicDir = rtrim(getenv('VSCODE_PUBLIC_DIR') ?: './public', '/');
$skipExtensions = explode(' ', getenv('VSCODE_SKIP_EXTENSIONS'));
$bootstrapAssets = [
	'vs/loader.js'
	, 'vs/webPackagePaths.js'
	, 'vs/workbench/workbench.web.main.css'
	, 'vs/workbench/workbench.web.main.nls.js'
	, 'vs/workbench/workbench.web.main.js'
	, 'vs/code/browser/workbench/workbench.js'
];
$assetVersion = substr(hash('sha256', implode('', array_map(
	fn($path) => is_file($publicDir . '/out/' . $path) ? hash_file('sha256', $publicDir . '/out/' . $path) : ''
	, $bootstrapAssets
))), 0, 16);

$resourceUrlTemplate = getenv('VSCODE_RESOURCE_URL_TEMPLATE')
	?: 'https://open-vsx.org/vscode/asset/{publisher}/{name}/{version}/Microsoft.VisualStudio.Code.WebResources/{path}';

$serviceUrl = getenv('VSCODE_SERVICE_URL')
	?: 'https://open-vsx.org/vscode/gallery';

$itemUrl = getenv('VSCODE_ITEM_URL')
	?: 'https://open-vsx.org/vscode/item';

$extDirs = array_filter(
	scanDir($publicDir . '/extensions')
	, fn($name) => (
		!in_array($name, $skipExtensions)
		&& $name !== '.'
		&& $name !== '..'
		&& file_exists($publicDir . '/extensions/' . $name . '/package.json')
	)
);

$hacks = array_map(
	function($name) use($publicDir){
		$packageDir = $publicDir . '/extensions/' . $name;
		$packageJSONFile = $packageDir . '/package.json';
		$packageJSON = json_decode(file_get_contents($packageJSONFile));

		if(!empty($packageJSON->hacks))
		{
			return array_map(
				function($file) use($packageDir) {
					return $packageDir . '/' . $file;
				}
				, $packageJSON->hacks
			);
		}

		return [];
	}
	, array_values($extDirs)
);

$packages = array_filter(array_map(
	function($name) use($skipExtensions, $publicDir)
	{
		$packageJSONFile = $publicDir . '/extensions/' . $name . '/package.json';
		$packageNLSFile  = $publicDir . '/extensions/' . $name . '/package.nls.json';

		$packageJSON = json_decode(file_get_contents($packageJSONFile));

		$entry = ['extensionPath' => $name];

		if(file_exists($packageJSONFile))
		{
			$packageJSON  = json_decode(file_get_contents($packageJSONFile));
			// Keep extension roots stable for VS Code's API identity lookup. Version
			// the entry file instead; relative imports still resolve beside it.
			if(isset($packageJSON->browser) && is_string($packageJSON->browser))
			{
				foreach([$packageJSON->browser, $packageJSON->browser . '.js', $packageJSON->browser . '/index.js'] as $browser)
				{
					$source = $publicDir . '/extensions/' . $name . '/' . $browser;
					if(!is_file($source)) continue;
					$version = substr(hash_file('sha256', $source), 0, 16);
					$versioned = preg_replace('/\.js$/', '', $browser) . '.' . $version . '.js';
					if(!copy($source, $publicDir . '/extensions/' . $name . '/' . $versioned))
					{
						throw new RuntimeException('Cannot stage extension entry: ' . $name);
					}
					$packageJSON->browser = $versioned;
					break;
				}
			}
			$entry ['packageJSON'] = $packageJSON;
		}

		if(file_exists($packageNLSFile))
		{
			$packageNLS  = json_decode(file_get_contents($packageNLSFile));
			$entry ['packageNLS'] = $packageNLS;
		}

		return $entry;
	}
	, array_values($extDirs)
)); ?>
<!DOCTYPE html>
<html>
	<head>
		<meta charset="utf-8" />

		<!-- Disable pinch zooming -->
		<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no">
		<base href="<?=$basePath?>/">

		<!-- Workbench Configuration -->
		<meta id="vscode-workbench-web-configuration" data-settings="{
			&quot;serverBasePath&quot;: &quot;<?=$basePath?>/&quot;,
			&quot;initialColorTheme&quot;: {
				&quot;themeType&quot;: &quot;dark&quot;
			},
			&quot;configurationDefaults&quot;: {
				&quot;workbench.colorTheme&quot;: &quot;dark&quot;
			},
			&quot;workspaceUri&quot;:{
				&quot;$mid&quot;:1,
				&quot;path&quot;:&quot;/default.code-workspace&quot;,
				&quot;scheme&quot;:&quot;tmp&quot;},
				&quot;productConfiguration&quot;:{
					&quot;enableTelemetry&quot;:false,
					&quot;extensionsGallery&quot;: {
						&quot;resourceUrlTemplate&quot;: &quot;<?=$resourceUrlTemplate?>&quot;,
						&quot;serviceUrl&quot;: &quot;<?=$serviceUrl?>&quot;,
						&quot;itemUrl&quot;: &quot;<?=$itemUrl?>&quot;
					}
				}
			}"
		>
		<script>
			vscodeAlterConfigCallbacks = [];
<?php
foreach($hacks as $packageHacks):
foreach($packageHacks as $hack):?>
			vscodeAlterConfigCallbacks.push(<?php echo file_get_contents($hack); ?>);
			<?php endforeach; endforeach; ?>
			window.vscodeEditor = null;

			let resolveVSCodeEditorReady;
			window.vscodeEditorReady = new Promise(resolve => {
				resolveVSCodeEditorReady = resolve;
			});

			window.vscodeExposeEditor = editor => {
				window.vscodeEditor = editor;
				document.getElementById('loading-status')?.remove();
				resolveVSCodeEditorReady?.(editor);
				resolveVSCodeEditorReady = null;
			};
			window.vscodeEditorReady.then(() => {
				const searchParams = new URLSearchParams(location.search);
				const callbackOrigin = searchParams.get('origin') || '*';
				const callbackTarget = window.parent && window.parent !== window
					? window.parent
					: window.opener;

				if(callbackTarget?.postMessage)
				{
					callbackTarget.postMessage(
						{kind: 'vscode-react', type: 'ready'}
						, callbackOrigin
					);
				}
			});
			window.vscodeAlterConfig = config => {
				config.commands = config.commands || [];
				vscodeAlterConfigCallbacks.map(callback => callback(config));

				const searchParams = new URLSearchParams(location.search);

				if(searchParams.has('itemUrl'))
					config.productConfiguration.extensionsGallery.itemUrl = searchParams.get('itemUrl');

				if(searchParams.has('serviceUrl'))
					config.productConfiguration.extensionsGallery.serviceUrl = searchParams.get('serviceUrl');

				if(searchParams.has('resourceUrlTemplate'))
					config.productConfiguration.extensionsGallery.resourceUrlTemplate = searchParams.get('resourceUrlTemplate');
			};
		</script>

		<!-- Builtin Extensions -->
		<meta
			id="vscode-workbench-builtin-extensions"
			data-settings="<?php echo str_replace('"', '&quot;', json_encode($packages));?>">

		<!-- Workbench Auth Session -->
		<meta id="vscode-workbench-auth-session" data-settings="" />

		<!-- Workbench Icon/Manifest/CSS -->
		<link rel="icon" href="./favicon.ico" type="image/x-icon" />
		<link data-name="vs/workbench/workbench.web.main" rel="stylesheet" href="./out/vs/workbench/workbench.web.main.css?v=<?=$assetVersion?>" />
	</head>

	<body aria-label="">
		<div
			id = "loading-status"
			style = "position: absolute; z-index: -1; top: 0; left: 0; width: 100%; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; align-items:flex-start; white-space: pre; overflow: hidden; font-size: 1rem; font-family: monospace; padding: 1rem; box-sizing: border-box; background: black; color: white;">Starting editor…</div>
	</body>

	<!-- Startup (do not modify order of script tags!) -->
	<script src="./out/vs/loader.js?v=<?=$assetVersion?>"></script>
	<script src="./out/vs/webPackagePaths.js?v=<?=$assetVersion?>"></script>
	<script>
		let baseUrl = `${window.origin}<?=$basePath?>`
		Object.keys(self.webPackagePaths).map(function (key, index) {
			self.webPackagePaths[key] = `${baseUrl}/node_modules/${key}/${self.webPackagePaths[key]}`;
		});
		require.config({
			baseUrl: `${baseUrl}/out`,
			recordStats: true,
			trustedTypesPolicy: window.trustedTypes?.createPolicy('amdLoader', {
				createScriptURL(value) {
					if (value.startsWith(baseUrl)) {
						return value;
					}
					throw new Error(`Invalid script url: ${value}`)
				}
			}),
			paths: self.webPackagePaths
		});
	</script>
	<script src="./out/vs/workbench/workbench.web.main.nls.js?v=<?=$assetVersion?>"></script>
	<script src="./out/vs/workbench/workbench.web.main.js?v=<?=$assetVersion?>"></script>
	<script src="./out/vs/code/browser/workbench/workbench.js?v=<?=$assetVersion?>"></script>
</html>
