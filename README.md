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
