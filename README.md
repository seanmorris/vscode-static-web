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

## Build a release

Release builds include the packaged VS Code built-ins, filtered by
`extensions-skip.list`, plus **File Bus and Dbg Bus**. Their exact source commits
are in `release-extensions.json`. `make release-extensions` clones those revisions
into `.release-extensions/`, installs their lockfiles, and runs File Bus's tests
and Dbg Bus's compiler. Existing checkouts in `extra_extensions/` are never reset
or rebuilt by this target. Local examples remain available to `make all` but do
not enter a release. Publish a newly pinned extension commit before using it in CI.

Use Node 18.19.0 and Yarn Classic for the VS Code 1.89.0 build, then Node 22 for
release tooling. On a machine with the existing workbench build:

```bash
npm ci
make release
```

For a fresh checkout, first run `make journal/.static-build` with VS Code's Node
version, then switch to Node 22 and run the commands above. The build also needs
PHP CLI, rsync, Git, a C/C++ toolchain and the Linux development libraries used by
VS Code. CI records the complete package setup in `.github/workflows/release.yaml`.

`make release` runs the packaging and deployment regression tests, builds the two
selected extensions, stages the site once, and verifies the frozen artifact in a
local Cloudflare runtime and Chromium. It checks every asset's SHA-256 digest,
workbench startup, File Bus reads/saves/search reuse, and Dbg Bus commands. Set
`PLAYWRIGHT_CHROMIUM_PATH` if Chromium is not at `/usr/bin/chromium`.

Remote verification checks every asset's digest and immutable cache policy, then
tests conditional GET using the validator exposed by the server. It uses ETag
when available and falls back to Last-Modified when Cloudflare removes ETag from
an HTML response. Missing validators, changed bytes, and failed revalidation still
fail the release. See [Cloudflare's ETag behavior](https://developers.cloudflare.com/cache/reference/etag-headers/).

Each artifact is `.releases/<content-id>/`, containing `assets/` and `pages/`.
`assets/release.json` binds the file inventory, hashes, extension pins and worker.
`.releases/latest` selects the latest local artifact. Set `RELEASE_DIR` to choose
another one. `make verify-local-release RELEASE_DIR=...` verifies an existing
artifact without rebuilding it.

The release index uses `/releases/<content-id>/` for all bundled assets. The worker
redirects `/` there while preserving query parameters used by embedding apps.
Assets receive immutable cache headers, ETags, conditional GET, HEAD and byte-range
support. The worker also caches complete immutable responses at the Cloudflare
edge. A previous tab continues to request its own release's assets after promotion.

## Preview, promote and roll back

Deployment consumes the staged artifact and **does not rebuild** it:

```bash
make deploy                         # Upload R2 prefix, deploy preview, verify it
make deploy-production              # Verify a preview, then promote the same bytes
make deploy-verify DEPLOYMENT_URL=https://<deployment>.oss-code.pages.dev
make rollback DEPLOYMENT_ID=<previous-successful-production-deployment-uuid>
```

Production promotion rechecks the stage, verifies both the unique deployment URL
and the public URL, and automatically rolls back to the previous successful Pages
deployment if verification fails. If another deployment takes over, or an upload
has an uncertain outcome, the command fails with an explicit recovery message
instead of claiming success or undoing someone else's release. Preview deploys
never use the project's production branch. The production branch is read from the
Pages API; `PAGES_BRANCH` is no longer used.

Every upload writes only `releases/<content-id>/` in R2. Nothing deletes the bucket
root or previous releases. Pages rollback therefore restores matching assets as
well as the worker. Existing unversioned assets stay readable during migration,
so the old deployment can also be restored. Do not delete those root assets until
legacy deployments and tabs are no longer needed. Garbage collection is a separate
operator task: retain every release that remains a rollback target or is used by
an open client. There is no automatic retention deletion.

Deployments use the pinned Wrangler from `npm ci`, plus AWS CLI and `flock`. Local
commands read `.env` without overwriting environment variables. CI can supply the
same settings directly:

```dotenv
PROJECT_NAME=oss-code
BUCKET_NAME=your-r2-bucket
ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
CLOUDFLARE_ACCOUNT_ID=<account-id>
CLOUDFLARE_API_TOKEN=<pages-token>
# Optional, when the public URL is a custom domain:
PRODUCTION_URL=https://editor.example.com
```

Use a Cloudflare token with account [Pages edit access](https://developers.cloudflare.com/pages/configuration/api/#get-an-api-token) to the selected account,
and R2 S3 credentials with object read/write access restricted to the asset bucket.
Supply `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and `AWS_DEFAULT_REGION=auto` in
CI. Locally, the existing `.aws/credentials` and `.aws/config` files with profile
`r2` still work; `AWS_PROFILE` and standard AWS credential file overrides are also
supported. Credential files are not generated, edited or packaged. Temporary
Wrangler configuration is created outside the checkout and removed after use;
there is no generated root `wrangler.toml` to conflict with local configuration.

The GitHub workflow runs fast tests on pushes and pull requests. Its manual action
builds and verifies one artifact, then optionally deploys a preview or production.
Production is restricted to `master`; configure GitHub environments `preview` and
`production` with the variables above and secrets `CLOUDFLARE_API_TOKEN`,
`AWS_ACCESS_KEY_ID`, and `AWS_SECRET_ACCESS_KEY`. Configure any desired approval on
the production environment. Deployment jobs are serialized without cancelling an
in-flight release. A successful prior production deployment is required for
promotion; first-time provisioning of an empty Pages project is separate.
