# @loctt/cli

Command-line interface for **LocTT** — a local-first task tracker that stores
tasks as markdown + YAML files in a `.loctt/` directory alongside your code.
No server, no account, no vendor lock-in.

## Install

```bash
npm install -g @loctt/cli
```

This installs the `loctt` command.

## Usage

```bash
loctt init                 # create a .loctt/ tracker in the current repo
loctt create "My task"     # add a task
loctt list                 # list tasks
loctt --help               # full command reference
```

See the full CLI reference and guides at the
[project repository](https://github.com/Kenneth-LJS/loctt).

## License

MIT — see [LICENSE](./LICENSE).
