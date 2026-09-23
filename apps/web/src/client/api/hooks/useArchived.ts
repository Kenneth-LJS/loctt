import type { BulkResponse, ErrorResponse, ProjectDef, TaskFrontmatterPublic, UserProfile } from "@loctt/contracts";
import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { DELETE_CONFIRM_WORD } from "../../list/DeleteConfirmDialog.tsx";
import { dataStateOf } from "../../ui/InlineFailureNotice.tsx";
import { apiClient, ApiError } from "../client.ts";
import { invalidateIntegrity } from "./invalidateIntegrity.ts";
import { useProjectsScoped, useUsersScoped, useViewsScoped } from "./sidebarData.ts";
import { useCountedLabels, useCountedMilestones, useCountedSprints } from "./useDataMutations.ts";

/**
 * Settings → Archived (K121 #1, SET-52..SET-54): the reads and writes
 * behind the one place archived items can be seen, restored or deleted
 * in the web UI.
 *
 * Every archivable entity type (K107's seven) gets the same normalized
 * row shape, so the panel renders one list whatever the type. The reads
 * reuse the entity panels' own scoped hooks with `archived` scope, so the
 * query keys sit under each entity's prefix and every existing mutation
 * already invalidates them.
 *
 * Writes go through {@link runArchivedBatch}: tasks use the bulk
 * endpoints (one request, `{succeeded, failed}` back); the config
 * entities have no bulk route, so each item is its own request and the
 * outcome is gathered per item. Either way the result names exactly which
 * items succeeded and which did not (SET-53/SET-54: nothing is shown as
 * restored or deleted that was not).
 */

export type ArchivedKind =
  | "tasks"
  | "projects"
  | "views"
  | "labels"
  | "milestones"
  | "sprints"
  | "users";

/** Display order: the Content panels' nav order, then Users. */
export const ARCHIVED_KINDS: readonly ArchivedKind[] = [
  "tasks",
  "projects",
  "views",
  "labels",
  "milestones",
  "sprints",
  "users",
];

/** Singular and plural nouns, as the user reads them. */
export const KIND_NOUN: Readonly<Record<ArchivedKind, { readonly one: string; readonly many: string; readonly title: string }>> = {
  tasks: { one: "task", many: "tasks", title: "Tasks" },
  projects: { one: "project", many: "projects", title: "Projects" },
  views: { one: "saved view", many: "saved views", title: "Saved views" },
  labels: { one: "label", many: "labels", title: "Labels" },
  milestones: { one: "milestone", many: "milestones", title: "Milestones" },
  sprints: { one: "sprint", many: "sprints", title: "Sprints" },
  users: { one: "user", many: "users", title: "Users" },
};

/** One archived item, whatever its type. */
export interface ArchivedItem {
  /** The id every write addresses (a task's ULID, a config entry's id). */
  readonly id: string;
  /** What the user calls it: a task's title, an entity's name. */
  readonly name: string;
  /** A task's key, shown before its title. */
  readonly key?: string | undefined;
  /** When it was archived, where the type records it (tasks only). */
  readonly archivedAt?: string | undefined;
  /**
   * How many tasks still reference it, where the list endpoint counts
   * (projects, labels, milestones, sprints). `undefined` means unknown,
   * not zero — users are counted per item by their own delete dialog.
   */
  readonly refCount?: number | undefined;
  /** The full record, for the entity delete dialogs that take one. */
  readonly project?: ProjectDef | undefined;
  readonly user?: UserProfile | undefined;
}

export interface ArchivedList {
  readonly items: readonly ArchivedItem[];
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly error: unknown;
  readonly refetch: () => void;
}

/** The server's hard page cap (`MAX_PAGE_LIMIT`). */
const TASK_PAGE = 1000;

interface TaskPage {
  readonly items: readonly TaskFrontmatterPublic[];
  readonly total: number;
}

/**
 * Every archived task, newest-archived first. Pages until `total` is
 * reached so "Restore all" / "Delete all" act on all of them, not the
 * first page. Under the `["tasks"]` prefix so the bulk hooks' and the
 * task mutations' invalidation reaches it.
 */
function useArchivedTasks() {
  return useQuery({
    queryKey: ["tasks", "archived-section"],
    queryFn: async ({ signal }) => {
      const out: TaskFrontmatterPublic[] = [];
      for (let offset = 0; ; offset += TASK_PAGE) {
        const page = await apiClient.get<TaskPage>(
          `/api/tasks?archived=archived&sort=archived_at&dir=desc&limit=${String(TASK_PAGE)}&offset=${String(offset)}`,
          { signal },
        );
        out.push(...page.items);
        if (page.items.length === 0 || out.length >= page.total) break;
      }
      return out;
    },
  });
}

function listOf<T>(
  q: { readonly data: T | undefined; readonly isLoading: boolean; readonly isError: boolean; readonly error: unknown; readonly refetch: () => unknown },
  map: (data: T) => readonly ArchivedItem[],
): ArchivedList {
  return {
    items: q.data === undefined ? [] : map(q.data),
    isLoading: q.isLoading,
    isError: q.isError,
    error: q.error,
    refetch: () => { void q.refetch(); },
  };
}

/**
 * All seven archived lists. Fetched together because the type picker
 * shows every type's count (SET-52), not only the selected one's.
 */
export function useArchivedLists(): Readonly<Record<ArchivedKind, ArchivedList>> {
  const tasks = useArchivedTasks();
  const projects = useProjectsScoped("archived");
  const views = useViewsScoped("archived");
  const labels = useCountedLabels("archived");
  const milestones = useCountedMilestones("archived");
  const sprints = useCountedSprints("archived");
  const users = useUsersScoped("archived");
  return {
    tasks: listOf(tasks, d => d.map(t => ({
      id: t.id,
      key: t.key,
      name: t.title ?? "",
      archivedAt: t.archived_at,
    }))),
    projects: listOf(projects, d => d.items.map(p => ({
      id: p.id,
      name: p.name,
      refCount: d.task_counts?.[p.id] ?? 0,
      project: p,
    }))),
    views: listOf(views, d => d.queries.map(v => ({ id: v.id, name: v.name }))),
    labels: listOf(labels, d => d.items.map(l => ({ id: l.id, name: l.name, refCount: l.taskCount ?? 0 }))),
    milestones: listOf(milestones, d => d.items.map(m => ({ id: m.id, name: m.name, refCount: m.taskCount ?? 0 }))),
    sprints: listOf(sprints, d => d.items.map(s => ({ id: s.id, name: s.name, refCount: s.taskCount ?? 0 }))),
    users: listOf(users, d => d.items.map(u => ({ id: u.id, name: u.name ?? u.id, user: u }))),
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export type ArchivedAction = "restore" | "delete";

export interface ItemFailure {
  readonly item: ArchivedItem;
  readonly message: string;
  /** The envelope's claim; `unknown` when the outcome cannot be told (ERR-4). */
  readonly dataState: ErrorResponse["data_state"] | undefined;
}

export interface BatchOutcome {
  readonly kind: ArchivedKind;
  readonly action: ArchivedAction;
  readonly succeeded: readonly ArchivedItem[];
  readonly failed: readonly ItemFailure[];
}

const enc = encodeURIComponent;

/** Restores one config entity. Tasks never come through here. */
function restoreOne(kind: Exclude<ArchivedKind, "tasks">, id: string): Promise<unknown> {
  switch (kind) {
    case "projects": return apiClient.put(`/api/projects/${enc(id)}`, { archived: false });
    case "milestones": return apiClient.put(`/api/milestones/${enc(id)}`, { archived: false });
    case "views": return apiClient.post(`/api/views/${enc(id)}/unarchive`, {});
    case "labels": return apiClient.post(`/api/labels/${enc(id)}/unarchive`, {});
    case "sprints": return apiClient.post(`/api/sprints/${enc(id)}/unarchive`, {});
    case "users": return apiClient.post(`/api/users/${enc(id)}/unarchive`, {});
  }
}

/**
 * Deletes one config entity, CLEARING any task references — the "clear"
 * branch of each entity's own remap-or-clear delete (RemapDeleteDialog's
 * "clear the field", DeleteProjectDialog's "clear their project field",
 * UserDeleteDialog's "unassign"). A multi-item delete has no single remap
 * target to offer, so it takes that branch, and its confirmation says so
 * with the count (A331). A single row's Delete opens the entity's own
 * dialog instead, where remap is offered.
 */
function deleteOne(kind: Exclude<ArchivedKind, "tasks">, id: string): Promise<unknown> {
  switch (kind) {
    case "projects": return apiClient.delete(`/api/projects/${enc(id)}?clear_project_field=true`);
    case "views": return apiClient.delete(`/api/views/${enc(id)}`);
    case "labels": return apiClient.delete(`/api/labels/${enc(id)}`);
    case "milestones": return apiClient.delete(`/api/milestones/${enc(id)}`);
    case "sprints": return apiClient.delete(`/api/sprints/${enc(id)}`);
    case "users": return apiClient.delete(`/api/users/${enc(id)}?confirm=true&unassign=true`);
  }
}

function failureOf(item: ArchivedItem, err: unknown): ItemFailure {
  return {
    item,
    message: err instanceof ApiError
      ? (err.envelope?.message ?? err.message)
      : err instanceof Error ? err.message : String(err),
    // The same reading `InlineFailureNotice` uses everywhere else.
    dataState: dataStateOf(err),
  };
}

/** Generous: a bulk delete of many tasks removes many directories. */
const BULK_TIMEOUT_MS = 120_000;

/**
 * Runs a restore or delete over `items` and reports per item.
 *
 * Tasks: one bulk request. Its `failed[]` names the tasks that did not
 * change; a failure of the request itself (nothing came back) marks every
 * item unknown, since the server may have acted on some before failing.
 * Config entities: sequential single requests, so one failure never
 * stops the rest and each outcome is its own.
 */
export async function runArchivedBatch(
  kind: ArchivedKind,
  action: ArchivedAction,
  items: readonly ArchivedItem[],
): Promise<BatchOutcome> {
  if (kind === "tasks") {
    const refs = items.map(i => i.id);
    try {
      const res = action === "restore"
        ? await apiClient.post<BulkResponse>(
            "/api/tasks/bulk/archive",
            { refs, archive: false },
            { timeoutMs: BULK_TIMEOUT_MS },
          )
        : await apiClient.post<BulkResponse>(
            "/api/tasks/bulk/delete",
            { refs, confirm: DELETE_CONFIRM_WORD },
            { timeoutMs: BULK_TIMEOUT_MS },
          );
      const failedById = new Map(res.failed.map(f => [f.taskId, f.error]));
      return {
        kind,
        action,
        succeeded: items.filter(i => !failedById.has(i.id)),
        failed: items
          .filter(i => failedById.has(i.id))
          .map(i => ({ item: i, message: failedById.get(i.id) ?? "", dataState: "not_saved" as const })),
      };
    } catch (err) {
      return { kind, action, succeeded: [], failed: items.map(i => failureOf(i, err)) };
    }
  }

  const succeeded: ArchivedItem[] = [];
  const failed: ItemFailure[] = [];
  for (const item of items) {
    try {
      await (action === "restore" ? restoreOne(kind, item.id) : deleteOne(kind, item.id));
      succeeded.push(item);
    } catch (err) {
      failed.push(failureOf(item, err));
    }
  }
  return { kind, action, succeeded, failed };
}

/** The query prefixes a write to `kind` can change. */
const KIND_PREFIX: Readonly<Record<ArchivedKind, string>> = {
  tasks: "tasks",
  projects: "projects",
  views: "views",
  labels: "labels",
  milestones: "milestones",
  sprints: "sprints",
  users: "users",
};

/**
 * Drops every read a restore/delete can change: the type's own lists
 * (both scopes), the task lists (a restored task reappears; a deleted
 * label/milestone/sprint/project/user is cleared from tasks), the
 * milestones progress view, and the integrity count.
 */
export function invalidateArchivedConsumers(qc: QueryClient, kind: ArchivedKind): void {
  void qc.invalidateQueries({ queryKey: [KIND_PREFIX[kind]] });
  void qc.invalidateQueries({ queryKey: ["tasks"] });
  void qc.invalidateQueries({ queryKey: ["tasks-feed"] });
  void qc.invalidateQueries({ queryKey: ["workflow", "milestones-progress"] });
  invalidateIntegrity(qc);
}

/** {@link runArchivedBatch} as a mutation, invalidating on settle. */
export function useArchivedBatch() {
  const qc = useQueryClient();
  return useMutation<
    BatchOutcome,
    Error,
    { kind: ArchivedKind; action: ArchivedAction; items: readonly ArchivedItem[] }
  >({
    mutationFn: ({ kind, action, items }) => runArchivedBatch(kind, action, items),
    onSettled: (_data, _err, vars) => { invalidateArchivedConsumers(qc, vars.kind); },
  });
}
