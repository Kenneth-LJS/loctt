# Phase Z Batch 2 — Cross-component data-flow findings

Read-only review. Traces high-risk paths end to end across component
boundaries (core → contracts → web server wire → client hook →
render), looking for a value transformed wrong, a shape mismatch, an
invariant that holds in one layer and is violated in the next, or an
error swallowed at a seam. A per-component review sees one link; this
follows the chain.

**Result: 1 finding (major). Four of the five traced paths held.**

---

## Finding 1 (MAJOR) — the K28 unreadable count reaches the milestones-web boundary and dies there

**Path.** Path 5 (progress/counts aggregation):
`loadAllTasksDetailed` → `milestoneProgressDetailed` (core) →
`GET /api/milestones?progress=true` (web server) →
`useMilestonesWithProgress` (client hook) → `MilestonesView` (render).

**The exact boundary.** The client hook / view seam:
`apps/web/src/client/api/hooks/useMilestoneProgress.ts:39`
(`useMilestonesWithProgress`) and its consumer
`apps/web/src/client/milestones/MilestonesView.tsx:33`.

**What the earlier layers do (correctly).** Core computes progress from
the *readable* corpus and reports the unreadable tasks separately.
`packages/core/src/task/progress.ts:88-95` states the invariant in a
source comment:

> An **object-fatal** unreadable task … never contributes to any
> milestone's `done` or `total`, so **every milestone total is short by
> however many of its members are unreadable — a wrong number with
> nothing to explain it (P-5)**. We cannot say which milestone an
> unreadable file belonged to (its `milestone` field is what failed to
> read), so `unreadable` names the files a surface must surface
> alongside them.

The web server honours this. `withProgress`
(`apps/web/src/server/server.ts:1914-1941`) returns
`{ items, unreadable }`, and `handleListMilestones`
(`server.ts:2037-2050`) puts it on the wire:

```ts
// K28: tasks that could not be read are named alongside the totals.
...(unreadable.length > 0 ? { unreadable } : {}),
```

Decision K28 (`docs/dev/decisions.md:8381`, **Ken's ruling, an agent
may not revert it**) commits this explicitly:

> web `GET /api/{milestones,sprints}?progress=true` carries
> `unreadable` … reports an unreadable member rather than silently
> shortening the total (K28).

**Where it breaks.** The milestones client hook fetches only the
`items`:

```ts
// useMilestoneProgress.ts:39
export function useMilestonesWithProgress() {
  return useQuery({
    queryKey: ["workflow", "milestones-progress"],
    queryFn: ({ signal }) =>
      apiClient.get<Page<MilestoneWithProgress>>(   // <- top-level `unreadable` is not in this type
        `/api/milestones?progress=true&limit=${PICKER_PAGE_LIMIT}`, { signal }),
  });
}
```

`MilestonesView` then reads `milestones.data?.items ?? []`
(`MilestonesView.tsx:43-46`) and renders each milestone's progress bar
from the (short) `done/total`. The top-level `unreadable` array is
never read; `grep -n "unreadable\|could not be read"` over
`MilestonesView.tsx`, `MilestoneDetail.tsx`, and `ProgressReadout.tsx`
returns **zero hits**.

So a milestone whose member task has unreadable frontmatter renders
`3 / 8` when the truth is `3 / 9`, with nothing on screen to say a task
was dropped — the exact P-5 "wrong number, nothing to explain it" the
core comment and Ken's ruling forbid.

**The asymmetry proves it is a client-layer break, not a missing
engine.** The *sprints* client — the sibling surface reading the
identical wire shape — does render it:

```
apps/web/src/client/sprints/SprintsView.tsx:83   const unreadable = pages[...]?.unreadable ?? [];
apps/web/src/client/sprints/SprintsView.tsx:383   {unreadable.length > 0 && ( <banner data-testid="sprints-unreadable" ...
```

And the other two surfaces of the same core capability honour K28:
CLI `milestone list --progress` warns to stderr
(`apps/cli/src/commands/milestone.ts:59-63`) and MCP `list_milestones`
returns `unreadable` (`apps/mcp/src/tools/milestone.ts:52-55`). The web
milestones client is the **only** one of the three surfaces that drops
it — a "one capability, three surfaces answer alike" divergence
(CLAUDE.md / TEMP-RUN-WORKFLOW § "Which layer") localized to one client
component.

**Concrete failing scenario (test-writable).**
Tracker with milestone `v1` and three tasks assigned to it, all
readable + healthy, plus one further task assigned to `v1` whose
`task.md` has a YAML syntax error (object-fatal, unreadable).

- `GET /api/milestones?progress=true` → 200, body has
  `items[v1].progress = {done:…, total:3, …}` **and** a top-level
  `unreadable: [{ id, path, reason }]` naming the bad file.
- `MilestonesView` renders `v1` as `… / 3` with **no** notice that a
  fourth member could not be read.

A component test rendering `MilestonesView` against a stubbed response
that carries top-level `unreadable` and asserting a visible notice
(e.g. a `milestones-unreadable` region, mirroring
`sprints-unreadable`) is red today and green once the hook surfaces the
field and the view renders it. Mutation check: it should also go red if
`SprintsView`'s existing banner is deleted, confirming it asserts the
same behaviour the sprints surface already has.

**Severity: major.** Silent undercount on a progress surface, against
an explicit non-revertible Ken ruling (K28) and P-5. Not a blocker —
requires an object-fatally-unreadable task file (hand-edit / bad
merge), the readable corpus is still counted honestly, and the CLI/MCP
surfaces are unaffected — but on the web it is exactly the "wrong number
with nothing to explain it" the decision was written to prevent.

**Where the fix belongs.** `useMilestoneProgress.ts` — return the whole
page (or a `{ items, unreadable }` shape) rather than narrowing to
`items`; then render a notice in `MilestonesView` (and, if a single
milestone's detail is expected to carry it, thread it to
`MilestoneDetail`). No core or server change needed — the data is
already on the wire.

---

## Paths traced and found sound

**Path 1 — UI edit → API → core → disk → re-read → UI (field set
round-trip).** Sound. `POST /api/tasks/:ref/set` applies the change
through core `setFields` under one state lock and returns
`projectTaskFrontmatter(updated.frontmatter)` (`server.ts:3205-3212`).
The client (`useSetField`,
`apps/web/src/client/api/hooks/useSetField.ts`) does an optimistic
`setQueryData` in `onMutate` (touching only the named field via
`applyLocally`, never the whole frontmatter — so XS-54/TSK-32 hold),
reverts on error, and `onSettled` invalidates `["task", ref]`, forcing
a refetch that re-reads the file and restores server-stamped fields
(`completed_date`, `updated_at`) and the `health` array. The value
round-trips intact and optimistic state does not survive a failed
write.

*One transient wrinkle, deliberately not raised as a finding.*
`applyLocally` (`useSetField.ts:158-177`) touches only `frontmatter`,
never `response.health`. So while *repairing* a field that currently
carries a whole-field `health` entry (e.g. setting a valid `status`
over a `wrong_type` one), the optimistic cache momentarily holds both
the new healthy value **and** the stale `health` entry, which
`fieldView` (`fieldHealth.ts:59`) would surface as value-plus-⚠ at
once. It self-corrects on the `onSettled` refetch (~one round-trip),
affects only display, and is the documented "flicker rather than a
wrong write" tradeoff (`useSetField.ts` header + BUILTIN_OPTIONAL_FIELDS
note). Below the strict finding bar: transient, self-correcting, no
persisted-state break.

**Path 2 — git publish/sync round-trip (key/prefix identity).** Sound
as far as this review reaches; the just-fixed G1/G2 hold end to end. G1
(`decisions.md` A141) makes publish *refuse* on remote-only divergence
(`GitSyncFirstError` / `sync_needed` 409) rather than silently
auto-merging, and `branchDiffersFromBase` correctly excludes a
locally-deleted base file so a plain local delete still publishes and is
not resurrected — the fix-review catch. Each call is verifier-confirmed
with a mutation-proven regression test that reddens on revert
(`decisions.md:8373`). The rekey/reprefix identity path is separately
documented as traced against two real clones (`known-gaps.md`,
"`rekeyCollisions` skip path"): same-project counter collisions rekey
both sides, cross-project prefixes cannot collide
(`ProjectsConfigSchema.superRefine`), and `state.yaml` counters mirror
via sync. No new boundary break found; did not re-derive G1/G2 per
brief.

**Path 3 — corruption/health: degraded field at parse → wire (drops
`raw`, keeps `rawText`) → client `fieldView` → render.** Sound. Core
lifts a corrupt field off `frontmatter` into `health`
(`FieldHealth` in `packages/contracts/src/task.ts:144`, carrying both
`raw` and its one-line `rawText`). Both web serialization sites — the
list route's `wireHealth` (`server.ts:377-388`) and the detail route's
inline map (`server.ts:3786-3796`) — produce the **same** wire shape,
dropping `raw` and keeping `rawText`, so `raw` never leaks and
attribution (`field`/`kind`/`error`/`rawText`/`repair`) survives. The
client `fieldView`/`isElementOf`
(`apps/web/src/client/health/fieldHealth.ts`) reconstructs a uniform
per-field view-model, and cells (`list/cells.tsx`) render a whole-field
fault as `BrokenValue` (raw text + ⚠) versus an element/extrinsic fault
as `FieldWarning`. The object-fatal path (a YAML syntax error, a bad
id/key) now throws a dedicated, attributed `UnreadableTaskError`
(`packages/core/src/task/lookup.ts:58`) instead of the misleading
`task not found` the old known-gap described — so an unreadable task
reaches the surface as attributed (path + parse line + `recovery:none`),
not a 500 or a blank. Health survives every hop.

**Path 4 — key allocation under concurrency (two creates → lock →
counter → key → index).** Sound; no TOCTOU across the lock boundary.
The web create route wraps the whole read-modify-write in one lock:
`withStateLock(locttDir, async () => { loadState → createTask
(allocateKey mutates in-memory state) → saveState })`
(`server.ts:3640-3651`; duplicate route the same at 4244-4253). The lock
is acquired *before* `loadState` (`state/lock.ts:202`), is a
cross-process `proper-lockfile` advisory lock with a 10s stale timeout,
and carries a post-acquire migration re-check that closes the
pre-check→acquire window (`lock.ts:243-253`) plus an
AsyncLocalStorage re-entrancy guard. Two concurrent creates in the same
tracker serialize on the OS lock; each reads the counter its predecessor
committed, so no two allocations collide. (The advisory-lock caveat on
network/sync filesystems is a known, surfaced limitation — `PRU-43`
message — not a seam break.)
