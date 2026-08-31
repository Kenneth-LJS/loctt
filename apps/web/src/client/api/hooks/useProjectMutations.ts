import type { ProjectDef } from "@loctt/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "../client.ts";

/**
 * Project CRUD for Settings → Projects (PRU-5, PRU-6, PRU-7, PRU-17).
 *
 * None of these are optimistic. A project write changes key allocation
 * and, for delete-with-remap, rewrites task files — a rolled-back
 * optimistic view of that would be a lie about what is on disk. Every
 * one awaits the server and then invalidates.
 *
 * `["projects"]` is the key the sidebar and every project picker read,
 * so invalidating it is what makes PRU-5's "appears in the switcher
 * without a page reload" hold.
 */

/** Also drop the caches that embed a project reference. */
function invalidateProjectConsumers(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ["projects"] });
  // Tasks carry a project; a remap or delete changes what they show.
  void qc.invalidateQueries({ queryKey: ["tasks"] });
}

export interface CreateProjectVars {
  readonly name: string;
  readonly prefix: string;
  readonly slug?: string;
  readonly make_default?: boolean;
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation<ProjectDef, Error, CreateProjectVars>({
    mutationFn: vars => apiClient.post<ProjectDef>("/api/projects", vars),
    onSuccess: () => { invalidateProjectConsumers(qc); },
  });
}

export function useUpdateProject() {
  const qc = useQueryClient();
  return useMutation<ProjectDef, Error, { id: string; name: string }>({
    mutationFn: ({ id, name }) =>
      apiClient.put<ProjectDef>(`/api/projects/${encodeURIComponent(id)}`, { name }),
    onSuccess: () => { invalidateProjectConsumers(qc); },
  });
}

export function useArchiveProject() {
  const qc = useQueryClient();
  return useMutation<ProjectDef, Error, { id: string; archived: boolean }>({
    mutationFn: ({ id, archived }) =>
      apiClient.put<ProjectDef>(
        `/api/projects/${encodeURIComponent(id)}`,
        { archived },
      ),
    onSuccess: () => { invalidateProjectConsumers(qc); },
  });
}

/**
 * PRU-17: delete takes an explicit disposition for the tasks that
 * reference the project. Core supports exactly one — remap to another
 * project — and rejects the delete outright when tasks exist and no
 * target is given, so there is no silent orphaning. PRU-17's other
 * option, *clearing* the project field, has no core support (see
 * known-gaps.md); the dialog therefore offers remap only rather than
 * offering a choice one half of which would fail.
 */
export interface DeleteProjectVars {
  readonly id: string;
  /** Required by the server when the project still holds tasks. */
  readonly remapTo?: string;
}

export interface DeleteProjectResult {
  readonly deleted: string;
  readonly remappedTaskCount: number;
}

export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation<DeleteProjectResult, Error, DeleteProjectVars>({
    mutationFn: ({ id, remapTo }) => {
      const params = new URLSearchParams();
      if (remapTo !== undefined) params.set("remap_to", remapTo);
      const qs = params.toString();
      return apiClient.delete<DeleteProjectResult>(
        `/api/projects/${encodeURIComponent(id)}${qs.length > 0 ? `?${qs}` : ""}`,
      );
    },
    onSuccess: () => { invalidateProjectConsumers(qc); },
  });
}

/**
 * PRU-44: a prefix change is its own endpoint because it rewrites every
 * task in the project. It is not part of the name edit, and it does not
 * save on blur.
 */
export function useSetProjectPrefix() {
  const qc = useQueryClient();
  return useMutation<
    { from: string; to: string; renamed: number },
    Error,
    { id: string; prefix: string }
  >({
    mutationFn: ({ id, prefix }) =>
      apiClient.put(`/api/projects/${encodeURIComponent(id)}/prefix`, { prefix }),
    onSuccess: () => {
      invalidateProjectConsumers(qc);
      // Every key changed, so anything holding a key is stale.
      void qc.invalidateQueries({ queryKey: ["recents"] });
    },
  });
}
