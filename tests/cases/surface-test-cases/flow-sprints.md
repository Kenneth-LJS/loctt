# Sprints

Sprint CRUD, burndown, and board reorder.

Gaps only. See [README.md](README.md) for conventions.

---

### SPR-C1 · blocker · P1 P3 · CLI MCP
**A burndown counts only the sprint it charted.**
`packages/core/src/sprints/burndown.ts:292,303` computes `inSprint` as
"has *a* sprint" — `sprint.id` is never compared to the task's `sprint`
field. In any multi-sprint tracker every burndown is the sum of all
sprints, wrong simultaneously on CLI, MCP, and web.

All 18 existing cases in `burndown.test.ts` reuse one sprint id for both the
sprint and its tasks, which makes "has a sprint" and "has *this* sprint"
indistinguishable — so the suite is thorough and cannot fail. **Any new
case must use at least two sprints.**

- With two sprints each holding one incomplete task, `initialTotal` is 1,
  not 2, on every surface.
- The payload's `sprintId` equals the resolved id of the *requested*
  sprint.
- `series.length` equals the inclusive day count of the requested sprint's
  window — not the other sprint's.
- Requesting the other sprint by name returns that sprint's id and its own
  totals.
- The CLI table header names the resolved sprint id, and `--format json`
  agrees with the table on `initialTotal`.
- A name matching two sprints exits non-zero with an ambiguity message
  listing candidate ids.

**Given** sprints `Alpha` (5 days) and `Beta` (10 days), each holding one
incomplete task, **when** the burndown for `Alpha` is requested, **then**
`sprintId` is Alpha's, `series.length` is 5, and `initialTotal` is 1.

### SPR-C2 · major · P1 · CLI MCP
**Board reorder stays within its column and records the move.**
`packages/core/src/rank/reorder.ts:190-196` builds `peers` from *all* ranked
tasks with no status filter — contradicting its own documentation in three
places — and calls `writeTask` with no `appendHistory`, so a reordered task
leaves no audit trail. The rebalance path additionally rewrites
`updated_at` across every ranked task in the tracker.

- Reordering a `todo` task never takes a rank derived from a `doing` task.
- Passing an anchor in a different status returns an error naming the
  status mismatch, rather than silently assigning a cross-column rank.
- The moved task's activity shows the rank change and its `updated_at`
  advanced.
- Tasks in other columns show neither a history entry nor an `updated_at`
  change.
- MCP's returned `{rank, rebalanced}` shape is stable across rebalancing
  and non-rebalancing calls.

**Given** `T-1`, `T-2` in status `doing` and `T-3` in `todo`, **when** `T-3`
is reordered after `T-1`, **then** the call fails on the status mismatch —
and where a legitimate same-column move occurs, `T-3`'s activity records it
while `T-2`'s `updated_at` is unchanged.

### SPR-C3 · major · P10 · CLI MCP
**Sprint archive is reachable, and `id` survives every edit.**
Labels and sprints have no web archive route *and no path to one* —
`editSprint` does not accept an `archived` parameter at all. Milestones work
only because `editMilestone` uniquely does.

- Archiving and unarchiving a sprint round-trips the flag on both
  surfaces.
- The sprint's `id` is unchanged by any edit, so renaming never detaches
  its tasks (verified correct today — this is a regression lock).
- Tasks reference sprints by **id**, never by name, on every write path.
- No automatic state transition or carryover occurs: a sprint's `state`
  and its dates may freely disagree.

**Given** a sprint holding three tasks, **when** it is renamed and then
archived and unarchived, **then** its id never changes and all three tasks
remain attached throughout.
