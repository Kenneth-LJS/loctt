import type { LocttState, RekeyLoser, RekeyPlan, RekeySkip, Task } from "@loctt/contracts";

import { appendKeyHistory } from "../state/keys.js";

export type { RekeyLoser, RekeyPlan, RekeySkip } from "@loctt/contracts";

export interface RekeyResult {
  readonly taskId: string;
  readonly oldKey: string;
  readonly newKey: string;
  readonly keyHistory: readonly string[];
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
 * Computes the rekey plan for a set of tasks WITHOUT applying it: which
 * tasks would be renumbered, the keeper each lost to, the tiebreak that
 * decided it, both timestamps and ULIDs, and the key each loser would
 * take. Applies nothing and does not mutate `state`.
 *
 * This is the single source of truth for both the web UI preview (K92 —
 * shown before a confirm) and the applied `rekeyCollisions` below, which
 * is expressed in terms of it. The two therefore cannot disagree on
 * keeper, loser, or new key for the same input — the anti-drift
 * invariant.
 *
 * Keys are allocated **per project** — `state.keys` is indexed by project
 * id, and each project owns its own prefix and counter. A colliding task
 * therefore takes its replacement key from its own project's counter, so
 * a `WEB-` task can never be rekeyed into `API-`. When several losers
 * share a project, each takes the next sequential number, so the preview
 * shows exactly the keys the apply will allocate.
 *
 * Ordering is `created_at`, with the ULID `id` as a deterministic
 * tiebreak. Both sides of a sync must reach the same answer from the same
 * inputs or they diverge, so the rule cannot depend on which side is
 * running it.
 */
export function previewRekey(
  tasks: readonly Task[],
  state: LocttState,
): RekeyPlan {
  // Group tasks by current key.
  const byKey = new Map<string, Task[]>();
  for (const task of tasks) {
    const key = task.frontmatter.key;
    const group = byKey.get(key) ?? [];
    group.push(task);
    byKey.set(key, group);
  }

  const losers: RekeyLoser[] = [];
  const skipped: RekeySkip[] = [];

  // Local, per-project simulation of the counters so several losers in
  // one project preview the same sequential keys the apply will hand out.
  // Never written back — a preview mutates nothing.
  const nextNumberByProject = new Map<string, number>();

  // Group iteration order does not affect correctness, but sort keys so
  // two runs over the same task set preview the losers in the same order
  // (a Map preserves insertion order, which depends on task order).
  const keys = [...byKey.keys()].sort((a, b) => a.localeCompare(b));

  for (const key of keys) {
    const group = byKey.get(key);
    if (group === undefined || group.length <= 1) continue;

    // Sort: earlier created_at keeps the key, tie-break by id. created_at
    // is optional now (K26); a degraded timestamp sorts as "" (earliest),
    // and the id tie-break keeps the order deterministic regardless.
    const sorted = [...group].sort((a, b) => {
      const cmp = (a.frontmatter.created_at ?? "").localeCompare(b.frontmatter.created_at ?? "");
      if (cmp !== 0) return cmp;
      return a.frontmatter.id.localeCompare(b.frontmatter.id);
    });

    // First task keeps the key, rest get rekeyed.
    const keeper = sorted[0];
    if (keeper === undefined) continue;
    for (const task of sorted.slice(1)) {
      // Whether the timestamps tied (so the ULID decided) or created_at
      // was strictly earlier — stated in the summary (GIT-8/GIT-9).
      const tiebreak =
        (keeper.frontmatter.created_at ?? "") === (task.frontmatter.created_at ?? "")
          ? "ulid"
          : "created_at";

      const base: Omit<RekeyLoser, "newKey"> = {
        key: task.frontmatter.key,
        loserId: task.frontmatter.id,
        loserCreatedAt: task.frontmatter.created_at ?? null,
        keeperId: keeper.frontmatter.id,
        keeperCreatedAt: keeper.frontmatter.created_at ?? null,
        tiebreak,
      };

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

      const nextNumber = nextNumberByProject.get(projectId) ?? projectEntry.next_number;
      // K88: prefix is stored bare; the "-" is inserted at render.
      const newKey = `${projectEntry.prefix}-${nextNumber}`;
      nextNumberByProject.set(projectId, nextNumber + 1);

      losers.push({ ...base, newKey });
    }
  }

  return { losers, skipped };
}

/**
 * Resolves key collisions by rekeying tasks with later `created_at`.
 * Mutates `state` to allocate new keys. Returns what it did and what it
 * could not do.
 *
 * Derived from `previewRekey` — the same plan the UI shows — so the applied
 * result cannot drift from the preview on keeper, loser, or new key.
 */
export function rekeyCollisions(
  tasks: readonly Task[],
  state: LocttState,
): RekeyOutcome {
  const plan = previewRekey(tasks, state);

  const byId = new Map<string, Task>();
  for (const task of tasks) byId.set(task.frontmatter.id, task);

  const rekeyed: RekeyResult[] = [];

  for (const loser of plan.losers) {
    // A loser always carries a `newKey` (a project with no counter goes to
    // `skipped`, never `losers`); guard defensively for the type.
    if (loser.newKey === undefined) continue;
    const task = byId.get(loser.loserId);
    if (task === undefined) continue;
    const projectId = task.frontmatter.project;
    if (projectId === undefined) continue;
    const projectEntry = state.keys[projectId];
    if (!projectEntry) continue;

    // Advance the real counter. The preview simulated this per project in
    // the same order, so `next_number` here matches the number baked into
    // `loser.newKey`.
    state.keys[projectId] = {
      prefix: projectEntry.prefix,
      next_number: projectEntry.next_number + 1,
    };

    const keyHistory = appendKeyHistory(
      task.frontmatter.key_history,
      task.frontmatter.key,
    );

    rekeyed.push({
      taskId: loser.loserId,
      oldKey: loser.key,
      newKey: loser.newKey,
      keyHistory,
    });
  }

  return { rekeyed, skipped: plan.skipped };
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
