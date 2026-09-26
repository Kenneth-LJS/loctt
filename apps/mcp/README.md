# @loctt/mcp (internal workspace)

This workspace holds the LocTT MCP server. It is not published on its
own: it ships inside the [`loctt`](../cli/README.md) package, which runs
it as `loctt mcp`.

```bash
npm install -g loctt
```

Then point your MCP client at it:

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

See [`docs/user/mcp/reference.md`](../../docs/user/mcp/reference.md) for
the tool reference and agent guidelines.
