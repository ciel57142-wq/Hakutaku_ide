# Juniper IDE (desktop)

## Run

```sh
npm install
npm start
```

`npm install` downloads Electron and the editor and terminal libraries (about 250 MB, once).
`npm start` opens the IDE in its own window. After the install it works offline.

## Change the code

The source is in `src/`. After editing, rebuild and start again:

```sh
npm run build

```

The build writes three pages into `dist/`:

- `desktop.html` is what the desktop window loads (libraries from `node_modules`).
- `index.html` is the web version (libraries from a CDN).
- `local.html` is for testing behind a local web server.

`src/index.html` is only the template the build fills in. Opening it directly shows an
unstyled page that says "Loading editor…".
