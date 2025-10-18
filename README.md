# VS Code Static Web Builder

Build the static assets to serve VS Code for the web.

> ### I am giving up my bed for one night.
> My Sleep Out helps youth facing homelessness find safe shelter and loving care at Covenant House. That care includes essential services like education, job training, medical care, mental health and substance use counseling, and legal aid — everything they need to build independent, sustainable futures.
>
> By supporting my Sleep Out, you are supporting the dreams of young people overcoming homelessness.
>
> <a href = "https://www.sleepout.org/participants/62915"><img width = "50%" alt="Donate to Covenant House" src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fwww.sleepout.org%2Fapi%2F1.3%2Fparticipants%2F62915%3F_%3D1760039017428&query=%24.sumDonations&prefix=%24&suffix=%20Raised&style=for-the-badge&label=Sleep%20Out%3A%20NYC&link=https%3A%2F%2Fwww.sleepout.org%2Fparticipants%2F62915"></a>
>
> Click here to help out: https://www.sleepout.org/participants/62915
>
> More info: https://www.sleepout.org/ | https://www.covenanthouse.org/ | https://www.charitynavigator.org/ein/132725416
>
> Together, we are working towards a future where every young person has a safe place to sleep.
>
> Thank you.
>
> *and now back to your documentation...*

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

Once you're ready to run your extension, just hit ctrl+c in your terminal and run

```bash
make all serve
```

... and refresh the page.
