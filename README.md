# LocTT

**Project management that lives in your repo, not on someone else's server.**

An open-source, local-first task tracker. Tasks are stored as markdown files in a `.loctt/` directory — right alongside your code. No subscriptions, no vendor lock-in, no accounts to set up. Just your tasks, in your repo, under your control.

## Why?

You already version-control your code. Why are your tasks stuck on a SaaS platform you don't own?

With LocTT:

- **No subscriptions.** It's free. It's open source. That's it.
- **No vendor lock-in.** Your tasks are markdown files with YAML frontmatter. Move them, grep them, script against them — they're just files.
- **No API rate limits.** No outages. No "scheduled maintenance" at the worst possible time.
- **No account setup.** No admin consoles. No permission mazes. No onboarding your whole team onto yet another tool.
- **Works offline.** On a plane, on a train, in a cabin with no signal. Your tasks are right there on disk.
- **Git-friendly.** Optionally sync tasks to a dedicated branch and share them across clones.

## Features

- **CLI** — Fast, scriptable task management from the terminal
- **Web UI** — A browser-based interface for when you want something visual
- **MCP server** — Let AI agents (Claude, etc.) read and manage your tasks directly
- **Configurable workflows** — Define your own statuses, priorities, task types, and relationships in a YAML file
- **Human-readable storage** — Every task is a `.md` file you can open in any editor
- **Query language** — Filter tasks with expressions like `status = in_progress and priority = high`
- **Saved views** — Store frequently-used queries in `queries.yaml`
- **Git sync** — Publish and sync tasks across machines via a dedicated branch

## Quick Start

```bash
git clone <repo-url>
cd loctt
npm install
npm run build
```

Initialize a tracker in any project:

```bash
npx loctt init
```

This creates a `.loctt/` directory with default config. You're ready to go.

## Web UI

Start the web server:

```bash
node apps/web/dist/index.js
```

Then open [http://localhost:4321](http://localhost:4321). You get a board and list view for browsing, creating, and updating tasks — all backed by the same `.loctt/` data on disk.

## MCP / AI Agent Integration

LocTT ships an MCP server so AI coding agents can manage tasks on your behalf. The MCP layer exposes structured tools for creating, querying, and updating tasks — agents never touch the raw files.

Available tools include `get_task`, `list_tasks`, `create_task`, `update_task`, `archive_task`, `link_tasks`, and more. See [docs/mcp-reference.md](docs/mcp-reference.md) for the full list and setup instructions.

## Usage

### Create a task

```bash
npx loctt create "Set up CI pipeline"
```

You can set fields right away:

```bash
npx loctt create "Fix login bug" --status in_progress --priority high --type bug
```

### List tasks

```bash
npx loctt list
```

Filter with the query language:

```bash
npx loctt list --query "status = in_progress and priority = high"
npx loctt list --query "text ~ CI"
```

Use a saved view:

```bash
npx loctt list --view recent-open
```

### View a task

```bash
npx loctt show T-1
```

### Update a task

Set any field:

```bash
npx loctt set T-1 status in_progress
npx loctt set T-1 priority high
npx loctt set T-1 assignee "ken"
```

Edit the task body (free-form markdown):

```bash
npx loctt body T-1 --set "## Notes\nNeed to check the auth middleware first."
```

Remove a field:

```bash
npx loctt unset T-1 priority
```

### Link tasks

```bash
npx loctt link T-2 blocks T-1
npx loctt link T-3 parent T-1
```

### Archive and delete

Archive is reversible:

```bash
npx loctt archive T-1
npx loctt unarchive T-1
```

Delete is permanent:

```bash
npx loctt delete T-1 --force
```

## Git Sync

Share tasks across clones by syncing to a dedicated branch:

```bash
npx loctt git enable     # Turn on git-backed mode
npx loctt publish        # Push task state to the loctt branch
npx loctt sync           # Pull task state from the loctt branch
```

Conflicts are handled through a reconciliation flow — see [docs/git-sync.md](docs/git-sync.md).

## Configuration

Everything is customizable in `.loctt/config/workflow.yaml`: statuses, priorities, task types, relationships, and custom fields. Saved queries live in `.loctt/config/queries.yaml`.

For the full details, see:

- [CLI reference](docs/cli-reference.md)
- [Schema reference](docs/dev/schema-reference.md)
- [Query language](docs/query-language.md)
- [Configuration guide](docs/configuration.md)
- [Architecture](docs/dev/architecture.md)

## License

MIT — see [LICENSE](LICENSE).
