# CLI Quick Start

Track a task from the terminal, start to finish. This assumes you have
already run `loctt init` — see the [Quick Start](../quickstart.md) if not.

Every command here is covered in full in the [CLI reference](reference.md).

## 1. Create a task

```bash
loctt create "Fix login crash" --priority high --type bug
```
```
Created T-1: Fix login crash
```

`T-1` is the task's **key** — how you refer to it in every other command.
The `T` prefix comes from your project; `loctt init --prefix WEB` would
number tasks `WEB-1`, `WEB-2`, and so on instead.

## 2. Give it shape

Set fields as the work develops:

```bash
loctt set T-1 status in_progress
loctt set T-1 assignee "Jordan"
```
```
Set status = in_progress on T-1
Set assignee = Jordan on T-1
```

Add a description to the body:

```bash
loctt body T-1 --append "Root cause: unhandled null in the auth callback."
```
```
Appended to body for T-1
```

## 3. Find it again

List everything, or filter with a query:

```bash
loctt list --query "status = in_progress" --sort priority --dir desc
```
```
T-1  Fix login crash [in_progress]
```

Save a filter you use often as a view, then run it by name:

```bash
loctt views create "My open bugs" --query "type = bug and status != done"
loctt list --view "My open bugs"
```

## 4. See it anywhere else

The task you just created from the terminal is the same task the web UI and
an agent see. Open the UI:

```bash
loctt ui
```
```
LocTT UI running at http://localhost:4321
```

`T-1` is already there — with the status, assignee, and description you
set from the command line. Edit it in the browser and the next `loctt show
T-1` reflects the change.

## What's next

You now have the task lifecycle. From here:

- **Do more from the CLI** — links, sprints, milestones, projects, bulk
  edits, export, backup: the [CLI reference](reference.md).
- **Understand the model** — how tasks, keys, and projects fit together:
  [Concepts](../common/concepts.md).
- **Customize the workflow** — statuses, priorities, types,
  relationships, custom fields: [Configuration](../common/configuration.md).
- **Write sharper queries** — the filter language behind `--query` and
  saved views: [Query language](../common/query-language.md).
- **Share across machines** — [Git-backed mode](../common/git-sync.md).
- **Use another surface** — the same tasks in the
  [web UI](../ui/quickstart.md) or driven by an [AI agent](../mcp/quickstart.md).
