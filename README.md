# VS Code Static Web Builder

Build the static assets to serve VS Code for the web.

## Usage

Pull the code & build the project:

```bash
git clone https://github.com/seanmorris/vscode-static-web.git
cd vscode-static-web
make
```

## Start the dev server

```bash
make serve
```

## Run the tests

```bash
make test
```

## Run the browser E2E tests

```bash
make test-e2e
```

This serves the real built `public/` site and waits for the VS Code workbench
to boot.

To watch the real built site boot in a visible Chromium window while the same
workbench assertion runs:

```bash
E2E_VISIBLE=1 make test-e2e
```

This requires a desktop session with `DISPLAY` or `WAYLAND_DISPLAY` set.

To keep that visible browser open after the workbench boots:

```bash
E2E_VISIBLE=1 E2E_KEEP_OPEN=1 make test-e2e
```

The older synthetic browser bootstrap check is still available as:

```bash
make test-smoke
```

To keep the visible browser open for inspection before the smoke test exits:

```bash
E2E_VISIBLE=1 E2E_HOLD_SECONDS=30 make test-smoke
```

## Creating an extension

Create a new directory inside `extra_extensions` and use [Yeoman](https://yeoman.io/) to scaffold your extension:

```bash
cd extra_extensions
npx --package yo --package generator-code -- yo code
```

***Important!***
Make sure to open up your package.json, and copy the `main` key to `browser`.
Otherwise, your extension will not run on the web version of VS Code.

```json
{
    "main": "./dist/extension.js",
    "browser": "./dist/extension.js", // <== This one
}
```

Once you're ready to run your extension, just rebuild & restart the dev server:

```bash
make all serve
```

... and refresh the page.

## Rebuilding File Bus

The [File Bus](https://github.com/seanmorris/file-bus) checkout belongs in
`extra_extensions/file-bus`. Check out the extension revision you want to serve
and build its ignored `dist/index.js` and `hack.js` artifacts before staging it.
From this repository's root:

```bash
npm --prefix extra_extensions/file-bus ci
npm --prefix extra_extensions/file-bus run compile
make all
```

`make all` copies the built extension to `public/extensions/file-bus` and
regenerates `public/index.html`, which embeds the hack script. `make extensions`
only copies extension files; neither target runs the extension's compiler.
After an initial VS Code build, extension-only changes reuse the existing
workbench build. Use `make serve` to preview the result.

File Bus directory expansion and recursive search can request
`readdir(path, {withFileTypes: true})` from the embedding app. The host should
return plain `{name, isFolder}` entries and forward the options through its
filesystem adapter. Hosts returning `string[]` still work through per-entry
`analyzePath` calls. The faster path requires both this rebuilt extension and
a host implementation supporting typed listings; publishing the embedding app
alone does not update the VS Code host.

Run `npm --prefix extra_extensions/file-bus test` for the extension's directory
and search regressions. `make test` checks host packaging, and `make test-e2e`
checks the built workbench. Publishing remains a separate `make deploy` step.

## Skipping extensions

The shipped extension skip set now defaults from `extensions-skip.list`.

To use that default list:

```bash
make all
```

To point the build at a different skip file:

```bash
make all EXTENSIONS_SKIP_FILE=/path/to/extensions-skip.list
```

To override the skip list directly for one build:

```bash
make all VSCODE_SKIP_EXTENSIONS="ext-a ext-b"
```

## Publish

Publishing is a two-part deploy:

1. build the static VS Code bundle into `public/`
2. sync `public/` to the configured R2 bucket and deploy the Pages worker from `pages/`

The deploy script now runs the build for you, so the normal operator entrypoint is:

```bash
make deploy
```

The script expects a local `.env` file with at least:

```bash
PROJECT_NAME=...
BUCKET_NAME=...
ENDPOINT=...
CLOUDFLARE_ACCOUNT_ID=...
CLOUDFLARE_API_TOKEN=...
```

Optional deploy settings:

```bash
SOURCE_DIR=public
PAGES_DIR=pages
PAGES_BRANCH=master
WRANGLER_VERSION=4.87.0
```

It also expects Cloudflare R2-compatible AWS credentials under `.aws/credentials`
and `.aws/config`.

Only runtime-ready files from `extra_extensions/` are published into
`public/extensions/`. Local repo metadata and development dependencies like
`.git/` and `node_modules/` are excluded from the deploy artifact.
