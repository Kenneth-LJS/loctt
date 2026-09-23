import type {
  BrokenEntry,
  BrokenSavedQuery,
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
import type { PanelScope } from "./useDataMutations.ts";

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

/**
 * A config list page that may carry `broken` — the per-entry corruption
 * markers a tolerant loader sets aside (Phase-7B, A138). Omitted when
 * every entry parsed, same convention as the saved-views `broken`. The
 * projects/labels/milestones/sprints reads all populate it now, so the
 * pickers and panels can list a broken entry rather than dropping it.
 */
interface BrokenPage<T> extends Page<T> {
  readonly broken?: readonly BrokenEntry[];
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
   * Present only when the workspace `default:` names a project that no
   * longer exists (NEW-20 / K23). A stale pointer is tolerated drift,
   * not a config error — the list still loads and `effective_default`
   * has already fallen through to null. This carries the stale id so
   * the panel can name it in a "your default no longer exists" notice,
   * which is where the case asks the drift to surface.
   */
  readonly default_drift?: { readonly kind: "missing"; readonly default: string };
}

export interface UsersPage extends Page<UserProfile> {
  /** Current (active) user id, or null when no users exist. */
  readonly current: string | null;
}

/** Saved-view list: `GET /api/views` returns the raw queries.yaml. */
export interface ViewsConfig {
  readonly queries: readonly SavedQuery[];
  /**
   * Entries present in the file whose query no longer parses (VUE-22).
   * Omitted when none are broken. The sidebar marks these broken rather
   * than hiding them; the settings panel lists them alongside the good.
   */
  readonly broken?: readonly BrokenSavedQuery[];
}

/**
 * K107: the shared config-list hooks request `archived=all`.
 *
 * These are the value-picker / reference-resolver source used across the
 * FilterBar facet dropdowns, TaskDetail, CreateTaskModal, BoardView, the
 * timeline and the view builder — everywhere a stored reference to an
 * archived project/label/milestone/sprint/user/view must still resolve to
 * its NAME rather than a raw id (P-4 / LST-25). Fetching `all` keeps those
 * references readable; the sidebar nav that also reads these hooks already
 * filters `archived !== true` in its own render, so `all` never leaks an
 * archived row into the nav. The settings panels do NOT use these — they
 * fetch their own scoped queries driven by the tri-state control.
 */
export function useProjects() {
  return useQuery({
    queryKey: ["projects"],
    queryFn: ({ signal }) => apiClient.get<ProjectsPage>(`/api/projects?archived=all&limit=${String(PICKER_PAGE_LIMIT)}`, { signal }),
  });
}

export function useViews() {
  return useQuery({
    queryKey: ["views"],
    queryFn: ({ signal }) => apiClient.get<ViewsConfig>("/api/views?archived=all", { signal }),
  });
}

export function useLabels() {
  return useQuery({
    queryKey: ["labels"],
    queryFn: ({ signal }) => apiClient.get<BrokenPage<LabelDef>>(`/api/labels?archived=all&limit=${String(PICKER_PAGE_LIMIT)}`, { signal }),
  });
}

/**
 * K90: the bounded result count a querying picker fetches per keystroke.
 * NEW-25 asks for "a bounded number of results" — a picker list wants to
 * stay short and scannable, not mirror the whole config. The server caps
 * `q` matches at this, and the "offer to create" gate reads an exact-name
 * match from within the returned window (an exact match, if it exists,
 * is by definition among the substring matches, so this bound never
 * hides one).
 */
const PICKER_SEARCH_LIMIT = 50;

/**
 * Imperative label search for {@link LabelsField} (K90). Queries the
 * server `?q=` rather than filtering a pre-fetched list, so a workspace
 * past the fetch window is searchable and the create-offer decision is
 * server-authoritative. Returns the matched labels (archived included;
 * the caller drops those). Not a `useQuery` because the picker owns its
 * own debounce and calls this from an effect.
 */
export async function searchLabels(q: string): Promise<readonly LabelDef[]> {
  // K107: `archived=all` so an archived label already on a task stays
  // visible in the picker (present-but-disabled); the caller drops it as
  // a *new* choice. Same P-4 reasoning as `searchUsers`.
  const page = await apiClient.get<BrokenPage<LabelDef>>(searchUrl("/api/labels", q, { archived: "all" }));
  return page.items;
}

/** Builds a `?q=&limit=` picker-search URL, omitting `q` when blank. */
function searchUrl(path: string, q: string, extra?: Record<string, string>): string {
  const params = new URLSearchParams({ limit: String(PICKER_SEARCH_LIMIT), ...extra });
  if (q.trim() !== "") params.set("q", q.trim());
  return `${path}?${params.toString()}`;
}

/** K90: server-side milestone search for the picker (see OptionPicker). */
export async function searchMilestones(q: string): Promise<readonly MilestoneDef[]> {
  // K107: `archived=all` — an archived milestone on a task stays resolvable.
  const page = await apiClient.get<BrokenPage<MilestoneDef>>(searchUrl("/api/milestones", q, { archived: "all" }));
  return page.items;
}

/** K90: server-side sprint search for the picker. */
export async function searchSprints(q: string): Promise<readonly SprintDef[]> {
  // K107: `archived=all` — an archived sprint on a task stays resolvable.
  const page = await apiClient.get<BrokenPage<SprintDef>>(searchUrl("/api/sprints", q, { archived: "all" }));
  return page.items;
}

/**
 * K90: server-side user search for the picker. Requests archived users
 * too (like `useUsers`) so an archived assignee/reporter stays visible in
 * the list — present-but-disabled — and the "cannot select archived"
 * refusal is exercisable (TSK-46, PRU-41); the option mapper marks them.
 */
export async function searchUsers(q: string): Promise<readonly UserProfile[]> {
  const page = await apiClient.get<UsersPage>(
    // K107: `archived=all` replaces the old `include_archived=true` — same
    // intent, one param spelling across every list.
    searchUrl("/api/users", q, { archived: "all" }),
  );
  return page.items;
}

/** K90: server-side project search for the picker (matches name/slug/prefix). */
export async function searchProjects(q: string): Promise<readonly ProjectDef[]> {
  // K107: `archived=all` — an archived project on a task stays resolvable.
  const page = await apiClient.get<ProjectsPage>(searchUrl("/api/projects", q, { archived: "all" }));
  return page.items;
}

export function useMilestones() {
  return useQuery({
    queryKey: ["milestones"],
    queryFn: ({ signal }) => apiClient.get<BrokenPage<MilestoneDef>>(`/api/milestones?archived=all&limit=${String(PICKER_PAGE_LIMIT)}`, { signal }),
  });
}

export function useSprints() {
  return useQuery({
    queryKey: ["sprints"],
    queryFn: ({ signal }) => apiClient.get<BrokenPage<SprintDef>>(`/api/sprints?archived=all&limit=${String(PICKER_PAGE_LIMIT)}`, { signal }),
  });
}

export function useUsers() {
  return useQuery({
    queryKey: ["users"],
    // Archived users included (K107: `archived=all`, replacing
    // `include_archived=true`): a task assigned to someone who has since
    // been archived must still show their *name* (LST-25). Without them
    // the lookup misses and the cell falls back to a raw id, which is
    // both unreadable and a P-4 violation. Pickers filter archived out
    // themselves — offering one as a *new* choice is the thing archiving
    // prevents, and that is a different question from resolving an
    // existing reference.
    queryFn: ({ signal }) =>
      apiClient.get<UsersPage>(
        `/api/users?archived=all&limit=${String(PICKER_PAGE_LIMIT)}`,
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

/**
 * K107: scoped reads for the settings panels that manage users / projects
 * / saved views. Separate from the shared `useUsers`/`useProjects`/
 * `useViews` above (which fetch `all` as the app-wide picker/resolver
 * source): a settings panel lists `active` only, and Settings → Archived
 * lists `archived` (K121 #1), so the read is scoped and keyed by scope. They share the same base query key prefix (`["users"]` etc.) so a
 * mutation's `invalidateQueries({ queryKey: ["users"] })` drops both the
 * picker read and every scoped panel read at once.
 */
export function useUsersScoped(scope: PanelScope = "active") {
  return useQuery({
    queryKey: ["users", "scoped", scope],
    queryFn: ({ signal }) =>
      apiClient.get<UsersPage>(
        `/api/users?archived=${scope}&limit=${String(PICKER_PAGE_LIMIT)}`,
        { signal },
      ),
  });
}

export function useProjectsScoped(scope: PanelScope = "active") {
  return useQuery({
    queryKey: ["projects", "scoped", scope],
    queryFn: ({ signal }) =>
      apiClient.get<ProjectsPage>(
        `/api/projects?archived=${scope}&limit=${String(PICKER_PAGE_LIMIT)}`,
        { signal },
      ),
  });
}

export function useViewsScoped(scope: PanelScope = "active") {
  return useQuery({
    queryKey: ["views", "scoped", scope],
    queryFn: ({ signal }) =>
      apiClient.get<ViewsConfig>(`/api/views?archived=${scope}`, { signal }),
  });
}
