# Phase Z Batch 2 — Performance review

Read-only review of computationally heavy paths on a realistic tracker
(hundreds–thousands of tasks). Focus: redundant full-corpus scans,
O(n²) where O(n) is easy, repeated re-parsing in one request, unbounded
work, sync fs in hot loops.

## Method

A timing probe generated an N-task tracker (1 markdown file per task,
each with a body, labels, a milestone, a due date, and a `parent`
relationship on every third task) and timed the real core entry points
against `packages/core/dist`. Probe:
`scratchpad/probe.mjs` / `probe2.mjs` (throwaway).

Measured medians (warm; macOS, SSD):

| Path | N=1000 | N=2000 | Shape |
|---|---|---|---|
| `loadAllTasksDetailed` (1 corpus scan, 32-way I/O) | 128 ms | 212 ms | linear, disk-bound |
| `listTasks` (query + sort, in-memory) | 1.0 ms | 1.3 ms | negligible |
| `listTasks` (`text ~`, scans every body, in-memory) | 0.8 ms | 1.3 ms | negligible |
| `milestoneProgressDetailed` (20 milestones, 1 scan) | 106 ms | 212 ms | linear, = 1 scan |
| `countTasksByReferences` (20 ids, 1 scan) | 107 ms | 210 ms | linear, = 1 scan |
| `checkDataIntegrity` | 357 ms | 745 ms | linear |
| `runDoctor` | — | 1121 ms | linear |

The headline: **the whole cost is the corpus load** (~0.1 ms/task of
file I/O), and it scales cleanly linearly from 1k→2k. Everything done
*in memory* on already-loaded tasks — query evaluation, the new
date-compare path, sort, `computeProgress`, bucketing — is sub-
millisecond at 2000 tasks and is not worth touching. No O(n²) was found
on any path examined.

## Findings by severity

- **High:** 0
- **Medium:** 0
- **Low:** 1 (F-1)
- **Informational:** 1 (I-1)

No finding clears the "genuinely hot + fixable win" bar. F-1 is a latent
double-scan reachable only through the raw API; I-1 records the doctor
cost so a future reader does not re-investigate it.

---

### F-1 (Low) — milestone/sprint list does two full corpus scans when `?counts=true&progress=true` are combined

`apps/web/src/server/server.ts:1943-1957` (`handleListSprints`) and
`:2037-2048` (`handleListMilestones`) call `withCounts` then
`withProgress` in sequence:

- `withCounts` (`:1899`) → `countTasksByReferences` → **one**
  `loadAllTasks` (`packages/core/src/task/counts.ts:59`).
- `withProgress` (`:1927`) → `milestoneProgressDetailed` →
  `referenceProgressDetailed` → **another** `loadAllTasksDetailed`
  (`packages/core/src/task/progress.ts:174`).

Complexity: two independent O(n) disk scans of the identical corpus in
one request. At 2000 tasks that is ~212 ms × 2 ≈ 420 ms, when one shared
scan would do both jobs (counts and progress both only read frontmatter
fields already in memory).

Triggering input: a GET to `/api/milestones?counts=true&progress=true`
(or the sprint equivalent) on a large tracker.

Hot vs cold: **not hot on the shipped UI.** Grep of
`apps/web/src/client` shows the milestones view requests `?progress=true`
alone (`api/hooks/useMilestoneProgress.ts:44`,
`milestones/MilestonesView.tsx`) and the Settings panels request
`?counts=true` alone (`settings/LabelsPanel.tsx`). No client code sends
both flags together, so today this path costs one scan, not two. The
double scan is reachable only by an API consumer that asks for both.

Severity: Low. It is correct, bounded, O(n), and off the shipped hot
path. It becomes a real per-request cost only if a future view decides
to show counts and progress side by side.

Suggested direction (only if such a view appears): have `withProgress`
and `withCounts` share one `loadAllTasksDetailed` result — e.g. an
in-memory `computeProgress`/count over a single loaded `Task[]`, rather
than each helper loading independently. The in-memory versions
(`computeProgress`, a set-membership count) already exist and are
sub-millisecond; only the load is being duplicated.

---

### I-1 (Informational) — `runDoctor` reloads the corpus ~3× plus a serial per-task read pass; acceptable for a diagnostic

A single `runDoctor` run at 2000 tasks measured ~1121 ms. Attributed to
components (probe2.mjs):

- `validateRelationships` (`diagnostics/doctor.ts:331`) — 1 scan (~213 ms).
- `loadAllTasks` (`diagnostics/doctor.ts:339`) — a **second** scan of the
  same data (~224 ms), used for the field-reference / drift / cycle passes.
- `checkDataIntegrity` (`diagnostics/doctor.ts:551`) — ~763 ms, which
  internally calls `validateRelationships` **again**
  (`diagnostics/integrity.ts:186`, a 3rd corpus scan) and then walks every
  task id reading three files each — comments, history, task.md — in a
  **serial** `for` loop (`integrity.ts:90-177`), with `await` inside the
  loop and no concurrency cap. `loadAllTasks` reads with 32-way
  concurrency (`task/load-all.ts:14`); this loop reads one file at a time.
- The key-index check (`doctor.ts:494-513`) does a further serial
  `readTask` for every index entry.

So the corpus is loaded three times over (validateRelationships twice +
loadAllTasks once) and, separately, the integrity sweep reads
~3 files/task strictly serially. Concurrency + a single shared scan would
cut the wall-clock materially.

Why this is **not** a finding: `doctor` is a cold path — a manual
diagnostic run by hand, not per-request and not per-keystroke. The task
brief explicitly rates a heavy cold path as "usually not a finding," and
correctness here (independent re-reads so one check cannot mask another's
staleness) is arguably worth more than the wall-clock. ~1 s for a
2000-task health check that a user runs occasionally is acceptable.

Recorded so a future reader does not mistake the triple scan for a bug:
it is redundant, it is O(n) not O(n²), and it is deliberate cold-path
simplicity. If doctor latency ever becomes a complaint, the cheapest win
is (a) load the corpus once and pass the `Task[]` into
`validateRelationships`/`findStructuralCycles`/the drift pass instead of
each re-loading, and (b) give `checkDataIntegrity`'s per-task loop the
same `mapWithLimit(…, 32, …)` treatment `loadAllTasks` already uses.

---

## Checked, acceptable (no finding)

- **`loadAllTasks` / `loadAllTasksDetailed`
  (`task/load-all.ts`).** Single scan, 32-way bounded concurrency to stay
  under the fd ulimit, linear in task count. This is the irreducible cost
  of a filesystem-backed tracker: to filter/sort/count/paginate you must
  read the corpus once. ~0.1 ms/task, scales linearly 1k→2k. Fine.

- **Per-request scan count on the main surfaces.** `/api/tasks`
  (`server.ts:3283`), `/api/search` (`:3506`), `/api/tasks/export`
  (`:3552`) each call `loadAllTasksDetailed` **exactly once** and reuse the
  result for filter, sort, and `buildListContext`. No path re-loads or
  re-parses within a request. Verified by reading each handler.

- **Query parse-once.** `applyListTasksFilterAndSort`
  (`query/list.ts:270-282`) tokenizes+parses the query string **once** per
  list call and then runs the pure in-memory `evaluateQuery` per task. The
  `today` literal is resolved once per call (`list.ts:47-55`), not per
  task. No per-task parsing.

- **Query evaluator (`query/evaluator.ts`), incl. the new date path.**
  Pure, no I/O, no clock. Per-task cost is a handful of map lookups and
  string compares. The date-aware branch (`compareDates`,
  `toDateOnly`, `isDateField`) is a constant-time prefix test + slice per
  comparison. `text ~` scanning every body measured 1.3 ms at 2000 tasks.
  Custom-field `searchable` set is built once per evaluation from config.
  Negligible.

- **`buildListContext` (`query/list.ts:87-103`).** Builds two id→value
  maps in one O(n) pass over already-loaded tasks; bodies are already in
  memory (no extra I/O). O(1) lookups thereafter. Fine.

- **`computeProgress` (`task/progress.ts:45`).** One pass over the group,
  a `Map` of status→category built once. O(n). The Milestones-view
  concern — "does `?progress` do ONE scan or one-per-milestone?" —
  resolves to **one**: `referenceProgressDetailed`
  (`progress.ts:167-196`) does a single `loadAllTasksDetailed`, buckets
  every task into a `Map<milestoneId, Task[]>` in one pass, then calls
  `computeProgress` per bucket. Not N scans. Confirmed by measurement
  (`milestoneProgressDetailed` for 20 milestones == cost of exactly one
  scan).

- **`countTasksByReferences` (`task/counts.ts:47`).** One scan, `Set`
  membership per task, O(n) for any number of ids. The batched form is
  used by `withCounts`, so a Settings panel listing many labels is one
  scan, not one-per-label. Measured == one scan. Fine.

- **Board bucketing (`board/columns.ts`).** Column assignment is a map
  build + single pass over tasks; no nested task iteration. O(n). Not a
  hot re-scan.

- **Rank / reorder (`rank/`).** Lexorank midpoint math is per-move O(1);
  `reorder`/`board-move` operate on the moved item's neighbours, not the
  whole corpus. No full-list recompute per move. Fine.

- **Server list pagination.** `paginated()` slices the filtered+sorted
  array in memory after the single scan (`server.ts` list handler).
  Loading the whole corpus before slicing is inherent to fs-backed data
  (the true `total` and the sort order require the full set); it is not a
  "load everything then throw it away" mistake. `limit:
  Number.MAX_SAFE_INTEGER` is deliberate so `total` is accurate, then the
  page is sliced. Fine.

- **`validateRelationships` (`task/traversal.ts:18`).** One scan; builds
  `taskIds`/`byId` sets/maps once; per-task work is over that task's own
  edges with O(1) set/map lookups for target existence and back-edge
  check. O(n + edges), **not** O(n²) — the back-edge lookup is a `Map.get`
  + `.some` over the *target's* own (small) edge list, not a corpus rescan.

- **`findStructuralCycles` / `buildTree` (`task/traversal.ts`).**
  Iterative 3-colour DFS, O(V+E) per cycle-constrained relationship. No
  per-node rescan. `buildTree` pays one extra O(V+E) pass for cycle
  detection, documented. Fine.

- **`git branchDiffersFromBase` (`git/publish-sync.ts:913`).** Two
  `git show` (spawned processes) per copied path, in the loop at `:993`.
  Bounded by `plan.copies.length` — the size of the branch/base
  divergence, **not** the corpus size. A publish after a small remote
  change reads a handful of paths. Cold path (once per publish),
  divergence-bounded. Not a finding.

- **`detectPublishReconcile` / `planSync`
  (`git/publish-sync.ts:939`).** Creates one temporary worktree and one
  `planSync` per publish-divergence check. Cold (once per publish). The
  tree reads are bounded by divergence, not corpus. Acceptable.
