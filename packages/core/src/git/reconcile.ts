import type { Task, LocttState } from "@loctt/contracts";
import { appendKeyHistory } from "../state/keys.js";

export interface RekeyResult {
  readonly taskId: string;
  readonly oldKey: string;
  readonly newKey: string;
}

/**
 * Resolves key collisions by rekeying tasks with later created_at.
 * Mutates state to allocate new keys. Returns rekey actions taken.
 */
export function rekeyCollisions(
  tasks: readonly Task[],
  state: LocttState,
): RekeyResult[] {
  // Group tasks by current key
  const byKey = new Map<string, Task[]>();
  for (const task of tasks) {
    const key = task.frontmatter.key;
    const group = byKey.get(key) ?? [];
    group.push(task);
    byKey.set(key, group);
  }

  const results: RekeyResult[] = [];

  for (const [, group] of byKey) {
    if (group.length <= 1) continue;

    // Sort: earlier created_at keeps the key, tie-break by id
    group.sort((a, b) => {
      const cmp = a.frontmatter.created_at.localeCompare(b.frontmatter.created_at);
      if (cmp !== 0) return cmp;
      return a.frontmatter.id.localeCompare(b.frontmatter.id);
    });

    // First task keeps the key, rest get rekeyed
    for (let i = 1; i < group.length; i++) {
      const task = group[i]!;
      const taskEntry = state.keys["task"];
      if (!taskEntry) continue;

      const newKey = `${taskEntry.prefix}${taskEntry.next_number}`;
      (state.keys as Record<string, { prefix: string; next_number: number }>)["task"] = {
        prefix: taskEntry.prefix,
        next_number: taskEntry.next_number + 1,
      };

      results.push({
        taskId: task.frontmatter.id,
        oldKey: task.frontmatter.key,
        newKey,
      });

      // Update the task's frontmatter (in-place mutation for caller to persist)
      const mutableFm = task.frontmatter as unknown as Record<string, unknown>;
      mutableFm["key_history"] = appendKeyHistory(
        task.frontmatter.key_history,
        task.frontmatter.key,
      );
      mutableFm["key"] = newKey;
    }
  }

  return results;
}

/**
 * Merges two sets of relationships by union of (type, target) pairs.
 */
export function mergeRelationships(
  a: readonly { type: string; target: string }[],
  b: readonly { type: string; target: string }[],
): { type: string; target: string }[] {
  const seen = new Set<string>();
  const result: { type: string; target: string }[] = [];

  for (const rel of [...a, ...b]) {
    const key = `${rel.type}:${rel.target}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(rel);
    }
  }

  return result;
}

/**
 * Merges key_history by union.
 */
export function mergeKeyHistory(
  a: readonly string[] | undefined,
  b: readonly string[] | undefined,
): string[] | undefined {
  if (!a && !b) return undefined;
  const set = new Set([...(a ?? []), ...(b ?? [])]);
  return set.size > 0 ? [...set] : undefined;
}
