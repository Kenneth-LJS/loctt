# LocTT

Local task tracker — CLI tool, MCP server, and GUI for managing tasks stored as markdown files in `.loctt/`.

## Tech Stack

- Node.js / TypeScript
- Task data: YAML frontmatter + markdown body in `.loctt/tasks/<id>/task.md`
- Config: `.loctt/config/workflow.yaml`, `.loctt/config/queries.yaml`
- State: `.loctt/state.yaml`

## Key Design Decisions

User-facing documentation lives in `docs/`. Developer documentation lives in `docs/dev/`. Cross-reference before implementing:
- `docs/dev/architecture.md` — monorepo layout, data model, task identity
- `docs/dev/schema-reference.md` — file formats (task.md, workflow.yaml, etc.)
- `docs/cli-reference.md` — CLI commands
- `docs/mcp-reference.md` — MCP tools and agent guidelines

Key points:
- Tasks use `id` (internal, ULID) and `key` (user-facing, e.g. `T-123`)
- Status, priority, task_type, relationships are configurable in `.loctt/config/workflow.yaml`
- Stored enum values use config `key`s, not human labels
- Task body is free markdown; no schema-enforced structure
- MCP uses structured tools for metadata — never edit frontmatter directly
- Git-backed mode is optional, uses sparse worktree on `loctt` branch

## Commands

```bash
npm run build        # Build all workspaces (tsc)
npm run test         # Run tests across all workspaces (vitest)
npm run typecheck    # Type-check all workspaces
npm run lint         # Lint all workspaces (eslint)
npm run lint:fix     # Lint and auto-fix
npm run clean        # Remove dist/ from all workspaces
npx tsc --build      # Build via project references
```

## Architecture

- Monorepo with npm workspaces
  - `packages/contracts` — shared types and API shapes
  - `packages/core` — shared LocTT logic
  - `apps/cli` — CLI interface
  - `apps/mcp` — MCP server
  - `apps/web` — web app (HTTP server + API + UI, merged from former `apps/service`)
- **Note:** `apps/service` is being merged into `apps/web`. Do not re-separate them.
- `.loctt/` — data directory (tasks, config, state)
- Documentation: `docs/` (user-facing), `docs/dev/` (developer)

## Frontend Development (WIP — clean up before release)

The loctt frontend is being developed in a separate repo (`~/Documents/PDev/task-tracker/`),
using loctt itself to plan and track the work. This is intentional dogfooding — we use loctt's
CLI/MCP to manage the tickets for building loctt's own frontend.

- **Design doc:** `~/Documents/PDev/task-tracker/design-doc.md`
- **Workflow:** Build the frontend in task-tracker, experiment, refine. Once happy, migrate/adapt
  it into this repo (likely under `apps/web`).
- **task-tracker is not a separate product** — it's a testing ground for the loctt frontend.
  The design doc there describes what the loctt web UI should become.

Key design differences to be aware of during migration:
- task-tracker uses SQLite + Express; loctt uses markdown files + its own core library
- task-tracker has relationship ranking (lexorank on `relationships.rank`); loctt does not yet
- The frontend (React + Vite + Tailwind + shadcn/ui) should be largely portable once the API
  layer is adapted

## Git Commits

- Do NOT add "Co-Authored-By" or any AI/Claude attribution to commit messages. Ever.
- Write commit messages as if a human wrote them. No credits, no signatures.

## Development Workflow

Follow `.claude/housekeeping.md` for all work. Key principles:

1. Understand intent before implementing
2. Investigate impact on existing features
3. Identify edge cases and complications
4. THEN implement

No quick fixes. No workarounds without discussion.

## Testing Philosophy

- Tests catch bugs, not coverage metrics
- Mock only external dependencies (file system, network, timers), never business logic
- Present test strategy before implementing
- Each test should answer: "what regression would this catch?"
