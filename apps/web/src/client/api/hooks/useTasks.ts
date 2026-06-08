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
export interface TasksQueryParams {
  readonly query?: string;
  readonly view?: string;
  readonly project?: string;
  readonly sort?: string;
  readonly dir?: "asc" | "desc";
  readonly page?: number;
  readonly limit?: number;
}

/** Pulls the task-affecting params out of the parsed list search. */
export function tasksParamsFromSearch(search: Partial<ListSearch>): TasksQueryParams {
  return {
    ...(search.q !== undefined ? { query: search.q } : {}),
    ...(search.view !== undefined ? { view: search.view } : {}),
    // project arrives as an array in URL state; the M1.2 endpoint takes
    // a single project key. We send the first until multi-select lands
    // with the M1.3 filter bar.
    ...(search.project?.[0] !== undefined ? { project: search.project[0] } : {}),
    ...(search.sort !== undefined ? { sort: search.sort } : {}),
    ...(search.dir !== undefined ? { dir: search.dir } : {}),
    ...(search.page !== undefined ? { page: search.page } : {}),
    ...(search.limit !== undefined ? { limit: search.limit } : {}),
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
  if (params.project !== undefined) sp.set("project", params.project);
  if (params.sort !== undefined) sp.set("sort", params.sort);
  if (params.dir !== undefined) sp.set("dir", params.dir);
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
