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
loctt init [--prefix <prefix>] [--project-label <label>]
           [--timezone <iana-tz>] [--no-docs]
```

| Flag | Description |
|---|---|
| `--prefix <prefix>` | Key prefix for the initial project (default: `T-`) |
| `--project-label <label>` | Name of the starting project (default: `Tasks`) |
| `--timezone <iana-tz>` | Workspace timezone written to `calendar.yaml` (default: this machine's zone) |
| `--no-docs` | Skip generating helper docs in `.loctt/docs/` |

Example:

```
loctt init --prefix BUG- --project-label "Bug tracker"
```

The workspace timezone decides what `today` means in queries such as
`due_date < today`, so it is recorded in `calendar.yaml` at init rather
than read from whichever machine runs a command. Pass `--timezone` when
the initializing machine isn't where the team actually works:

```
loctt init --timezone Asia/Singapore
```

An unrecognized zone is rejected before anything is written. Trackers
created before this flag existed have no `calendar.yaml` and fall back
to UTC; add the file to set a zone.

`--repair` restores files missing from an existing `.loctt/` — the case
where `config/` was deleted but the tasks survived. It only fills gaps:
anything still present is left exactly as it is, so a repair cannot cost
you data. Without it, `init` over an incomplete tracker names what is
missing and points here.

If `state.yaml` had to be rebuilt, its key counters restart at 1 and
would reissue keys already on disk — run `loctt doctor --rebuild-index`
afterwards, which the repair output tells you.

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

The key-lookup cache (`.loctt/local/key-index.yaml`) is normally kept current by
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
loctt project create <name> --prefix <prefix> [--slug <slug>] [--default]
loctt project edit <slug|name|id> --name <new-name>
loctt project set-prefix <slug|name|id> <new-prefix> [--yes]
loctt project archive <slug|name|id>
loctt project unarchive <slug|name|id>
loctt project delete <slug|name|id> [--remap-to <other>] [--yes]
loctt project set-default <slug|name|id|->
```

Projects are referenced by **slug**, by name (when unambiguous), or by
their internal id. Anywhere a command takes a project — including
`--project` on `create` and `list` — all three are accepted.

A **slug** is the project's stable, URL-safe handle (`web`, `web-app`):
lowercase letters, digits, hyphen and underscore, starting with a
letter. It is generated from the name when the project is created, and
`--slug` overrides that. Slugs are unique across the tracker.

A slug is **fixed at creation and does not change when the project is
renamed**, so links and bookmarks that carry it keep resolving. That
means a project created as "Web" and later renamed "Website" keeps the
slug `web`. Resolution prefers the slug over a name, so an unambiguous
handle always wins.

Trackers created before slugs existed have none; those projects are
referenced by name or id exactly as before.

`list` hides archived projects unless `--all` is passed. The workspace default
project is marked with `*`.

### Changing a project's prefix

`set-prefix` rewrites the project's key prefix and **renames every task in
it** — `T-3` becomes `WEB-3`. The number is preserved, so nothing is
renumbered, and each task's previous key is kept in `key_history` so old
references keep resolving.

```
loctt project set-prefix Tasks WEB-
```

Prefixes must be unique across projects, so a prefix already in use is
rejected — before anything is written, so a refused change leaves the
tracker byte-identical. Setting a project's own current prefix is a no-op
that succeeds, not a collision.

Because this rewrites every task in the project it asks for confirmation,
stating how many tasks will be renamed; `--yes` skips the prompt. In a
non-interactive shell without `--yes` it exits `2` (usage) rather than
renaming unasked — so a script that forgot the flag fails loudly instead
of appearing to succeed.

Because the rewrite spans every task in the project, it records what it is
doing before it starts. If it is interrupted — the process is killed, the
machine loses power — the next LocTT command finishes the remaining tasks
and reports that it did so. Nothing is left half-renamed, and re-running is
safe: a task already carrying the new prefix is skipped. If that recovery
cannot complete, `loctt doctor` reports the pending rename.

The most common reason to need it: two trackers that were initialised
separately and later synced through the same remote both minted `T-` keys.
The merge assigns one of them a provisional prefix to keep prefixes unique —
`set-prefix` is how you replace that with a real one.

`archive` is the reversible (soft) variant — the project becomes hidden from
default lists but its references are preserved.

`delete` is permanent — the project entry is removed and affected tasks are
rewritten. If the project has tasks, `--remap-to <other-key>` is required to
move them under another project. Always prompts for confirmation; pass `--yes`
to skip the prompt in scripts.

`set-default` accepts `-` to clear the workspace default.

Examples:

```
loctt project create web --prefix WEB- --label "Website" --default
loctt project list --all
loctt project archive legacy          # soft, reversible
loctt project delete legacy --remap-to archive --yes
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
loctt user settings [--sweep-pins]
```

`list` hides archived users unless `--all` is passed. The current user is
marked with `*`.

`create --switch` makes the new user the current user immediately after
creating them.

`settings` prints the current user's personal preferences from
`.loctt/users/<id>/settings.yaml` — theme, default project, board card
layout, sidebar pins. These are per-user render preferences; the web UI
writes them from Settings → Personal.

`settings --sweep-pins` removes pinned saved views whose views no longer
exist in `queries.yaml` and **names each one it removed**, then rewrites
the file. Pins whose views merely match zero tasks are kept — the sweep
checks existence, not results.

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
loctt label list [--all] [--ids]
loctt label create <name> [--color <hex>]
loctt label edit <name|id> [--name <new>] [--color <hex|->]
loctt label archive <name|id>
loctt label unarchive <name|id>
loctt label delete <name|id> [--remap-to <other>] [--yes]
```

Labels are identified by a generated ULID `id` and a mutable, non-unique
`name`. There is no user-authored key — refer to a label by name, or by id
when two share a name. `--ids` prints ids alongside names.

`edit --color -` clears an existing color. `edit --name` renames; the
positional argument selects which label to rename.

`archive` is the reversible (soft) variant.

`delete` permanently removes the label. Without `--remap-to`, it is
dropped from every task that has it; with `--remap-to <other>`, it's replaced.
Always prompts for confirmation; pass `--yes` to skip the prompt.

Examples:

```
loctt label create "Blocker" --color "#cc0000"
loctt label edit "Blocker" --color -
loctt label edit "Blocker" --name "Blocked"
loctt label archive "Blocker"        # soft, reversible
loctt label delete "Blocker" --remap-to "High priority" --yes
```

## Milestones

`loctt milestone <subcommand>` manages milestones.

```
loctt milestone list [--all] [--ids] [--progress]
loctt milestone create <name> [--target-date <YYYY-MM-DD>]
loctt milestone edit <name|id> [--name <new>] [--target-date <YYYY-MM-DD|->] [--archived <true|false>]
loctt milestone archive <name|id>
loctt milestone unarchive <name|id>
loctt milestone delete <name|id> [--remap-to <other>] [--yes]
```

Milestones are identified by a generated ULID `id` and a mutable,
non-unique `name`. There is no user-authored key — refer to a milestone
by name, or by id when two share a name.

`edit --target-date -` clears the target date. `--archived` accepts only the
literal strings `true` or `false`.

`--progress` adds a `done/total` readout per milestone. It is computed
from status **category**, not from any status key, so renaming or
deleting `done` does not break it. **Discarded tasks are excluded from
the denominator** — a milestone whose remaining work has all been
abandoned reads `4/4` rather than stalling below 100% forever — and the
excluded count is named next to the number.

It is opt-in because computing it scans every task.

`archive` is the reversible (soft) variant.

`delete` permanently clears the milestone field on all referenced tasks (or
remaps it to `--remap-to <other>`). Always prompts for confirmation; pass
`--yes` to skip.

Examples:

```
loctt milestone create "Version 1.0" --target-date 2026-06-30
loctt milestone edit "Version 1.0" --target-date -
loctt milestone archive "Version 0.9"   # soft, reversible
loctt milestone delete "Version 0.9" --remap-to "Version 1.0" --yes
```

## Sprints

`loctt sprint <subcommand>` manages sprints.

```
loctt sprint list [--all] [--ids]
loctt sprint create <name> --start <YYYY-MM-DD> --end <YYYY-MM-DD> [--state <active|completed|future>] [--goal <g>]
loctt sprint edit <name|id> [--name <new>] [--start <d>] [--end <d>] [--state <s>] [--goal <g|->] [--force]
loctt sprint archive <name|id>
loctt sprint unarchive <name|id>
loctt sprint delete <name|id> [--remap-to <other>] [--yes]
```

Sprints are identified by a generated ULID `id` and a mutable, non-unique
`name`. There is no user-authored key — refer to a sprint by name, or by id
when two share a name.

`create --state` defaults to `future`. `edit --goal -` clears the sprint
goal. `edit --name` renames; the positional argument selects which sprint.

`edit --force` is required to re-open a completed sprint (move it from
`completed` back to `active` or `future`).

`archive` is the reversible (soft) variant.

`delete` permanently clears the sprint field on all referenced tasks (or remaps
it to `--remap-to <other>`). Always prompts for confirmation; pass `--yes`
to skip.

Examples:

```
loctt sprint create "Sprint 24" --start 2026-05-01 --end 2026-05-14 --state active --goal "Ship login flow"
loctt sprint edit "Sprint 24" --state completed
loctt sprint edit "Sprint 24" --state active --force
```

### `loctt sprint burndown`

Print the burndown series for a sprint. The series is reconstructed from
task history every time — no daily snapshots are stored on disk. Scope
changes (tasks joining or leaving the sprint mid-run) appear as visible
steps in the output.

```
loctt sprint burndown <name|id> [--format <table|json>]
```

Defaults to a text table; pass `--format json` for piping. Y-axis unit is
chosen automatically from `workflow.yaml#estimation`:

- numeric units (points / hours / days / custom_numeric) → sum of
  `estimate` of incomplete tasks
- `custom_enum` with `weights` → sum of weights
- everything else → count of incomplete tasks

Example: `loctt sprint burndown "2026 Q1" --format json`

## Calendar

### `loctt calendar show`

Print the calendar config: timezone, first day of week, working days, and
holidays.

```
loctt calendar show
```

`show` is the only subcommand. The calendar is read-only from the CLI —
it is configured in the web UI (`loctt ui`). Any other subcommand prints
that and exits 2.

## Task Management

### `loctt create`

Create a new task. The created key is printed.

```
loctt create <title> [--project <key>] [--status <s>] [--priority <p>] [--type <t>]
```

| Flag | Description |
|---|---|
| `--project <key>` | Target project. Required if no workspace default is set and there are multiple projects. |
| `--status <s>` | Initial status. Defaults to the status marked `default: true` in `workflow.yaml`. |
| `--priority <p>` | Priority key |
| `--type <t>` | Task type key |

Examples:

```
loctt create "Add login button"
loctt create "Fix crash on logout" --project web --priority high --type bug
```

Every field `createTask` accepts is settable at creation:
`--assignee`, `--reporter`, `--due`, `--start`, `--estimate`,
`--milestone`, `--sprint`, `--body`, and `--label` (repeatable). MCP's
`create_task` takes the same set, so a task created either way carries
the same fields without a follow-up `set`.

A rejected value fails the create, names what was wrong, and writes
nothing — no task directory, and no key consumed. Most rejections are
caught before core is reached, with a message naming the valid options:

```
$ loctt create "Ship it" --status shipped
Error: unknown status 'shipped'. Known: backlog, in_progress, done, wont_do

$ loctt create "Ship it" --milestone no-such-milestone
Error: unknown milestone: no-such-milestone
```

Anything that gets past those guards is rejected by core's own
validator, which names the field (`invalid task: <field>: <reason>`).
That is the same validator, the same message rule and the same field
attribution `loctt set` uses, so both write paths answer identically.

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

A query naming an unknown field or invalid enum value exits with an
error instead of printing "No tasks found." — see
[Errors](../common/query-language.md#errors). A saved view referencing a
deleted custom field is the exception: it warns on stderr, still runs,
and exits 0, so `loctt list --view x | …` keeps working.

Examples:

```
loctt list
loctt list --view in-progress --limit 50
loctt list --query 'status = doing and assignee = me' --project web
loctt list --archived
```

`--sort <field>` orders the result; `--dir asc|desc` sets the direction
(default `asc`). Sorting by `priority` uses each priority's configured
`value`, not its key — so `low … critical` rather than alphabetical.
`--offset <n>` skips rows, for paging past the first `--limit`.

MCP's `list_tasks` takes the same three as `sort`, `direction` and
`offset`, so a saved ordering reads identically from either surface.

### `loctt show`

Display a task's full details: metadata, relationships, attachments, and body.

```
loctt show <task>
```

Example: `loctt show T-1`

**If the task's file cannot be parsed**, `show` says so and names the
file and the YAML line, rather than reporting the task as missing:

```
$ loctt show T-1
Error: T-1 could not be read because
/path/to/.loctt/tasks/01J.../task.md could not be parsed. The file
appears to have been edited by hand or by another tool — LocTT writes
task.md atomically, so this is not a half-written file. Missing
closing "quote at line 7, column 17
```

A key that genuinely does not exist still reports `task not found`.
The two are deliberately different: a task whose file is corrupt has
not been lost, and the fix is to open the named file and repair the
YAML.

If some task file cannot be read *and* the key you asked for did not
match anything, LocTT says it cannot confirm whether the task exists —
the key it would have matched lives inside the file it could not
parse. Repair the named file and run the command again.

### `loctt set`

Set a field on one task, or on several at once. Works for both built-in
fields (`status`, `priority`, `assignee`, `due_date`, etc.) and custom
fields.

```
loctt set <task>[,<task>...] <field> <value>
```

Examples:

```
loctt set T-12 status doing
loctt set T-1,T-2,T-5 status done
```

With more than one task the change runs as a single bulk operation:
one lock for the whole batch, and every history entry stamped with a
shared `bulk_op_id` so the change reads as one action rather than N
unrelated edits.

A task that fails (unknown ref, invalid value) is reported individually
and does **not** abort the rest; the command exits non-zero when any
task failed, so a script cannot mistake a partial success for a
complete one. Batches are capped at 500 tasks.

**Only the value you are writing is validated.** If a task already
holds a value that `workflow.yaml` no longer declares — a status you
deleted from config, say — that does not block edits to its other
fields, and the unrecognised value is left on disk exactly as it is
until you change it yourself:

```
loctt set T-12 priority high   # succeeds even if T-12's status
                               # is no longer in workflow.yaml
loctt set T-12 status doing    # this is how you repair it
```

The value you write is still checked as strictly as ever, so
`loctt set T-12 status nonsense` is refused. Run `loctt doctor` to list
every task holding a value config no longer declares.

### `loctt comment` / `loctt comments`

Add and read task comments.

```
loctt comment <task> <body>
loctt comments <task>
loctt comment-edit <task> <comment-id> <body>
loctt comment-delete <task> <comment-id>
```

Mentions written as `@user:<id>` are resolved against the user list and
recorded on the comment. An unresolvable mention is dropped rather than
failing the post — a typo should not lose the comment.

**Anyone may edit or delete anyone's comment.** LocTT has no roles or
permissions and users switch identity freely, so an ownership check
would be the product's only permission rule while protecting nothing.
Editing someone else's comment preserves the original author and
records the editor, so the change is traceable rather than refused.

### `loctt unset`

Remove a field from one task, or from several at once.

```
loctt unset <task>[,<task>...] <field>
```

Examples:

```
loctt unset T-12 due_date
loctt unset T-1,T-2 due_date
```

Multi-task behaviour matches `loctt set` — one bulk operation, a shared
`bulk_op_id`, per-task failure reporting, and a non-zero exit if any
task failed.

### `loctt body`

View or update a task's markdown body.

```
loctt body <task> [--set <text>] [--append <text>] [--expect <token>] [--token]
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

#### Guarding against a concurrent edit

By default a body write is **last-write-wins**: if someone edited the task in
the browser between your read and your write, your text replaces theirs with
no warning. This is the default so existing scripts behave as they always
have.

To opt in, read a token first and hand it back with the write. The write is
refused — and nothing is written — if the task changed in between:

```
TOKEN=$(loctt body T-12 --token)
loctt body T-12 --expect "$TOKEN" --set "my new text"
```

`--token` prints the token alone, so it substitutes directly. A refused write
exits 1 and says the text was not saved; re-read, reapply your edit, retry.
`--expect` works with `--append` as well as `--set`, and cannot be combined
with `--token` (which reads rather than writes).

To require this for everyone working in a tracker, set it in
`.loctt/config/workflow.yaml`:

```yaml
cli:
  require_body_token: true
```

A write with no `--expect` is then refused with a usage error instead of
falling back to overwriting. The setting is CLI-only: the web always sends a
token, and MCP enforces one whenever an agent supplies it.

### `loctt log`

Print a task's history (most recent first).

```
loctt log <task> [--limit <n>]
```

Example: `loctt log T-12 --limit 20`

`--offset <n>` skips the newest `n` entries, so a long history is
reachable past its first page — `--limit` alone can only ever show the
most recent.

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

## Ranks

### `loctt rerank`

Re-order a relationship edge among its siblings within a single
`(source, type)` group. Pass either `--before` or `--after` (mutually
exclusive); without either, the edge is moved to the end.

```
loctt rerank <source> <relationship> <target> [--before <task> | --after <task>]
```

Example: `loctt rerank epic-1 has_subtask T-9 --after T-7`

### `loctt board-rerank`

Re-order a task's position on the board (its `board_rank`). The task stays
in its current status; only its order within the column changes. Pass
either `--before` or `--after` (mutually exclusive); without either, the
task moves to the end of its column.

**A column is a group of tickets, not a status.** When
`workflow.yaml` has a `boards` block, a column may collapse several
statuses, and cards of different statuses interleave freely inside it:
`--before` / `--after` accept any task in the same *column*, whatever
its status. With no `boards` block a column is one status, so the
anchor must share the moved task's status. An anchor from a different
column is refused, naming both.

Each column is its own sequence: "the end of the column" means the end
of that column's ordering, not of the tracker, so a task moved to the
end lands below that column's cards only.

```
loctt board-rerank <task> [--before <task> | --after <task>]
```

Example: `loctt board-rerank T-9 --after T-7`

Re-running the same reorder is a **no-op**: if the computed rank matches
the task's current one, nothing is written — `board_rank` and
`updated_at` are unchanged and no history entry is added. The command
still succeeds and prints the rank.

### `loctt board-move`

Move a task to another board column **and** position it there, in a
single write.

`board-rerank` only reorders within the current column. Crossing a
column boundary otherwise takes two commands — `loctt set <task>
status <s>` then `loctt board-rerank <task>` — and a failure between
them leaves the task in a column whose stored status contradicts it.
This command writes `status` and `board_rank` as one change set, so
both land or neither does.

```
loctt board-move <task> [--status <status>] [--before <task>] [--after <task>]
```

Omit `--status` to reposition within the task's current column; then
`status` is not written at all, rather than resent at its current value.

Unlike `board-rerank`, **`--before` and `--after` are not mutually
exclusive here.** A drop lands *between* two neighbours, so passing
both interpolates a rank between that pair. Passing neither appends the
task to the end of the destination column.

The anchors are validated against the *destination* column, not the
task's current one — on a cross-column move the neighbours legitimately
belong to the column being moved to. An anchor that no longer exists,
or that has since left that column, is refused by name.

Example: `loctt board-move T-9 --status in_progress --after T-7 --before T-4`

A move that changes neither status nor rank is a **no-op**: nothing is
written, `updated_at` is unchanged, and no history entry is added. The
command still succeeds and prints the rank.

## Lifecycle

### `loctt archive`

Soft-delete a task (reversible). The task is marked `archived: true` and
hidden from default lists, but its directory and history are preserved.

```
loctt archive <task>
```

### `loctt unarchive`

Restore an archived task.

```
loctt unarchive <task>
```

### `loctt delete`

Permanently remove a task's directory from disk. Irreversible. Always
prompts for confirmation; pass `--yes` to skip the prompt in scripts.

LocTT deliberately uses two distinct verbs — `archive` (soft, reversible)
and `delete` (hard, permanent) — across both the CLI and MCP surfaces.
There is no `--hard` flag.

```
loctt delete <task> [--yes]
```

Examples:

```
loctt archive T-12           # soft, reversible
loctt delete T-12 --yes      # permanent
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

It also reports drift in both directions: `Local changes` counts files not yet
published, and `Remote changes` says whether the branch has moved since the last
sync. Both lines are omitted when they could not be determined — git mode off,
or no branch yet — rather than printed as zero.

The remote line marks the remote as `(not configured)` when no such remote
exists. The name still shows, because it defaults to `origin` whether or not one
is set up.

`publish` commits any local changes to the `loctt` branch (and pushes if
auto-push is on). `sync` pulls the latest `loctt` branch into the workspace.

## Config

```
loctt config get <key>
loctt config set <key> <value>
loctt config unset <key>
loctt config list
loctt config usage
```

`get` prints the value (empty line if unset). `list` prints every known config
key as `<key> = <value>`, with empty values for keys that aren't set.

`usage` is different from the other four: it reports nothing about
machine-local settings. It counts how many tasks reference each key in
`workflow.yaml` — every status, priority, task type, relationship, and
custom-field enum value — so you can see what a deletion would affect
before making it. Removing a key that tasks still hold requires a remap
(the web settings panels prompt for one); this is what tells you how
many tasks that remap would move.

Keys nothing references are omitted; a collection with no referenced
keys prints `(none referenced)` rather than nothing at all.

Examples:

```
loctt config set git.auto_push true
loctt config get git.auto_push
loctt config list
loctt config usage
```

```
$ loctt config usage
statuses
  in_progress = 9
  backlog = 4
priorities
  (none referenced)
task_types
  bug = 3
relationships
  blocks = 2
custom_fields
  size
    m = 5
    s = 2
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

`migrate` only helps when the tracker records a version older than this
CLI's. Three states it cannot fix, each of which says so rather than
sending you here:

| State | What to do |
|---|---|
| `.schema-version` missing, empty, or not a positive integer | There is no version to migrate *from*. Repair the file by hand, or run `loctt init --repair`. |
| Tracker is newer than this LocTT | Update LocTT. No local command can produce a newer version. |
| A previous migration was interrupted | Restore from the backup named in the sentinel file, then remove the sentinel. |

## Not on this surface

Deliberately absent from the CLI, so you are not left hunting for them:

- **Export (CSV / JSON)** — web only, via the list view's export menu.
  The CLI's `list --format json` covers scripting; export exists for the
  spreadsheet round-trip, which is a UI workflow.
- **Board and timeline ordering** — `rerank` moves a single task; the
  drag-driven reordering those views do is web only.
- **Creating and editing saved views** — web only. `loctt views` lists
  them and `list --view <name>` runs them, so a view saved in the UI is
  usable here; authoring one means editing `queries.yaml` or using the
  web editor.

Bulk edits are *not* on this list: `set` and `unset` accept
comma-separated refs and run as one bulk operation (see above).

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

### Archive vs delete

```
loctt archive T-12             # soft, reversible
loctt unarchive T-12           # restore
loctt delete T-12 --yes        # permanent — removes the task directory
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
loctt init --prefix WEB- --project-label "Website"
loctt project create api --prefix API- --label "API service"
loctt project create infra --prefix INF- --label "Infra" --default
loctt project list
loctt create "First API endpoint" --project api
```
