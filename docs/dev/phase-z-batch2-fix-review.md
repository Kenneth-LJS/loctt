# Phase Z Batch 2 — fix review (read-only)

**Date:** 2026-09-06 · **Scope:** the uncommitted working tree (`git diff`
+ untracked files) that implements K30 F1–F4, PRU-44, the a11y and
dead-code items, and the SEC-1/SEC-2 restore guard. **Method:** read
every diff; grepped each deleted symbol repo-wide; ran a scratch script
against `packages/core/dist` (which carries the new guard) to exercise
the restore guard with six crafted backups. No source or test edits.

## Verdict summary

| Area | Verdict | One line |
|---|---|---|
| SEC restore guard | **INCOMPLETE** | Escape is prevented everywhere, but the attachment/avatar check runs *after* `stagedSwap` and after the dry-run return — a crafted attachment name lands the whole text restore and skips the key-index rebuild, then reports "refusing the restore". |
| F3 web backup/restore | SOUND (notes) | Confirm gate cannot be bypassed on `overwrite`; CSRF is dispatcher-level; the three domain errors map to 409/400/409. A legit backup over 50 MB is refused by the attachment cap. |
| F2 CLI+MCP views | SOUND | All writes go through core `views/manage`; delete requires `--yes` / `confirm:true`; `ViewError` is a known MCP error. One weak CLI test. |
| F1 sprint progress | SOUND | CLI and MCP call `sprintProgressDetailed`; web client now consumes `?progress=true`; both views render `unreadable`. |
| F4 export + PRU-44 + a11y + dead code | SOUND (one parity note) | Core reuse confirmed; rename confirm present; `aria-labelledby` wired; all six deletions have zero code callers. |

**Must-fix count: 2** (both in the security area, both about the same
ordering defect). Everything else is a should-fix or a note.

---

## 1. SEC — `restore.ts` path guard

### (a) Are all backup-controlled write paths guarded?

Every path a backup record can influence, and what stops it:

| Record field | Where it is joined | Guard | Runs before `stagedSwap`? |
|---|---|---|---|
| `config.path` | `restore.ts:614-615` | `assertContainedPath` → `RestoreRefusedError` | yes |
| `task.attachments[].name` | `:725-726` | `assertSafeBasenameOrRefuse` | **no** — line 718 is the swap |
| `user.avatar.name` | `:734-735` | `assertSafeBasenameOrRefuse` | **no** |
| `task.id` | `getTaskFilePath` / `getCommentsFilePath` / `getHistoryFilePath` / `getAttachmentsDir` (`:678, :691, :705, :726`) | `assertSafeBasename` inside the path helpers → bare `Error` | yes (`:678` is before the swap) |
| `user.id` | `getUserDir` (`:621`) | same helper → bare `Error` | yes |
| displaced-body path (`:474`) | `join(getTasksDir(), id, ...)` with raw `id` | only reached when `present`, i.e. `id` is a `readdir` entry name, so it cannot contain a separator | n/a |
| `state.content` | fixed path `getStateFilePath` | n/a | yes |

Verified by scratch repro (`packages/core/dist`): a task record with
`id: "../../PWNED.txt"` and a user record with `id: "../../PWNED"` both
throw before anything is written and nothing lands outside the tracker.
So there is **no unguarded escape path**. The schema (`format.ts`) only
constrains `id`/`path`/`name` to `min(1)`, so the path helpers are the
only line of defence for ids — they hold, but they throw a bare `Error`
(see attribution note below).

### (b) Does the guard run before every write? — **No. This is the must-fix.**

`restore.ts` order: dry-run return at `:665` → `stagedSwap(locttDir,
writes)` at `:718` → attachment loop with the guard at `:721-730` →
avatar loop with the guard at `:731-738` → `rebuildKeyIndex` at `:743`.

Scratch repro, bare restore of a valid backup whose one task carries
`attachments: [{name: "../../../PWNED.txt", …}]`:

```
[att-traversal] error=RestoreRefusedError: attachment filename "../../../PWNED.txt"
    is unsafe (…) — refusing the restore
   tasks dir after: ["01M1TKHKYYBTPB51NRHEARM33M"]
[att-traversal-dryrun] error=none
```

Consequences:

1. **The restore is not refused; it is half-landed.** Every task.md,
   comment thread, history file, config file and `state.yaml` in the
   backup has been swapped in. The error text says "refusing the
   restore" and the class is the one whose contract everywhere else is
   "Nothing has been restored" (`:287, :295, :355`). On the web this is
   returned as a 409 `data_state: "not_saved"`, which is now false.
2. **`rebuildKeyIndex` is skipped** (`:743` is after the throw). The
   tracker now holds tasks whose keys are not in the index — the exact
   stale-index state BAK-C11 exists to prevent.
3. **Attachments already written earlier in the loop stay**, and for a
   bad avatar every attachment has been written.
4. **Dry run is green for a file the real run refuses.** The panel's
   "Preview (dry run)" — the thing the confirm gate tells the user to
   rely on — cannot see this refusal, because the guard is after the
   `dryRun` return.
5. In `overwrite` mode the local bodies have already been displaced and
   overwritten before the refusal.

Security-wise the escape itself is blocked (nothing outside the tracker
is written), so this is not the RCE vector reopened. But the fix as
written trades "arbitrary write" for "a crafted backup is a
half-restore that reports itself as a no-op", and the guard's own
doc-comment (`:108-110`, "BEFORE any write, so nothing lands") describes
behaviour the code does not have.

**Fix shape:** one validation pass immediately after `loadBackup`
(`:360`), before any `writes.push` and before the `dryRun` return, that
walks `loaded.tasks[*].attachments[*].name`, `loaded.users[*].avatar.name`,
and — to convert the bare `Error`s into attributed refusals — every
`loaded.tasks` key and `loaded.users` key through
`assertSafeBasenameOrRefuse`. Leave the in-loop asserts as defence in
depth. This also makes dry run and real run agree.

### (c) Is `assertContainedPath` correct?

Yes for the escape cases. `resolve(locttDir, relPath)` normalises `..`
segments and replaces the base for an absolute `relPath`; `relative()`
then yields `..`-prefixed (or, cross-drive on Windows, absolute) output
for anything outside. Checked mentally and by repro for `../../x`,
`/etc/x`, `config/../../x`. Null bytes are refused before `resolve`.
Symlinks: `resolve` does not follow them, but a backup cannot create a
symlink (it writes file content only), so a symlink inside the tracker
is the owner's and outside this threat model. A backslash on POSIX is
a literal filename character and stays contained.

Two edges, neither an escape:

- `relPath` that resolves *to* `locttDir` (`"."`, `"config/.."`) gives
  `rel === ""`, which is not refused. It reaches `stagedSwap`, which
  refuses a non-regular-file destination with a bare `Error`
  ("`…/.loctt exists and is not a regular file`"). Nothing written;
  but on the web that is a 500. Cheap to add `rel === ""` to the refusal.
- A **contained** path that is not a config file — `state.yaml`,
  `tasks/<id>/task.md`, `index/…` — is accepted and written through the
  swap (repro `config-inside-tasks`: `path: "state.yaml"` restored
  without complaint). `export.ts:288` only ever emits
  `config/<basename>`, so restricting to exactly that shape (prefix
  `config/`, single safe basename) costs no legitimate backup and
  removes a way for a crafted backup to overwrite arbitrary
  *tracker-internal* files under the guise of "config". Recommended,
  not blocking.

### (d) Does it break a legitimate backup?

No. `export.ts:304-310` names the avatar `avatar.jpg` unconditionally;
`readAttachments` names attachments from `readdir` basenames; config
paths are `config/<name>`. All pass both guards. A legit round-trip is
covered by the existing `restore.test.ts` suite and by the new
`server.backup.test.ts` bare round-trip.

### Test weakness (SEC-1 test)

`restore.test.ts:626-645` asserts `rejects.toThrow(RestoreRefusedError)`
and that `../PWNED-phase-z.txt` does not exist. It does **not** assert
that `dstDir/tasks` is still empty — and with the current ordering it is
not. The test is green while the behaviour it names ("refuses the whole
thing and nothing escapes") is only half true. It must additionally
assert an empty `tasks/` after the refusal and that the same file is
refused under `dryRun: true`. The SEC-2 (config) test is fine as-is
because that guard genuinely runs first.

### Attribution note (not a must-fix)

A traversal in `task.id` / `user.id` throws the helper's bare `Error`.
CLI: fine — `index.ts:177` prints `Error: <message>` and exits 1. MCP:
not in `isKnownDomainError`, so surfaces as a server fault. Web: not one
of the three mapped classes → rethrown → 500. Folding ids into the
pre-validation pass above fixes all three at once.

---

## 2. F3 — web backup/restore (`server.ts`, `BackupPanel.tsx`)

**Verdict: SOUND, with notes.**

- **Confirm gate.** `handleRestoreBackup` refuses `mode=overwrite`
  without `confirm=true` unless `dry_run=true`, before the body is
  parsed. There is no path to a write with `overwrite` and no confirm:
  the mode is parsed from the query string only, defaulting to `bare`;
  an unknown mode is a 400. `bare` is refused by core against any
  non-empty tracker; `merge` never touches a present id. `bare` into a
  *task-empty* tracker does replace its config files without a confirm
  — same as the CLI and MCP today, and K30 mandated a confirm for
  `overwrite` only, so this is consistent, just worth knowing.
- **Panel.** Sends `confirm=true` only when `mode === "overwrite"`,
  not dry-run, and `confirmText === "OVERWRITE"`; the button is
  disabled otherwise. Covered by `BackupPanel.test.tsx:64-132`.
- **CSRF.** `requireCsrfHeader` runs at `server.ts:4932` before route
  dispatch for every non-GET/HEAD/OPTIONS, so the new POST is covered
  without per-route code. `server.backup.test.ts` asserts the 403.
  `apiClient.postFile` sends `X-Loctt-Client`.
- **Error mapping.** `RestoreRefusedError` → 409 `conflict`;
  `BackupFormatError` → 400 `field: file`; `SchemaTooNewError` → 409
  `schema_mismatch`; multipart failure → 400. All tested. Anything else
  (the bare `Error`s from § 1) is a 500 — resolved by the § 1 fix.
- **Size cap (should-fix).** `parseMultipartFile` defaults to
  `DEFAULT_MAX_ATTACHMENT_BYTES` = 50 MB. A backup carries every
  attachment base64-encoded plus history, so a tracker with a few
  screenshots per task exceeds it easily. The user then sees 400
  "upload exceeds maximum size of 52428800 bytes" on a perfectly good
  backup, with the panel copy giving no hint. Either pass a much larger
  explicit cap for this endpoint or say in the panel/docs that large
  backups restore via the CLI.
- **Early 409 without draining the body.** The confirm refusal is sent
  before the multipart body is read. For a multi-MB upload Node may
  reset the connection before the browser reads the response; the tests
  pass because the bodies are tiny. Same pattern as the existing
  `?force` attach path, so noted only.
- **Export.** `exportBackup` is called with `splitThresholdBytes:
  Number.MAX_SAFE_INTEGER` (option exists, `export.ts:47`), streamed
  from a temp dir removed in `finally`. Fine.

---

## 3. F2 — CLI + MCP saved-view management

**Verdict: SOUND.**

- Every write subcommand/tool calls core `createView` / `editView` /
  `deleteView` / `archiveView` / `unarchiveView`; no reimplementation.
  `unarchiveView` now has callers (the CLAUDE.md complaint is closed).
- **Delete confirm.** CLI: `confirmHardDelete` — `--yes`, or a TTY
  prompt, or "refused" (exit 2) non-interactively. MCP:
  `requireConfirm(args, "delete_view")`. Both use `{hard: true}`,
  matching the web DELETE contract; archive is the reversible path.
- `ViewError` added to MCP `isKnownDomainError`. On the CLI it is *not*
  in `KNOWN_DOMAIN_ERRORS`, but `main()`'s outer catch prints
  `Error: <message>` and exits 1, so the user still gets core's
  sentence. Adding it to the list would be tidier, not necessary.
- `edit_view` distinguishes explicit `sort: null` from omission via
  `"sort" in args`; `index.ts:155` passes the zod-parsed object, which
  preserves an explicit null. Tested (`views.test.ts:74`).
- **TEST-WEAK (minor).** `views-manage.test.ts:55` "rejects a malformed
  query … with a usage/runtime error" asserts only `exitCode !== 0` and
  that the view is absent — it would pass on a crash with a stack
  trace. Assert `stderr` contains `invalid query`.
- Nit: `views create --sort -` is silently ignored (`parseSort` returns
  `null`, `sort ? … : {}` drops it) rather than rejected.

---

## 4. F1 — sprint progress parity + milestones `unreadable`

**Verdict: SOUND.**

- CLI `sprint list --progress` and MCP `list_sprints {progress:true}`
  both call `sprintProgressDetailed(locttDir, ids, workflow)` — the
  same core function the web server's `withProgress` uses for sprints
  and the exact mirror of the milestone path. `unreadable` is printed to
  stderr (CLI) / returned top-level only when non-empty (MCP), matching
  `handleListSprints` (`server.ts:1953-1960`).
- Web client: `useSprintsWithProgress` hits `/api/sprints?progress=true`
  under the `["workflow", …]` key so a workflow edit invalidates it;
  `SprintDetail` picks its own sprint out of the list and reuses
  `progressState` (zero-denominator suppression shared with milestones,
  not re-implemented). `MilestonesView` reads `unreadable` from
  `useMilestonesWithProgress`, whose `Page` type now declares the field
  the server already emitted (`:2047-2053`).
- Note: `SprintDetail` now triggers a full-task scan (all sprints'
  progress) on every detail open. Same cost model as the milestones
  page; acceptable, but it is a per-navigation scan, not a per-sprint
  one.
- Tests on all three surfaces cover opt-in, category-based done,
  discarded exclusion, and the unreadable case.

---

## 5. F4 export, PRU-44, a11y, dead code

**Verdict: SOUND, one parity note.**

- **Export reuse.** `task-export.ts` (CLI) and `export_tasks` (MCP) use
  `loadAllTasksDetailed` → `listTasks` → `filterForExport` →
  `exportTasksToCSV/JSON`, i.e. the web handler's pipeline. Unreadable
  tasks are named on stderr / in the tool text (BLK-44).
- **Parity note (pre-existing, but the new surfaces expose it).** CLI
  and MCP pass `includeArchived` into `listTasks`, which is what stops
  core from AND-ing `archived != true` onto the query
  (`query/list.ts:260`). The web `handleExportTasks` (`server.ts:3569-
  3575`) does *not* pass it, so the web `?archived=true` export can
  never contain an archived task unless a saved view is in play — the
  CLI/MCP `--archived` export can. The new code is the correct side;
  the web export should be aligned and the gap recorded in
  `known-gaps.md` if it is not already.
- **PRU-44.** `PrefixEdit` does not save on blur; `Change` opens a
  modal that states the task count and that old keys keep resolving;
  the mutation runs only from the modal's confirm button. Client-side
  exact and case-insensitive collision check, server `field: "prefix"`
  error rendered at the input and in the modal. `useSetProjectPrefix`
  invalidates `projects`, `tasks` and `recents`, so renamed keys do not
  linger in list caches. Covered by `ProjectsPanel.test.tsx`.
- **ReconcilePanel a11y.** `useId()` on the field-name `<div>`,
  `aria-labelledby` on both the `<select>` and the free-text `<input>`.
  Correct. `ConflictRow` is now exported for the test — harmless.
- **Dead code.** Grepped repo-wide (excluding `node_modules`, `dist`,
  `.git`) for `useUpdateUser`, `useSaveWorkflow`, `withCollection`,
  `DEFAULT_COLUMN_ORDER`, `lockedCustomFieldProps`, `defaultStatusKey`:
  **zero references in code or tests.** The only hits are two
  historical narrative mentions in `decisions.md` (`:1127`, `:7813`)
  describing past state — accurate as history, no action.
- **Modified tests, intent check.**
  - `task-capability-reach.test.ts`: the old "export is absent and
    documented so" case was inverted to "export runs and is
    documented". That is the retarget K30 explicitly orders, not a
    weakening. Minor: the doc assertion `/[Ee]xport/` is satisfied by
    any occurrence of the word; assert the `loctt export` heading and
    the `export_tasks` tool name instead.
  - `server.test.ts`: comment-only change.
  - `11-mcp-schema-contract.test.ts`: additions for the six new tools
    only.
  - `restore.test.ts`: additions only — but see § 1 for what the new
    SEC-1 case fails to assert.
- Docs: the CLI/MCP "on every surface" lines now name the web UI, so
  the K30 note about `reference.md:1157` is resolved by the build
  rather than by deletion.

---

## Must-fix (prioritised)

1. **`packages/core/src/backup/restore.ts` — validate attachment and
   avatar names (and task/user ids, via `assertSafeBasenameOrRefuse`)
   in one pass right after `loadBackup` (`:360`), before any
   `writes.push` and before the `dryRun` return.** Today a crafted
   attachment name lands the full text restore, skips
   `rebuildKeyIndex`, and then reports "refusing the restore"; the dry
   run says nothing is wrong. Repro above.
2. **`packages/core/src/backup/restore.test.ts` SEC-1 case — assert
   `dstDir/tasks` is empty after the refusal and that `dryRun: true`
   on the same file also throws `RestoreRefusedError`.** As written the
   test passes against the defective ordering.

## Should-fix (not blocking)

- `assertContainedPath`: also refuse `rel === ""` and restrict config
  paths to `config/<safe basename>` (export never emits anything else).
- `handleRestoreBackup`: an explicit, larger size cap or a documented
  "restore large backups via the CLI"; 50 MB is the attachment default.
- Align web `handleExportTasks` with the CLI/MCP `includeArchived`
  handling, or record the divergence in `known-gaps.md`.
- Strengthen the two weak assertions (`views-manage.test.ts:55`,
  `task-capability-reach.test.ts` doc regex).
