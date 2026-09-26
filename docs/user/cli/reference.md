# CLI reference

`loctt` is the command-line interface to a LocTT tracker. Every command
operates on the `.loctt/` directory found at the current working
directory, or at the path given by `--root`.

This page is the source of truth for commands and flags. The
[Quick Start](../quickstart.md) links here for detail; nothing else
repeats these tables.

## Conventions

- **Invocation.** Task operations are top-level commands (`loctt create`,
  `loctt list`, `loctt set`), not a `loctt task …` group. A few areas are
  grouped: `project`, `user`, `label`, `milestone`, `sprint`, `config`,
  `git`, `views`, `calendar`, and the workflow families `status`,
  `priority`, `task-type`, `relationship`, `custom-field`, `board-column`,
  `estimation`, `timeline`.
- **Flags** take the form `--flag value` or `--flag=value`. There are no
  single-dash short flags. `--` ends flag parsing; anything after it is a
  literal positional. A value that begins with `-` must use the `=` form
  (`--limit=-3`). When a flag is repeated, the last one wins, except where
  a flag is documented as repeatable.
- **Boolean flags** may be written bare (`--archived`) or with an explicit
  value (`--archived=false`, also `true/1/0/yes/no/on/off`).
- **`--root <dir>`** selects the tracker to act on. It defaults to the
  `LOCTT_ROOT` environment variable, then to the current directory. It is
  valid on every command. `--cwd` is an accepted alias.
- **Exit codes.** `0` success (or a confirmation you declined); `1` a
  runtime or domain error (validation, I/O, not found, schema mismatch);
  `2` a usage error (bad arguments or flags). Set `LOCTT_DEBUG=1` for
  stack traces.
- **Schema guard.** Most commands refuse to run against a tracker whose
  on-disk schema is older than this `loctt` and point you to
  `loctt migrate`. `init`, `migrate`, `doctor`, `info`, `mcp`, `ui`,
  `help` and `--version` are exempt.
- **Machine-readable output.** `loctt init` accepts `--json` and
  `--quiet`. Elsewhere, use `loctt export --format json` and
  `loctt sprint burndown --format json`.

---

## Setup

### `loctt init`

Create a new tracker in `.loctt/`. Idempotent — it writes only the files
that are missing, so it is safe to re-run. An empty `.loctt/` folder (no
config, no state, no tasks) is filled in exactly like a missing one, with
no extra flag or step.

| Flag | Value | Default | Description |
|---|---|---|---|
| `--prefix` | prefix | `T` | Key prefix for the starting project. Rendered as `T-1`, `T-2`, … |
| `--project-label` | text | — | Name of the starting project. |
| `--timezone` | IANA zone | this machine's zone | Workspace timezone. Decides what "today" means. |
| `--no-docs` | — | docs written | Skip writing the helper docs into `.loctt/docs/`. |
| `--repair` | — | off | Restore files missing from an existing `.loctt/` without touching the ones that survive. |
| `--json` | — | off | Print a machine-readable summary instead of prose. |
| `--quiet` | — | off | Suppress the guidance text. Errors still print. |

```bash
loctt init --prefix WEB --project-label "Web App"
```
```
Initialized .loctt at /Users/you/project
Created 11 files

Next steps:
  Create a task:   loctt create "<title>"
  Open the web UI: loctt ui
  Read the docs:   .loctt/docs/
```

---

## Tasks

### `loctt create <title>`

Create a task. The target project is resolved from `--project`, then your
per-user default, then the workspace default, then the sole project if
there is only one.

| Flag | Value | Default | Description |
|---|---|---|---|
| `--project` | key, name, or id | resolved default | Project to create the task in. |
| `--status` | status key | — | Initial status. |
| `--priority` | priority key | — | Priority. |
| `--type` | type key | — | Task type. |
| `--assignee` | user | — | Assignee. |
| `--reporter` | user | — | Reporter. |
| `--start` | date | — | Start date. |
| `--due` | date | — | Due date. |
| `--estimate` | estimate | — | Estimate. |
| `--milestone` | milestone | — | Milestone. |
| `--sprint` | sprint | — | Sprint. |
| `--label` | label | — | Label. Repeatable: `--label a --label b`. |
| `--body` | markdown | — | Initial body text. |
| `--parent` | key or id | — | Link the new task under a parent on the configured tree axis. |

`--status`, `--priority`, and `--type` are validated against the
workflow; an unknown value is an error.

```bash
loctt create "Fix login crash" --priority high --type bug --label urgent
```
```
Created WEB-1: Fix login crash
```

### `loctt list`

List tasks. Rows print to stdout; warnings about unreadable task files or
broken config print to stderr and do not change the exit code.

| Flag | Value | Default | Description |
|---|---|---|---|
| `--query` | DSL | — | Ad-hoc query (see [Query language](../common/query-language.md)). |
| `--view` | name or id | — | A saved view. |
| `--project` | name or id | all | Restrict to one project. |
| `--sort` | field | — | Sort field. |
| `--dir` | `asc` or `desc` | `asc` | Sort direction. |
| `--limit` | integer | — | Maximum rows. |
| `--offset` | integer | `0` | Rows to skip, applied after sorting. |
| `--archived` | — | off | Include archived tasks. |

```bash
loctt list --query "status = in_progress" --sort priority --dir desc
```
```
WEB-3  Fix login crash [in_progress]
WEB-7  Rate-limit the API [in_progress]
```

A `⚠` before a key marks a task with a corrupt field; the task still
lists. An empty result prints `No tasks found.`

### `loctt show <task>`

Show one task in full: its fields, relationships (with child progress),
attachments, any health warnings, and its body.

The body is printed **verbatim**, with no markdown rendering. Bodies
written in the web editor may contain LocTT's markdown extensions, which
therefore appear as their source spelling — `<ins>underlined</ins>`,
`==highlighted==`, `^sup^`, `~sub~`, `$math$`. That is expected, not
corruption; see `docs/dev/reference/markdown-extensions.md`.

```bash
loctt show WEB-3
```
```
WEB-3: Fix login crash
Status: in_progress
Priority: high
Type: bug
Assignee: Jordan
Labels: urgent

Relationships:
  is_blocked_by → WEB-5

Steps to reproduce…
```

A task file that will not parse is an error that names the file and the
line, never "not found". When a key matches nothing and some task files
could not be read, LocTT cannot tell whether the task exists, so the
error says so and lists each unreadable file once, as `path: reason`.

### `loctt set <task> <field> <value>`

Set one field on a task. `<task>` may be a comma-separated list
(`WEB-1,WEB-2`) to set the same field on several tasks at once. Enum
fields (status, priority, type) are validated.

```bash
loctt set WEB-3 status done
```
```
Set status = done on WEB-3
```

### `loctt unset <task> <field>`

Clear a field. `<task>` may be comma-separated for a bulk clear.

```bash
loctt unset WEB-3 assignee
```
```
Unset assignee on WEB-3
```

### `loctt body <task>`

Read or write a task's body. With no write flag, it prints the current
body.

| Flag | Value | Default | Description |
|---|---|---|---|
| `--set` | markdown | — | Replace the body. Stored ending in one newline, whether or not the text ends in one. Mutually exclusive with `--append`. |
| `--append` | markdown | — | Append to the body. |
| `--expect` | token | — | Write only if the body still matches this token (optimistic concurrency). |
| `--token` | — | — | Print the current body's token and exit. |

```bash
loctt body WEB-3 --append "Root cause: unhandled null in the auth callback."
```
```
Appended to body for WEB-3
```

If `cli.require_body_token` is set in the workflow config, a body write
must carry `--expect`.

### `loctt log <task>`

Show a task's history, newest first.

| Flag | Value | Default | Description |
|---|---|---|---|
| `--limit` | integer | — | Maximum entries. |
| `--offset` | integer | `0` | Entries to skip. |

```bash
loctt log WEB-3 --limit 3
```

### `loctt duplicate <task>`

Copy a task's fields and body to a new key. Relationships and attachments
are not copied.

| Flag | Value | Default | Description |
|---|---|---|---|
| `--title` | text | source title | Title for the copy. |
| `--project` | name or id | source project | Project for the copy. |

```bash
loctt duplicate WEB-3 --title "Fix login crash (mobile)"
```
```
Created WEB-9: Fix login crash (mobile)
```

### `loctt move <task>[,<task>…] <project>`

Reallocate one or more tasks to another project, issuing new keys under
that project's prefix. The old key is retired but still resolves.

```bash
loctt move WEB-9 mobile
```
```
Moved WEB-9 → MOB-4
```

### `loctt delete <task>[,<task>…]`

Permanently delete one or more tasks. `<task>` may be a comma-separated
list (`WEB-9,WEB-10`) to delete several at once, as a single operation.
Destructive; it prompts for confirmation once for the whole set. To hide
a task reversibly instead, use [`loctt archive`](#loctt-archive-task--loctt-unarchive-task).

| Flag | Value | Default | Description |
|---|---|---|---|
| `--yes` | — | off | Skip the prompt. Required when there is no interactive terminal. |

```bash
loctt delete WEB-9 --yes
```
```
Deleted WEB-9
```

With several refs, a bad ref is reported without aborting the rest and
the command exits non-zero:

```bash
loctt delete WEB-9,WEB-404 --yes
```
```
Deleted on 1 task(s)
1 failed:
  WEB-404: task not found
```

### `loctt archive <task>[,<task>…]` · `loctt unarchive <task>[,<task>…]`

Soft-delete one or more tasks or restore them. `<task>` may be a
comma-separated list to archive/unarchive several at once, as a single
operation. Archived tasks are hidden from lists unless you pass
`--archived`. A task already in the target state is a no-op counted as
"already in that state"; a bad ref is reported without aborting the rest.

```bash
loctt archive WEB-3
```
```
Archived WEB-3
```
```bash
loctt archive WEB-3,WEB-4
```
```
Archived on 2 task(s)
```

### `loctt link <task>[,<task>…] <relationship> <target>` · `loctt unlink …`

Create or remove a relationship between tasks. The link is written on
both sides. The relationship type is validated against the workflow.
`<task>` may be a comma-separated list of sources — each is linked to the
one `<target>` with the same relationship type, as a single operation
(reported per source; a bad source is reported without aborting the
rest). `unlink` still works when the target has been deleted, and takes a
single source.

```bash
loctt link WEB-3 is_blocked_by WEB-5
```
```
Linked WEB-3 --is_blocked_by--> WEB-5
```
```bash
loctt link WEB-3,WEB-4 is_blocked_by WEB-5
```
```
Linked --is_blocked_by--> WEB-5 on 2 task(s)
```

### `loctt attach <task> <file>` · `loctt detach <task> <name>`

Attach a file to a task or remove one.

| Command | Flag | Description |
|---|---|---|
| `attach` | `--force` | Overwrite an attachment of the same name. |

```bash
loctt attach WEB-3 ./screenshot.png
```
```
Attached screenshot.png (48213 bytes) to WEB-3
```

### `loctt rerank <source> <relationship> <target>`

Reorder a task among its siblings under a relationship.

| Flag | Value | Description |
|---|---|---|
| `--before` | task | Place before this sibling. |
| `--after` | task | Place after this sibling. |

`--before` and `--after` are mutually exclusive; with neither, the target
moves to the end.

### `loctt board-rerank <task>` · `loctt board-move <task>`

Reorder a task within its board column, or move it to another column and
position in one step.

| Command | Flag | Value | Description |
|---|---|---|---|
| `board-rerank` | `--before` / `--after` | task | New position (mutually exclusive). |
| `board-move` | `--status` | status key | Destination column. |
| `board-move` | `--before` / `--after` | task | Position within the column. |

```bash
loctt board-move WEB-3 --status in_progress --after WEB-7
```
```
Moved WEB-3 to in_progress (rank=…)
```

### `loctt export`

Export tasks as CSV or JSON — a report for a spreadsheet, not a backup
(it cannot restore). This and the `export_tasks` MCP tool are the only
surfaces that offer it: the web UI does not export.

| Flag | Value | Default | Description |
|---|---|---|---|
| `--format` | `csv` or `json` | `csv` | Output format. |
| `--query` | DSL | — | Filter the exported set. |
| `--view` | name or id | — | Export a saved view. |
| `--project` | name or id | — | Restrict to one project. |
| `--columns` | `a,b,c` | default set | Columns to include. |
| `--body` | — | off | Include the task body. |
| `--archived` | — | off | Include archived tasks. |
| `--output` | file | stdout | Write to a file instead of stdout. |

```bash
loctt export --format json --query "status != done" --output open.json
```
```
Exported 12 task(s) to open.json (json).
```

A CSV or JSON export is a report, not a backup — see
[`loctt backup`](#loctt-backup-file).

---

## Saved views

### `loctt views`

List saved views, or manage them with a subcommand.

| Subcommand | Synopsis | Description |
|---|---|---|
| `list` | `loctt views list [--archived <active\|archived\|all>]` | List saved views (the default). `--archived` defaults to `active` (archived hidden); `archived` = only archived, `all` = both (`--all` is a deprecated alias for `all`). Broken views are always shown. |
| `create` | `loctt views create <name> [--filter "…"]… [--query "<dsl>"]… [--sort …] [--archived <scope>] [--icon <icon>] [--color <colour>]` | Create a view. |
| `edit` | `loctt views edit <name\|id> [--name <new>] [--filter "…"]… [--query "<dsl>"]… [--sort …\|-] [--archived <scope>] [--icon <icon>] [--color <colour>\|-] [--force]` | Change a view. `--sort -` clears the sort, `--color -` clears the colour. `--force` replaces a **broken** view (see below). |
| `archive` / `unarchive` | `loctt views archive <name\|id>` | Hide or restore a view. Refused for a broken view. |
| `delete` | `loctt views delete <name\|id> [--yes] [--force]` | Permanently delete a view. `--force` is required for a **broken** view. |

`list` prints one line per view, `<name>  <summary>`, with a
`[sort: …]` suffix when the view has a sort, the colour when it has one,
and ` (archived)` when it is archived. The summary is a readable
rendering of the view's filters — it is for display only, and is not
something you can paste back in as input.

#### Names are unique

A view's name must not match another view's name. The comparison ignores
case and leading or trailing spaces, and archived and broken views count.
`views create` with a taken name, or `views edit --name` to one, fails
with `Another view with that name already exists.` and writes nothing.
Editing a view without changing its name is always allowed.

Views that already shared a name before this rule (or after a hand edit
of `queries.yaml`) still load and list. `loctt list --view <name>` refuses
an ambiguous name (`Multiple views named '<name>'. Refer by id instead.`),
so run such a view by its id, or rename one of them with
`loctt views edit <id> --name <new>`.

#### Icon and colour

`--icon` takes either a named icon (`circle-check`) or a **single**
emoji. Two emoji, or an emoji combined with other characters, are
rejected — `🎈` and `👨‍👩‍👧` are each one character and fine, `🎈🎈`
and `🎈A` are not.

`--color` takes the same three forms as everywhere else:
`#rrggbb`, `palette:<id>` (see `loctt palette`), or
`light:#rrggbb,dark:#rrggbb`. `--color -` clears it.

The colour tints a **named** icon only. An emoji already carries its own
colour and cannot be tinted, so the colour is stored but not applied
while the icon is an emoji — switch back to a named icon and it applies
again. A colour that is not one of the three forms is dropped on load
(the view still works) and reported by `loctt doctor`.

#### Repairing a broken view (`--force`)

If you hand-edit `queries.yaml` and one entry's `filters` no longer load,
LocTT does **not** discard it. The entry keeps its place in the file and
`views list` shows it marked `[broken: …]` with the reason. Your original
text stays on disk untouched by every other view write.

Because that text is the only record of what you meant, replacing or
deleting the entry needs an explicit `--force`:

```bash
# Refused — names the view, the reason, and what to do:
loctt views edit broken-one --filter "status = done"

# Replaces the stored text with the filters you give. Same view id, so
# pins and anything else referring to it by id survive.
loctt views edit broken-one --filter "status = done" --force

# Deletes it outright — the original text does not survive.
loctt views delete broken-one --yes --force
```

`--yes` and `--force` are different consents: `--yes` skips the
interactive prompt every hard delete has, while `--force` is your
agreement to discard the preserved original text.

To keep the text instead, edit `queries.yaml` by hand and fix the entry
there — LocTT never rewrites it for you.

`views archive` and `views unarchive` are **refused** for a broken view:
hiding a view whose filters do not load would suggest it still works.
Fix it, replace it, or delete it.

A healthy view is unaffected by any of this — `--force` changes nothing
about editing or deleting one.

**Running a broken view.** `loctt list --view <broken-one>` (by name or
id) is refused, not widened to an unfiltered list:

```bash
$ loctt list --view broken-one
Error: saved view "broken-one" cannot run: [0].op must be one of: =, !=, in, not in, is empty, is not empty
```

This mirrors the web list's `broken_view` banner and MCP's `list_tasks`
refusal — all three surfaces name the parse fault rather than reporting
"unknown view" (the view exists; its filters just do not load) or
silently returning every task in the tracker.

#### Building a view's filters

A view is an **ordered list of filters that all AND together**. You build
that list with `--filter` and `--query`:

- `--filter "field op value"` — one simple filter row.
- `--query "<dsl>"` — one advanced filter holding a DSL fragment.

**Both flags are repeatable, and they interleave in the order you type
them.** That order is exactly what gets stored — the list is never merged
into a single query string and never reordered.

Prefer `--filter`. A simple filter reopens as an editable dropdown row in
the web UI; a `--query` filter shows there as opaque DSL. Use `--query`
only for what a simple filter cannot express — parentheses, `or`, or mixed
boolean nesting.

`--filter` grammar is `"field op value"`. Operators are `=`, `!=`, `<`,
`<=`, `>`, `>=`, `~`, `in`, `not in`, `is empty`, `is not empty`. Values
are comma-separated for multi-value filters, and the postfix operators take
no value at all:

```bash
loctt views create "My open bugs" \
  --filter "task_type = bug" \
  --filter "status != done" \
  --query "(due_date < today or priority = high)" \
  --sort priority:desc
```
```
Created view "My open bugs" (id 01J…)
```

```bash
loctt views create "Triage" \
  --filter "status = backlog,in_progress" \
  --filter "assignee is empty"
```

`--sort` is a comma-separated list of `field[:asc|:desc]` (a bare field
sorts ascending). On `edit`, `--sort -` clears the sort.

On `edit`, supplying any `--filter`/`--query` **replaces the view's whole
filter list** — there is no partial patch, because the order is meaningful.
Pass the full set you want. Supplying neither flag leaves the existing
filters untouched.

A `--query` fragment is validated on write, so an unparseable one is
rejected rather than saved. It is stored **spacing**-normalized:
`--query "status=a"` comes back as `status = a`. Only spacing changes —
nothing else about the text is rewritten.

#### `--archived` means two different things

The same flag name carries a different meaning per subcommand:

| Subcommand | Meaning |
|---|---|
| `views list --archived <scope>` | Scopes **the listing** — which saved views are shown (`active` hides archived views, `archived` shows only those, `all` shows both). |
| `views create --archived <scope>` / `views edit --archived <scope>` | Sets **the view's own scope** — a stored field on the view controlling whether *the view itself* looks at active, archived, or all tasks when it runs. It is **not** a filter. |

So `loctt views create "Done work" --archived all` creates a view that
searches archived tasks too; it says nothing about whether that view is
hidden from `views list`. Use `views archive` for that.

`--icon <icon>` sets an optional display icon on the view.

---

## Labels

| Subcommand | Synopsis | Notes |
|---|---|---|
| `list` | `loctt label list [--archived <active\|archived\|all>] [--ids] [--filter q] [--limit n] [--offset n]` | `--archived` defaults to `active` (archived hidden); `archived` = only archived, `all` = both. `--all` is a deprecated alias for `--archived all`. `--limit` default 100, max 1000. |
| `create` | `loctt label create <name> [--color <color>]` | See [Colors](#colors) for the three `<color>` shapes. |
| `edit` | `loctt label edit <name\|id> [--name] [--color <color\|->]` | `--color -` clears the color. |
| `archive` / `unarchive` | `loctt label archive <name\|id>` | |
| `delete` | `loctt label delete <name\|id> [--remap-to <other>] [--yes]` | Removes the label from every task, or remaps it. Prompts. |

```bash
loctt label create urgent --color "#B02F17"
loctt label create infra --color "palette:teal"
loctt label create docs --color "light:#CC6600,dark:#F0A868"
```
```
Created label "urgent" (id 01J…)
```

---

## Milestones

| Subcommand | Synopsis | Notes |
|---|---|---|
| `list` | `loctt milestone list [--archived <active\|archived\|all>] [--ids] [--progress] [--filter q] [--limit n] [--offset n]` | `--archived` defaults to `active` (archived hidden); `archived` = only archived, `all` = both (`--all` is a deprecated alias for `all`). `--progress` scans tasks for a done/total count. |
| `create` | `loctt milestone create <name> [--target-date <YYYY-MM-DD>]` | |
| `edit` | `loctt milestone edit <name\|id> [--name] [--target-date <date\|->] [--archived <true\|false>]` | `--target-date -` clears the date. |
| `archive` / `unarchive` | `loctt milestone archive <name\|id>` | |
| `delete` | `loctt milestone delete <name\|id> [--remap-to <other>] [--yes]` | Clears or remaps the milestone field on affected tasks. Prompts. |

```bash
loctt milestone create "v1.0 Launch" --target-date 2026-12-01
```
```
Created milestone "v1.0 Launch" (id 01J…)
```

---

## Sprints

| Subcommand | Synopsis | Notes |
|---|---|---|
| `list` | `loctt sprint list [--archived <active\|archived\|all>] [--ids] [--progress] [--filter q] [--limit n] [--offset n]` | `--archived` defaults to `active` (archived hidden); `archived` = only archived, `all` = both (`--all` is a deprecated alias for `all`). |
| `create` | `loctt sprint create <name> --start <date> --end <date> [--state <active\|completed\|future>] [--goal <text>]` | `--state` defaults to `future`. Dates are `YYYY-MM-DD`. An end before the start is refused: `End date is before the start date.` (on `edit` too). |
| `edit` | `loctt sprint edit <name\|id> [--name] [--start] [--end] [--state] [--goal <text\|->]` | `--goal -` clears the goal. `--state` moves a sprint from any state to any state, including reopening a completed one. |
| `archive` / `unarchive` | `loctt sprint archive <name\|id>` | |
| `delete` | `loctt sprint delete <name\|id> [--remap-to <other>] [--yes]` | Clears or remaps the sprint field. Prompts. |
| `burndown` | `loctt sprint burndown <name\|id> [--format <table\|json>]` | `--format` defaults to `table`. |

```bash
loctt sprint create "Sprint 12" --start 2026-06-01 --end 2026-06-14 --state active
```
```
Created sprint "Sprint 12" (id 01J…)
```

---

## Projects

| Subcommand | Synopsis | Notes |
|---|---|---|
| `list` | `loctt project list [--archived <active\|archived\|all>] [--ids] [--filter q] [--limit n] [--offset n]` | `--archived` defaults to `active` (archived hidden); `archived` = only archived, `all` = both (`--all` is a deprecated alias for `all`). A `*` marks the workspace default. |
| `create` | `loctt project create <name> --prefix <prefix> [--slug <slug>] [--default]` | `--default` makes it the workspace default. |
| `edit` | `loctt project edit <name\|id> --name <new>` | |
| `set-prefix` | `loctt project set-prefix <name\|id> <new-prefix> [--yes]` | Renames every task's key. Numbers are preserved; old keys keep resolving. Prompts with the count. |
| `archive` / `unarchive` | `loctt project archive <name\|id>` | |
| `delete` | `loctt project delete <name\|id> [--remap-to <name\|id> \| --clear-project-field] [--yes]` | Moves tasks to another project or clears their project field. Prompts. |
| `set-default` | `loctt project set-default <name\|id\|->` | `-` clears the workspace default. |

```bash
loctt project create "Mobile App" --prefix MOB --default
```
```
Created project "Mobile App" (slug mobile-app, prefix MOB, id 01J…)
```

---

## Users

| Subcommand | Synopsis | Notes |
|---|---|---|
| `list` | `loctt user list [--archived <active\|archived\|all>] [--filter q] [--limit n] [--offset n]` | `--archived` defaults to `active` (archived hidden); `archived` = only archived, `all` = both (`--all` is a deprecated alias for `all`). A `*` marks the current user. |
| `current` | `loctt user current` | Print the current user. |
| `switch` | `loctt user switch <id-or-name>` | Change the current user. |
| `create` | `loctt user create <name> [--email] [--timezone] [--avatar <path>] [--switch]` | `--switch` makes the new user current. |
| `edit` | `loctt user edit <id-or-name> [--name] [--email] [--timezone] [--avatar <path> \| --remove-avatar]` | |
| `settings` | `loctt user settings [--sweep-pins]` | Print per-user settings. `--sweep-pins` drops pins for deleted views. |
| `sidebar-groups` | `loctt user sidebar-groups [--order <ids> \| --hidden <ids> \| --reset]` | Read or set the sidebar layout. Prints each id with `visible` or `hidden`, in the order the sidebar shows them: the built-in filters follow `filters`, and read `hidden` while `filters` is hidden. |
| `shortcuts` | `loctt user shortcuts [--single-key on\|off] [--off <id>...] [--on <id>...] [--reset]` | Read or set the single-key shortcut switches (the web Settings → Keyboard). Prints `single-key on\|off`, then one line per shortcut: id, keys, `on` or `off`, and what it does. `--off` and `--on` repeat or take comma-separated ids (`new-task`, `focus-search`, `goto`, `toggle-sidebar`, `cycle-theme`, `shortcut-help`); an unknown id is refused, and so is `--single-key`, `--off` or `--on` given without a value (exit 2). `--single-key off` turns them all off and keeps each one's own switch. `--reset` turns everything back on. Keys are fixed. |
| `archive` / `unarchive` | `loctt user archive <id-or-name>` | |
| `references` | `loctt user references <id-or-name>` | Count where the user is assignee or reporter. |
| `delete` | `loctt user delete <id-or-name> [--remap-to <id-or-name> \| --unassign] [--yes]` | Reassigns or clears the user's references. Prompts. |

```bash
loctt user create "Jordan" --email jordan@example.com --switch
```
```
Created user Jordan (01J…)
Switched to Jordan (01J…)
```

---

## Comments

| Command | Synopsis | Notes |
|---|---|---|
| `comment` | `loctt comment <task> <text…>` | Add a comment as the current user. Requires a current user. |
| `comments` | `loctt comments <task>` | List a task's comments, oldest first. |
| `comment-edit` | `loctt comment-edit <task> <comment-id> <text…>` | Edit a comment. |
| `comment-delete` | `loctt comment-delete <task> <comment-id> [--yes]` | Delete a comment. Prompts. |

```bash
loctt comment WEB-3 "Confirmed on staging — shipping the fix today."
```
```
Added comment 01J… on WEB-3
```

---

## Configuration

| Subcommand | Synopsis | Description |
|---|---|---|
| `get` | `loctt config get <key>` | Print a config value. |
| `set` | `loctt config set <key> <value>` | Set a value. |
| `unset` | `loctt config unset <key>` | Clear a value. |
| `list` | `loctt config list` | List all config keys and values. |
| `usage` | `loctt config usage` | Count how many tasks reference each workflow value. |

```bash
loctt config usage
```

---

## Git-backed mode

Git-backed mode publishes the tracker to a `loctt` branch in the repo you
already have. Nothing new to install, no third-party sync service.

| Subcommand | Synopsis | Description |
|---|---|---|
| `enable` | `loctt git enable [--adopt]` | Turn on git-backed mode. `--adopt` confirms adopting an existing LocTT branch. |
| `disable` | `loctt git disable` | Turn it off. |
| `status` | `loctt git status` | Show branch, remote, sync state, and pending changes. |
| `publish` | `loctt git publish [--dry-run]` | Commit and push local state to the branch. `--dry-run` runs preflight only. |
| `sync` | `loctt git sync` | Fetch and reconcile the branch into your workspace. |
| `reconcile` | `loctt git reconcile <status\|apply\|abandon>` | Inspect, apply, or discard an in-progress reconcile. `apply` reads `--decisions <file.json>`. |

```bash
loctt git enable
loctt git publish
```

---

## Calendar

### `loctt calendar show`

Print the workspace calendar: timezone, first day of the week, working
days, and holidays. The calendar is read-only from the CLI; edit it in
the web UI.

```bash
loctt calendar show
```

---

## Colors

Anything that carries a color — a label, status, priority, task type,
relationship, or custom-field enum value — accepts **three shapes**, and
`--color` spells each one differently:

| Shape | `--color` value | Meaning |
| --- | --- | --- |
| Single | `#1e6fcb` | One color, used in **both** light and dark mode. |
| Palette | `palette:teal` | A reference to a built-in palette entry, which carries its own light/dark pair. |
| Per-mode | `light:#CC6600,dark:#F0A868` | An explicit color for each mode. Both halves are required; order does not matter. |

A bare hex is the original format, so every file written before colors
gained the other two shapes still works unchanged — there is no
migration.

**A palette reference is live.** `palette:teal` stores the *id*, not
teal's current value, so if the palette changes, everything referencing
it follows. Nothing stores a resolved hex.

On `edit`, `--color -` clears the color entirely.

### Listing the palette

`palette:<id>` needs a valid id, so the built-in list is printed by:

```bash
loctt palette                  # id, label, light, dark — tab-separated
loctt palette --format json    # the same entries as JSON
loctt palette | cut -f1        # just the ids
```

There are **18 entries**. Every pair is perceptually distinct in both
light and dark mode, so two entities given different palette colors stay
tellable apart in either theme.

An id that is not in the list is **not** rejected — it is stored, and a
warning is printed — but it renders as a neutral color until corrected.

### How colors are printed

`list` has no way to know whether your terminal is light or dark, so it
never picks a mode for you. It prints what is stored:

```
#1e6fcb                          a single color
light:#CC6600,dark:#F0A868       a per-mode pair
palette:teal (#0F766E/#39A88F)   a palette ref, with what it resolves to now
palette:nosuch (unknown)         a palette id that does not exist
```

The first two are printed exactly as you would type them, so a value
read out of `list` can be pasted straight back into `edit`. A palette
line can be pasted back too — the trailing `(…)` is ignored.

---

## Workflow configuration

The workflow — statuses, priorities, task types, relationships, custom
fields, board columns, and the estimation and timeline settings — lives
in `.loctt/config/workflow.yaml`. These commands edit it the same way the
web settings panels do (they call the same core functions), so a change
made here and one made in the UI are indistinguishable.

Rules that hold across every family:

- **Keys are immutable.** `add` fixes the key; `edit` has no `--key` and
  no rename. A rename is a delete followed by a create.
- **`edit` never changes the key** (nor a custom field's `--type` /
  `--multi`, which are fixed at creation).
- **`rm` of an in-use entity refuses** unless you pass `--remap-to <key>`
  (move every task's value onto another key) — except custom-field whole
  deletes, which are clear-only (no remap). `rm` prompts for
  confirmation; pass `--yes` to skip it (required non-interactively).
- **`reorder` takes a comma-separated list of every key, once.** For
  priorities this is the *only* way to set the numeric `value` — it is
  derived from list position, never passed as a flag.

### `loctt status`

| Subcommand | Usage | Notes |
| --- | --- | --- |
| `list` | `loctt status list` | Key, category, label, icon/color, default. |
| `add` | `loctt status add <key> --label <text> --category <pending\|active\|completed\|discarded> [--default] [--icon <s>] [--color <color>]` | |
| `edit` | `loctt status edit <key> [--label] [--category] [--default] [--icon <s\|->] [--color <color\|->]` | `-` clears icon/color. |
| `rm` | `loctt status rm <key> [--remap-to <key>] [--yes]` | |
| `reorder` | `loctt status reorder <key,key,…>` | |

### `loctt priority`

| Subcommand | Usage | Notes |
| --- | --- | --- |
| `list` | `loctt priority list` | Shows the derived `[value]`. |
| `add` | `loctt priority add <key> --label <text> [--icon <s>] [--color <color>]` | No `--value`. Appends at the bottom. |
| `edit` | `loctt priority edit <key> [--label] [--icon <s\|->] [--color <color\|->]` | No `--value`. |
| `rm` | `loctt priority rm <key> [--remap-to <key>] [--yes]` | |
| `reorder` | `loctt priority reorder <key,key,…>` | Sets the value from position (top = 1). |

### `loctt task-type`

| Subcommand | Usage | Notes |
| --- | --- | --- |
| `list` | `loctt task-type list` | |
| `add` | `loctt task-type add <key> --label <text> [--icon <s>] [--color <color>]` | |
| `edit` | `loctt task-type edit <key> [--label] [--icon <s\|->] [--color <color\|->]` | |
| `rm` | `loctt task-type rm <key> [--remap-to <key>] [--yes]` | |
| `reorder` | `loctt task-type reorder <key,key,…>` | |

### `loctt relationship`

No `reorder` (relationships have no order).

| Subcommand | Usage | Notes |
| --- | --- | --- |
| `list` | `loctt relationship list` | |
| `add` | `loctt relationship add <key> --label <text> [--kind <directional\|symmetric>] [--inverse <key>] [--inverse-label <text>] [--graph <none\|acyclic\|tree>] [--ranked] [--icon <s>] [--color <color>]` | |
| `edit` | `loctt relationship edit <key> [--label] [--kind] [--inverse] [--inverse-label] [--graph] [--ranked] [--icon <s\|->] [--color <color\|->]` | |
| `rm` | `loctt relationship rm <key> [--remap-to <key>] [--yes]` | |

### `loctt custom-field`

Whole-field `rm` is **clear-only** — there is no `--remap-to`; the field
and any stored values are cleared from every task. An **enum** field must
be seeded with at least one value at creation via `--enum-value`
(repeatable).

| Subcommand | Usage | Notes |
| --- | --- | --- |
| `list` | `loctt custom-field list` | Fields and their enum values. |
| `add` | `loctt custom-field add <key> --label <text> --type <string\|number\|date\|boolean\|enum> [--multi] [--searchable] [--task-types a,b] [--enum-value key=label]…` | `--enum-value` required (and only allowed) for `enum`. |
| `edit` | `loctt custom-field edit <key> [--label] [--searchable[=true\|false]] [--task-types a,b\|-]` | No `--type` / `--multi` (immutable). `--task-types -` clears the scope. |
| `rm` | `loctt custom-field rm <key> [--yes]` | Clear-only. |
| `value <field> add` | `loctt custom-field value <field> add <key> --label <text> [--icon <s>] [--color <color>]` | Enum values only. |
| `value <field> edit` | `loctt custom-field value <field> edit <key> [--label] [--icon <s\|->] [--color <color\|->]` | |
| `value <field> rm` | `loctt custom-field value <field> rm <key> [--remap-to <key>] [--yes]` | Remap onto another value of the same field. |
| `value <field> reorder` | `loctt custom-field value <field> reorder <key,key,…>` | |

### `loctt board-column`

Board columns only group statuses for the board view — deleting one
never orphans a task, so `rm` takes no remap. Deleting the last column
reverts the board to one column per status.

| Subcommand | Usage | Notes |
| --- | --- | --- |
| `list` | `loctt board-column list` | |
| `add` | `loctt board-column add <key> --label <text> --statuses <s,s,…> [--wip <n>]` | |
| `edit` | `loctt board-column edit <key> [--label] [--statuses <s,s,…>] [--wip <n\|->]` | `--wip -` clears the limit. |
| `rm` | `loctt board-column rm <key> [--yes]` | No remap. |
| `reorder` | `loctt board-column reorder <key,key,…>` | |

### `loctt estimation`

A singleton (no add/delete). `set` needs at least `--enabled` and
`--unit` when estimation is not yet configured.

| Subcommand | Usage |
| --- | --- |
| `show` | `loctt estimation show` |
| `set` | `loctt estimation set [--enabled[=true\|false]] [--unit <points\|hours\|days\|custom_numeric\|custom_enum>] [--unit-label <text\|->] [--scale <free\|linear\|fibonacci\|->] [--preset <a,b,c\|->] [--weight key=n]…` |

`--weight` is repeatable (one per category, for `custom_enum` units);
pass `--weight -` to clear all weights. `-` clears the optional fields.

```bash
loctt estimation set --enabled --unit custom_enum --unit-label Size \
  --preset S,M,L --weight S=1 --weight M=3 --weight L=5
```

### `loctt timeline`

A singleton. `--dependency-relationship -` is the explicit "no dependency
arrows" value (distinct from unset); `-` clears the other fields.

| Subcommand | Usage |
| --- | --- |
| `show` | `loctt timeline show` |
| `set` | `loctt timeline set [--dependency-relationship <key\|->] [--default-zoom <day\|week\|month\|->] [--show-arrows[=true\|false]] [--default-grouping <builtin\|field.key\|->]` |

---

## Backup and restore

### `loctt backup <file>`

Write a complete tracker backup (tasks, bodies, comments, attachments,
history, config, and state) as JSONL.

| Flag | Value | Default | Description |
|---|---|---|---|
| `--output` | file | the positional `<file>` | Output path. |
| `--no-history` | — | history included | Exclude history. |
| `--split-bytes` | integer | — | Split into parts larger than this many bytes. |

```bash
loctt backup tracker-backup.jsonl
```
```
Wrote tracker-backup.jsonl
```

### `loctt restore <file…>`

Restore from one or more backup files.

| Flag | Value | Description |
|---|---|---|
| `--merge` | — | Add only ids that are absent. Mutually exclusive with `--overwrite`. |
| `--overwrite` | — | Replace ids the backup carries. |
| `--dry-run` | — | Report what would happen without writing. |

Without `--merge` or `--overwrite`, restore refuses to run against a
non-empty tracker.

`--overwrite` can replace current tasks, so **take a fresh
[`loctt backup`](#loctt-backup-file) first** and preview with `--dry-run`
before running it for real.

```bash
loctt restore tracker-backup.jsonl --dry-run
```

---

## Diagnostics

| Command | Synopsis | Description |
|---|---|---|
| `info` | `loctt info` | A prose summary of the tracker. Safe to run before `init`. |
| `doctor` | `loctt doctor [--rebuild-index]` | Run diagnostic checks. `--rebuild-index` rebuilds the key-lookup cache after out-of-band edits. |
| `schema` | `loctt schema` | Print the workflow config: prefix, statuses, priorities, types, relationships, custom fields. |
| `migrate` | `loctt migrate [--dry-run] [--yes]` | Upgrade the tracker's schema. Backs up `.loctt/` first. |

```bash
loctt doctor
```
```
✓ Tracker directory present
✓ Key index consistent
✓ All task files parse
```

`doctor` exits `1` if any check is an error; warnings leave the exit code
at `0`.

---

## Running the servers

### `loctt mcp`

Start the MCP server on stdio. It runs until the client disconnects. This
is what an MCP client launches to give an agent access to the tracker —
see the [MCP reference](../mcp/reference.md).

### `loctt ui`

Start the web UI. It runs in the foreground until you stop it with
Ctrl-C. The web UI ships inside the `loctt` package, so nothing else
needs to be installed. If its files are missing (a damaged install), the
command exits `1` with "The web UI files are missing from this install.
Reinstall loctt."

| Flag | Value | Default | Description |
|---|---|---|---|
| `--port` | 1–65535 | `4321` | Port to serve on. |
| `--no-open` | — | opens a browser | Do not open a browser automatically. |

```bash
loctt ui --port 8080
```
```
LocTT UI running at http://localhost:8080
Press Ctrl-C to stop.
```

---

## Help

`loctt --version` prints the installed version (for example `0.1.0`) and
exits `0`. It needs no tracker.

`loctt help`, `loctt --help`, `loctt -h`, and `loctt` with no command all
print the top-level usage. An unknown command prints an error and the
usage, and exits `2`.
