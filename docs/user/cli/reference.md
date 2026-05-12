# CLI Reference

Every `loctt` command exits with one of three codes:

| Code | Meaning |
|---|---|
| `0` | Success (also: user declined a confirm prompt) |
| `1` | Runtime error — validation, IO, schema mismatch, domain failure |
| `2` | Usage error — missing args, bad flag, mutually-exclusive flags |

Scripts can distinguish "you typed it wrong" (`2`) from "the operation failed"
(`1`) without parsing stderr.

Commands that touch an existing tracker fail if `.loctt/` is missing or its
schema doesn't match this CLI's version — run `loctt migrate` to upgrade. The
exceptions are `init`, `info`, and `doctor`, which work without (or before) a
tracker exists.

A `<task>` argument may be either a key (e.g. `T-12`) or an internal ID (ULID).

## Initialization and Info

### `loctt init`

Set up a new `.loctt/` directory with default configuration in the current
working directory. Does not require an existing tracker.

```
loctt init [--prefix <prefix>] [--project-key <key>] [--project-label <label>] [--no-docs]
```

| Flag | Description |
|---|---|
| `--prefix <prefix>` | Key prefix for the initial project (default: `T-`) |
| `--project-key <key>` | Key of the initial project (default derived from prefix) |
| `--project-label <label>` | Human label for the initial project |
| `--no-docs` | Skip generating helper docs in `.loctt/docs/` |

Example:

```
loctt init --prefix BUG- --project-key bugs --project-label "Bug tracker"
```

### `loctt info`

Display tracker status: directory path, task count, configured statuses, and
per-project counters (next key for each project; the workspace default is
marked with `*`). Works without a tracker — prints a hint to run `loctt init`.

```
loctt info
```

### `loctt doctor`

Run diagnostic checks on the `.loctt/` setup. Each check prints with `✓`,
`!`, or `✗`. Exits with code `1` if any check is in error state.

```
loctt doctor [--rebuild-index]
```

| Flag | Description |
|---|---|
| `--rebuild-index` | After running checks, rebuild the key-lookup cache from a full task scan |

The key-lookup cache (`.loctt/state/key-index.yaml`) is normally kept current by
LocTT itself: every create / git-sync rekey updates it, and ordinary lookups
fold-in any task directories that appeared out-of-band (e.g. via `git pull`).
The one drift case LocTT cannot auto-detect is a manual frontmatter edit that
changes an *existing* task's `key` or `key_history`. Run `loctt doctor` to
surface drift (the "key index" check turns to `!`), then rerun with
`--rebuild-index` to repair it.

### `loctt views`

List saved views from `.loctt/config/queries.yaml`. Prints `<name>  <query>`,
with a sort suffix when one is configured.

```
loctt views
```

### `loctt schema`

Print the workflow config: key prefix, statuses (with category), priorities,
task types, relationships (with inverses), and custom fields with their values.

```
loctt schema
```

## Projects

`loctt project <subcommand>` manages projects. Projects partition the key
space — each project has its own prefix and counter.

```
loctt project list [--all]
loctt project create <key> --prefix <prefix> [--label <label>] [--default]
loctt project edit <key> --label <label>
loctt project archive <key>
loctt project unarchive <key>
loctt project delete <key> [--hard] [--remap-to <other-key>]
loctt project set-default <key|->
```

`list` hides archived projects unless `--all` is passed. The workspace default
project is marked with `*`.

`delete` archives by default; `--hard` permanently removes. If the project has
tasks, `--remap-to <other-key>` is required to move them under another project.

`set-default` accepts `-` to clear the workspace default.

Examples:

```
loctt project create web --prefix WEB- --label "Website" --default
loctt project list --all
loctt project delete legacy --hard --remap-to archive
loctt project set-default -
```

## Users

`loctt user <subcommand>` manages users. The "current user" is who LocTT
attributes new tasks and history entries to.

```
loctt user list [--all]
loctt user current
loctt user switch <id-or-name>
loctt user create <name> [--email <e>] [--timezone <tz>] [--avatar <path>] [--switch]
loctt user edit <id-or-name> [--name <n>] [--email <e>] [--timezone <tz>] [--avatar <path>]
loctt user archive <id-or-name>
loctt user unarchive <id-or-name>
loctt user delete <id-or-name> [--remap-to <id-or-name> | --unassign]
```

`list` hides archived users unless `--all` is passed. The current user is
marked with `*`.

`create --switch` makes the new user the current user immediately after
creating them.

`delete` requires choosing what to do with tasks the user is referenced on:
either `--remap-to <other>` (move references) or `--unassign` (clear the
field). The two flags are mutually exclusive.

Examples:

```
loctt user create "Alex Chen" --email alex@example.com --timezone America/New_York --switch
loctt user switch alex
loctt user delete alex --remap-to bo
```

## Labels

`loctt label <subcommand>` manages labels (free-form tags).

```
loctt label list [--all]
loctt label create <key> [--label <label>] [--color <hex>]
loctt label edit <key> [--label <label>] [--color <hex|->]
loctt label archive <key>
loctt label unarchive <key>
loctt label delete <key> [--hard] [--remap-to <other>]
```

`edit --color -` clears an existing color.

`delete --hard` permanently removes the label. Without `--remap-to`, the key is
dropped from every task that has it; with `--remap-to <other>`, it's replaced.

Examples:

```
loctt label create blocker --label "Blocker" --color "#cc0000"
loctt label edit blocker --color -
loctt label delete blocker --hard --remap-to high-priority
```

## Milestones

`loctt milestone <subcommand>` manages milestones.

```
loctt milestone list [--all]
loctt milestone create <key> [--label <label>] [--target-date <YYYY-MM-DD>]
loctt milestone edit <key> [--label <label>] [--target-date <YYYY-MM-DD|->] [--archived <true|false>]
loctt milestone archive <key>
loctt milestone unarchive <key>
loctt milestone delete <key> [--hard] [--remap-to <other>]
```

`edit --target-date -` clears the target date. `--archived` accepts only the
literal strings `true` or `false`.

`delete --hard` clears the milestone field on all referenced tasks (or remaps
it to `--remap-to <other>`).

Examples:

```
loctt milestone create v1 --label "Version 1.0" --target-date 2026-06-30
loctt milestone edit v1 --target-date -
loctt milestone delete v0 --hard --remap-to v1
```

## Sprints

`loctt sprint <subcommand>` manages sprints.

```
loctt sprint list [--all]
loctt sprint create <key> --start <YYYY-MM-DD> --end <YYYY-MM-DD> [--state <active|completed|future>] [--label <l>] [--goal <g>]
loctt sprint edit <key> [--label <l>] [--start <d>] [--end <d>] [--state <s>] [--goal <g|->] [--force]
loctt sprint archive <key>
loctt sprint unarchive <key>
loctt sprint delete <key> [--hard] [--remap-to <other>]
```

`create --state` defaults to `future`. `edit --goal -` clears the sprint goal.

`edit --force` is required to re-open a completed sprint (move it from
`completed` back to `active` or `future`).

`delete --hard` clears the sprint field on all referenced tasks (or remaps
it to `--remap-to <other>`).

Examples:

```
loctt sprint create s24 --start 2026-05-01 --end 2026-05-14 --state active --goal "Ship login flow"
loctt sprint edit s24 --state completed
loctt sprint edit s24 --state active --force
```

## Calendar

### `loctt calendar show`

Print the calendar config: timezone, first day of week, working days, and
holidays.

```
loctt calendar show
```

## Task Management

### `loctt create`

Create a new task. The created key is printed.

```
loctt create <title> [--project <key>] [--status <s>] [--priority <p>] [--type <t>]
```

| Flag | Description |
|---|---|
| `--project <key>` | Target project. Required if no workspace default is set and there are multiple projects. |
| `--status <s>` | Initial status. Defaults to the first status in `workflow.yaml`. |
| `--priority <p>` | Priority key |
| `--type <t>` | Task type key |

Examples:

```
loctt create "Add login button"
loctt create "Fix crash on logout" --project web --priority high --type bug
```

### `loctt list`

List tasks with optional filtering. Without `--query` or `--view`, lists the
most recent tasks.

```
loctt list [--query <q>] [--view <v>] [--limit <n>] [--archived] [--project <key>]
```

| Flag | Description |
|---|---|
| `--query <q>` | Ad hoc query string (see [query-language.md](../common/query-language.md)) |
| `--view <v>` | Named saved view from `queries.yaml` |
| `--limit <n>` | Max results — non-negative integer |
| `--archived` | Include archived tasks (hidden by default) |
| `--project <key>` | Shorthand for adding `project = <key>` to the query |

`--project` and `--query` compose: the resulting filter is
`(<query>) and project = <key>`.

Examples:

```
loctt list
loctt list --view in-progress --limit 50
loctt list --query 'status = doing and assignee = me' --project web
loctt list --archived
```

### `loctt show`

Display a task's full details: metadata, relationships, attachments, and body.

```
loctt show <task>
```

Example: `loctt show T-1`

### `loctt set`

Set a field on a task. Works for both built-in fields (`status`, `priority`,
`assignee`, `due_date`, etc.) and custom fields.

```
loctt set <task> <field> <value>
```

Example: `loctt set T-12 status doing`

### `loctt unset`

Remove a field from a task.

```
loctt unset <task> <field>
```

Example: `loctt unset T-12 due_date`

### `loctt body`

View or update a task's markdown body.

```
loctt body <task> [--set <text>] [--append <text>]
```

Without flags, prints the current body (or `(empty body)`). `--set` replaces
the entire body. `--append` appends to it. The two flags are mutually
exclusive.

Examples:

```
loctt body T-12
loctt body T-12 --set "Repro: open app, click logout, observe crash."
loctt body T-12 --append $'\n## Update\nReproduced on staging.'
```

### `loctt log`

Print a task's history (most recent first).

```
loctt log <task> [--limit <n>]
```

Example: `loctt log T-12 --limit 20`

### `loctt attach`

Attach a file to a task. The file is copied into the task's directory under
`attachments/`.

```
loctt attach <task> <file-path> [--force]
```

`--force` overwrites an attachment with the same name. Without it, the command
fails if the name is already taken.

Example: `loctt attach T-12 ./screenshot.png`

### `loctt detach`

Remove an attachment by name.

```
loctt detach <task> <name>
```

`<name>` must be a plain basename — no path separators or `..`.

Example: `loctt detach T-12 screenshot.png`

## Relationships

### `loctt link`

Create a relationship between two tasks. The relationship type must be defined
in `workflow.yaml`.

```
loctt link <task> <relationship> <target>
```

Example: `loctt link T-5 blocks T-8`

### `loctt unlink`

Remove a relationship.

```
loctt unlink <task> <relationship> <target>
```

Example: `loctt unlink T-5 blocks T-8`

### `loctt rerank`

Re-order a relationship edge among its siblings. Pass either `--before` or
`--after` (mutually exclusive); without either, the edge is moved to the end.

```
loctt rerank <source> <relationship> <target> [--before <task> | --after <task>]
```

Example: `loctt rerank epic-1 has_subtask T-9 --after T-7`

### `loctt sprint burndown`

Print the burndown series for a sprint. The series is reconstructed from
task history every time — no daily snapshots are stored on disk. Scope
changes (tasks joining or leaving the sprint mid-run) appear as visible
steps in the output.

```
loctt sprint burndown <key> [--format <table|json>]
```

Defaults to a text table; pass `--format json` for piping. Y-axis unit is
chosen automatically from `workflow.yaml#estimation`:

- numeric units (points / hours / days / custom_numeric) → sum of
  `estimate` of incomplete tasks
- `custom_enum` with `weights` → sum of weights
- everything else → count of incomplete tasks

Example: `loctt sprint burndown sprint_2026.q1 --format json`

### `loctt board-rerank`

Re-order a task's position on the board (its `board_rank`). The task stays
in its current status; only its order within the column changes. Pass
either `--before` or `--after` (mutually exclusive); without either, the
task moves to the end of its column.

```
loctt board-rerank <task> [--before <task> | --after <task>]
```

Example: `loctt board-rerank T-9 --after T-7`

## Lifecycle

### `loctt archive`

Archive a task. Reversible.

```
loctt archive <task>
```

### `loctt unarchive`

Restore an archived task.

```
loctt unarchive <task>
```

### `loctt delete`

Soft-delete by default — equivalent to `loctt archive`. With `--hard`, removes
the task directory from disk. Hard-deleting a task that isn't already archived
is allowed; soft-deleting one that's already archived is not (the CLI tells you
to pass `--hard` instead).

```
loctt delete <task> [--hard]
```

`archive` / `unarchive` are aliases for the soft path.

Examples:

```
loctt delete T-12             # soft (archives)
loctt delete T-12 --hard      # permanent
```

## Servers

### `loctt mcp`

Start the MCP (Model Context Protocol) server on stdio. Intended to be launched
by an MCP client; runs until the client disconnects. See [mcp-reference.md](../mcp/reference.md).

```
loctt mcp
```

### `loctt ui`

Start the web UI in the foreground. Prints the URL and runs until interrupted
(Ctrl-C / SIGTERM).

```
loctt ui [--port <n>] [--no-open]
```

| Flag | Description |
|---|---|
| `--port <n>` | Port to listen on (default: chosen by the server) |
| `--no-open` | Don't auto-open the URL in the browser |

## Git Sync

Optional git-backed mode. See [git-sync.md](../common/git-sync.md).

```
loctt git enable
loctt git disable
loctt git status
loctt git publish
loctt git sync
```

`status` prints whether git mode is enabled, the configured branch and remote,
auto-push / auto-fetch settings, whether the working directory is a git repo,
and the last synced commit (if any).

`publish` commits any local changes to the `loctt` branch (and pushes if
auto-push is on). `sync` pulls the latest `loctt` branch into the workspace.

## Config

```
loctt config get <key>
loctt config set <key> <value>
loctt config unset <key>
loctt config list
```

`get` prints the value (empty line if unset). `list` prints every known config
key as `<key> = <value>`, with empty values for keys that aren't set.

Examples:

```
loctt config set git.auto_push true
loctt config get git.auto_push
loctt config list
```

## Migration

### `loctt migrate`

Upgrade the tracker schema to the version this CLI understands. Prints the
plan, prompts for confirmation, then runs the migration steps and writes a
backup of `.loctt/`.

```
loctt migrate [--yes] [--dry-run]
```

| Flag | Description |
|---|---|
| `--yes` | Skip the confirmation prompt |
| `--dry-run` | Print the plan without applying any changes |

If the schema is already current, prints a no-op message and exits `0`.

Most other commands refuse to run when the schema is out of date and direct
you here.

## Common patterns

### Create a task

```
loctt create "Investigate flaky test" --priority high --type bug
```

### List tasks

```
loctt list                                    # most recent
loctt list --view in-progress                 # named view
loctt list --query 'status = doing and assignee = me'
loctt list --project web --archived           # archived web tasks
```

### Soft vs hard delete

```
loctt delete T-12              # archive (reversible)
loctt unarchive T-12           # restore
loctt delete T-12 --hard       # permanent — removes the task directory
```

### Switch users

```
loctt user create "Alex Chen" --email alex@example.com --switch
loctt user list
loctt user switch alex
loctt user current
```

### Set up multiple projects

```
loctt init --prefix WEB- --project-key web --project-label "Website"
loctt project create api --prefix API- --label "API service"
loctt project create infra --prefix INF- --label "Infra" --default
loctt project list
loctt create "First API endpoint" --project api
```
