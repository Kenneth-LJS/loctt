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
  `git`, `views`, `calendar`.
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
  `loctt migrate`. `init`, `migrate`, `doctor`, `info`, `mcp`, `ui`, and
  `help` are exempt.
- **Machine-readable output.** `loctt init` accepts `--json` and
  `--quiet`. Elsewhere, use `loctt export --format json` and
  `loctt sprint burndown --format json`.

---

## Setup

### `loctt init`

Create a new tracker in `.loctt/`. Idempotent — it writes only the files
that are missing, so it is safe to re-run.

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
Created 9 files

Next steps:
  loctt create "My first task"
  loctt list
  loctt ui
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

```bash
loctt show WEB-3
```
```
WEB-3: Fix login crash
Status:    in_progress
Priority:  high
Type:      bug
Assignee:  Jordan
Labels:    urgent

Relationships:
  is_blocked_by → WEB-5

Body:
  Steps to reproduce…
```

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
| `--set` | markdown | — | Replace the body. Mutually exclusive with `--append`. |
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

### `loctt delete <task>`

Permanently delete a task. Destructive; it prompts for confirmation.

| Flag | Value | Default | Description |
|---|---|---|---|
| `--yes` | — | off | Skip the prompt. Required when there is no interactive terminal. |

```bash
loctt delete WEB-9 --yes
```
```
Deleted WEB-9
```

### `loctt archive <task>` · `loctt unarchive <task>`

Soft-delete a task or restore it. Archived tasks are hidden from lists
unless you pass `--archived`.

```bash
loctt archive WEB-3
```
```
Archived WEB-3
```

### `loctt link <task> <relationship> <target>` · `loctt unlink …`

Create or remove a relationship between two tasks. The link is written on
both sides. The relationship type is validated against the workflow.
`unlink` still works when the target has been deleted.

```bash
loctt link WEB-3 is_blocked_by WEB-5
```
```
Linked WEB-3 --is_blocked_by--> WEB-5
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

Export tasks as CSV or JSON. The CSV is byte-for-byte identical to the
web UI's export.

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
Exported 12 task(s) to open.json
```

A CSV or JSON export is a report, not a backup — see
[`loctt backup`](#loctt-backup-file).

---

## Saved views

### `loctt views`

List saved views, or manage them with a subcommand.

| Subcommand | Synopsis | Description |
|---|---|---|
| `list` | `loctt views list` | List saved views (the default). |
| `create` | `loctt views create <name> --query "<dsl>" [--sort …]` | Create a view. |
| `edit` | `loctt views edit <name\|id> [--name] [--query] [--sort]` | Change a view. `--sort -` clears the sort. |
| `archive` / `unarchive` | `loctt views archive <name\|id>` | Hide or restore a view. |
| `delete` | `loctt views delete <name\|id> [--yes]` | Permanently delete a view. |

`--sort` is a comma-separated list of `field[:asc|:desc]` (a bare field
sorts ascending).

```bash
loctt views create "My open bugs" --query "type = bug and status != done" --sort priority:desc
```
```
Created view "My open bugs" (id 01J…)
```

A view stores its filter as structured *conditions*, and the `query`
string you see on `views list` is regenerated from them — it is
spacing-normalized, not a verbatim copy of what you typed. So
`--query "status=a"` is stored and shown back as `status = a`. An
unparseable `--query` is rejected on write, not saved.

---

## Labels

| Subcommand | Synopsis | Notes |
|---|---|---|
| `list` | `loctt label list [--all] [--ids] [--filter q] [--limit n] [--offset n]` | `--all` includes archived. `--limit` default 100, max 1000. |
| `create` | `loctt label create <name> [--color <hex>]` | |
| `edit` | `loctt label edit <name\|id> [--name] [--color <hex\|->]` | `--color -` clears the color. |
| `archive` / `unarchive` | `loctt label archive <name\|id>` | |
| `delete` | `loctt label delete <name\|id> [--remap-to <other>] [--yes]` | Removes the label from every task, or remaps it. Prompts. |

```bash
loctt label create urgent --color "#B02F17"
```
```
Created label "urgent" (id 01J…)
```

---

## Milestones

| Subcommand | Synopsis | Notes |
|---|---|---|
| `list` | `loctt milestone list [--all] [--ids] [--progress] [--filter q] [--limit n] [--offset n]` | `--progress` scans tasks for a done/total count. |
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
| `list` | `loctt sprint list [--all] [--ids] [--progress] [--filter q] [--limit n] [--offset n]` | |
| `create` | `loctt sprint create <name> --start <date> --end <date> [--state <active\|completed\|future>] [--goal <text>]` | `--state` defaults to `future`. |
| `edit` | `loctt sprint edit <name\|id> [--name] [--start] [--end] [--state] [--goal <text\|->] [--force]` | `--goal -` clears the goal. |
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
| `list` | `loctt project list [--all] [--ids] [--filter q] [--limit n] [--offset n]` | A `*` marks the workspace default. |
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
| `list` | `loctt user list [--all] [--filter q] [--limit n] [--offset n]` | A `*` marks the current user. |
| `current` | `loctt user current` | Print the current user. |
| `switch` | `loctt user switch <id-or-name>` | Change the current user. |
| `create` | `loctt user create <name> [--email] [--timezone] [--avatar <path>] [--switch]` | `--switch` makes the new user current. |
| `edit` | `loctt user edit <id-or-name> [--name] [--email] [--timezone] [--avatar <path> \| --remove-avatar]` | |
| `settings` | `loctt user settings [--sweep-pins]` | Print per-user settings. `--sweep-pins` drops pins for deleted views. |
| `sidebar-groups` | `loctt user sidebar-groups [--order <ids> \| --hidden <ids> \| --reset]` | Read or set the sidebar layout. |
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
Ctrl-C.

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

`loctt help`, `loctt --help`, `loctt -h`, and `loctt` with no command all
print the top-level usage. An unknown command prints an error and the
usage, and exits `2`.
