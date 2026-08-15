import type { BulkResponse } from "@loctt/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { DELETE_CONFIRM_WORD } from "../../list/DeleteConfirmDialog.tsx";
import { apiClient } from "../client.ts";

/**
 * Bulk mutations for the list view.
 *
 * Every one issues a *single* call for the whole selection (BLK-5) —
 * not one request per task. The server returns 200 with
 * `succeeded`/`failed` for partial failure and a 4xx only when the
 * batch never ran, which is the distinction BLK-38/39 rest on, so these
 * hooks deliberately do not collapse the two.
 *
 * All of them invalidate the task feed on settle: rows must show the new
 * values without a page reload, and a partial failure still changed
 * something.
 */
function useInvalidateTasks(): () => void {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["tasks-feed"] });
    void qc.invalidateQueries({ queryKey: ["tasks"] });
  };
}

export function useBulkSet() {
  const invalidate = useInvalidateTasks();
  return useMutation({
    mutationFn: (vars: { refs: readonly string[]; field: string; value: unknown }) =>
      apiClient.post<BulkResponse>("/api/tasks/bulk/set", {
        refs: vars.refs,
        changes: [{ field: vars.field, value: vars.value }],
      }),
    onSettled: invalidate,
  });
}

export function useBulkArchive() {
  const invalidate = useInvalidateTasks();
  return useMutation({
    mutationFn: (vars: { refs: readonly string[]; archive: boolean }) =>
      apiClient.post<BulkResponse>("/api/tasks/bulk/archive", {
        refs: vars.refs,
        archive: vars.archive,
      }),
    onSettled: invalidate,
  });
}

export function useBulkMove() {
  const invalidate = useInvalidateTasks();
  return useMutation({
    mutationFn: (vars: { refs: readonly string[]; project: string }) =>
      apiClient.post<BulkResponse>("/api/tasks/bulk/move", {
        refs: vars.refs,
        project: vars.project,
      }),
    onSettled: invalidate,
  });
}

export function useBulkDelete() {
  const invalidate = useInvalidateTasks();
  return useMutation({
    // The confirmation word travels with the request. The server
    // requires it independently of the dialog, so a replayed or
    // hand-made POST cannot delete (BLK-11).
    mutationFn: (vars: { refs: readonly string[] }) =>
      apiClient.post<BulkResponse>("/api/tasks/bulk/delete", {
        refs: vars.refs,
        confirm: DELETE_CONFIRM_WORD,
      }),
    onSettled: invalidate,
  });
}

/**
 * Turns a bulk response into the sentence the bar shows.
 *
 * Total success, partial failure, and total failure read differently on
 * purpose (BLK-38, BLK-39): "12 tasks deleted" must not appear when
 * three of them did not.
 */
export function describeBulkResult(
  result: BulkResponse,
  verb: string,
): { readonly message: string; readonly failures: readonly string[] } {
  const ok = result.succeeded.length;
  const bad = result.failed.length;
  const noun = (n: number): string => (n === 1 ? "task" : "tasks");

  if (bad === 0) {
    return { message: `${String(ok)} ${noun(ok)} ${verb}`, failures: [] };
  }
  const failures = result.failed.map(f => `${f.taskId}: ${f.error}`);
  if (ok === 0) {
    // Nothing changed — say so plainly rather than reporting zero
    // successes as if it were a partial result.
    return { message: `No tasks ${verb}. ${String(bad)} failed.`, failures };
  }
  return {
    message: `${String(ok)} ${noun(ok)} ${verb}, ${String(bad)} failed`,
    failures,
  };
}
