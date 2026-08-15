# Audit — Slice 2: `packages/core/src/git/`

Phase 4 structural audit. Report-only; no files edited, no writing git
commands run.

**Files read in full (7 non-test, 1,816 lines):** `index.ts` (17),
`git-mode.ts` (133), `reconcile.ts` (153), `three-way.ts` (231),
`resolve-conflicts.ts` (233), `merge.ts` (328), `publish-sync.ts` (721).
Test files consulted where they bear on a finding (`merge.test.ts`
partially, `reconcile.test.ts` partially).

---

## ⚠️ SILENT DATA LOSS — read these first

Four findings in this slice fail by losing or corrupting user data with no
error, no warning, and no entry in any count the user sees. They are
SDL-1..SDL-4 below and are also the top four in the main list.

| # | Title | Mechanism |
|---|---|---|
| **SDL-1** | `assignProvisionalPrefixes` orders on a field that does not exist | Prefix assignment is decided by insertion order, so two clones can assign *different* prefixes to the same project and diverge permanently. |
| **SDL-2** | `rekeyCollisions`' `skipped` list is discarded by its only caller | A duplicate key that could not be resolved is reported as a clean sync. Two tasks share a key; `loctt show T-1` is ambiguous forever. |
| **SDL-3** | `mergeTask` drops the loser's frontmatter fields entirely | M2 is documented and commented as *per-field* last-write-wins. It is implemented as *whole-record*. Every field the loser changed is lost. |
| **SDL-4** | `mergeById` on `projects.yaml` lets incoming silently win a rename | Combined with the `{...b, ...a}` spread on the same line, `default:` and the project list resolve in *opposite* directions. |

---

### `assignProvisionalPrefixes` sorts on `created_at`, which `ProjectDef` does not have

- **File**: `packages/core/src/git/merge.ts:276-309` (sort at :282-285); caller `packages/core/src/git/resolve-conflicts.ts:186-200`
- **Category**: bug
- **What is wrong**: The function orders projects by `created_at ?? ""`,
  tie-breaking on `id`, and its doc comment states "The project with the
  earlier `created_at` keeps the prefix (ties broken by id, so both clones
  agree)." **`ProjectDef` has no `created_at` field.**
  `ProjectDefSchema` (`packages/contracts/src/projects.ts:20-25`) is
  `.strict()` and declares exactly `id`, `name`, `prefix`, `archived`.
  Verified by grep: the string `created_at` does not appear anywhere in
  `projects.ts`. So at the real call site in `resolve-conflicts.ts:192-195`,
  where the list comes from parsing `config/projects.yaml`, `created_at` is
  `undefined` on **every** project. `(a.created_at ?? "").localeCompare(...)`
  is therefore always `0`, the sort collapses to the `id` tiebreak alone,
  and the documented rule never fires.

  The `id` tiebreak does keep it deterministic, so this is not the total
  divergence it first looks like — but the resulting choice is arbitrary
  with respect to the intent. The project that keeps `T-` is whichever has
  the lexicographically smaller ULID, which correlates with creation time
  only by accident of ULID encoding, and not at all across two
  independently-`init`ed trackers whose ULIDs come from different machines.
  A user who has been referring to `T-1` for months can find their project
  renamed to `T2-` because the *other* clone's ULID sorted lower.

  Every one of the four tests at `merge.test.ts:257-299` passes an explicit
  `created_at`, so the suite exercises a shape that cannot occur in
  production. Per CLAUDE.md's rule, these are tests asserting a world that
  does not exist — the "is order-independent, so both clones agree" test at
  :278 passes for the wrong reason (the `id` tiebreak), and would still
  pass with the entire `created_at` comparison deleted.
- **Why it matters**: Prefixes are P-5 territory — immutable after
  creation, because existing task keys embed them. This is the one code
  path allowed to change one, and it picks which project loses its
  identity using a field that is always absent. The blast radius lands on
  the invariant the codebase protects most carefully everywhere else.
- **Blast radius**: `resolve-conflicts.ts:195` (only production caller);
  `normaliseAfterMerge` in `publish-sync.ts:149-212` then rewrites every
  task key to follow the reassigned prefix and appends to `key_history`
  (P-7); exported from `core/src/index.ts:112`. The four tests at
  `merge.test.ts:257-299` need rebuilding on the real shape.
- **Size**: M — the signature says `created_at?: string`, so either the
  field gets added to `ProjectDef` (on-disk shape change, escalate) or the
  parameter and doc comment drop it and commit to the `id` ordering.
- **Auto-fixable**: no
- **Confidence**: high

### `rekeyCollisions` reports unresolved collisions and the caller throws them away

- **File**: `packages/core/src/git/publish-sync.ts:197-206`; producer `packages/core/src/git/reconcile.ts:45-120`
- **Category**: bug
- **What is wrong**: `rekeyCollisions` returns
  `{ rekeyed, skipped }`. `RekeyOutcome.skipped` carries a deliberate,
  well-documented contract (`reconcile.ts:19-28`): *"Never silently
  dropped: a task sharing a key with another is exactly the state the
  caller invoked this to remove, so an unreported skip would leave a
  duplicate key looking like a successful merge."*

  `normaliseAfterMerge` destructures only what it iterates:
  ```ts
  const outcome = rekeyCollisions(after, state);
  for (const r of outcome.rekeyed) { … }
  ```
  `outcome.skipped` is never read. Verified by grep across
  `packages/core/src`, `apps`, and `tests`: the only `.skipped` reference
  tied to this type is `reconcile.test.ts:44`, asserting it is empty in the
  no-collision case. **No production code path consumes it.** The exact
  failure the comment names is the shipped behaviour.

  Both skip reasons are reachable after a real merge. `reconcile.ts:77`
  skips a task with no `project`; `reconcile.ts:87` skips when
  `state.keys[projectId]` is missing — and its own comment says that
  happens when "it was created in a clone whose projects.yaml has not
  merged yet", which is precisely the two-clone merge scenario this code
  exists for.
- **Why it matters**: Silent data loss in its most literal form for this
  codebase. The sync reports `{ updated: true, merged: N, rekeyed: M }` and
  exits 0 while two tasks hold the same key. Every key-based lookup —
  `loctt show T-1`, links, `key_history` resolution — is now ambiguous, and
  nothing anywhere told the user. The invariants doc treats an inconsistent
  tracker that lets commands keep running as strictly worse than one that
  refuses (the crash-sentinel rule); this is the same shape.
- **Blast radius**: `SyncOutcome` (`publish-sync.ts:336-357`) has no field
  to carry it, so surfacing it touches a public interface and all three
  surfaces that render the outcome. `rekeyCollisions` and `RekeySkip` are
  exported from `core/src/index.ts:110` and `git/index.ts:14-15`.
- **Size**: M
- **Auto-fixable**: no — touches a public interface and adds an error path.
- **Confidence**: high

### `mergeTask` is whole-record last-write-wins, not the per-field merge M2 specifies

- **File**: `packages/core/src/git/merge.ts:71-120` (esp. :81-84)
- **Category**: bug
- **What is wrong**: Decision M2 in `decisions.md:141` reads **"A contested
  *frontmatter field* takes the later `updated_at`."** The module header at
  `merge.ts:14` repeats it: "**task.md** — per-field last-write-wins on
  `updated_at` (M2)". The implementation does something materially weaker:
  ```ts
  const winner = laterWins(local, incoming, lf.updated_at, inf.updated_at);
  const frontmatter = { ...winner.frontmatter, /* relationships, key_history */ };
  ```
  The whole winning record is spread. Only `relationships` and
  `key_history` are actually merged. Every other field — `title`,
  `status`, `priority`, `assignee`, `due_date`, `labels`, `estimate`,
  `fields`, `milestone`, `sprint`, `board_rank` — comes wholesale from the
  side with the later `updated_at`.

  The comment at :77-79 is honest about the mechanism ("Whole-record
  recency, used for every scalar field. Per-field timestamps do not
  exist"), so this reads as a known limitation. But nothing reconciles it
  with the decision it claims to implement, and the header comment three
  lines away asserts the stronger behaviour. **The concrete loss:** clone A
  sets `status`, clone B sets `assignee` one second later on the same task.
  Nothing is contested — the two edits touch disjoint fields and both could
  be kept. A's status change is discarded anyway.

  This also undercuts M2's stated safety argument. M2 is declared "viable
  *only because* of M3" — history makes a lost race recoverable. That
  holds for a field two people genuinely contested. It is a much bigger
  claim when *every* field of the losing record is dropped, including ones
  nobody contested, and the user has no signal that any of it happened.
  Contrast the body, where M4 mandates writing the loser to a sibling file
  precisely because silent replacement is unacceptable — frontmatter gets
  no such treatment.
- **Why it matters**: The gap between documented and actual behaviour is
  the dangerous part. `decisions.md` is marked ✅ built for M2. A reader
  checking whether disjoint concurrent edits are safe finds "yes" in the
  decision register and in the module header, and "no" only in an inline
  comment inside the function.
- **Blast radius**: `mergeTask` is the single task-merge entry point
  (`resolve-conflicts.ts:125`), exported from `core/src/index.ts`. A real
  per-field merge needs a base version — `resolveConflicts` currently
  receives only local and incoming, so `planSync`'s base would have to
  reach it. That is a signature change on `resolveConflicts`. Either the
  code or `decisions.md` must move; both are escalations.
- **Size**: L if the behaviour is fixed; S if the decision doc and header
  comment are corrected to match shipped behaviour. Which one is right is
  a product call, not an audit call.
- **Auto-fixable**: no
- **Confidence**: high

### `projects.yaml` merge resolves its list and its scalars in opposite directions

- **File**: `packages/core/src/git/resolve-conflicts.ts:175-207` (esp. :184 and :204); `mergeById` at `packages/core/src/git/merge.ts:320-328`
- **Category**: bug
- **What is wrong**: Two conflicting precedences on adjacent lines.

  `mergeById(listA, listB)` sets local entries first, then incoming —
  so **incoming wins** for any project present on both sides
  (`merge.ts:325-326`).

  Four lines later the document is reassembled as
  `stringifyYaml({ ...b, ...a, [key]: list })` where `a` is *local* and `b`
  is *incoming*. For every key except the list itself, **local wins**.

  So within one merged `projects.yaml`: a project renamed on the branch
  takes the branch's name, but `default:` takes the local value. There is
  no comment acknowledging the split, and the comment at :178-180 ("keep
  the rest of the incoming document") describes the opposite of what
  `{...b, ...a}` does — `a` (local) is spread last and therefore wins.

  The user-visible loss: clone A renames a project, clone B does not touch
  it. B syncs. B's `mergeById` takes A's rename — correct. Now A syncs
  and, if the file conflicts again, A's local copy wins the scalars while
  the list follows the other rule. The two halves of one file follow
  different policies.

  Separately, `mergeById`'s "incoming wins" is stated as safe because
  "these are small, hand-edited config records where the last write is the
  intended one" (`merge.ts:315-318`). Incoming is not "the last write" —
  it is *the other clone's* write, whose timestamp is unknown. Unlike
  `mergeComments` and `mergeTask`, which both consult `updated_at`, this
  path has no recency signal at all, and `ProjectDef` carries no timestamp
  to consult (see SDL-1).
- **Why it matters**: A project rename lost or resurrected with no
  warning. Same class as SDL-3 but on config rather than task data, and
  the internal inconsistency makes the behaviour unpredictable to reason
  about from either side.
- **Blast radius**: `config/projects.yaml` and `config/queries.yaml` (the
  two entries of `ID_UNION_FILES`, `resolve-conflicts.ts:74-77`).
  `mergeById` is exported from `core/src/index.ts`. `queries.yaml` has the
  same spread and the same split.
- **Size**: S to make the two directions agree; M to add a recency rule.
- **Auto-fixable**: no — changes which side wins a merge.
- **Confidence**: high

---

## Remaining findings

### A crashed publish or sync leaves a registered worktree with no recovery path

- **File**: `packages/core/src/git/publish-sync.ts:412-453` (publish), `:584-678` (sync)
- **Category**: bug
- **What is wrong**: Both paths create a git worktree under
  `.loctt/local/.worktree-publish` / `.worktree-sync` and clean up in
  `finally`. `finally` does not run if the process is killed (SIGKILL,
  OOM, power loss, `ctrl-C` during a sync `await`). Two things survive:
  the directory on disk, and — the harder one — **git's own worktree
  registration under `.git/worktrees/`**.

  The next run does `await rm(worktreeDir, …)` (`:413`, `:585`) which
  clears the directory but not the registration, then calls
  `git(["worktree", "add", worktreeDir, branch], root)`. That fails:
  git refuses to add a worktree at a path it still has registered, and
  refuses to check out a branch already claimed by another worktree.
  `git()` at `:280-286` throws the raw stderr. The user gets git plumbing
  text about a missing or locked worktree, with nothing naming LocTT, the
  sentinel, or `git worktree prune` as the fix.

  Verified: `git worktree prune` appears nowhere in the codebase (grep over
  `packages/core/src` and `apps` returns only unrelated `prune` hits in
  `workflow-write.ts` and a journal test). There is no boot-hook recovery
  for these directories — `paths/index.ts` and `apps/web/src/server/`
  handle `prefix-rename.yaml` and `.schema-migration-in-progress`, but
  nothing knows about the worktrees.

  `invariants.md` requires a crash sentinel be either resumable or fatal,
  never ignored. A stale worktree is exactly a crash sentinel: it records
  that a publish or sync did not finish. This one is neither resumable nor
  fatal — it is ignored until it makes an unrelated-looking command fail.

  The good news, and the reason this is not in the SDL section: the write
  ordering is genuinely sound. `applyPlan`/`applyResolution` run only
  after every path has merged (`:617-626`), and `saveSyncState` runs last
  (`:653`), so a crash mid-sync leaves `last_synced_commit` unadvanced and
  the sync simply re-runs. No data is lost. The damage is a tracker that
  cannot sync until the user knows an undocumented git incantation.
- **Why it matters**: Git-backed mode becomes permanently stuck after any
  hard kill, and the error text points at git rather than at LocTT. `loctt
  doctor` does not check for it.
- **Blast radius**: `commitToLocttBranch`, `pullFromLocttBranch`, and
  everything above them (`publish`, `sync`, all three surfaces' git
  commands).
- **Size**: S for a `git worktree prune` before `worktree add`; M to do it
  as a proper sentinel check with a LocTT-authored message.
- **Auto-fixable**: no
- **Confidence**: high

### `deriveKeyState` drops the per-project prefix when neither side has an entry

- **File**: `packages/core/src/git/merge.ts:243`
- **Category**: bug
- **What is wrong**: `const prefix = i?.prefix ?? l?.prefix ?? "";` — the
  final fallback is the empty string. The loop iterates the union of
  `local.keys` and `incoming.keys`, so in the common path one of `i` or `l`
  is defined and the fallback is unreachable. But
  `KeyAllocationStateSchema` (`packages/contracts/src/state.ts:4-7`)
  declares `prefix: z.string().min(1)` on a `.strict()` object.

  So *if* that branch is ever reached, `deriveKeyState` returns an object
  that `LocttStateSchema` will reject — and `resolve-conflicts.ts:170`
  writes it straight to `state.yaml` via `stringifyYaml` with **no
  validating parse on the way out**. The inputs at `:166-167` are parsed;
  the output is not. The result is an invalid `state.yaml` written to disk,
  which then fails every subsequent `loadState`.

  Note this is a latent trap rather than a live bug — I could not construct
  a reachable path to it, since the key set is built from the two states'
  own keys. The finding is that an unrepresentable value is silently
  synthesised instead of the function refusing, and that the write path has
  no schema check to catch it.
- **Why it matters**: `state.yaml` is the key-allocation root. An invalid
  one is not a degraded tracker, it is a tracker that will not boot, and
  the code that produced it is the merge path — the one place a user cannot
  easily undo by hand.
- **Blast radius**: `deriveKeyState` (`merge.ts:218`) has one production
  caller (`resolve-conflicts.ts:170`); exported from `core/src/index.ts`.
- **Size**: S — validate with `LocttStateSchema.parse` before
  `stringifyYaml`, which converts a silent bad write into an `unresolved`
  entry and a clean abort via the existing `catch` at
  `resolve-conflicts.ts:212`.
- **Auto-fixable**: no — adds an error path.
- **Confidence**: medium (latent; the bad branch is not currently reachable)

### `resolveConflicts` runs twice over every path to resolve one file

- **File**: `packages/core/src/git/publish-sync.ts:608-616`
- **Category**: abstraction
- **What is wrong**: The two-pass structure exists for a real reason —
  `state.yaml`'s counters (M1) can only be derived once the tasks have
  merged. But the second pass re-runs `resolveConflicts` over the *entire*
  conflict list, not just `state.yaml`. Every task file is re-read from
  both trees, re-parsed, and re-merged; every history and comments file
  likewise. The first pass's results are discarded wholesale.

  The trigger is also a string comparison against a literal path:
  ```ts
  firstPass.unresolved.some(c => c.path === "state.yaml")
  ```
  `"state.yaml"` is spelled as a bare literal here and again at
  `resolve-conflicts.ts:162`, with the comment at `:73` and `:209` as the
  only thing tying them together. Nothing enforces that the two agree.

  Correctness-wise this is currently fine — the merge functions are pure,
  so re-running them is idempotent, and `mergeTask`'s `displaced` output is
  recomputed identically rather than duplicated. It is wasteful rather than
  wrong. The risk is structural: the design silently depends on every merge
  rule staying pure and idempotent, and nothing states that requirement or
  would catch its violation. A future rule that appends rather than
  replaces would double its output with no test failing.
- **Why it matters**: Doubles the I/O and parse cost of a merge on large
  trackers, and encodes an unstated invariant (idempotence) that the next
  person to add a merge rule has no way to know about.
- **Blast radius**: `pullFromLocttBranch` only. `mergedTaskSet`
  (`:85-124`) exists solely to feed this second pass.
- **Size**: M — pass `mergedTasks` in unconditionally by hoisting
  `mergedTaskSet`, or have the second pass filter to the paths the first
  left unresolved.
- **Auto-fixable**: no
- **Confidence**: high

### `git()` and `gitSafe()` diverge silently on failure

- **File**: `packages/core/src/git/publish-sync.ts:280-291`; near-duplicate at `three-way.ts:60-63`
- **Category**: duplication
- **What is wrong**: Three spawn wrappers across two files with three
  different failure contracts:
  - `publish-sync.ts:280` `git()` — throws on non-zero.
  - `publish-sync.ts:288` `gitSafe()` — returns `stdout` and **discards the
    status entirely**. A failed command is indistinguishable from one that
    succeeded with empty output.
  - `three-way.ts:60` `git()` — returns `{ ok, out }`, the only one that
    lets the caller see both.

  The `gitSafe` contract is load-bearing in one place and quietly wrong in
  another. At `:444` and `:669` (worktree cleanup in `finally`) swallowing
  the status is deliberate and correct — the comment says so, and throwing
  there would mask the original error.

  But `branchHasForeignContent` (`:268-278`) also uses it:
  ```ts
  const listed = gitSafe(["ls-tree", "--name-only", branch], root);
  if (!listed) return [];
  ```
  An `ls-tree` that *fails* returns `""`, which this reads as "the branch
  is empty, nothing foreign here" and returns `[]` — the same answer as a
  genuinely clean branch. That result feeds the first-publish safety check
  at `:398-408`, whose entire job is to refuse to publish over a branch
  holding someone else's content, because publishing would delete it. A
  transient `ls-tree` failure turns that guard off silently.

  `remoteExists` (`:313-317`) has the same shape, with a milder
  consequence: a failed `git remote` reads as "no remote configured", and
  push/fetch report `skipped: "no-remote"` rather than an error.
- **Why it matters**: The `branchHasForeignContent` case degrades a
  data-destruction guard into a no-op on a failure it cannot see. The two
  legitimate `gitSafe` uses and the two unsafe ones are indistinguishable
  at the call site.
- **Blast radius**: `commitToLocttBranch` (the publish guard),
  `pushLocttBranch`, `fetchLocttBranch`, `publish`, `sync`.
- **Size**: S — make `gitSafe` return `{ ok, out }` like `three-way.ts`'s
  already does, and have the two guards check `ok`. **Do not** collapse the
  three wrappers into one without preserving the throw/no-throw split: the
  `finally`-block non-throwing behaviour is deliberate and commented.
- **Auto-fixable**: no
- **Confidence**: high

### `planSync` compares base content with `.trim()` but equality without

- **File**: `packages/core/src/git/three-way.ts:209-217`
- **Category**: bug
- **What is wrong**: Two comparisons in the same block use different
  notions of equality:
  ```ts
  if (incomingText === localText) { keep "identical" }      // :209 — exact
  …
  const localMatchesBase = baseKnown && localText?.trim() === base?.trim();   // :216 — trimmed
  const incomingMatchesBase = baseKnown && incomingText?.trim() === base?.trim();
  ```
  The trim on the base comparison is not arbitrary — `readTreeFile`
  (`:81-88`) returns `r.out` from the `git()` wrapper at `:62`, which
  applies `.trim()` to all stdout. So the base content **always** arrives
  trimmed, and comparing it untrimmed against a file with a trailing
  newline would never match. The trim at :216 compensates for that.

  The consequence is a real asymmetry. If local and incoming differ *only*
  in trailing whitespace, `:209` says they differ (exact comparison), then
  both `localMatchesBase` and `incomingMatchesBase` evaluate true against
  the trimmed base. Neither of the first two branches fires — both require
  one side to match and the other not — so control reaches the final
  `else` and the path is classified **`conflict`**.

  For a `task.md` that conflict is then merged harmlessly by
  `mergeTask`. For a file with no merge rule — `workflow.yaml` most
  notably — it aborts the entire sync (`publish-sync.ts:617-621`) over a
  trailing newline, with the message telling the user the file "changed
  both locally and on the branch". They will diff the two and see nothing.

  The deeper issue is that `readTreeFile` trims at all: it is a general
  "read a blob" helper that quietly corrupts any content whose leading or
  trailing whitespace matters, and its doc comment does not mention it.
- **Why it matters**: A spurious hard abort on a file the user cannot see a
  difference in, with an error message that misdescribes the cause. Line
  endings differing between clones (CRLF/LF) hit this too.
- **Blast radius**: `planSync` classification for every path; `readTreeFile`
  is exported from `three-way.ts` though not re-exported by
  `git/index.ts`.
- **Size**: S to normalise both comparisons consistently; M if
  `readTreeFile` stops trimming, since every caller's expectations shift.
- **Auto-fixable**: no
- **Confidence**: high

### `mergedTaskSet` and `resolve-conflicts.ts` each carry their own copy of the task-path regex

- **File**: `packages/core/src/git/publish-sync.ts:110` and `:116`; `packages/core/src/git/resolve-conflicts.ts:57-59`
- **Category**: duplication
- **What is wrong**: `/^tasks\/[^/]+\/task\.md$/` is written out three
  times — twice inline in `mergedTaskSet` and once as `isTaskFile()` in
  `resolve-conflicts.ts`. `isTaskFile` is module-private, so
  `publish-sync.ts` cannot reach it.

  The three must agree: if `resolveConflicts` merges a path as a task but
  `mergedTaskSet` does not recognise it, that task is missing from the set
  M1 derives key counters from, and the counters come out too low —
  which is exactly the under-reservation M1 was designed to prevent.
  Nothing enforces the agreement.

  `listTaskFiles` (`:127-137`) is a fourth notion of the same thing,
  built by string concatenation rather than the regex, and it does not
  verify the file exists — it lists `tasks/` subdirectory names and
  assumes each has a `task.md`. `readAt` returns `undefined` for a missing
  one so it degrades safely, but it is a fourth definition of "a task
  file" in the same module.
- **Why it matters**: Silent counter under-reservation is a data-integrity
  bug, and the coupling that prevents it is invisible.
- **Blast radius**: `mergedTaskSet` → `deriveKeyState` → `state.yaml`.
- **Size**: S — export one predicate and use it in all three places. The
  duplication here is not load-bearing: all three regexes are byte-identical
  and all three mean the same thing.
- **Auto-fixable**: no — crosses a module boundary and adds an export.
- **Confidence**: high

### `pruneEmptyDirs` walks paths that were never deleted

- **File**: `packages/core/src/git/publish-sync.ts:238-259`, called at `:231`
- **Category**: abstraction
- **What is wrong**: It takes the deleted paths, accumulates *every*
  ancestor directory of each into a candidate set, then `readdir`s each and
  removes any that came back empty. Because it walks all the way up
  (`while (dir && dir !== "." && dir !== "/")`), the candidate set includes
  `tasks/` and other top-level directories on every sync that deletes
  anything.

  It only removes genuinely-empty directories, so it will not delete
  populated ones. But it will happily remove a top-level `tasks/` if the
  sync deleted the last task, and `join(rootDir, rel)` is the *local*
  `.loctt` directory — so a sync that removes every task also removes
  `.loctt/tasks/` itself. Whether the rest of the codebase tolerates a
  missing `tasks/` directory is outside this slice, but `listTaskFiles`
  at `:127-137` catches the `readdir` failure and returns `[]`, which
  suggests it is at least anticipated somewhere.

  The `readdir`-per-ancestor also runs unconditionally on every sync with
  deletions, most of them certain to be non-empty.
- **Why it matters**: A structural directory can vanish as a side effect of
  a normal deletion sync. The function's stated contract ("Stops at
  `rootDir` and at the first non-empty parent") is not what the code does —
  it does not stop at the first non-empty parent, it evaluates all of them
  independently.
- **Blast radius**: `applyPlan` → `pullFromLocttBranch`.
- **Size**: S — stop the upward walk at the first non-empty parent, as the
  comment already claims, and floor it below the tracker's structural dirs.
- **Auto-fixable**: no — changes on-disk outcome.
- **Confidence**: medium

### `three-way.ts`'s header comment describes a layering that no longer holds

- **File**: `packages/core/src/git/three-way.ts:5-22`
- **Category**: comment
- **What is wrong**: The module header says field-level merging "is a
  separate layer that builds on this one; **the helpers for it already
  exist in `reconcile.ts`**". That was true before `f6e38b3`. The field-level
  layer now lives in `merge.ts` and `resolve-conflicts.ts`; `reconcile.ts`
  retains only `rekeyCollisions`, `mergeRelationships` and
  `mergeKeyHistory`, the latter two of which `merge.ts` imports.

  It also points at `docs/user/common/git-sync.md` for the union rules,
  which are now specified in `docs/dev/decisions.md` §6 as M1–M4.

  Related: `merge.ts:1-27` is an excellent header that describes the real
  layering. `reconcile.ts` has no module header at all, leaving no
  statement of why it is a separate file from `merge.ts` — a reader has to
  infer it from the import graph.
- **Why it matters**: The first thing a reader of the sync code sees points
  them at the wrong file for the merge rules. Given this is the
  highest-stakes module in the package, misdirecting the entry point is
  more costly than usual.
- **Blast radius**: comment only.
- **Size**: S
- **Auto-fixable**: **yes** — comment correction, explicitly permitted by
  the plan's auto-fix list. Not applied in this run per the brief.
- **Confidence**: high

### `applyPlan` copies a path that `applyResolution` immediately overwrites

- **File**: `packages/core/src/git/publish-sync.ts:623-626`
- **Category**: abstraction
- **What is wrong**: `applyPlan` copies every path in `plan.copies` from
  the worktree, then `applyResolution` writes every merged path over the
  top. The comment at :624-625 acknowledges the ordering dependency
  ("the merged content must win over whatever the plan copied for that
  path").

  In practice `plan.copies` and `resolution.merged` are disjoint —
  `planSync` puts a path in exactly one of `copies` / `keeps` / `deletes` /
  `conflicts`, and `resolveConflicts` only ever sees `conflicts`. So no
  path is actually written twice today, and the comment defends against a
  situation that cannot arise.

  The concern is the reverse: `applyResolution` (`resolve-conflicts.ts:226-233`)
  writes with `writeFile` and **no `mkdir`**, while `applyPlan` does
  `mkdir(dirname(dest), { recursive: true })` at `:224`. A merged path
  whose parent directory does not exist locally would throw `ENOENT`
  *after* `applyPlan` has already written. That is the one place in this
  file where a failure lands mid-write rather than before any write —
  everything else is carefully ordered to abort clean (`:617-621`).

  It requires a conflict on a path whose local parent directory is absent,
  which `planSync` should not produce (a conflict means the file exists on
  both sides). So it is defence-in-depth, not a live bug. But the
  displaced-body writes at `resolve-conflicts.ts:230` are a new path
  introduced by M4, and they inherit the same missing `mkdir`.
- **Why it matters**: The module's central safety property is "abort before
  writing anything". This is the only write sequence that can fail
  halfway.
- **Blast radius**: `applyResolution` is called only from
  `pullFromLocttBranch:626`.
- **Size**: S — `mkdir(dirname(…), { recursive: true })` in
  `applyResolution`'s loop.
- **Auto-fixable**: no
- **Confidence**: medium

### `LOCAL_OWNED` is checked against both the full path and its top segment; `NEVER_MIRROR` only ever sees top segments

- **File**: `packages/core/src/git/three-way.ts:179`, vs. `:103` and `:159-160`
- **Category**: abstraction
- **What is wrong**: The two exported sets are documented as parallel
  concepts but are matched by different rules.

  `NEVER_MIRROR` is passed to `listFiles`, which tests only the first path
  segment (`:102-103`: `const top = rel.split("/")[0]; if (exclude.has(top)) continue;`).
  Its members `"local"` and `".git"` are both top-level, so this works.

  `LOCAL_OWNED` is checked at `:179` as
  `LOCAL_OWNED.has(path) || LOCAL_OWNED.has(top)` — both the full relative
  path and the top segment. Its single member `.schema-version` is
  top-level, so the extra check is redundant today.

  The divergence means a future nested entry behaves differently depending
  on which set it lands in: added to `LOCAL_OWNED` it would work, added to
  `NEVER_MIRROR` it would be silently ignored. `NEVER_MIRROR` is also
  passed to `mirrorDir` (`publish-sync.ts:421`), which matches on
  `readdir` entries — top-level names only — so it has a third matching
  rule again.

  `invariants.md` names both `.loctt/local/` and `.schema-version` as
  never-mirrored, and warns that mirroring `.schema-version` "lets a newer
  clone brick an older one with no recovery path". The protection is
  correct today; the mechanism is just inconsistent enough that extending
  it is a trap.
- **Why it matters**: Both sets guard invariants where the failure mode is
  a bricked clone. The matching semantics should be stated and uniform.
- **Blast radius**: `planSync`, `listFiles`, `mirrorDir`. Both sets are
  exported from `git/index.ts:17` and `core/src/index.ts`.
- **Size**: S
- **Auto-fixable**: no — touches public exports' semantics.
- **Confidence**: medium

### `mergeHistory` and `mergeComments` cast unvalidated YAML straight to their types

- **File**: `packages/core/src/git/resolve-conflicts.ts:143-144` and `:153-154`
- **Category**: bug
- **What is wrong**:
  ```ts
  const a = (parseYaml(localRaw) ?? []) as HistoryEntry[];
  const b = (parseYaml(incomingRaw) ?? []) as HistoryEntry[];
  ```
  A bare `as` cast with no schema parse. Compare `state.yaml` immediately
  below at `:166-167`, which does `LocttStateSchema.parse(parseYaml(...))`
  and gets the malformed-input protection the `catch` at `:212` was written
  for.

  If `_history.yaml` parses as YAML but is not a list — a scalar, a map,
  `null` handled but not `{}` — `mergeHistory` spreads it at `merge.ts:140`
  (`for (const e of [...local, ...incoming])`). Spreading a non-iterable
  throws `TypeError`, which the `catch` does convert into an `unresolved`
  entry, so the abort is safe.

  The unsafe case is a value that *is* a list but whose elements are not
  `HistoryEntry`s. `mergeHistory` reads `e.timestamp`, `e.kind`,
  `e.actor`, `e.field` — all `undefined` on a junk element — producing the
  identity key `"\0\0\0"`. Every such element collapses to one entry, and
  the rest are **dropped**. The result is written to `_history.yaml` as a
  successful merge.

  This matters more than a normal validation gap because of what history
  is *for* here. `merge.ts:17-19` states the union is "load-bearing: M2's
  'you can recover the value you lost' guarantee is false if the history
  recording it was itself dropped by the merge." A corrupt-but-parseable
  history file is silently truncated by the very merge that M2's recovery
  story depends on.

  The comments file has the same shape; `mergeComments` keys on `c.id`, so
  junk elements all collapse to the `undefined` id.
- **Why it matters**: The recovery path for every other last-write-wins
  decision in this module is itself unvalidated, and its failure is silent
  rather than an abort.
- **Blast radius**: `_history.yaml` and `_comments.yaml` for any task in a
  conflicted merge.
- **Size**: S — parse with the existing schemas. `HistoryEntry` is
  exported from `@loctt/contracts`; confirm a schema is exported alongside
  it.
- **Auto-fixable**: no — adds an error path.
- **Confidence**: medium

### `MergeConflict` is declared and never used

- **File**: `packages/core/src/git/merge.ts:29-33`
- **Category**: dead-code
- **What is wrong**: `export interface MergeConflict { path; reason }` is
  documented as "A merge that could not be resolved, for the caller to
  abort on." Nothing constructs or consumes it. The caller that does abort
  (`resolveConflicts`) uses `PathPlan` from `three-way.ts` for its
  `unresolved` list instead, spreading the original plan and overwriting
  `reason` (`:116-120`, `:211`, `:215-218`).

  Two overlapping shapes for "a path that failed to merge", one of them
  unused. `MergeConflict` is the better-named of the two for the purpose —
  `PathPlan.disposition` is meaningless on an unresolved entry, and its
  value is carried over from the plan as `"conflict"` regardless of why the
  merge actually failed.
- **Why it matters**: A reader of `merge.ts` reasonably assumes
  `MergeConflict` is the abort channel and looks for its producers.
- **Blast radius**: Not exported from `git/index.ts`. Checked
  `core/src/index.ts:110-112` — the merge exports there are
  `assignProvisionalPrefixes`, `deriveKeyState`, `mergeById`,
  `mergeComments`, `mergeHistory`, `mergeTask`; `MergeConflict` is not
  among them. It is reachable only via a deep import.
- **Size**: S
- **Auto-fixable**: **yes** if truly zero references — it is an unused
  export, on the plan's permitted list. Not applied in this run per the
  brief. Confirm no deep imports outside the audited tree first.
- **Confidence**: high

### `laterWins` is generic but only ever called with `T = Task`

- **File**: `packages/core/src/git/merge.ts:54-61`, called once at `:81`
- **Category**: abstraction
- **What is wrong**: `laterWins<T>(local, incoming, localUpdatedAt, incomingUpdatedAt)`
  takes the values and their timestamps as separate parameters, so nothing
  ties a value to its own timestamp. The single call site passes
  `local, incoming, lf.updated_at, inf.updated_at` — correct, but a
  transposition of the last two arguments would compile and silently invert
  every task merge.

  The generic parameter buys nothing at one call site, and the signature is
  more error-prone than a non-generic
  `(a: Task, b: Task) => Task` reading `updated_at` off the records
  itself. `mergeComments` (`:189-191`) does its own inline recency
  comparison rather than reusing this, so the abstraction is not even
  serving the second case it might have.

  It is also not exported from `git/index.ts` or `core/src/index.ts`,
  despite being `export`ed from the module — so it is deep-import-only,
  like `MergeConflict`.
- **Why it matters**: An argument transposition here silently inverts every
  contested task merge — the highest-consequence single expression in the
  slice — and no type would catch it.
- **Blast radius**: `mergeTask` only.
- **Size**: S
- **Auto-fixable**: no — signature change.
- **Confidence**: medium

### `SyncOutcome.updated` recomputes a condition already computed two lines above

- **File**: `packages/core/src/git/publish-sync.ts:643` and `:656-659`
- **Category**: duplication
- **What is wrong**: The same three-clause expression —
  `plan.copies.length > 0 || plan.deletes.length > 0 || resolution.merged.length > 0`
  — appears at `:643` (guarding the key-index rebuild) and again at
  `:656-659` (as `updated`). They must stay in step: `updated` claims the
  sync changed something, and the guard decides whether the key index is
  rebuilt to match. If they drift, a sync reports a change without
  refreshing the index that resolves keys to tasks, and `loctt show T-1`
  misses a task that is on disk.

  Extracting it to one `const changed = …` is provably behaviour-preserving
  and makes the coupling explicit.
- **Why it matters**: Small, but the two expressions encode one invariant
  and nothing enforces their agreement. A stale key index after a
  successful sync presents as a missing task.
- **Blast radius**: `pullFromLocttBranch` only; the local variable is not
  exported.
- **Size**: S
- **Auto-fixable**: no — the plan permits local variable renames, not
  extractions. Behaviour-preserving but not on the enumerated list.
- **Confidence**: high

### Import statements are missing spaces after commas in five places

- **File**: `packages/core/src/git/publish-sync.ts:2,3,20`; `reconcile.ts:1`; `git-mode.ts:12,13`; `index.ts:15,17`
- **Category**: naming
- **What is wrong**: `import { cp, mkdir, readdir, readFile,rm }`,
  `import { dirname,join }`, `import { LOCAL_OWNED,NEVER_MIRROR, planSync }`,
  `import type { LocttState,Task }`, `import { getLocalDir,getSyncStatePath }`,
  `export { mergeKeyHistory,mergeRelationships, rekeyCollisions }`.
  Cosmetic, consistent with an auto-fixer having run with a rule
  misconfigured. `npm run lint` evidently does not catch it.
- **Why it matters**: Trivial in isolation; worth noting only because it
  suggests the lint config's import rules are not doing what the repo
  assumes, which is worth a look given how much this slice relies on
  import hygiene to keep layers apart.
- **Blast radius**: none.
- **Size**: S
- **Auto-fixable**: **yes** — import formatting, on the plan's permitted
  list. Not applied in this run per the brief.
- **Confidence**: high

---

## Checked and found sound

Recorded so it need not be re-derived.

- **Abort-before-write ordering is correct.** `resolveConflicts` is pure
  with respect to the filesystem; `applyPlan`/`applyResolution` run only
  after `unresolved.length === 0`; `saveSyncState` runs last. A crash
  mid-sync leaves `last_synced_commit` unadvanced and the sync retries
  cleanly. This is the single most important property in the slice and it
  holds. (The `mkdir` gap noted above is the one exception, and it is
  not currently reachable.)
- **Files with no merge rule do abort loudly, naming the path.**
  `resolve-conflicts.ts:209-211` is the fallthrough; `workflow.yaml` and
  attachments land there, and `GitConflictError` (`publish-sync.ts:55-68`)
  lists up to 10 paths and states plainly that nothing was written. This
  is what the brief asked me to check hardest and it is done properly.
- **`rekeyCollisions`' project-scoped allocation is genuinely fixed.**
  `reconcile.ts:86` reads `state.keys[task.frontmatter.project]`, matching
  the known-gaps entry's "Resolved" note. The `undefined`-project and
  missing-counter branches both report rather than guess. The remaining
  defect is only that the caller discards the report (SDL-2).
- **Ordering in `normaliseAfterMerge` is right, and for the stated
  reason.** Prefixes before rekeying, because rekeying allocates from the
  project's prefix (`publish-sync.ts:143-148`). Reversing it would issue
  keys from a prefix about to change.
- **`LOCAL_OWNED` correctly protects `.schema-version`**, satisfying the
  `invariants.md` rule that a newer clone must not brick an older one.
- **`deriveKeyState`'s `floor`** (`merge.ts:249`) correctly never lets a
  counter go backwards below either side's recorded value, so a
  created-then-deleted task's number is not reissued into a live
  `key_history` reference (P-7).
- **`appendKeyHistory` is idempotent** (`state/keys.ts:60-69`, dedupes via
  `includes`), so the double-append risk across the re-prefix pass and the
  rekey pass in `normaliseAfterMerge` does not materialise.
