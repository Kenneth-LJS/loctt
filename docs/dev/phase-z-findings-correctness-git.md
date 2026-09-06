# Phase Z — Correctness findings: `packages/core/src/git/`

Read-only review of git-backed mode (publish/sync, temp-worktree flow,
push/fetch, reconcile plan/apply/sentinel, branch adoption, conflict
handling). Two findings survive the finding bar; both are reproduced
with a failing test written against the current code. A list of what was
checked and cleared follows.

Severity key: **Critical** = silent data loss / lost commits.

---

## Finding 1 — Critical — publish silently discards any remote change that is not a per-*field* task conflict (lost commits / data loss)

**Where:** `packages/core/src/git/publish-sync.ts`
- `detectPublishReconcile` (lines 866–905) — only opens reconciliation
  when `reconcilePlan.conflicts.length > 0`, i.e. per-field task
  conflicts.
- `publish` (lines 936–952) — proceeds to `commitToLocttBranch` when
  `detectPublishReconcile` returns `undefined`.
- `commitToLocttBranch` → `mirrorDir` (lines 28–48, invoked at 689) — a
  blind one-way mirror that **deletes every branch entry not present in
  local `.loctt/`** and overwrites the rest.

**Mechanism.** On a divergent publish (branch head moved past
`last_synced_commit`), `detectPublishReconcile` fetches the remote,
computes a three-way `planSync`, then a `computeReconcilePlan`. But
`computeReconcilePlan` reports only *task-field* conflicts (see
`reconcile-plan.ts:441–457`, which `continue`s past every non-task-file
path and only classifies fields on task files that changed on *both*
sides). A branch change that is **remote-only** — a task the branch
added, a task the branch edited that local never touched, a file the
branch changed — is classified by `planSync` as `copy`/`keep`, **not**
`conflict`. So `reconcilePlan.conflicts` is empty, `detectPublishReconcile`
returns `undefined`, and publish never pulls the divergent branch content
in. `commitToLocttBranch` then checks out the branch (now at the fetched
remote head), mirrors the *stale local* `.loctt/` over it — deleting the
remote-only work — commits on top of the remote head, and (with a remote
configured) fast-forward-pushes, so the remote loses it too.

Publish's design comment (line 884, "branch has not moved: fast-forward
publish") assumes any divergence without field conflicts is safe to
mirror over. It is not: the mirror is only safe when local is strictly
ahead of the branch, which divergence violates.

**Concrete failing scenario A (remote-only added task):**
1. Clone A creates task `T-1`, `publish` → branch base commit `B`.
2. Clone B publishes a brand-new task (dir `01M0REMOTEONLY…`) onto the
   branch. Clone A never syncs it in.
3. Clone A makes an unrelated local edit (e.g. `config/queries.yaml`) and
   runs `publish`.
4. **Result:** the branch tip contains only `T-1`; `01M0REMOTEONLY…` is
   gone. Expected: the remote-only task is preserved (publish should
   reconcile/refuse, not mirror over a branch it is behind).

**Concrete failing scenario B (remote-only edit to a task local did not touch):**
1. Clone A creates `T-1`, `publish` → base `B`.
2. Clone B appends a paragraph to `T-1`'s body on the branch and commits.
3. Clone A edits nothing on `T-1`, makes an unrelated edit, runs `publish`.
4. **Result:** the branch tip's `T-1/task.md` no longer contains the
   remote paragraph — it was overwritten by clone A's stale copy.

Both were reproduced with a failing test using the existing
`publish-sync.test.ts` fixture (`initLoctt` + `enableGit`, a
`commitOnBranch` helper that advances the `loctt` branch in a throwaway
worktree). In scenario A the assertion
`expect(tasks).toContain(remoteId)` failed — the branch tip listed only
the local task. In scenario B `expect(body).toContain("Remote appended…")`
failed. (There is no remote in the fixture, so the loss is on the local
branch ref; with a remote, the new commit's parent is the fetched remote
head, so the push fast-forwards and the remote tip loses the content
too.)

**Why existing tests miss it.** `publish-sync.test.ts` covers publish of
a *fast-forward* nature ("removes files from loctt branch when deleted
locally" — where local *is* ahead) and covers divergence only through the
per-field-conflict path (GIT-6/GIT-11 `assignee`/`title` conflicts at
lines 204–252, 462–495, which correctly open reconciliation). No test
publishes when the branch has advanced with a change local did **not**
also make on the same field — the exact gap between "fast-forward" and
"field conflict" where the blind mirror runs. The `sync`-side twin ("keeps
a locally-created task that never reached the branch", line 174) proves
*sync* handles the symmetric case, which likely masked the belief that
publish did too.

---

## Finding 2 — Critical — `applyReconcile` treats "no decisions" as complete; a publish-mode reconcile then completes with empty decisions and silently local-wins the remote's contested field

**Where:**
- `packages/core/src/git/reconcile-apply.ts:225` —
  `const complete = results.every(r => r.ok);`
- `packages/core/src/git/reconcile-session.ts:177–195` — on
  `result.complete`, publish mode clears the sentinel and runs
  `publish(locttDir, root, { afterReconcile: true })`.
- `apps/web/src/server/server.ts:2838–2848`
  (`handleGitReconcileApply`) and `apps/cli/src/commands/git.ts:263`
  pass the client's `decisions` array straight through with no check
  that every plan conflict received a decision (server defaults a missing
  array to `[]`).

**Mechanism.** `applyReconcile` groups the passed-in *decisions* by task
(lines 194–203). A conflict with no matching decision never enters
`byTask`, so it produces no `results` row. `complete = results.every(...)`
is therefore `true` even when zero (or a subset of) conflicts were
decided — vacuously true for an empty `results`. In `applyReconcileDecisions`,
`result.complete === true` on a **publish**-mode sentinel clears the
sentinel and calls `publish(..., { afterReconcile: true })`, which
**skips** both the sentinel check and `detectPublishReconcile` (see
`publish` lines 920–950, guarded by `opts?.afterReconcile !== true`).
Publish then mirrors local `.loctt/` over the branch head via
`commitToLocttBranch` — silently applying local-wins to every contested
field the user never resolved, and discarding the remote's values.

(Sync mode is protected here: its completion path re-runs
`pullFromLocttBranch`, which re-plans and re-halts with
`GitReconcileNeededError` on the still-unresolved conflict. Only publish
mode loses data, because `afterReconcile` bypasses re-detection.)

**Concrete failing scenario:**
1. Clone A creates `T-1`, `publish` → base `B`.
2. Branch sets `assignee: u-branch` (updated_at 2099); clone A sets
   `assignee: u-local` locally — a genuine two-sided field conflict.
3. Clone A runs `publish` → throws `GitReconcileNeededError` (correct),
   writing a `mode: publish` sentinel.
4. Client calls apply with **`decisions: []`** (e.g. `POST
   /api/git/reconcile/apply {"decisions":[]}`, or a client bug).
5. **Result:** `applyReconcileDecisions([])` returns `reconciled: true`;
   the sentinel is cleared; the branch tip holds `assignee: u-local`. The
   remote's `u-branch` is gone, no conflict was resolved, no error, no
   audit entry.

Reproduced with a failing test on the existing fixture: after step 4,
`outcome.reconciled === true` and the branch tip's `task.md` contained
`assignee: u-local` with no trace of `u-branch`.

**Why existing tests miss it.** The reconcile tests
(`reconcile.test.ts`, `reconcile-apply.test.ts`, `reconcile-sentinel.test.ts`)
exercise apply with decisions that cover every conflict and the partial-
failure path (a task whose write throws). None applies an **empty or
under-covering** decision set against a live plan, so the vacuous-`true`
completeness of `results.every` on `[]` is never asserted against. The
publish-completion bypass (`afterReconcile`) is only ever reached in
tests through the fully-decided path.

**Note on the correct invariant.** `complete` should mean "every conflict
in `plan.conflicts` (net of `alreadyApplied`) has a landed decision", not
"nothing I attempted failed". A fix would compute completeness against
the plan's conflict set, not against the attempted `results`.

---

## Checked and cleared (no finding)

- **Publish blocks on `unreadable`, never `malformed` (risk class 4).**
  `publish` → `preflight` → `blockingFindings` filters
  `severity === "unreadable"` only (`diagnostics/integrity.ts:412–416`);
  malformed entries are kept and non-blocking (P-11). Correct.
- **Corrupt file merged as empty / blocking incorrectly.** In
  `resolveConflicts`, an unreadable side routes to `unresolved` →
  `GitConflictError` abort before any write (`resolve-conflicts.ts:150–156`);
  a non-array YAML list throws → `unresolved` (`parseYamlList`,
  118–124). `computeReconcilePlan.readTaskFileAt` returns `undefined` on
  parse failure → the conflict row is skipped, not merged-as-empty. No
  merge-as-empty path found.
- **Interrupted-reconcile sentinel.** `pullFromLocttBranch` writes the
  sync sentinel before the first mutation and clears it as the last write
  (`publish-sync.ts:1167–1213`); a present sentinel blocks a fresh
  sync/publish (`GitReconcileInterruptedError`, 1040–1045, 920–925). The
  documented publish-does-not-write-a-sentinel reasoning (1160–1166) is
  sound — publish stages into a temp worktree, so an interrupted publish
  leaves `.loctt/` untouched.
- **Worktree temp-dir cleanup / collision.** Fixed distinct paths
  (`.worktree-publish`, `.worktree-sync`, `.worktree-publish-check`) plus
  `worktree prune` before each `add` recover a hard-kill orphan (tested,
  publish-sync.test.ts:309). Concurrent reconcile GETs use a randomised
  suffix (`reconcile-session.ts:73`) — the documented fix for the polled-
  Apply collision. No shared-path collision found between the sequential
  operations.
- **Branch adoption of unrelated work.** `branchHasForeignContent`
  throws on an unreadable `ls-tree` rather than reporting "safe"
  (publish-sync.ts:364–384); first-publish adoption is refused when the
  branch holds non-LocTT entries (652–666). Correct; guards the mirror.
- **`gitSafe` "" ambiguity.** `branchHasForeignContent` and
  `countLocalChanges` use `gitStatusSafe`/`branchExists` to distinguish a
  failed command from an empty result (the documented fix). Correct.
- **`deriveKeyState` counter derivation (M1).** Derives from the merged
  task set with a floor of `max(next_number)`; refuses (throws) rather
  than writing an empty prefix. Correct.
- **`mergeHistory` unkeyed entries / `mergeComments` deletion-wins /
  tie-breaks.** Deterministic (local-wins on ties, insertion order fixed),
  no data-loss path found.
- **Push/fetch error attribution.** `classifyAuthError` +
  `extractGitFailure` map git stderr to reasons; push failure is
  non-fatal (local commit durable, warning emitted). No mis-attribution
  of a held lock found on these paths (worktree `add` failures surface
  git's own message via the plain `git()` throw; not a wrong *category*,
  just an unfriendly string).

## Not in scope of a finding but worth a look later

- `git()` (publish-sync.ts:386) and the worktree `add` in
  `commitToLocttBranch`/`pullFromLocttBranch` throw a bare `Error` (not
  `GitSyncError`) when the `loctt` branch is already checked out in the
  user's main working tree — `git worktree add <branch>` refuses with
  "already checked out". Message is git's; category is generic. Low
  likelihood (the branch is not normally the user's checkout), no data
  loss, so below the bar as a correctness finding.
