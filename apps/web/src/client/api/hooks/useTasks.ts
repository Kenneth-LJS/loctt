import type { TaskFrontmatterPublic } from "@loctt/contracts";
import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";

import type { ListSearch } from "../../router/listSearch.ts";
import { apiClient } from "../client.ts";

interface TasksPage {
  readonly items: readonly TaskFrontmatterPublic[];
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
  /**
   * Task files that exist and could not be parsed (ERR-9).
   *
   * The rows that *did* load are in `items` — one corrupt neighbour no
   * longer takes down the read. These are reported so the surface can
   * name the file and the YAML error, rather than dropping the task
   * silently and leaving the count unexplainable against what is on
   * disk.
   */
  readonly unreadable?: readonly {
    readonly id: string;
    readonly path: string;
    readonly reason: string;
  }[];
  /**
   * The saved view the URL asked for, which no longer exists in
   * `queries.yaml` (XS-28).
   *
   * The server falls back to the unfiltered list rather than erroring,
   * and names what it dropped so the surface can say so. Silence here
   * is indistinguishable from an ordinary unfiltered result.
   */
  readonly missing_view?: string;
}

/** Default page size for the list view (matches the mockup's "of N"). */
export const DEFAULT_LIST_LIMIT = 50;

/**
 * How long a list read may hang before the UI stops waiting.
 *
 * LST-52: the skeleton must not spin indefinitely with no terminal
 * state. Nothing is at stake in an unanswered read, so unlike a write
 * this reports a plain failure with a retry rather than an unknown
 * data state — the tasks either arrived or they did not.
 *
 * Overridable from the page so a spec can exercise the deadline
 * without waiting the full interval; Playwright's clock control does
 * not reach the abort timer.
 */
const READ_TIMEOUT_MS = Number(
  (globalThis as { __LOCTT_READ_TIMEOUT_MS__?: unknown }).__LOCTT_READ_TIMEOUT_MS__ ?? 20_000,
);

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
  // Custom-field filters (`field.team=platform`). These are not in
  // FILTER_KEYS because the set is per-workspace, so they have to be
  // carried by shape rather than by name — and dropping them is
  // exactly the failure LST-16 was written against: the chip and the
  // URL param both appeared while the result set never narrowed.
  for (const [key, v] of Object.entries(search)) {
    if (!key.startsWith("field.")) continue;
    if (Array.isArray(v) && v.length > 0) filters[key] = v as readonly string[];
    else if (typeof v === "string" && v !== "") filters[key] = [v];
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

/**
 * Exported so the export menu builds its URL from the *same* function
 * the list request uses (BLK-37). Two builders drift, and a filter
 * dropped from one of them yields a same-sized file with different
 * rows — which is exactly what that case warns about.
 *
 * `offset` overrides the page-derived one. The infinite feed asks for
 * an absolute offset per page; the single-page hook derives it from
 * `page`. Both end up as the same `?limit&offset` the server reads.
 */
export function buildQueryString(params: TasksQueryParams & { offset?: number }): string {
  const limit = params.limit ?? DEFAULT_LIST_LIMIT;
  const page = params.page ?? 1;
  const offset = params.offset ?? (page - 1) * limit;
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
  // Custom fields, by shape rather than by name — the set is
  // per-workspace, so a fixed key list cannot carry them. Both halves
  // of the round trip need this: the parser above and the serializer
  // here. Missing it in *either* leaves the chip and the URL param
  // showing while the result set never narrows (LST-16), which is the
  // failure that case was rewritten to catch.
  for (const [key, v] of Object.entries(params)) {
    if (!key.startsWith("field.")) continue;
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
      apiClient.get<TasksPage>(`/api/tasks?${buildQueryString(params)}`, { signal, timeoutMs: READ_TIMEOUT_MS }),
    placeholderData: keepPreviousData,
  });
}

/**
 * The list view's paginated feed. "Load more" appends rows in place
 * rather than replacing the page, so this accumulates pages under one
 * query key.
 *
 * Why infinite rather than a page counter in the URL: LST-13 wants
 * rows 51–100 *appended* to 1–50, and LST-35 wants a page-2 response
 * that lost a race to never appear. Both fall out of the query key —
 * changing a filter builds a different key, so the superseded request
 * resolves into the old key's cache where nothing reads it. A manual
 * `[...rows, ...next]` merge has to re-derive that, and gets it wrong
 * the moment two responses overlap.
 *
 * `page` in the URL is deliberately *not* part of this key. It seeds
 * how many pages to restore (LST-17) and is rewritten as the user
 * loads more; folding it into the key would make every "Load more" a
 * cache miss and discard the rows already on screen.
 */
export function useTasksFeed(params: TasksQueryParams) {
  const limit = params.limit ?? DEFAULT_LIST_LIMIT;
  // Strip `page`: it seeds the initial page count, not the identity of
  // the feed. Two views differing only by how far they have scrolled
  // are the same feed.
  const { page: _page, ...feedParams } = params;

  return useInfiniteQuery({
    queryKey: ["tasks-feed", feedParams],
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      apiClient.get<TasksPage>(
        `/api/tasks?${buildQueryString({ ...feedParams, limit, offset: pageParam })}`,
        { signal, timeoutMs: READ_TIMEOUT_MS },
      ),
    getNextPageParam: (last: TasksPage) => {
      const loaded = last.offset + last.items.length;
      // A short page means the server had nothing more, even if `total`
      // disagrees — trusting `total` alone would loop forever against a
      // tracker mutating underneath us.
      if (last.items.length === 0) return undefined;
      return loaded < last.total ? loaded : undefined;
    },
    placeholderData: keepPreviousData,
  });
}
