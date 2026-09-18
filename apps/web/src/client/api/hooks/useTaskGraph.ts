import type { TaskFrontmatterPublic } from "@loctt/contracts";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import type { TaskIndex } from "../../relationships/tree.ts";
import { buildTaskIndex } from "../../relationships/tree.ts";
import { apiClient } from "../client.ts";

/**
 * Every task's frontmatter, indexed by id, for the relationships
 * panel's tree render (REL-5, REL-21).
 *
 * `GET /api/tasks/:ref` resolves one task's own edges and stops there.
 * A subtree needs each child's children, which would otherwise be one
 * request per node — and REL-28's last bullet forbids the panel
 * refetching per row. `/api/tasks` returns full public frontmatter,
 * `relationships` included, so one response carries the whole graph.
 *
 * `archived=true` because a hierarchy does not stop at an archived
 * node: REL-30's last bullet says an existing link to a task archived
 * later still renders, and a subtree with a hole in it where an
 * archived parent used to be would be a lie about the shape.
 *
 * Its own query key rather than the list view's: `["tasks", params]`
 * is keyed by whatever filter the user last had, so reading it here
 * would give a graph missing every task the list happens to exclude.
 *
 * The limit is the server's own maximum rather than a paginated walk.
 * `parsePagination` caps `limit` at 1000 and **rejects anything
 * larger with a 400** — measured, not assumed: `?limit=5000` answers
 * `"limit must be at most 1000"`, and the first draft of this hook
 * asked for 5000 and got an empty index for every tracker.
 *
 * A tracker with more than 1000 tasks therefore renders a shallower
 * tree, which the walk already degrades to honestly — every child the
 * index cannot resolve becomes a leaf, and the task's own direct edges
 * still render from the task response. Paging the whole tracker to
 * draw one subtree would cost more than the depth is worth.
 */
const GRAPH_LIMIT = 1000;

interface TasksPage {
  readonly items: readonly TaskFrontmatterPublic[];
  readonly total: number;
}

export function useTaskGraph(): TaskIndex {
  const query = useQuery({
    queryKey: ["task-graph"],
    queryFn: ({ signal }) =>
      apiClient.get<TasksPage>(
        `/api/tasks?limit=${String(GRAPH_LIMIT)}&archived=true`,
        { signal },
      ),
  });
  // Memoised on the response, not rebuilt per render: it is a
  // `useMemo` dependency one level down, and a fresh Map identity each
  // render would rebuild every subtree on every keystroke elsewhere on
  // the page.
  const items = query.data?.items;
  return useMemo(() => buildTaskIndex(items ?? []), [items]);
}
