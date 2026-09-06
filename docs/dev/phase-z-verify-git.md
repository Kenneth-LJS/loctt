# Phase Z — Adversarial verification of `phase-z-findings-correctness-git.md`

Independent re-verification of the two CRITICAL findings. Every cited
function was re-read from source; each scenario was reproduced with a
fresh test written on the real `publish` / `applyReconcileDecisions`
API using the `publish-sync.test.ts` fixture style, **extended with a
bare `origin` remote** so the remote-push claim could be checked
directly rather than inferred. The test file was run once against
current `main` (099f0c4) and then deleted; no edits remain in the repo.

| Finding | Verdict | Local branch loses data | Remote loses data |
|---|---|---|---|
| 1 — publish mirrors over remote-only changes | **CONFIRMED** (both scenarios) | yes | **yes** (fast-forward push succeeds) |
| 2 — `applyReconcile` with `decisions: []` completes and publishes local-wins | **CONFIRMED** | yes | **yes** |

Both remain **Critical**. No reclassification.

---

## Finding 1 — CONFIRMED

### Control-flow check (source re-read)

- `publish` (`publish-sync.ts:907–991`): after the sentinel check and
  preflight, calls `detectPublishReconcile`; if it returns `undefined`
  falls straight into `commitToLocttBranch` (line 952) and, when
  `auto_push` + a reachable remote, `pushLocttBranch` (969).
- `detectPublishReconcile` (866–905): fetches the remote branch ref,
  early-returns `undefined` when `remoteHead === base`; otherwise runs
  `planSync` then `computeReconcilePlan` and **returns `undefined` when
  `reconcilePlan.conflicts.length === 0`** (899). There is no other
  signal — `plan.copies` / remote-only paths are computed by `planSync`
  and then discarded.
- `computeReconcilePlan` (`reconcile-plan.ts:441–457`): iterates only
  `plan.conflicts` (paths `planSync` classified `"conflict"`), skips
  non-task files and non-`task.md` files, and only yields per-field
  rows. A path `planSync` classified `"copy"` ("present on branch,
  absent locally" / "changed on branch only", `three-way.ts:200,220`)
  never reaches it.
- `commitToLocttBranch` (642–722): `git worktree add <branch>` at the
  branch's current tip (the fetched remote head), then `mirrorDir`
  (28–48). `mirrorDir` is a **blind one-way mirror**: it `rm`s every
  destination entry not in the local `.loctt/` and `rm`+`cp`s the rest.
  It does not merge. The only guard is `branchHasForeignContent`, which
  fires **only on first publish** (`last_synced_commit === undefined`,
  line 656) — irrelevant to a divergent re-publish.

Adversarial angles probed:

- *Does `planSync` catch remote-only adds some other way?* No. It
  classifies them correctly as `copy`, but `detectPublishReconcile` only
  looks at `conflicts`. The `copies` list is dropped on the floor.
- *Does `commitToLocttBranch` merge?* No — `mirrorDir` deletes and
  overwrites. Confirmed by reading and by the test outcome.
- *Is there a "you are behind, sync first" guard?* None found anywhere
  on the publish path. The line-884 comment ("branch has not moved:
  fast-forward publish") is the only divergence gate, and it lets
  divergence through when no field conflicts exist.
- *Would the push be rejected non-fast-forward?* No. Because the fetch
  happens first and the new commit is created **on top of** the fetched
  remote head, the push is a legitimate fast-forward. The remote accepts
  it. This is exactly what makes the loss silent.

### Test (scenario A — remote-only added task)

Fixture: `initLoctt` + `enableGit`, `git init --bare` as `origin`
(auto_push defaults on). Steps:

1. Local creates `T-1`, `publish` → pushed, `last_synced_commit = B`.
2. `commitOnBranch` adds `tasks/01M0REMOTEONLY0000000000AB/task.md`
   on `loctt`, `git push origin loctt`. Then **`git branch -f loctt B`**
   locally, so the only copy of the remote work is on the remote — this
   forces the fetch path in `detectPublishReconcile` to be the thing
   that sees it.
3. Local writes an unrelated `config/queries.yaml`, calls `publish`.

Observed:

```
F1-A publish: { committed: true, branch: 'loctt', pushed: true }
F1-A branch tasks: [ '01M1TBF6GMX40SW6G392433P7V' ]   remoteTip==remoteCommit: false
F1-A remote tasks: [ '01M1TBF6GMX40SW6G392433P7V' ]
AssertionError: expected [ '01M1TBF6…' ] to include '01M0REMOTEONLY0000000000AB'
```

No error, no reconcile. The branch tip and the **remote** tip both list
only the local task. The remote-added task is gone from both.

### Test (scenario B — remote-only edit to a task local did not touch)

Same fixture. Branch appends `"Remote appended paragraph."` to `T-1`'s
body, pushes; local ref rolled back to `B`; local edits only
`config/queries.yaml`; `publish`.

Observed:

```
F1-B publish threw: no
F1-B remoteTip==remoteCommit: false   remote body has para: false
AssertionError: expected '---\nid: …' to contain 'Remote appended paragraph.'
```

The branch tip's `task.md` is the local (stale) copy; the remote's
`task.md` no longer contains the paragraph.

### Is the remote-push loss real?

**Yes.** In both scenarios `pushed: true`, the bare remote's `loctt` ref
advanced past the other clone's commit, and a checkout of the remote tip
no longer contains the other clone's work. The prior finding inferred
this ("with a remote … the push fast-forwards"); it is now observed.

The content is still reachable in git history (the mirror commit's
parent is the remote commit), so recovery is possible by git archaeology
— but not by anything LocTT offers, and the next clone that syncs will
delete the task locally as "deleted on branch since last sync".

### What a fix must do (not done here)

`detectPublishReconcile` must treat *any* divergence that is not a pure
fast-forward as requiring a sync (or a merge) before the mirror, not
just per-field task conflicts. "No field conflicts" is not "safe to
mirror"; it is "safe to auto-merge", which is what `sync` already does.

---

## Finding 2 — CONFIRMED

### Control-flow check (source re-read)

- `applyReconcile` (`reconcile-apply.ts:183–227`): builds `byTask` from
  the **passed-in decisions** only (196–203). A conflict with no
  decision produces no `results` row. `complete = results.every(r => r.ok)`
  (225) — `[].every(...)` is `true`. Completeness is measured against
  what was attempted, never against `plan.conflicts`.
- `applyReconcileDecisions` (`reconcile-session.ts:157–206`): on
  `result.complete`, publish mode does `clearReconcileState` then
  `publish(locttDir, root, { afterReconcile: true })` (193–194). No
  check that `plan.conflicts` were all decided.
- `publish(..., { afterReconcile: true })` skips **both** the sentinel
  check (920) and `detectPublishReconcile` (936). So there is no
  re-detection on the afterReconcile path — the reviewer did not miss
  one. Sync mode is protected only incidentally, because
  `pullFromLocttBranch` re-plans; publish mode has no equivalent.
- Handler layer:
  - `apps/web/src/server/server.ts:2838–2848` —
    `const decisions = Array.isArray(raw.decisions) ? raw.decisions : []`,
    passed straight through. **A missing body field becomes `[]`, and `[]`
    is accepted.** No validation against the plan.
  - `apps/cli/src/commands/git.ts:255–272` — `JSON.parse` of the
    `--decisions` file, passed straight through. An empty JSON array is
    accepted.
  - The React panel (`ReconcilePanel.tsx:258`) does gate its Apply button
    with `disabled={undecided > 0}`. So the **UI path is closed**, but
    the HTTP endpoint, the CLI, and any script are open. The core
    function is the thing being trusted, and it does not hold.

### Test

Same fixture with a bare remote.

1. Local creates `T-1`, `publish` (pushed).
2. Branch sets `assignee: u-branch` (`updated_at` 2099), pushed; local
   sets `assignee: u-local`.
3. `publish` → throws `GitReconcileNeededError` with an `assignee`
   conflict; sentinel `mode: publish` written. (Correct so far.)
4. `applyReconcileDecisions(locttDir, root, [])`.

Observed:

```
F2 outcome: {"reconciled":true,"complete":true,"results":[],
             "pub":{"committed":true,"branch":"loctt","pushed":true}}
F2 sentinel: CLEARED | branch tip assignee u-branch: false  u-local: true
           | remote tip u-branch: false   remoteTip moved: true
AssertionError: expected true to be false   (outcome.reconciled)
```

Zero decisions, zero results, `complete: true`, sentinel cleared,
publish ran with the divergence check bypassed, branch **and remote**
now hold `assignee: u-local`. `u-branch` is gone. No conflict was
resolved and nothing reported failure.

### Is the remote-push loss real?

**Yes.** `pushed: true`, remote tip advanced, remote `task.md` lacks
`u-branch`.

### Note on the trigger

The prior finding framed this as "client bug or raw POST". Two further
realistic triggers, both accepted by the server handler as `[]`:
a `POST /api/git/reconcile/apply` with **no body field at all** (the
`Array.isArray` fallback), and a decisions file that lists conflicts
from a *previous* plan (every row hits the `conflict === undefined →
continue` branch at line 198, so `byTask` is empty and `complete` is
vacuously true). Under-covering decision sets (e.g. 1 of 2 conflicts
decided) follow the same path: the undecided conflict is simply
local-wins'd.

### What a fix must do (not done here)

`complete` must be computed as "every conflict in `plan.conflicts` whose
task is not in `alreadyApplied` has an `ok` result", and the publish
completion path should either re-run `detectPublishReconcile` or refuse
when the decision set does not cover the plan. The server handler should
also reject a body without a `decisions` array rather than defaulting
to `[]`.

---

## Verification hygiene

- Temp test `packages/core/src/git/zz-verify-phase-z.test.ts` created,
  run once (3/3 failed as expected — i.e. bugs reproduced), deleted.
- `git status` clean apart from this document.
- No stale worktrees left in the repo.
