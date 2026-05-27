import type { UserProfile } from "@loctt/contracts";
import { useQuery } from "@tanstack/react-query";

import { apiClient, ApiError } from "../client.ts";

/**
 * Reads the current user from `/api/user/current`. Returns a normal
 * useQuery result; the `null` case (no users registered yet, e.g.
 * inside the init wizard) surfaces as a 404 → ApiError, which the
 * UserContext below maps to `currentUser: null` rather than an error
 * state since "no users yet" is a valid bootstrap state.
 */
export function useCurrentUser() {
  return useQuery<UserProfile, ApiError>({
    queryKey: ["currentUser"],
    queryFn: ({ signal }) => apiClient.get<UserProfile>("/api/user/current", { signal }),
    // Don't retry a 404 — that's the "no users registered" state, not
    // a transient failure.
    retry: (failureCount, err) => err.status !== 404 && failureCount < 1,
  });
}
