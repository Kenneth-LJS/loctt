import type { TaskFrontmatterPublic } from "@loctt/contracts";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

import type { ListSearch } from "../../router/listSearch.ts";
import { apiClient } from "../client.ts";

interface TasksPage {
  readonly items: readonly TaskFrontmatterPublic[];
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
}

/** Default page size for the list view (matches the mockup's "of N"). */
export const DEFAULT_LIST_LIMIT = 50;

/**
 * The subset of list URL state that changes the `/api/tasks` request.
 * Filters (project/status/…) land in M1.3; M1.2 wires query, sort,
 * and pagination. Keeping this explicit means the query key only
 * changes when something the server actually reads changes.
 */
/** Multi-value structured filters, each a list of ids/keys. */
export interface TasksFilters {
  readonly project?: readonly string[];
  readonly status?: readonly string[];
  readonly priority?: readonly string[];
  readonly type?: readonly string[];
  readonly assignee?: readonly string[];
  readonly reporter?: readonly string[];
  readonly labels?: readonly string[];
  readonly milestone?: readonly string[];
  readonly sprint?: readonly string[];
}

export interface TasksQueryParams extends TasksFilters {
  readonly query?: string;
  readonly view?: string;
  readonly sort?: string;
  readonly dir?: "asc" | "desc";
  readonly page?: number;
  readonly limit?: number;
  readonly archived?: boolean;
}

/** The structured filter keys, shared by serialization + query-key. */
const FILTER_KEYS = [
  "project", "status", "priority", "type", "assignee",
  "reporter", "labels", "milestone", "sprint",
] as const;

/** Pulls the task-affecting params out of the parsed list search. */
export function tasksParamsFromSearch(search: Partial<ListSearch>): TasksQueryParams {
  const filters: Record<string, readonly string[]> = {};
  for (const key of FILTER_KEYS) {
    const v = search[key];
    if (Array.isArray(v) && v.length > 0) filters[key] = v;
  }
  return {
    ...filters,
    ...(search.q !== undefined ? { query: search.q } : {}),
    ...(search.view !== undefined ? { view: search.view } : {}),
    ...(search.sort !== undefined ? { sort: search.sort } : {}),
    ...(search.dir !== undefined ? { dir: search.dir } : {}),
    ...(search.page !== undefined ? { page: search.page } : {}),
    ...(search.limit !== undefined ? { limit: search.limit } : {}),
    ...(search.archived === true ? { archived: true } : {}),
  };
}

function buildQueryString(params: TasksQueryParams): string {
  const limit = params.limit ?? DEFAULT_LIST_LIMIT;
  const page = params.page ?? 1;
  const offset = (page - 1) * limit;
  const sp = new URLSearchParams();
  sp.set("limit", String(limit));
  sp.set("offset", String(offset));
  if (params.query !== undefined) sp.set("query", params.query);
  if (params.view !== undefined) sp.set("view", params.view);
  if (params.sort !== undefined) sp.set("sort", params.sort);
  if (params.dir !== undefined) sp.set("dir", params.dir);
  if (params.archived === true) sp.set("archived", "true");
  // Structured filters: comma-joined lists the server ANDs into the
  // effective query (`type` maps to task_type server-side).
  for (const key of FILTER_KEYS) {
    const v = params[key];
    if (Array.isArray(v) && v.length > 0) sp.set(key, v.join(","));
  }
  return sp.toString();
}

/**
 * Fetches a page of tasks for the list view. The query key is the
 * full param set so changing sort/page/filter refetches; previous data
 * is kept while a new page loads so the table doesn't flash empty on
 * a sort or page change.
 */
export function useTasks(params: TasksQueryParams) {
  return useQuery({
    queryKey: ["tasks", params],
    queryFn: ({ signal }) =>
      apiClient.get<TasksPage>(`/api/tasks?${buildQueryString(params)}`, { signal }),
    placeholderData: keepPreviousData,
  });
}
