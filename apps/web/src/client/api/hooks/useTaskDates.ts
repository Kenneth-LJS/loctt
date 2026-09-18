import type { TaskFrontmatterPublic } from "@loctt/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "../client.ts";

/**
 * The timeline drag's write verb (M3.3b — TML-9, TML-10, TML-11).
 *
 * ## One request, one or both dates
 *
 * Every bar drag calls `POST /api/tasks/:ref/set-dates`, which writes
 * its change set through core's `setFields` under a single state lock.
 * The three drags produce the three payload shapes, and the *shape is
 * the assertion* in each case:
 *
 *  - right edge → `{ due_date }`. TML-9: "exactly one field is
 *    written: `due_date`. `start_date` is **not included in the
 *    payload**."
 *  - left edge  → `{ start_date }`. TML-10: "only `start_date` is
 *    written; `due_date` is untouched."
 *  - body       → `{ start_date, due_date }`. TML-11: "both ... are
 *    sent in a **single** atomic multi-field write, not two sequential
 *    calls."
 *
 * The body drag is why this exists at all. Routed through `/set` it
 * would be two requests, and a failure between them leaves a task
 * whose start is after its due — TML-18's anomaly, manufactured by the
 * write path meant to prevent it, and the exact half-applied shift
 * TML-43 is written to catch.
 *
 * ## Why nothing optimistic is written to the cache
 *
 * The bar's live position during a drag comes from the drag hook's own
 * state, and the cache is only invalidated once the write settles. An
 * optimistic cache write would survive a *failed* request until the
 * refetch overwrote it, leaving the bar rendered at the new dates
 * while the file holds the old ones — which TML-42 ("it is not left
 * rendered at the new width while the file still holds the old date"),
 * TML-44 ("never rendered as a settled new position while the server
 * holds the old one") and P1 each forbid. `useBoardMove` declines the
 * same shortcut for the same reason.
 */

/**
 * How long a drop may hang before the UI stops claiming to know.
 *
 * TML-44 kills the server between release and response and requires a
 * stated outcome rather than a bar frozen mid-move. Matches the board
 * move's deadline; a date write rewrites one file.
 *
 * Overridable from the page so a spec can exercise the deadline
 * without waiting it out — Playwright's clock control does not reach
 * the abort timer.
 */
const SET_DATES_TIMEOUT_MS = Number(
  (globalThis as { __LOCTT_SET_DATES_TIMEOUT_MS__?: unknown })
    .__LOCTT_SET_DATES_TIMEOUT_MS__ ?? 15_000,
);

export interface SetDatesVars {
  /** Task key or id, as the URL segment. */
  readonly ref: string;
  /** Omitted entirely for a right-edge drag. */
  readonly start_date?: string;
  /** Omitted entirely for a left-edge drag. */
  readonly due_date?: string;
}

export function useTaskDates() {
  const qc = useQueryClient();

  return useMutation<TaskFrontmatterPublic, Error, SetDatesVars>({
    mutationKey: ["set-dates"],
    mutationFn: vars => {
      // Built key by key rather than by spreading `vars` minus `ref`,
      // so an absent date is genuinely absent from the JSON. TML-9 and
      // TML-10 both assert on the payload, not only on the result: a
      // body that carried `"start_date": undefined` would serialize
      // away, but one that carried the *current* value would pass a
      // result-only check while clobbering a concurrent CLI edit.
      const body: Record<string, string> = {};
      if (vars.start_date !== undefined) body["start_date"] = vars.start_date;
      if (vars.due_date !== undefined) body["due_date"] = vars.due_date;
      return apiClient.post<TaskFrontmatterPublic>(
        `/api/tasks/${encodeURIComponent(vars.ref)}/set-dates`,
        body,
        { timeoutMs: SET_DATES_TIMEOUT_MS },
      );
    },

    onSettled: () => {
      // The timeline re-reads from the server after every drop, success
      // or failure. On success this replaces the drag's local geometry
      // with the file's; on failure it is what reverts the bar
      // (TML-42, TML-43, TML-44) and clears a row whose task was
      // deleted from another surface (TML-49).
      if (qc.isMutating({ mutationKey: ["set-dates"] }) > 1) return;
      void qc.invalidateQueries({ queryKey: ["tasks-feed"] });
      void qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}
