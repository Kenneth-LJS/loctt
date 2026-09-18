import type { TaskFrontmatterPublic } from "@loctt/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "../client.ts";
import { invalidateIntegrity } from "./invalidateIntegrity.ts";

/**
 * The meta panel's write verb (M2.2a).
 *
 * **`POST /api/tasks/:ref/set` and `POST /api/tasks/:ref/unset`.** There
 * is no PATCH or PUT on `/api/tasks/:ref` — only GET and DELETE. Every
 * inline editor in the panel funnels through here so the optimistic
 * bookkeeping lives in one place rather than once per control.
 *
 * ## Why set and unset are one mutation
 *
 * TSK-42 requires clearing an optional field to *remove the key* rather
 * than store `""` or `null`. Those are two endpoints server-side, but
 * one action to the user ("clear the assignee") and one optimistic
 * update to the cache. Splitting them into two hooks made every call
 * site branch on `value === undefined`, and one of them would have
 * forgotten.
 *
 * ## Optimistic, and last-write-wins per field
 *
 * TSK-13 wants the panel to move before the network settles; TSK-37
 * wants three rapid clicks on the same field to settle on the third,
 * with an earlier response arriving late unable to repaint the panel
 * with a superseded value.
 *
 * React Query's default `onSuccess` → write-response-into-cache does
 * exactly the wrong thing there: response #1 can land after response
 * #3 and would overwrite the newer frontmatter with the older one. So
 * this hook does **not** seed the cache from any response. Instead:
 *
 *  - `onMutate` cancels in-flight refetches for this task, snapshots
 *    the cache, and applies the change locally.
 *  - `onError` rolls back to the snapshot.
 *  - `onSettled` invalidates — but only once the *last* mutation of
 *    this task has settled.
 *
 * That last condition is what TSK-37 turns on. `isMutating` counts
 * this hook's mutations by their shared mutation key; while another is
 * still in flight, an invalidate would refetch a server state that the
 * newer write has not reached yet and repaint the panel with the
 * superseded value. Waiting for the count to drop to one (this one,
 * still settling) means exactly one refetch happens, after the last
 * write, and it agrees with the file.
 *
 * ## The response is still used for one thing
 *
 * `completed_date` (TSK-5) and `updated_at` (TSK-13) are stamped by the
 * server, not by the caller — a status change into a `completed`
 * category status sets a date the client cannot compute (it depends on
 * the workspace timezone in `calendar.yaml`). Those cannot be applied
 * optimistically and arrive on the refetch above.
 */

/**
 * How long one field write may hang before the UI stops claiming to
 * know (ERR-4).
 *
 * Without a deadline a request that leaves and is never answered
 * leaves the panel spinning forever — the user cannot act, and the one
 * thing that would tell them (a reload) is the thing they are not
 * being offered. `useBulk` already carries this for the bulk verbs;
 * a single field write had none, so ERR-4's case was unreachable in
 * the meta panel.
 *
 * Shorter than the bulk deadline on purpose: a bulk write may be
 * grinding through 5,000 tasks, while one `setField` rewrites one
 * file. Fifteen seconds is far past any honest local write.
 *
 * Overridable from the page so a spec can exercise the deadline
 * without waiting it out. Playwright's clock control does not reach
 * the platform timer this runs on.
 */
const SET_FIELD_TIMEOUT_MS = Number(
  (globalThis as { __LOCTT_SET_FIELD_TIMEOUT_MS__?: unknown })
    .__LOCTT_SET_FIELD_TIMEOUT_MS__ ?? 15_000,
);

/** One field write. `value: undefined` means unset, not "set to null". */
export interface SetFieldVars {
  readonly field: string;
  readonly value?: unknown;
}

interface Context {
  readonly previous: unknown;
}

/**
 * @param ref the key/id the tab navigated by — the URL ref, used for the
 *   endpoint and the cache key.
 * @param expectedId the stable ULID the tab fetched for this task. Sent as
 *   the write's `expectedId` precondition (GIT-19): the server refuses,
 *   writing nothing, if `ref` now resolves to a *different* task — the
 *   wrong-task write a background rekey would otherwise cause. Passing the
 *   id the client already holds is what keeps every edit targeted at the
 *   task the user is looking at, without turning `ref` itself into an id
 *   (which would break retired-key resolution the read path relies on).
 */
export function useSetField(ref: string, expectedId?: string) {
  const qc = useQueryClient();
  const queryKey = ["task", ref];

  return useMutation<TaskFrontmatterPublic, Error, SetFieldVars, Context>({
    // Shared across every call for this task so `isMutating` below can
    // count siblings. Per-field would let two fields' writes each
    // invalidate while the other is in flight.
    mutationKey: ["set-field", ref],
    mutationFn: vars =>
      vars.value === undefined
        ? apiClient.post<TaskFrontmatterPublic>(
            `/api/tasks/${encodeURIComponent(ref)}/unset`,
            { field: vars.field, ...(expectedId !== undefined ? { expectedId } : {}) },
            { timeoutMs: SET_FIELD_TIMEOUT_MS },
          )
        : apiClient.post<TaskFrontmatterPublic>(
            `/api/tasks/${encodeURIComponent(ref)}/set`,
            { field: vars.field, value: vars.value, ...(expectedId !== undefined ? { expectedId } : {}) },
            { timeoutMs: SET_FIELD_TIMEOUT_MS },
          ),

    onMutate: async vars => {
      // Without this an in-flight GET can land after the optimistic
      // write and undo it — the flicker TSK-13 forbids, arriving from
      // a refetch nobody asked for.
      await qc.cancelQueries({ queryKey });
      const previous = qc.getQueryData(queryKey);
      qc.setQueryData(queryKey, (old: unknown) => applyLocally(old, vars));
      return { previous };
    },

    onError: (_err, _vars, context) => {
      // The panel must not keep showing a value the file never took
      // (P1: optimistic state must not survive as though saved).
      if (context !== undefined) qc.setQueryData(queryKey, context.previous);
    },

    onSettled: () => {
      // `isMutating` includes the one that is settling right now, so
      // 1 means "this is the last". See the TSK-37 note above.
      if (qc.isMutating({ mutationKey: ["set-field", ref] }) > 1) return;
      void qc.invalidateQueries({ queryKey });
      void qc.invalidateQueries({ queryKey: ["tasks-feed"] });
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      // DEG-31: a field edit can repair a corrupt value, so the badge
      // must move with the list.
      invalidateIntegrity(qc);
      // VUE-30: "Assigned to me" and "Overdue" are membership counts a
      // field edit can change, and the case requires them to move
      // without a page reload.
      void qc.invalidateQueries({ queryKey: ["builtin-count"] });
    },
  });
}

/**
 * The optimistic edit, applied to the cached `TaskResponse`.
 *
 * Only the field named is touched. XS-54 rests on that: two tabs
 * editing different fields must not clobber each other, and a client
 * that PUT the whole frontmatter would make that impossible no matter
 * how the server behaved. The request sends one field; so does this.
 *
 * Unknown top-level keys are untouched here because they are not in
 * the cached response to begin with — the server projects them out
 * (`projectTaskFrontmatter`) while `passthrough` keeps them on disk.
 * That is what makes TSK-32 hold without any client-side care.
 */
function applyLocally(old: unknown, vars: SetFieldVars): unknown {
  if (old === null || typeof old !== "object") return old;
  const response = old as { frontmatter?: Record<string, unknown> };
  const fm = response.frontmatter;
  if (fm === undefined) return old;

  const builtin = BUILTIN_OPTIONAL_FIELDS.has(vars.field);
  const next: Record<string, unknown> = { ...fm };

  if (builtin) {
    if (vars.value === undefined) delete next[vars.field];
    else next[vars.field] = vars.value;
  } else {
    const fields = { ...((fm["fields"] as Record<string, unknown> | undefined) ?? {}) };
    if (vars.value === undefined) delete fields[vars.field];
    else fields[vars.field] = vars.value;
    next["fields"] = Object.keys(fields).length > 0 ? fields : undefined;
  }

  return { ...response, frontmatter: next };
}

/**
 * Mirrors core's `BUILTIN_OPTIONAL_FIELDS` (`task/update.ts`) — the
 * fields `setField` writes at the top level rather than under
 * `fields:`. Anything else is a custom field.
 *
 * Duplicated rather than imported because `@loctt/core` is a Node
 * package: it reads the filesystem, and pulling it into the browser
 * bundle to read one constant would drag `node:fs` in with it. The
 * risk of drift is real but bounded — a field added to core's set and
 * not to this one would render optimistically under `fields:` and then
 * correct itself on the settling refetch, which is a flicker rather
 * than a wrong write. The write itself names only the field, and the
 * *server* decides where it lands.
 */
const BUILTIN_OPTIONAL_FIELDS: ReadonlySet<string> = new Set([
  "status",
  "task_type",
  "priority",
  "labels",
  "assignee",
  "reporter",
  "start_date",
  "due_date",
  "estimate",
  "milestone",
  "sprint",
  "title",
]);
