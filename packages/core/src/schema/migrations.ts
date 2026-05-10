/**
 * Schema migration registry.
 *
 * Each migration is an edge in a directed graph: applying it brings
 * a tracker from version `from` to version `to`. Most migrations are
 * single-step (`to === from + 1`), but longer jumps are supported so
 * a future "skip the buggy v7" fast path can be added without
 * removing the original v6→v7 / v7→v8 edges.
 *
 * The framework finds the shortest path through registered edges
 * and runs them in order. When two paths have equal length,
 * non-deprecated edges win.
 *
 * Each migration must be:
 *  - Idempotent: re-running it on already-migrated data is a no-op.
 *  - Atomic per step: either fully complete or leave no partial
 *    state. The framework backs up the entire `.loctt/` folder
 *    before running any migrations and stamps `.schema-version`
 *    only after each step succeeds.
 *
 * The framework is in place from day one but unused until the first
 * post-release schema change.
 */

export interface Migration {
  /** Source version. */
  readonly from: number;
  /** Target version. Usually `from + 1`. May be larger for skip-paths. */
  readonly to: number;
  /** Short, human-readable summary shown in logs. */
  readonly description: string;
  /** Whether this migration is non-trivially destructive or risky. */
  readonly risky?: boolean;
  /**
   * If true, this edge is preferred only when no shorter or
   * non-deprecated path exists. Use this to nudge users toward a
   * fast-path replacement (e.g. v6→v8 direct) while keeping the
   * original v6→v7 and v7→v8 edges available for users already on
   * v7.
   */
  readonly deprecated?: boolean;
  /** Performs the migration. Must be idempotent. */
  readonly apply: (locttDir: string) => Promise<void>;
}

const MIGRATIONS: readonly Migration[] = [
  // No migrations registered yet. The first real migration will
  // appear here once a post-release schema change is needed.
];

export function listMigrations(): readonly Migration[] {
  return MIGRATIONS;
}

/**
 * Finds the shortest path from `from` to `to` through registered
 * migrations. Returns the ordered list of migrations to apply.
 *
 * Tiebreaker: when multiple paths have the same length, prefer the
 * one that uses fewer deprecated edges.
 *
 * Returns null if no path exists or if `from === to` (no work).
 */
export function findMigrationPath(
  from: number,
  to: number,
  migrations: readonly Migration[] = MIGRATIONS,
): readonly Migration[] | null {
  if (from === to) return [];
  if (from > to) return null; // no rollback support

  // BFS through the edge graph. Track best (shortest, then
  // fewest-deprecated) path to each visited node.
  interface Node {
    readonly version: number;
    readonly path: readonly Migration[];
    readonly deprecatedCount: number;
  }

  const start: Node = { version: from, path: [], deprecatedCount: 0 };
  const visited = new Map<number, { length: number; deprecatedCount: number }>();
  visited.set(from, { length: 0, deprecatedCount: 0 });

  let frontier: Node[] = [start];
  let best: Node | null = null;

  while (frontier.length > 0) {
    const next: Node[] = [];
    for (const node of frontier) {
      // Edges leaving this version
      for (const m of migrations) {
        if (m.from !== node.version) continue;
        if (m.to <= node.version) continue; // forward-only
        if (m.to > to) continue;             // don't overshoot

        const newPath = [...node.path, m];
        const newDepCount = node.deprecatedCount + (m.deprecated ? 1 : 0);
        const candidate: Node = {
          version: m.to,
          path: newPath,
          deprecatedCount: newDepCount,
        };

        if (m.to === to) {
          // Reached destination. Keep the best candidate by
          // (length asc, deprecatedCount asc).
          if (
            best === null ||
            candidate.path.length < best.path.length ||
            (candidate.path.length === best.path.length &&
              candidate.deprecatedCount < best.deprecatedCount)
          ) {
            best = candidate;
          }
          continue;
        }

        // Otherwise enqueue if this is an improvement.
        const existing = visited.get(m.to);
        const better =
          existing === undefined ||
          newPath.length < existing.length ||
          (newPath.length === existing.length &&
            newDepCount < existing.deprecatedCount);
        if (better) {
          visited.set(m.to, { length: newPath.length, deprecatedCount: newDepCount });
          next.push(candidate);
        }
      }
    }
    frontier = next;
  }

  return best === null ? null : best.path;
}
