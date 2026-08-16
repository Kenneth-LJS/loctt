# MCP Reference

LocTT's MCP server provides structured tools for AI agents to manage tasks via the Model Context Protocol. Each tool below lists its inputs, the shape of its output, and the common error modes the server returns.

## Agent Guidelines

- **Always use structured tools.** Never edit `task.md` frontmatter or any `.loctt/` config file directly via raw filesystem writes. The body of a task is editable only via `replace_task_body` and `append_task_body`.
- **Use `get_workflow_config` and the `*_list` tools to discover valid values.** Statuses, priorities, task types, relationship types, projects, labels, milestones, sprints, and users all live in config — read them before writing.
- **`delete_*` tools are hard-only and irreversible.** Every `delete_*` tool (`delete_task`, `delete_project`, `delete_label`, `delete_milestone`, `delete_sprint`, `delete_user`) requires `confirm: true`. For the reversible (soft) variant, use the matching `archive_*` tool — that's the same operation as the old soft path. `unarchive_*` brings them back.
- **Schema-version guard.** Every tool except `init` first calls `requireSupportedSchema`. If the tracker's `.schema-version` is missing or doesn't match this server, every route refuses with a clear error pointing at `loctt migrate`. The one exception is `migrate_schema`, which runs the migration over MCP; `loctt migrate` does the same from the CLI.
- **Archived semantics.** Archived entities (projects, labels, milestones, sprints, users, tasks) are hidden from default listings but remain valid references on existing tasks. Pass `include_archived: true` (or the equivalent flag) to surface them.
- **Validation failures are real.** If a structured operation rejects a value, do not bypass it by editing files; surface the error and ask the user.

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

### `doctor`

Runs diagnostic checks on the tracker. Output is human-prose lines of the form `[ok|warn|error] <name>: <message>`. Useful for surfacing problems to the user; not designed for chained tool calls.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `rebuild_index` | boolean | no | If true, rebuild the on-disk key index after checks. Use after manual frontmatter edits to a task's `key` or `key_history` (LocTT can't auto-detect this drift because the indexed task id is still present). |

## Tasks

### `create_task`

Create a new task. When the tracker has multiple projects, pass `project` to disambiguate; otherwise the server resolves the target project in this order:

1. **Explicit** — the `project` argument, if supplied.
2. **Per-user default** — the active user's `default_project` (set via `set_user_setting`).
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
| `body` | string | no | Initial markdown body |

Returns: `Created <KEY>: <title>`.

Errors: project resolution failures (no project specified and no default; unknown project key); workflow validation failures from `createTask`.

### `get_task`

Get a task by key or ID, optionally including the markdown body.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `ref` | string | yes | Task key (e.g. `T-1`) or ID |
| `include_body` | boolean | no | Include markdown body (default `true`) |

Returns JSON: all frontmatter fields, plus `relationships` (each as `{type, target, title?, status?, missing?}` — `target` is rendered as a user-facing key like `T-2` when resolvable, and `title`/`status` carry the target's live values so you need not call `get_task` per edge; deleted targets carry `missing: true`, retain the raw ID, and omit `title`/`status`), `attachments` (each as `{name, size, mime?}` — `mime` is derived from the filename extension and is omitted when the extension is unknown; consumers should treat its absence as `application/octet-stream`), and `body` when requested. The `relationships` key is omitted when empty.

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

### `list_views`

Lists saved views from `queries.yaml`. No parameters. Returns JSON `[{name, query}]`, or the prose `No saved views configured.` when the file is absent.

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

Reversible soft-delete and its inverse.

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

Returns: `Replaced <KEY> body.`.

### `append_task_body`

Append text to a task's markdown body.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `ref` | string | yes | Task key or ID |
| `text` | string | yes | Text to append |

Returns: `Appended to <KEY> body.`.

### `get_task_history`

Get the activity/history log for a task. Returns structured entries (newest first).

| Parameter | Type | Required | Description |
|---|---|---|---|
| `ref` | string | yes | Task key or ID |
| `limit` | number | no | Max entries to return (default: all) |

Returns JSON array of history entries.

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

A project is `{id, name, prefix}`. There is no slug: `id` is a ULID minted at creation and `name` is mutable display text.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Human-readable display name |
| `prefix` | string | yes | Task-key prefix, e.g. `BACKEND-` |
| `make_default` | boolean | no | If true, also set as workspace default |

Returns JSON `{id, name, prefix}`.

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

Permanently removes the project from `projects.yaml`. For projects with tasks, `remap_to` is **required** to migrate them to another project. Cannot delete the only project. The counter is preserved in `retired_keys` so a later create with the same prefix resumes numbering. **Always requires `confirm: true`.** Use `archive_project` for the reversible variant.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `project` | string | yes | Project id or name to delete |
| `confirm` | boolean | yes | Must be `true` to proceed |
| `remap_to` | string | no | Target project (id or name) for tasks in the deleted project |

Returns JSON `{id, remappedTaskCount}`.

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
| `email` | string | no | Email |
| `timezone` | string | no | IANA timezone |
| `switch_to_on_create` | boolean | no | Switch to this user after creation |

Returns the created user as JSON.

### `edit_user`

Avatars are not settable via MCP — use the CLI or web UI.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `ref` | string | yes | User UUID or name |
| `name` | string | no | New display name |
| `email` | string \| null | no | Pass `null` to clear |
| `timezone` | string | no | New IANA timezone |

### `archive_user` / `unarchive_user`

Soft-deletes / restores a user. Hides them from pickers without breaking historical task references. **Blocked when the target is the active user.**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `ref` | string | yes | User UUID or name |

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

## Milestones

### `list_milestones`

Returns the full milestones config JSON. Each milestone is `{id, name, target_date?}`; `id` is a ULID.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `progress` | boolean | no | Include per-milestone progress counts |

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

No parameters. Returns the full sprints config JSON. Each sprint is `{id, name, start_date, end_date, state, goal?}`; `id` is a ULID.

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

## Not on this surface

Deliberately absent from MCP, so an agent does not go looking:

- **Export (CSV / JSON)** — web only. `list_tasks` returns structured
  JSON, which is what an agent wants; export exists for the spreadsheet
  round-trip.

Bulk edits *are* available — see `bulk_update_tasks`.

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

| Parameter | Type | Required | Description |
|---|---|---|---|
| `ref` | string | yes | Task key or ID being moved |
| `before` | string | no | Sibling task to position before |
| `after` | string | no | Sibling task to position after |

Returns the result of the reorder as JSON (`{ rank, rebalanced }`). Errors via `ReorderError`; passing both `before` and `after` errors with the same mutually-exclusive message as `reorder_relationship`.

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

### `enable_git`

Enables git-backed mode for this tracker. Sets up a dedicated `loctt` branch, published via a temporary worktree. One-time infrastructure setup — only call when explicitly asked. No parameters.

### `disable_git`

Disables git-backed mode. Local task data is preserved. No parameters.

### `get_git_status`

No parameters. Returns JSON `{enabled, branch, remote, auto_push, auto_fetch, in_git_repo, last_synced_commit}` (the last entry is `null` when nothing has synced yet).

### `publish_to_git`

Commits the current task state to the local `loctt` branch and (if `remote` and `auto_push` are set) pushes to the remote. Only call when the user has indicated they want to share or sync — not speculatively after routine edits. No parameters.

Output is prose: which of `Published local state to loctt branch` / `No changes to publish`, and whether the push succeeded or `Published locally; remote push failed: <reason>`.

### `sync_from_git`

Pulls the `loctt` branch state into the local workspace. If a remote is configured and `auto_fetch` is set, fetches first. No parameters.

Output is prose: fetch result (or `Remote fetch failed: <reason>`), then either `Synced loctt branch into local workspace` or `Already up to date`.
