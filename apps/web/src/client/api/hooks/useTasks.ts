import type { ArchivedScope, TaskFrontmatterPublic } from "@loctt/contracts";
import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";

import type { WireHealth } from "../../health/fieldHealth.ts";
import type { ListSearch } from "../../router/listSearch.ts";
import { apiClient } from "../client.ts";

/**
 * A list row = the public frontmatter plus, when the task is degraded,
 * its per-field health findings (A137 / A137.1).
 *
 * The wire carries `health` end-to-end: `handleListTasks` maps each row
 * through `{ ...projectTaskFrontmatter(t.frontmatter), ...wireHealth(t) }`
 * (server.ts), the same shape `GET /api/tasks/:ref` uses. So a corrupt
 * task shows a per-row marker in the list (UX-11 / DEG-31), rendered by
 * cells.tsx / ListView.tsx off this `health` list. (An earlier note here
 * claimed the server still stripped `health` — it was stale; the
 * `wireHealth` wire-up landed since.) The one deliberate boundary is that
 * the list carries only INTRINSIC health (a wrong-typed field lifted out
 * of frontmatter), not the extrinsic dangling-ref / invalid-enum pass the
 * detail route computes — see `wireHealth`'s SCOPE note in server.ts.
 */
export interface TaskListRow extends TaskFrontmatterPublic {
  /**
   * Field-level health findings on this task. Omitted when the task is
   * clean (same convention as `Task.health`). The list cells read this
   * via `fieldView` to mark a degraded/corrupt field.
   */
  readonly health?: readonly WireHealth[];
}

interface TasksPage {
  readonly items: readonly TaskListRow[];
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
  /**
   * The saved view the URL asked for is present in `queries.yaml` but its
   * filters no longer validate (VUE-22 / P7). Unlike `missing_view`, the
   * view is not gone — it is broken — so the surface shows the parse
   * error rather than a widened unfiltered result.
   *
   * This mirrors exactly what the route emits (`server.ts`, the
   * `broken_view` spread): `id`, `name`, `summary`, `error`, and
   * `position` only when the loader had one. It previously also declared
   * a required `query`, which the server has never sent — the field read
   * `undefined` at runtime while typechecking as a `string`, which is how
   * the banner came to render an empty paragraph and hand `q: undefined`
   * to the editor. `rawText` is deliberately NOT here: it lives on
   * `/api/views`' `broken` entries, which is where a surface reads the
   * bytes still on disk.
   *
   * `position` is a character offset and the loader only has one for a
   * failure that carries it; a Zod shape failure names its path inside
   * `error` instead (`[0].op must be one of: …`). So a surface must treat
   * it as genuinely optional rather than assume every broken view has one.
   */
  readonly broken_view?: {
    readonly id: string;
    readonly name: string;
    readonly summary?: string;
    readonly error: string;
    readonly position?: number;
  };
  /**
   * Warnings core raised while evaluating the query — an unknown field
   * a saved view still filters on, for instance. The CLI and MCP both
   * pass `onWarning` and print these; the web dropped them, so a view
   * naming a deleted custom field returned 200 with zero rows and no
   * reason. Same failure as `missing_view` above: silence here is
   * indistinguishable from a legitimate empty result, which is what
   * VUE-21's second bullet forbids.
   */
  readonly warnings?: readonly {
    readonly field: string;
    readonly message: string;
    readonly position?: number;
    readonly suggestions?: readonly string[];
  }[];
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
  /**
   * K107: tri-state archived scope. Omitted means the server default
   * (`active`, hide archived). Only `archived`/`all` change the request.
   */
  readonly archived?: ArchivedScope;
  /** LST-40/MSL-7: match ALL selected labels (AND) vs ANY (OR, default). */
  readonly labels_match?: "all" | "any";
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
    // K107: only carry a non-default scope; `active` is the server default
    // and stays out of the params (and the URL) to keep both clean.
    ...(search.archived !== undefined && search.archived !== "active"
      ? { archived: search.archived }
      : {}),
    ...(search.labels_match !== undefined ? { labels_match: search.labels_match } : {}),
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
  // K107: send the tri-state scope only when it is non-default. `active`
  // is the server default, so omit it — both to keep the URL tidy and so
  // an export link matches the list's default request byte for byte.
  if (params.archived !== undefined && params.archived !== "active") {
    sp.set("archived", params.archived);
  }
  // LST-40/MSL-7: only send `labels_match=all` (the AND opt-in); `any` is
  // the server default, so omit it to keep URLs and export links tidy.
  if (params.labels_match === "all") sp.set("labels_match", "all");
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
