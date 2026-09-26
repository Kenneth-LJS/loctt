# MCP reference

LocTT ships an MCP server, so an AI agent can read and write your tracker
through structured tools — no bespoke API to build, no glue code. You run
one command; the agent gets the whole task surface.

This page is for the human wiring an agent up and deciding what it can do.
The agent itself does not read this page — it receives its own
instructions and tool schemas live from the server when it connects (see
[What the agent sees](#what-the-agent-sees)).

## Connect an agent

The server runs on stdio. Any MCP client launches it the same way:

```bash
loctt mcp
```

In an MCP client's config, register LocTT as a server whose command is
`loctt mcp`, run from the directory that holds your `.loctt/` tracker. For
example:

```json
{
  "mcpServers": {
    "loctt": {
      "command": "loctt",
      "args": ["mcp"]
    }
  }
}
```

The server operates on the tracker at its working directory. Point the
client at your project directory, or set `LOCTT_ROOT`.

**Without the CLI.** The same server ships on its own as `@loctt/mcp`,
whose command is `loctt-mcp` (it takes `--root <dir>` like the CLI):

```json
{
  "mcpServers": {
    "loctt": {
      "command": "npx",
      "args": ["-y", "@loctt/mcp"]
    }
  }
}
```

`loctt mcp` and `loctt-mcp` run the same code: the same tools, the same
instructions, and the same refusal of a tracker written by a newer LocTT.

## How an agent works with the tracker

Three rules shape every correct interaction, and they are the same three
the server tells the agent on connect:

1. **Structured tools only — never hand-edit files.** Task metadata is
   changed through the update tools; a body is changed through
   `replace_task_body` / `append_task_body`. Editing `task.md` frontmatter
   or any `.loctt/` config file by hand bypasses validation and the
   history log.
2. **Stored values are config keys, not labels.** A status is
   `in_progress`, not "In progress". Before writing any enum field
   (status, priority, task type, relationship, custom field), the agent
   calls **`get_workflow_config`** to learn the valid keys, and the
   `list_*` tools to learn valid references (projects, labels, users, …).
3. **Deletes are hard; prefer archive.** Every `delete_*` tool is
   irreversible and requires `confirm: true`. The reversible
   `archive_*` / `unarchive_*` pair is almost always the right choice.
   Before removing anything from the workflow config, the agent calls
   `get_workflow_key_usage` to see how many tasks a change would touch.

## Example flows

These transcripts show the tools in their natural habitat — a person
asking, the agent calling tools, the tracker answering. They are
illustrative, not a fixed script.

### Create a task with the right enum keys

```
User: Add a high-priority bug for the login crash.

Agent → get_workflow_config()
     ← { statuses: [{key:"backlog"},{key:"in_progress"},…],
         priorities: [{key:"high",…}], task_types:[{key:"bug",…}], … }

Agent → create_task({ title: "Login page crashes on empty password",
                      priority: "high", task_type: "bug" })
     ← Created WEB-12: Login page crashes on empty password
```

The agent reads the workflow first so it writes `high` / `bug`, the stored
keys, rather than guessing at labels.

### Find work, then update it safely

```
User: What's blocked, and can you bump the top one to in progress?

Agent → list_tasks({ query: "has_link(\"is_blocked_by\") and status != done",
                     sort: "priority", direction: "desc" })
     ← [ { key: "WEB-3", title: "Fix login crash", status: "backlog" }, … ]

Agent → update_task({ ref: "WEB-3", field: "status", value: "in_progress" })
     ← Updated WEB-3: set status = in_progress
```

### Concurrency-safe body edit

```
Agent → get_task({ ref: "WEB-3", include_body: true })
     ← { …, body: "Steps to reproduce…", body_token: "a1b2c3" }

Agent → append_task_body({ ref: "WEB-3", text: "\nRoot cause: null auth callback.",
                           expected_token: "a1b2c3" })
     ← Appended to WEB-3 body.
```

Passing `expected_token` makes the write refuse rather than clobber a
concurrent edit. Omit it and the last write wins.

### Delete safely — check the blast radius first

```
User: Remove the "wontfix" label.

Agent → get_workflow_key_usage()
     ← { … }              # how many tasks reference each key

Agent → delete_label({ label: "wontfix", confirm: true, remap_to: "backlog" })
```

## Tool catalogue

Every tool returns a text result; where a tool returns data it is JSON.
`ref` accepts a task key (`WEB-3`) or its internal id. Enum values are
config keys — discover them with `get_workflow_config` and the `list_*`
tools.

### Discovery — call these first

| Tool | Purpose |
|---|---|
| `get_workflow_config` | The valid statuses, priorities, task types, relationships, and custom fields, each with its key and label. Call before writing any enum field. |
| `get_workflow_key_usage` | How many tasks reference each workflow key. Call before proposing a deletion from the workflow config. |
| `get_calendar` | Timezone, working days, and holidays (read-only; configured in the UI). |
| `list_palette_colors` | The built-in palette: every entry's `id` plus its `light` and `dark` values. Call before writing a `{"palette": "<id>"}` color — the ids are a fixed built-in set, so do not guess them. |
| `list_views` | Saved views (address a view by id — views that shared a name before names became unique still load, and an ambiguous name does not resolve). Returns each view's ordered `filters` plus a display-only `summary`. Takes `archived` (`active` default hides archived, `archived` = only archived, `all` = both); broken views are always returned. |

### Tasks

| Tool | Purpose | Key params |
|---|---|---|
| `get_task` | One task, optionally with body and a `body_token` for safe writes. | `ref`, `include_body` (default true) |
| `list_tasks` | Query/filter tasks. | `query`, `view`, `project`, `sort`, `direction`, `limit`, `offset`, `archived` (`active` default / `archived` / `all`) |
| `export_tasks` | Export matching tasks as CSV or JSON (a report, not a backup). | `format`, `query`, `view`, `project`, `columns`, `include_body`, `include_archived` |
| `create_task` | Create a task. | `title`, `project`, `status`, `priority`, `task_type`, `assignee`, `reporter`, `due_date`, `start_date`, `estimate`, `milestone`, `sprint`, `labels`, `body`, `parent` |
| `update_task` | Set one writable field. | `ref`, `field`, `value` |
| `unset_field` | Clear one field. | `ref`, `field` |
| `bulk_update_tasks` | Set or clear one field across many tasks in one operation. | `refs` (≤500), `field`, `value` (omit to clear) |
| `duplicate_task` | Copy a task to a new key (no relationships/attachments). | `ref`, `title`, `project` |
| `move_task` | Reallocate tasks to another project; old keys still resolve. | `refs` (≤500), `project` |
| `archive_task` / `unarchive_task` | Reversible soft-delete and restore, one or many tasks in one operation. Tasks already in the target state are counted as unchanged; a bad ref is reported without aborting the rest. | `refs` (≤500) |
| `delete_task` | Permanent delete of one or many tasks in one operation. Requires `confirm`. A bad ref is reported without aborting the rest. | `refs` (≤500), `confirm` |
| `get_task_history` | Paginated activity log, newest first. | `ref`, `limit`, `offset` |

A task file that will not parse is an error that names the file and the
line, never "not found". When a key matches nothing and some task files
could not be read, LocTT cannot tell whether the task exists, so the
error says so and lists each unreadable file once, as `path: reason`.

### Body

| Tool | Purpose | Key params |
|---|---|---|
| `append_task_body` | Append to the markdown body. | `ref`, `text`, `expected_token` |
| `replace_task_body` | Replace the markdown body. Stored ending in one newline, whether or not `body` ends in one. | `ref`, `body`, `expected_token` |

`expected_token` is the `body_token` from a `get_task` read; pass it to
refuse a stale write.

**Do not normalize the body's syntax.** A body is markdown plus a small
set of LocTT extensions, documented in
`docs/dev/reference/markdown-extensions.md`. Two are easy to mistake for
mistakes and "fix":

- **`<ins>text</ins>` is underline**, not an edit-tracking annotation.
  The tag is borrowed deliberately: it is the only one that both
  survives GitHub's HTML sanitiser and underlines by default. Rewriting
  it to `<u>` **destroys the formatting silently** — GitHub strips `u`.
  Markdown inside it is ordinary markdown, so leave `**bold**` as
  asterisks rather than converting the run to HTML.
- **`==text==` is highlight**, not an equality operator.

The same applies to `^sup^`, `~sub~` (single tilde), `$math$`,
`@user:<id>` and `![[attachments/…]]`. Rewriting any of them loses user
content.

### Relationships

| Tool | Purpose | Key params |
|---|---|---|
| `link_tasks` | Add a relationship from one or many sources to a single target (written on both sides of each edge, one operation). Each edge is committed independently; a bad source is reported without aborting the rest, and an unresolvable target fails every source. | `refs` (≤500), `type`, `target` |
| `unlink_tasks` | Remove a relationship (written on both sides). Takes a single source. | `ref`, `type`, `target` |

### Reordering

Ordering a task among its peers — its links, its board column, or across
columns. Kept separate from relationships so it is findable when the
starting point is a task, not a link.

| Tool | Purpose | Key params |
|---|---|---|
| `reorder_relationship` | Reorder a target among a source's links of one type. | `source`, `type`, `target`, `before`/`after` |
| `reorder_board` | Reorder a task within its board column. | `ref`, `before`/`after` |
| `move_board_card` | Move a task to another column and position in one write. | `ref`, `status`, `before`, `after` |

### Comments

| Tool | Purpose | Key params |
|---|---|---|
| `list_comments` | A task's comments, in order. | `ref` |
| `post_comment` | Add a comment as the current user (resolves `@user:<id>` mentions). | `ref`, `body` |
| `edit_comment` | Replace a comment's body (records the editor). | `ref`, `comment_id`, `body` |
| `delete_comment` | Permanently remove a comment. Requires `confirm`. | `ref`, `comment_id`, `confirm` |

### Attachments

| Tool | Purpose | Key params |
|---|---|---|
| `attach_file` | Copy a local file (inside the tracker root) into a task's attachments. | `ref`, `source_path`, `force` |
| `detach_file` | Remove an attachment by name. | `ref`, `name` |

### Saved views

| Tool | Purpose | Key params |
|---|---|---|
| `create_view` | Create a saved view (filters validated on write). A name matching another view's (trimmed, case-insensitive, archived and broken views included) is rejected: `Another view with that name already exists.` | `name`, `filters`, `sort`, `archivedScope`, `icon`, `color` |
| `edit_view` | Change a view (`sort: null` clears the sort, `icon: null` clears the icon, `color: null` clears the colour). Renaming to another view's name is rejected as on `create_view`; keeping the view's own name is always allowed. Also repairs a broken view. | `view`, `name`, `filters`, `sort`, `archivedScope`, `icon`, `color`, `replaceBroken` |
| `archive_view` / `unarchive_view` | Hide or restore a view (still runnable by id when archived). Refused for a broken view. | `view` |
| `delete_view` | Permanently remove a view. Requires `confirm`. | `view`, `confirm`, `replaceBroken` |

#### The `filters` array

A view is an **ordered list of filters that all AND together**. The list is
the sole source of truth for what the view matches: it is stored exactly as
supplied, never merged into a single DSL string and never reordered. Each
entry is one of two shapes, discriminated on `kind`:

| Shape | Fields | Use for |
|---|---|---|
| `simple` | `kind: "simple"`, `field`, `op`, `values` (array of strings) | Everything you can express as one field/operator/value row. |
| `advanced` | `kind: "advanced"`, `query` (a DSL fragment) | Only what a simple filter cannot express — parentheses, `or`, mixed boolean nesting. |

**Prefer `simple`.** A view authored over MCP should still reopen as
editable dropdown rows in the web picker; a `simple` filter carries no
query text, so it always does, while an `advanced` filter renders as
opaque DSL.

`op` is one of `=`, `!=`, `<`, `<=`, `>`, `>=`, `~`, `in`, `not in`,
`is empty`, `is not empty`. Several `values` under `=` mean "is any of";
under `!=` they mean "is none of". The postfix operators (`is empty`,
`is not empty`) take no values — pass `[]`.

An advanced filter's DSL is validated on write, so a malformed one is
rejected rather than poisoning the catalog, and it is **spacing**-normalized:
`status=a` comes back as `status = a`. Only spacing changes — no operator
rewriting, no negation flipping, no reordering, no paren removal.

```json
{
  "name": "My open bugs",
  "filters": [
    { "kind": "simple", "field": "task_type", "op": "=", "values": ["bug"] },
    { "kind": "simple", "field": "status", "op": "!=", "values": ["done"] },
    { "kind": "advanced", "query": "(due_date < today or priority = high)" }
  ],
  "sort": [{ "field": "priority", "direction": "desc" }]
}
```

On `edit_view`, supplying `filters` **replaces the whole ordered list** —
there is no partial patch, because order is meaningful. To change one row,
call `list_views`, modify that array, and send it back whole. Omitting
`filters` leaves the view's filters untouched.

`archivedScope` (`active` / `archived` / `all`) is the view's **own** scope —
whether it looks at active, archived, or all tasks. It is a property of the
view, never a filter term, and is unrelated to the `archived` param on
`list_views`, which scopes the *listing of views*.

`list_views` returns `{id, name, filters, summary, sort?, archivedScope?,
icon?, color?, archived?}`. `summary` is a human-readable one-line rendering of the
filters, **for display only** — never parse it, never store it, and never
send it back as input. Edit a view by passing a new `filters` array. A view
whose stored filters no longer parse comes back as `{id, name, summary,
broken: true, error, position?}`.

#### A view's icon and colour

`icon` is either a named icon (`"circle-check"`) or a **single** emoji.
Two emoji, or an emoji combined with other characters, are **rejected** —
`"🎈"` and `"👨‍👩‍👧"` are each one character and fine, `"🎈🎈"` and
`"🎈A"` are not. Do not concatenate emoji to make a compound icon.

`color` is the standard three-shape colour: `"#rrggbb"`,
`{"light": "#rrggbb", "dark": "#rrggbb"}`, or `{"palette": "<id>"}`
(call `list_palette_colors` for the valid ids, and do not guess them). Pass
`color: null` on `edit_view` to clear it.

The colour tints a **named** icon only. An emoji carries its own colour
and is never tinted, so a colour set alongside an emoji icon is stored
but not applied — it applies again if the icon changes to a named one. A
colour that is not one of the three shapes is dropped on load (the view
still works) and reported by `loctt doctor`.

#### Repairing a broken view (`replaceBroken`)

A view returned with `broken: true` is still in `queries.yaml` — its
stored `filters` did not load, and its original text is preserved on disk
untouched by every other view write. It is the only record of what the
user meant, so **do not assume the view is empty and do not recreate it**.

`edit_view` and `delete_view` can act on such a view, but only with
`replaceBroken: true`, which is your consent to discard that preserved
text:

- `edit_view` with `replaceBroken: true` **replaces** the entry with the
  `filters` you supply, keeping the **same id** (so pins and other by-id
  references survive). It keeps the old `name` unless you pass a new one.
  Nothing else of the old entry carries over.
- `delete_view` needs both `confirm: true` (the gate on every delete) and
  `replaceBroken: true` (consent to discard the text).
- Without `replaceBroken`, both are rejected with a message naming the
  view and the reason. Nothing is written.
- `archive_view` / `unarchive_view` are **refused** outright for a broken
  view — hiding a view whose filters do not load would imply it works.
  There is no flag that unlocks them.

Prefer telling the user their file is broken and showing them the error
over replacing it on your own initiative; the alternative to replacing is
that they fix `queries.yaml` by hand and keep what they wrote.

`replaceBroken` has no effect on a healthy view.

### Labels, milestones, sprints

Each family follows the same shape: `list_*` (with `q`, `limit`, `offset`,
the tri-state `archived` scope, and `progress` for milestones/sprints),
`create_*`, `edit_*`,
`archive_*` / `unarchive_*`, and `delete_*` (which requires `confirm` and
takes an optional `remap_to`).

Every config-entity list (`list_labels`, `list_milestones`, `list_sprints`,
`list_projects`, `list_users`, and `list_views`) takes the same tri-state
`archived` param: `active` (the default) hides archived entities,
`archived` returns only archived, and `all` returns both.

| Family | List | Create key params | Notable |
|---|---|---|---|
| Labels | `list_labels` | `name`, `color` | `list_labels` takes `q`, `limit`, `offset`, `archived`. `delete_label` remaps or drops the label from every task. `color` takes any of the three shapes — see [Colors](#colors). |
| Milestones | `list_milestones` | `name`, `target_date` | `list_milestones` takes `q`, `limit`, `offset`, `archived`, `progress`; `{progress:true}` adds done/total per milestone. |
| Sprints | `list_sprints` | `name`, `start_date`, `end_date`, `state`, `goal` | `list_sprints` takes `q`, `limit`, `offset`, `archived`, `progress`. `get_sprint_burndown` returns the burndown series. `edit_sprint` moves `state` from any state to any state (there is no `force`). An `end_date` before `start_date` is rejected: `End date is before the start date.` |

### Projects

| Tool | Purpose | Key params |
|---|---|---|
| `list_projects` | Projects, with the workspace default marked. | `q`, `limit`, `offset`, `archived` |
| `create_project` | New project (unique prefix and slug). | `name`, `prefix`, `slug`, `make_default` |
| `edit_project` | Rename a project. | `project`, `name` |
| `set_project_prefix` | Change the prefix, renaming every task's key. Requires `confirm`. | `project`, `prefix`, `confirm` |
| `archive_project` / `unarchive_project` | Hide or restore a project. | `project` |
| `delete_project` | Permanent delete; requires `remap_to` or `clear_project_field`. Requires `confirm`. | `project`, `confirm`, `remap_to`, `clear_project_field` |
| `set_default_project` | Set or clear the workspace default. | `project` (omit to clear) |

### Users

| Tool | Purpose | Key params |
|---|---|---|
| `list_users` | Registered users (current user marked). | `q`, `limit`, `offset`, `archived` |
| `get_current_user` | The active user's profile. | — |
| `switch_user` | Change the active user. | `ref` |
| `create_user` / `edit_user` | Create or edit a user (avatars via CLI/UI only). | `name`, `email`, `timezone`, … |
| `archive_user` / `unarchive_user` | Hide or restore a user. | `ref` |
| `count_user_references` | How many tasks reference a user, by role. | `ref` |
| `delete_user` | Permanent delete; requires `remap_to` or `unassign`. Requires `confirm`. | `ref`, `confirm`, `remap_to`, `unassign` |

Per-user settings, sidebar layout and keyboard shortcuts have their own
read/write tools: `get_user_settings`, `get_sidebar_groups`,
`set_sidebar_groups`, `sweep_sidebar_pins`, `get_keyboard_shortcuts`,
`set_keyboard_shortcuts`. The `resolved` list the sidebar-groups tools return is
in the order the sidebar shows it: the built-in filters follow `filters`,
and read `hidden: true` while `filters` is hidden.

The keyboard-shortcut tools read and set the single-key shortcut switches
(the web Settings → Keyboard). `set_keyboard_shortcuts` takes
`single_key` (the master switch), `off` and `on` (lists of shortcut ids:
`new-task`, `focus-search`, `goto`, `toggle-sidebar`, `cycle-theme`,
`shortcut-help`), or `reset: true` alone to turn everything back on. An
unknown id is rejected and nothing is written. Both tools return
`single_key` and each shortcut's `keys`, `on` (its own switch) and
`active` (whether it fires now). Keys are fixed; they can be switched
off, not rebound.

### Configuration and machine-local settings

| Tool | Purpose |
|---|---|
| `get_config_value` / `set_config_value` / `unset_config_value` | Read and write machine-local config (currently `git.*` keys). |
| `list_config_values` | All known config keys with values, types, and descriptions. |
| `get_workflow_key_usage` | Task counts per workflow key (see Discovery). |

### Colors

Every entity that carries a color — a label, status, priority, task
type, relationship, or custom-field enum value — accepts **three
shapes**. MCP speaks JSON, so the accepted input *is* the stored wire
form: a value read out of `get_workflow_config` or `list_labels` can be
written straight back unchanged.

| Shape | JSON value | Meaning |
|---|---|---|
| Single | `"#1e6fcb"` | One color, used in **both** light and dark mode. |
| Per-mode | `{"light": "#CC6600", "dark": "#F0A868"}` | An explicit color per mode. Both keys are required. |
| Palette | `{"palette": "teal"}` | A reference to a built-in palette entry, which carries its own light/dark pair. |

This applies to `color` on `create_label` / `edit_label`, to
`fields.color` on `edit_workflow_entity`, and to `color` inside each
entry of `fields.values[]` when seeding an enum field.

**Call `list_palette_colors` before using a palette reference.** The ids
are a fixed built-in set defined by LocTT, not by the tracker, and they
appear in no other tool's output — guessing one produces an entity that
renders as a neutral color. An unknown id is stored rather than
rejected, so a guess fails quietly rather than loudly. The set currently
holds **18 entries**, every pair perceptually distinct in both modes, so
distinct palette ids give entities that stay tellable apart in either
theme — but call the tool rather than relying on that count.

**A palette reference is live.** The stored value is the id, never a
resolved hex, so an entity set to `{"palette": "teal"}` follows the
palette if the palette changes.

On an edit, pass `null` to clear a color. A malformed color (for example
`{"light": "#CC6600"}` with no `dark`) is rejected with an error naming
the three shapes — it is never partially written.

### Workflow configuration (editing)

The read side is `get_workflow_config` (see Discovery) — like `list_views`,
call it first to see the current keys. The write side is one consolidated
tool plus two singleton tools:

| Tool | Purpose |
|---|---|
| `edit_workflow_entity` | Create, edit, delete, or reorder a workflow.yaml **collection** entity — a status, priority, task type, relationship, custom field, custom-field enum value, or board column. Dispatched on `{ entity, op }`. |
| `set_estimation_config` | Configure the estimation singleton (`enabled`, `unit`, `unit_label`, `scale`, `preset_values`, `weights`). |
| `set_timeline_config` | Configure the timeline singleton (`dependency_relationship`, `default_zoom`, `show_arrows`, `default_grouping`). |

`edit_workflow_entity` params: `entity` and `op` (required); `key` (the
entity key, required for `edit`/`delete`, and the **new** key on
`create`; unused by `reorder`); `field` (the parent custom-field key,
required only for `entity: "custom_field_value"`); `fields` (the
create/edit payload, whose shape depends on the entity — `label`,
`category`, `icon`, `color`, `kind`, `inverse`, `type`, `multi`,
`task_types`, `statuses`, `wip`, `values`, … — `color` takes any of the
three shapes in [Colors](#colors)); `remap_to` (delete-in-use
target key, or `null` to clear the value from every task); `order` (the
full ordered key list, for `reorder`); `confirm` (must be `true` for
`delete`, matching every other `delete_*` tool).

**Entity / op matrix** (an illegal combination is refused with the legal
set named):

| Entity | create | edit | delete | reorder | Notes |
|---|:---:|:---:|:---:|:---:|---|
| `status` | ✓ | ✓ | ✓ | ✓ | delete-in-use needs `remap_to` |
| `priority` | ✓ | ✓ | ✓ | ✓ | `value` is never settable — it is derived from list order, so `reorder` is how ranking (and value) changes |
| `task_type` | ✓ | ✓ | ✓ | ✓ | delete-in-use needs `remap_to` |
| `relationship` | ✓ | ✓ | ✓ | — | no reorder; delete-in-use needs `remap_to` |
| `custom_field` | ✓ | ✓ | ✓ | — | delete is **clear-only** — it rejects `remap_to`; `type`/`multi` are immutable after create; an enum field needs `fields.values: [{key,label}, …]` at create |
| `custom_field_value` | ✓ | ✓ | ✓ | ✓ | needs `field` (parent field key); delete-in-use needs `remap_to` |
| `board_column` | ✓ | ✓ | ✓ | ✓ | delete carries no remap (columns hold no task data) |

Keys are immutable everywhere: an `edit` cannot rename (a `key` inside
`fields` is refused), because a rename is delete + create. These tools
call the same core functions the CLI and web settings use, so a status
created here is indistinguishable from one created there.

### Git-backed mode

| Tool | Purpose |
|---|---|
| `enable_git` / `disable_git` | Turn git-backed mode on or off. `enable_git` takes `adopt` for an existing LocTT branch. |
| `get_git_status` | Enabled state, branch, remote, and drift in both directions. |
| `publish_to_git` | Commit (and push) local state to the branch. |
| `sync_from_git` | Fetch and reconcile the branch into the workspace. |
| `get_reconcile_status` | Details of an in-progress reconcile: each conflict's `task_id`, `task_key`, field, and both values; delete-vs-edit rows; auto-merged fields. Read this before `resolve_reconcile`. |
| `resolve_reconcile` | Apply per-conflict decisions and complete the blocked publish/sync. Requires `confirm`; a surfaced rekey needs `confirm_rekey`. |
| `abandon_reconcile` | Discard the in-progress reconcile, leaving local files as they are. Requires `confirm`. |

**Resolving a reconcile from MCP.** When `publish_to_git` or
`sync_from_git` reports a reconciliation is needed, the conflicts can be
resolved from any surface — CLI (`loctt git reconcile apply/abandon`), the
web UI (Settings → Sync), or MCP:

1. `get_reconcile_status` — lists each conflict with its `task_id`, `field`,
   and both values, plus any delete-vs-edit rows (a whole-task keep-deletion
   / keep-task choice carried by the reserved field `__delete_vs_edit__`).
2. `resolve_reconcile` — pass `decisions`, one per conflict: `{ taskId,
   field, choice }` where `choice` is `local`, `remote`, or `value` (with a
   typed third value in `value`). This is the same decision shape the CLI's
   `--decisions <file.json>` takes. **`confirm: true` is required** — keeping
   one side discards the other. If completing the sync then hits a key
   collision that must be renumbered, the tool reports the rekey preview and
   stops unless **`confirm_rekey: true`** is also passed; re-call with it to
   renumber and finish. A partial apply keeps the reconcile open with the
   successes journalled, so a re-call retries only the unwritten rows.
3. `abandon_reconcile` (`confirm: true`) — discards the pending decisions and
   the record of what must be resolved, leaving local files exactly as they
   are (not a revert). The blocked publish/sync does not complete; re-run it
   to re-plan.

### Tracker and backup

| Tool | Purpose | Key params |
|---|---|---|
| `info` | Prose summary of the tracker. | — |
| `doctor` | Diagnostic checks; each check may carry a `fix` (`rebuild-index` or `restore-missing`) naming its programmatic repair. `rebuild_index` rebuilds the key cache; `restore_missing` recreates missing core config/state files with defaults (existence-guarded — never overwrites surviving data). | `rebuild_index`, `restore_missing` |
| `init` | Bootstrap a new tracker. An empty `.loctt/` folder is filled in like a missing one. | `prefix`, `project_label`, `no_docs`, `timezone` |
| `migrate_schema` | Preview (`confirm:false`) or apply (`confirm:true`) a schema upgrade. | `confirm` |
| `backup` | Whole-tracker JSONL backup. Requires `confirm`. | `output`, `no_history`, `split_bytes`, `confirm` |
| `restore` | Restore a backup (`bare`/`merge`/`overwrite`). Requires `confirm` unless `dry_run`. | `files`, `mode`, `dry_run`, `confirm` |

## What the agent sees

You do not paste any of this page into your agent. On connect, the server
supplies:

- **Instructions** — the short guidance the agent receives about using
  LocTT (the three rules above, in condensed form).
- **Tool schemas** — every tool's name, description, and parameter schema,
  which the agent reads directly.

So an agent already "knows" the tools and the rules without you configuring
anything. This page exists so *you* know what it can do.
