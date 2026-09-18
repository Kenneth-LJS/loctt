import type { BulkResponse } from "@loctt/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { DELETE_CONFIRM_WORD } from "../../list/DeleteConfirmDialog.tsx";
import { apiClient } from "../client.ts";
import { invalidateIntegrity } from "./invalidateIntegrity.ts";

/**
 * How long a bulk write may hang before the UI stops claiming to know
 * (BLK-41). Generous: a 5,000-task batch is slow but not silent, and
 * cutting off work that is progressing would report "unknown" for
 * something that was about to succeed.
 *
 * Overridable from the page so a spec can exercise the deadline without
 * waiting 30 seconds. Playwright's clock control does not reach
 * `AbortSignal.timeout`, which runs on a platform timer.
 */
const BULK_TIMEOUT_MS = Number(
  (globalThis as { __LOCTT_BULK_TIMEOUT_MS__?: unknown }).__LOCTT_BULK_TIMEOUT_MS__ ?? 30_000,
);

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
    // DEG-31: a bulk set/delete can clear or introduce corrupt values.
    invalidateIntegrity(qc);
  };
}

export function useBulkSet() {
  const invalidate = useInvalidateTasks();
  return useMutation({
    mutationFn: (vars: { refs: readonly string[]; field: string; value: unknown }) =>
      apiClient.post<BulkResponse>("/api/tasks/bulk/set", {
        refs: vars.refs,
        changes: [{ field: vars.field, value: vars.value }],
      }, { timeoutMs: BULK_TIMEOUT_MS }),
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
      }, { timeoutMs: BULK_TIMEOUT_MS }),
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
      }, { timeoutMs: BULK_TIMEOUT_MS }),
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
      }, { timeoutMs: BULK_TIMEOUT_MS }),
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
/** Crockford base32, 26 chars — the shape core's ids take. */
function isUlid(ref: string): boolean {
  return /^[0-9A-HJKMNP-TV-Z]{26}$/.test(ref);
}

export function describeBulkResult(
  result: BulkResponse,
  verb: string,
  /**
   * Turns the id core echoed back into the key the user knows (BLK-22).
   *
   * Core reports failures against the ref it was *given*, and the list
   * sends task ids because that is what the selection holds — so an
   * unresolved failure reads as a bare ULID, which names nothing the
   * user can act on and violates P-4. Falls back to the raw ref when it
   * cannot be resolved, which is better than hiding the failure.
   */
  keyOf?: (taskId: string) => string | undefined,
): { readonly message: string; readonly failures: readonly string[] } {
  const ok = result.succeeded.length;
  const bad = result.failed.length;
  const noun = (n: number): string => (n === 1 ? "task" : "tasks");

  // BLK-9: a move must name the new keys. "4 tasks moved" is unusable —
  // the keys the user knew are gone, and nothing on screen says what
  // replaced them. Tasks already in the destination keep their key
  // (BLK-26) and are reported as unchanged rather than as a rekey.
  const rekeyed = (result.moved ?? []).filter(m => m.old_key !== m.new_key);
  const suffix = rekeyed.length > 0
    ? `: ${rekeyed.map(m => `${m.old_key} → ${m.new_key}`).join(", ")}`
    : "";

  // BLK-27: a task already in the requested state is a success but not
  // a change, and saying "6 tasks archived" when three already were
  // overstates what this call did.
  const noop = result.unchanged?.length ?? 0;
  const changed = ok - noop;
  // "already archived" reads correctly; "already restored" does not —
  // a task that was never archived was not restored earlier, it simply
  // was not archived.
  const noopSuffix = noop > 0
    ? ` · ${String(noop)} ${verb === "restored"
        ? `${noop === 1 ? "was" : "were"} not archived`
        : `already ${verb}`}`
    : "";
  const okText = noop > 0
    ? `${String(changed)} ${noun(changed)} ${verb}${noopSuffix}`
    : `${String(ok)} ${noun(ok)} ${verb}`;

  if (bad === 0) {
    return { message: `${okText}${suffix}`, failures: [] };
  }
  const failures = result.failed.map(f => {
    const key = keyOf?.(f.taskId) ?? (isUlid(f.taskId) ? undefined : f.taskId);
    return `${key ?? "a task no longer listed"}: ${f.error}`;
  });
  if (ok === 0) {
    // Nothing changed — say so plainly rather than reporting zero
    // successes as if it were a partial result.
    return { message: `No tasks ${verb}. ${String(bad)} failed.`, failures };
  }
  // The same count as the clean path: a failure elsewhere in the batch
  // does not turn a no-op back into a change (BLK-27).
  return { message: `${okText}${suffix}, ${String(bad)} failed`, failures };
}
