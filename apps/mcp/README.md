# @loctt/mcp

MCP (Model Context Protocol) server for **LocTT** — the AI-facing surface of a
local-first task tracker whose tasks live as markdown + YAML files in a
`.loctt/` directory. It lets an AI agent read and manage tasks with the same
data and rules as the CLI and web UI.

## Install

```bash
npm install -g @loctt/mcp
```

## Usage

Run the server over stdio and point your MCP client at it. Configure it in your
agent's MCP settings, for example:

```json
{
  "mcpServers": {
    "loctt": {
      "command": "loctt-mcp",
      "args": []
    }
  }
}
```

The server operates on the `.loctt/` tracker in its working directory. See the
MCP tool reference and agent guidelines at the
[project repository](https://github.com/Kenneth-LJS/loctt).

## Security note

The agent surface is confined: file attachments are restricted to inside the
tracker root, backup/restore require explicit confirmation, and git refs are
validated. Do not auto-approve destructive tools without understanding them.

## License

MIT — see [LICENSE](./LICENSE).
