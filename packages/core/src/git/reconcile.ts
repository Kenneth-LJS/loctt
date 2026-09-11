import type { LocttState,Task } from "@loctt/contracts";

import { appendKeyHistory } from "../state/keys.js";

export interface RekeyResult {
  readonly taskId: string;
  readonly oldKey: string;
  readonly newKey: string;
  readonly keyHistory: readonly string[];
}

/** A collision that could not be resolved, and why. */
export interface RekeySkip {
  readonly taskId: string;
  readonly key: string;
  readonly reason: string;
}

export interface RekeyOutcome {
  readonly rekeyed: readonly RekeyResult[];
  /**
   * Collisions left unresolved. Never silently dropped: a task sharing a
   * key with another is exactly the state the caller invoked this to
   * remove, so an unreported skip would leave a duplicate key looking
   * like a successful merge.
   */
  readonly skipped: readonly RekeySkip[];
}

/**
 * Resolves key collisions by rekeying tasks with later `created_at`.
 * Mutates `state` to allocate new keys. Returns what it did and what it
 * could not do.
 *
 * Keys are allocated **per project** — `state.keys` is indexed by project
 * id, and each project owns its own prefix and counter. A colliding task
 * therefore takes its replacement key from its own project's counter, so
 * a `WEB-` task can never be rekeyed into `API-`.
 *
 * Ordering is `created_at`, with the ULID `id` as a deterministic
 * tiebreak. Both sides of a sync must reach the same answer from the same
 * inputs or they diverge, so the rule cannot depend on which side is
 * running it.
 */
export function rekeyCollisions(
  tasks: readonly Task[],
  state: LocttState,
): RekeyOutcome {
  // Group tasks by current key
  const byKey = new Map<string, Task[]>();
  for (const task of tasks) {
    const key = task.frontmatter.key;
    const group = byKey.get(key) ?? [];
    group.push(task);
    byKey.set(key, group);
  }

  const rekeyed: RekeyResult[] = [];
  const skipped: RekeySkip[] = [];

  for (const [, group] of byKey) {
    if (group.length <= 1) continue;

    // Sort: earlier created_at keeps the key, tie-break by id. created_at
    // is optional now (K26); a degraded timestamp sorts as "" (earliest),
    // and the id tie-break keeps the order deterministic regardless.
    group.sort((a, b) => {
      const cmp = (a.frontmatter.created_at ?? "").localeCompare(b.frontmatter.created_at ?? "");
      if (cmp !== 0) return cmp;
      return a.frontmatter.id.localeCompare(b.frontmatter.id);
    });

    // First task keeps the key, rest get rekeyed
    for (const task of group.slice(1)) {
      // `project` is optional on the frontmatter — a task predating the
      // per-project counters has none, and there is no counter to
      // allocate from. Report rather than guess at a default project.
      const projectId = task.frontmatter.project;
      if (projectId === undefined) {
        skipped.push({
          taskId: task.frontmatter.id,
          key: task.frontmatter.key,
          reason: "task has no project, so no key counter to allocate from",
        });
        continue;
      }

      const projectEntry = state.keys[projectId];
      if (!projectEntry) {
        // The task's project has no counter — it was created in a clone
        // whose projects.yaml has not merged yet. Inventing one risks a
        // second collision, so report and leave the key alone.
        skipped.push({
          taskId: task.frontmatter.id,
          key: task.frontmatter.key,
          reason: `no key allocation state for project "${projectId}"`,
        });
        continue;
      }

      // K88: prefix is stored bare; the "-" is inserted at render.
      const newKey = `${projectEntry.prefix}-${projectEntry.next_number}`;
      state.keys[projectId] = {
        prefix: projectEntry.prefix,
        next_number: projectEntry.next_number + 1,
      };

      const keyHistory = appendKeyHistory(
        task.frontmatter.key_history,
        task.frontmatter.key,
      );

      rekeyed.push({
        taskId: task.frontmatter.id,
        oldKey: task.frontmatter.key,
        newKey,
        keyHistory,
      });
    }
  }

  return { rekeyed, skipped };
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
