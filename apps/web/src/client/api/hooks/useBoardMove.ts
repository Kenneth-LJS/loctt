import type { TaskFrontmatterPublic } from "@loctt/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "../client.ts";

/**
 * The board drag's write verb (M3.2).
 *
 * ## One request, both fields
 *
 * A cross-column drop calls `POST /api/tasks/:ref/board-move`, which
 * writes `status` and `board_rank` in a single `setFields` change set
 * (BRD-9, XS-9, CW-5). The two-request shape — set the status, then
 * rerank — is a real defect, not a style preference: a failure between
 * them leaves the card in a column its stored status contradicts, and
 * BRD-41 requires that a failed drop leave *neither* field written.
 *
 * An intra-column reorder calls `POST /api/tasks/:ref/board-rerank`
 * instead, whose payload carries `board_rank` positioning only. XS-9
 * is explicit that `status` must be **absent** there rather than
 * resent at its current value — resending it would clobber a
 * concurrent CLI status change with a value the browser read minutes
 * ago, and would make BRD-12's multi-status column rewrite a `blocked`
 * card to `in_progress` just for being reordered.
 *
 * ## Why no optimistic cache write here
 *
 * The board renders the drag's visual result from local drag state
 * while the pointer is down, and the *cache* is only invalidated once
 * the write settles. Writing optimistically into the tasks feed would
 * survive a failed request until the refetch overwrote it, which is
 * precisely the "browser presenting its own state as fact" that BRD-43
 * and P1 forbid — the card must not sit in the destination column
 * while the file says otherwise.
 */

/**
 * How long a drop may hang before the UI stops claiming to know.
 *
 * BRD-43: killing the server between mouse-up and the response must
 * end in a stated outcome, not a card frozen mid-move. Matches the
 * meta panel's field-write deadline; a board move rewrites one file.
 *
 * Overridable from the page so a spec can exercise the deadline
 * without waiting it out.
 */
const BOARD_MOVE_TIMEOUT_MS = Number(
  (globalThis as { __LOCTT_BOARD_MOVE_TIMEOUT_MS__?: unknown })
    .__LOCTT_BOARD_MOVE_TIMEOUT_MS__ ?? 15_000,
);

export interface BoardMoveVars {
  readonly ref: string;
  /**
   * The destination column's status key, or `undefined` for a reorder
   * inside the card's current column.
   *
   * `undefined` is what makes the request `board-rerank` rather than
   * `board-move`, and is the mechanism behind XS-9's third bullet.
   */
  readonly status?: string;
  /** The card this one lands above, if any. */
  readonly before?: string;
  /** The card this one lands below, if any. */
  readonly after?: string;
}

export function useBoardMove() {
  const qc = useQueryClient();

  return useMutation<TaskFrontmatterPublic | { rank: string }, Error, BoardMoveVars>({
    mutationKey: ["board-move"],
    mutationFn: vars => {
      const ref = encodeURIComponent(vars.ref);
      const position = {
        ...(vars.before !== undefined ? { before: vars.before } : {}),
        ...(vars.after !== undefined ? { after: vars.after } : {}),
      };

      if (vars.status === undefined) {
        // Intra-column: rank only. `status` is not in this payload at
        // all — XS-9 checks for its absence, not for its value.
        return apiClient.post<{ rank: string }>(
          `/api/tasks/${ref}/board-rerank`,
          position,
          { timeoutMs: BOARD_MOVE_TIMEOUT_MS },
        );
      }

      return apiClient.post<TaskFrontmatterPublic>(
        `/api/tasks/${ref}/board-move`,
        { status: vars.status, ...position },
        { timeoutMs: BOARD_MOVE_TIMEOUT_MS },
      );
    },

    onSettled: () => {
      // The board re-reads from the server after every drop, success or
      // failure. On success this replaces the drag's local placement
      // with the file's; on failure it is what snaps the card back
      // (BRD-41, BRD-43) and clears a deleted neighbour (BRD-44).
      if (qc.isMutating({ mutationKey: ["board-move"] }) > 1) return;
      void qc.invalidateQueries({ queryKey: ["tasks-feed"] });
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      void qc.invalidateQueries({ queryKey: ["builtin-count"] });
    },
  });
}
