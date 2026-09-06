import type { SprintDef } from "@loctt/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { Progress } from "../../milestones/model.ts";
import type { BurndownSeriesDto } from "../../sprints/burndownModel.ts";
import { apiClient } from "../client.ts";

/** Server `MAX_PAGE_LIMIT`; matches the other config-list hooks. */
const SPRINTS_PROGRESS_PAGE_LIMIT = 1000;

/** A sprint as the list endpoint returns it with `?progress=true`. */
export interface SprintWithProgress extends SprintDef {
  readonly progress?: Progress;
}

interface SprintsProgressPage {
  readonly items: readonly SprintWithProgress[];
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
  /**
   * Task files that exist but could not be read (K28 / P-5).
   *
   * The server puts this top-level on `/api/sprints?progress=true`
   * (`server.ts` `handleListSprints`), present only when non-empty:
   * an unreadable task cannot be attributed to a sprint (its `sprint`
   * field is exactly what failed to parse), so it is reported beside
   * the totals rather than dropped from them. Same shape as
   * `useTasks.ts`'s `unreadable`.
   */
  readonly unreadable?: readonly {
    readonly id: string;
    readonly path: string;
    readonly reason: string;
  }[];
}

/**
 * The sprints list **with** progress — `?progress=true`.
 *
 * The exact mirror of `useMilestonesWithProgress` (F1 parity, K30):
 * sprint progress lived only on the web *server* with no client
 * consumer, so the "all three surfaces" claim was over-broad. This is
 * that consumer. Kept a separate query key from `useSprints` (the
 * sidebar read) because computing progress scans every task on disk,
 * a cost the sidebar must not pay on every page load. The key carries
 * `"workflow"` because progress is computed from status *categories*
 * in `workflow.yaml`, so a settings edit must drop this cache entry —
 * `invalidateWorkflowConsumers` invalidates by the `["workflow"]`
 * prefix, matching the milestones hook.
 */
export function useSprintsWithProgress() {
  return useQuery({
    queryKey: ["workflow", "sprints-progress"],
    queryFn: ({ signal }) =>
      apiClient.get<SprintsProgressPage>(
        `/api/sprints?progress=true&limit=${String(SPRINTS_PROGRESS_PAGE_LIMIT)}`,
        { signal },
      ),
  });
}

/**
 * Reads and writes for the sprint detail route (M4.7).
 *
 * The burndown is a *separate* query from the sprint list on purpose:
 * it is far more expensive (it replays every task's history) and it
 * has its own failure mode. Folding it into `["sprints"]` would make a
 * burndown failure blank the metadata header and the picker in the
 * sidebar, which SPR-34 rules out — the rest of the page must keep
 * rendering and stay editable.
 */

/** `GET /api/sprints/:id/burndown`. */
export function useBurndown(sprintId: string | undefined) {
  return useQuery({
    queryKey: ["burndown", sprintId],
    queryFn: ({ signal }) =>
      apiClient.get<BurndownSeriesDto>(
        `/api/sprints/${encodeURIComponent(sprintId ?? "")}/burndown`,
        { signal },
      ),
    enabled: sprintId !== undefined && sprintId !== "",
    // A 404 here means the sprint id is unknown, which retrying cannot
    // fix. Retrying it also delays SPR-34's error by the backoff.
    retry: false,
  });
}

/** The subset of `SprintDef` the detail header can edit. */
export interface SprintMetaPatch {
  readonly name?: string;
  readonly start_date?: string;
  readonly end_date?: string;
  readonly state?: "active" | "completed" | "future";
  readonly goal?: string | null;
}

/**
 * `PUT /api/sprints/:id` — one field at a time, as the header edits it.
 *
 * Deliberately **not** optimistic. SPR-37 requires that a failed save
 * never leaves the attempted value on screen looking saved, and
 * SPR-33 requires the previous valid value to still be what is on
 * disk. An optimistic write shows the new value first and would have
 * to reason about rolling back a field the user may have kept typing
 * into; awaiting the server and re-reading is both simpler and the
 * only version that cannot lie.
 *
 * The server applies a read-modify-write (`editSprint`), so sending
 * only the changed field is what makes SPR-28 hold: a `goal` set from
 * the CLI while this page was open is not in this request and is
 * therefore not overwritten by it.
 */
export function useUpdateSprintMeta() {
  const qc = useQueryClient();
  return useMutation<SprintDef, Error, { id: string; patch: SprintMetaPatch }>({
    mutationFn: ({ id, patch }) =>
      apiClient.put<SprintDef>(`/api/sprints/${encodeURIComponent(id)}`, patch),
    onSuccess: updated => {
      // The list is what the header, the overview columns and every
      // sprint picker read. Invalidating it is what makes SPR-8's
      // "changing state re-collapses that column on the overview"
      // true without a reload.
      void qc.invalidateQueries({ queryKey: ["sprints"] });
      // Dates change the burndown's window; state and name do not, but
      // one key for the pair is cheaper than reasoning about which.
      void qc.invalidateQueries({ queryKey: ["burndown", updated.id] });
    },
  });
}

/**
 * The detail route resolves its `$key` against `useSprints` (the
 * shared `["sprints"]` query) rather than a per-sprint endpoint.
 *
 * That list returns archived sprints too, which is what keeps an
 * archived sprint's detail page reachable by URL (SPR-26) while the
 * overview still filters them out of its columns. Reusing the one
 * query also means a metadata save invalidating `["sprints"]` updates
 * the header, the overview and every picker from a single write.
 */
