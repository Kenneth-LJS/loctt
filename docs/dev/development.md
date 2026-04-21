# Development

Guide for working on the LocTT codebase.

## Prerequisites

- Node.js >= 20
- npm (ships with Node.js)

## Setup

```bash
git clone <repo-url>
cd loctt
npm install
npm run build
```

## Project Structure

LocTT is a monorepo with npm workspaces:

```
packages/
  contracts/    Shared TypeScript types and API shapes
  core/         Shared logic (task CRUD, query engine, config, git sync)

apps/
  cli/          CLI interface (bin: loctt)
  mcp/          MCP server for AI agents
  web/          HTTP server + API + web UI
```

Dependencies flow upward: `apps/*` depend on `packages/core`, which depends on `packages/contracts`. All apps operate directly on core — they don't go through each other.

## Commands

```bash
npm run build        # Build all workspaces (tsc + tsup for CLI/MCP)
npm run test         # Run tests across all workspaces (vitest)
npm run typecheck    # Type-check all workspaces
npm run clean        # Remove dist/ from all workspaces
```

## Running Locally

### CLI

After building, link the CLI globally for testing:

```bash
npm link --workspace apps/cli    # Makes `loctt` command available globally
```

The link is a symlink to `dist/`, so after rebuilding, the global `loctt` command picks up changes immediately. No need to re-link.

You can also run directly without linking:

```bash
node apps/cli/dist/index.js <command>
```

### Web app

```bash
node apps/web/dist/index.js
# Serves API + UI on http://localhost:4321
```

### MCP server

See [MCP development](#mcp-development) below.

## Build System

TypeScript compilation via `tsc --build` with project references for packages, then `tsup` (esbuild) to bundle `apps/cli` and `apps/mcp` into single-file distributions for npm. All workspaces inherit from `tsconfig.base.json`:

- Target: ES2022
- Module: Node16 (ESM)
- Strict mode
- Source in `src/`, output in `dist/`

For continuous rebuilding during development:

```bash
npx tsc --build --watch
```

## Testing

Tests use vitest. Run from the root to test everything, or from a workspace directory for focused testing:

```bash
npm run test                           # All workspaces
cd packages/core && npm run test       # Just core
```

Mock only external dependencies (file system, network, timers), never business logic.

## MCP Development

The MCP server runs as a long-lived child process inside an AI host (Claude Desktop, VS Code, Cursor, etc.). This affects the dev workflow.

### How it works

1. The AI host starts the MCP server as a subprocess (usually via stdio)
2. The server advertises its tools on startup
3. The host sends tool calls as JSON requests; the server executes and returns structured JSON
4. The process stays alive across conversations within the same host

Each AI host spawns its own independent MCP server instance. They don't share state.

### The dev loop

```
1. Edit code
2. npm run build (or use tsc --build --watch)
3. Restart the MCP server in your AI host
4. Test
```

**The restart is necessary** — the running server process holds the old code in memory. Rebuilding `dist/` doesn't affect it.

### Restarting the MCP server

How you restart depends on the host:

- **VS Code (Claude Code extension):** `Cmd+Shift+P` → "Developer: Reload Window"
- **Claude Desktop:** Developer menu → restart MCP server, or quit and reopen
- **Cursor:** Reload window or toggle the MCP server off/on in settings

There is no universal hot-reload for MCP servers. The host owns the process lifecycle.

### Testing without an AI host

Use the MCP Inspector for standalone testing:

```bash
npx @modelcontextprotocol/inspector
```

This gives you a web UI to call tools directly — much faster iteration than going through an AI host.

### Tips

- **Test core logic via unit tests first.** Only go through MCP when testing the MCP-specific layer (tool schemas, response formatting).
- **Use `tsc --build --watch`** so at least the build step is automatic.
- **Use the CLI** to verify core behavior before testing via MCP — same underlying logic, faster feedback.

## Documentation

- User-facing documentation lives in `docs/`
- Developer documentation lives in `docs/dev/`

Update relevant docs when changing behavior. See [architecture.md](architecture.md) for a technical overview.
