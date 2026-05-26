import { loadAllTasks } from "./load-all.js";

/**
 * Kinds of references a task may hold to an entity. Used by
 * {@link countTasksByReference} to scope the count.
 *
 * - `project`, `milestone`, `sprint`, `assignee`, `reporter`: scalar
 *   frontmatter fields. A task references the entity when the field
 *   value equals the given id.
 * - `label`: membership in the `labels[]` array.
 */
export type TaskReferenceKind =
  | "project"
  | "milestone"
  | "sprint"
  | "assignee"
  | "reporter"
  | "label";

export interface CountTasksByReferenceOptions {
  readonly includeArchived?: boolean;
}

/**
 * Returns the number of tasks that reference the given entity id.
 * For `label`, checks `labels[]` membership; for everything else,
 * checks the matching scalar frontmatter field.
 *
 * Archived tasks are excluded by default — set `includeArchived: true`
 * to include them.
 */
export async function countTasksByReference(
  locttDir: string,
  kind: TaskReferenceKind,
  id: string,
  options?: CountTasksByReferenceOptions,
): Promise<number> {
  const counts = await countTasksByReferences(locttDir, kind, [id], options);
  return counts[id] ?? 0;
}

/**
 * Batched form of {@link countTasksByReference}. One scan of all tasks
 * produces counts for every id in `ids`. Returns a record keyed by id.
 * Ids not referenced anywhere appear with count 0.
 */
export async function countTasksByReferences(
  locttDir: string,
  kind: TaskReferenceKind,
  ids: readonly string[],
  options?: CountTasksByReferenceOptions,
): Promise<Record<string, number>> {
  const result: Record<string, number> = Object.create(null) as Record<string, number>;
  for (const id of ids) result[id] = 0;
  if (ids.length === 0) return result;

  const idSet = new Set(ids);
  const includeArchived = options?.includeArchived ?? false;
  const tasks = await loadAllTasks(locttDir);

  for (const t of tasks) {
    if (!includeArchived && t.frontmatter.archived) continue;
    if (kind === "label") {
      for (const lid of t.frontmatter.labels ?? []) {
        if (idSet.has(lid)) result[lid] = (result[lid] ?? 0) + 1;
      }
      continue;
    }
    const value = t.frontmatter[kind];
    if (typeof value === "string" && idSet.has(value)) {
      result[value] = (result[value] ?? 0) + 1;
    }
  }
  return result;
}
