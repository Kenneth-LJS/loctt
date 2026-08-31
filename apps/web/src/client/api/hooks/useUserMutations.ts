import type { UserProfile } from "@loctt/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "../client.ts";

/**
 * User CRUD for Settings → Users (PRU-11, PRU-12, PRU-26, PRU-31,
 * PRU-40, PRU-42).
 */

function invalidateUserConsumers(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ["users"] });
  void qc.invalidateQueries({ queryKey: ["user", "current"] });
  // Assignee/reporter cells render a user; a rename or delete changes them.
  void qc.invalidateQueries({ queryKey: ["tasks"] });
}

export interface CreateUserVars {
  readonly name: string;
  readonly email?: string;
  readonly timezone?: string;
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation<UserProfile, Error, CreateUserVars>({
    mutationFn: vars => apiClient.post<UserProfile>("/api/users", vars),
    onSuccess: () => { invalidateUserConsumers(qc); },
  });
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation<UserProfile, Error, { id: string } & CreateUserVars>({
    mutationFn: ({ id, ...rest }) =>
      apiClient.put<UserProfile>(`/api/users/${encodeURIComponent(id)}`, rest),
    onSuccess: () => { invalidateUserConsumers(qc); },
  });
}

export function useArchiveUser() {
  const qc = useQueryClient();
  return useMutation<UserProfile, Error, { id: string; archived: boolean }>({
    mutationFn: ({ id, archived }) =>
      apiClient.post<UserProfile>(
        `/api/users/${encodeURIComponent(id)}/${archived ? "archive" : "unarchive"}`,
        {},
      ),
    onSuccess: () => { invalidateUserConsumers(qc); },
  });
}

export function useDeleteUser() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, { id: string }>({
    mutationFn: ({ id }) =>
      apiClient.delete(`/api/users/${encodeURIComponent(id)}?confirm=true`),
    onSuccess: () => { invalidateUserConsumers(qc); },
  });
}

/**
 * PRU-13/PRU-27/PRU-40: the file posted here is the **already
 * compressed** one, so a retry re-posts it rather than making the user
 * re-pick the original.
 */
export function useUploadAvatar() {
  const qc = useQueryClient();
  return useMutation<UserProfile, Error, { id: string; file: File }>({
    mutationFn: ({ id, file }) =>
      apiClient.postFile<UserProfile>(
        `/api/users/${encodeURIComponent(id)}/avatar`,
        file,
      ),
    onSuccess: () => { invalidateUserConsumers(qc); },
  });
}
