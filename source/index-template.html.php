#!/usr/bin/env php
<!-- Copyright (C) Microsoft Corporation. All rights reserved. -->
<!-- Modifications for EDUCATIONAL PURPOSES by Sean Morris. -->
<!DOCTYPE html>
<html>
	<head>
		<meta charset="utf-8" />

		<!-- Disable pinch zooming -->
		<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no">

		<!-- Workbench Configuration -->
		<meta id="vscode-workbench-web-configuration" data-settings="{
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
					&quot;enableTelemetry&quot;:false
				}
			}"
		>
		<script>
			const incomplete = new Map;
			const originSymbol = Symbol('origin');
			const recipientSymbol = Symbol('recipient');

			const onMessage = event => {
				if(event.data.re && incomplete.has(event.data.re))
				{
					const callbacks = incomplete.get(event.data.re);

					if(!event.data.error)
					{
						callbacks[0](event.data.result);
					}
					else
					{
						callbacks[1](event.data.error);
					}
				}
			};

			const sendMessage = (client, action, params, accept, reject) => {
				const token  = crypto.randomUUID();
				const result = new Promise((_accept, _reject) => [accept, reject] = [_accept, _reject]);

				incomplete.set(token, [accept, reject]);

				let recipient = client[recipientSymbol];

				if(!(recipient instanceof Promise))
				{
					recipient = Promise.resolve(recipient);
				}

				recipient.then(recipient => recipient.postMessage({action, params, token}, client[originSymbol]));

				return result;
			};

			class Client
			{
				constructor(recipient, origin)
				{
					this[originSymbol] = origin;
					this[recipientSymbol] = recipient;

					return new Proxy(this, {
						 get: (target, key, receiver) => {

							if(typeof key === 'symbol')
							{
								return target[key];
							}

							return (...params)  => sendMessage(receiver, key, params);
						}
					});
				}
			}

			const client = new Client(window.parent ?? window.opener, 'http://localhost:3333');

			window.addEventListener('message', onMessage);

			window.vscodeAlterConfig = (config) => {
				config.commands = config.commands || [];
				config.commands.push(
					{
						id: "fileBus.call",
						handler: (method, ...args) => client[method](...args)
					},
				);
			}
		</script>
		<!-- Builtin Extensions -->
		<meta id="vscode-workbench-builtin-extensions" data-settings="<?php

			$skipExtensions = explode(',', getenv('VSCODE_SKIP_EXTENSIONS'));

			$extDirs = array_filter(
				scanDir('./public/extensions')
				, fn($name) => (
					!in_array($name, $skipExtensions)
					&& $name !== '.'
					&& $name !== '..'
					&& file_exists('./public/extensions/' . $name . '/package.json')
				)
			);

			$packages = array_map(
				function($name)
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
			);

			echo str_replace('"', '&quot;', json_encode($packages, JSON_PRETTY_PRINT));
		?>">

		<!-- Workbench Auth Session -->
		<meta id="vscode-workbench-auth-session" data-settings="" />

		<!-- Workbench Icon/Manifest/CSS -->
		<link rel="icon" href="/favicon.ico" type="image/x-icon" />
		<link data-name="vs/workbench/workbench.web.main" rel="stylesheet" href="/out/vs/workbench/workbench.web.main.css" />
	</head>

	<body aria-label="">
	</body>

	<!-- Startup (do not modify order of script tags!) -->
	<script src="/out/vs/loader.js"></script>
	<script src="/out/vs/webPackagePaths.js"></script>
	<script>
		let baseUrl = window.origin
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
	<script> require(['vs/code/browser/workbench/workbench'], function() {}); </script>
</html>
