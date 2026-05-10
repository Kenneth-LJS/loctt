import { withMigrationLock } from "./lock.js";
import { findMigrationPath, type Migration } from "./migrations.js";
import {
  backupLocttDir,
  CURRENT_SCHEMA_VERSION,
  readSchemaVersion,
  SchemaTooNewError,
  SchemaVersionError,
  writeSchemaVersion,
} from "./version.js";

export interface MigrationResult {
  /** Version the tracker was at before migration. */
  readonly from: number;
  /** Version the tracker is at after migration. */
  readonly to: number;
  /** Path to the pre-migration backup. Always set when steps run. */
  readonly backupPath?: string;
  /** Migrations that were applied, in order. Empty if no work was needed. */
  readonly steps: readonly Migration[];
}

export interface MigrationPlan {
  /** Current recorded version. */
  readonly from: number;
  /** Target version (`CURRENT_SCHEMA_VERSION`). */
  readonly to: number;
  /** Migrations the framework would apply, in order. */
  readonly steps: readonly Migration[];
}

/**
 * Computes what migrations would run without performing any work.
 * Use this to preview a migration plan (e.g. for a UI confirmation
 * dialog or a CLI dry run).
 *
 * Throws SchemaVersionError when `.schema-version` is missing or
 * SchemaTooNewError when the tracker is from a newer LocTT.
 */
export async function planMigration(locttDir: string): Promise<MigrationPlan> {
  const recorded = await readSchemaVersion(locttDir);
  if (recorded === null) {
    throw new SchemaVersionError(
      `No .schema-version file found in ${locttDir}. ` +
      `This tracker predates schema versioning and must be re-initialized.`,
    );
  }
  if (recorded > CURRENT_SCHEMA_VERSION) {
    throw new SchemaTooNewError(recorded, CURRENT_SCHEMA_VERSION);
  }
  if (recorded === CURRENT_SCHEMA_VERSION) {
    return { from: recorded, to: recorded, steps: [] };
  }

  const path = findMigrationPath(recorded, CURRENT_SCHEMA_VERSION);
  if (path === null) {
    throw new SchemaVersionError(
      `No migration path found from schema v${recorded} to v${CURRENT_SCHEMA_VERSION}.`,
    );
  }
  return { from: recorded, to: CURRENT_SCHEMA_VERSION, steps: path };
}

/**
 * Brings the tracker at `locttDir` up to `CURRENT_SCHEMA_VERSION`.
 *
 * Behavior:
 *  - Acquires a migration lock for the duration; concurrent callers
 *    serialize. Other writers should refuse to mutate while this
 *    lock is held (see `isMigrationLocked`).
 *  - If `.schema-version` is missing → throws (legacy tracker; user
 *    must re-init).
 *  - If recorded == current → no-op, no backup, no lock work after
 *    the version read.
 *  - If recorded < current → backs up `.loctt/`, computes the
 *    shortest migration path through registered edges, runs each
 *    step, and stamps `.schema-version` after each successful step.
 *  - If recorded > current → throws `SchemaTooNewError`.
 *
 * The backup is created once before any migration runs and is left
 * in place for the user to roll back manually if desired. The
 * framework does not delete backups.
 */
export async function migrateToCurrent(
  locttDir: string,
): Promise<MigrationResult> {
  // Pre-check before taking the lock so the no-op fast path is cheap.
  const recorded = await readSchemaVersion(locttDir);
  if (recorded === null) {
    throw new SchemaVersionError(
      `No .schema-version file found in ${locttDir}. ` +
      `This tracker predates schema versioning and must be re-initialized.`,
    );
  }
  if (recorded > CURRENT_SCHEMA_VERSION) {
    throw new SchemaTooNewError(recorded, CURRENT_SCHEMA_VERSION);
  }
  if (recorded === CURRENT_SCHEMA_VERSION) {
    return { from: recorded, to: recorded, steps: [] };
  }

  return withMigrationLock(locttDir, async () => {
    // Re-read inside the lock in case another process migrated us
    // while we were waiting to acquire the lock.
    const after = await readSchemaVersion(locttDir);
    if (after === null) {
      throw new SchemaVersionError(
        `.schema-version disappeared while waiting for migration lock`,
      );
    }
    if (after > CURRENT_SCHEMA_VERSION) {
      throw new SchemaTooNewError(after, CURRENT_SCHEMA_VERSION);
    }
    if (after === CURRENT_SCHEMA_VERSION) {
      return { from: after, to: after, steps: [] };
    }

    const path = findMigrationPath(after, CURRENT_SCHEMA_VERSION);
    if (path === null || path.length === 0) {
      throw new SchemaVersionError(
        `No migration path found from schema v${after} to v${CURRENT_SCHEMA_VERSION}.`,
      );
    }

    const backupPath = await backupLocttDir(locttDir, after);
    const applied: Migration[] = [];
    let current = after;

    for (const migration of path) {
      if (migration.from !== current) {
        // Defensive: migration order broke our invariant. Bail loudly.
        throw new SchemaVersionError(
          `migration ordering invariant violated: at v${current}, ` +
          `next migration starts at v${migration.from}`,
        );
      }
      await migration.apply(locttDir);
      current = migration.to;
      await writeSchemaVersion(locttDir, current);
      applied.push(migration);
    }

    return { from: after, to: current, backupPath, steps: applied };
  });
}

/**
 * Boot guard. Throws if the tracker's recorded schema version is
 * not exactly `CURRENT_SCHEMA_VERSION`. Use this at the top of
 * CLI/MCP/HTTP entry points to refuse all operations against a
 * tracker that needs migration.
 *
 * Errors:
 *  - Missing `.schema-version` → `SchemaVersionError` (tracker
 *    predates versioning; must be re-initialized).
 *  - Older than current → `SchemaVersionError` with guidance to
 *    run `loctt migrate`.
 *  - Newer than current → `SchemaTooNewError`.
 */
export async function requireSupportedSchema(locttDir: string): Promise<void> {
  const recorded = await readSchemaVersion(locttDir);
  if (recorded === null) {
    throw new SchemaVersionError(
      `No .schema-version file found in ${locttDir}. ` +
      `This tracker predates schema versioning and must be re-initialized.`,
    );
  }
  if (recorded > CURRENT_SCHEMA_VERSION) {
    throw new SchemaTooNewError(recorded, CURRENT_SCHEMA_VERSION);
  }
  if (recorded < CURRENT_SCHEMA_VERSION) {
    throw new SchemaVersionError(
      `Tracker schema is v${recorded}; expected v${CURRENT_SCHEMA_VERSION}. ` +
      `Run \`loctt migrate\` to upgrade.`,
    );
  }
}
