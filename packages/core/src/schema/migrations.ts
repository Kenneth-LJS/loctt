/**
 * Schema migration registry.
 *
 * Each migration is an edge in a directed graph: applying it brings
 * a tracker from format version `from` to format version `to`. Format
 * versions are the semver of the `loctt` release that introduced the
 * format (K142), compared as semver, so consecutive formats are not
 * consecutive numbers (0.1.0 → 0.3.0). Longer jumps are supported so a
 * future fast path can be added without removing the original edges.
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
 * A step that is not `risky` runs automatically the first time any
 * surface opens a tracker that needs it (K143, `upgradeIfSafe`); a
 * risky step waits for `loctt migrate`.
 */

import { rankEveryLink } from "./steps/rank-every-link.js";
import { compareFormatVersions } from "./version.js";

export interface Migration {
  /** Source format version (semver). */
  readonly from: string;
  /** Target format version (semver), newer than `from`. */
  readonly to: string;
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
  {
    from: "0.1.0",
    to: "0.3.0",
    description: "Give every link a rank, in the order it is shown today",
    apply: rankEveryLink,
  },
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
  from: string,
  to: string,
  migrations: readonly Migration[] = MIGRATIONS,
): readonly Migration[] | null {
  if (compareFormatVersions(from, to) === 0) return [];
  if (compareFormatVersions(from, to) > 0) return null; // no rollback support

  // BFS through the edge graph. Track best (shortest, then
  // fewest-deprecated) path to each visited node.
  interface Node {
    readonly version: string;
    readonly path: readonly Migration[];
    readonly deprecatedCount: number;
  }

  const start: Node = { version: from, path: [], deprecatedCount: 0 };
  const visited = new Map<string, { length: number; deprecatedCount: number }>();
  visited.set(from, { length: 0, deprecatedCount: 0 });

  let frontier: Node[] = [start];
  let best: Node | null = null;

  while (frontier.length > 0) {
    const next: Node[] = [];
    for (const node of frontier) {
      // Edges leaving this version
      for (const m of migrations) {
        if (compareFormatVersions(m.from, node.version) !== 0) continue;
        if (compareFormatVersions(m.to, node.version) <= 0) continue; // forward-only
        if (compareFormatVersions(m.to, to) > 0) continue;            // don't overshoot

        const newPath = [...node.path, m];
        const newDepCount = node.deprecatedCount + (m.deprecated ? 1 : 0);
        const candidate: Node = {
          version: m.to,
          path: newPath,
          deprecatedCount: newDepCount,
        };

        if (compareFormatVersions(m.to, to) === 0) {
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
