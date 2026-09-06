# Phase Z — Code review of the Batch-1 correctness FIXES

Reviews the uncommitted working tree (the `git diff` plus the untracked
`apps/web/src/server/server.phase-z-error-mapping.test.ts`) against the
findings in `phase-z-findings-correctness-*.md` and the confirmed
mechanisms in `phase-z-verify-*.md`. Read-only: no source or test was
edited. One temporary probe test (`packages/core/src/git/zz-review-g1.test.ts`)
was written to reproduce the G1 regression below, run once, and deleted;
`git status` shows no trace of it.

What was run: `npm run typecheck` (exit 0); the ten changed core test
files (315/315 green); `server.phase-z-error-mapping`, `server.init`,
`server.unreadable-task` in `apps/web` (22/22 green); the G1 probe (3/3,
output quoted below).

| Fix | Verdict | One line |
|---|---|---|
| G1 publish refuses on remote-only divergence | **REGRESSION-RISK** | Fixes the finding, but also refuses a legitimate local-delete publish whenever the branch has moved, and the prescribed remedy (`sync`) silently resurrects the deleted task. MCP renders it as a server fault. |
| G2 reconcile completeness by conflict field | SOUND | Keying and coverage correct; no false negative found. CLI's "some tasks failed" message is now wrong for the undecided case. |
| T1 move carries health + MOVE_TOUCHED | SOUND | Touched set is complete; a health entry on a touched field is handled by the serializer's override-wins rule. |
| T2 setFields health-only unset | SOUND | Exact parity with `unsetFieldLocked`. |
| C1 staged-swap recovery gated on `base_dir` | SOUND | Both cases correct. A pre-existing non-atomic `rm(base)` window now also reaches created files — residual, not new in kind. |
| C2 BrokenSavedQuery.rawText | SOUND | Faithful (schema is `.strict()`, no defaults); only core constructs the type. |
| C3 drop colliding broken sub-entry | SOUND (code) / **unrecorded decision** | Verifier recommended refuse; fix chose silent drop; no § 8 entry. |
| Q1 date fields compared by calendar day | SOUND, one nit | `~` on a date field against a date literal now returns false. |
| Q2 `text` accepts only `~` | SOUND | Behaviour change for hand-written `text =`/`text !=` queries; docs updated; not in § 8. |
| WS1 UnreadableFileError extends LocttError | SOUND | No caller read the errno off `.code`; `fileErrno` has no readers either. Mapping valid. |
| WS2 init error attribution | SOUND | Envelope shapes valid; `initLoctt` cannot throw an `UnreadableFileError`, so the errno regex is not fooled. |
| WS3 search surfaces `unreadable` | SOUND | Same shape/channel as list; client tolerates the extra key. |

Must-fix before commit: **3** (two code, one docs) — see the prioritized
list at the end.

---

## G1 — `GitSyncFirstError`; publish refuses on `plan.copies`/`plan.deletes`

**Files:** `packages/core/src/git/publish-sync.ts`, `git/index.ts`,
`core/src/index.ts`, `contracts/src/service.ts` (`sync_needed`),
`apps/web/src/server/server.ts` (`gitErrorResponse`).

### Does it fix the finding? Yes.

`detectPublishReconcile` now returns `{kind:"sync-first"}` when
`planSync` produced copies/deletes but no field conflicts, and `publish`
throws before `commitToLocttBranch`. The verifier's scenarios A (remote
add) and B (remote-only edit) are both `copy` dispositions
(`three-way.ts:200`, `:220`), so both are caught. The regression test
reproduces scenario A and asserts the branch tip still holds the remote
task; reverting the fix makes `publish` resolve with `committed:true`,
so the test reddens. My probe case C (remote-only edit, nothing local)
also throws `GitSyncFirstError`.

### Regression (a): a legitimate local delete is refused, and `sync` undoes it

`planSync` classifies **every** path that is on the branch but not local
as `copy`, regardless of base — `three-way.ts:199-201`, with the header
comment admitting it: "present in base → copy (deleted locally; remote is
canonical for now — field-level merge will refine this)". The fix folds
all of `plan.copies` into the refusal, so a locally deleted task that the
branch still carries *unchanged since base* is now treated as remote-only
work that would be lost.

Probe (temporary test, deleted):

1. Publish tasks A and B. Another clone adds R on the branch.
2. Local deletes B (a normal `rm` of its task dir, i.e. what a delete does).
3. `publish` →

```
GitSyncFirstError, incomingPaths: [
  'tasks/01M0REMOTEONLY0000000000AB/task.md',      <- R: genuinely remote-only
  'tasks/01M1TE6H…/_history.yaml',                  <- B: local deleted it
  'tasks/01M1TE6H…/task.md'                         <- B: local deleted it
]
```

4. Follow the error's instruction, `loctt git sync` →
   `after sync, B resurrected: true`.

So the user's delete is undone by the remedy the error prescribes, with
no message saying B came back; they must notice, delete B again, and
publish a second time (which then fast-forwards because
`last_synced_commit` has advanced). Control: with the branch *unchanged*
since base, a local delete still publishes (probe case B, `committed:true`,
B absent from the branch) — the regression is gated on the branch having
moved for any reason, which in a multi-clone setup is the common case.

Not data loss, but a silent reversal of a user action, on the path the
fix itself routes the user down. Before the fix this scenario committed
(the delete landed; the remote-only R was wrongly deleted). The root
cause is `planSync`'s deliberate "deleted locally → copy" placeholder,
not the fix — but the fix is what turns the placeholder into a refusal.

**Also misattributed in the envelope.** `gitErrorResponse` emits every
path as `"changed on the branch since your last sync"`; for B that is
false. `PathPlan.reason` (which distinguishes "present on branch, absent
locally" from "changed on branch only") is discarded when the fix
flattens to `incomingPaths`. And `failures[].ref` is a raw path
containing the ULID, where `ErrorItemFailure.ref` is documented as "the
user-facing key (`T-12`), never the ULID — ERR-16".

**Fix shape (not applied).** In the sync-first branch, exclude copies
whose incoming content equals the base content (`readTreeFile(root, base, path)`
is already available to `planSync`; it would need to return a
`reason`/flag) — those are local deletes and are safe to mirror. Keep
refusing on `inBase === false` copies (remote adds) and on
"changed on branch only" copies. Alternatively, record this in
`known-gaps.md` with the probe above and make the message honest ("the
branch has N files you do not have locally") until `planSync` gets its
promised refinement.

### Regression (a'), `plan.deletes`

`deletes` = on local, absent on branch, present in base ("deleted on
branch since last sync"). Refusing here is right: the mirror would
resurrect a remote delete. Note that when local *also edited* the file,
`sync` will delete the local edits (pre-existing `planSync` behaviour —
no modify/delete conflict detection). The fix routes users into that
path but did not create it.

### Parity: MCP renders the new error as a server fault

`GitSyncFirstError extends GitSyncError extends Error` — not a
`LocttError`. `apps/mcp/src/runtime/errors.ts` `isKnownDomainError` has
no `GitSyncError`/`GitSyncFirstError` arm, so `publish_to_git`
(`apps/mcp/src/tools/git.ts:91` catches only `GitReconcileNeededError`)
rethrows and `apps/mcp/src/index.ts:157-162` surfaces it as a framework
server fault with a stack — the agent never sees the one sentence that
says "run sync". The CLI is fine by accident: `git.ts:128` rethrows, and
`index.ts:175` prints `Error: <message>` with exit RUNTIME. The web
returns `409 sync_needed`. A new user-actionable error that only one of
three surfaces renders is the "capability in core is not done until CLI
and MCP have it" rule.

### Error code / envelope

`sync_needed` is added to the `ErrorCode` union; there is no zod enum of
`ErrorCode` to update (grep of `service-schemas.ts` finds none). 409 +
`data_state:"not_saved"` + `recovery:{kind:"none"}` is consistent with
`reconcile_needed`. Arguably `recovery:{kind:"command", command:"loctt git sync"}`
is the more honest affordance — the message names that exact command.
The web client has no `sync_needed` branch; it falls to generic
rendering, which is acceptable.

### Decision not recorded

"Refuse and route through `sync`" vs "auto-merge in publish" is the call
the verifier posed and the docs did not settle. It is argued well in the
class doc-comment, but `decisions.md` § 8 has no entry (the only Phase Z
entry is A140). A compaction loses it.

**Verdict: REGRESSION-RISK.** Confirmed by probe.

---

## G2 — `applyReconcile.complete` measured against `plan.conflicts`

**Files:** `packages/core/src/git/reconcile-apply.ts`.

### Does it fix the finding? Yes.

`complete = allAttemptsOk && everyConflictCovered`. Empty decisions:
`coveredFields` is empty, `conflicts.every` is false → `complete:false`
→ `applyReconcileDecisions` takes the partial branch, keeps the sentinel,
does not publish. Reverting to `results.every(r => r.ok)` gives `true`
on `[]`, so the first test reddens. Stale decisions from a previous plan
hit the `continue` at :198, produce no `results` row, and cannot cover
anything → incomplete, as the verifier asked.

### Keying — correct

`coveredFields` uses `` `${taskId}\0${field}` ``, the same key
`conflictByKey` uses at :191, over the same `TaskConflictField.field`
and `ReconcileDecision.field` strings (e.g. `"title"`, `"fields.x"`,
`"parent"`). A decision is only added when its task is in `okTaskIds`,
i.e. it was part of the group `applyTask` wrote successfully. A stale
decision whose task happens to be in `okTaskIds` adds a key no conflict
needs — harmless.

### False negatives — none found

Traced: a task with two conflicting fields, both decided → one `applyTask`
call writes both, one `ok` row, both decision keys covered → complete.
Same task, one decided → the other field uncovered → incomplete (second
test, reddens on revert because the single write succeeds). Prior-pass
tasks: every conflict whose task is in `alreadyApplied` is covered
regardless of this pass's decisions, so GIT-32 resume still completes.
`parent` decisions share the same result row as scalars for that task.

### Loose ends (not blockers)

- `apps/cli/src/commands/git.ts:~272` prints "Reconciliation incomplete —
  some tasks failed; rerun after fixing them." That is now wrong for the
  case this fix creates: zero failures, N undecided. The outcome carries
  `results` (all ok) and `complete:false` but nothing enumerates the
  undecided fields, so no surface can say "3 conflicts still need a
  decision" without recomputing it from the plan. The web panel never
  reaches this (Apply is disabled while `undecided > 0`).
- `handleGitReconcileApply` (`server.ts:2899`) still defaults a missing
  body field to `[]`; now safe (200 with `complete:false`), but the
  verifier's "reject a body without a `decisions` array" was neither done
  nor recorded.

**Verdict: SOUND.**

---

## T1 — `performMove` carries `source.health`; `MOVE_TOUCHED`

**Files:** `packages/core/src/task/move.ts`.

### Is the touched set complete? Yes.

`performMove` (`move.ts:105-110`) writes exactly
`{...source.frontmatter, project, key, key_history, updated_at}`; nothing
else changes (`status_updated_at`, `completed_date`, slug — none exist on
this path). `MOVE_TOUCHED = {project, key, key_history, updated_at}`
matches. Both `writeTask` calls pass it.

### Health on a touched field — checked, no refusal

The fix carries `source.health` verbatim, unlike `setField`/`unsetField`
which run `carryHealth(health, field)` to drop the touched field's
entries. Under K26 a wrong-typed `updated_at` (or `key_history`) is a
plausible health entry, and the move overwrites that field. Traced
through `serializeFrontmatter` (`frontmatter.ts:335-337`): a health entry
whose field is present on `fm` is skipped — "override wins" — so the new
healthy value is emitted, no duplicate key, and on reparse the finding is
gone. Rule 2 (`io.ts:127-135`) then sees a vanished finding on a field in
`touched` → allowed. Rule 1 is unaffected. So the write neither refuses
nor corrupts. The only inconsistency is cosmetic: the in-memory `Task`
returned by `performMove` still lists the stale finding. Not a bug on
disk.

### Test

Injects `jira_id: ABC-1` (unrecognised key → health), moves, asserts the
line is on disk and in health afterwards, for both single and bulk. The
verifier showed the pre-fix path drops the line; the assertion reddens
on revert.

**Verdict: SOUND.**

---

## T2 — `setFieldsLocked` health-only unset branch

**Files:** `packages/core/src/task/update.ts:870-892`.

Mirrors `unsetFieldLocked:623-640` exactly: same `h.field.replace(/[[.].*$/, "")`
match, same `field in fields` guard, same "nothing to delete; the health
drop is the removal" reasoning. The removal itself is done by the
existing loop at `:941-943` (`carryHealth` per changed field) and the
field is in `touched` at `:944`, so rule 2 permits the finding to vanish.
For a field that is neither in `fields` nor in health, the "not set"
error is preserved. Tests cover `setFields` and `bulkSetFields` on an
unrecognised top-level key and assert the line leaves disk — red on
revert (the throw fires).

Whether either path can unset a wrong-typed *custom* field (whatever
name health gives it) was not examined; the two paths agree, which is
what the invariant at `:770-779` demands.

**Verdict: SOUND.**

---

## C1 — `recoverStagedSwap` gates the created-file delete on `base_dir`

**Files:** `packages/core/src/state/staged-swap.ts:227-256`.

### Both cases correct

- Interrupted mid-swap (base dir present, no backup for created files):
  `opUnfinished` true → created destinations deleted; originals restored
  from surviving backups. Matches the live `rollback`.
- Completed, cleanup interrupted (step 5 removed `base` before
  `clearJournalEntry`): `opUnfinished` false → created files left, and
  `had_original` files skip because their backups went with `base`.
  Exactly the verifier's F1c.
- `fileExists` is `access()`, which works on a directory.
- Live rollback failure (`SwapRollbackError`) leaves base + journal →
  boot recovery classifies as unfinished → correct.

### Residual (pre-existing in kind, widened in reach)

Step 5's `rm(base, {recursive:true})` is not atomic. A crash *during* it
leaves `base` present with some backups already deleted. Recovery then
restores the `had_original` files whose backups survived, leaves forward
the ones whose backups were removed, and — now — deletes every created
file. That is a split state. Before the fix, created files in this window
were left forward (by the bug), which happened to agree with the
"backup gone" siblings and disagree with the "backup present" ones; the
window was already split for `had_original` pairs. It is a few
milliseconds wide. Closing it needs an atomic done-marker (e.g. `rename`
`base` → `base.done` before the recursive `rm`, and test for either).
Worth a `known-gaps.md` line, not a blocker.

### Tests

The existing crash test lost its hand-made `backup/0` marker (which the
finding correctly called an impossible fixture); it now reddens on revert
(created file survives). "Mixed set" reddens on revert. "Completed" is
the guard against the naive unconditional-delete fix and is green either
way — that is its job.

**Verdict: SOUND.**

---

## C2 — `BrokenSavedQuery.rawText`

**Files:** `packages/contracts/src/query.ts`, `packages/core/src/config/queries.ts`.

`renderRawText(item)` is applied to the `SavedQuerySchema`-parsed item.
That schema is `.strict()` with no `.default()`s, so `item` has exactly
the keys the file had — `rawText` is faithful, and re-parsing it in
`serializeBrokenQuery` reconstructs every optional field (the test checks
`archived`, `sort`, `display` value-for-value and that the entry stays
`broken`). The `{id,name,query}` fallback is kept for an unparseable
`rawText`, which cannot occur for YAML `stringifyYaml` produced. The
schema now *requires* `rawText`; grep shows only `parseQueriesConfig`
constructs a `BrokenSavedQuery` (the web client only types it in
`sidebarData.ts`), and typecheck is clean. `rawText` now travels on the
sidebar's `broken` list — harmless. Red on revert (fields stripped).
Recorded under K28 in `decisions.md` as the residual — good.

**Verdict: SOUND.**

---

## C3 — `mergeBrokenIntoPlain` drops a broken twin whose key a valid entry claims

**Files:** `packages/core/src/config/workflow-write.ts`.

Code is correct: per sub-list, valid keys are collected from the
already-serialized entries, colliding broken entries are filtered out,
non-colliding ones survive (second test guards over-dropping), an entry
with no string `key` is preserved (cannot collide). Both tests redden on
revert (two `key: done` reach disk; the post-write `applyWorkflowEdit`
is refused).

**The unrecorded decision.** The verifier wrote: "Refusing is more
consistent with K28-WF's 'broken entries are sticky' ruling than
silently dropping the broken one." The fix drops, silently — the broken
twin's raw text is discarded from the file on that write with no
warning, and the write reports plain success. That may well be the right
call (the user visibly re-created the key), but it is a call the docs did
not settle, it goes against the verifier's recommendation, and it touches
Ken's K28 ruling. It needs a `decisions.md` § 8 entry with the revert
path. K29 (flat writers) and the prefix-format gap are correctly recorded
in `known-gaps.md`, with the caveat that "doctor flags it" must be tested
before trusting — good.

**Verdict: SOUND code; decision must be recorded.**

---

## Q1 — date-typed fields compared by calendar day

**Files:** `packages/core/src/query/evaluator.ts`.

Gated correctly: `isDateField` covers the three built-in
`DateOrIsoString` fields plus custom `type: date`, and excludes
`created_at`/`updated_at`/... on purpose (documented in code). The
operand must be a `DATE` or `TODAY` token; the tokenizer's `DATE` regex
is prefix `^\d{4}-\d{2}-\d{2}`, so a timestamp literal is also a `DATE`
token and `toDateOnly` normalises both sides. `in`/`not in` compare by
day only when every list item is a date/today. Tests cover the four
broken operators, the two that were right, a plain literal, and the
date-only control; red on revert for the boundary cases.

**Nit — `~` regression.** `compareValues` now dispatches to
`compareDates` *before* the `~` case whenever `dateAware` is set, and
`compareDates`' `default` returns `false`. So `due_date ~ 2026-06-01`
(a `DATE` operand) now returns false where it used to substring-match.
`validate.ts` does not forbid `~` on date fields (only `text`'s
operators). Trivial to fix: dispatch to `compareDates` only for
`= != < <= > >=`, or handle `~` in `compareDates` by falling through.

**Not recorded.** The verifier offered two fixes — compare by day, or
tighten `DateOrIsoString`/MCP `DateLikeString` to date-only and refuse
timestamps at the write guard. The fix chose the first; the contract
still advertises timestamps as valid. User docs were updated
(`query-language.md`), which is good; § 8 has nothing.

**Verdict: SOUND, one nit.**

---

## Q2 — `text` accepts only `~`

**Files:** `packages/core/src/query/validate.ts`.

Rejects all six other operators and `in` with a message naming the
alias and the fix; `text ~` still passes; works without a workflow. The
test table reddens on revert (validation would not throw). The docs
table gained a row.

Behaviour change to note: `text != x` gave the *correct* answer before
(verifier), and is now rejected; a saved view containing `text = x` in
`queries.yaml` is not marked broken at load (`parseQueriesConfig` only
parses) but now throws `QueryValidationError` when run via `listTasks`
(`list.ts:245`). That is the right outcome — an error instead of the
complement — but "reject rather than remap `=`→`~`" was the verifier's
open choice and is not in § 8.

**Verdict: SOUND.**

---

## WS1 — `UnreadableFileError extends LocttError` (`io_failed`), errno on `.fileErrno`

**Files:** `packages/core/src/utils/read-state.ts`, `apps/mcp/src/runtime/errors.ts`.

### Did moving errno off `.code` break a reader? No.

Every non-test reference to `UnreadableFileError` is either a `throw`
(ten config/state/history/comments loaders) or an `instanceof` +
`.message` (`diagnostics/integrity.ts:112,136,206`). No caller read
`.code` off it. The two generic `.code` readers in core —
`isMissingFile` (`ENOENT`) and `lock.ts:81` (`ELOCKED`) — never receive
an `UnreadableFileError` (`readFileState` maps ENOENT to `missing`
before the class is constructed). `fileErrno` has zero readers; it is
purely for the contract the doc-comment promises. `name` is set after
`super`, overriding `LocttError`'s `"LocttError"`; nothing switches on
the name string.

### Mapping

`io_failed` is a valid `ErrorCode`; `statusForCode` → 500;
`recovery:{kind:"none"}` matches `UnreadableTaskError`'s convention;
errno goes to `detail`. The MCP arm is necessary (not redundant):
`isKnownDomainError` does not include `LocttError` generically. The CLI
gets it through `KNOWN_DOMAIN_ERRORS`' `LocttError` entry. `read-state.test.ts`
updated to assert both axes. The five WS1 web tests would flatten to
`code:"unknown"` on revert.

**Verdict: SOUND.**

---

## WS2 — `handleInit` attributes fs / repair errors off the prefix

**Files:** `apps/web/src/server/server.ts:2732-2776`, `core/src/init/index.ts`, `core/src/index.ts`.

Branch order: errno regex `/^E[A-Z]+$/` (raw `EACCES`/`ENOSPC` →
`500 io_failed not_saved`), then `InitRepairNeededError` (→
`400 config_invalid`, `recovery:{kind:"command", command:"loctt init --repair"}`,
no `field`), then the prefix fallback. Checked that `initLoctt` cannot
throw an `UnreadableFileError` (it uses `fileExists`/`missingCoreFiles`
only), so the new `io_failed` `.code` cannot trip the regex, and Node's
underscore codes (`ERR_*`) do not match either. Both envelope shapes are
valid per `ErrorRecovery`. `InitRepairNeededError` is now exported from
core. Kept at 400 so `server.init.test.ts` holds — verified green.
The `chmod 555` test self-skips when the process can write; ran as
non-root here so it executed.

**Verdict: SOUND.**

---

## WS3 — `handleSearch` uses `loadAllTasksDetailed`

Same `unreadable` field, same shape and conditional emission as
`handleListTasks`. `useTaskSearch.ts` types the envelope loosely; an
extra key is ignored. Tests cover present and absent. Reddens on revert
(key absent).

**Verdict: SOUND.**

---

## Documentation consistency

Recorded correctly: A140 (WS1–3, with revert path), K28's C2 residual
note, K29 (flat writers' id collision, with the "doctor-flagged" caveat
flagged as untested), the prefix-format gap. `TEMP-BUILD-PLAN.md`'s
Status row updated. `query-language.md` updated for Q1 and Q2.

Not recorded anywhere: the G1 refuse-vs-merge call; the C3 drop-vs-refuse
call; the Q1 compare-by-day-vs-tighten-contract call; Q2's
reject-vs-remap call. These are exactly the "a call the docs did not
settle" class. `docs/user/cli/reference.md` / `mcp/reference.md` do not
mention that `git publish` can now refuse with a sync-first error.

---

## Prioritized: what needs another pass

**Must-fix before commit**

1. **G1 local-delete regression.** Either refine the sync-first check to
   exclude copies whose branch content equals the base content (local
   deletes — safe to mirror), or, if that is judged out of scope, record
   the probe above in `known-gaps.md` and make the envelope honest (stop
   saying "changed on the branch" for paths the branch did not change;
   `failures[].ref` should be a task key, not a ULID path). Shipping it
   as-is means the fix's own remedy silently undoes a user's delete.
2. **G1 MCP parity.** Add `GitSyncFirstError` (or `GitSyncError`) to
   `isKnownDomainError`, and catch it in `publish_to_git` the way
   `GitReconcileNeededError` is caught. Today the agent gets a stack.
3. **Record the four unrecorded calls** in `decisions.md` § 8 (G1
   refuse-vs-merge, C3 drop-vs-refuse against the verifier's
   recommendation, Q1 evaluator-vs-contract, Q2 reject-vs-remap), each
   with a revert path.

**Should-fix, small**

4. Q1: do not route `~` through `compareDates` (returns false for
   `due_date ~ 2026-06-01`).
5. G2: the CLI's "some tasks failed" line is wrong when all attempts
   succeeded and conflicts remain undecided; the outcome should name the
   undecided count/fields so any surface can say so.
6. G1: `recovery` could be `{kind:"command", command:"loctt git sync"}` —
   the message already names that command.

**Record, do not fix now**

7. C1: the non-atomic `rm(base)` window (a done-marker rename would close
   it) — `known-gaps.md`.
8. G2: the server still defaults a missing `decisions` body field to `[]`
   (now harmless); either reject it or note that core is the guard.
9. G1: `planSync`'s "deleted locally → copy (for now)" placeholder is
   the underlying cause of item 1 and also the reason `sync` resurrects
   local deletes generally; deserves its own gap entry if not already
   covered by a git-engine case.
