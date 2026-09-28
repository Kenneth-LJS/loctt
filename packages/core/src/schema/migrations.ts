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
 * No step runs on its own (K154): every surface refuses an older
 * tracker until the user upgrades it deliberately (`loctt migrate`, MCP
 * `migrate_schema`, the web Upgrade button). `risky` only marks a step
 * in the preview so the user sees it before confirming.
 */

import { rankEveryLink } from "./steps/rank-every-link.js";
import {
  compareFormatVersions,
  CURRENT_SCHEMA_VERSION,
  readSchemaVersion,
  SCHEMA_VERSION_REPAIR,
  SchemaTooNewError,
  SchemaUnmigratableError,
} from "./version.js";

export interface Migration {
  /** Source format version (semver). */
  readonly from: string;
  /** Target format version (semver), newer than `from`. */
  readonly to: string;
  /** Short, human-readable summary: one line in a preview. */
  readonly description: string;
  /**
   * What the step changes, in plain words, for the preview a user reads
   * before confirming an upgrade (K154): `loctt migrate`, MCP
   * `migrate_schema` and the web Upgrade banner all show it.
   */
  readonly changes?: string;
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
    description: "Save the order of every task's links",
    changes: "Each task's links keep the order they are shown in today, and that order is saved "
      + "so you can rearrange them. Task files and workflow.yaml are rewritten. "
      + "Titles, descriptions, dates and history don't change.",
    apply: rankEveryLink,
  },
];

export function listMigrations(): readonly Migration[] {
  return MIGRATIONS;
}

/**
 * Every format this build knows, oldest first: the current one and each
 * end of a registered migration.
 */
export function knownFormats(migrations: readonly Migration[] = MIGRATIONS): string[] {
  const all = new Set<string>([CURRENT_SCHEMA_VERSION]);
  for (const m of migrations) {
    all.add(m.from);
    all.add(m.to);
  }
  return [...all].sort(compareFormatVersions);
}

/**
 * The format a recorded version stands for (K142: *"find the highest
 * version that's lower/at the data version"*): the highest known format
 * at or below it. `0.2.1` is format `0.1.0`, since no release between
 * them changed the format.
 *
 * - Above `CURRENT_SCHEMA_VERSION`: refused as too new, naming the
 *   release. A build always writes the format version it knows, never
 *   its own release, so a higher number on disk was written by a build
 *   that introduced a format this one has never seen.
 * - Below the first format (`0.1.0`): not a LocTT format at all; refused
 *   with what to write instead, never with `loctt migrate` (there is
 *   nothing to migrate from).
 */
export function formatForRecordedVersion(
  recorded: string,
  migrations: readonly Migration[] = MIGRATIONS,
): string {
  if (compareFormatVersions(recorded, CURRENT_SCHEMA_VERSION) > 0) {
    throw new SchemaTooNewError(recorded, CURRENT_SCHEMA_VERSION);
  }
  const formats = knownFormats(migrations);
  let found: string | undefined;
  for (const f of formats) {
    if (compareFormatVersions(f, recorded) <= 0) found = f;
  }
  if (found === undefined) {
    throw new SchemaUnmigratableError(
      `.schema-version holds ${recorded}, which is not a LocTT format. The first format is ${formats[0] ?? CURRENT_SCHEMA_VERSION}.`,
      SCHEMA_VERSION_REPAIR,
    );
  }
  return found;
}

/** A recorded version and the known format it stands for. */
export interface RecordedFormat {
  /** What `.schema-version` holds, as written. */
  readonly recorded: string;
  /** The known format it stands for (`formatForRecordedVersion`). */
  readonly format: string;
}

/**
 * Reads `.schema-version` and resolves it to a known format. Null when
 * the file is absent; throws as `readSchemaVersion` and
 * `formatForRecordedVersion` do.
 */
export async function readRecordedFormat(locttDir: string): Promise<RecordedFormat | null> {
  const recorded = await readSchemaVersion(locttDir);
  if (recorded === null) return null;
  return { recorded, format: formatForRecordedVersion(recorded) };
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
