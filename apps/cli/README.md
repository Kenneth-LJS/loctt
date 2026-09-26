# loctt

**LocTT** is a local-first task tracker that stores tasks as markdown +
YAML files in a `.loctt/` directory alongside your code. No server, no
account, no vendor lock-in.

One package gives you all three surfaces: the CLI, the web UI and the MCP
server for AI agents.

## Install

```bash
npm install -g loctt
```

This installs the `loctt` command.

## Usage

```bash
loctt init                 # create a .loctt/ tracker in the current repo
loctt create "My task"     # add a task
loctt list                 # list tasks
loctt ui                   # open the web UI (served on 127.0.0.1 only)
loctt mcp                  # run the MCP server on stdio, for your AI agent
loctt --help               # full command reference
```

To connect an MCP client:

```json
{
  "mcpServers": {
    "loctt": {
      "command": "loctt",
      "args": ["mcp"]
    }
  }
}
```

Or, without a global install: `"command": "npx", "args": ["-y", "loctt", "mcp"]`.

See the full CLI and MCP references and guides at the
[project repository](https://github.com/Kenneth-LJS/loctt).

## License

MIT — see [LICENSE](./LICENSE).
