import type { LocttState,Task } from "@loctt/contracts";

import { appendKeyHistory } from "../state/keys.js";

export interface RekeyResult {
  readonly taskId: string;
  readonly oldKey: string;
  readonly newKey: string;
  readonly keyHistory: readonly string[];
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
    for (const task of group.slice(1)) {
      const taskEntry = state.keys["task"];
      if (!taskEntry) continue;

      const newKey = `${taskEntry.prefix}${taskEntry.next_number}`;
      (state.keys as Record<string, { prefix: string; next_number: number }>)["task"] = {
        prefix: taskEntry.prefix,
        next_number: taskEntry.next_number + 1,
      };

      const keyHistory = appendKeyHistory(
        task.frontmatter.key_history,
        task.frontmatter.key,
      );

      results.push({
        taskId: task.frontmatter.id,
        oldKey: task.frontmatter.key,
        newKey,
        keyHistory,
      });
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
