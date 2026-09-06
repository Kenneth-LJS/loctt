import type { MilestoneDef, TaskFrontmatterPublic } from "@loctt/contracts";
import { useQuery } from "@tanstack/react-query";

import type { MilestoneWithProgress } from "../../milestones/model.ts";
import { apiClient } from "../client.ts";

interface Page<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
  /**
   * Task files that exist but could not be read (K28 / P-5).
   *
   * The server puts this top-level on `/api/milestones?progress=true`
   * (`server.ts` `handleListMilestones`), present only when non-empty:
   * an unreadable task cannot be attributed to a milestone (its
   * `milestone` field is exactly what failed to parse), so it is
   * reported beside the totals rather than dropped from them. Without
   * this field the view showed a short done/total with no explanation
   * — the very silent-undercount K28 forbids. Same shape as
   * `useTasks.ts`'s `unreadable`.
   */
  readonly unreadable?: readonly {
    readonly id: string;
    readonly path: string;
    readonly reason: string;
  }[];
}

/** Server `MAX_PAGE_LIMIT`; matches the other config-list hooks. */
const PICKER_PAGE_LIMIT = 1000;

/**
 * The milestones list **with** progress — `?progress=true`.
 *
 * ## Why this is not `useMilestones()`
 *
 * `useMilestones` is the sidebar's read and is deliberately opt-out of
 * progress: computing it scans every task on disk, and the sidebar
 * renders on every page load without needing a single number. This is
 * a separate query key so the Milestones view can pay that cost
 * without imposing it on every other route.
 *
 * ## MSL-29 — the workflow dependency
 *
 * Progress is computed from status **categories** read out of
 * `workflow.yaml`, so recategorising a status changes every number
 * here without touching a milestone or a task. The query key carries
 * `"workflow"` for exactly that reason: `invalidateWorkflowConsumers`
 * invalidates by the `["workflow"]` prefix, so a settings edit drops
 * this cache entry as a matter of key structure rather than because
 * someone remembered to list it. MSL-29's "no cached progress figure
 * survives the config change" is then true by construction.
 */
export function useMilestonesWithProgress() {
  return useQuery({
    queryKey: ["workflow", "milestones-progress"],
    queryFn: ({ signal }) =>
      apiClient.get<Page<MilestoneWithProgress>>(
        `/api/milestones?progress=true&limit=${String(PICKER_PAGE_LIMIT)}`,
        { signal },
      ),
  });
}

/**
 * Tasks whose `milestone` names an id that `milestones.yaml` does not
 * define (MSL-24).
 *
 * ## Why the client has to do this
 *
 * `referenceProgress` seeds its map with the *requested* ids only and
 * drops every task pointing anywhere else, so a task on a hand-deleted
 * milestone is absent from every milestone's counts and the response
 * carries no counter to render. Measured: with one such task, the
 * milestones response is byte-identical to the response without it.
 * That is MSL-24's named failure mode — "silently vanishing tasks" —
 * and nothing on the wire reports it.
 *
 * So the orphans are found by difference: read the tasks, then keep
 * the ones whose `milestone` is set to an id the fetched list does not
 * contain.
 *
 * **The narrowing is done here, not by the server.** A `milestone !=
 * null` DSL predicate was tried first and does *not* filter: measured
 * on a two-task tracker where only one has a milestone, it returns
 * both, the unset one included with `milestone: null`. So the
 * predicate is not sent — it would imply a narrowing that is not
 * happening — and the `t.milestone !== undefined` guard below is what
 * actually excludes tasks with no milestone. Without that guard every
 * unassigned task would be reported as an orphan.
 *
 * This is a *diagnosis*, not a second progress path — it never feeds a
 * count. The alternative is a server-side orphan counter, which is
 * server work this ticket does not own.
 */
export function useOrphanedMilestoneTasks(
  milestones: readonly MilestoneDef[] | undefined,
) {
  const known = new Set((milestones ?? []).map(m => m.id));
  return useQuery({
    queryKey: ["milestone-orphans"],
    // Only run once the milestone list has answered — otherwise every
    // task would look orphaned against an empty set, which would
    // render a scary banner during a normal load.
    enabled: milestones !== undefined,
    queryFn: async ({ signal }) => {
      const page = await apiClient.get<Page<TaskFrontmatterPublic>>(
        `/api/tasks?limit=${String(PICKER_PAGE_LIMIT)}`,
        { signal },
      );
      const orphans = page.items.filter(
        t => t.milestone !== undefined && !known.has(t.milestone),
      );
      return {
        tasks: orphans,
        /** Distinct dangling ids, so the notice can name them. */
        ids: [...new Set(orphans.flatMap(t => (t.milestone === undefined ? [] : [t.milestone])))],
      };
    },
  });
}
