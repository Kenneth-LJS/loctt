import { rm } from "node:fs/promises";

import { getSchemaMigrationInProgressPath } from "../paths/index.js";
import { withStateLockForMigration } from "../state/lock.js";
import { writeFileAtomically } from "../utils/atomic-yaml.js";
import { fileExists } from "../utils/fs.js";
import { withMigrationLock } from "./lock.js";
import { findMigrationPath, type Migration } from "./migrations.js";
import {
  backupLocttDir,
  CURRENT_SCHEMA_VERSION,
  readSchemaVersion,
  SchemaTooNewError,
  SchemaUnmigratableError,
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
    throw new SchemaUnmigratableError(
      `No .schema-version file found in ${locttDir}. ` +
      `This tracker predates schema versioning and must be re-initialized.`,
      `Re-initialize the tracker with 'loctt init --repair'. 'loctt migrate' cannot help: `
      + `there is no recorded version to migrate from.`,
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
    throw new SchemaUnmigratableError(
      `No .schema-version file found in ${locttDir}. ` +
      `This tracker predates schema versioning and must be re-initialized.`,
      `Re-initialize the tracker with 'loctt init --repair'. 'loctt migrate' cannot help: `
      + `there is no recorded version to migrate from.`,
    );
  }
  if (recorded > CURRENT_SCHEMA_VERSION) {
    throw new SchemaTooNewError(recorded, CURRENT_SCHEMA_VERSION);
  }
  if (recorded === CURRENT_SCHEMA_VERSION) {
    return { from: recorded, to: recorded, steps: [] };
  }

  // Hand-off protocol to plug the migration TOCTOU:
  //   1. Acquire state lock — flushes any in-flight writer.
  //   2. Acquire migration lock — done while still holding state
  //      lock, so no new writer can sneak in between.
  //   3. Release state lock — new writers entering withStateLock
  //      will re-check isMigrationLocked inside their own lock
  //      and bail out cleanly with the "migration in progress"
  //      message, rather than blocking on the state lock for the
  //      whole migration.
  //   4. Run migration under migration lock only.
  return withStateLockForMigration(locttDir, releaseStateEarly =>
    withMigrationLock(locttDir, async () => {
      // Migration lock acquired; release state lock so concurrent
      // writers fail fast instead of queuing on state.yaml.
      await releaseStateEarly();

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
      const sentinelPath = getSchemaMigrationInProgressPath(locttDir);

      for (const migration of path) {
        if (migration.from !== current) {
          // Defensive: migration order broke our invariant. Bail loudly.
          throw new SchemaVersionError(
            `migration ordering invariant violated: at v${current}, ` +
            `next migration starts at v${migration.from}`,
          );
        }
        // Drop a sentinel before applying so a mid-step crash leaves a
        // marker that requireSupportedSchema can refuse to boot against.
        // The sentinel records the from/to pair plus the backup path
        // for recovery guidance. Written atomically (temp-file +
        // rename) so a crash during the write itself can never leave
        // a truncated sentinel whose recovery instructions are
        // unreadable — either the full sentinel is present or none.
        await writeFileAtomically(
          sentinelPath,
          `from: ${migration.from}\nto: ${migration.to}\nbackup: ${backupPath}\n`,
        );
        await migration.apply(locttDir);
        current = migration.to;
        await writeSchemaVersion(locttDir, current);
        // Clear sentinel after the version stamp lands. If we crash
        // between writeSchemaVersion and rm, the next boot sees a
        // version that matches a registered to-version and an orphan
        // sentinel — requireSupportedSchema treats the sentinel as
        // authoritative and refuses to boot.
        await rm(sentinelPath, { force: true });
        applied.push(migration);
      }

      return { from: after, to: current, backupPath, steps: applied };
    }),
  );
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
  // If a previous migration crashed mid-step, a sentinel was left
  // behind. Refuse to boot until the user resolves it manually
  // (typically by restoring from the backup recorded in the sentinel).
  const sentinelPath = getSchemaMigrationInProgressPath(locttDir);
  if (await fileExists(sentinelPath)) {
    throw new SchemaUnmigratableError(
      `A schema migration was interrupted mid-run. ` +
      `See ${sentinelPath} for the recovery instructions and ` +
      `restore from the backup it references before retrying.`,
      `Restore from the backup named in ${sentinelPath}, then remove the sentinel.`,
    );
  }
  const recorded = await readSchemaVersion(locttDir);
  if (recorded === null) {
    throw new SchemaUnmigratableError(
      `No .schema-version file found in ${locttDir}. ` +
      `This tracker predates schema versioning and must be re-initialized.`,
      `Re-initialize the tracker with 'loctt init --repair'. 'loctt migrate' cannot help: `
      + `there is no recorded version to migrate from.`,
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
