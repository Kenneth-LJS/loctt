import type { SprintDef } from "@loctt/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { BurndownSeriesDto } from "../../sprints/burndownModel.ts";
import { apiClient } from "../client.ts";

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
