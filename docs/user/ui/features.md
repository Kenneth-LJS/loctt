# Web UI features

A narrative tour of LocTT features through the web UI. For the same features through other interfaces, see [Features](../features.md).

Start the UI with `loctt ui`. By default it serves on [http://localhost:4321](http://localhost:4321) and opens a browser window. Press Ctrl-C in the terminal to stop. Pass `--no-open` to skip the browser launch, or `--port <n>` to use a different port.

The UI reads and writes the same `.loctt/` data as the CLI and MCP server — all three stay in sync, even if you have them open at once.

## Tasks

The main views are a **board** (Kanban-style columns by status) and a **list** (sortable, filterable rows). Both show the same tasks; switch with the toggle in the top bar.

Create a task with the **+ New task** button. A side panel slides in with fields for title, status, priority, type, assignee, dates, labels, sprint, milestone, parent, and custom fields. The title is the only required field — everything else can be added later.

Clicking a task on the board or list opens a detail panel: full frontmatter on the left, markdown body on the right. Inline editing — click a field, change it, click away to save.

## Markdown body

The body has two modes: **rendered** (default, shows formatted markdown) and **edit** (raw text). Switch with the pencil icon. The editor supports the standard markdown shortcuts; what you type is what gets stored in the file.

Concurrent edits are append-friendly — the UI fetches the latest body before saving, so a teammate's just-added notes won't be silently overwritten. If a conflict is detected, you're shown both versions and asked which to keep.

## Relationships

The detail panel has a **Relationships** section showing all incoming and outgoing links grouped by kind (`blocks`, `parent`, `relates_to`, custom kinds). Add a link with **+ Add link**, pick the kind, then start typing a task title or key to autocomplete the target.

Drag-and-drop on the board to reorder subtasks under a parent — the order is persisted via the relationship rank.

## Attachments

The detail panel has an **Attachments** section. Drag files in from your desktop or click **Upload** to browse. Each attachment shows a thumbnail (for images) or an icon, with the filename and size. Click to download; the trash icon detaches and deletes.

## Comments

Comments show their author and timestamp. **Anyone can edit or delete anyone's comment** — LocTT is local and unauthenticated, and you switch identity from a menu, so there is no ownership to enforce.

Edits are attributed instead. A comment edited by someone else keeps its original author and gains an "Edited by …" note listing the editors; editing your own comment shows a plain "Edited". Every comment added, edited, or deleted also appears in the activity log with who did it, so an unexpected change is traceable.

## Activity log

The **Activity** tab in the detail panel shows the task's full audit trail in reverse-chronological order: who did what, when. Field changes show before-and-after values. Link, body, archive, comment, and assignment events each have their own iconography so the log scans quickly.

Comment entries record that a comment was added, edited, or deleted, and by whom — never the comment text itself, so the log doesn't become a second copy of the conversation. When someone edits another person's comment, the entry names both.

## Archive and delete

The **⋯ menu** in the detail panel header offers:

- **Archive** — soft-delete; the task disappears from default views but is restorable.
- **Delete…** — opens a confirmation dialog requiring you to type the task key to confirm.

Archived tasks live under a **Archived** filter in the list view. From there, **Unarchive** restores them in place.

## Query language

The list view's search box accepts the full query language. Hit enter to run; the URL updates so you can bookmark or share the filtered view. A small **Query help** popover summarizes the grammar; full docs are at [query-language.md](../common/query-language.md).

Errors are surfaced inline — if you type an unknown field, the UI highlights the offending token rather than silently returning no results.

## Saved views

A **Views** sidebar lists everything from `.loctt/config/queries.yaml`. Click a view to apply it. Saving a new view from the UI writes back to `queries.yaml`, so views created in the UI are available from the CLI and MCP too.

## Projects

A **Project** switcher in the top bar picks the active project. Boards, lists, and the new-task form scope to the active project. To see tasks across projects, set the switcher to **All projects**.

Project management (create, rename, archive, set default) lives in **Settings → Projects**.

## Users

The top-right user menu shows the current user and lets you switch. Activity logged while you act as a user is attributed to them.

User management is in **Settings → Users** — name, email, timezone, avatar upload. Archived users are kept around so their attribution on old tasks doesn't break.

## Labels

Labels render as coloured pills on task cards and rows. Click a label to filter the current view to tasks with that label. Manage labels (create, recolour, archive) in **Settings → Labels**.

## Sprints

The **Sprints** view shows each sprint as a column with its tasks listed inside. Active sprints are highlighted; future and completed sprints are collapsed by default. Drag tasks between sprints to reassign.

Sprint definitions (name, dates, state) are edited in **Settings → Sprints**.

## Milestones

**Milestones** view shows each milestone with its target date and a progress bar (tasks done / total). Click into a milestone for the task list. Edit milestones in **Settings → Milestones**.

## Custom fields

Custom fields appear automatically in the task detail panel and in the new-task form. Field type (string, number, enum, date, etc.) determines the input control rendered. They also appear as filterable columns in the list view and as predicates in the query language.

To add or edit a custom field, edit `.loctt/config/workflow.yaml`. The UI picks up changes on next refresh.

## Configurable workflow

**Settings → Workflow** shows the current statuses, priorities, task types, and relationship kinds in a read-only view, mirroring `workflow.yaml`. Edits happen by editing the YAML file directly — workflow changes are intentional and reviewable.

## Calendar

**Settings → Calendar** shows workspace timezone, working days, and holidays. Date pickers throughout the UI respect these settings — non-working days are visually marked, and "X working days from today" calculations use the calendar.

## Git sync

**Settings → Git sync** has the controls:

- **Enable / Disable** — turn git-backed mode on or off
- **Publish** — push local state to the `loctt` branch
- **Sync** — pull remote state
- **Status** — last synced commit, drift indicators

When a publish or sync detects conflicting concurrent edits, the UI opens a reconciliation panel: a list of conflicting fields with both sides shown and a "keep local / keep remote / pick value" choice per row. Click **Apply** to commit the reconciliation. See [git-sync.md](../common/git-sync.md) for the underlying model.

## Backup and restore

**Settings → Backup & restore** is the web surface for the whole-tracker JSONL backup — the same one `loctt backup` / `loctt restore` and the MCP `backup` / `restore` tools produce. This is the *real* backup: it carries task bodies, comments, attachments, history, config, users, and key state, so it can rebuild a tracker from nothing. The CSV/JSON task export (from a list view) is a report for a spreadsheet and **cannot** restore.

- **Export** — a **Download backup** button streams the whole tracker as a single `.jsonl` file. History is included; machine-local files (user settings and recents) are deliberately excluded.
- **Restore** — pick a backup file, choose a mode, and restore:
  - **bare** — only writes into an empty tracker; refuses one that already has tasks.
  - **merge** — adds only the ids missing here; never edits a task that is present.
  - **overwrite** — replaces any task the backup carries. This can lose work, so it is gated behind a typed **OVERWRITE** confirmation; displaced bodies are kept beside the task and named in the result.
  - **Preview (dry run)** predicts the counts and writes nothing, in any mode.

A restore reports per-outcome counts and any key reallocations, renamed entities, or malformed lines skipped. It refuses a backup from a newer LocTT, a malformed file, or a tracker mid prefix-rename or migration — and nothing is written when it refuses. A **split** backup (taken with parts) must be restored with the `loctt restore` CLI, which takes every part at once.

## Diagnostics and migration

**Settings → Diagnostics** runs the equivalent of `loctt doctor` and shows results inline. If a schema migration is needed (e.g. after upgrading LocTT), a banner appears at the top of the page with a **Preview migration** action that opens a diff of what would change.
