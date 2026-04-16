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
npm run build        # Build all workspaces (tsc)
npm run test         # Run tests across all workspaces (vitest)
npm run typecheck    # Type-check all workspaces
npm run clean        # Remove dist/ from all workspaces
```

## Running Locally

**CLI:**

```bash
npx loctt <command>
```

**Web app:**

```bash
node apps/web/dist/index.js
# Serves API + UI on http://localhost:4321
```

**MCP server:**

The MCP package exports `getTools()` and `executeTool()` for integration into MCP hosts. It's a library, not a standalone server.

## Build System

Pure TypeScript compilation via `tsc` with project references. No bundler. All workspaces inherit from `tsconfig.base.json`:

- Target: ES2022
- Module: Node16 (ESM)
- Strict mode
- Source in `src/`, output in `dist/`

## Testing

Tests use vitest. Run from the root to test everything, or from a workspace directory for focused testing:

```bash
npm run test                           # All workspaces
cd packages/core && npm run test       # Just core
```

Mock only external dependencies (file system, network, timers), never business logic.

## Documentation

Product documentation lives in `docs/`. Update relevant docs when changing behavior. See [architecture.md](architecture.md) for a technical overview.
