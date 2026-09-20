# Web UI Quick Start

Browse, filter, and manage tasks in a local app. This assumes you have
already run `loctt init` — see the [Quick Start](quickstart.md) if not.

The full app is covered in the [Web UI guide](ui/guide.md).

## 1. Open the app

```bash
loctt ui
```
```
LocTT UI running at http://localhost:4321
```

It opens in your browser. The app runs on your machine and reads the same
`.loctt/` directory the CLI uses.

<!-- [screenshot: the List view on first open, with the sidebar] -->

## 2. Create a task

Click **New task** in the top bar. Fill in a title, set status, priority,
and type, and add a description. Save.

<!-- [screenshot: the create-task modal with fields filled in] -->

## 3. Find and organize

- The **List** is your default view — sort by any column, and use the
  filter bar to narrow by status, priority, assignee, and more.
- Switch to **Board** (left sidebar) to see tasks as columns by status, and
  drag cards between them.
- Switch to **Timeline** to see dated tasks on a schedule.

Save a filter you reuse as a view with **Save as view**; it appears under
**Saved filters** in the sidebar.

<!-- [screenshot: the List view with active filter chips in the filter bar] -->

## 4. See it anywhere else

Everything here is the same store the CLI and an agent use. A task you drag
to a new column shows its new status in `loctt show`, and a task created
from `loctt create` appears in this list without a refresh step beyond
reloading the view.

## What's next

- **Every screen in depth** — board, timeline, task detail, settings:
  the [Web UI guide](ui/guide.md).
- **Understand the model** — [Concepts](common/concepts.md).
- **Customize the workflow** — statuses, priorities, types, custom
  fields, board columns: [Configuration](common/configuration.md).
- **Write sharper queries** — the language behind the filter bar's
  advanced editor: [Query language](common/query-language.md).
- **Share across machines** — [Git-backed mode](common/git-sync.md).
- **Use another surface** — the same tasks from the
  [CLI](quickstart-cli.md) or driven by an [AI agent](quickstart-mcp.md).
