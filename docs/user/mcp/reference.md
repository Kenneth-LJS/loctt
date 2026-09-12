# MCP Reference

LocTT's MCP server provides structured tools for AI agents to manage tasks via the Model Context Protocol. Each tool below lists its inputs, the shape of its output, and the common error modes the server returns.

## Agent Guidelines

- **Always use structured tools.** Never edit `task.md` frontmatter or any `.loctt/` config file directly via raw filesystem writes. The body of a task is editable only via `replace_task_body` and `append_task_body`.
- **Use `get_workflow_config` and the `*_list` tools to discover valid values.** Statuses, priorities, task types, relationship types, projects, labels, milestones, sprints, and users all live in config — read them before writing.
- **`delete_*` tools are hard-only and irreversible.** Every `delete_*` tool (`delete_task`, `delete_project`, `delete_label`, `delete_milestone`, `delete_sprint`, `delete_user`) requires `confirm: true`. For the reversible (soft) variant, use the matching `archive_*` tool — that's the same operation as the old soft path. `unarchive_*` brings them back.
- **Schema-version guard.** Every tool except `init` first calls `requireSupportedSchema`. If the tracker's `.schema-version` is missing or doesn't match this server, every route refuses with a clear error pointing at `loctt migrate`. The one exception is `migrate_schema`, which runs the migration over MCP; `loctt migrate` does the same from the CLI.
- **Archived semantics.** Archived entities (projects, labels, milestones, sprints, users, tasks) are hidden from default listings but remain valid references on existing tasks. Pass `include_archived: true` (or the equivalent flag) to surface them.
- **Validation failures are real.** If a structured operation rejects a value, do not bypass it by editing files; surface the error and ask the user.
- **Which tracker the server operates on.** The server is launched by `loctt mcp` and inherits that process's tracker root. Point it at a specific tracker in the client's launch config with `loctt mcp --root <dir>` (alias `--cwd`), or set the `LOCTT_ROOT` env var; an explicit flag wins over the env var, which wins over the launcher's working directory. This is the same vocabulary as the CLI global flag and the web server — see the [CLI reference's Global options](../cli/reference.md#global-options). There is no per-tool root parameter; every tool operates on this one resolved tracker.

## Tracker Setup

### `init`

Bootstraps a new tracker at the server's working directory. Only call when the user has explicitly asked to set up a new tracker. Exempt from the schema-version guard (it is the one tool legitimately called against a non-existent or pre-version tracker).

| Parameter | Type | Required | Description |
|---|---|---|---|
| `prefix` | string | no | Key prefix for tasks (default `T-`) |
| `project_label` | string | no | Name of the starting project (default `Tasks`) |
| `no_docs` | boolean | no | If true, skip generating helper docs |

Returns: prose summary with the resolved `.loctt` directory and the count of files written.

Errors: `.loctt directory already exists at <path>` if the directory is already present.

### `info`

Returns a prose summary of the tracker state.

No parameters. Output includes the resolved LocTT directory, total task count, configured key prefix, status keys, and the `Next keys` block — one line per project counter (sorted by project key) showing the next key that will be issued (e.g. `backend: BACKEND-7`).

If `.loctt/` is missing, returns a hint to run `loctt init`.

If `.loctt/` exists but is **empty**, says so explicitly — "It is not a tracker
yet. Run 'loctt init' to set one up in it." Do not read that as a schema
problem: an empty directory has no schema because it is not yet a tracker, and
`migrate` has nothing to migrate. Previously the schema guard refused every
tool in this state with "No .schema-version file found … must be
re-initialized", which sent agents to the wrong command.

A `.loctt/` that is missing core files but still **holds tasks** is a different
state: it is damaged, the schema guard still refuses, and the remedy is
`loctt init --repair` in a terminal. Never initialize over it — that rebuilds
`state.yaml` with the key counter reset, reissuing keys already in use.

### `doctor`

Runs diagnostic checks on the tracker. Returns JSON:

```json
{
  "healthy": true,
  "counts": { "ok": 14, "warn": 1, "error": 0 },
  "checks": [{ "name": "workflow.yaml", "status": "ok", "message": "..." }]
}
```

Branch on `healthy`, or on an individual check's `status` — not on the message text, which is written for a human and may be reworded.

`healthy` is false when any check is in **error**. Warnings do not make it false: they name things worth knowing (a stale key index, an empty tracker) that do not block the next operation, and a fresh tracker warns.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `rebuild_index` | boolean | no | If true, rebuild the on-disk key index after checks. Use after manual frontmatter edits to a task's `key` or `key_history` (LocTT can't auto-detect this drift because the indexed task id is still present). |

## Tasks

### `create_task`

Create a new task. When the tracker has multiple projects, pass `project` to disambiguate; otherwise the server resolves the target project in this order:

1. **Explicit** — the `project` argument, if supplied.
2. **Per-user default** — the active user's `default_project`, in
   `.loctt/users/<id>/settings.yaml`. MCP has no tool that writes it —
   set it from the web's Settings → My preferences, or edit the file.
3. **Workspace default** — the project marked default in `projects.yaml`.
4. **Sole project** — used automatically when only one project is configured.

If none of these resolve to a unique project, the call fails with a project-resolution error.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `title` | string | yes | Task title |
| `project` | string | no | Project key (slug). Required when there are multiple projects and no default is set |
| `status` | string | no | Status key (must exist in workflow.yaml) |
| `priority` | string | no | Priority key |
| `task_type` | string | no | Task type key |
| `assignee` | string | no | User id or name |
| `reporter` | string | no | User id or name |
| `start_date` | string | no | `YYYY-MM-DD` |
| `due_date` | string | no | `YYYY-MM-DD` |
| `estimate` | string | no | Estimate, in the workspace's configured unit |
| `milestone` | string | no | Milestone id or name |
| `sprint` | string | no | Sprint id or name |
| `labels` | string[] | no | Label ids or names |
| `body` | string | no | Initial markdown body |

Every field `createTask` accepts is settable at creation, so a create
need not be followed by `update_task` calls. `loctt create` takes the
same set (as the equivalent flags), so a task created either way
carries the same fields.

Returns: `Created <KEY>: <title>`.

Errors: project resolution failures (no project specified and no
default; unknown project key); archived-reference rejections; and
workflow validation failures from `createTask` — an unconfigured
status, a reference to something that does not exist, or a custom-field
value of the wrong type. These come back as a normal tool error whose
message names the offending field, e.g.

    Error: invalid task: fields.points: expected finite number, got string

rather than as a server fault. (Before 2026-08-30 `createTask` threw an
untyped error, which `isKnownDomainError` did not recognise, so these
surfaced as an MCP server fault instead of an actionable message.)

### `get_task`

Get a task by key or ID, optionally including the markdown body.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `ref` | string | yes | Task key (e.g. `T-1`) or ID |
| `include_body` | boolean | no | Include markdown body (default `true`) |

Returns JSON: all frontmatter fields, plus `relationships` (each as `{type, target, title?, status?, missing?}` — `target` is rendered as a user-facing key like `T-2` when resolvable, and `title`/`status` carry the target's live values so you need not call `get_task` per edge; deleted targets carry `missing: true`, retain the raw ID, and omit `title`/`status`), `attachments` (each as `{name, size, mime?}` — `mime` is derived from the filename extension and is omitted when the extension is unknown; consumers should treat its absence as `application/octet-stream`), and `body` when requested. The `relationships` key is omitted when empty.

When the body is included the result also carries **`body_token`** — pass it as `expected_token` on `replace_task_body` / `append_task_body` so your write is refused rather than silently overwriting an edit made while you were composing. See [Not overwriting someone else's edit](#not-overwriting-someone-elses-edit).

**When the task's file cannot be parsed**, `get_task` returns a tool
error naming the file and the YAML line — not "task not found". The
distinction matters when relaying to a user: a task whose `task.md` is
corrupt has not been deleted, and the remedy is to open the named file
and fix the YAML. Do not report it as missing, and do not attempt a
write to the task until it parses.

A `ref` that genuinely does not exist still returns `task not found`.
If some task file could not be read *and* the ref matched nothing, the
error says LocTT cannot confirm whether the task exists — the ref it
would have matched lives inside the file that would not parse. Relay
the named path and ask for it to be repaired.

**Field-level problems do NOT make the task unreadable** — only a broken
`id`/`key` or unparseable YAML does. A single bad field is kept as
stored, lifted out of the main object, and reported under **`health`**: a
list of `{ field, kind, rawText, error, repair }`, omitted when the task
is clean. A field named in `health` is **not** among the frontmatter
fields above — its stored value is `rawText`. `kind` is one of
`wrong_type`, `missing_required`, `unrecognised` (a key LocTT has no type
for), `invalid_value` (a value the workflow does not define), or
`dangling` (a reference whose target is gone). To repair one: `set_field`
writes a valid value over it (`repair` is `set` or `set_or_remove`);
`unset_field` removes it (`repair` is `remove` or `set_or_remove`) — this
now works for an unrecognised top-level key too. Repairing one field
leaves every other field's stored value untouched.

### `list_tasks`

List tasks with optional query, view, and limit.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `query` | string | no | Ad hoc query string |
| `view` | string | no | Named saved view from `queries.yaml` |
| `project` | string | no | Filter to a project. AND-merged with `query` if both are supplied |
| `limit` | number | no | Max results (default 30) |
| `include_archived` | boolean | no | Include archived tasks (default false). Ignored when the query already mentions `archived` or when a saved view is used — saved views are respected as authored |

Returns JSON array of `{key, title, status, priority}`.

A query naming an unknown field or an invalid enum value is an **error**, not an empty result — `stat = done` reports the typo rather than returning `[]`. Treat an empty array as a genuine "no tasks match".

The one exception is a saved view referencing a since-deleted custom field: it still runs, and the response is prefixed with a `Warning:` line and `Results may be incomplete.` before the JSON. Don't report those results as complete without saying so.

`today` in a query (`due_date < today`) resolves in the workspace timezone from `calendar.yaml`, not the server machine's zone.

`currentUser()` in a query (`assignee = currentUser()`) resolves to the tracker's configured current user. When none is set it matches nothing rather than every unassigned task.

### `export_tasks`

Export tasks as CSV or JSON — the same report the web list view
produces, for the same rows. Filters resolve exactly as `list_tasks`
does.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `format` | string | no | `csv` or `json`. Default `csv`. |
| `query` | string | no | Ad hoc query string, as in `list_tasks` |
| `view` | string | no | Named saved view |
| `project` | string | no | Filter to a project (key/slug, name or id) |
| `columns` | array | no | Explicit column list (built-in field names or `fields.<custom>`). Defaults to the standard export columns. |
| `include_body` | boolean | no | Include the markdown body (JSON field / CSV column). Default false. |
| `include_archived` | boolean | no | Include archived tasks (default false) |

Returns the CSV or JSON text. `list_tasks` returns structured JSON,
which is usually what an agent wants; `export_tasks` exists for the
spreadsheet report — CSV cells that would be read as a formula (`=`,
`+`, `-`, `@`) are neutralised.

This is a **report**, not a backup: it drops the body (unless
`include_body`), relationships, custom fields, `key_history`, archive
state and ranks, and **cannot be restored** — there is no CSV import.
Use the `backup` tool to protect against data loss.

Tasks that cannot be parsed are **named** in a `Warning:` line before
the export body, never silently dropped.

### `list_views`

Lists saved views from `queries.yaml`. No parameters. Returns JSON
`[{id, name, query, sort?, archived?}]`, or the prose `No saved views
configured.` when the file is absent.

A view whose query no longer parses (usually a hand edit) is still
returned, carrying `broken: true` plus the parser's `error` and
`position`, rather than being dropped — a broken entry no longer hides
itself or the healthy views beside it. Do not create or overwrite views
in response to a broken entry: the view exists, it just needs its query
fixed.

### `create_view`

Create a saved view — a named query you can re-run by name or id.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Display label. Need not be unique, but a unique name works as a ref |
| `query` | string | yes | LocTT query DSL, e.g. `status in (backlog, in_progress)` — the same language `list_tasks` accepts as `query` |
| `sort` | array | no | Ordered sort keys, `[{field, direction}]` with `direction` one of `asc`/`desc` |

The query is validated on write, so a malformed one is rejected here
rather than silently poisoning the catalog. Returns the created view
including its generated `id` — address the view by that id afterward,
since names are not unique.

### `edit_view`

Edit a saved view. Any of `name`, `query`, `sort` may be supplied;
omitted fields are left unchanged.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `view` | string | yes | View id or unique name (ambiguous name rejected) |
| `name` | string | no | New display label |
| `query` | string | no | New query DSL (validated on write) |
| `sort` | array \| null | no | New sort keys, or `null` to clear the sort |

`sort: null` clears an existing sort; omitting `sort` leaves it
unchanged. Returns the updated view.

### `delete_view`

Permanently remove a saved view. Always requires `confirm: true`. Use
`archive_view` for the reversible variant.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `view` | string | yes | View id or unique name |
| `confirm` | boolean | yes | Must be `true` to proceed |

### `archive_view`

Mark a view as archived — hidden from default lists but still runnable
by id. Reversible via `unarchive_view`.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `view` | string | yes | View id or unique name |

### `unarchive_view`

Clear the archived flag on a view, restoring it to default lists.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `view` | string | yes | View id or unique name |

### `get_workflow_config`

Returns the workflow configuration as JSON. No parameters.

### `update_task`

Set a single field on a task.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `ref` | string | yes | Task key or ID |
| `field` | string | yes | Field name |
| `value` | any | yes | Value to set |

**Writable built-in fields and accepted value shapes:**

| Field | Value shape |
|---|---|
| `title` | non-empty string |
| `status` | non-empty string (workflow validates the key) |
| `task_type` | non-empty string |
| `priority` | non-empty string |
| `labels` | array of strings |
| `assignee` | string or `null` |
| `reporter` | string or `null` |
| `start_date` | string (`YYYY-MM-DD` or full ISO-8601) |
| `due_date` | string (`YYYY-MM-DD` or full ISO-8601) |
| `estimate` | string or number |
| `milestone` | string or `null` |
| `sprint` | string or `null` |

A value-shape mismatch returns `invalid value for field "<name>": <details>`. Workflow-aware checks (status enum, label membership, etc.) happen on top of the shape check and return `invalid value: <details>` if they fail.

**Custom fields:** any field name not in the built-in list is treated as a custom field and must be declared in `workflow.yaml` under `custom_fields`. Custom fields go through `update_task` too — there is no separate tool. Their value shape is whatever the workflow's `custom_fields` definition allows.

**Rejected (system-managed) fields:** `id`, `key`, `created_at`, `project`, `key_history` (immutable); `relationships` (use `link_tasks` / `unlink_tasks`); `archived`, `archived_at` (use `archive_task` / `unarchive_task` / `delete_task`); `status_updated_at` (auto-stamped on status change); `completed_date`, `board_rank` (auto-managed). Sending one of these returns a clear error naming the alternate tool or that the field is auto-managed.

Returns: `Updated <KEY>: set <field> = <value>`.

### `unset_field`

Remove a field from a task.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `ref` | string | yes | Task key or ID |
| `field` | string | yes | Field to remove |

Allowlist matches `update_task`: writable built-ins and declared custom fields. The system-managed fields rejected by `update_task` are also rejected here. `title` cannot be unset (required), and `updated_at` is not exposed via MCP.

Returns: `Updated <KEY>: unset <field>`.

### Comment tools

| Tool | Parameters | Description |
|---|---|---|
| `list_comments` | `ref` | A task's comments in creation order, with author, body, timestamps, resolved mentions, and `editors` when someone other than the author edited |
| `post_comment` | `ref`, `body` | Adds a comment as the current user |
| `edit_comment` | `ref`, `comment_id`, `body` | Replaces a body; preserves the author and appends the editor |
| `delete_comment` | `ref`, `comment_id` | Removes a comment; recorded in the activity log |

Mentions written as `@user:<id>` resolve against the user list; an
unresolvable mention is dropped rather than failing the post.

**No ownership checks.** Anyone may edit or delete anyone's comment —
LocTT has no roles or permissions. `editors` is a provenance trail, not
a permission record.

### `migrate_schema`

Upgrade the tracker's on-disk schema to the version this build
understands.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `confirm` | boolean | no | Omitted/`false` previews the plan; `true` performs the migration |

**Preview first.** Migration rewrites task frontmatter across the whole
tracker and individual steps may be marked `[RISKY]`. Call without
`confirm` to get the plan, show it to the user, and only then call with
`confirm: true`.

A backup is written before any step runs and is never deleted — the
response names its path.

Like `init`, this tool is exempt from the schema-version guard: it is
the remedy for a mismatch, so gating it behind one would make an
outdated tracker unfixable from this surface.

Returns: the plan (`v<from> → v<to>`, one line per step) or the result
(`Migrated v<from> → v<to>` plus the backup path).

### `bulk_update_tasks`

Set or clear one field across many tasks in a single operation.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `refs` | string[] | yes | Task keys or IDs, 1–500 |
| `field` | string | yes | Field to set or clear |
| `value` | any | no | Value to set. Omit or pass `null` to **clear** the field |

Prefer this over repeated `update_task` calls when changing the same
field on several tasks. It runs under one lock, stamps every history
entry with a shared `bulk_op_id` so the change reads as one action, and
reports per-task outcomes rather than stopping at the first bad ref.

Allowlist matches `update_task`.

Batches are capped at 500: one bulk operation holds the tracker-wide
state lock for its whole run, so an unbounded batch would block every
other writer.

Returns: `<n> updated, <m> failed (bulk_op_id <ULID>)`, followed by one
line per failure. A failed task never aborts the rest.

### `delete_task`

Permanently removes the task directory. Use `archive_task` for the reversible (soft) variant. **Always requires `confirm: true`.**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `ref` | string | yes | Task key or ID |
| `confirm` | boolean | yes | Must be `true` to proceed |

Returns: `Deleted <KEY>.`. Errors: `delete_task requires confirm: true to proceed`.

### `archive_task` / `unarchive_task`

Reversible soft-delete and its inverse. Both are idempotent: archiving a
task that is already archived (or unarchiving one that is not) succeeds
and changes nothing — no error, no new history entry.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `ref` | string | yes | Task key or ID |

Returns: `Archived <KEY>.` / `Unarchived <KEY>.`.

### `replace_task_body`

Replace a task's entire markdown body.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `ref` | string | yes | Task key or ID |
| `body` | string | yes | New body content |
| `expected_token` | string | no | The `body_token` from your `get_task` read. See [Not overwriting someone else's edit](#not-overwriting-someone-elses-edit). |

Returns: `Replaced <KEY> body.`.

### `append_task_body`

Append text to a task's markdown body.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `ref` | string | yes | Task key or ID |
| `text` | string | yes | Text to append |
| `expected_token` | string | no | The `body_token` from your `get_task` read. See [Not overwriting someone else's edit](#not-overwriting-someone-elses-edit). |

Returns: `Appended to <KEY> body.`.

### Not overwriting someone else's edit

A body write with no `expected_token` is last-write-wins: if a person edited
the task in the browser while you were composing, your text replaces theirs
silently.

**Pass the token whenever you have one.** You almost always do — you read the
task before writing it, and `get_task` returns `body_token` alongside the
body. Hand it straight back:

```json
{ "ref": "T-12", "body": "...", "expected_token": "<body_token from get_task>" }
```

If the task changed in between, the write is **refused and nothing is
written**. You get an error saying so; the remedy is to `get_task` again,
reapply your edit to the current text, and write again with the fresh token.

You cannot compute the token yourself — it is derived from the task's
`updated_at` and a digest of the body — so it must come from a `get_task`
response.

### `get_task_history`

Get the activity/history log for a task. Returns a paginated page of structured entries, newest first.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `ref` | string | yes | Task key or ID |
| `limit` | number | no | Max entries to return (default: all) |
| `offset` | number | no | Entries to skip from the newest end (default: 0) |

Returns a JSON object `{ entries, total, offset, limit? }`:

- `entries` — the requested page, newest first.
- `total` — the full count of readable entries, so a caller can tell "the
  newest N" from "all there is".
- `offset` — the offset applied (echoes the argument, `0` when omitted).
- `limit` — present only when a `limit` was supplied.

`offset` and `limit` compose into a partition — `offset` skips that many
entries from the newest end, so paging with `offset += limit` walks a long
history without repeats or gaps. Without `offset` a caller can read only
the newest page and never reach older entries.

### `attach_file`

Copy a local file into a task's attachments directory. Only filesystem paths are supported in v1 — no base64 content. The file must be readable from the MCP server's filesystem.

> **Security note.** `attach_file` accepts any absolute path the MCP server process can read — including paths outside the repo such as `~/.ssh/id_rsa`, `~/.aws/credentials`, or `.env` files elsewhere on disk. The contents are then copied into `.loctt/tasks/<id>/attachments/`, where they may be committed, synced, or otherwise exfiltrated. **Do not auto-approve `attach_file` calls.** See [Agent setup → Permissions and auto-approval](agent-setup.md#permissions-and-auto-approval).

| Parameter | Type | Required | Description |
|---|---|---|---|
| `ref` | string | yes | Task key or ID |
| `source_path` | string | yes | **Absolute** path to the file to attach |
| `force` | boolean | no | If true, overwrite an existing attachment with the same basename |

Returns JSON `{name, size, overwritten, task_key}`.

Errors: `source_path must be absolute`; `<message>. Pass force: true to overwrite.` when an attachment with that basename already exists; source-readable errors from `AttachmentSourceError`.

### `detach_file`

Remove a file from a task's attachments directory.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `ref` | string | yes | Task key or ID |
| `name` | string | yes | Basename of the attachment (no path separators) |

Returns: `Detached <name> from <KEY>`. Errors via `AttachmentNotFoundError` when the basename isn't present.

## Projects

### `list_projects`

No parameters. Returns JSON `{projects: [...], default: <id|null>}` from `projects.yaml`. `default` is a project **id** (ULID), not a name.

### `create_project`

Create a new project. Prefixes must be unique across the tracker, and a project's prefix is immutable after creation except via `set_project_prefix`.

A project is `{id, name, slug?, prefix}`. `id` is a ULID minted at creation and `name` is mutable display text. The **slug** is the stable, URL-safe handle (`web`, `web-app`): generated from the name unless given, unique across the tracker, and **fixed once created** — renaming a project does not change it, so links keep resolving (K3, decisions.md A60). Trackers created before slugs existed have none and are referenced by name or id.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Human-readable display name |
| `prefix` | string | yes | Task-key prefix, e.g. `BACKEND-` |
| `slug` | string | no | URL-safe handle. Generated from the name when omitted. Lowercase letters, digits, hyphen, underscore; must start with a letter. Rejected if malformed or already taken |
| `make_default` | boolean | no | If true, also set as workspace default |

Returns JSON `{id, name, slug?, prefix}`.

Every tool that takes a `project` parameter accepts a **slug**, an id, or a name — resolved in that order, so the unambiguous handle wins.

Returns: `Created project <key>`. `ProjectError` on validation failures.

### `edit_project`

Edit an existing project's name. `id` is immutable; the prefix has its own tool (`set_project_prefix`) because changing it rewrites every task in the project.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `project` | string | yes | Project id or name |
| `name` | string | yes | New name |

### `set_project_prefix`

Change a project's key prefix, renaming every task in it — `T-3` becomes `WEB-3`. The number is preserved, so nothing is renumbered, and each task's previous key is appended to `key_history` so old references keep resolving.

Prefixes must be unique across projects; one already in use is rejected. This rewrites every task in the project, so prefer it deliberately rather than as a cosmetic change.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `project` | string | yes | Project id or name |
| `prefix` | string | yes | New prefix, e.g. `WEB-` |
| `confirm` | boolean | yes | Must be `true` to proceed |

`confirm: true` is required, as it is for `delete_*`. This is not a delete, but it rewrites every task in the project — the same blast radius the gate exists for, and a call without it means the tool was reached for as if it were a cosmetic field edit.

Returns `{id, from, to, renamed}`. `ProjectError` when the prefix is already in use or the project is unknown; nothing is written in either case.

If a rename is interrupted partway, the next tool call finishes it before running — silently, since the repair is not what you asked for. Should that recovery fail, the call returns an error instead of task keys that may be stale; `loctt doctor` reports the pending rename.

### `archive_project` / `unarchive_project`

| Parameter | Type | Required | Description |
|---|---|---|---|
| `project` | string | yes | Project id or name |

`archive_project` is the reversible (soft) variant of `delete_project`.

### `delete_project`

Permanently removes the project from `projects.yaml`. For projects with tasks, pass **exactly one** of `remap_to` (migrate them to another project) or `clear_project_field: true` (clear their project field, leaving them with no project) — not both, and not neither, so tasks are never silently orphaned. Cannot delete the only project. The counter is preserved in `retired_keys` so a later create with the same prefix resumes numbering. **Always requires `confirm: true`.** Use `archive_project` for the reversible variant.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `project` | string | yes | Project id or name to delete |
| `confirm` | boolean | yes | Must be `true` to proceed |
| `remap_to` | string | conditional | Target project (id or name) for tasks in the deleted project (mutually exclusive with `clear_project_field`) |
| `clear_project_field` | boolean | conditional | Clear the project field on affected tasks instead of remapping them (mutually exclusive with `remap_to`) |

Returns JSON `{id, remappedTaskCount}`.

If some task rewrites fail partway (e.g. an unwritable task file), the tool reports the split rather than a bare failure: an error naming how many tasks moved and which failed (by key), stating the project was **not** removed (its tasks still reference it), and offering a retry — re-running finishes the stragglers, since tasks already moved are skipped.

### `move_task`

Move one or more tasks to another project. The key is reallocated under the target project; the old key is retired into `key_history` and stays resolvable, so existing references keep working. Pass several refs to move them as one operation.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `refs` | string[] | yes | Task keys or ids, 1–500 |
| `project` | string | yes | Target project id or name |

Returns a per-task summary of moved and failed refs with old → new keys.

### `duplicate_task`

Create a copy of a task with a fresh key. Copies title (suffixed `(copy)` unless overridden), status, priority, type, assignee, reporter, dates, estimate, milestone, sprint, labels, custom fields and body. Deliberately does **not** copy relationships, attachments, or archived state — the copy starts unlinked and active.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `ref` | string | yes | Task key or id to copy |
| `title` | string | no | Title for the copy; defaults to `<source> (copy)` |
| `project` | string | no | Target project; defaults to the source's |

> **Known defect.** `project` here accepts only a project **id**, unlike every
> sibling tool. `move_task` resolves a name through `resolveProjectIdForUser`;
> `duplicate_task` does not, so a name fails with a raw internal message
> (`no key allocation state for entity type "<name>"`). This contradicts P-3
> and is recorded in [`audit-findings.md`](../../dev/audit-findings.md).

### `set_default_project`

Set or clear the workspace default project.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `project` | string | no | Project id or name to set as default; omit to clear |

## Users

### `list_users`

| Parameter | Type | Required | Description |
|---|---|---|---|
| `include_archived` | boolean | no | Include archived users (default false) |

Returns JSON `{current: <id|null>, users: [...]}`.

### `get_current_user`

No parameters. Returns the active user's profile JSON, or errors with `no users registered`.

### `get_user_settings`

No parameters. Returns `{user: <id>, settings: {...}}` — the active
user's personal preferences from `.loctt/users/<id>/settings.yaml`
(`theme`, `default_project`, `card_layout`, `sidebar_pins`,
`sidebar_groups`). These are
per-user render preferences; unrecognised keys round-trip untouched.

### `sweep_sidebar_pins`

No parameters. Removes pinned saved views whose views no longer exist in
`queries.yaml`, rewrites `settings.yaml`, and returns
`{removed: [...], kept: [...], changed: <bool>}` — the removed ids are
reported rather than dropped silently. Pins whose views merely match
zero tasks are kept: this checks existence, not results.

### `get_sidebar_groups`

No parameters. Returns the active user's sidebar-groups customization —
which built-in sidebar groups/filters show and in what order (SHL-45).
The payload is `{user, stored, resolved}`: `stored` is the raw
`sidebar_groups` setting (`{order?: [...], hidden?: [...]}`), and
`resolved` is the full ordered list with a `hidden` flag per item — every
group **and** every built-in filter, so a hidden filter appears in
`resolved` with `hidden: true`. Group ids: `views`, `projects`,
`saved-filters`, `milestones`, `sprints`, `labels`, `recents`. Built-in
filter ids: `assigned-to-me`, `reported-by-me`, `mentions-me`,
`due-this-week`, `overdue`, `high-priority`.

### `set_sidebar_groups`

Sets the active user's sidebar-groups customization (SHL-45).
Parameters (all optional): `order` (ids in render order — any built-in
not listed follows in default order), `hidden` (ids to hide — a hidden
group renders nothing, a deliberate choice distinct from an empty
group), and `reset: true` (clear the setting back to the default order,
everything visible; cannot be combined with `order`/`hidden`). An
**unknown id is rejected** with an error naming it (a typo must not
silently no-op); a repeated valid id is de-duplicated. Returns the same
`{user, stored, resolved}` shape as `get_sidebar_groups`.

### `switch_user`

Switches the active user. Accepts a UUID or an exact name (when unambiguous).

| Parameter | Type | Required | Description |
|---|---|---|---|
| `ref` | string | yes | User UUID or exact name |

### `create_user`

Names are not unique (UUIDs disambiguate). Timezone defaults to the system timezone. Avatars are not settable via MCP — use the CLI (`loctt user create --avatar <path>`) or web UI.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Display name |
| `email` | string | no | Email — validated; a malformed address is rejected and nothing is written |
| `timezone` | string | no | IANA timezone |
| `switch_to_on_create` | boolean | no | Switch to this user after creation |

Returns the created user as JSON.

### `edit_user`

*Setting* an avatar is not exposed via MCP (binary upload is a poor
protocol fit) — use the CLI or web UI. *Removing* one needs no binary,
so `remove_avatar` is available here.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `ref` | string | yes | User UUID or name |
| `name` | string | no | New display name |
| `email` | string \| null | no | Pass `null` to clear; a non-null value is validated and a malformed address is rejected |
| `timezone` | string | no | New IANA timezone |
| `remove_avatar` | boolean | no | Clear the avatar (deletes the file and the profile reference) |

### `archive_user` / `unarchive_user`

Soft-deletes / restores a user. Hides them from pickers without breaking historical task references. **Blocked when the target is the active user.**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `ref` | string | yes | User UUID or name |

### `count_user_references`

Read-only. Counts how many tasks reference a user, split by role. Use it before `delete_user` to see what a remap or unassign will affect — the same split `delete_user` reports back.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `ref` | string | yes | User UUID or name |

Returns JSON `{id: <id>, assignee: <N>, reporter: <M>}`.

### `delete_user`

Hard-deletes a user. When the user has task references (assignee/reporter), exactly one of `remap_to` or `unassign` is required — they are **mutually exclusive**. Blocked when the target is the active user. **Always requires `confirm: true`.**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `ref` | string | yes | User UUID or name |
| `confirm` | boolean | yes | Must be `true` to proceed |
| `remap_to` | string | conditional | UUID/name to migrate references onto |
| `unassign` | boolean | conditional | Clear assignee/reporter on affected tasks |

Returns JSON `{deleted: <id>, ...result}`. Errors: `delete_user requires confirm: true to proceed`; `remap_to and unassign are mutually exclusive`; cannot delete the active user.

## Labels

### `list_labels`

No parameters. Returns the full labels config JSON. Each label is `{id, name, color?}`; `id` is a ULID.

### `create_label`

Names are **not unique** — two labels may share a name and are disambiguated by `id`.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Display name |
| `color` | string | no | Color value |

Returns JSON `{id, name}`.

### `edit_label`

The `id` is immutable; `name` is mutable display text.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `label` | string | yes | Which label to edit — id or name |
| `name` | string | no | New display name |
| `color` | string \| null | no | Pass `null` to clear |

Note the two parameters are distinct: `label` selects, `name` renames.

### `archive_label` / `unarchive_label`

| Parameter | Type | Required | Description |
|---|---|---|---|
| `label` | string | yes | Label id or name |

### `delete_label`

Permanently removes the entry from `labels.yaml`; the id is dropped from every task's `labels` array (or remapped via `remap_to`). **Always requires `confirm: true`.** Use `archive_label` for the reversible variant.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `label` | string | yes | Label id or name |
| `confirm` | boolean | yes | Must be `true` to proceed |
| `remap_to` | string | no | Target label (id or name) for affected tasks |

Returns JSON `{id, ...result}`.

If some task rewrites fail partway during a `remap_to`, the tool reports the split rather than a bare failure: an error naming how many tasks moved and which failed (by key), stating the label was **not** removed (its tasks still reference it), and offering a retry — re-running finishes the stragglers, since tasks already moved are skipped.

## Milestones

### `list_milestones`

Returns the full milestones config JSON. Each milestone is `{id, name, target_date?}`; `id` is a ULID.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `progress` | boolean | no | Include per-milestone progress counts |

With `progress: true` the response is `{milestones: [...], unreadable?}`
— each milestone gains a `progress` `{done, total, discarded, fraction}`
computed from status **category** (not a status key), with discarded
tasks excluded from the denominator. A top-level `unreadable` list
(present only when non-empty) names any task files that could not be
read; the totals count only the readable corpus, so a short total is
explained rather than silent.

### `create_milestone`

| Parameter | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Display name |
| `target_date` | string | no | `YYYY-MM-DD` |

Returns JSON `{id, name}`.

### `edit_milestone`

| Parameter | Type | Required | Description |
|---|---|---|---|
| `milestone` | string | yes | Which milestone to edit — id or name |
| `name` | string | no | New display name |
| `target_date` | string \| null | no | Pass `null` to clear |
| `archived` | boolean | no | Archived flag |

Note the two parameters are distinct: `milestone` selects, `name` renames.

### `archive_milestone` / `unarchive_milestone`

| Parameter | Type | Required | Description |
|---|---|---|---|
| `milestone` | string | yes | Milestone id or name |

### `delete_milestone`

Permanently removes the entry from `milestones.yaml`; the `milestone` field on each affected task is unset or remapped via `remap_to`. **Always requires `confirm: true`.** Use `archive_milestone` for the reversible variant.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `milestone` | string | yes | Milestone id or name |
| `confirm` | boolean | yes | Must be `true` to proceed |
| `remap_to` | string | no | Target milestone (id or name) for affected tasks |

Returns JSON `{id, ...result}`.

## Sprints

### `list_sprints`

Returns the full sprints config JSON. Each sprint is `{id, name, start_date, end_date, state, goal?}`; `id` is a ULID.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `progress` | boolean | no | Include per-sprint progress counts |

With `progress: true` the response is `{sprints: [...], unreadable?}`,
mirroring `list_milestones`: each sprint gains a `progress` `{done,
total, discarded, fraction}` computed from status **category** (not a
status key), with discarded tasks excluded from the denominator. A
top-level `unreadable` list (present only when non-empty) names any task
files that could not be read; the totals count only the readable corpus,
so a short total is explained rather than silent. It is opt-in because
computing it scans every task.

### `create_sprint`

| Parameter | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Display name |
| `start_date` | string | yes | `YYYY-MM-DD` |
| `end_date` | string | yes | `YYYY-MM-DD` |
| `state` | enum | yes | `active` \| `completed` \| `future` |
| `goal` | string | no | Sprint goal |

Returns JSON `{id, name}`.

### `edit_sprint`

Edit a sprint. Re-opening a completed sprint (state `completed` → `active` or `future`) is blocked by default; pass `force: true` to override. Pass `null` `goal` to clear it.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `sprint` | string | yes | Which sprint to edit — id or name |
| `name` | string | no | New display name |
| `start_date` | string | no | `YYYY-MM-DD` |
| `end_date` | string | no | `YYYY-MM-DD` |
| `state` | enum | no | `active` \| `completed` \| `future` |
| `goal` | string \| null | no | Pass `null` to clear |
| `force` | boolean | no | Override the block on re-opening a completed sprint |

Note the two parameters are distinct: `sprint` selects, `name` renames.

### `archive_sprint` / `unarchive_sprint`

| Parameter | Type | Required | Description |
|---|---|---|---|
| `sprint` | string | yes | Sprint id or name |

### `delete_sprint`

Permanently removes the entry from `sprints.yaml`; the `sprint` field on each affected task is unset or remapped via `remap_to`. **Always requires `confirm: true`.** Use `archive_sprint` for the reversible variant.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `sprint` | string | yes | Sprint id or name |
| `confirm` | boolean | yes | Must be `true` to proceed |
| `remap_to` | string | no | Target sprint (id or name) for affected tasks |

Returns JSON `{id, ...result}`.

## Backup and Restore

The whole-tracker backup, and the only export a restore can read. The
CSV/JSON export is a report for a spreadsheet: it drops the body,
relationships, custom fields, `key_history`, archive state and ranks.

Backup and restore are on every surface: these MCP tools, the CLI
`loctt backup` / `loctt restore` commands, and the web UI (Settings →
Backup & restore). A backup taken through one restores through any of
them.

**Both tools write to the filesystem and can take time on a large
tracker.** Say what you are about to do before calling either, and do
not call them speculatively.

### `backup`

Writes a JSONL backup — one JSON value per line, so it streams. Line 1
is a header carrying the schema version.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `output` | string | yes | Destination path, relative to the tracker root |
| `no_history` | boolean | no | Leave `_history.yaml` out. History is included by default. |
| `split_bytes` | integer | no | Bytes per part; above this the output splits into numbered parts |

Returns JSON `{files, bytes, tasks, configs, users, includedHistory,
excluded, schemaVersion}`. `excluded` is a list of
`{path, reason}` — the machine-local files that deliberately do not
travel (`local/*`, each user's `settings.yaml` and `recents.yaml`, and
`.schema-migration-in-progress`). Report `files` and `bytes` to the
user; a backup with attachments can be large.

Carries: task frontmatter and body, comments, history, attachments
(base64, inline), config, user profiles and avatars, and `state.yaml`
(the key counters — without them a restored tracker reissues keys).

### `restore`

| Parameter | Type | Required | Description |
|---|---|---|---|
| `files` | string[] | yes | Backup paths. A split backup needs **every** part; a partial set is refused and nothing is written. |
| `mode` | enum | no | `bare` (default), `merge`, or `overwrite` |
| `dry_run` | boolean | no | Predict counts, write nothing |

| Mode | Behaviour |
|---|---|
| `bare` | Refuses a non-empty tracker, naming the count |
| `merge` | Creates absent ids; never edits one that is present |
| `overwrite` | Replaces any id the backup carries; others untouched |

Returns JSON `{mode, dryRun, created, skipped, overwritten,
reallocatedKeys, reassignedPrefixes, reassignedSlugs, renamedEntities,
displacedBodies, badLines}`.

**Branch on the arrays, not on prose.** They are how the restore tells
you what it had to change:

- `reallocatedKeys` — `{from, to}` where a key was already taken. The
  old key goes into `key_history` and still resolves.
- `reassignedPrefixes` / `reassignedSlugs` — two independently `init`ed
  trackers both mint `T-` and `tasks`; one of each is reassigned.
- `renamedEntities` — a colliding label/milestone/sprint name kept both
  and renamed the incoming one (`bug (2)`, then `bug (3)`).
- `displacedBodies` — `{taskId, path}`. **`overwrite` only**, and worth
  surfacing: it is the one mode that can lose work done since the
  backup, so the replaced text is written beside the task rather than
  discarded. Tell the user where it went.
- `badLines` — `{line, file, reason}` for malformed lines, which are
  skipped while everything else restores.

Prefer `dry_run` first on any tracker that already holds tasks, and
show the user the predicted counts before running it for real.

A restore refuses — writing nothing — when the destination is mid
prefix-rename or mid schema-migration, when the backup is from a newer
schema, or when a part of a split set is missing.

## What might look absent but isn't

Capabilities an agent might assume are web-only are all reachable here,
so there is no need to go looking:

Task export *is* available — see `export_tasks` above. Bulk edits *are*
available — see `bulk_update_tasks`. Saved-view
management is available too — see `create_view` / `edit_view` /
`delete_view` / `archive_view` / `unarchive_view` above.

### Reordering

`reorder_relationship`, `reorder_board` and `move_board_card` live
under [Relationships and Ranks](#relationships-and-ranks) — they move a
task within an ordering rather than changing its fields. The two
`reorder_*` tools take `before` **or** `after`, never both;
`move_board_card` takes both, because a drop lands between a pair.

## Calendar

### `get_calendar`

Returns the workspace calendar config (timezone, working days, holidays) as JSON. No parameters.

**Read-only over MCP** — calendar is configured via the UI / config files; there is no MCP write tool.

## Relationships and Ranks

### `link_tasks`

| Parameter | Type | Required | Description |
|---|---|---|---|
| `ref` | string | yes | Source task key or ID |
| `type` | string | yes | Relationship type (e.g. `parent`, `blocks`) — must be defined in workflow config |
| `target` | string | yes | Target task key or ID |

Returns: `Linked <SRC> --<type>--> <TGT>`.

### `unlink_tasks`

Same parameters as `link_tasks`.

### `reorder_relationship`

Reorder a relationship target within one source task's links of a given type. Pass exactly one of `before` or `after` to position the target relative to a sibling, or neither to move it to the end. **`before` and `after` are mutually exclusive.**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `source` | string | yes | Source task key or ID |
| `type` | string | yes | Relationship type |
| `target` | string | yes | Target being moved |
| `before` | string | no | Sibling to position before |
| `after` | string | no | Sibling to position after |

Returns the result of the reorder (the new ordering of targets) as JSON. Errors via `ReorderError`; passing both `before` and `after` errors with `` `before` and `after` are mutually exclusive; pass at most one ``.

### `get_sprint_burndown`

Return the burndown series for a sprint, reconstructed from task history. The response carries the daily 'remaining' total across the sprint window, the unit being summed (`tasks` / `points` / `hours` / `days` / `custom_numeric` / `weighted_enum`), the initial total at sprint start, the ideal straight-line, and per-day incomplete task counts. Scope changes appear as visible steps in the series.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `key` | string | yes | Sprint key |

Returns JSON `{ sprintKey, start, end, unit, unitLabel?, initialTotal, series, ideal }`. Errors via `BurndownError` (unknown sprint key).

### `reorder_board`

Reorder a task's position on the board (its `board_rank`). The board column is implicit — the task stays in its current status; this only changes its order within that column. Pass exactly one of `before` or `after` to position relative to a sibling, or neither to move to the end. **`before` and `after` are mutually exclusive.**

A column is a *group of tickets*, not a status. Where `workflow.yaml`'s `boards` block collapses several statuses into one column, ranks can cross statuses within that column: `before` / `after` accept any task in the same column whatever its status, and cards of different statuses interleave freely. With no `boards` block a column is one status. An anchor from a different column is refused. Each column is its own sequence, so "the end" means the end of that column, not of the tracker.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `ref` | string | yes | Task key or ID being moved |
| `before` | string | no | Sibling task to position before |
| `after` | string | no | Sibling task to position after |

Returns the result of the reorder as JSON (`{ rank, rebalanced }`). Errors via `ReorderError`; passing both `before` and `after` errors with the same mutually-exclusive message as `reorder_relationship`.

Reordering a task into the position it already occupies is a **no-op**: when the computed rank equals the current one, nothing is written — `board_rank` and `updated_at` are unchanged and no history entry is appended. The call still succeeds and returns the existing rank with `rebalanced: false`.

### `move_board_card`

Move a task to another board column **and** position it there in a
single write.

Prefer this over `update_task` for `status` followed by
`reorder_board`. Those are two writes, and a failure between them
leaves the task in a column whose stored status contradicts it; this
tool writes `status` and `board_rank` as one change set, so both land
or neither does.

Omit `status` to reposition within the task's current column, in which
case `status` is not written at all (not resent at its current value).

Unlike `reorder_board`, **`before` and `after` are not mutually
exclusive here.** A drop lands *between* two neighbours, so passing
both interpolates a rank between that pair; passing neither appends to
the end of the destination column. A column is a group of tickets, not
a status, so the anchors may carry any status belonging to that column.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `ref` | string | yes | Task key or ID being moved |
| `status` | string | no | Destination status; omit for an intra-column reposition |
| `before` | string | no | Task the moved task lands above |
| `after` | string | no | Task the moved task lands below |

Returns JSON `{ key, status, board_rank, rebalanced }`. Errors via
`ReorderError` when an anchor no longer exists or has left the
destination column, naming the anchor and telling you to reload.

A move that changes neither status nor rank is a **no-op**: nothing is
written, `updated_at` is unchanged, and no history entry is appended.

## Config and Git

Config tools currently target machine-local keys (`git.*`).

### `get_config_value`

| Parameter | Type | Required | Description |
|---|---|---|---|
| `key` | string | yes | Config key (e.g. `git.enabled`, `git.remote`) |

Returns JSON `{key, value, type}` with the value preserving its native type. Errors with `unknown config key '<key>'`.

### `set_config_value`

Echo the change you're making in your response. Don't call speculatively.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `key` | string | yes | Config key |
| `value` | string | yes | Stringified value; booleans accept `true/false/1/0/yes/no` |

### `unset_config_value`

Restores a key to its default.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `key` | string | yes | Config key |

### `list_config_values`

No parameters. Returns JSON array of `{key, value, type, description}` for every known config key.

### `get_workflow_key_usage`

No parameters. Returns JSON `{statuses, priorities, task_types, relationships, custom_field_values}`. The first four are maps of workflow key to the number of tasks referencing it; `custom_field_values` is a map of field key to a map of value key to count.

A key **absent** from a map is referenced by no task — the maps are sparse, built from what tasks actually hold. They can therefore also carry keys that are no longer in `workflow.yaml` at all, which is drift worth reporting to the user.

Call this before proposing any deletion from `workflow.yaml`. Deleting a key that tasks still reference is refused unless the edit carries a remap directive saying where those tasks should go, and this is the only way to know how many tasks that is. A relationship is counted once per task holding at least one link of that type, not once per link — the number means "tasks a remap would rewrite".

The same counts are available as `loctt config usage` on the CLI and `GET /api/workflow/usage` in the web UI.

### `enable_git`

Enables git-backed mode for this tracker. Sets up a dedicated `loctt` branch, published via a temporary worktree. One-time infrastructure setup — only call when explicitly asked. No parameters.

### `disable_git`

Disables git-backed mode. Local task data is preserved. No parameters.

### `get_git_status`

No parameters. Returns JSON `{enabled, branch, remote, remote_configured, auto_push, auto_fetch, in_git_repo, last_synced_commit, local_changes, remote_changes, branch_commit}`.

`remote` always carries a name because it defaults to `origin`; `remote_configured` says whether one actually exists, and only that predicts whether a push can work.

`local_changes` counts files not yet published, `remote_changes` says whether the branch moved since the last sync. Both are `null` when they could not be determined (git mode off, no branch yet) — which is not the same as zero, and should not be reported to the user as "nothing pending".

### `publish_to_git`

Commits the current task state to the local `loctt` branch and (if `remote` and `auto_push` are set) pushes to the remote. Only call when the user has indicated they want to share or sync — not speculatively after routine edits. No parameters.

Output is prose: which of `Published local state to <branch> branch` / `No changes to publish`, and whether the push succeeded or `Published locally; remote push failed: <reason>`. The branch is named from config — it is not always `loctt`.

### `sync_from_git`

Pulls the `loctt` branch state into the local workspace. If a remote is configured and `auto_fetch` is set, fetches first. No parameters.

Output is prose: fetch result (or `Remote fetch failed: <reason>`), then either `Synced loctt branch into local workspace` or `Already up to date`.

When both sides changed the same task fields since the last sync, `publish_to_git` / `sync_from_git` do not pick a winner: they open a reconciliation and return the conflicts (task, field, both values, and a drift note when a value references config missing locally), stating nothing was written. Resolution is web-UI-primary — tell the user to resolve it in Settings → Sync; the operation completes after they Apply.

### `get_reconcile_status`

Returns structured JSON for an in-progress reconciliation, or `{ "in_progress": false }` when none. When in progress, reports `mode`, `base_commit`, `remote_commit`, `started_at`, and a `conflicts` array — each with `task_key`, `field`, `field_label`, `kind`, `local`, `remote`, and `remote_drift` / `local_drift` (the reason a value references config or a task missing locally, else null) — plus `auto_merged` (fields that merged or converged without a conflict). No parameters. Use it to explain to the user what must be resolved before publish/sync can complete.
