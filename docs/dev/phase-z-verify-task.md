# Phase Z — adversarial verification of `phase-z-findings-correctness-task.md`

Independent re-check of the two findings in
`docs/dev/phase-z-findings-correctness-task.md`. Each finding was reproduced
(or not) with a fresh test written by the verifier, exercising the real
public API (`moveTaskToProject`, `bulkMoveTasksToProject`, `setFields`,
`bulkSetFields`, `unsetField`, `setField`) against a tracker created by
`initLoctt` — not a hand-rolled imitation of the internals. The tests were
run as temporary files inside `packages/core/src/task/` and deleted
afterwards; `git status` shows no repo edits from this pass.

Verdicts: **#1 CONFIRMED (blocker stands). #2 CONFIRMED (major stands).**

---

## Finding 1 — `moveTaskToProject` / `bulkMoveTasksToProject` drop a health-only field, write guard bypassed via default `["*"]` touched

**Verdict: CONFIRMED, severity unchanged (blocker).**

### Code read

- `packages/core/src/task/move.ts:93-102` — `performMove` builds
  `updated: Task = { frontmatter: {...source.frontmatter, project, key, key_history, updated_at}, body: source.body }`.
  `source.health` is not carried. Confirmed by reading, not inferred.
- `move.ts:147` and `move.ts:207` — both call
  `writeTask(opts.locttDir, task.frontmatter.id, task)` with no fourth
  argument.
- `packages/core/src/task/io.ts:156-161` — `touched` defaults to
  `ALL_FIELDS_TOUCHED` = `new Set(["*"])` (`io.ts:175`).
- `io.ts:101` sets `universal = touched.has("*")`; `io.ts:126` wraps rule 2
  in `if (!universal)`, so the drop check is skipped entirely.
- `packages/core/src/task/frontmatter.ts:414-416` — the `assembleTaskFile`
  comment's claim that the compiler flags writers that omit `health` is
  false as stated: `health` is optional on `Task`, so `performMove`
  type-checks. Confirmed by the fact that the repo compiles.

### Test run (temporary `packages/core/src/task/zz-verify-phase-z.test.ts`, deleted)

Setup: `initLoctt(root, {docs:false})`, hand-write
`.loctt/tasks/<ID>/task.md` in the default project with one extra line
(`jira_id: ABC-1` or `due_date: 42`), `createProject(... prefix "ALT-")`.

| Test | Result |
|---|---|
| control: `setField(priority=high)` on the jira_id task, then on-disk file still contains `jira_id: ABC-1` | **PASS** (guard + carryHealth work on the setField path) |
| `moveTaskToProject({taskRef: ID, targetProjectId: alt.id})` then on-disk contains `jira_id: ABC-1` | **FAIL** — file has `key: ALT-1`, `key_history: [TASK-999]`, no `jira_id` |
| same with `due_date: 42`, assert on-disk contains `due_date: 42` | **FAIL** — raw value gone |
| `bulkMoveTasksToProject({taskRefs:[ID], ...})` — `failed` is `[]`, `succeeded` length 1, on-disk contains `jira_id: ABC-1` | **FAIL** on the on-disk assertion; the op reports success |

Second temporary test (`zz-verify-guard.test.ts`, deleted) checked the
mechanism claim directly: a move-shaped `Task` (frontmatter rebuilt without
`health`) written via `writeTask` with an explicit
`touched = {project, key, key_history, updated_at}` **rejects with
`CorruptWriteError`**; the same write with the default `touched` **resolves**.
So the guard is correct and would have caught this; the caller's universal
default is what disables it — exactly as the reviewer stated.

### Reasoning on severity

- User-reachable on all three surfaces: `apps/cli/src/commands/task-crud.ts`,
  `apps/mcp/src/tools/task-crud.ts`, `apps/web/src/server/server.ts` all
  import `moveTaskToProject`/`bulkMoveTasksToProject` (and
  `decisions.md:2276` records the web `useMoveTask` hook sending a
  one-element batch to the bulk endpoint, which shares `performMove`).
- Not intended behaviour: no `known-gaps.md` entry, no `decisions.md` § 8/9
  entry, and no row in `docs/dev/corruption-audit.md` covers move. No test
  anywhere asserts that move drops health; `move.test.ts` uses only clean
  `createTask` fixtures.
- Silent: the op returns success, the write guard does not fire, history
  records only `project` and `key` changes. The raw value is unrecoverable
  from the tracker afterwards. That is the P-11/§ 13.1 B1 class the guard
  exists for; blocker is the right classification.

---

## Finding 2 — `setFields` / `bulkSetFields` cannot unset a health-only field that `unsetField` can

**Verdict: CONFIRMED, severity unchanged (major).**

### Code read

- `packages/core/src/task/update.ts:634-640` — `unsetFieldLocked` has the
  health-only branch: `healthForField.length > 0 && !(field in fields)` →
  bump `updated_at` only; the health entry is dropped by `carryHealth` at
  `:661`.
- `update.ts:869-882` — `setFieldsLocked`'s final `else` (non-builtin,
  non-auto-managed) reads `existingFields` from `patch["fields"]` and at
  `:872-873` throws `custom field "${field}" is not set` when
  `value === undefined` and the field is absent. There is no consultation of
  `task.health` in this branch. A health-only field is never in `fields`, so
  the throw is unconditional for that case.
- `docs/dev/corruption-audit.md:62` records the `unsetField` case as
  **handled** with the note "previously threw 'custom field not set'" — i.e.
  this exact throw was already identified and fixed on the single-task path,
  and `setFieldsLocked` did not receive the fix. That is the parity drift the
  reviewer describes.

### Test run (same temporary file, deleted)

| Test | Result |
|---|---|
| control: `unsetField(locttDir, ID, "jira_id")` then on-disk no longer contains `jira_id` | **PASS** |
| `setFields({taskId: ID, changes: [{field: "jira_id", value: undefined}]})` succeeds | **FAIL** — `TaskUpdateError: custom field "jira_id" is not set` thrown at `update.ts:873` |
| `bulkSetFields({taskRefs: [ID], changes: [{field: "jira_id", value: undefined}]})` — `failed` is `[]` | **FAIL** — `failed = [{taskId: ID, error: 'custom field "jira_id" is not set'}]` |
| reviewer's caveat: `setFields` unset of wrong-typed builtin `due_date: 42` succeeds | **PASS** (builtins take the `delete patch[field]` branch at `:846`, as the reviewer said) |

### Reasoning on severity

- User-reachable: `loctt unset T-1,T-2 jira_id` goes through `bulkSetFields`
  with `value: undefined` (`apps/cli/src/commands/task-crud.ts:585`); MCP
  `bulk_set` with `value` null/omitted does the same
  (`apps/mcp/src/tools/task-crud.ts:445`); web `handleBulkSet` maps
  `null → undefined` (`server.ts:3779`); web single-task PATCH uses
  `setFields` (`server.ts:3147`). So the single-ref CLI command works and the
  comma-separated form of the identical command fails with a misleading
  message.
- No data is lost and the failure is reported, so it is not a blocker.
  It is a documented invariant break ("single and bulk must not drift",
  `update.ts:770-779`) with a wrong error message. Major is right.
- Not intended: the audit doc explicitly calls the health-only unset
  "handled"; nothing records the multi-field path as deliberately different.

---

## What was checked for refutation and did not hold

- Whether the guard would have caught #1 anyway: no — verified the default
  `["*"]` path resolves and the explicit-touched path rejects.
- Whether #1 is only reachable via internals: no — reproduced through
  `moveTaskToProject` and `bulkMoveTasksToProject` on an `initLoctt`
  tracker with a real `createProject` target.
- Whether #2 is asserted as intended by any existing test: `grep` of
  `update.test.ts`, `bulk.test.ts`, `bulk-parity.test.ts`,
  `corruption-audit.test.ts` finds no `value: undefined` on a health-only
  field via `setFields`/`bulkSetFields`; the only health-only unset test is
  on `unsetField` and asserts success.
- Whether either is a `known-gaps.md` entry already: neither is.

## Repo state after this pass

Temporary tests `packages/core/src/task/zz-verify-phase-z.test.ts` and
`packages/core/src/task/zz-verify-guard.test.ts` were created, run, and
deleted. `git status --short` shows only ` M TEMP-BUILD-PLAN.md` and the
untracked `docs/dev/phase-z-findings-*.md` files that pre-existed this pass,
plus this file.
