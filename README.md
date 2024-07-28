# VS Code Static Web Builder

Build the static assets to serve VS Code for the web.

## Usage

Pull the code & build the project:

```bash
$ git clone https://github.com/seanmorris/vscode-static-web.git
$ cd vscode-web-static
$ make
```

## Start the dev server

```bash
$ make serve
```

## Creating an extension

Create a new directory inside `extra_extensions` and use [Yeoman](https://yeoman.io/) to scaffold your extension:

```bash
$ cd extra_extensions
$ npx --package yo --package generator-code -- yo code
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

Once you're ready to run your extension, just run

```bash
$ make clean-static
$ make serve
```

... and refresh the page.
