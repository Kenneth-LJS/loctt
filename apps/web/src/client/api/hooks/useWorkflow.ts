import type { UserSettings, WorkflowConfig } from "@loctt/contracts";
import { useQuery } from "@tanstack/react-query";

import { apiClient } from "../client.ts";

/**
 * Workflow config — the status / priority / task-type / relationship
 * definitions. The list view reads it to turn stored enum keys into
 * human labels + colours (a task's `status: "in_progress"` becomes the
 * "In progress" badge in the workflow's blue category colour).
 *
 * Workflow rarely changes within a session and is read by many cells,
 * so it rides the app-wide stale window and is cached under a single
 * key.
 */
export function useWorkflow() {
  return useQuery({
    queryKey: ["workflow"],
    queryFn: ({ signal }) => apiClient.get<WorkflowConfig>("/api/workflow", { signal }),
  });
}

interface UserSettingsResponse {
  readonly user: string;
  readonly settings: UserSettings;
}

/**
 * The current user's settings. The list view reads `list_columns` from
 * here for per-user column visibility + order (the editor lives in
 * settings, M4 — this is read-only for now). Settings are
 * intentionally schema-less beyond `default_project`, so consumers
 * narrow the keys they care about.
 */
export function useUserSettings() {
  return useQuery({
    queryKey: ["user-settings"],
    queryFn: ({ signal }) =>
      apiClient.get<UserSettingsResponse>("/api/user-settings", { signal }),
  });
}
