import type { LabelDef } from "@loctt/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "../client.ts";

/**
 * Creates a label in `labels.yaml` (TSK-11's inline-creation flow).
 *
 * Not optimistic, deliberately. The caller needs the new label's **id**
 * before it can attach it to the task, and an id is exactly the thing
 * an optimistic update cannot invent — a made-up one would be attached
 * to the task and then never resolve. So this awaits the 201, and the
 * attach is a second write that only happens on success. TSK-55's "no
 * pill is left attached" falls out of that ordering rather than out of
 * cleanup.
 *
 * The invalidate is what makes TSK-11's fourth bullet hold: the new
 * label appears in the list view's Label filter without a reload,
 * because the filter reads the same `["labels"]` query this drops.
 */
export function useCreateLabel() {
  const qc = useQueryClient();
  return useMutation<LabelDef, Error, { name: string; color?: string }>({
    mutationFn: vars => apiClient.post<LabelDef>("/api/labels", vars),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["labels"] });
    },
  });
}
