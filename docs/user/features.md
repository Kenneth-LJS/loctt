# Features

What LocTT can do, and how to reach each capability from each interface.
If you haven't yet, skim [Concepts](common/concepts.md) first — this page
assumes you know what `.loctt/` is and how it's shared.

**Interfaces:** **CLI** (`loctt`), **MCP** (agent tools), **UI** (the web
app at `loctt ui`).

> The support matrix below reflects what is wired up today. The web UI is
> mid-build — [ui/features.md](ui/features.md) describes the full UI.

---

## Support at a glance

| Feature | CLI | MCP | UI |
|---|---|---|---|
| [Tasks](#tasks) | ✅ | ✅ | list only |
| [Markdown body](#markdown-body) | ✅ | ✅ | planned |
| [Relationships](#relationships) | ✅ | ✅ | planned |
| [Attachments](#attachments) | ✅ | ✅ | planned |
| [Comments](#comments) | ❌ | ❌ | planned |
| [Activity log](#activity-log) | ✅ | ✅ | planned |
| [Archive and delete](#archive-and-delete) | ✅ | ✅ | planned |
| [Query language](#query-language) | ✅ | ✅ | ✅ |
| [Saved views](#saved-views) | run only | run only | ✅ |
| [Sorting](#sorting-and-pagination) | ❌ | ❌ | ✅ |
| [Projects](#projects) | ✅ | ✅ | switch only |
| [Users](#users) | ✅ | ✅ | switch only |
| [Labels](#labels) | ✅ | ✅ | planned |
| [Sprints](#sprints) | ✅ | ✅ | planned |
| [Milestones](#milestones) | ✅ | ✅ | planned |
| [Custom fields](#custom-fields) | ✅ | ✅ | planned |
| [Configurable workflow](#configurable-workflow) | read | read | planned |
| [Calendar](#calendar) | read | read | planned |
| [Git sync](#git-sync) | ✅ | ✅ | planned |
| [Diagnostics](#diagnostics-and-migration) | ✅ | ✅ | planned |
| [Migration](#diagnostics-and-migration) | ✅ | ❌ | ❌ |

✅ full support · *read* = read-only · *run only* = can use but not create
· ❌ not available · *planned* = specified, not built

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

**UI** — the list view at `/list`. Detail, create modal, and inline edits
are planned.

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

## Attachments

Attach files to a task — screenshots, logs, spec PDFs. Files are stored
under the task's directory in `.loctt/` and travel with the task.

**CLI** — `loctt attach T-1 ./error.log`, `loctt detach T-1 error.log`.

**MCP** — `attach_file`, `detach_file`.

> **Security note.** `attach_file` accepts any absolute path the MCP server
> process can read — including paths outside the repo. **Do not
> auto-approve `attach_file` calls** in your agent's permission settings.
> See [agent-setup.md](mcp/agent-setup.md#permissions-and-auto-approval).

## Comments

Threaded discussion on a task, separate from the body, with edit
provenance.

> **Not available on any interface yet.** The storage layer exists, but no
> CLI command, MCP tool, or HTTP endpoint reaches it. Use the markdown body
> for now.

## Activity log

Every meaningful change is recorded — field updates, link changes, body
edits, archive and unarchive, label and assignment changes — with
timestamps and actor.

**CLI** — `loctt log T-1`.

**MCP** — `get_task_history`.

## Archive and delete

Archive is a soft delete: hidden from default lists, fully restorable.
Delete is permanent and requires explicit confirmation. Archive is the safe
default for "I'm done with this."

```bash
loctt archive T-1      # reversible
loctt unarchive T-1
loctt delete T-1 --force   # permanent
```

**MCP** — `archive_task` / `unarchive_task` / `delete_task`. Agents should
not call `delete_task` without explicit instruction.

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

**CLI** — `loctt list --view my-tasks`. **MCP** — `list_views`, and a
`view` parameter on `list_tasks`. **UI** — create, save, and manage views.

> Creating and editing views is currently UI-only; the CLI and MCP can run
> saved views but not define them. Hand-editing `queries.yaml` works on any
> interface.

## Sorting and pagination

The UI and HTTP API support sorting by any field and paging through large
result sets.

> Not exposed on the CLI (`--sort`) or MCP (`sort` / `offset`) yet, though
> the underlying engine supports both.

## Projects

One tracker, multiple projects. Each has its own key prefix (`BACKEND-`,
`WEB-`) and counter. Useful for monorepos, or separating client work from
internal work.

**CLI / MCP** — full CRUD plus archive, unarchive, and a default-project
setting. **UI** — switching only.

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

**CLI / MCP** — full CRUD, archive, and switch. `get_current_user` is
worth calling before handling "my tasks" requests rather than asking the
user to type their name.

> The current user is global tracker state, not a per-session identity —
> switching affects every interface at once.

## Labels

Optional colour-coded tags. Flat, no hierarchy, configurable per
workspace.

**CLI / MCP** — manage labels themselves with the label commands/tools;
apply them to a task by setting the `labels` field.

## Sprints

Time-boxed groupings with a name, dates, and a state (`future`, `active`,
`completed`). LocTT performs no automatic state transitions and no
carryover — state is a label you set.

Tasks reference a sprint by its ULID `id`, so renaming a sprint never
detaches its tasks.

## Milestones

Target-date-driven groupings for releases and deliverables.

> Milestone **progress** (completed/total rollups) is specified but not
> implemented on any interface.

## Custom fields

Define your own fields in `workflow.yaml` — `severity`, `customer`,
`estimate`. They have types and validation, and participate in the query
language like built-in fields.

Agents discover them via `get_workflow_config` and set them via
`update_task`; no separate tool is needed.

## Configurable workflow

Statuses, priorities, task types, and relationship kinds live in
`.loctt/config/workflow.yaml`. Add a `blocked_external` status, a
`severity` scale, a `spike` type — the vocabulary is yours. See
[configuration.md](common/configuration.md).

**Agents should call `get_workflow_config` at the start of a session** so
they use the workspace's actual vocabulary rather than assuming defaults.

> Editing the workflow is currently done by hand or through the HTTP API;
> there is no CLI or MCP write command.

## Calendar

Per-workspace timezone, working days, and holidays.

**CLI** — `loctt calendar show`. **MCP** — `get_calendar`, useful when
reasoning about due dates or "by end of week".

> Read-only from the CLI and MCP; edit `calendar.yaml` directly.

## Git sync

Optional mode publishing tracker state to a dedicated `loctt` branch
(configurable via `git.branch`), separate from your code history. See
[git-sync.md](common/git-sync.md) for operations, or
[concepts.md](common/concepts.md) for the mental model.

**CLI** — `loctt git enable|disable|status|publish|sync`. **MCP** —
`enable_git`, `disable_git`, `get_git_status`, `publish_to_git`,
`sync_from_git`.

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

**MCP** — `doctor` and `info` are exposed. There is deliberately **no MCP
`migrate`**: schema migrations are a human action gated by version checks.

## Configuration values

Machine-local settings such as git sync options, distinct from the
workspace workflow.

**CLI** — `loctt config get|set|unset|list`. **MCP** —
`list_config_values`, `get_config_value`, `set_config_value`,
`unset_config_value`.
