import type { QueriesConfig, Task, WorkflowConfig } from "@loctt/contracts";

import type { EvalContext } from "./evaluator.js";
import { evaluateQuery } from "./evaluator.js";
import { parseQuery } from "./parser.js";
import { tokenize } from "./tokenizer.js";

/** Filter/sort options within a list call. */
export interface ListOptions {
  /** Ad hoc query string. */
  readonly query?: string;
  /** Named saved view from queries.yaml. */
  readonly view?: string;
  /** Sort specifiers. Overrides view sort if provided. */
  readonly sort?: readonly { field: string; direction: "asc" | "desc" }[];
  /** Maximum number of results. Defaults to 30. */
  readonly limit?: number;
}

/** Full options bag for listTasks. */
export interface ListTasksOptions {
  readonly tasks: readonly Task[];
  readonly options: ListOptions;
  readonly queriesConfig?: QueriesConfig;
  readonly workflowConfig?: WorkflowConfig;
  readonly ctx?: ListContext;
}

/** Context provider for building EvalContext per task. */
export interface ListContext {
  /** Returns the body for a given task ID. */
  readonly getBody?: (taskId: string) => string | undefined;
  /** Resolves a task ID to its key. */
  readonly resolveKey?: (id: string) => string | undefined;
}

/**
 * Builds a ListContext with a resolveKey function from a task array.
 * This enables parent-key queries like `parent = T-5` in list surfaces.
 */
export function buildListContext(tasks: readonly Task[]): ListContext {
  const idToKey = new Map<string, string>();
  for (const task of tasks) {
    idToKey.set(task.frontmatter.id, task.frontmatter.key);
  }
  return {
    resolveKey: (id: string) => idToKey.get(id),
  };
}

/**
 * Resolves a named view from queries config.
 * Returns undefined if the view name is not found.
 */
export function resolveView(
  queriesConfig: QueriesConfig,
  viewName: string,
): QueriesConfig["queries"][number] | undefined {
  return queriesConfig.queries.find(q => q.name === viewName);
}

/**
 * Filters and sorts tasks according to ListOptions.
 * Applies query filtering, sorting, and limit.
 */
export function listTasks(opts: ListTasksOptions): Task[] {
  const { tasks, options, queriesConfig, workflowConfig, ctx = {} } = opts;
  let queryStr: string | undefined = options.query;
  let sortSpec = options.sort;

  // Resolve view if specified
  if (options.view && queriesConfig) {
    const view = resolveView(queriesConfig, options.view);
    if (!view) {
      throw new Error(`unknown view "${options.view}"`);
    }
    if (!queryStr) queryStr = view.query;
    if (!sortSpec && view.sort) sortSpec = view.sort;
  }

  // Filter by query
  let filtered: Task[];
  if (queryStr) {
    const tokens = tokenize(queryStr);
    const ast = parseQuery(tokens);
    filtered = tasks.filter(task => {
      const evalCtx: EvalContext = {
        body: ctx.getBody?.(task.frontmatter.id),
        resolveKey: ctx.resolveKey,
      };
      return evaluateQuery(ast, task.frontmatter, evalCtx);
    });
  } else {
    filtered = [...tasks];
  }

  // Sort
  if (sortSpec && sortSpec.length > 0) {
    const priorityMap = buildPriorityMap(workflowConfig);

    filtered.sort((a, b) => {
      for (const spec of sortSpec) {
        const cmp = compareTasks(a, b, spec.field, spec.direction, priorityMap);
        if (cmp !== 0) return cmp;
      }
      return 0;
    });
  } else {
    // Default sort: most recently updated first
    filtered.sort((a, b) =>
      b.frontmatter.updated_at.localeCompare(a.frontmatter.updated_at),
    );
  }

  // Limit
  const limit = options.limit ?? 30;
  return filtered.slice(0, limit);
}

function buildPriorityMap(
  config: WorkflowConfig | undefined,
): Map<string, number> {
  const map = new Map<string, number>();
  if (!config) return map;
  for (const p of config.priorities) {
    if (p.value !== undefined) {
      map.set(p.key, p.value);
    }
  }
  return map;
}

function getTaskFieldValue(task: Task, field: string): unknown {
  const fm = task.frontmatter as unknown as Record<string, unknown>;
  if (field in fm) return fm[field];
  if (task.frontmatter.fields && field in task.frontmatter.fields) {
    return task.frontmatter.fields[field];
  }
  return undefined;
}

function compareTasks(
  a: Task,
  b: Task,
  field: string,
  direction: "asc" | "desc",
  priorityMap: Map<string, number>,
): number {
  let aVal = getTaskFieldValue(a, field);
  let bVal = getTaskFieldValue(b, field);

  // Use numeric priority values for sorting if available
  if (field === "priority") {
    const aNum = priorityMap.get(String(aVal));
    const bNum = priorityMap.get(String(bVal));
    if (aNum !== undefined) aVal = aNum;
    if (bNum !== undefined) bVal = bNum;
  }

  // Handle undefined — push to end regardless of direction
  if (aVal === undefined && bVal === undefined) return 0;
  if (aVal === undefined) return 1;
  if (bVal === undefined) return -1;

  // Try numeric comparison
  if (typeof aVal === "number" && typeof bVal === "number") {
    const cmp = aVal - bVal;
    return direction === "desc" ? -cmp : cmp;
  }

  // Objects/arrays can't be meaningfully sorted as strings — treat as equal
  if (typeof aVal === "object" || typeof bVal === "object") return 0;

  const aStr = String(aVal as string | number | boolean);
  const bStr = String(bVal as string | number | boolean);
  const cmp = aStr.localeCompare(bStr);
  return direction === "desc" ? -cmp : cmp;
}
