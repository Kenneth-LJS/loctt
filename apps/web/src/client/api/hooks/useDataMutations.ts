import type { LabelDef, MilestoneDef, SprintDef } from "@loctt/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "../client.ts";

/**
 * Writes for the Settings → Data panels: Labels, Milestones, Sprints
 * (MSL-8, MSL-9, MSL-10, MSL-12, MSL-13, MSL-14, MSL-33, MSL-37).
 *
 * The delete mutations take an explicit `remapTo` and pass it as
 * `?remap_to=`. That query parameter reaches core's hard-delete path,
 * which rewrites the referencing tasks; the archive path rejects it.
 * See `handleDeleteLabel` in the server for why the route had to start
 * sending `hard` before any of this could work.
 *
 * Every mutation invalidates the same query key the sidebar and the
 * pickers read, which is what MSL-8's "immediately offered in task
 * label pickers" and MSL-27's "without a restart" rest on.
 */

/** A page of entries with `?counts=true` applied (MSL-11). */
export interface CountedPage<T> {
  readonly items: readonly (T & { readonly taskCount?: number })[];
  readonly total: number;
}

/**
 * Reference counts are opt-in server-side because they scan every
 * task. The settings panels are the surface that wants them, so they
 * ask on their own query key rather than making the sidebar pay for a
 * full scan on every page load.
 */
export function useCountedLabels() {
  return useQuery({
    queryKey: ["labels", "counted"],
    queryFn: ({ signal }) =>
      apiClient.get<CountedPage<LabelDef>>(
        "/api/labels?counts=true&limit=500",
        { signal },
      ),
  });
}

export function useCountedMilestones() {
  return useQuery({
    queryKey: ["milestones", "counted"],
    queryFn: ({ signal }) =>
      apiClient.get<CountedPage<MilestoneDef>>(
        "/api/milestones?counts=true&limit=500",
        { signal },
      ),
  });
}

export function useCountedSprints() {
  return useQuery({
    queryKey: ["sprints", "counted"],
    queryFn: ({ signal }) =>
      apiClient.get<CountedPage<SprintDef>>(
        "/api/sprints?counts=true&limit=500",
        { signal },
      ),
  });
}

/** Drops every cached read of an entity kind, counted and uncounted. */
function invalidator(qc: ReturnType<typeof useQueryClient>, key: string) {
  return () => {
    void qc.invalidateQueries({ queryKey: [key] });
    // The task list renders label pills and milestone names, so a
    // rename or a recolour has to reach it too (MSL-9).
    void qc.invalidateQueries({ queryKey: ["tasks"] });
  };
}

export interface DeleteVars {
  readonly id: string;
  /** Remap references to this id; omit to drop them (MSL-12). */
  readonly remapTo?: string;
}

export interface DeleteResult {
  readonly deleted: string;
  readonly affectedTaskCount: number;
}

function deleteUrl(base: string, vars: DeleteVars): string {
  const q = vars.remapTo !== undefined
    ? `?remap_to=${encodeURIComponent(vars.remapTo)}`
    : "";
  return `${base}/${encodeURIComponent(vars.id)}${q}`;
}

export function useUpdateLabel() {
  const qc = useQueryClient();
  return useMutation<
    LabelDef,
    Error,
    { id: string; name?: string; color?: string | null }
  >({
    mutationFn: ({ id, ...body }) =>
      apiClient.put<LabelDef>(`/api/labels/${encodeURIComponent(id)}`, body),
    onSuccess: invalidator(qc, "labels"),
  });
}

export function useDeleteLabel() {
  const qc = useQueryClient();
  return useMutation<DeleteResult, Error, DeleteVars>({
    mutationFn: vars => apiClient.delete<DeleteResult>(deleteUrl("/api/labels", vars)),
    onSuccess: invalidator(qc, "labels"),
  });
}

export function useArchiveLabel() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, { id: string; archived: boolean }>({
    // MSL-10: archive and unarchive are their own routes, not a field
    // on PUT — core's `editLabel` accepts only `name` and `color` and
    // preserves `archived` untouched, so a PUT could never have set it.
    mutationFn: ({ id, archived }) =>
      apiClient.post(
        `/api/labels/${encodeURIComponent(id)}/${archived ? "archive" : "unarchive"}`,
        {},
      ),
    onSuccess: invalidator(qc, "labels"),
  });
}

export function useUpdateMilestone() {
  const qc = useQueryClient();
  return useMutation<
    MilestoneDef,
    Error,
    { id: string; name?: string; target_date?: string | null }
  >({
    mutationFn: ({ id, ...body }) =>
      apiClient.put<MilestoneDef>(`/api/milestones/${encodeURIComponent(id)}`, body),
    onSuccess: invalidator(qc, "milestones"),
  });
}

export function useCreateMilestone() {
  const qc = useQueryClient();
  return useMutation<MilestoneDef, Error, { name: string; target_date?: string }>({
    mutationFn: vars => apiClient.post<MilestoneDef>("/api/milestones", vars),
    onSuccess: invalidator(qc, "milestones"),
  });
}

export function useDeleteMilestone() {
  const qc = useQueryClient();
  return useMutation<DeleteResult, Error, DeleteVars>({
    mutationFn: vars => apiClient.delete<DeleteResult>(deleteUrl("/api/milestones", vars)),
    onSuccess: invalidator(qc, "milestones"),
  });
}
