#!/usr/bin/env php
<!-- Copyright (C) Microsoft Corporation. All rights reserved. -->
<!-- Modifications for EDUCATIONAL PURPOSES by Sean Morris. -->
<?php
$basePath = getenv('VSCODE_BASEPATH') ?: '';
$skipExtensions = explode(' ', getenv('VSCODE_SKIP_EXTENSIONS'));

$resourceUrlTemplate = getenv('VSCODE_RESOURCE_URL_TEMPLATE')
	?: 'https://open-vsx.org/vscode/asset/{publisher}/{name}/{version}/Microsoft.VisualStudio.Code.WebResources/{path}';

$serviceUrl = getenv('VSCODE_SERVICE_URL')
	?: 'https://open-vsx.org/vscode/gallery';

$itemUrl = getenv('VSCODE_ITEM_URL')
	?: 'https://open-vsx.org/vscode/item';

$extDirs = array_filter(
	scanDir('./public/extensions')
	, fn($name) => (
		!in_array($name, $skipExtensions)
		&& $name !== '.'
		&& $name !== '..'
		&& file_exists('./public/extensions/' . $name . '/package.json')
	)
);

$hacks = array_map(
	function($name){
		$packageDir = './public/extensions/' . $name;
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
	function($name) use($skipExtensions)
	{
		$packageJSONFile = './public/extensions/' . $name . '/package.json';
		$packageNLSFile  = './public/extensions/' . $name . '/package.nls.json';

		$packageJSON = json_decode(file_get_contents($packageJSONFile));

		$entry = ['extensionPath' => $name];

		if(file_exists($packageJSONFile))
		{
			$packageJSON  = json_decode(file_get_contents($packageJSONFile));
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
		<base href="<?=$basePath?>">

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
			window.vscodeExposeEditor = editor => {
				window.vscodeEditor = editor;
			};
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
			data-settings="<?php echo str_replace('"', '&quot;', json_encode($packages, JSON_PRETTY_PRINT));?>">

		<!-- Workbench Auth Session -->
		<meta id="vscode-workbench-auth-session" data-settings="" />

		<!-- Workbench Icon/Manifest/CSS -->
		<link rel="icon" href="/favicon.ico" type="image/x-icon" />
		<link data-name="vs/workbench/workbench.web.main" rel="stylesheet" href="./out/vs/workbench/workbench.web.main.css" />
	</head>

	<body aria-label="">
		<div
			id = "loading-status"
			style = "position: absolute; z-index: -1; top: 0; left: 0; width: 100%; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; align-items:flex-start; white-space: pre; overflow: hidden; font-size: 1rem; font-family: monospace; padding: 1rem; box-sizing: border-box; background: black; color: white;"></div>
	</body>

	<!-- Startup (do not modify order of script tags!) -->
	<script src="./out/vs/loader.js"></script>
	<script src="./out/vs/webPackagePaths.js"></script>
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
		const status = document.getElementById('loading-status');
		const observer = new MutationObserver((mutationList, observer) => {
			for(const mutation of mutationList)
			{
				if(mutation.type === "childList")
				{
					mutation.addedNodes.forEach(element => {
						const prev = status.innerText;
						switch(element.tagName)
						{
							case 'SCRIPT':
								// console.log(element.getAttribute('src'));
								status.innerText = "Loading " + element.getAttribute('src');
								break
							
							case 'LINK':
								// console.log(element.getAttribute('href'));
								// status.innerText = "Loading " + element.getAttribute('href') + "\n" + prev;
								break;
								
							default:
								// console.log(element);
								break;
						}
					});
				}
			}
		});
		observer.observe(document.head, { attributes: true, childList: true, subtree: true });
		// observer.disconnect();
		require(['vs/code/browser/workbench/workbench'], function() {});
	</script>
</html>
