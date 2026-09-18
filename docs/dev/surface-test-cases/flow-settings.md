# Configuration and workflow

Workflow schema reads and writes, config get/set/unset, calendar, and
config drift.

Gaps only. See [README.md](README.md) for conventions.

---

### CFG-C1 · blocker · P4 P7 · CLI MCP
**Workflow writes are validated before they land.**
`validateWorkflowConfig` is never called on any write path — its only
caller in the repo is `packages/core/src/diagnostics/doctor.ts:78`.
`PUT /api/workflow` with a duplicated status returns 200 and writes
`['in_progress','done','wont_do','in_progress']` to disk.

- A workflow write containing a duplicate status key is refused, naming
  the collision.
- The same holds for duplicate priority, task-type, and relationship keys.
- The refusal happens before anything is written — the file on disk is
  unchanged.
- Whichever surfaces can write workflow config apply the same validation.

**Given** a workflow write duplicating an existing status key, **when** it
is submitted, **then** it is refused naming the duplicate and
`workflow.yaml` is byte-identical afterwards.

### CFG-C2 · blocker · P7 P4 · CLI MCP
**A task holding a drifted enum value is visible, marked, and findable.**
`doctor.ts:263-270` explicitly filters workflow-key errors out of the
reference check, so after hand-deleting an in-use status doctor prints
`✓ workflow.yaml: valid`. Compounding it: the DSL rejects the deleted
literal, so the drifted tasks cannot be queried — you cannot find the tasks
you must fix.

- `loctt show` renders the stored key with an explicit marker stating it is
  not in `workflow.yaml` — never blank, never coerced to another value.
- `loctt list` renders the same marker in the status column.
- There is a supported way to list every drifted task: either the DSL
  accepts an unknown literal when present on disk, or a dedicated
  flag/command surfaces them. A bare
  `loctt list --query 'status = <deleted>'` failing with "unknown status
  value" and no alternative is a failure of this case.
- `loctt doctor` reports the same set, with a check that fails.

**Given** `T-1.status = in_progress` with `in_progress` hand-removed from
`workflow.yaml`, **when** the task is shown, listed, and doctored, **then**
all three surface the drift and at least one lets you enumerate every
affected task.

### CFG-C3 · blocker · P10 · CLI MCP
**Config values can be read back wherever they can be written.** MCP has
`get_config_value` and `list_config_values`; the web has `POST` and
`DELETE /api/config/:key` but no GET — `GET /api/config/git.branch` returns
404. A settings panel can change `git.remote` and never read it back.

- Every surface that can write a config key can also read it.
- A value written on one surface reads back identically on the others.
- Reading an unknown key returns an error listing the valid keys — the same
  list on every surface.
- `list_config_values` returns every key in `CONFIG_KEYS` with a non-null
  `type` and `description`, and never silently swallows a load failure as
  `null`.

**Given** `git.branch` set through any surface, **when** it is read from
each, **then** all agree on the value, and an unknown key produces the same
error everywhere.

### CFG-C4 · major · P4 P10 · MCP
**Config error text matches the CLI's.**

- `set_config_value` before git is enabled returns the same
  "run 'loctt git enable' first" guidance the CLI gives.
- An unparseable boolean lists the accepted literals, matching
  `parseConfigValue`.
- `get_workflow_config` returns `boards`, `timeline`, `estimation.weights`,
  and per-entity `icon`/`color` when present — nothing stripped on the way
  out.
- `relationships[].kind` is present for a symmetric relationship, so an
  agent can tell symmetric from directional without inferring it from
  `inverse`.
- The returned object round-trips: feeding it back through
  `WorkflowConfigSchema` parses.

**Given** git mode disabled, **when** an agent calls
`set_config_value {key:"git.branch"}`, **then** the error names git mode as
not enabled and gives the enable command.

### CFG-C5 · minor · P4 · CLI
**`loctt calendar` says what it cannot do.**

- `loctt calendar show` prints timezone, first day, working days, and
  holidays.
- Any write subcommand prints usage stating the calendar is read-only from
  the CLI and naming where it can be edited, exiting 2.
- The wording agrees with the MCP `get_calendar` tool description about
  *where* it is editable.
- Note: nothing in the codebase currently reads `working_days` or
  `holidays`, so `../ui-test-cases/flow-settings.md` SET-10 and SET-22 have
  no consumer to assert against.

**Given** any initialized tracker, **when** `loctt calendar set timezone UTC`
runs, **then** stderr states the calendar is not editable from the CLI and
names the surface that can edit it, exiting 2.
