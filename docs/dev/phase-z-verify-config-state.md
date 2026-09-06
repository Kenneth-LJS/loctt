# Phase Z — Adversarial verification of `phase-z-findings-correctness-config-state.md`

Independent re-test of the three findings against current source
(`main` @ 099f0c4, working tree). Each was reproduced through the real
public API, not by hand-building on-disk layouts. The scratch test lived
at `packages/core/src/zz-phasez-verify.test.ts` for the run and is
deleted; nothing in this pass edited the repo.

| # | Report severity | Verdict | Verified severity |
|---|---|---|---|
| 1 | HIGH | **CONFIRMED** (with a correction to the suggested fix) | HIGH |
| 2 | MEDIUM-HIGH | **CONFIRMED** | MEDIUM-HIGH |
| 3 | LOW-MEDIUM | **RECLASSIFIED** — mechanism confirmed, but the "doctor flags it" claim is false; the duplicate is invisible until the user repairs the broken entry, at which point every workflow write is refused | MEDIUM |

---

## Finding 1 — `recoverStagedSwap` leaves created files orphaned

**Verdict: CONFIRMED.** Severity HIGH stands.

### Premise check (the thing the whole finding hinges on)

The report claims `stagedSwap` never writes a backup for
`had_original:false`. Verified against the actual code, not the report:

- `staged-swap.ts:136-138` — `for (const s of staged) { if (hadOriginal.has(s.dest)) await copyFile(s.dest, s.backup); }`. No `else`. No marker file.
- `staged-swap.ts:236` — `} else if (await fileExists(f.backup)) { await rm(f.dest, { force: true }); }` — the delete branch for a created file is gated on a backup that line 137 never writes.

And empirically (test F1a below): after driving a real `stagedSwap` to an
interrupted state with one created and one pre-existing destination, the
journal entry's `files[0].backup` path (`.../backup/0`) does **not** exist
on disk and `readdir(backupDir)` returns `["1"]` only. The premise is true.

### Test I ran

Drove `stagedSwap` itself to the crash state rather than hand-building it.
`node:fs/promises` was partially mocked (`rename`, `rm` wrapping the real
implementations) so the crash could be injected at a chosen point:

- writes = `[{ tasks/fresh (does not exist) }, { tasks/a (exists, "old-a") }]`
- `rename(to === tasks/a)` throws → simulates a kill between swap #1 and swap #2 (`fresh` has landed, `a` has not). Keyed on the destination path, not a call count, because `saveJournal`'s atomic write also renames.
- `rm(tasks/fresh)` throws during the live rollback → rollback fails → `SwapRollbackError`, journal entry and backup dir left in place. This is the documented manual-recovery state and is byte-for-byte what a SIGKILL between the two renames leaves (created file present, journal entry present, `backup/1` present, `backup/0` absent).
- Mocks restored to real fs; `recoverPendingJournal(dir)` run (the hook `withStateLock` fires at boot; the `staged_swap` handler is registered at module load).

Assertions and results:

| Assertion | Result |
|---|---|
| F1a: `journal.entries[0].swap.files.map(had_original)` = `[false, true]` | pass |
| F1a: `readdir(backupDir)` = `["1"]`; `stat(files[0].backup)` → ENOENT | pass — **premise confirmed** |
| F1a: `tasks/fresh` = `"new-fresh"` after the failed swap (it landed) | pass |
| F1b: after `recoverPendingJournal`, journal is empty and `tasks/a` = `"old-a"` | pass |
| **F1b: after recovery, `readdir(tasks)` = `["a"]`** | **FAIL — got `["a", "fresh"]`** |

The created file survives boot recovery. `rollback` (live path, line
197-199) deletes it correctly; `recoverStagedSwap` (boot path) does not.
The report's mechanism, scenario and "impossible fixture" analysis of
`staged-swap.test.ts:219-220` are all accurate — the existing test
manufactures `backup/0` by hand, which is why the dead branch looks
reachable.

Blast radius confirmed by grep: `backup/restore.ts:664` and
`task/bulk.ts:131, 220` call `stagedSwap`. A restore writes task files
that do not yet exist (`had_original:false`), so an interrupted restore
recovers to "originals restored, new task files orphaned" — the
partially-restored tracker the module header says cannot happen.

### Correction to the report's suggested fix

The report suggests: "for `had_original: false`, delete the destination
unconditionally (mirroring the live `rollback`)". **That fix is wrong**
and would introduce a new data-loss bug. I tested the case it breaks:

F1c — crash **after** step 5's `rm(base)` but **before** `clearJournalEntry`
(injected by making `clearJournalEntry` reject once). The swap is
complete and correct; only the journal entry is stale. Current code:
recovery finds no backup for `a` → skips (correct, per the comment on
line 229-231), no backup for `fresh` → skips, both `new-a` and
`new-fresh` stand. **Pass.** Under the suggested unconditional delete,
`fresh` would be deleted while `a` keeps its new content — rolling one
file forward and one back, the exact inconsistent state V6 exists to
prevent.

The `fileExists(f.backup)` guard on the `had_original:true` branch is
doing real work: it distinguishes "interrupted mid-swap" from "completed,
cleanup interrupted". The `had_original:false` branch needs the same
distinction but has no per-file backup to key on. The correct signal is
whether `swap.base_dir` still exists (it is removed as one unit at step 5,
before the journal entry is cleared): base dir present → op unfinished →
delete created destinations; base dir gone → op completed → leave them.
Any fix and its test should cover both F1b and F1c.

---

## Finding 2 — Broken saved view loses `sort` / `display` / `archived` on any write

**Verdict: CONFIRMED.** Severity MEDIUM-HIGH stands. This is Ken's K28
work; I was looking for a reason it is not as described and did not find
one.

### Mechanism check

- `queries.ts:63-80` — a DSL failure pushes `{ id, name, query, error, position, index }` into `broken`. `item.sort`, `item.display`, `item.archived` were parsed by `SavedQuerySchema` (line 23/30) and are on `item`, but are not carried.
- `contracts/src/query.ts:89-96` — `BrokenSavedQuerySchema` is `.strict()` with exactly those six fields; there is no place to carry them.
- `queries.ts:135-137` — `serializeBrokenQuery` emits `{ id, name, query }`. The doc comment above it asserts "`{id, name, query}` is exactly the on-disk shape of a saved query" — that is the false premise: a saved query's on-disk shape is `id/name/query/sort?/display?/archived?`.
- All five writers in `views/manage.ts` (`createView`, `editView`, `archiveView`, `unarchiveView`, `deleteView`) thread `config.broken` into `saveQueriesConfig`, so preservation of the *entry* works (K28 held), but preservation of its *optional fields* does not.

### Test I ran

`initLoctt` a tracker, overwrite `queries.yaml` with a valid view `good`
and a view `bad` whose DSL is `status = = =` and which carries
`archived: true`, `sort: [{created_at desc}]`, `display: {mode: board, group_by: priority}`.
Confirmed the loader sorts `bad` into `broken` (`loaded.broken.map(id)` = `["bad"]`).

| Test | Path | Result |
|---|---|---|
| F2a | `loadQueriesConfig` → `saveQueriesConfig(loaded)` → read raw file; expect `archived: true`, `created_at`, `mode: board` present | **FAIL** — `bad` on disk is exactly `{id, name, query}` |
| F2b | real surface: `editView(locttDir, "good", { name })`; then hand-fix `bad`'s DSL in the file; `loadQueriesConfig`; expect `bad.archived === true` | **FAIL** — `archived` is `undefined`; `sort`/`display` also gone |
| F2c | real surface: `archiveView(locttDir, "good")`; expect `mode: board` still in file | **FAIL** — gone |

The raw file after F2a (verbatim):

```yaml
queries:
  - id: good
    name: Good
    query: status = open
  - id: bad
    name: Bad
    query: status = = =
```

F2b is the user-visible consequence the report describes: the user makes
a typo in one view's DSL, renames a *different* view, later fixes the
typo, and their board view comes back as a default list view,
unarchived. Silent, and the evidence is erased from the file they would
look in. The report's contrast with the other six writers is accurate:
`brokenEntriesToPlain` re-emits the full `rawText`, so those preserve
every field; queries is the one lossy carrier.

Fairness note: the K28 change did close the loss it targeted (the whole
entry vanishing). This is a narrower residual loss inside that fix, and
the report correctly frames it that way. It is not a regression — before
K28 the entire entry was dropped.

---

## Finding 3 — Broken/valid key collision writes a duplicate past the validation gate

**Verdict: RECLASSIFIED (LOW-MEDIUM → MEDIUM).** The mechanism is real
and the duplicate reaches disk exactly as described. But the report's
severity rationale rests on "`loctt doctor` will report the duplicate",
and **that is false**: doctor reports the pre-existing broken entry as
malformed (as it did before the write) and reports `workflow.yaml` as
`ok — valid`. The duplicate is undetectable until the user repairs the
broken entry, at which point every workflow write is refused.

### Mechanism check

- `workflow-write.ts:86` — `assertWorkflowConfigValid(config)` runs `validateWorkflowConfig` on the **valid-only** `config.statuses`.
- `workflow-write.ts:111-115` — only after that does `readOnDiskBroken` + `mergeBrokenIntoPlain` append the broken entries.
- `workflow-write.ts:150-154` — `plain[key] = [...existing, ...extra]` with no key-collision check.
- `validation.ts:248-254` — the duplicate-status check iterates `config.statuses` only. `config.broken.statuses` is never consulted. So on a later tolerant load, the valid `done` is in `statuses` and the broken `done` is in `broken.statuses`, and `validateWorkflowConfig` sees one `done`.
- `diagnostics/doctor.ts:165-166` — doctor is `loadWorkflowConfig` (tolerant) → `validateWorkflowConfig`. Same blind spot.

### Test I ran

`initLoctt`, overwrite `workflow.yaml` with `not_started` (valid,
default) and `done` with `category: bogus` (broken). Confirmed
`before.statuses` = `["not_started"]`, `before.broken.statuses[0].id` = `"done"`.
Then, through the real entry point the Settings form uses:
`applyWorkflowEdit(locttDir, { ...before, statuses: [...before.statuses, { key: "done", label: "Done", category: "completed" }] })`.

| Test | Assertion | Result |
|---|---|---|
| F3a | raw file contains exactly one `key: done` | **FAIL — contains 2.** Duplicate reached disk. |
| F3b | tolerant reload: `statuses` = `["not_started","done"]`, `broken.statuses` = `["done"]` | pass — both preserved, no data loss (report correct on this point) |
| F3b | `runDoctor` or `checkDataIntegrity` output matches `/duplicate/i` | **FAIL.** Doctor: `workflow.yaml: ok — valid`. Integrity: one `malformed` finding for `done` (`category must be one of…`) — the same finding it emitted before the write. Nothing says "duplicate". |
| F3c | user hand-fixes `category: bogus` → `completed`; `runDoctor` workflow check | pass — **now** `warn: duplicate status key "done"` (both entries are valid, so both reach `statuses`) |
| F3c | next `applyWorkflowEdit` (unrelated: add a priority) | pass — **rejected** with `duplicate status key "done"` |

Raw file after F3a (verbatim):

```yaml
statuses:
  - key: not_started
    label: Not started
    category: pending
    default: true
  - key: done
    label: Done
    category: completed
  - key: done
    label: Done (broken)
    category: bogus
```

### Why MEDIUM rather than LOW-MEDIUM

The report is right that no data is lost and the file still loads. It is
wrong that doctor flags it. Corrected consequence chain:

1. Write succeeds; file has two `done`. Doctor says `valid`. The Settings
   form shows one `done`. The user has no signal anything is off.
2. The user eventually does what the malformed-entry message tells them —
   "repair it by hand" — and fixes `category: bogus`.
3. Now both are valid, both load into `statuses`, and `assertWorkflowConfigValid`
   refuses **every** subsequent workflow write with `duplicate status key "done"`,
   including ones unrelated to statuses. Doctor now warns.
4. The user must work out that the fix they were told to make is what
   broke saving, and delete one of two entries with the same key — with
   no guidance on which one tasks are referencing.

That is a write persisting a state the gate exists to prevent, whose
symptom surfaces later, at the moment the user follows the app's own
repair instruction. Still not data loss; still not Finding 1. But "a
write never persists a config `doctor` would flag" is *not* the
invariant actually violated here, because doctor does not flag it — the
violated invariant is the plainer one that a write never produces two
entries with one key. The report's "doctor-flagged and lossless"
framing also appears in its sound-areas note for the id-keyed configs
("A valid/broken **id** collision is possible … but is doctor-flagged")
— that claim was not tested here and, given the same `broken`-blind
validator pattern, should not be trusted without a test.

Fix shape (not applied): in `mergeBrokenIntoPlain`, skip (or refuse
with a clear error naming the key) any broken entry whose `key` matches
a valid entry already in `plain[key]`. Refusing is more consistent with
K28-WF's "broken entries are sticky" ruling than silently dropping the
broken one; a test must cover both the write being refused and the
broken entry surviving on disk.

---

## Repo state

- Scratch test `packages/core/src/zz-phasez-verify.test.ts` created, run, deleted.
- `git status` after cleanup: `M TEMP-BUILD-PLAN.md` plus the untracked
  `docs/dev/phase-z-*.md` files, and one untracked
  `packages/core/src/query/zz-phase-z-verify.test.ts` that is **not
  mine** (a sibling verifier's scratch file; left untouched).
- No source, test, or doc edits other than this file.
