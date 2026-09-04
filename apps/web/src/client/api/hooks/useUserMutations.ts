import type { UserProfile } from "@loctt/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

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

export interface DeleteUserResult {
  readonly deleted: string;
  readonly remappedAssigneeCount: number;
  readonly remappedReporterCount: number;
}

export interface DeleteUserVars {
  readonly id: string;
  /**
   * Where the deleted user's references go. `deleteUser` refuses to
   * leave a dangling reference (K21), so a referenced user must be
   * deleted with exactly one of these — mirrored from the server's
   * `remap_to` / `unassign` query params. A user with no references
   * needs neither.
   */
  readonly remapTo?: string;
  readonly unassign?: boolean;
}

export function useDeleteUser() {
  const qc = useQueryClient();
  return useMutation<DeleteUserResult, Error, DeleteUserVars>({
    mutationFn: ({ id, remapTo, unassign }) => {
      const params = new URLSearchParams({ confirm: "true" });
      if (remapTo !== undefined) params.set("remap_to", remapTo);
      if (unassign === true) params.set("unassign", "true");
      return apiClient.delete<DeleteUserResult>(
        `/api/users/${encodeURIComponent(id)}?${params.toString()}`,
      );
    },
    onSuccess: () => { invalidateUserConsumers(qc); },
  });
}

export interface UserReferenceCounts {
  readonly id: string;
  readonly assignee: number;
  readonly reporter: number;
}

/**
 * PRU-42: the reference count, split by role, that the delete
 * confirmation shows *before* the user commits. Read-only; enabled
 * only while the dialog is open for `id`.
 */
export function useUserReferences(id: string | undefined) {
  return useQuery<UserReferenceCounts, Error>({
    queryKey: ["users", "references", id],
    enabled: id !== undefined,
    queryFn: () =>
      apiClient.get<UserReferenceCounts>(
        `/api/users/${encodeURIComponent(id as string)}/usage`,
      ),
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
