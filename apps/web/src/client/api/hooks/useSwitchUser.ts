import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "../client.ts";

/**
 * Switches the active user via `POST /api/user/switch`. On success we
 * invalidate every query whose result depends on "who is current" —
 * the current-user query itself, the user list (its `current` marker),
 * recents (per-user), and the built-in filter counts ("Assigned to me"
 * / "Reported by me" change identity). The broad invalidation is cheap
 * here: these are all small local reads.
 */
export function useSwitchUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ref: string) =>
      apiClient.post<{ current: string }>("/api/user/switch", { ref }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["user", "current"] });
      void qc.invalidateQueries({ queryKey: ["users"] });
      void qc.invalidateQueries({ queryKey: ["recents"] });
      void qc.invalidateQueries({ queryKey: ["builtin-count"] });
    },
  });
}
