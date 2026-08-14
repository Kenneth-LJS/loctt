# Getting Started

New to LocTT? Read [Concepts](concepts.md) first for a quick mental model of how it works — where your data lives, how (and whether) it syncs, and what's configurable. This page covers the hands-on basics.

## Installation

Requires Node.js >= 20.

```bash
npm install -g @loctt/cli
```

> **From source:** Clone the repo, run `npm install && npm run build`, then `npm link` to make the `loctt` command available globally.

## Initialize a Tracker

In your project directory:

```bash
loctt init
```

This creates a `.loctt/` directory with default configuration. Use `--prefix` to customize the key prefix (default: `T-`).

```bash
loctt init --prefix BUG-
```

## Git and `.gitignore`

Whether to commit `.loctt/` depends on your setup:

**Committing `.loctt/` (shared tasks):** If your team should see the tasks, commit the directory. This works well for small teams or solo projects where tasks are part of the repo.

**Using git sync instead:** If you enable [git sync](git-sync.md), task data lives on a dedicated `loctt` branch — not in your working tree. In this case, add `.loctt/` to `.gitignore` so the local working copy doesn't get committed to your main branch:

```gitignore
.loctt/
```

**Purely local (no sharing):** If tasks are just for you and you don't need them versioned, add `.loctt/` to `.gitignore`.

Pick one approach and be consistent. You can always switch later.

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

## Web UI

LocTT includes a browser-based interface for visual task management.

```bash
loctt ui
# Serves on http://localhost:4321 and opens your browser
# Pass --no-open to skip the browser launch; --port <n> to override the port
```

The web UI reads and writes the same `.loctt/` data as the CLI and MCP server — all three interfaces stay in sync.

## MCP Setup (AI Agent Integration)

LocTT ships an MCP server so AI coding agents (Claude Code, Cursor, etc.) can manage tasks on your behalf using structured tools instead of raw CLI commands.

### Claude Desktop

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

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

### VS Code (Claude Code extension)

Add to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "loctt": {
      "command": "loctt",
      "args": ["mcp"],
      "cwd": "${workspaceFolder}"
    }
  }
}
```

### Cursor

Add via Cursor Settings → MCP Servers, or add to `.cursor/mcp.json`:

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

### Verifying

Once configured, your AI agent should be able to discover loctt tools automatically. Try asking it to "list my tasks" or "create a task" — it should use the MCP tools rather than shelling out to the CLI.

See [mcp-reference.md](../mcp/reference.md) for the full list of available tools.

## Configuring Your AI Agent

After setting up MCP, you may want to give your AI agent project-specific workflow instructions — things like status transition rules, task description conventions, and query patterns.

See [agent-setup.md](../mcp/agent-setup.md) for a guide and template.

## What's Next

- [Configuration](configuration.md) — customize statuses, priorities, task types, relationships
- [CLI Reference](../cli/reference.md) — full command reference
- [Query Language](query-language.md) — filtering and saved views
- [Git Sync](git-sync.md) — sync tasks across machines
- [MCP Reference](../mcp/reference.md) — AI agent tool reference
- [Agent Setup](../mcp/agent-setup.md) — configuring AI agent workflow instructions
- [Uninstall](uninstall.md) — removing LocTT from a project
