# Task lifecycle

Create, read, update, unset, duplicate, move, export — across the CLI and
MCP. Web-API equivalents are noted where the three must agree.

Gaps only. See [README.md](README.md) for conventions.

---

## A. Field writes

### TSK-C1 · blocker · P4 P10 · CLI
**A bad field value produces prose, not a serialized validator dump.**
`TaskUpdateError`/`ZodError` are missing from `KNOWN_DOMAIN_ERRORS`
(`apps/cli/src/runtime/errors.ts:77`); MCP returns clean prose for the
same input.

- stderr contains no `{`, `}`, `"code":`, or `"path":`.
- The message names the field (`labels`, `due_date`) and the expected
  shape ("expected array", "must be YYYY-MM-DD or full ISO-8601").
- The regex source `^\d{4}-\d{2}-\d{2}` never appears in output.
- Exit code is 1 (domain error), not 0 and not 2.
- The message is substantively the one MCP `update_task` returns for the
  same input.

**Given** an initialized tracker with task T-1, **when** the user runs
`loctt set T-1 labels notanarray`, **then** the CLI prints a single-line
prose error naming the field and expected type, exits 1, and leaves T-1's
frontmatter unchanged.

### TSK-C2 · blocker · P1 P10 · CLI MCP
**`updated_at` cannot be written by hand on any surface.**
`USER_IMMUTABLE_FIELDS` omits it (`packages/core/src/task/update.ts:31-41`)
and `setField` has an explicit write branch at `:208`. MCP guards it at
`apps/mcp/src/runtime/fields.ts:82`; the CLI and web do not — so the field
that git-sync reconciliation, recency sort, and the activity feed all
depend on is forgeable.

- `loctt set T-1 updated_at "2020-01-01T00:00:00.000Z"` exits non-zero and
  leaves the stored timestamp unchanged.
- MCP `update_task` rejects the same write; both messages give the same
  reason.
- `POST /api/tasks/T-1/set` with `updated_at` returns 400.
- Each message names `updated_at` and says it is stamped automatically.
- A normal `loctt set T-1 status in_progress` still bumps `updated_at` to
  now — the guard blocks direct writes only, not the side effect.

**Given** task T-1 with today's `updated_at`, **when** the field is set
directly through each surface in turn, **then** every attempt fails and the
stored value is still today's.

### TSK-C3 · major · P4 P10 · CLI MCP
**A missing task is reported before any argument is validated.** The CLI
validates the enum first (`apps/cli/src/commands/task-crud.ts:177`), so a
typo'd key on a nonexistent task blames the wrong thing and returns the
wrong exit code. MCP orders it correctly.

- `loctt set T-999 status doing` (T-999 absent, `doing` unconfigured)
  reports that T-999 was not found, exit 1 (domain), not 2 (usage).
- The output does not mention the status vocabulary.
- `loctt set T-1 status doing` on an *existing* task still reports the
  unknown status with the `Known: …` list and exits 2.
- MCP `update_task` reports the same two cases in the same order.
- The ordering holds for `unset`, `archive`, and `body`.

**Given** a tracker with no task T-999, **when** `loctt set T-999 status doing`
runs, **then** it reports `task not found: "T-999"` and exits 1.

### TSK-C4 · minor · P4 P10 · CLI MCP
**Unsetting a never-set field behaves the same everywhere.**

- `loctt unset T-1 sprint` (never set) and `loctt unset T-1 mycustom`
  (declared, never set) produce the same class of outcome — both succeed
  or both fail — with identical exit codes.
- MCP `unset_field` agrees with the CLI on both.
- `docs/user/cli/reference.md`'s `unset` section states which it is.

**Given** T-1 with neither field set, **when** each is unset in turn on both
surfaces, **then** all four calls agree.

---

## B. Creation

### TSK-C5 · major · P10 · CLI MCP
**Create accepts the same initial fields on every surface.** The CLI, MCP
(`apps/mcp/src/tools/task-crud.ts:133-139`), and `POST /api/tasks` each
accept a different subset today, and the web spreads its unvalidated
request body.

- A task created with `body`, `assignee`, `labels`, `due_date`,
  `milestone`, and `sprint` carries all six, whichever surface created it.
- Any surface that cannot accept a field fails naming it, rather than
  succeeding and discarding it silently.
- `docs/user/cli/reference.md`'s create flag table and
  `docs/user/mcp/reference.md`'s parameter table each match their
  implementation exactly.
- Where an agent must fall back to `update_task`, the tool description
  says so.

**Given** the same six fields supplied to each surface, **when** the task is
read back, **then** either all six are present or the call failed naming the
unsupported one — never a silent drop.

### TSK-C6 · major · P3 P10 · CLI MCP — **resolved**
**Created tasks get the default status.** Two docs promised two
*different* implicit rules — "the first status in `workflow.yaml`"
(CLI reference) and "the first `pending` status" (schema reference) —
and neither was implemented. A task created without a status had no
`status` key at all, so it matched neither `status = backlog` nor
`status != done` and was invisible to ordinary filtering. All three
surfaces funnel through `createTask`, so all three produced them.

Resolved by making the default **explicit config**: exactly one status
carries `default: true`, rejected at parse time otherwise. Position no
longer decides, so reordering the list cannot silently change which
status new tasks get.

- `loctt create "x"` with no `--status` yields frontmatter whose
  `status` is the key marked `default: true`.
  → `tests/integration/cli/create.test.ts`
- MCP `create_task` and `POST /api/tasks` default identically: a task
  created any way lands in the same column.
  → `tests/integration/mcp/create.test.ts`
- The created task matches `loctt list --query 'status = backlog'` —
  reachable by an ordinary filter, not merely carrying a key.
  → `packages/core/src/task/create.test.ts`
- Marking a later status default changes the result, proving position
  is not what decides.
  → `packages/core/src/task/create.test.ts`

**Given** a workflow whose default status is `backlog`, **when** a task
is created with no status on each surface, **then** all three produce
`backlog`.

---

## C. Capabilities that reach no surface

### TSK-C7 · blocker · P10 · CLI MCP
**Duplicate, move, bulk, and export are reachable — or documented as
absent.** `duplicateTask`, `moveTaskToProject`, `bulkSetFields`,
`bulkArchive`, `bulkMoveTasksToProject`, and `setFields` are exported from
`packages/core/src/task/index.ts` with **zero** non-test callers across
`apps/`. `flow-tasks.md` TSK-20/21/43/51 are M2 blockers describing UI with
no API to call, and `flow-bulk.md` depends on `bulk_op_id`
(`packages/contracts/src/history.ts:57`), which has no reachable producer.

- Duplicating a task yields a copy with a fresh key, no relationships, and
  no attachments, matching `duplicateTask`'s contract
  (`packages/core/src/task/duplicate.ts:59-70`).
- Moving a task reassigns project and key, and the old key still resolves
  via `key_history`.
- Bulk field-set and bulk archive return a per-task `succeeded`/`failed`
  split sharing one `bulk_op_id`.
- Export emits the same columns on every surface that offers it.
- Any capability deliberately left off a surface is absent from that
  surface's user doc too — no doc describes a command that does not exist.

**Given** six task APIs in core with no callers, **when** a user or agent
tries to reach each, **then** either a documented command/tool exists or the
reference explicitly scopes it to the surfaces that have it.

---

## D. Reads

### TSK-C8 · minor · P4 · CLI
**`loctt show` renders every field the task carries.** It currently omits
labels, milestone, sprint, and estimate despite promising "full details".

- After setting a milestone, `loctt show` displays it.
- Same for `labels`, `sprint`, `estimate`, `start_date`, `reporter`,
  `completed_date`, and declared custom fields.
- Fields the task lacks are omitted, not printed empty.
- The rendered set is a superset of what `create` and `set` can write —
  nothing is writable-but-invisible.

**Given** T-1 with a milestone, two labels, and an estimate, **when**
`loctt show T-1` runs, **then** all three appear.

### TSK-C9 · minor · P10 · MCP
**Rank tools are documented with the other task tools.**

- `reorder_relationship` and `reorder_board` appear under `## Tasks` in
  `docs/user/mcp/reference.md`, or that section links to them.
- Their parameter tables list `before` and `after` as mutually exclusive,
  with the runtime error string matching
  `apps/mcp/src/tools/task-rank.ts:34`.

**Given** an agent reading the Tasks section, **when** it looks for a way to
reorder, **then** it finds the tool without scanning the Labels section.

---

## E. Setting values from the command line (B44)

### TSK-C10 · major · P1 P10 · CLI
**`loctt set` converts its value to the field's type.** (G2)
The command line has only text, and a number, boolean or multi-value
custom field refused it (`expected finite number, got string`), so the
CLI could not write what MCP and the web could.

- A `number` custom field stores a number, a `boolean` one a boolean
  (`true`/`false`, `yes`/`no`, `on`/`off`, `1`/`0`), and any `multi`
  field a list from a comma-separated value (`ios,android`).
- `fields.<key>` names the same field as `<key>`.
- A value that isn't of the field's type is refused, naming the field
  and the value (`risk takes a number, not "high".`), exit 1, and no
  task file changes.
- A bulk `set` (`WEB-1,WEB-2`) converts the same way.
- MCP `update_task` and the web still take typed JSON unchanged.

**Given** a `number` field `risk`, **when** `loctt set WEB-16 risk 5`
runs, **then** the task stores `risk: 5`, a number.

### TSK-C11 · major · P1 P10 · CLI
**`loctt set <task> labels` changes a task's labels.** (G3)
Labels could be set on create (`--label`) and never changed afterwards
from the CLI.

- The value is a comma-separated list of label names or IDs, and it
  replaces the task's labels; the task stores the labels' IDs.
- `loctt unset <task> labels` clears them.
- An unknown or ambiguous label name is refused (PRU-C15) and nothing
  is written.

**Given** labels `frontend` and `infra`, **when** `loctt set WEB-20
labels frontend,infra` runs, **then** the task stores both labels' IDs,
in that order.

### TSK-C12 · minor · P4 P10 · CLI
**`loctt show` prints assignee and reporter by name.** (G7)
Milestone, sprint and labels printed by name; the two user fields
printed raw IDs, unlike the reference's example.

- `Assignee:` and `Reporter:` show the user's name.
- A user whose profile can't be read shows the stored ID, and `show`
  still succeeds.

**Given** WEB-13 assigned to Bea and reported by Ada, **when** `loctt
show WEB-13` runs, **then** it prints `Assignee: Bea` and `Reporter:
Ada`.

### TSK-C13 · major · P1 P7 · CLI MCP UI
**Create and delete keep the on-disk key index complete.** (G5, G6)
`doctor` warned after ordinary use: `N stale entries` after any delete,
and `task dir(s) not in index` after a create once any lookup had
written `.loctt/local/key-index.yaml`.

- A create adds the new key to the index when the index exists; with no
  index on disk, none is written.
- A delete (single or bulk) removes every entry for the deleted tasks,
  current and former keys alike.
- After either, `loctt doctor` reports the key index in sync.

**Given** a tracker whose key index exists, **when** a task is created
and another deleted, **then** `loctt doctor` reports no key-index
finding.

## F. Adding and removing values; creating them on the fly (B45)

### TSK-C14 · major · P1 P10 · CLI MCP
**Values can be added to and removed from a list field.** (K150)
Changing one label meant resending the whole list, and a second writer
in between lost its change.

- `loctt set <task> labels|<multi field> --add <v>… --remove <v>…`
  (words up to the next flag; commas split too; `fields.<key>` names the
  same field) and MCP `update_task` `add` / `remove` maps (field → list)
  edit labels and any `multi` custom field.
- Core applies them to the list as stored, under the tracker lock:
  concurrent adds both land.
- Labels are named by name or ID, choice values by key or label (K148
  resolver). A stored member given literally is removable even when it
  no longer resolves.
- Adding a value already there, or removing one that isn't, is a no-op:
  nothing is written, no history, and the surface says "No change".
- Refused, writing nothing: a name matching nothing (K148 message), an
  ambiguous name, a value both added and removed, a field both replaced
  and edited, add/remove on a single-value field, a list the file holds
  as something else, and (CLI) a value together with `--add`/`--remove`
  (usage, exit 2). Several tasks at once is TSK-C16 (K152).
- The replace form (`loctt set <task> labels a,b`, `update_task`
  `field`/`value`) still works as before.

**Given** WEB-1 labelled `bug`, **when** `loctt set WEB-1 labels --add
infra --remove bug` runs, **then** WEB-1 stores only `infra`'s ID and its
history has one `label_added` and one `label_removed` entry.

### TSK-C15 · major · P10 · CLI MCP UI
**Unknown values are created only when asked, one model everywhere.** (K150)
Labels could be created on the fly in the web picker but not from the
CLI or MCP, and no choice field could grow at all.

- An unknown label, or an unknown value of a choice field, is refused
  with the K148 message; the CLI adds "Pass --create to create it.", MCP
  "Pass create_missing: true to create it." when that would work.
- With `--create` (CLI), `create_missing: true` (MCP) or the picker's
  "Create “x”" row (web), an unknown label is created as `label create`
  would, and an unknown value of a field that allows new values
  (CFG-C6) is appended to its `values` with a key derived from the label
  (lower case, `_` for anything else, `_2`, `_3`… on a clash).
- A closed field refuses a new value even when asked ("<field> does not
  allow new values; choose one of: …"). An ID-shaped name is never
  created.
- The web picker offers "Create “x”" for labels and open fields only,
  when the typed text names no existing value (by label or key) and no
  value already on the task.
- Nothing is created when the rest of the change is refused: labels.yaml,
  workflow.yaml and the task are all left as they were.

**Given** `platforms` allows new values, **when** `loctt set MOB-1
platforms --add Windows --create` runs, **then** `platforms` gains the
value `windows: Windows` and MOB-1 stores `windows`.

### TSK-C16 · major · P1 P10 · CLI MCP
**Add/remove over many tasks is one operation, reported like bulk set.** (K152, K153)
B45 refused `--add`/`--remove` on several tasks, so labelling a
selection meant one command per task.

- `loctt set <k1,k2,…> <field> --add <v>… --remove <v>… [--create]` and
  MCP `bulk_update_tasks` `add` / `remove` maps (with `create_missing`)
  apply the edit to each task's own list, under one lock.
- A task that would fail (not found, unreadable, a list it can't read, a
  value the field refuses) is listed with its reason, in the same shape
  bulk set uses (DEG-C8), and every other task still changes; the CLI
  then exits 1. (K153 replaced K152's all-or-nothing.)
- An unknown value without `--create` / `create_missing` is refused once,
  about the command, with the same hint as TSK-C15.
- The changed tasks land together, each history entry carries one
  `bulk_op_id`, and a task that already had the values is reported as
  unchanged, apart from both the changed and the failed.
- The web bulk bar sets single values only (status, priority, assignee,
  milestone, sprint), so it has no list edit to offer.

**Given** WEB-1 labelled `bug` and WEB-2 unlabelled, **when** `loctt set
WEB-1,WEB-2 labels --add infra` runs, **then** both store `infra`'s ID and
both `label_added` entries share one `bulk_op_id`; **given** WEB-2 does
not exist, **then** WEB-1 still gains `infra` and the output lists WEB-2
as not found.

