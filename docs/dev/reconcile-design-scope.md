# Reconcile: what exists, what the 18 conflict cases need

**Scoped 2026-09-04 to make the reconcile batch buildable and to put
its one design decision to Ken concretely rather than vaguely.**

## What already exists (do not rebuild)

- **Three-way file classification.** `git/three-way.ts` computes a
  `SyncPlan` with `copies/keeps/deletes/conflicts`, each a `PathPlan`
  with `disposition: "conflict"`. This is FILE-level.
- **Field-level merge.** `git/merge.ts` `mergeTask` already unions
  relationships and `fields` by key (GIT-5's exact semantics — different
  keys merge, and it returns the losing body). `mergeComments`,
  `mergeHistory`, `deriveKeyState`, `assignProvisionalPrefixes/Slugs`
  handle the config/comment/key merges.
- **Reconcile sentinel.** `state/reconcile.ts` + `ReconcileStateSchema`
  ({mode, base_commit, remote_commit, started_at}) — enough to know a
  reconcile is IN PROGRESS and to block publish/sync (the panel already
  shows `git-reconcile-blocked` off this).

## What is MISSING (the actual work)

1. **A conflict-DETAIL model.** Nothing anywhere carries: which task,
   which field, the local value, the remote value, whether the field is
   enum-typed (GIT-11), and drift markers for a value referencing a
   deleted status/label (GIT-14). `GitConflictError` carries only file
   PATHS. This is a new contracts type, computed in core, consumed by
   all three surfaces.
2. **Conflict COMPUTATION.** `mergeTask` RESOLVES (last-write-wins +
   losing body); the conflict cases need it to also REPORT the
   per-field split: same-key-different-value → conflict (GIT-11),
   different-key → merge (GIT-5), identical-both-sides → auto-resolve
   silently (GIT-17). The classification logic is 90% there in
   `mergeTask`; it needs a reporting variant.
3. **Resolution write-back.** Apply the user's per-field picks and
   complete the sync — `reconcile.yaml` cleared on success, recovery on
   crash.
4. **The panel.** GitSyncPanel has the blocked-state stub; the actual
   per-row conflict UI (both values, pick-value with enum options,
   drift warnings) is unbuilt.

## The ONE decision for Ken (the goal flagged the UX)

How is a resolved conflict WRITTEN — and what does "pick a value" mean
for the awkward cases?

- **Enum field whose remote value references a deleted local status**
  (GIT-14): keep-remote is allowed but the task then renders with a
  drift marker and shows in Diagnostics. Is that the right call, or
  should keep-remote be refused until the status is re-added? (The case
  says allowed-with-warning; confirm.)
- **Granularity**: per-field resolution (the case implies a row per
  conflicting field) vs per-task (pick a whole side). The cases read
  as per-field. Confirm.
- **The merge rule for non-conflicting fields during a reconcile** is
  already settled by `mergeTask` (union) — no decision needed there.

These are small and mostly confirm what the cases already state; the
build can proceed on the cases' stated behaviour and flag only a
genuine ambiguity. Recorded here so the reconcile batch starts from
scope, not discovery.

## Additional case specifics (GIT-12, GIT-13) for the reconcile batch

- **GIT-12 (bulk, 30 tasks)**: rows grouped by task with per-task
  collapse (not a flat 90-row list); "keep all local" / "keep all
  remote" bulk actions that still leave each row individually
  re-overridable before Apply; an accurate undecided-count that updates
  live; and Apply reporting the TRUE outcome — "28 of 30 written, these
  2 failed", never 30 successes when 28 landed. That last part is the
  same honest-partial-result discipline as PRU-34 / MSL-33.
- **GIT-13 (parent conflicts)**: both sides render as task key + title
  (ULID available, not primary); pick-value is a task picker, not a
  free-text ULID box; and — the subtle one — choosing keep-remote must
  fix the INVERSE edge: the losing parent's `child` edge is removed, not
  left dangling. So resolution write-back is not just "set the field";
  a relationship resolution must maintain the inverse per P-12. Reuse
  the existing relationship-write path (`link`/`unlink` or `move.ts`)
  rather than hand-writing frontmatter.

**The single decision to escalate if genuinely unsettled** (per the
scope above, the cases mostly answer it): GIT-14's keep-remote on a
value that references a deleted local status — the case says allowed
WITH a drift warning + Diagnostics visibility. Build to that; only
escalate if a NEW principle is required, not mere uncertainty.
