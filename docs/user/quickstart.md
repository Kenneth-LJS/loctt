# Quick Start

LocTT keeps your tasks as plain markdown files in a `.loctt/` folder in
your repo. There is nothing to sign up for, no service to run, and no lock-in
— the data is yours, readable, and versioned alongside your code.

You work with those tasks through three surfaces, over the one store:

- **[CLI](quickstart-cli.md)** — `loctt` in your terminal.
- **[AI agent (MCP)](quickstart-mcp.md)** — let an agent read and write
  tasks through built-in tools, no API to build.
- **[Web UI](quickstart-ui.md)** — a local app for browsing, boards, and
  timelines.

They are complementary, not alternatives. Create a task from the CLI or an
agent and it shows up in the web UI; drag it on a board and the CLI sees
the change. Pick whichever surface fits the moment.

## Install

```bash
npm install -g @loctt/cli
```

This installs the `loctt` command. Requires Node.js 20 or newer. The MCP
server is built in — `loctt mcp` runs it, with nothing extra to install.

## Set up your tracker (once)

Run this once, in the repo where you want tasks to live:

```bash
loctt init
```

This creates `.loctt/` — the folder that holds your tasks, workflow config,
and state. Commit it with your code. That is the whole setup; everything
below reads and writes this one directory.

```bash
loctt init --prefix WEB --project-label "Web App"
```

Use `--prefix` to choose the key prefix for the first project (tasks become
`WEB-1`, `WEB-2`, …) and `--project-label` to name it.

## Introduce yourself

Create a user and make it the current one:

```bash
loctt user create "Your Name" --switch
```

This is who your tasks get assigned to and who your comments are posted as.
Filters like "assigned to me" and the `currentUser()` query need a current
user to resolve, so it's worth doing before you start.

## Then pick a surface

| You want to… | Start here |
|---|---|
| Work from the terminal | [CLI Quick Start](quickstart-cli.md) |
| Give an AI agent access | [MCP Quick Start](quickstart-mcp.md) |
| Browse, filter, and drag on a board | [Web UI Quick Start](quickstart-ui.md) |

Whichever you choose, you can always open another to see the same tasks —
that is the point of one plain-text store.

## Where the data lives

A task is a single markdown file: YAML frontmatter for the metadata, a
markdown body for the description.

```
.loctt/
  tasks/<id>/task.md      # one task: frontmatter + body
  config/workflow.yaml    # statuses, priorities, types, relationships
  config/queries.yaml     # saved views
  state.yaml              # key allocation and workspace state
```

```markdown
---
key: WEB-1
title: Fix login crash
status: in_progress
priority: high
---
Steps to reproduce…
```

`cat` it, `grep` it, diff it in a pull request. It is just files.

## Next

- [CLI reference](cli/reference.md) — every command and flag.
- [MCP reference](mcp/reference.md) — the agent tools.
- [Web UI guide](ui/guide.md) — the app in depth.
