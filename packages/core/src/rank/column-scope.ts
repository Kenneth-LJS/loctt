import type { WorkflowConfig } from "@loctt/contracts";

import { deriveColumns } from "../board/index.js";

/**
 * The pseudo-column for tasks with no `status` at all.
 *
 * `deriveColumns` gives a status-less task no column: `bucketTasks`
 * drops it and the orphan bucket skips `status === undefined`, so the
 * board never renders it. But a task with no status is still a task
 * with a `board_rank` — core ranked them before K8 (column ===
 * `undefined`, peers === the other status-less tasks) and core's own
 * rebalance fixtures create exactly such tasks.
 *
 * So they keep their own sequence: status-less tasks are peers of each
 * other and of nothing else. This preserves pre-K8 behaviour for them
 * exactly, rather than inventing an answer where `deriveColumns` has
 * none. Recorded as A34.
 */
export const STATUSLESS_COLUMN = Symbol("statusless-column");

/**
 * The set of statuses sharing a board column with `status`.
 *
 * Derived through `deriveColumns` so core groups columns the same way
 * the board draws them (K8) — one definition, no drift. A status that
 * belongs to no column (which `deriveColumns` only produces when the
 * status is absent) falls back to the status-less pseudo-column.
 */
export function columnStatusesFor(
  workflow: WorkflowConfig,
  allTasks: readonly { readonly frontmatter: { readonly status?: string | undefined } }[],
  status: string | undefined,
): ReadonlySet<string> | typeof STATUSLESS_COLUMN {
  if (status === undefined) return STATUSLESS_COLUMN;
  // Tasks are passed so the orphan column (BRD-18) can exist: a status
  // the config dropped is knowable only from the tasks that carry it.
  const columns = deriveColumns(
    workflow,
    allTasks.map((t, i) => ({
      id: String(i),
      created_at: "",
      ...(t.frontmatter.status !== undefined ? { status: t.frontmatter.status } : {}),
    })),
  );
  const column = columns.find(c => c.statuses.includes(status));
  // Not in any column: `deriveColumns` covers every status the config
  // declares plus every one a task actually carries, so this is
  // unreachable for a status a task holds. Fall back to a column of
  // exactly that status rather than widening to everything.
  if (column === undefined) return new Set([status]);
  return new Set(column.statuses);
}

