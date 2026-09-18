import type { TaskFrontmatterPublic } from "@loctt/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "../client.ts";

/**
 * The Relationships panel's three write verbs (M2.5a).
 *
 * ```
 * POST /api/tasks/:ref/link      { type, target }
 * POST /api/tasks/:ref/unlink    { type, target }
 * POST /api/tasks/:ref/relationships/:type/:target/rerank  { before | after }
 * ```
 *
 * ## Nothing here is optimistic
 *
 * The meta panel's `useSetField` renders a field change before the
 * server confirms it, because a status pill snapping back is a
 * cosmetic cost against a real responsiveness gain. A link is
 * different in kind:
 *
 *  - **The server writes two files, and either can fail.** REL-42 is
 *    exactly the case where the forward write lands and the inverse
 *    does not. An optimistic row would draw a link that only half
 *    exists, and the case's second bullet forbids precisely that:
 *    "the panel shows the actual state ... rather than an optimistic
 *    UI showing a link that only half exists".
 *  - **Half the guards are server-side.** Self-link, cycle, archived
 *    target, duplicate and unknown-type are all decided by core with
 *    the tracker lock held. A client that drew the row first would
 *    have to un-draw it on every one of them.
 *
 * So each mutation invalidates on settle and the panel re-renders from
 * the refetched file. The cost is one round-trip of latency on a local
 * server reading two files.
 *
 * The reorder is the one exception, and it is *visual only*: the row
 * follows the pointer during a drag (that is what dragging is), but
 * the committed order comes from the refetch. REL-46 turns on that —
 * "the UI never leaves a position on screen that isn't on disk".
 *
 * ## Both ends are invalidated
 *
 * A link writes the inverse edge on the *target* task, so the target's
 * cached `["task", <target>]` entry is stale the moment this resolves.
 * REL-9's third bullet asks for the other task's panel to show the
 * inverse edge on an already-open tab's refresh, and a stale cache
 * keyed by the target's key would serve the pre-link file for the
 * whole staleness window.
 *
 * The target is invalidated by *key* because that is what its route is
 * keyed by. `["task"]` as a prefix would catch every task, which is
 * both broader than needed and correct — but it would also refetch the
 * page the user is not on for every link in a 50-edge panel, so the
 * two specific keys are named.
 */

export interface LinkVars {
  readonly type: string;
  /** A key, a retired key, or a ULID — the server resolves all three. */
  readonly target: string;
}

export interface RerankVars {
  readonly type: string;
  /** The moved edge's target. */
  readonly target: string;
  /** Place before this target. Mutually exclusive with `after`. */
  readonly before?: string;
  /** Place after this target. Mutually exclusive with `before`. */
  readonly after?: string;
}

/**
 * Invalidates everything a bilateral relationship write can have made
 * stale: this task, the far end, and the surfaces that count or list
 * tasks.
 */
function invalidateBoth(
  qc: ReturnType<typeof useQueryClient>,
  ref: string,
  target: string,
): void {
  void qc.invalidateQueries({ queryKey: ["task", ref] });
  void qc.invalidateQueries({ queryKey: ["task", target] });
  // Both tasks' `updated_at` advanced and both gained a history entry,
  // so the list rows and the activity feed are stale too (REL-9's
  // fourth and fifth bullets are about the file, but the feed is what
  // shows them).
  void qc.invalidateQueries({ queryKey: ["activity", ref] });
  void qc.invalidateQueries({ queryKey: ["activity", target] });
  void qc.invalidateQueries({ queryKey: ["tasks"] });
  void qc.invalidateQueries({ queryKey: ["tasks-feed"] });
}

export function useLinkTask(ref: string) {
  const qc = useQueryClient();
  return useMutation<TaskFrontmatterPublic, Error, LinkVars>({
    mutationKey: ["link", ref],
    mutationFn: vars =>
      apiClient.post<TaskFrontmatterPublic>(
        `/api/tasks/${encodeURIComponent(ref)}/link`,
        { type: vars.type, target: vars.target },
      ),
    onSettled: (_data, _err, vars) => { invalidateBoth(qc, ref, vars.target); },
  });
}

export function useUnlinkTask(ref: string) {
  const qc = useQueryClient();
  return useMutation<TaskFrontmatterPublic, Error, LinkVars>({
    mutationKey: ["unlink", ref],
    mutationFn: vars =>
      apiClient.post<TaskFrontmatterPublic>(
        `/api/tasks/${encodeURIComponent(ref)}/unlink`,
        { type: vars.type, target: vars.target },
      ),
    onSettled: (_data, _err, vars) => { invalidateBoth(qc, ref, vars.target); },
  });
}

/** What `POST .../rerank` answers with. */
export interface RerankResult {
  readonly rank: string;
  readonly rebalanced: boolean;
}

export function useRerankRelationship(ref: string) {
  const qc = useQueryClient();
  return useMutation<RerankResult, Error, RerankVars>({
    mutationKey: ["rerank-relationship", ref],
    mutationFn: vars =>
      apiClient.post<RerankResult>(
        `/api/tasks/${encodeURIComponent(ref)}/relationships/`
        + `${encodeURIComponent(vars.type)}/${encodeURIComponent(vars.target)}/rerank`,
        {
          ...(vars.before !== undefined ? { before: vars.before } : {}),
          ...(vars.after !== undefined ? { after: vars.after } : {}),
        },
      ),
    onSettled: () => {
      // A reorder writes the *source* task only — REL-13's last bullet
      // is explicit that the targets' inverse edges are not re-ranked
      // — so the far end is not invalidated here.
      void qc.invalidateQueries({ queryKey: ["task", ref] });
      void qc.invalidateQueries({ queryKey: ["activity", ref] });
    },
  });
}
