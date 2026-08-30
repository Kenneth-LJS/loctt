# K8 model review — per-column board sequences

Reviewer pass over decision K8 (`docs/dev/decisions.md` §9), before any
implementation. Verdict first, then the five questions, then the
breakage list.

## VERDICT: Build it — **with changes**. The model is sound; the consolidation step as written is under-specified and, taken literally, breaks two blocker cases.

"Each column is its own sequence" is the right model, and Ken's two
corrections were both correct. But K8's sentence "fix core, then delete
the server's local computation and route both paths through
`reorderBoardRank`" cannot be executed as stated:

1. `reorderBoardRank` **rejects `before` and `after` together**
   (`reorder.ts:198-200` throws "mutually exclusive").
   `handleBoardMove` passes **both** anchors, deliberately — BRD-32
   requires the rank to be computed against the two neighbours the user
   actually saw. Routing through the existing function loses an anchor.
2. `reorderBoardRank` writes only `board_rank`, via `writeTask` under
   its own lock. A cross-column drop must write `status` + `board_rank`
   in **one** change set (`setFields`) or BRD-41/XS-9 are violated —
   the exact reason `handleBoardMove` exists (its own comment,
   `server.ts:~2294-2305`).

So the consolidation target is not "route through `reorderBoardRank`";
it is **a new core operation** (call it `boardMove`) that: takes an
optional destination `status`, accepts `before` and `after`
*together*, validates anchors against the **destination** column,
writes status+rank atomically through the `setFields` mechanism (with
the auto-managed grant), keeps the no-op guard, and rebalances the
destination column. `reorderBoardRank` and `handleBoardRerank` become
the no-status case of it. This is a change to K8's mechanism, not to
Ken's model — the model survives; the routing sentence does not.

Also note an internal contradiction inside K8's own text: mid-decision
it says "the **caller passes** the column's peer set (or the status set
defining it)"; four paragraphs later it says `deriveColumns` moves to
core and `reorderBoardRank` derives the column itself "without any of
them passing extra arguments". These are two different designs. The
second (derive in core) is the one Ken approved and the better one, but
the build agent will read both; the first paragraph should be treated
as superseded history, and ideally K8 amended to say so.

---

## Q1 — Is "each column is its own sequence" coherent with one unscoped `board_rank` string?

**Coherent, with two consequences that must be designed for, one of
which crashes today.**

`board_rank` is a single optional string per task
(`packages/contracts/src/task.ts:91`), scoped to nothing on disk.
Column membership is a *function of config at read time*
(`workflow.boards`, or 1:1 fallback). Working the membership-change
cases concretely:

- **Config splits a column (or `boards` removed → 1:1 fallback).** A
  multi-status column's interleaved sequence splits into per-status
  columns. Each new column's order is a *subsequence* of the old total
  order, and a subsequence of a total order is a total order. Relative
  order of same-status cards is preserved. Clean degradation — this
  case is actually a point in the model's favour.
- **Config merges columns (a `boards` block added or edited).** Two
  independently-dense sequences interleave by raw string comparison.
  The result is *arbitrary but stable*: `sortColumn`
  (`apps/web/src/client/board/columns.ts:~204`) tiebreaks equal ranks
  by `created_at` then `id`, so renders are deterministic (BRD-29 is
  implemented). No invariant breaks; the first drag repairs positions
  locally. Acceptable, but it should be *recorded* (decisions.md §8)
  that a column-membership config change yields an arbitrary-but-stable
  interleave, not a meaningful one.
- **Duplicate ranks become the normal case, and the write path throws
  on them.** Under per-column sequences, every column's first-ranked
  card gets `INITIAL` (`"u"`) — measured: `INITIAL === "u"`. Merge two
  such columns and the merged column contains two cards with rank
  `"u"`. Rendering tolerates this (BRD-29 tiebreak). The **write path
  does not**: `computeNewRank` in "after" mode with a duplicated anchor
  computes `between(anchor, ranked[anchorIdx+1])` where both are `"u"`,
  and `between` **throws** on equal bounds — measured at runtime:
  `between('u','u')` → `Error: between: lower bound must be less than
  upper bound (u >= u)`. That is a plain `Error`, not `ReorderError`,
  so it escapes `handleBoardRerank`'s catch and becomes a 500 (and an
  unhandled crash message on the CLI). This is latent *today* (only
  reachable via hand-edited duplicates, BRD-29's fixture) — the
  per-column model **promotes it to a normal-operation path**. The
  build must handle duplicate peer ranks in the write path (e.g. treat
  the later duplicate as unranked, as `sortColumn` effectively does, or
  nudge past all peers equal to the anchor).
- **Rank carried from a deleted column.** A rank never "belongs" to a
  column on disk; it is only ever *compared* within whatever column the
  task currently renders in. Since no code compares ranks across
  columns after the fix, a stale rank is merely an arbitrary position
  in the new column — same class as the merge case. No corruption.

One genuine gap the proposal does not address: **a task with no
`status` belongs to no column.** `bucketTasks` drops status-less tasks
from the board entirely (`columns.ts:~178-182`), and `deriveColumns`'
orphan bucket skips `status === undefined`. But the current
`reorderBoardRank` handles them fine (column = `undefined`, peers =
other status-less tasks), and **core's own test fixtures depend on
this**: `makeTasks` in `reorder.test.ts` creates tasks with no status
at all, and the BRD-28/BRD-49 rebalance tests rank them. If the new
code asks `deriveColumns` "which column?" and gets no answer, those
tests break — or worse, the code invents an answer. The build must
define it: recommend "tasks sharing the same absent/unknown status form
a pseudo-column", which preserves today's behaviour exactly.

## Q2 — Does moving `deriveColumns` into core make sense?

**Yes, with caveats — and the file itself argues the opposite, which
must be reconciled.**

The header comment of `columns.ts` (lines ~5-13) is an explicit
recorded rationale *against* this move: "Deliberately in the web
client, not core... the grouping of statuses into columns is
presentation and stays here", citing CLAUDE.md's drift rule. K8
(Ken's ruling) supersedes it, but the comment must be rewritten in the
same commit or the codebase carries two authoritative, contradictory
statements.

The purity claim checks out: `columns.ts` imports only types from
`@loctt/contracts`; no React/`window`/`document` (verified by reading
the whole file). Core already loads workflow config for other logic
(`sprints/burndown.ts:111` calls `loadWorkflowConfig`), and
`boards` is already in the contracts schema
(`workflow.ts:468`) — so core reading `workflow.boards` crosses no
architectural line that isn't already crossed.

Is column semantics surprising to a CLI user? **No, because it only
changes behaviour for users who configured `workflow.boards`.** With no
`boards` block, `deriveColumns` falls back to 1:1 status columns —
byte-for-byte today's per-status scoping. A user who wrote a `boards`
block opted into columns; two surfaces disagreeing about what "reorder
within the column" means would be the actual drift.

CLI/MCP obligations K8 does not account for:
- `docs/user/cli/reference.md` (`board-rerank`) and
  `docs/user/mcp/reference.md` (`reorder_board`) must be updated —
  CLAUDE.md's "any core change → both reference docs" rule.
- The MCP tool's `description` string
  (`apps/mcp/src/tools/task-rank.ts:~50`: "the task stays in its
  current status; this only changes its order within that column") stays
  true but "column" changes meaning; the description should say ranks
  can cross statuses within a configured column.
- If core gains a `boardMove` with a destination status (see verdict),
  CLI/MCP arguably owe a "move" command eventually — the web would
  otherwise be the only surface that can atomically move a card. Not
  required by K8, but it is exactly the `unarchiveView` pattern
  CLAUDE.md warns about; record it as a known follow-up rather than
  leaving it implicit.
- Type mismatch: `deriveColumns` takes `TaskFrontmatterPublic[]`; core
  works in `TaskFrontmatter`. It only reads `.status` (and
  `bucketTasks`/`sortColumn` read `board_rank`/`created_at`/`id`), so
  the signature should be generalized, not projected.
- **Move `sortColumn` (and ideally `bucketTasks`) too.** "The column's
  sequence" must be *one* definition. `sortColumn` treats a
  non-`[0-9a-z]+` rank as unranked (BRD-30); core's peer filter
  (`reorder.ts:216-217`) includes any defined string. After the move,
  core would rank against a peer set ordered differently from what the
  board renders. If `deriveColumns` moves because it defines the
  column, the column's *ordering* rules are part of the same
  definition.

## Q3 — Is consolidating the two rank implementations safe?

**The goal is right and the duplication is genuinely drifting — but
the consolidation must be a new core op, not a rerouting.** (Details in
the verdict; measurements here.)

- The drift K8 predicts already exists, measurably:
  `grep -n "REBALANCE\|rebalance" apps/web/src/server/server.ts` → **0
  hits** (positive control: `grep -c lexorankBetween` same file → 2).
  The cross-column path can never rebalance, so repeated cross-column
  drops into the same tight gap grow ranks without bound — BRD-28 does
  not exempt cross-column drops. Consolidation *fixes* a real latent
  gap; the "one implementation" argument is right.
- The duplication is nonetheless load-bearing in three ways the build
  must carry over, not delete:
  (a) both-anchors semantics (BRD-32) — `reorderBoardRank`'s API
  forbids it; (b) atomic status+rank via `setFields` with
  `BOARD_MOVE_GRANT` (BRD-9/41, XS-9); (c) the error *wording* BRD-44
  requires ("Couldn't reorder... no longer exists... Reload") plus the
  BRD-42 stale-config refusal — both currently server-side. BRD-42's
  check can stay in the server (it is about the HTTP client's stale
  view); BRD-44's wording either moves into core's anchor-lookup
  failure or the server keeps a wrapper.
- Anchor validation flips meaning: core's `anchorRank` refuses an
  anchor outside the *moved task's current* column. On a cross-column
  drop the anchors are legitimately in the *destination* column. The
  consolidated op must validate against the destination column
  (destination status's column when `status` is given, current column
  otherwise). K8 never states this; the build agent could plausibly
  ship a version where cross-column drops still get refused.
- The no-op guard (BRD-31, `reorder.ts:277-279`) must apply only when
  *neither* status nor rank changes, or a cross-column drop landing on
  an identical rank string would skip the status write.

## Q4 — What breaks?

See the breakage list below. On SPR-C2 specifically: its two tests
(`reorder.test.ts:~329-380`) use a fixture with **no `boards` block**
(default `initLoctt` workflow). Under 1:1 fallback, `backlog` and
`in_progress` are *still different columns*, so both tests likely stay
**green after the fix**. Two consequences: (1) K8's "editing a green
test" framing is only partly right — the tests' *comments* assert the
false premise ("A board column is a status") and must be rewritten, but
the assertions may survive; (2) the actual K8 behaviour change —
cross-status anchors accepted within one configured column — has **no
failing test today** (BRD-12's e2e is `test.fixme` at
`tests/ui/flow-board.spec.ts:1694`, which does count, but core has
nothing). Per the testing rules, the build must add a core test with a
`boards` config, shown to fail against current code.

## Q5 — Is there a better model?

No — per-column sequences are the right model for Ken's stated
requirements, and I checked the obvious alternatives:

- Global ordering: correctly rejected by Ken; the `{kind:"end"}`
  analysis in K8 is accurate (verified against `reorder.ts:353-355`).
- Status-scoped ranks merged at render: cannot express interleaving —
  fails the first correction.
- Column-keyed rank storage (rank prefixed or mapped by column id):
  rots the moment config renames/splits a column; strictly worse.

One *mechanical* refinement worth adopting inside the model:
`handleBoardMove`'s "interpolate between the two on-screen anchors,
re-read from disk" is a *stronger* primitive than `computeNewRank`'s
"one anchor + peer set" (it is what BRD-32 literally specifies). The
consolidated core op should keep anchor-pair interpolation as the
positioned-drop path, and use the column peer set only for `end` mode,
duplicate-rank recovery, and rebalance scoping. That is consolidation
*toward the server's math*, not the core's — K8's text implies the
opposite direction.

## BREAKAGE LIST

Must change with this build:
1. `packages/core/src/rank/reorder.ts` — peer filter (213-218),
   `anchorRank` (228-239: message text says "Board rank is per-column —
   move the task to that status first"; the remedy becomes wrong),
   rebalance scope; duplicate-peer-rank handling in `computeNewRank`
   (the `between(u,u)` throw, Q1).
2. New core op for atomic status+rank with both anchors; server's
   `handleBoardMove` local math deleted only after it exists.
   `handleBoardRerank` unchanged in shape.
3. `apps/web/src/client/board/columns.ts` — header comment (contradicts
   K8), `deriveColumns`/`sortColumn` move to core; re-export or update
   importers: `BoardView.tsx`, `columns.test.ts` (tests move with it).
4. `reorder.test.ts` SPR-C2 block — comments rewritten; new
   boards-config test shown to fail; status-less-task behaviour pinned
   (pseudo-column) or the BRD-28/BRD-49 rebalance tests break.
5. Docs: `docs/user/cli/reference.md`, `docs/user/mcp/reference.md`,
   MCP `reorder_board` description string, `contracts/task.ts:91`
   docstring (finally becomes true — say so), `known-gaps.md` BRD-12
   entry retired, `flow-board.spec.ts` BRD-12 `fixme` lifted.
6. New failure mode to record: `reorderBoardRank` will now call
   `loadWorkflowConfig`, which throws on absent/invalid `workflow.yaml`
   (`config/workflow.ts:52-63`; the `boards` cross-column duplicate
   check is in the zod schema itself, `contracts/workflow.ts:397-425`,
   so it runs on every parse). A CLI `board-rerank` in a tracker with a
   malformed `boards` block goes from "works, status-scoped" to
   "config error". Consistent with BRD-45's spirit, but it is a
   behaviour change and belongs in decisions.md §8 with the revert path.

Observed in passing, not this build's scope: `bucketTasks` silently
drops status-less tasks from the board entirely (no column renders
them), which sits oddly with P7 ("board must not show fewer tasks than
the tracker holds"); and its docstring claims the orphan bucket catches
them, which it does not.

## NOT checked

- `evenlySpacedRanks` internals (rebalance order-preservation is
  covered by BRD-28/BRD-49 green tests; I read, did not re-derive).
- The web client drag model (`dragModel.ts`) beyond its decision-record
  summary — K8 does not change the gesture layer.
- Whether the build worktree `.claude/build-m33` has divergent copies
  of these files — out of bounds per instructions.
- Git-backed publish interaction with multi-file rebalance writes —
  orthogonal to the model choice.
