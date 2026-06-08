import type { UserProfile } from "@loctt/contracts";
import { useQuery } from "@tanstack/react-query";

import { apiClient, ApiError } from "../client.ts";

/**
 * Reads the current (active) user from `GET /api/user/current`.
 *
 * A 404 means "no users registered" — a freshly-initialized tracker
 * before any user exists. That's the init-wizard state (M4), not an
 * error: we map it to `data === null` inside the queryFn so the
 * bootstrap can branch on it without inspecting an error object. Any
 * other failure throws and retries once (the app-wide default) so a
 * transient blip during `npm run dev` reloads doesn't wedge boot.
 */
export function useCurrentUser() {
  return useQuery<UserProfile | null, ApiError>({
    queryKey: ["user", "current"],
    queryFn: async ({ signal }) => {
      try {
        return await apiClient.get<UserProfile>("/api/user/current", { signal });
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },
  });
}
