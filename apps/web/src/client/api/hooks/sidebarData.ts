import type {
  LabelDef,
  MilestoneDef,
  ProjectDef,
  RecentTaskResponse,
  SavedQuery,
  SprintDef,
  UserProfile,
} from "@loctt/contracts";
import { useQuery } from "@tanstack/react-query";

import { apiClient } from "../client.ts";

/**
 * Sidebar data hooks. Each reads one config/list endpoint the app
 * shell's sidebar groups render from: projects, saved views, labels,
 * milestones, sprints, recents, and the user list (for the header's
 * switch-user menu).
 *
 * The list endpoints return the server's pagination envelope
 * (`{ items, total, offset, limit }`), some with an extra top-level
 * field (`default` project id, `current` user id). We model those
 * envelopes precisely so call sites get the extras typed rather than
 * casting.
 *
 * These all share the app-wide query defaults (30s stale, retry once).
 * Sidebar data changes rarely within a session, so the stale window
 * keeps cross-view navigation from refetching the same lists.
 */

interface Page<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
}

interface ProjectsPage extends Page<ProjectDef> {
  /** Workspace default project id, or null when none is set. */
  readonly default: string | null;
  /**
   * The project a new task would actually land in for the current
   * user: per-user default > workspace default > sole project.
   *
   * Distinct from `default` on purpose. The settings panel edits the
   * workspace value; the sidebar marks the active one (SHL-5), and a
   * user with their own default set has those disagree.
   */
  readonly effective_default?: string | null;
}

interface UsersPage extends Page<UserProfile> {
  /** Current (active) user id, or null when no users exist. */
  readonly current: string | null;
}

/** Saved-view list: `GET /api/views` returns the raw queries.yaml. */
interface ViewsConfig {
  readonly queries: readonly SavedQuery[];
}

export function useProjects() {
  return useQuery({
    queryKey: ["projects"],
    queryFn: ({ signal }) => apiClient.get<ProjectsPage>("/api/projects", { signal }),
  });
}

export function useViews() {
  return useQuery({
    queryKey: ["views"],
    queryFn: ({ signal }) => apiClient.get<ViewsConfig>("/api/views", { signal }),
  });
}

export function useLabels() {
  return useQuery({
    queryKey: ["labels"],
    queryFn: ({ signal }) => apiClient.get<Page<LabelDef>>("/api/labels", { signal }),
  });
}

export function useMilestones() {
  return useQuery({
    queryKey: ["milestones"],
    queryFn: ({ signal }) => apiClient.get<Page<MilestoneDef>>("/api/milestones", { signal }),
  });
}

export function useSprints() {
  return useQuery({
    queryKey: ["sprints"],
    queryFn: ({ signal }) => apiClient.get<Page<SprintDef>>("/api/sprints", { signal }),
  });
}

export function useUsers() {
  return useQuery({
    queryKey: ["users"],
    // Archived users included: a task assigned to someone who has since
    // been archived must still show their *name* (LST-25). Without them
    // the lookup misses and the cell falls back to a raw id, which is
    // both unreadable and a P-4 violation. Pickers filter archived out
    // themselves — offering one as a *new* choice is the thing archiving
    // prevents, and that is a different question from resolving an
    // existing reference.
    queryFn: ({ signal }) =>
      apiClient.get<UsersPage>("/api/users?include_archived=true", { signal }),
  });
}

export function useRecents() {
  return useQuery({
    queryKey: ["recents"],
    queryFn: ({ signal }) => apiClient.get<Page<RecentTaskResponse>>("/api/recents", { signal }),
  });
}
