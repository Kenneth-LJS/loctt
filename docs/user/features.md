# Features

What LocTT can do, and how to reach each capability from each interface.
If you haven't yet, skim [Concepts](common/concepts.md) first — this page
assumes you know what `.loctt/` is and how it's shared.

**Interfaces:** **CLI** (`loctt`), **MCP** (agent tools), **UI** (the web
app at `loctt ui`).

---

## Support at a glance

| Feature | CLI | MCP | UI |
|---|---|---|---|
| [Tasks](#tasks) | ✅ | ✅ | ✅ |
| [Markdown body](#markdown-body) | ✅ | ✅ | ✅ |
| [Relationships](#relationships) | ✅ | ✅ | ✅ |
| [Attachments](#attachments) | ✅ | ✅ | ✅ |
| [Comments](#comments) | ✅ | ✅ | ✅ |
| [Activity log](#activity-log) | ✅ | ✅ | ✅ |
| [Archive and delete](#archive-and-delete) | ✅ | ✅ | ✅ |
| [Query language](#query-language) | ✅ | ✅ | ✅ |
| [Saved views](#saved-views) | ✅ | ✅ | ✅ |
| [Sorting and pagination](#sorting-and-pagination) | ✅ | ✅ | ✅ |
| [Projects](#projects) | ✅ | ✅ | ✅ |
| [Users](#users) | ✅ | ✅ | ✅ |
| [Labels](#labels) | ✅ | ✅ | ✅ |
| [Sprints](#sprints) | ✅ | ✅ | ✅ |
| [Milestones](#milestones) | ✅ | ✅ | ✅ |
| [Custom fields](#custom-fields) | ✅ | ✅ | ✅ |
| [Configurable workflow](#configurable-workflow) | read | read | ✅ |
| [Calendar](#calendar) | read | read | ✅ |
| [Git sync](#git-sync) | ✅ | ✅ | ✅ |
| [Diagnostics](#diagnostics-and-migration) | ✅ | ✅ | ✅ |
| [Migration](#diagnostics-and-migration) | ✅ | ✅ | ❌ |

✅ full support · *read* = read-only · ❌ not available

The web UI ships list, board, and timeline views. Schema migration is
CLI- and MCP-only; everything else is available in the browser.

---

## Tasks

The core unit. Every task has a stable ULID `id`, a human-friendly `key`
(`T-1`), a title, a status, and a free-form markdown body. Optional fields
include priority, type, assignee, reporter, start date, due date, parent,
custom fields, labels, sprints, milestones, and attachments.

**CLI** — `loctt create "Title"` prints the new key:

```bash
loctt create "Set up CI pipeline"
loctt create "Fix login bug" --status in_progress --priority high --type bug
loctt set T-1 status in_progress
loctt unset T-1 priority
```

**MCP** — `create_task`, `get_task`, `list_tasks`, `update_task`,
`unset_field`. Validation happens server-side, so an agent cannot write an
invalid status or unknown priority.

**UI** — list, board, and timeline views, a create modal, a task detail
panel, and inline field edits.

## Markdown body

Free-form markdown. Descriptions, notes, checklists, code snippets — no
schema. Append is separate from replace so collaborators and agents don't
clobber each other's notes.

**CLI** — `loctt body T-1` prints; `--set` replaces; `--append` adds:

```bash
loctt body T-1 --set "## Plan\nWire up GitHub Actions."
loctt body T-1 --append "\nFollow-up: cache npm install."
```

**MCP** — `append_task_body` (safe for collaborative use) and
`replace_task_body` (overwrites entirely — treat as destructive). Reading
happens via `get_task`.

**UI** — a rich markdown editor with a formatting toolbar, rendered and
raw modes, autosave, and a conflict dialog when someone else edited the
task while you were writing.

## Relationships

Typed, directed links between tasks: `blocks`, `parent`, `clones`,
`duplicates`, `causes`, `relates_to`, plus any custom kind you define in
`workflow.yaml`. Links are stored by ULID, so they survive renames and key
reassignment.

**CLI** — `loctt link <from> <kind> <to>`, `loctt unlink`, `loctt rerank`:

```bash
loctt link T-2 blocks T-1
loctt link T-3 parent T-1
```

**MCP** — `link_tasks`, `unlink_tasks`, `reorder_relationship`. Discover
the configured kinds with `get_workflow_config`.

**UI** — a relationships panel on the task detail view, with a link
picker and a tree display for hierarchical kinds.

## Attachments

Attach files to a task — screenshots, logs, spec PDFs. Files are stored
under the task's directory in `.loctt/` and travel with the task.

**CLI** — `loctt attach T-1 ./error.log`, `loctt detach T-1 error.log`.

**MCP** — `attach_file`, `detach_file`.

**UI** — an attachments panel with upload, download, detach, and inline
image previews.

> **Security note.** Over MCP, `attach_file` refuses a `source_path` that
> resolves outside the tracker root — stage the file inside the tracker
> first, then attach it by its path there. The CLI `loctt attach`, run by
> a person at a terminal, is not confined. See
> [the MCP reference](mcp/reference.md#attach_file).

## Comments

Discussion on a task, separate from the body, with `@`-mentions and edit
provenance (the original author is preserved and the editor recorded).
LocTT has no roles, so anyone may edit or delete any comment.

**CLI** — `loctt comment`, `loctt comments`, `loctt comment-edit`,
`loctt comment-delete`.

**MCP** — `list_comments`, `post_comment`, `edit_comment`,
`delete_comment`.

**UI** — a comments panel with a composer, an `@`-mention menu, and
inline editing.

## Activity log

Every meaningful change is recorded — field updates, link changes, body
edits, archive and unarchive, label and assignment changes — with
timestamps and actor.

**CLI** — `loctt log T-1`.

**MCP** — `get_task_history`.

**UI** — an activity timeline on the task detail view.

## Archive and delete

Archive is a soft delete: hidden from default lists, fully restorable.
Delete is permanent and requires explicit confirmation. Archive is the safe
default for "I'm done with this."

```bash
loctt archive T-1      # reversible
loctt unarchive T-1
loctt delete T-1 --yes   # permanent
```

**MCP** — `archive_task` / `unarchive_task` / `delete_task`. Agents should
not call `delete_task` without explicit instruction.

**UI** — archive, unarchive, and delete from the task detail view; delete
confirms first.

By default, lists omit archived tasks; pass `--archived` (CLI) or the
equivalent flag to include them.

## Query language

Filter with expressions like `status = in_progress and priority = high` or
`text ~ login`. Comparison operators, boolean logic, parentheses, and text
search. Full grammar in [query-language.md](common/query-language.md).

The same grammar works on every interface — a query that runs in the CLI
runs in the UI's filter bar and in `list_tasks`.

**Global search** (`GET /api/search?q=…`) is the same grammar rather than
a second engine: it builds `text ~ "<q>"` and runs the ordinary
evaluator, so the search box and a hand-typed query cannot disagree. It
searches the title, built-in text fields, the task body, and custom
fields declared `searchable: true`. There is no full-text index — the
corpus is a directory of markdown files.

## Saved views

Named queries stored in `.loctt/config/queries.yaml` and invoked by name.

**CLI** — `loctt views` (create, edit, archive, delete) and
`loctt list --view my-tasks` to run one. **MCP** — `list_views`,
`create_view`, `edit_view`, `archive_view`, `delete_view`, and a `view`
parameter on `list_tasks`. **UI** — create, save, and manage views, with
a visual query builder. Hand-editing `queries.yaml` works on any
interface.

## Views

The web UI presents tasks three ways — a list, a board, and a timeline —
and they share one filter scope. The same filter bar sits on all three,
so a query, a project scope, or a saved view carries across when you
switch between them; each view keeps its own display settings (the list's
sort and page, the board's columns, the timeline's zoom, grouping, and
arrows).

The **timeline** is a Gantt-style chart. Bars run from each task's start
date to its due date, and the chart fills the panel at day, week, or
month zoom. It is filterable and project-scopable through the shared
filter bar, and it groups rows into labelled bands by none, project,
milestone, sprint, assignee, status, priority, type, or any single-value
enum custom field — chosen from a searchable group-by picker. Weekends
and holidays are shaded from `calendar.yaml`, dependency arrows are drawn
for the relationship named in `workflow.timeline.dependency_relationship`,
and you can drag a bar to reschedule it or resize it to change one date.
Tasks missing a start or due date, or carrying a bad date, collect in an
**Unscheduled** drawer below the chart. The drawer stays collapsed with a
header that counts the unscheduled tasks and breaks them down by reason
(undated, due-only, corrupt); it expands on demand, and opens on its own
when no task has both dates so there is nothing to chart.

## Sorting and pagination

Sort by any field and page through large result sets on every interface.

**CLI** — `loctt list --sort <field> --dir asc|desc --offset <n>`.
**MCP** — `sort`, `direction`, and `offset` on `list_tasks`. **UI** —
column sorting and paging in the list view.

## Projects

One tracker, multiple projects. Each has its own key prefix (`BACKEND-`,
`WEB-`) and counter. Useful for monorepos, or separating client work from
internal work.

**CLI / MCP / UI** — full CRUD plus archive, unarchive, and a
default-project setting (Settings → Projects in the UI).

Projects are addressed by ULID `id` internally; `name` is a mutable display
label and is not unique.

Prefixes **are** unique across projects, since they partition the key space.
Changing one renames every task in the project (`T-3` → `WEB-3`, numbers
preserved), with old keys kept in `key_history` so existing references keep
resolving — so it is a deliberate operation, `loctt project set-prefix`,
rather than an ordinary field edit. The same operation is available to
agents as the MCP tool `set_project_prefix` and over HTTP as
`PUT /api/projects/:id/prefix`; all three confirm before rewriting, and
all three refuse a prefix another project already holds.

## Users

Profiles with name, email, timezone, and avatar, used for assignee and
reporter. Switching the current user changes who appears as the actor on
log entries. Users can be archived without breaking tasks referencing them.

**CLI / MCP / UI** — full CRUD, archive, and switch (Settings → Users in
the UI). `get_current_user` is worth calling before handling "my tasks"
requests rather than asking the user to type their name.

> The current user is global tracker state, not a per-session identity —
> switching affects every interface at once.

## Labels

Optional colour-coded tags. Flat, no hierarchy, configurable per
workspace.

**CLI / MCP** — manage labels themselves with the label commands/tools;
apply them to a task by setting the `labels` field. **UI** — manage
labels in Settings and apply them from the task detail view.

## Sprints

Time-boxed groupings with a name, dates, and a state (`future`, `active`,
`completed`). LocTT performs no automatic state transitions and no
carryover — state is a label you set.

Tasks reference a sprint by its ULID `id`, so renaming a sprint never
detaches its tasks. Progress rollups (done/total, computed from status
category, discarded tasks excluded) come from `loctt sprint list
--progress`, the `progress` option on `list_sprints`, and the UI; sprint
burndown is available on the CLI (`loctt sprint burndown`), MCP
(`get_sprint_burndown`), and the timeline view.

**CLI / MCP** — full sprint CRUD, archive, and progress. **UI** — sprint
list and detail views.

## Milestones

Target-date-driven groupings for releases and deliverables.

Progress rollups (done/total, computed from status category, discarded
tasks excluded) come from `loctt milestone list --progress`, the
`progress` option on `list_milestones`, and the UI.

**CLI / MCP** — full milestone CRUD, archive, and progress. **UI** —
milestone list and detail views.

## Custom fields

Define your own fields in `workflow.yaml` — `severity`, `customer`,
`estimate`. They have types and validation, and participate in the query
language like built-in fields.

Agents discover them via `get_workflow_config` and set them via
`update_task`; no separate tool is needed.

**UI** — declare and edit custom fields in Settings → Custom fields, and
set values from the task detail view.

## Configurable workflow

Statuses, priorities, task types, and relationship kinds live in
`.loctt/config/workflow.yaml`. Add a `blocked_external` status, a
`severity` scale, a `spike` type — the vocabulary is yours. See
[configuration.md](common/configuration.md).

**Agents should call `get_workflow_config` at the start of a session** so
they use the workspace's actual vocabulary rather than assuming defaults.

**UI** — Settings → Workflow edits statuses, priorities, task types,
relationships, custom fields, and estimation. The CLI and MCP read the
workflow (`loctt schema`, `get_workflow_config`) but do not write it;
edit `workflow.yaml` directly or use the UI.

## Calendar

Per-workspace timezone, working days, and holidays.

**CLI** — `loctt calendar show`. **MCP** — `get_calendar`, useful when
reasoning about due dates or "by end of week". **UI** — edit the calendar
in Settings → Calendar.

> Read-only from the CLI and MCP; edit it in the UI or in
> `calendar.yaml` directly.

## Git sync

Optional mode publishing tracker state to a dedicated `loctt` branch
(configurable via `git.branch`), separate from your code history. See
[git-sync.md](common/git-sync.md) for operations, or
[concepts.md](common/concepts.md) for the mental model.

**CLI** — `loctt git enable|disable|status|publish|sync|reconcile`.
**MCP** — `enable_git`, `disable_git`, `get_git_status`, `publish_to_git`,
`sync_from_git`, `get_reconcile_status`. **UI** — Settings → Sync, with a
reconcile panel and a rekey preview.

Sync compares the branch against your local state using the last synced
commit as a base. Where both sides changed the same file, it stops and
names the conflict rather than picking a winner.

The branch name is configurable — `loctt config set git.branch my-tasks` —
and every operation follows it. Publishing to a branch that already holds
unrelated content is refused rather than overwriting it.

## Diagnostics and migration

`loctt doctor` checks tracker integrity — missing files, invalid configs,
inconsistent state. `loctt migrate` upgrades the tracker schema between
LocTT versions; pass `--dry-run` to preview.

**MCP** — `doctor`, `info`, and `migrate_schema` (call it without
`confirm` to preview the plan first).

**UI** — a data-integrity badge that links to Settings → Diagnostics,
which streams the same checks `loctt doctor` runs. Schema migration is
CLI- and MCP-only.

## Configuration values

Machine-local settings such as git sync options, distinct from the
workspace workflow.

**CLI** — `loctt config get|set|unset|list`. **MCP** —
`list_config_values`, `get_config_value`, `set_config_value`,
`unset_config_value`.
