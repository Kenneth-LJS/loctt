import type {
  CalendarConfig,
  PutWorkflowRequest,
  WorkflowConfig,
  WorkflowUsageResponse,
} from "@loctt/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "../client.ts";
import { invalidateIntegrity } from "./invalidateIntegrity.ts";

/**
 * Workflow + calendar writes for the M4.2 settings panels.
 *
 * Every one of these is a whole-document PUT through the routes that
 * already existed — `PUT /api/workflow` (core `applyWorkflowEdit`) and
 * `PUT /api/calendar` (core `saveCalendarConfig`). There is deliberately
 * no second write path and no per-field endpoint: `applyWorkflowEdit`
 * is what enforces remap-on-delete and the custom-field type guard, and
 * a narrower endpoint would be a way around both.
 *
 * None are optimistic. A workflow edit can rewrite task frontmatter
 * (the remap pass), so a rolled-back optimistic view would be a lie
 * about what is on disk — the same reasoning as the project mutations.
 */

/**
 * Reference counts per workflow key, plus `workflow.yaml`'s absolute
 * path (SET-3, SET-17, SET-19).
 *
 * Separate query from `useWorkflow` on purpose: this one walks every
 * task on disk, and the config itself is read on nearly every render.
 */
export function useWorkflowUsage() {
  return useQuery({
    queryKey: ["workflow-usage"],
    queryFn: ({ signal }) =>
      apiClient.get<WorkflowUsageResponse>("/api/workflow/usage", { signal }),
  });
}

/**
 * Everything downstream of a workflow change. Statuses and priorities
 * are rendered as labels on every task row and every board column, so
 * a panel edit that did not invalidate these would leave the rest of
 * the app showing the old vocabulary until a reload — which is exactly
 * the "survives a refetch but not a refresh" failure SET-6 guards.
 */
function invalidateWorkflowConsumers(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ["workflow"] });
  void qc.invalidateQueries({ queryKey: ["workflow-usage"] });
  void qc.invalidateQueries({ queryKey: ["config"] });
  // The remap pass rewrites task frontmatter; a stale task cache would
  // show the pre-remap status.
  void qc.invalidateQueries({ queryKey: ["tasks"] });
  void qc.invalidateQueries({ queryKey: ["task"] });
  // DEG-31: a workflow edit can repair a broken sub-list entry (a
  // malformed status/priority/…), which changes the config integrity count.
  invalidateIntegrity(qc);
}

export interface SaveWorkflowResult {
  readonly rewrittenTaskCount: number;
}

/**
 * SET-28: a panel must not save a stale copy over a file that changed
 * underneath it.
 *
 * `PUT /api/workflow` takes the **whole document**, so a panel that
 * edits one collection is implicitly re-asserting every other one from
 * the copy it fetched. Measured before this existed: with the Statuses
 * panel open, adding a status to `workflow.yaml` by hand and then
 * dragging a row deleted the hand-added status — no error, no warning,
 * the panel's stale `statuses` array simply won.
 *
 * SET-28 allows either of two answers: re-read before writing, or
 * detect the change and say so. This is the first. The mutation
 * re-fetches the document immediately before the PUT and applies the
 * panel's edit to **that** copy, so the only thing the write can
 * clobber is the collection the user was actually editing — and even
 * there, a concurrent edit to the same collection is reported rather
 * than merged, because there is no way to merge two orderings.
 *
 * `applyWorkflowEdit` already holds the state lock for the duration of
 * the write, so the window between this read and that write is the
 * request round-trip, not the whole time the panel was open.
 */
export interface CollectionEdit<K extends keyof WorkflowConfig> {
  readonly collection: K;
  /** Produces the new collection from the freshly-read document. */
  readonly apply: (fresh: WorkflowConfig) => WorkflowConfig[K];
  readonly remap?: PutWorkflowRequest["remap"];
}

export class ConcurrentWorkflowEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConcurrentWorkflowEditError";
  }
}

/**
 * Identifies every workflow-collection save, so a control that does not
 * own the mutation (a panel header's "New …" button, A329) can still tell
 * a save is in flight via `useIsMutating`.
 */
export const WORKFLOW_SAVE_KEY = ["workflow", "save"] as const;

export function useSaveWorkflowCollection<K extends keyof WorkflowConfig>() {
  const qc = useQueryClient();
  return useMutation<SaveWorkflowResult, Error, CollectionEdit<K>>({
    mutationKey: WORKFLOW_SAVE_KEY,
    mutationFn: async edit => {
      // The re-read. Straight through the client rather than the query
      // cache, which is exactly the stale copy this exists to avoid.
      const fresh = await apiClient.get<WorkflowConfig>("/api/workflow");
      const next: WorkflowConfig = { ...fresh, [edit.collection]: edit.apply(fresh) };
      return apiClient.put<SaveWorkflowResult>("/api/workflow", {
        workflow: next,
        ...(edit.remap !== undefined ? { remap: edit.remap } : {}),
      });
    },
    onSuccess: () => { invalidateWorkflowConsumers(qc); },
    onError: () => { invalidateWorkflowConsumers(qc); },
  });
}

export function useSaveCalendar() {
  const qc = useQueryClient();
  return useMutation<CalendarConfig, Error, CalendarConfig>({
    mutationFn: body => apiClient.put<CalendarConfig>("/api/calendar", body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["calendar"] });
      // Date rendering and "due this week" both read the calendar
      // (XS-31), so the task caches go with it.
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      // DEG-31: a calendar save can repair a broken holiday entry or a
      // bad timezone, both of which the integrity count includes.
      invalidateIntegrity(qc);
    },
  });
}
