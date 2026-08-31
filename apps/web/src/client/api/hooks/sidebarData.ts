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

/**
 * Every picker's list is fetched at this size.
 *
 * `GET /api/*` paginates at `DEFAULT_PAGE_LIMIT = 100` when no `limit`
 * is sent, and these hooks sent none. Measured against a tracker with
 * 150 labels: `{ total: 150, items: 100 }` — the client was handed two
 * thirds of the list and told the total, and nothing reconciled the
 * two. The consequence is not a short list, it is a *wrong* one: the
 * create modal's label field offers "Create «lbl-140»" for a label
 * that already exists on disk but fell outside the first hundred, so
 * searching for an existing label offers to duplicate it (NEW-7,
 * NEW-25).
 *
 * 1000 is the server's `MAX_PAGE_LIMIT`; asking for more is a 400.
 * These are config lists (labels, milestones, sprints, users,
 * projects), not the task table — a workspace past a thousand of any
 * of them needs a paged picker, which is a different ticket.
 */
const PICKER_PAGE_LIMIT = 1000;

interface Page<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
}

export interface PrefixRenameSentinel {
  readonly project_id: string;
  readonly from: string;
  readonly to: string;
  readonly started_at: string;
}

export interface ProjectsPage extends Page<ProjectDef> {
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
  /**
   * Task count per project id (PRU-17's reference-count badge). Ships
   * with the list so the badge is visible before the delete dialog is
   * opened, and comes from the same source as the delete guard.
   */
  readonly task_counts?: Readonly<Record<string, number>>;
  /**
   * Present only when a prefix rename was interrupted server-side
   * (PRU-46). The panel must report the tracker as mid-rename rather
   * than healthy.
   */
  readonly pending_prefix_rename?: PrefixRenameSentinel;
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
    queryFn: ({ signal }) => apiClient.get<ProjectsPage>(`/api/projects?limit=${String(PICKER_PAGE_LIMIT)}`, { signal }),
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
    queryFn: ({ signal }) => apiClient.get<Page<LabelDef>>(`/api/labels?limit=${String(PICKER_PAGE_LIMIT)}`, { signal }),
  });
}

export function useMilestones() {
  return useQuery({
    queryKey: ["milestones"],
    queryFn: ({ signal }) => apiClient.get<Page<MilestoneDef>>(`/api/milestones?limit=${String(PICKER_PAGE_LIMIT)}`, { signal }),
  });
}

export function useSprints() {
  return useQuery({
    queryKey: ["sprints"],
    queryFn: ({ signal }) => apiClient.get<Page<SprintDef>>(`/api/sprints?limit=${String(PICKER_PAGE_LIMIT)}`, { signal }),
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
      apiClient.get<UsersPage>(
        `/api/users?include_archived=true&limit=${String(PICKER_PAGE_LIMIT)}`,
        { signal },
      ),
  });
}

export function useRecents() {
  return useQuery({
    queryKey: ["recents"],
    queryFn: ({ signal }) => apiClient.get<Page<RecentTaskResponse>>("/api/recents", { signal }),
  });
}
