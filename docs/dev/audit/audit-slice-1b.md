# Audit — Phase 4, slice 1b (`packages/core/src/task/*`)

Files read **in full**: `comments.ts`, `relationships.ts`, `traversal.ts`,
`history.ts`, `attachments.ts`, `lookup.ts`, `show.ts`, `export.ts`,
`progress.ts`, `mime.ts`, `index.ts`. Supporting files read **partially**,
only to verify a claim: `contracts/src/workflow.ts` (inverse helpers),
`contracts/src/task.ts` (`TaskRelationshipSchema`), `contracts/src/history.ts`,
`paths/index.ts`, `task/history.test.ts`, `task/traversal.test.ts` (greps).

Report-only. No file was edited.

---

### Coalescing window is a rolling window, not a fixed one — Q18/D4 divergence
- **File**: `packages/core/src/task/history.ts:198-202` (with `:210-215`)
- **Category**: bug
- **What is wrong**: On a coalesce, the surviving entry's `timestamp` is rolled
  forward to the incoming entry's timestamp (`timestamp: next.timestamp`), and
  `withinCoalesceWindow` then measures the *next* gap from that new timestamp.
  The window therefore restarts on every edit rather than being anchored to the
  burst's start. Verified by simulation: five edits 14 minutes apart collapse
  into **one** entry spanning 70 minutes; the sequence never exceeds the
  15-minute test because each individual gap is under it. There is no upper
  bound — an actor editing every 14 minutes for a working day produces a single
  `body_edited` row.
- **Why it matters**: Invariant Q18/D4 says entries "coalesce within a
  15-minute same-actor window". Under autosave the rolling reading is defensible
  for a typing burst, but the invariant's stated worry is precisely that a
  window can "merge two deliberate saves minutes apart into one history entry" —
  and here it merges saves *arbitrarily far* apart. It also degrades M3: `before`
  is pinned to the start of the burst and `after` to the end, so the single
  entry claims to reconstruct a span that may cover hours of distinct edits, and
  every intermediate state is unrecoverable. History is the declared recovery
  path for M2/M4, so the reconstruction guarantee is the thing being weakened.
- **Blast radius**: `appendHistory` is the only writer (`io.ts:95` is the only
  `body_edited` producer). Consumers: `apps/cli/src/format/history.ts:75`, the
  web activity feed, and the `_history.yaml` union merge rule (identity is
  `(timestamp, kind, actor, field)` — a rolled-forward timestamp changes the
  merge identity of an entry that already synced, so the same logical edit can
  union as two rows across clones).
- **Note on tests**: `history.test.ts:228-291` covers coalescing but every case
  measures a single gap against the rolled-forward timestamp, so none of them
  distinguishes rolling from fixed. `"starts a fresh entry when the window
  expires"` (:283) uses one 20-minute gap and passes under both readings. The
  behaviour is unasserted either way — deciding which is intended is a product
  call, and per `CLAUDE.md` if the fixed reading is correct then a test change
  here is a test that was asserting the bug.
- **Size**: S (the change) / M (deciding + retesting)
- **Auto-fixable**: no — behaviour change, and it alters on-disk timestamps
- **Confidence**: high (behaviour verified by simulation; intent is the open part)

### `linkTask` never assigns `rank`, and both edge helpers silently drop it
- **File**: `packages/core/src/task/relationships.ts:85-108`
- **What is wrong**: `TaskRelationship` carries an optional `rank`
  (`contracts/src/task.ts:39`) which orders targets of a `ranked: true`
  relationship within one source task. `addEdge` constructs `{ type, target }`
  with no rank and consults no config, so a link created through `linkTask` is
  never ranked. Grep for `rank` in `relationships.ts` and `bulk.ts` returns
  nothing. `removeEdge` rebuilds the array by slicing, which preserves rank on
  survivors — so the two helpers are not symmetric in intent, but neither is
  rank-aware.
- **Category**: bug
- **Why it matters**: `architecture.md` documents relationship rank as one of
  the two lexorank consumers. Every edge LocTT creates is unranked, so the
  documented ordering has no source of values; per the schema comment "tasks
  without rank sort below ranked ones", meaning *all* of them tie. Whether this
  is "not built yet" or "a gap" matters: it is not in `decisions.md` as a
  deliberate omission, and the contracts field plus the architecture paragraph
  both assert it exists.
- **Blast radius**: `linkTask` / `bulkLink` / every surface that links; any
  renderer ordering by relationship rank. Adding rank assignment touches the
  on-disk shape of `relationships[]`.
- **Size**: M
- **Auto-fixable**: no — on-disk shape
- **Confidence**: high (that no rank is written); medium (on whether it is
  intended to be unbuilt — worth confirming against a ticket before acting)

### Comments lock and history lock target the same directory — latent self-deadlock
- **File**: `packages/core/src/task/comments.ts:151-169` and `history.ts:137-141`
- **Category**: bug
- **What is wrong**: `withCommentsLock` locks `dirname(_comments.yaml)` — the
  task directory. `appendHistory` locks `dirname(_history.yaml)` — the *same*
  task directory. `proper-lockfile` is **not** re-entrant: verified directly,
  a second `lock()` on a held directory fails `ELOCKED` rather than nesting.
  Today the three comment functions all call `recordCommentEvent` strictly
  *after* the lock closure returns, so nothing deadlocks — the safety is
  positional, not structural, and nothing in the code says so. Moving the
  history append inside the closure (the obvious "make it atomic" refactor)
  turns every comment write into an `ELOCKED` failure after ~50 retries.
- **Why it matters**: This is a trap laid for the next editor. The current
  correctness rests on an ordering that reads as incidental — and the ordering
  it forces is itself a weakness: the comment is committed before the history
  entry, and `recordCommentEvent` swallows all failures, so a crash between the
  two loses the M3 record for a hard-deleted comment. That is exactly the case
  `decisions.md` M3 calls "the sharpest case: a hard delete with no record of
  the text, unrecoverable by any means".
- **Blast radius**: all three comment mutators; `appendHistory` is called from
  ~a dozen sites across `task/` (attachments, relationships, io, lifecycle,
  bulk, move). Any of those acquiring the task-dir lock hits the same wall.
- **Size**: S (a comment naming the constraint) / L (making it genuinely atomic)
- **Auto-fixable**: no — the cheap part is a comment addition, which the plan
  permits, but the finding is the hazard, not the comment
- **Confidence**: high

### `buildTree` seeds `edges` with an aliased roots array
- **File**: `packages/core/src/task/traversal.ts:101-119`
- **Category**: bug
- **What is wrong**: `roots` is pushed into `edges` under key `""` at :103, then
  the same array object is mutated through the `roots.push` branch. Separately,
  the parent branch does `edges.get(parentId) ?? []` — so a relationship whose
  `target` is the empty string resolves `edges.get("")` and pushes the child
  **into the roots list**. Verified by simulation: the child appears as a root.
- **Why it matters**: `""` is a sentinel key sharing a namespace with real
  target ids. `TaskRelationshipSchema` has `target: z.string().min(1)`, so a
  schema-valid task cannot produce this — but `buildTree` takes an in-memory
  `Task[]` and the doc comment on the function explicitly anticipates data that
  arrived by direct `task.md` edit or a git merge, i.e. paths that did not
  re-validate. A corrupt edge would then be silently reclassified as a root
  rather than surfacing as the dangling reference it is.
- **Blast radius**: contained — `buildTree` has **zero non-test callers**
  (see next finding), so nothing is broken today.
- **Size**: S
- **Auto-fixable**: no — changes function behaviour on malformed input
- **Confidence**: high (mechanism verified); the reachability is the conditional part

### `buildTree` / `TreeIndex` / `StructuralCycle` are exported but unused
- **File**: `packages/core/src/task/traversal.ts:73-123`, re-exported at
  `task/index.ts:77` and `core/src/index.ts:347`
- **Category**: dead-code
- **What is wrong**: `buildTree` has no callers outside `traversal.test.ts`.
  `TreeIndex` has none at all. `StructuralCycle` is used only within
  `traversal.ts` itself and is **not** re-exported from `task/index.ts`, even
  though it is the return element type of the exported `findStructuralCycles`.
- **Why it matters**: `buildTree` is a public API surface of `@loctt/core`
  carrying a 24-line rationale comment and its own second cycle detector
  (`findCyclesIn`) — roughly 90 lines maintained for tests only. It is plausibly
  *intended* for the tree/timeline views that M2–M4 will build, in which case it
  is pre-built rather than dead; that distinction should be recorded rather than
  guessed at. Meanwhile `StructuralCycle` being unexported means an external
  consumer of `findStructuralCycles` cannot name its return type.
- **Blast radius**: public export of `@loctt/core`. Removal is a breaking change
  to the package surface; exporting `StructuralCycle` is additive.
- **Size**: S
- **Auto-fixable**: no — the plan permits unused-export removal, but this touches
  a public export, which escalates by rule regardless of size
- **Confidence**: high (on the reference counts)

### `findStructuralCycles` is not re-exported; `doctor` reaches past the barrel
- **File**: `packages/core/src/diagnostics/doctor.ts:19` importing
  `../task/traversal.js` directly; absent from `task/index.ts:76-77`
- **Category**: layering
- **What is wrong**: `task/index.ts` is the barrel for the `task/` module and
  exports every other traversal symbol (`buildTree`, `getChildren`, `getParents`,
  `getRelatedTasks`, `validateRelationships`). `findStructuralCycles` is
  omitted, so `doctor.ts` imports it via a deep path — while importing
  `validateRelationships` from that *same* deep path on the same line, even
  though that one is available through the barrel.
- **Why it matters**: The barrel stops being the module boundary the moment one
  consumer routes around it; the next consumer copies the deep import. Note the
  inconsistency is inside a single import statement, which is what makes it
  clearly unintended rather than a considered exception.
- **Blast radius**: two modules. Adding the export is additive; changing
  `doctor.ts`'s import path is internal.
- **Size**: S
- **Auto-fixable**: no — adding a public export changes the package surface
- **Confidence**: high

### Two full cycle-detection implementations, plus a third for the write path
- **File**: `traversal.ts:134-199` (`findCyclesIn`) and `:249-340`
  (`findStructuralCycles`); `relationships.ts:123-162` (`findStructuralCycle`)
- **Category**: duplication
- **What is wrong**: Three DFS cycle detectors. `findCyclesIn` and
  `findStructuralCycles` do the *same job* — iterative 3-colour DFS with
  lowest-id canonicalisation and a `seen` fingerprint set — over different input
  shapes (a prebuilt child→parents map vs. `Task[]` + config). The
  canonicalise-and-dedupe block is near-identical logic written twice
  (`:174-186` vs `:305-323`). The comment at `:126-131` acknowledges the mirror
  and justifies it on a performance ground ("pays one pass rather than two").
- **Why it matters**: Two implementations of a subtle algorithm drift. They
  already differ in ways that are hard to attribute to intent: `findCyclesIn`
  uses a two-state colour map (`grey`/`black`, absence = white) while
  `findStructuralCycles` uses an explicit three-state map; `findCyclesIn` skips
  out-of-corpus edges (`:169`) whereas `findStructuralCycles` marks the missing
  node black (`:277-281`). A fix applied to one will not reach the other.
- **Blast radius**: `doctor`'s cycle report; `buildTree`'s cycle report (no
  production caller). `relationships.ts`'s variant is genuinely different — it
  is async, reads from disk, walks one direction from one node, and throws on
  size — so it is **not** a collapse candidate. The traversal pair is.
- **Size**: M
- **Auto-fixable**: no
- **Confidence**: high (that they duplicate); medium (that collapsing is net-positive
  — the differing corpus handling may be load-bearing for `doctor` and must be
  checked case by case before merging)

### `findStructuralCycles` mutates frames through repeated inline casts
- **File**: `packages/core/src/task/traversal.ts:288-299`
- **Category**: abstraction
- **What is wrong**: The stack frame is declared `{ id: string; path: string[] }`
  but two extra fields are bolted on at runtime via three separate identical
  inline casts to `{ id; path; outgoing?; cursor? }`, plus a `as string` at
  `:299` and another at `:318`. The frame type it actually wants is the one
  declared four lines away in `findCyclesIn` (`{ id: string; next: number }`).
- **Why it matters**: Five casts in twelve lines is the type system being
  overridden rather than used; each `as` is a place a genuine error cannot be
  caught. Declaring the frame interface with `outgoing`/`cursor` optional
  removes all of them with no behaviour change.
- **Blast radius**: function-local. No signature, no export, no on-disk shape.
- **Size**: S
- **Auto-fixable**: no — it is a local type declaration change, not on the
  permitted list (dead code / unused export / import order / local rename /
  comment). Low-risk but escalates by rule.
- **Confidence**: high

### `includeBody` behaves differently in the JSON and CSV exporters
- **File**: `packages/core/src/task/export.ts:62` vs `:117`
- **Category**: bug
- **What is wrong**: CSV appends a `body` column only `if (!columns.includes("body"))`.
  JSON does `if (options.includeBody) row["body"] = t.body` unconditionally —
  harmless for JSON since it is a keyed object, but the two paths also differ
  when `body` is an *explicit* column and `includeBody` is false: `getColumnValue`
  handles `"body"` at `:37`, so both emit it. The asymmetry is that JSON's
  `includeBody` overwrites a value already set by the column loop, while CSV's
  produces one column; the observable divergence is that JSON with
  `columns: ["body"], includeBody: true` emits one key and CSV emits one column —
  consistent — but JSON with `includeBody: true` ignores column *ordering* for
  body while CSV appends it last.
- **Why it matters**: Low-severity, but the two exporters are the round-trip
  pair referenced by the CSV round-trip defect already fixed in `db40b2c`. Two
  functions that are supposed to describe the same rows should decide column
  membership in one place; today the membership rule is written twice and
  already differs in shape.
- **Blast radius**: `apps/web/src/server/server.ts:2241` (export route), CLI
  export. Output format — user-visible.
- **Size**: S
- **Auto-fixable**: no — output shape
- **Confidence**: medium (the divergence is real; whether any caller hits a
  case where it is observable is not established — I did not find one)

### `readHistory`'s `desc` ordering assumes the file is chronologically sorted
- **File**: `packages/core/src/task/history.ts:83`
- **Category**: bug
- **What is wrong**: `order: "desc"` is implemented as `[...filtered].reverse()`
  — an array reversal, not a sort on `timestamp`. It yields newest-first only if
  `_history.yaml` is already oldest-first.
- **Why it matters**: `appendHistory` always appends, so the file is sorted
  under normal operation. But the `_history.yaml` git-merge rule
  (`decisions.md` §6) unions entries by `(timestamp, kind, actor, field)`, and a
  union of two divergent files has no reason to come back in timestamp order.
  After a sync, `desc` can return entries in an order that is neither ascending
  nor descending, and `limit`/`offset` then page over that order — so "the 10
  most recent" silently is not.
- **Blast radius**: every activity-feed consumer that passes options — web task
  detail, MCP history tool, CLI history formatting.
- **Size**: S
- **Auto-fixable**: no — changes returned ordering
- **Confidence**: medium (the reversal is certain; whether the merge actually
  emits out-of-order entries depends on `git/merge.ts`, which is slice 2 — worth
  handing to that slice to confirm)

### `MAX_VISITS` makes linking impossible in a large connected component
- **File**: `packages/core/src/task/relationships.ts:129-139`
- **Category**: bug
- **What is wrong**: The cycle walk throws once `visited.size > 1000`. Verified:
  the throw fires on the 1001st distinct node. The guard is on nodes *visited*,
  not on work done, so a perfectly acyclic tracker whose `parent` component
  exceeds 1000 tasks will refuse every new link in that component, permanently,
  with "relationship graph too large to verify cycles ... contact a maintainer".
- **Why it matters**: The doc comment frames this as "refuse to add the link
  rather than say it looks fine", which is the right call for a *timeout*. But
  1000 tasks is not an exotic tracker, and the failure is not transient — it is
  a hard ceiling on tracker size for cycle-constrained relationships, reached
  silently and reported as an internal problem. There is no `decisions.md` entry
  capping graph size.
- **Blast radius**: `linkTask` only (the walk is write-path). Changing the limit
  or the strategy touches an error message, so it escalates.
- **Size**: S (raise/parameterise) / M (bound by work instead of nodes)
- **Auto-fixable**: no — error message + behaviour
- **Confidence**: high (mechanism); medium (on whether 1000 is deliberate)

### `resolveRelationships` issues one disk read per edge, unbounded
- **File**: `packages/core/src/task/show.ts:103-125`
- **Category**: abstraction
- **What is wrong**: `Promise.all` over `rels.map(lookupById)` — one `readTask`
  per relationship, all in flight simultaneously, with no concurrency cap and no
  dedupe when two edges share a target.
- **Why it matters**: `buildShowModel` runs on every task detail render. The
  comment at `:36-45` justifies reading live rather than denormalising, which is
  right (it cites P1-style drift) — the issue is only that the read is
  per-edge. A task with many links opens that many file handles at once. Note
  `lookup.ts` already maintains a key index for the *key* path; there is no
  equivalent batch path for ids.
- **Blast radius**: `buildShowModel` → web `handleGetTask`
  (`contracts/src/service.ts:143` names it), CLI `show`, MCP get_task.
- **Size**: M
- **Auto-fixable**: no
- **Confidence**: medium — real, but I did not measure it, and typical edge
  counts are small enough that this may never bite

### Import lists in `task/index.ts` have missing spaces after commas
- **File**: `packages/core/src/task/index.ts:57, 69, 73, 75, 77`
- **Category**: naming
- **What is wrong**: `TaskLifecycleError,unarchiveTask`,
  `MoveTaskError,moveTaskToProject`, `RelationshipError,unlinkTask`,
  `buildShowModel,discoverAttachments`, `getParents,getRelatedTasks` — an
  autofixer appears to have sorted these without reinserting the space. The same
  pattern is in `core/src/index.ts:347`.
- **Why it matters**: Cosmetic only, but it is the kind of thing that makes
  every future diff on this file noisy.
- **Blast radius**: none — formatting inside export statements.
- **Size**: S
- **Auto-fixable**: **yes** (import/export ordering and formatting)
- **Confidence**: high

### `contracts/history.ts` comment contradicts the code after M3
- **File**: `packages/contracts/src/history.ts:10` and `:18`
- **Category**: comment
- **What is wrong**: The `HistoryKind` doc says `body_edited` — "body content
  changed (**no content captured**)" and, for the comment kinds, "**No comment
  body is captured**, matching `body_edited`". Both are now false. `io.ts:95`
  writes `before`/`after` for `body_edited`, and `comments.ts:239-251` writes
  `before`/`after` for all three comment kinds — deliberately, per M3, whose
  entry calls the `comment_deleted` case the reason the change was made.
- **Why it matters**: `decisions.md` M3 is the record that this changed, and
  this comment is now the counter-evidence someone will find first. It is
  precisely the "shipped behaviour diverged from the comment" case that leads to
  a later change re-applying the old rule.
- **Blast radius**: comment only.
- **Size**: S
- **Auto-fixable**: **yes** (comment correction)
- **Confidence**: high

---

## Nearly reported, and why I did not

- **`attachFile`'s `AttachmentExistsError` thrown inside a `try` whose `catch`
  swallows** (`attachments.ts:148-158`) — looks like the error is caught and
  discarded. It is not: the `catch` re-throws it by identity check at `:156`.
  Verified by simulating the control flow. **Correct as written**, though the
  shape is fragile enough that the guard is doing real work.
- **`findStructuralCycles`'s `stack` declared outside `visit()`**
  (`traversal.ts:263`) — looked like state leaking between `visit` calls. The
  `while` loop drains the stack to empty before returning, so each call starts
  clean. Correct, if needlessly wide in scope.
- **`linkTask` writing a duplicate edge for symmetric relationships** — traced
  it: `findInverseType` returns `rel.key` for a symmetric def, so forward writes
  `A -[rel]-> B` and inverse writes `B -[rel]-> A`. One edge per side, matching
  the documented "each side gets exactly one edge". Correct.
- **`unlinkTask` has an `isSelfLink` guard (`:357, :369`) but `linkTask` has
  none** — asymmetric, but `linkTask` rejects self-links outright at `:215-219`,
  so the guard would be unreachable there. Correct; the asymmetry is justified.
- **Comments reaching no surface** — `decisions.md` Q26 records this
  (comments "reach no surface at all today"). Deliberate, not a gap. In fact it
  is now stale in the other direction: `apps/web/src/server/server.ts:2522` and
  `apps/mcp/src/tools/comments.ts` both call the comment API, so that
  decisions.md note is out of date — flagged for the docs pass, not as a code
  finding.
- **`mimeForFilename` returning a type for `.hidden.png`** — the doc comment
  says leading-dot dotfiles return undefined. `.hidden.png` returns
  `image/png` because `lastIndexOf` finds the second dot. Not a defect:
  `attachFile:134` rejects all leading-dot names before storage, so no dotfile
  reaches the lookup. The comment's parenthetical example (`.bashrc`) is
  accurate — that one has no second dot.
