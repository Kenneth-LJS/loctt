# MCP Quick Start

Give an AI agent read/write access to your tracker. No API to build, no
glue code — you point an MCP client at LocTT and the agent has the whole
task surface. This assumes you have already run `loctt init` — see the
[Quick Start](../quickstart.md) if not.

Full tool details are in the [MCP reference](reference.md).

## 1. Connect your agent

LocTT's MCP server runs on stdio with one command:

```bash
loctt mcp
```

You do not run this yourself day to day — your MCP client launches it.
Register LocTT in the client's config, pointing `cwd` at the project that
holds your `.loctt/` tracker.

**Claude Desktop** — in `claude_desktop_config.json` (on macOS,
`~/Library/Application Support/Claude/`):

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

**VS Code (Claude Code extension)** — in your project's `.mcp.json`:

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

**Cursor** — via Settings → MCP Servers, or `.cursor/mcp.json`, with the
same shape.

`cwd` must be the project directory that contains `.loctt/` — the same
place you ran `loctt init`. That is how the server finds your tracker.

That is the entire setup. On connect, the agent receives the tool schemas
and a short set of instructions for using LocTT correctly — you do not
configure any of that. Ask it to "list my tasks" to confirm it is wired
up.

**If the agent doesn't see LocTT's tools**, the usual cause is that the
client can't find the `loctt` command: desktop apps often don't inherit
your shell's `PATH`. Use the binary's full path instead — run
`which loctt` to find it, then set `"command": "/full/path/to/loctt"`.
Check the tracker itself is reachable by running `loctt mcp` in the
project directory; it should start and wait (Ctrl-C to stop).

## 2. Ask the agent to create a task

Once connected, the agent works from plain requests:

```
You: Add a high-priority bug for the login crash.

Agent → get_workflow_config()          # learns the valid keys
Agent → create_task({ title: "Fix login crash",
                      priority: "high", task_type: "bug" })
     ← Created WEB-1: Fix login crash
```

The agent checks the workflow first so it writes the stored keys
(`high`, `bug`), not guessed labels.

## 3. Let it find and update work

```
You: What's in progress, and mark the login bug done.

Agent → list_tasks({ query: "status = in_progress" })
     ← [ { key: "WEB-1", title: "Fix login crash", … } ]
Agent → update_task({ ref: "WEB-1", field: "status", value: "done" })
     ← Updated WEB-1: set status = done
```

The agent changes tasks through structured tools — it never hand-edits the
files, so every change is validated and logged.

## 4. See it anywhere else

The task the agent created is the same task you see in the CLI and the web
UI. Check it from the terminal:

```bash
loctt show WEB-1
```

Or open the UI to watch the agent's work land in real time:

```bash
loctt ui
```

## What's next

- **The full agent surface** — every tool (links, sprints, milestones,
  projects, bulk edits, backup) and example flows: the
  [MCP reference](reference.md).
- **Set your agent's conventions** — how to tell an agent your status
  rules and naming: [Agent setup](agent-setup.md).
- **Understand the model** — [Concepts](../common/concepts.md).
- **Customize the workflow** — statuses, priorities, types, custom
  fields: [Configuration](../common/configuration.md).
- **Write sharper queries** — [Query language](../common/query-language.md).
- **Use another surface** — the same tasks from the
  [CLI](../cli/quickstart.md) or the [web UI](../ui/quickstart.md).
