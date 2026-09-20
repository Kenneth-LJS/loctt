# CLI Quick Start

Track a task from the terminal, start to finish. This assumes you have
already run `loctt init` — see the [Quick Start](quickstart.md) if not.

Every command here is covered in full in the [CLI reference](cli/reference.md).

## 1. Create a task

```bash
loctt create "Fix login crash" --priority high --type bug
```
```
Created WEB-1: Fix login crash
```

The key (`WEB-1`) is how you refer to the task everywhere else.

## 2. Give it shape

Set fields as the work develops:

```bash
loctt set WEB-1 status in_progress
loctt set WEB-1 assignee "Jordan"
```
```
Set status = in_progress on WEB-1
Set assignee = Jordan on WEB-1
```

Add a description to the body:

```bash
loctt body WEB-1 --append "Root cause: unhandled null in the auth callback."
```
```
Appended to body for WEB-1
```

> Field values are validated. `status`, `priority`, and `type` must be keys
> your workflow defines — run `loctt schema` to see them.

## 3. Find it again

List everything, or filter with a query:

```bash
loctt list --query "status = in_progress" --sort priority --dir desc
```
```
WEB-1  Fix login crash [in_progress]
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
LocTT UI running at http://localhost:5601
```

`WEB-1` is already there — with the status, assignee, and description you
set from the command line. Edit it in the browser and the next `loctt show
WEB-1` reflects the change.

## Next

- [CLI reference](cli/reference.md) — every command and flag.
- [Web UI Quick Start](quickstart-ui.md) — the same lifecycle in the app.
- [MCP Quick Start](quickstart-mcp.md) — let an agent do this.
