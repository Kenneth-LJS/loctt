# @loctt/web

Web UI for **LocTT** — a local-first task tracker that stores tasks as
markdown + YAML files in a `.loctt/` directory alongside your code. The server
binds to `127.0.0.1` only; nothing leaves your machine.

## Install

```bash
npm install -g @loctt/web
```

This installs the `loctt-ui` command.

## Usage

```bash
loctt-ui                   # start the UI for the .loctt/ tracker here
loctt-ui --port 4000       # choose a port
```

Then open the printed `http://localhost:<port>` URL. The server serves both the
API and the client bundle, and is reachable only from the local machine.

See the full documentation at the
[project repository](https://github.com/Kenneth-LJS/loctt).

## License

MIT — see [LICENSE](./LICENSE).
