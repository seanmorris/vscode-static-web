# VS Code Static Web Builder

Build the static assets to serve VS Code for the web.

## Usage

Pull the code & build the project:

```bash
git clone https://github.com/seanmorris/vscode-static-web.git
cd vscode-static-web
make
```

The normal build runs VS Code's `vscode-web-min` Gulp task and stages the packaged
browser distribution from `third_party/vscode-web/`. JavaScript and CSS are
bundled and minified; the development `third_party/vscode/out/` directory is not
published. The VS Code version remains selected by `VSCODE_TAG`.
Bootstrap scripts and styles share a content hash in their URLs so a cached
development workbench cannot be mixed with new production bundles after a rebuild.
The generated inventory points each browser extension at a copy of its entry
script with a content hash in the filename. Original entry files remain available;
extension-only updates fetch the current entry code without rebuilding the core.

Existing checkouts migrate on the next `make all` through a separate
`journal/.compiled-web` stamp. Host patches are checked before compilation; a
conflict stops the build instead of publishing incomplete output. The build
requires Yarn Classic, as does the pinned VS Code checkout. Set `YARN` to override
the executable when needed.

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
to boot. It also rejects a return to loading hundreds of individual source
modules. When File Bus is staged, the test supplies an isolated in-memory host
and verifies extension activation, opening a file, saving an edit, and reusing
directory traversal when a Quick Open query changes. It prints startup timings
and the script count.

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

The static host's extension inventory remains in the generated page for both
development and production bundles. Its scanner patch lets the staged packages,
including extra extensions and the configured skip list, take precedence over
VS Code's compiled inventory. Updating File Bus therefore does not require
recompiling the core workbench.

File Bus directory expansion and recursive search can request
`readdir(path, {withFileTypes: true})` from the embedding app. The host should
return plain `{name, isFolder}` entries and forward the options through its
filesystem adapter. Hosts returning `string[]` still work through per-entry
`analyzePath` calls. The faster path requires both this rebuilt extension and
a host implementation supporting typed listings; publishing the embedding app
alone does not update the VS Code host.

Quick Open reuses its File Bus directory index within a search session and
invalidates it after provider mutations. Cancellation stops a query from waiting;
traversal ends once no search consumer needs it. Host changes outside File Bus
appear in the next search session. File Bus directory reads fetch fresh listings;
VS Code can reuse already loaded tree children until **Refresh Explorer**.
Search traversal queues one directory read at a time so tree expansion can run
between search reads instead of waiting behind a whole workspace scan.

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

Each staging pass restores the packaged built-in extensions before applying the
skip list, so removing an extension from that list restores it without a clean
build.

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
