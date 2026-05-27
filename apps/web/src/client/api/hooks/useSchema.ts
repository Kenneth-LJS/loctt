import type { MigrateResponse } from "@loctt/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiClient, ApiError } from "../client.ts";

/**
 * POST /api/migrate. On success invalidates the info query so the
 * schema banner clears without a full reload. The mutation can also
 * be observed for its `isPending` state to disable the Migrate
 * button while the upgrade is running.
 */
export function useMigrate() {
  const queryClient = useQueryClient();
  return useMutation<MigrateResponse, ApiError, void>({
    mutationFn: () => apiClient.post<MigrateResponse>("/api/migrate", undefined),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["info"] });
    },
  });
}
