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

## Global options

Every command targets a single tracker directory. By default that is the
current working directory; these point it elsewhere without `cd`-ing:

```
loctt --root <dir> <command> [options]
loctt --cwd  <dir> <command> [options]     # back-compat alias of --root
LOCTT_ROOT=<dir> loctt <command> [options] # env-var fallback
```

- **`--root <dir>`** is the canonical flag. It is accepted on every
  command, including `loctt ui` and `loctt mcp` (so an MCP client launched
  as `loctt mcp --root <dir>` serves that tracker), and matches the web
  server's `--root` / `LOCTT_ROOT`.
- **`--cwd <dir>`** is a back-compat alias — identical behaviour. Existing
  scripts that pass `--cwd` keep working.
- **`LOCTT_ROOT`** env var is used when no flag is given.

**Precedence:** an explicit flag wins over `LOCTT_ROOT`, which wins over the
process working directory. If both `--root` and `--cwd` are given they must
resolve to the **same** directory; a conflict is a usage error (exit `2`)
rather than a silent pick-one, because operating on the wrong tracker is a
data hazard. Relative paths resolve against the current working directory.

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
| `--prefix <prefix>` | Key prefix for the initial project — 1–10 uppercase letters, no dash (default: `T`). The `-` is added at render, so `T` yields keys like `T-1` |
| `--project-label <label>` | Name of the starting project (default: `Tasks`) |
| `--timezone <iana-tz>` | Workspace timezone written to `calendar.yaml` (default: this machine's zone) |
| `--no-docs` | Skip generating helper docs in `.loctt/docs/` |

Example:

```
loctt init --prefix BUG --project-label "Bug tracker"
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

Display tracker status: directory path, task count, schema version, configured
statuses, and per-project counters (next key for each project; the workspace
default is marked with `*`). Works without a tracker — prints a hint to run
`loctt init`.

```
loctt info
```

It distinguishes three not-a-tracker states, because the remedy differs:

| State | What is printed |
|---|---|
| No `.loctt/` at all | `No .loctt directory found. Run 'loctt init' to get started.` |
| `.loctt/` exists but is **empty** | `Found an empty .loctt directory … It is not a tracker yet. Run 'loctt init' to set one up in it.` |
| `.loctt/` holds tasks but core files are missing | The schema line reports the problem; the remedy is `loctt init --repair` (see `loctt doctor`) |

The middle case used to be reported as a schema problem ("this tracker predates
schema versioning"), which pointed at `loctt migrate` — a command with nothing
to migrate. An empty directory has no schema because it is not yet a tracker.

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

Manage saved views in `.loctt/config/queries.yaml`. A saved view is a
named query you re-run by name; the same views the web UI authors, and
the same ones `list --view <name>` runs.

```
loctt views                                          # list (bare, or `views list`)
loctt views create <name> --query "<dsl>" [--sort <field[:asc|:desc]>,...]
loctt views edit <name|id> [--name <new>] [--query "<dsl>"] [--sort ...|-]
loctt views archive <name|id>
loctt views unarchive <name|id>
loctt views delete <name|id> [--yes]
```

**list** (the bare command, or `views list`) prints `<name>  <query>`,
with a `[sort: ...]` suffix when a sort is configured and an
` (archived)` marker on hidden views.

A view whose query no longer parses (usually a hand edit) is still listed,
marked `[broken: <parser message>]`, rather than being dropped or taking
down the rest of the list — one bad entry never hides the healthy views
beside it. The write subcommands preserve such a broken sibling untouched.

**create** adds a view. `--query` is required and is validated on write,
so a malformed query is rejected here rather than poisoning the catalog.
`--sort` is a comma-separated list of `field[:asc|:desc]` (a bare field
defaults to `asc`), which is how a multi-key sort is expressed:
`--sort priority:desc,created:asc`.

**edit** changes any of name, query, or sort; omitted flags are left
unchanged. `--sort -` clears an existing sort (distinct from omitting
`--sort`, which leaves it as-is). A view is addressed by id or by a
unique name — an ambiguous name is rejected, telling you to use the id.

**archive** hides a view from default lists; it stays runnable by id and
`unarchive` restores it. **delete** removes it permanently and is
irreversible, so it confirms first (pass `--yes` to skip the prompt in
scripts); `archive` is the reversible alternative.

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
loctt project list [--all] [--ids] [--filter <q>] [--limit <n>] [--offset <n>]
loctt project create <name> --prefix <prefix> [--slug <slug>] [--default]
loctt project edit <slug|name|id> --name <new-name>
loctt project set-prefix <slug|name|id> <new-prefix> [--yes]
loctt project archive <slug|name|id>
loctt project unarchive <slug|name|id>
loctt project delete <slug|name|id> [--remap-to <other> | --clear-project-field] [--yes]
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

`--filter <q>` narrows the list to a case-insensitive substring match on the
project **name, slug, or prefix** — so `--filter web` finds a project keyed
`WEB-` or slugged `web` even when its display name is "Website". A blank filter
is no filter. `--limit <n>` / `--offset <n>` page the (filtered) result:
`--limit` defaults to 100 and may be at most 1000 (over the cap is an error, not
a silent truncation); `--offset` skips that many matches so you can page past
the first window. The filter applies before paging, so you page through the
matches. When the shown page is not the whole match set, a footer names how
much was not shown — `Showing 1–100 of 240. Use --limit/--offset to page.` (the
same footer `loctt log` prints), so a truncated list never reads as complete.
(Same convention across `label`, `milestone`, `sprint`, and `user` `list`,
except those match on name only.)

### Changing a project's prefix

`set-prefix` rewrites the project's key prefix and **renames every task in
it** — `T-3` becomes `WEB-3`. The number is preserved, so nothing is
renumbered, and each task's previous key is kept in `key_history` so old
references keep resolving.

```
loctt project set-prefix Tasks WEB
```

The prefix is 1–10 uppercase letters with no dash — the `-` separator is
added at render, so `WEB` produces keys like `WEB-3`. A prefix containing
a dash, lowercase, digit, or punctuation is rejected.

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
rewritten. If the project has tasks, pass **either** `--remap-to <other-key>`
(move them under another project) **or** `--clear-project-field` (clear their
project field, leaving them with no project) — not both, and not neither, so
tasks are never silently orphaned. Always prompts for confirmation; pass
`--yes` to skip the prompt in scripts.

`set-default` accepts `-` to clear the workspace default.

Examples:

```
loctt project create web --prefix WEB --label "Website" --default
loctt project list --all
loctt project archive legacy          # soft, reversible
loctt project delete legacy --remap-to archive --yes
loctt project set-default -
```

## Users

`loctt user <subcommand>` manages users. The "current user" is who LocTT
attributes new tasks and history entries to.

```
loctt user list [--all] [--filter <q>] [--limit <n>] [--offset <n>]
loctt user current
loctt user switch <id-or-name>
loctt user create <name> [--email <e>] [--timezone <tz>] [--avatar <path>] [--switch]
loctt user edit <id-or-name> [--name <n>] [--email <e>] [--timezone <tz>] [--avatar <path> | --remove-avatar]
loctt user archive <id-or-name>
loctt user unarchive <id-or-name>
loctt user references <id-or-name>
loctt user delete <id-or-name> [--remap-to <id-or-name> | --unassign]
loctt user settings [--sweep-pins]
loctt user sidebar-groups [--order <ids> | --hidden <ids> | --reset]
```

`list` hides archived users unless `--all` is passed. The current user is
marked with `*`. `--filter <q>` narrows to a case-insensitive substring of the
user name; `--limit <n>` (default 100, max 1000) / `--offset <n>` page the
filtered list. See `project list` for the shared filter/paging convention.

`create --switch` makes the new user the current user immediately after
creating them.

`--email <e>` on `create`/`edit` is validated: a malformed address
(including an empty string) is rejected with an error and nothing is
written — the same rule the web UI and MCP enforce, because validation
lives in core. Omitting `--email` on `edit` leaves the existing email
unchanged; the field is cleared only through the MCP tool's explicit
`null` (the CLI has no clear flag).

`--avatar <path>` on `create`/`edit` imports an image: it is validated,
EXIF-oriented, resized to a 500px longest edge and re-encoded as JPEG,
then stored at `.loctt/users/<id>/avatar.jpg` and recorded in
`profile.yaml`. `edit --remove-avatar` deletes that file and clears the
`avatar` reference; it is mutually exclusive with `--avatar`.

`settings` prints the current user's personal preferences from
`.loctt/users/<id>/settings.yaml` — theme, default project, board card
layout, sidebar pins. These are per-user render preferences; the web UI
writes them from Settings → Personal.

`settings --sweep-pins` removes pinned saved views whose views no longer
exist in `queries.yaml` and **names each one it removed**, then rewrites
the file. Pins whose views merely match zero tasks are kept — the sweep
checks existence, not results.

`sidebar-groups` reads or sets which built-in sidebar groups/filters show
and in what order (SHL-45), a per-user setting the web sidebar-groups
editor also writes. With no flags it prints the resolved order, one id
per line, each marked `visible` or `hidden` — every group **and** every
built-in filter, so a hidden filter reads back `hidden`. `--order <ids>`
and `--hidden <ids>` take comma-separated ids and set those lists;
setting one preserves the other. `--reset` clears the setting back to the
default (every group, default order, all visible) and cannot be combined
with `--order`/`--hidden`. An **unknown id is rejected** with an error
naming it (a typo must not silently do nothing); a repeated valid id is
de-duplicated. Group ids: `views`, `projects`, `saved-filters`,
`milestones`, `sprints`, `labels`, `recents`. Built-in filter ids:
`assigned-to-me`, `reported-by-me`, `mentions-me`, `due-this-week`,
`overdue`, `high-priority`. (A hand-edited `settings.yaml` still degrades
tolerantly on *read* — a stray id there is dropped so the sidebar renders
— and `loctt doctor` names any id it had to drop.)

`references` prints how many tasks reference the user, split by role —
`<name>\tassignee <N>\treporter <M>`. It is read-only and does not
delete anything; use it to see what a `delete` would need to remap or
unassign.

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
loctt label list [--all] [--ids] [--filter <q>] [--limit <n>] [--offset <n>]
loctt label create <name> [--color <hex>]
loctt label edit <name|id> [--name <new>] [--color <hex|->]
loctt label archive <name|id>
loctt label unarchive <name|id>
loctt label delete <name|id> [--remap-to <other>] [--yes]
```

Labels are identified by a generated ULID `id` and a mutable, non-unique
`name`. There is no user-authored key — refer to a label by name, or by id
when two share a name. `--ids` prints ids alongside names. `--filter <q>`
narrows to a case-insensitive substring of the name; `--limit <n>` (default
100, max 1000) / `--offset <n>` page the filtered list (see `project list` for
the shared convention).

`edit --color -` clears an existing color. `edit --name` renames; the
positional argument selects which label to rename.

`archive` is the reversible (soft) variant.

`delete` permanently removes the label. Without `--remap-to`, it is
dropped from every task that has it; with `--remap-to <other>`, it's replaced.
Always prompts for confirmation; pass `--yes` to skip the prompt.

If some task rewrites fail partway (e.g. an unwritable task file), the
command exits non-zero with a message naming how many tasks moved and
which failed (by key); the label is **not** removed while its tasks
still reference it. Re-run the same delete to finish — tasks already
moved are skipped.

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
loctt milestone list [--all] [--ids] [--progress] [--filter <q>] [--limit <n>] [--offset <n>]
loctt milestone create <name> [--target-date <YYYY-MM-DD>]
loctt milestone edit <name|id> [--name <new>] [--target-date <YYYY-MM-DD|->] [--archived <true|false>]
loctt milestone archive <name|id>
loctt milestone unarchive <name|id>
loctt milestone delete <name|id> [--remap-to <other>] [--yes]
```

Milestones are identified by a generated ULID `id` and a mutable,
non-unique `name`. There is no user-authored key — refer to a milestone
by name, or by id when two share a name.

`--filter <q>` narrows to a case-insensitive substring of the name;
`--limit <n>` (default 100, max 1000) / `--offset <n>` page the filtered
list (see `project list` for the shared convention). With `--progress`,
the scan runs over the paged window only.

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
loctt sprint list [--all] [--ids] [--progress] [--filter <q>] [--limit <n>] [--offset <n>]
loctt sprint create <name> --start <YYYY-MM-DD> --end <YYYY-MM-DD> [--state <active|completed|future>] [--goal <g>]
loctt sprint edit <name|id> [--name <new>] [--start <d>] [--end <d>] [--state <s>] [--goal <g|->] [--force]
loctt sprint archive <name|id>
loctt sprint unarchive <name|id>
loctt sprint delete <name|id> [--remap-to <other>] [--yes]
```

Sprints are identified by a generated ULID `id` and a mutable, non-unique
`name`. There is no user-authored key — refer to a sprint by name, or by id
when two share a name.

`--filter <q>` narrows to a case-insensitive substring of the name;
`--limit <n>` (default 100, max 1000) / `--offset <n>` page the filtered
list (see `project list` for the shared convention). With `--progress`,
the scan runs over the paged window only.

`create --state` defaults to `future`. `edit --goal -` clears the sprint
goal. `edit --name` renames; the positional argument selects which sprint.

`--progress` adds a `done/total` readout per sprint, identical in
computation to `milestone list --progress`: it is computed from status
**category**, not from any status key, so renaming or deleting `done`
does not break it. **Discarded tasks are excluded from the denominator**
— a sprint whose remaining work has all been abandoned reads `4/4`
rather than stalling below 100% forever — and the excluded count is
named next to the number. It is opt-in because computing it scans every
task. A task file that cannot be read is named on stderr and excluded
from the totals, rather than silently shrinking them.

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

### `loctt export`

Export tasks as CSV or JSON — the same report the web list view's
export menu produces, for the same rows. Filters resolve exactly as
`list` does, so `loctt export --view x` exports what `loctt list
--view x` shows.

```
loctt export [--format <csv|json>] [--query <q>] [--view <v>] [--project <key>]
             [--columns <a,b,c>] [--body] [--archived] [--output <file>]
```

| Flag | Description |
|---|---|
| `--format <csv\|json>` | Output format. Default `csv`. |
| `--query <q>` | Ad hoc query string, as in `list` |
| `--view <v>` | Named saved view |
| `--project <key>` | Filter to a project (key, name or id) |
| `--columns <a,b,c>` | Explicit column list (built-in field names or `fields.<custom>`). Defaults to the standard export columns. |
| `--body` | Include the markdown body (JSON field / CSV column). Off by default. |
| `--archived` | Include archived tasks (hidden by default) |
| `--output <file>` | Write to a file instead of stdout; a count is reported on stderr. |

Without `--output` the export goes to stdout, so it pipes. CSV cells
that would be read as a spreadsheet formula (`=`, `+`, `-`, `@`) are
neutralised so opening the file cannot execute them.

This is a **report**, not a backup: it drops the body (unless
`--body`), relationships, custom fields, `key_history`, archive state
and ranks, and **cannot be restored** — there is no CSV import. Use
`loctt backup` to protect against data loss.

Tasks that cannot be parsed are **named on stderr**, never silently
dropped, so an export is never a spreadsheet short by a row that
reconciles against nothing.

```
loctt export --format json > tasks.json
loctt export --view in-progress --columns key,title,assignee
loctt export --project web --body --output web-tasks.csv
```

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

**Field-level problems degrade in place, they do not make the task
unreadable.** Only a broken `id`/`key` or unparseable YAML stops a task
from opening. A single bad field — a wrong-typed `due_date`, a missing
`title`, a value the workflow no longer defines, a reference whose target
is gone, or a key LocTT does not recognise — is kept exactly as stored
and the rest of the task shows normally. `show` lists these below the
task under two groups:

```
Needs attention:
  ⚠ due_date: 42 — must be YYYY-MM-DD or full ISO-8601 timestamp

Not recognised:
  jira_id: ABC-1
```

To repair one: `loctt set <task> <field> <value>` writes a valid value
over it, and `loctt unset <task> <field>` removes it (this now works for
an unrecognised top-level key too). Every other field's stored value is
preserved untouched when you repair one. `loctt doctor` lists the same
problems across the whole tracker as non-blocking `malformed` findings.

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
loctt log <task> [--limit <n>] [--offset <n>]
```

Example: `loctt log T-12 --limit 20`

`--offset <n>` skips the newest `n` entries, so a long history is
reachable past its first page — `--limit` alone can only ever show the
most recent. When a `--limit`/`--offset` page is not the whole history,
a `Showing X–Y of N.` footer names the total so the page is not mistaken
for everything.

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

Idempotent: archiving a task that is already archived succeeds and
changes nothing (no new history entry) rather than erroring.

```
loctt archive <task>
```

### `loctt unarchive`

Restore an archived task. Idempotent in the same way — unarchiving a task
that is not archived succeeds and changes nothing.

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
loctt mcp --root <dir>       # serve a tracker other than the cwd
```

The server operates on the tracker resolved from the global `--root`
(alias `--cwd`) / `LOCTT_ROOT` — see [Global options](#global-options). An
MCP client's launch config should pass `--root <dir>` so the server isn't
tied to whatever directory the client happens to spawn it in.

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
loctt git reconcile <status|apply|abandon>
```

When `publish` or `sync` finds the same task fields changed on both sides
since the last sync, it does not pick a winner: it opens a reconciliation
and stops with a non-zero exit, naming each conflicting field with both
values (and a drift note when a value references config missing locally).
Resolution is UI-primary — resolve it in the web UI (Settings → Sync) —
but the CLI mirrors it:

- `loctt git reconcile status` — lists the in-progress reconciliation's
  mode, commits, and each conflicting field with both sides.
- `loctt git reconcile apply --decisions <file.json>` — applies a JSON
  array of `{ taskId, field, choice, value? }` (`choice` is `local`,
  `remote`, or `value`), writes the chosen values, and completes the
  originating publish/sync. Reports the true split on a partial failure
  and stays resumable.
- `loctt git reconcile abandon` — clears the in-progress reconciliation,
  leaving local files exactly as they are (not a revert).

A parent (relationship) resolution maintains the inverse edge: choosing a
new parent removes the losing parent's child edge.

**Delete-vs-edit (GIT-16).** When a task was deleted on one side and edited
on the other, it is surfaced as a whole-task decision rather than a
per-field one: `status` lists it under "delete-vs-edit", naming which side
deleted and which edited. To decide it in the `apply` JSON, use the reserved
field `__delete_vs_edit__` with `choice` set to the side you want to win —
the *deleting* side keeps the deletion, the *editing* side keeps the task
(e.g. `{ "taskId": "...", "field": "__delete_vs_edit__", "choice": "local" }`
where the local side edited it keeps the task). `apply` reports the outcome
by key ("kept T-1" / "deleted T-1"). Keeping a task whose key then collides
routes through the normal rekey summary — it is not resurrected with a
colliding key silently.

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

For a large sync (50 or more files applied), `sync` prints an updating
`Applying N/M files…` progress line to stderr, so a pull that brings in
hundreds of tasks shows its progress rather than running silent; the
`Synced …` summary on stdout still reports the true counts (files taken,
merged, removed). A small sync prints no progress line.

When a merge leaves two tasks in the same project sharing a key (two
clones each created a task offline that landed on the same key), one is
renumbered — the earlier `created_at` keeps the key, the ULID `id` breaks
a tie, and the renumbered task's old key is kept in `key_history` so it
still resolves. The CLI applies this automatically (it stays scriptable)
and names each renumber, old key → new key:

```
Renumbered 1 task(s) to resolve key collisions:
  T-2 → T-3
```

(The web UI instead shows a preview and waits for a confirm before
renumbering.) A collision that cannot be renumbered — a task whose project
has no key counter yet — is reported as an unresolved key and the command
exits non-zero, rather than silently leaving two tasks sharing a key:

```
Warning: 1 key collision(s) remain unresolved: T-2. Run 'loctt doctor'.
```

When the local commit lands but the push cannot, `publish` exits non-zero
and names the cause distinctly — the local commit is safe in every case:

- a **non-fast-forward** rejection says the remote has moved on and tells
  you to run `loctt git sync` first, then publish again;
- an **authentication** failure names credentials as the fix;
- an **unreachable** remote names it and says to retry.

Each still prints git's specific stderr cause. Likewise a failed fetch in
`sync` names the remote and says it could not be reached (distinct from
"nothing to sync"); local state is untouched and the sync continues
against the local copy of the branch.

### Force-pushed / rewritten branch history

If the `loctt` branch is force-pushed or its history is otherwise
rewritten so that the commit you last synced against is no longer part of
it, `sync` (and `publish`) **refuse and write nothing** — this is not
treated as an ordinary conflict. The command exits non-zero and reports
that the branch history was rewritten, names the commit that can no longer
be found and the remote, and states that your local files and
`last_synced_commit` are unchanged.

LocTT does **not** silently re-base onto the new head, because that would
discard local changes you made since the missing commit. Recovery is
yours to do in git — LocTT will not do it for you:

- inspect the rewritten branch (`git log loctt`) and compare it with your
  local `.loctt/` to see what the rewrite dropped; and
- once you have reviewed and merged the two by hand, re-establish a base
  explicitly in git (for example `git branch -f loctt <commit>` to a
  commit you have inspected), then run `loctt git sync` again.

### Branch written by a newer LocTT

If the `loctt` branch was written by a newer version of LocTT than the one
you are running (its `.schema-version` is higher than your installation
understands), `sync` (and `publish`) **refuse and write nothing** — this is
reported distinctly from a conflict or a rewrite. The command exits
non-zero and names both schema versions: the branch's and yours.

Schema changes travel through `loctt migrate`, never through sync, so LocTT
will not apply a branch it cannot read — doing so could corrupt or drop
data. The fix is to **upgrade LocTT** to a version that supports the
branch's schema, then run `loctt git sync` again. This is not a migration:
the branch is already ahead of what your build can read, so `loctt migrate`
has nothing to do here.

A branch with **no** `.schema-version`, or one at the same or an older
version, syncs normally — an older schema is the ordinary
migrate-forward direction, not this refusal. A branch whose
`.schema-version` is present but unreadable (not a positive integer) is
also refused, because its version cannot be proven safe to read.

### A malformed task on the branch

If the `loctt` branch carries a task whose `task.md` does not parse (for
example, hand-edited frontmatter with a YAML syntax error), `sync` does
**not** abort — the rest of the sync is applied and the counts are
reported as usual. The malformed file is **not** silently absorbed either:
`sync` names each unparseable task by id and path so you know exactly which
file to inspect, and exits non-zero. For example:

```
Synced loctt branch into local workspace (2 updated)
Warning: 1 synced task(s) could not be parsed (the rest of the sync was applied). Inspect:
  01ABC…  .loctt/tasks/01ABC…/task.md  — <YAML parse error>
```

The bad file is kept exactly as it came from the branch, not rewritten. It
appears in `loctt list` as a broken-file entry (the rest of the list still
renders), and `loctt doctor` reports it too. Fix it by editing the named
`task.md`.

### Missing or corrupt publish worktree

`publish` and `sync` stage into a temporary git worktree under
`.loctt/local/`. If that worktree's directory is deleted by hand while git
still has it registered (in particular, locked), git cannot re-create it
and neither can LocTT. Rather than surface git's opaque
`missing but locked worktree` error, `publish`/`sync` **refuse and write
nothing** — your local task files are not modified — exit non-zero, and
name the specific worktree that is missing.

Repair with **either**:

- **Re-establish the worktree**: run `git worktree prune` (or, if git
  reports it locked, `git worktree remove --force <path>` or
  `git worktree unlock <path>` for the named worktree), then run the
  command again. This clears git's stale bookkeeping only — your `.loctt/`
  task files are left exactly as they are.
- **Disable and re-enable git sync**: run `loctt git disable` then
  `loctt git enable`. This rebuilds LocTT's git setup from scratch and also
  leaves your `.loctt/` task files exactly as they are on disk.

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

## Backup and restore

The whole-tracker backup, and the only export you can restore from. The
CSV/JSON export is a **report for a spreadsheet** and drops the body,
relationships, custom fields, `key_history`, archive state and ranks —
a restore from it would be a pile of disconnected, bodyless tasks.

Backup and restore are on every surface: these CLI commands, the MCP
`backup` / `restore` tools, and the web UI (Settings → Backup &
restore). A backup taken on one restores through any of them.

### `loctt backup`

Writes a JSONL backup: one JSON value per line, so it streams and a
large tracker restores without being parsed whole. Line 1 is a header
carrying the schema version the backup was taken at.

```
loctt backup <file> [--no-history] [--split-bytes <n>]
```

| Flag | Description |
|---|---|
| `--no-history` | Leave `_history.yaml` out. History is included by default. |
| `--output <file>` | Destination, if not given positionally |
| `--split-bytes <n>` | Bytes per part; above this the output splits into `<file>`, `<file>.part2`, … |

**What travels:** task frontmatter and body, `_comments.yaml`,
`_history.yaml` (unless opted out), attachments (base64, inline),
config (`workflow`, `projects`, `labels`, `milestones`, `sprints`,
`queries`, `list-view`, `calendar`), each user's `profile.yaml` and
avatar, and `state.yaml` — the key allocation counters, without which a
restored tracker reissues keys already in use.

**What does not, and why.** The export lists these itself every time it
runs, so the list cannot drift from the code:

| Excluded | Reason |
|---|---|
| `local/key-index.yaml` | Derived cache; rebuilt from the restored tasks |
| `local/sync.yaml` | This checkout's git remote — restoring it would point your tracker at someone else's |
| `local/reconcile.yaml`, `local/prefix-rename.yaml` | Operations in progress *on this checkout* |
| `local/journal.yaml` | Per-machine crash recovery |
| `users/<id>/settings.yaml`, `users/<id>/recents.yaml` | Machine-local; recents are never published |
| `.schema-migration-in-progress` | Would present the destination as mid-migration |

`.schema-version` is **recorded** in the header, not restored: the
destination keeps its own.

### `loctt restore`

```
loctt restore <file...> [--merge | --overwrite] [--dry-run]
```

Three modes. All three run under one lock, are journalled so an
interrupted restore rolls back rather than leaving a half-written
tracker, and report per-outcome counts rather than "OK".

| Mode | Behaviour |
|---|---|
| *(bare)* | Refuses a non-empty tracker, naming the task count and both flags |
| `--merge` | Creates tasks whose `id` is absent; never edits one that is present |
| `--overwrite` | Replaces any `id` the backup carries; ids absent from it are untouched |

`--overwrite` is the only mode that can lose work done since the
backup, so a **displaced body is preserved**, written beside the task
and named in the report.

| Flag | Description |
|---|---|
| `--dry-run` | Predict the counts and write nothing. Works in all three modes. |

**Collisions are resolved and reported**, not silently picked:

- **Keys** — a restored task whose key is already taken gets a fresh
  one from the destination project's counter; the original goes into
  `key_history` and still resolves. `key-index.yaml` is rebuilt.
- **Counters** — each project's counter becomes
  `max(backup, destination, highest key in use + 1)`, so no key is ever
  reissued even when both recorded counters have fallen behind.
- **Project prefixes and slugs** — two independently `init`ed trackers
  both mint `T-` and `tasks`; one of each is reassigned (and that
  project's keys rewritten) so the two do not both issue `T-n`.
- **Entity names** — a label, milestone or sprint whose name collides
  keeps both and renames the incoming one to `bug (2)`, then `bug (3)`.

A restore **refuses** a destination that is mid prefix-rename or
mid schema-migration, and refuses a backup from a newer schema — or a
split set with a part missing, naming which one. In each case nothing
is written.

## Not on this surface

Deliberately absent from the CLI, so you are not left hunting for them:

- **Board and timeline ordering** — `rerank` moves a single task; the
  drag-driven reordering those views do is web only.

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
loctt init --prefix WEB --project-label "Website"
loctt project create api --prefix API --label "API service"
loctt project create infra --prefix INF --label "Infra" --default
loctt project list
loctt create "First API endpoint" --project api
```
