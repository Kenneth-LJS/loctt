import type { BulkResponse, TaskFrontmatterPublic } from "@loctt/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "../client.ts";

/**
 * Single-task writes issued from the detail page's More menu.
 *
 * These are deliberately separate from `useBulk`: the bulk endpoints
 * answer 200 with a `succeeded`/`failed` split, so a failure there is
 * a field in a successful response. The per-task endpoints answer a
 * real 4xx/5xx, which is what TSK-50 and TSK-52 rest on — "the task
 * was **not** deleted and why" needs the error envelope, and a bulk
 * response would hand back a 200 the mutation would call success.
 *
 * Every one invalidates both the task itself and the list feed. TSK-23
 * requires the archived badge to appear without a reload and the row
 * to leave the default list; TSK-22 requires the deleted task to be
 * gone from the list, not merely hidden.
 */
function useInvalidateTask(): (ref: string) => void {
  const qc = useQueryClient();
  return (ref: string) => {
    void qc.invalidateQueries({ queryKey: ["task", ref] });
    void qc.invalidateQueries({ queryKey: ["tasks-feed"] });
    void qc.invalidateQueries({ queryKey: ["tasks"] });
    // The sidebar's Recently viewed group reads `/api/recents`, and a
    // deleted task must not linger there as a permanently-404ing row
    // (XS-58, ERR-7). The server drops dead entries on read, so an
    // invalidate is all this needs.
    void qc.invalidateQueries({ queryKey: ["recents"] });
    void qc.invalidateQueries({ queryKey: ["builtin-count"] });
  };
}

/**
 * Archive / unarchive one task.
 *
 * `POST /api/tasks/:ref/archive` returns the updated public
 * frontmatter, so a success carries the new `archived` flag rather
 * than requiring the caller to guess. TSK-52 turns on the failure
 * path: on a rejected write nothing is invalidated as archived, so the
 * badge cannot appear and the menu still offers Archive.
 */
export function useArchiveTask(ref: string) {
  const invalidate = useInvalidateTask();
  return useMutation<TaskFrontmatterPublic, Error, { archive: boolean }>({
    mutationFn: vars =>
      apiClient.post<TaskFrontmatterPublic>(
        `/api/tasks/${encodeURIComponent(ref)}/${vars.archive ? "archive" : "unarchive"}`,
        {},
      ),
    onSuccess: () => { invalidate(ref); },
  });
}

/**
 * Delete one task, permanently.
 *
 * `?confirm=true` is required by the server independently of the
 * dialog, so a replayed or hand-made request cannot delete. The typed
 * key in the dialog is the *user's* confirmation; this flag is the
 * API's, and they are not the same check.
 */
export function useDeleteTask(ref: string) {
  const invalidate = useInvalidateTask();
  return useMutation<{ deleted: string }, Error, void>({
    mutationFn: () =>
      apiClient.delete<{ deleted: string }>(
        `/api/tasks/${encodeURIComponent(ref)}?confirm=true`,
      ),
    onSuccess: () => { invalidate(ref); },
  });
}

/**
 * Moves one task to another project.
 *
 * There is no single-task move endpoint; `/api/tasks/bulk/move` is the
 * only one the server exposes, so this sends a one-element batch. That
 * means a failure arrives as `failed[0].error` inside a 200 rather
 * than as an error envelope — the caller has to inspect the response,
 * which is why this hook rejects on a failed element rather than
 * leaving every call site to remember.
 *
 * A move can rekey the task (`moved[].new_key`), which the caller
 * needs in order to navigate to the URL the task now lives at.
 */
export function useMoveTask(ref: string) {
  const invalidate = useInvalidateTask();
  return useMutation<
    { readonly newKey: string | undefined },
    Error,
    { project: string }
  >({
    mutationFn: async vars => {
      const result = await apiClient.post<BulkResponse>("/api/tasks/bulk/move", {
        refs: [ref],
        project: vars.project,
      });
      const failure = result.failed[0];
      if (failure !== undefined) {
        throw new Error(`The task was not moved: ${failure.error}`);
      }
      return { newKey: result.moved?.[0]?.new_key };
    },
    onSuccess: () => { invalidate(ref); },
  });
}
