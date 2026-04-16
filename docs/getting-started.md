# Getting Started

## Installation

Requires Node.js >= 20.

```bash
git clone <repo-url>
cd loctt
npm install
npm run build
```

Run CLI commands with:

```bash
npx loctt <command>
```

## Initialize a Tracker

```bash
loctt init
```

This creates a `.loctt/` directory with default configuration and optional helper docs. Use `--prefix` to customize the key prefix (default: `T-`).

```bash
loctt init --prefix BUG-
```

## Create Tasks

```bash
loctt create "Set up CI pipeline"
# Created T-1: Set up CI pipeline

loctt create "Write unit tests" --priority high --status in_progress
# Created T-2: Write unit tests
```

## List and View Tasks

```bash
loctt list
# T-1  Set up CI pipeline
# T-2  Write unit tests [in_progress]

loctt show T-2
# T-2: Write unit tests
# Status: in_progress
# Priority: high
```

## Update Tasks

```bash
loctt set T-1 status in_progress
loctt set T-1 priority medium
loctt set T-1 assignee "alice"
loctt unset T-1 assignee
```

## Edit Task Body

```bash
loctt body T-1 --set "Need to configure GitHub Actions for lint, test, build."
loctt body T-1
# Need to configure GitHub Actions for lint, test, build.
```

## Link Tasks

```bash
loctt link T-2 blocks T-1
# Linked T-2 --blocks--> T-1

loctt unlink T-2 blocks T-1
```

## Query Tasks

```bash
loctt list --query "status = in_progress and priority = high"
loctt list --query "text ~ CI"
loctt list --view recent-open
```

See [query-language.md](query-language.md) for full query syntax.

## Archive and Delete

```bash
loctt archive T-1          # Safe, reversible
loctt unarchive T-1        # Restore
loctt delete T-1 --force   # Permanent
```

## Check Tracker Health

```bash
loctt info      # Task count, key prefix, next key
loctt doctor    # Diagnostic checks
```

## What's Next

- [Configuration](configuration.md) — customize statuses, priorities, task types, relationships
- [CLI Reference](cli-reference.md) — full command reference
- [Query Language](query-language.md) — filtering and saved views
- [Git Sync](git-sync.md) — sync tasks across machines
- [MCP Reference](mcp-reference.md) — AI agent integration
