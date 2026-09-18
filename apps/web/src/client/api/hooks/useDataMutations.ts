import type { BrokenEntry, LabelDef, MilestoneDef, SprintDef } from "@loctt/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "../client.ts";
import { invalidateIntegrity } from "./invalidateIntegrity.ts";

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
  /**
   * DEG-30 / A138: per-entry corruption markers. A label (or milestone,
   * or sprint) whose stored fields do not validate — a non-string `name`,
   * an unknown key — is lifted by the tolerant loader into `broken`
   * rather than dropped, so the panel can show it as a marked error row
   * instead of silently omitting it. Omitted (never `[]`) when everything
   * parsed; the endpoint already rides it (`handleListLabels`), the hook
   * simply carries it through to the panel.
   */
  readonly broken?: readonly BrokenEntry[];
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
    // DEG-31: repairing a broken label/milestone/sprint entry through the
    // panel changes the config integrity count. Covers all three kinds
    // (milestoneInvalidator delegates here).
    invalidateIntegrity(qc);
  };
}

/**
 * The milestone invalidator, which additionally drops the
 * milestones-progress cache.
 *
 * B2 bug 4: a milestone archive/rename/delete changed `["milestones"]`
 * but not `["workflow", "milestones-progress"]`, the key
 * `useMilestonesWithProgress` reads (the `/milestones` view). With a
 * 30s `staleTime` on that view, an archived milestone lingered there for
 * up to 30 seconds after the panel said it was gone. Invalidating the
 * progress key — a `["workflow", "milestones-progress"]` prefix, which
 * React Query matches — refetches the view immediately.
 */
function milestoneInvalidator(qc: ReturnType<typeof useQueryClient>) {
  return () => {
    invalidator(qc, "milestones")();
    void qc.invalidateQueries({ queryKey: ["workflow", "milestones-progress"] });
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
    onSuccess: milestoneInvalidator(qc),
  });
}

export function useCreateMilestone() {
  const qc = useQueryClient();
  return useMutation<MilestoneDef, Error, { name: string; target_date?: string }>({
    mutationFn: vars => apiClient.post<MilestoneDef>("/api/milestones", vars),
    onSuccess: milestoneInvalidator(qc),
  });
}

export function useArchiveMilestone() {
  const qc = useQueryClient();
  // MSL-25: archive/unarchive is a milestone field, not a separate route
  // — unlike labels, `PUT /api/milestones/:id` already threads `archived`
  // through to core's `editMilestone`. The panel's Save only ever sent
  // {name, target_date}, so the archived flag had no caller; this is that
  // caller. Kept distinct from `useUpdateMilestone` so the row's toggle
  // does not have to carry the name/date fields to flip one boolean.
  return useMutation<MilestoneDef, Error, { id: string; archived: boolean }>({
    mutationFn: ({ id, archived }) =>
      apiClient.put<MilestoneDef>(
        `/api/milestones/${encodeURIComponent(id)}`,
        { archived },
      ),
    onSuccess: milestoneInvalidator(qc),
  });
}

export function useDeleteMilestone() {
  const qc = useQueryClient();
  return useMutation<DeleteResult, Error, DeleteVars>({
    mutationFn: vars => apiClient.delete<DeleteResult>(deleteUrl("/api/milestones", vars)),
    onSuccess: milestoneInvalidator(qc),
  });
}

/**
 * Sprint create / delete for the Settings → Data → Sprints panel
 * (SPR-40). Both hit routes that already exist on the server
 * (`handleCreateSprint` / `handleDeleteSprint`); this is the client
 * wiring the panel had none of, since the panel was read-only.
 *
 * `state` is required by core's `createSprint`; the panel offers exactly
 * the three SPR-7 states. `end_date` before `start_date` is rejected by
 * core with the message the server attributes to `end_date`.
 */
export function useCreateSprint() {
  const qc = useQueryClient();
  return useMutation<
    SprintDef,
    Error,
    { name: string; start_date: string; end_date: string; state: "active" | "completed" | "future"; goal?: string }
  >({
    mutationFn: body => apiClient.post<SprintDef>("/api/sprints", body),
    onSuccess: invalidator(qc, "sprints"),
  });
}

export function useDeleteSprint() {
  const qc = useQueryClient();
  return useMutation<DeleteResult, Error, DeleteVars>({
    mutationFn: vars => apiClient.delete<DeleteResult>(deleteUrl("/api/sprints", vars)),
    onSuccess: invalidator(qc, "sprints"),
  });
}

export function useArchiveSprint() {
  const qc = useQueryClient();
  // SPR-40: like labels (and unlike milestones), archive/unarchive are
  // their own routes rather than a field on PUT — core's `editSprint`
  // preserves `archived` untouched, so a PUT could never have set it.
  return useMutation<unknown, Error, { id: string; archived: boolean }>({
    mutationFn: ({ id, archived }) =>
      apiClient.post(
        `/api/sprints/${encodeURIComponent(id)}/${archived ? "archive" : "unarchive"}`,
        {},
      ),
    onSuccess: invalidator(qc, "sprints"),
  });
}
