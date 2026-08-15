# LocTT

**Project management that lives in your repo, not on someone else's server.**

An open-source, local-first task tracker — a free **JIRA / Linear / Asana alternative** for personal projects and small teams. Tasks are stored as markdown files in a `.loctt/` directory, right alongside your code. No subscriptions, no vendor lock-in, no accounts to set up. Just your tasks, in your repo, under your control.

## The Problem

You want to track tasks on a personal project. So you reach for the usual suspects:

- **JIRA, Linear, Asana** — sign up, create a workspace, invite yourself, configure projects, hit a paywall for half the features you wanted, and now your tasks live on someone else's server forever.
- **A self-hosted tracker** — spin up a database, manage a server, configure auth, keep it patched. For a side project?
- **AI agents that need task context** — now you also need API keys, OAuth flows, and an integration layer just so your coding agent can see what's on the list.

For a solo project or a small team that already version-controls everything, this is wildly disproportionate. You don't need a multi-tenant SaaS. You need a text file you can grep — that your editor, your shell, and your AI agent can all read.

That's what LocTT is.

## Benefits

- **Free of charge.** No subscriptions, no tiers, no per-seat pricing. Open source under MIT.
- **No vendor lock-in.** Your tasks are markdown files with YAML frontmatter. Move them, grep them, script against them — they're just files.
- **No accounts or API keys.** No admin consoles, no onboarding flow, no OAuth dance.
- **No rate limits, no outages, no "scheduled maintenance."** It runs on your machine.
- **Works offline.** On a plane, on a train, in a cabin with no signal. Your tasks are right there on disk.
- **Git-friendly.** Commit `.loctt/` like any other folder, or use the opt-in sync mode that stores tasks on a dedicated branch.
- **AI-agent native.** Ships with an MCP server so Claude, Cursor, and other agents can manage tasks directly — no integration code required.

## Features

**Core task management**
- Tasks with status, priority, type, assignee, reporter, dates, labels, custom fields, and free-form markdown body
- Configurable workflows — define your own statuses, priorities, task types, and relationship kinds in YAML
- Directed relationships between tasks (`blocks`, `depends_on`, `parent`, or any custom kind you define)
- File attachments per task
- Activity log — every field change, link, body edit, and archive action is recorded
- Soft-delete (archive) with restore, plus permanent delete

**Organization**
- Multiple projects per tracker, each with its own key prefix and counter
- Labels, sprints, and milestones — all configurable, all archivable
- Users with profiles (name, email, timezone, avatar) for assignment and reporting
- Per-workspace calendar (timezone, working days, holidays)

**Query and views**
- Query language: `status = in_progress and priority = high`, `text ~ login`, etc.
- Saved views in `queries.yaml` for frequently-used filters

**Three ways to use it**
- **Web UI** — board and list views in your browser
- **CLI** — fast, scriptable task management from the terminal
- **MCP server** — AI agents read and manage tasks through structured tools

**Optional Git sync**
- Publish task state to a dedicated `loctt` branch
- Pull changes from other machines, with automatic 3-way reconciliation
- Detects and resolves key collisions across machines

**Built-in diagnostics**
- `loctt doctor` checks tracker integrity
- `loctt migrate` upgrades schema between versions with preview

## Quick Start

Requires Node.js >= 20.

```bash
npm install -g @loctt/cli
```

Initialize a tracker in any project:

```bash
loctt init
```

This creates a `.loctt/` directory with default config. You're ready to go.

> **From source:** Clone the repo, run `npm install && npm run build`, then `npm link --workspace apps/cli` to make the `loctt` command available globally.

Create your first task:

```bash
loctt create "Set up CI pipeline"
# Created T-1: Set up CI pipeline
```

That's it. Next, pick your interface — web UI, MCP, or CLI.

## Web UI

Start the web server:

```bash
loctt ui
```

This starts the server in the foreground and opens your browser to [http://localhost:4321](http://localhost:4321). You get board and list views for browsing, creating, and updating tasks — all backed by the same `.loctt/` data on disk. Press Ctrl-C to stop. Pass `--no-open` to skip the browser launch, or `--port <n>` to use a different port.

## MCP / AI Agent Integration

LocTT ships an MCP server so AI coding agents (Claude Code, Cursor, etc.) can manage tasks on your behalf. The MCP layer exposes structured tools for creating, querying, updating, and linking tasks, managing users, projects, sprints, labels, milestones, attachments, and more — agents never touch raw files.

Quick setup for Claude Desktop (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "loctt": {
      "command": "loctt",
      "args": ["mcp"],
      "cwd": "/path/to/your/project"
    }
  }
}
```

See [docs/user/mcp/reference.md](docs/user/mcp/reference.md) for the full tool list and setup for Cursor, VS Code, and other agents.

## CLI Usage

### Create a task

```bash
loctt create "Set up CI pipeline"
```

Set fields right away:

```bash
loctt create "Fix login bug" --status in_progress --priority high --type bug
```

### List tasks

```bash
loctt list
```

Filter with the query language:

```bash
loctt list --query "status = in_progress and priority = high"
loctt list --query "text ~ CI"
```

Use a saved view:

```bash
loctt list --view recent-open
```

### View a task

```bash
loctt show T-1
```

### Update a task

```bash
loctt set T-1 status in_progress
loctt set T-1 priority high
loctt set T-1 assignee "ken"
loctt unset T-1 priority
```

Edit the task body (free-form markdown):

```bash
loctt body T-1 --set "## Notes\nNeed to check the auth middleware first."
```

### Link tasks

```bash
loctt link T-2 blocks T-1
loctt link T-3 parent T-1
```

### Attach files

```bash
loctt attach T-1 ./screenshot.png
loctt detach T-1 screenshot.png
```

### Archive and delete

Archive is reversible:

```bash
loctt archive T-1
loctt unarchive T-1
```

Delete is permanent:

```bash
loctt delete T-1 --force
```

### History

```bash
loctt log T-1
```

## Git Sync

Share tasks across clones by syncing to a dedicated branch:

```bash
loctt git enable     # Turn on git-backed mode
loctt git publish    # Push task state to the loctt branch
loctt git sync       # Pull task state from the loctt branch
```

Conflicts are handled through automatic 3-way reconciliation — see [docs/user/common/git-sync.md](docs/user/common/git-sync.md).

## Configuration

Everything is customizable in `.loctt/config/workflow.yaml`: statuses, priorities, task types, relationships, and custom fields. Saved queries live in `.loctt/config/queries.yaml`.

## Documentation

**Start here:**
- [Concepts](docs/user/common/concepts.md) — how LocTT works, where data lives, and how sharing works
- [Getting Started](docs/user/common/getting-started.md) — install, initialize, and walk through the basics
- [Features](docs/user/features.md) — feature tour with links to each interface (Web UI, MCP, CLI)

**By interface:**
- [Features](docs/user/features.md) — what LocTT does, and which interfaces support each capability
- [CLI reference](docs/user/cli/reference.md)
- [MCP reference](docs/user/mcp/reference.md)
- [Web UI spec](docs/user/ui/features.md) — the target UI; only the list view ships today

**Cross-cutting:**
- [Configuration](docs/user/common/configuration.md)
- [Query Language](docs/user/common/query-language.md)
- [Git Sync](docs/user/common/git-sync.md)
- [Agent Setup](docs/user/mcp/agent-setup.md) — giving your AI agent project-specific workflow instructions
- [Uninstall](docs/user/common/uninstall.md)

**For contributors:**
- [Architecture](docs/dev/architecture.md) — monorepo layout, data model, task identity
- [Schema Reference](docs/dev/schema-reference.md) — file formats (`task.md`, `workflow.yaml`, …)
- [Development](docs/dev/development.md) — building, running, and testing locally
- [Invariants](docs/dev/invariants.md) — rules a change must not break
- [Decisions](docs/dev/decisions.md) — locked design decisions, including what is deliberately not built
- [Markdown extensions](docs/dev/markdown-extensions.md) — what the body editor must round-trip
- [Build loop](docs/dev/build-loop.md) — how a web-UI ticket gets built and verified
- [Known gaps](docs/dev/known-gaps.md) — understood defects not yet fixed

**Acceptance criteria** — 931 cases describing observable behaviour, one
file per flow. They are the specification the web UI is built against:
- [UI test cases](docs/dev/ui-test-cases/) — 18 flow docs, plus the P1–P10 principles in its [README](docs/dev/ui-test-cases/README.md)
- [CLI & MCP test cases](docs/dev/surface-test-cases/) — 10 flow docs, gaps only
- [`case-index.json`](docs/dev/case-index.json) — the machine-readable index; see [tools/README.md](tools/README.md) for the coverage gate

## License

MIT — see [LICENSE](LICENSE).
