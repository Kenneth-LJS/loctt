# CLI features

A narrative tour of LocTT features through the command line. For exhaustive flag-by-flag detail, see [reference.md](reference.md). For the same features through other interfaces, see [Web UI features](../ui/features.md) or [MCP features](../mcp/features.md).

This page assumes you've run `loctt init` and have a `.loctt/` directory in your project.

## Tasks

`loctt create "Title"` creates a task and prints its key:

```bash
loctt create "Set up CI pipeline"
# Created T-1: Set up CI pipeline
```

You can set fields inline at creation time — handy when you already know what you want:

```bash
loctt create "Fix login bug" --status in_progress --priority high --type bug
```

After that, `loctt show T-1` prints the full task — frontmatter and body — and `loctt set T-1 <field> <value>` changes any field:

```bash
loctt set T-1 status in_progress
loctt set T-1 priority high
loctt set T-1 due_date 2026-06-01
loctt unset T-1 priority
```

If `--status`, `--priority`, etc. aren't passed at creation, defaults from `workflow.yaml` apply.

## Markdown body

`loctt body T-1` prints the body. `loctt body T-1 --set "..."` replaces it. `loctt body T-1 --append "..."` appends without losing what's there:

```bash
loctt body T-1 --set "## Plan\nWire up GitHub Actions for lint, test, build."
loctt body T-1 --append "\nFollow-up: cache npm install in CI."
```

Append is the safer move for collaborative trackers — you won't accidentally drop someone else's notes.

## Relationships

`loctt link <from> <kind> <to>` connects two tasks:

```bash
loctt link T-2 blocks T-1
loctt link T-3 parent T-1
```

`loctt unlink` removes them. `loctt rerank` reorders a relationship's targets within a task (e.g., to reorder subtasks under a parent). The kinds available (`blocks`, `depends_on`, `parent`, plus anything custom) come from `workflow.yaml`.

## Attachments

`loctt attach T-1 ./screenshot.png` copies the file into the task's attachment folder. `loctt detach T-1 screenshot.png` removes it:

```bash
loctt attach T-1 ./error.log
loctt detach T-1 error.log
```

Attachments live in `.loctt/` and travel with the task — useful for screenshots, logs, or spec PDFs you want to keep alongside the issue.

## Activity log

`loctt log T-1` prints the task's history — every field change, link, body edit, and archive event, with timestamps and actor:

```bash
loctt log T-1
```

Useful for "wait, when did this become a bug?" or "who marked this done?"

## Archive and delete

Two levels of removal:

```bash
loctt archive T-1      # Soft-delete; hidden from default list, restorable
loctt unarchive T-1    # Restore
loctt delete T-1 --force   # Permanent; requires --force
```

By default `loctt list` skips archived tasks. Pass `--include-archived` to see them.

## Query language

`--query` filters list output with the expression language:

```bash
loctt list --query "status = in_progress and priority = high"
loctt list --query "assignee = ken and not status = done"
loctt list --query "text ~ login"
```

See [query-language.md](../common/query-language.md) for the grammar.

## Saved views

Frequently-used queries can be stored in `.loctt/config/queries.yaml` and invoked by name:

```bash
loctt list --view recent-open
loctt views   # List all saved views
```

## Projects

Multiple projects, each with its own key prefix and counter:

```bash
loctt project create backend --prefix BACKEND-
loctt project list
loctt project set-default backend
loctt project archive old-thing
```

Once a default is set, new tasks pick up its prefix automatically. Override per-command with `--project <name>`.

## Users

User profiles for assignment, reporting, and audit attribution:

```bash
loctt user create "Alice" --email alice@example.com --timezone America/New_York
loctt user list
loctt user current
loctt user switch alice
loctt user edit alice --email alice@newdomain.com
loctt user archive bob
```

`switch` changes which user the CLI acts as — this affects the actor recorded in activity logs.

## Labels

Lightweight tags applied via `loctt set`:

```bash
loctt label create bug --color red
loctt label create wontfix
loctt set T-1 labels bug,wontfix
loctt label list
```

## Sprints

Time-boxed task groupings:

```bash
loctt sprint create "Sprint 12" --start 2026-05-12 --end 2026-05-26
loctt sprint list
loctt set T-1 sprint sprint-12
loctt sprint edit sprint-12 --state active
```

## Milestones

Target-date deliverables:

```bash
loctt milestone create "v1.0" --due 2026-09-01
loctt milestone list
loctt set T-1 milestone v1-0
```

## Custom fields

Defined in `workflow.yaml`, used like any other field:

```bash
loctt set T-1 severity critical
loctt set T-1 customer "Acme Corp"
loctt list --query "severity = critical"
```

`loctt schema` prints the current workflow configuration so you can see what's defined.

## Configurable workflow

The workflow lives in `.loctt/config/workflow.yaml` — edit it with any text editor. `loctt schema` prints the live config:

```bash
loctt schema
```

See [configuration.md](../common/configuration.md) for the schema.

## Calendar

Workspace calendar (timezone, working days, holidays) is configured in `.loctt/config/`. View it with:

```bash
loctt calendar show
```

## Git sync

Opt-in sync to a dedicated `.loctt` branch in your repo:

```bash
loctt git enable     # Turn on git-backed mode
loctt publish        # Push local state to the .loctt branch
loctt sync           # Pull remote state
loctt git status     # Show sync state
loctt git disable    # Turn it off
```

If a publish or sync detects conflicting concurrent edits, reconciliation kicks in — see [git-sync.md](../common/git-sync.md).

## Diagnostics and migration

```bash
loctt doctor    # Validate tracker integrity
loctt info      # Counts, prefixes, next-key
loctt migrate   # Upgrade tracker schema; preview before applying
```

Run `doctor` if anything feels off. Run `migrate` after upgrading the LocTT CLI to a new major version.
