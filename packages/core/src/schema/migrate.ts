import { rm } from "node:fs/promises";

import { getSchemaMigrationInProgressPath } from "../paths/index.js";
import { withStateLockForMigration } from "../state/lock.js";
import { writeFileAtomically } from "../utils/atomic-yaml.js";
import { fileExists } from "../utils/fs.js";
import { isMigrationLocked, withMigrationLock } from "./lock.js";
import { findMigrationPath, type Migration } from "./migrations.js";
import {
  backupLocttDir,
  compareFormatVersions,
  CURRENT_SCHEMA_VERSION,
  readSchemaVersion,
  SchemaTooNewError,
  SchemaUnmigratableError,
  SchemaVersionError,
  writeSchemaVersion,
} from "./version.js";

export interface MigrationResult {
  /** Format version the tracker was at before migration. */
  readonly from: string;
  /** Format version the tracker is at after migration. */
  readonly to: string;
  /** Path to the pre-migration backup. Always set when steps run. */
  readonly backupPath?: string;
  /** Migrations that were applied, in order. Empty if no work was needed. */
  readonly steps: readonly Migration[];
}

export interface MigrationPlan {
  /** Current recorded format version. */
  readonly from: string;
  /** Target format version (`CURRENT_SCHEMA_VERSION`). */
  readonly to: string;
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
  // Same refusal as migrateToCurrent, and for the same reason: a plan
  // computed over a half-migrated workspace describes work that does not
  // match what is on disk. `loctt migrate` calls this first and returns
  // early on an empty plan, so without the check here the sentinel was
  // reachable but never consulted on the one path that matters.
  const sentinel = getSchemaMigrationInProgressPath(locttDir);
  if (await fileExists(sentinel)) {
    throw new SchemaUnmigratableError(
      `A schema migration was interrupted mid-run and cannot be resumed. `
      + `See ${sentinel} for the backup it recorded.`,
      `Restore .loctt/ from the backup named in ${sentinel}, remove the `
      + `sentinel, then run 'loctt migrate' again.`,
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
  if (compareFormatVersions(recorded, CURRENT_SCHEMA_VERSION) > 0) {
    throw new SchemaTooNewError(recorded, CURRENT_SCHEMA_VERSION);
  }
  if (compareFormatVersions(recorded, CURRENT_SCHEMA_VERSION) === 0) {
    return { from: recorded, to: recorded, steps: [] };
  }

  const path = findMigrationPath(recorded, CURRENT_SCHEMA_VERSION);
  if (path === null) {
    throw new SchemaVersionError(
      `No upgrade path found from format ${recorded} to ${CURRENT_SCHEMA_VERSION}.`,
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
  // A sentinel from a crashed run must stop this path too.
  //
  // Every other command refuses via requireSupportedSchema, but `migrate`
  // is deliberately exempt from that guard — it is the command that
  // fixes a stale schema. That exemption also let it run straight over a
  // half-migrated tracker: with the version file already advanced, it
  // reported "already at v1, nothing to do" and exited 0, on a workspace
  // whose files were only partly rewritten (invariants.md:45).
  //
  // Refusing rather than resuming: the crashed run applied an unknown
  // subset of one step, so there is no safe point to continue from. The
  // backup named in the sentinel is the recovery.
  const sentinel = getSchemaMigrationInProgressPath(locttDir);
  if (await fileExists(sentinel)) {
    throw new SchemaUnmigratableError(
      `A schema migration was interrupted mid-run and cannot be resumed. `
      + `See ${sentinel} for the backup it recorded.`,
      `Restore .loctt/ from the backup named in ${sentinel}, remove the `
      + `sentinel, then run 'loctt migrate' again. Re-running without `
      + `restoring would migrate a workspace that is only partly rewritten.`,
    );
  }

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
  if (compareFormatVersions(recorded, CURRENT_SCHEMA_VERSION) > 0) {
    throw new SchemaTooNewError(recorded, CURRENT_SCHEMA_VERSION);
  }
  if (compareFormatVersions(recorded, CURRENT_SCHEMA_VERSION) === 0) {
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
      if (compareFormatVersions(after, CURRENT_SCHEMA_VERSION) > 0) {
        throw new SchemaTooNewError(after, CURRENT_SCHEMA_VERSION);
      }
      if (compareFormatVersions(after, CURRENT_SCHEMA_VERSION) === 0) {
        return { from: after, to: after, steps: [] };
      }

      const path = findMigrationPath(after, CURRENT_SCHEMA_VERSION);
      if (path === null || path.length === 0) {
        throw new SchemaVersionError(
          `No upgrade path found from format ${after} to ${CURRENT_SCHEMA_VERSION}.`,
        );
      }

      const backupPath = await backupLocttDir(locttDir, after);
      const applied: Migration[] = [];
      let current = after;
      const sentinelPath = getSchemaMigrationInProgressPath(locttDir);

      for (const migration of path) {
        if (compareFormatVersions(migration.from, current) !== 0) {
          // Unreachable through `findMigrationPath`, which BFS-walks
          // the edge graph and can only return steps that already
          // chain. Kept anyway, and deliberately: it costs one
          // comparison per step and it is the only thing standing
          // between a mis-ordered MIGRATIONS table and a tracker
          // migrated through the wrong steps.
          //
          // The audit filed it as dead code. It is not dead; it is
          // untriggered, which is what a defensive assertion looks
          // like when the code around it is correct. Deleting it
          // would remove the guard exactly when someone edits the
          // table by hand — the case it exists for.
          throw new SchemaVersionError(
            `migration ordering invariant violated: at ${current}, ` +
            `next migration starts at ${migration.from}`,
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
  if (compareFormatVersions(recorded, CURRENT_SCHEMA_VERSION) > 0) {
    throw new SchemaTooNewError(recorded, CURRENT_SCHEMA_VERSION);
  }
  if (compareFormatVersions(recorded, CURRENT_SCHEMA_VERSION) < 0) {
    throw new SchemaVersionError(
      `This tracker's format is ${recorded}; this build reads ${CURRENT_SCHEMA_VERSION}. ` +
      `Run \`loctt migrate\` to upgrade.`,
    );
  }
}

/** The one line every surface shows after an automatic upgrade (K143). */
export function upgradeNotice(result: MigrationResult): string {
  return `Upgraded this tracker from ${result.from} to ${result.to}`
    + `${result.backupPath !== undefined ? ` (backup: ${result.backupPath})` : ""}.`;
}

/** How long an automatic upgrade waits for another process's upgrade. */
const WAIT_FOR_OTHER_UPGRADE_MS = 60_000;
const POLL_MS = 100;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => { setTimeout(resolve, ms); });
}

/**
 * Waits while another process holds the migration lock. Returns false
 * when it is still held after the wait (a crashed holder's lock goes
 * stale after five minutes; a live upgrade of a large tracker could
 * still be running), true once it is free.
 */
async function waitForOtherUpgrade(locttDir: string, deadline: number): Promise<boolean> {
  while (await isMigrationLocked(locttDir)) {
    if (Date.now() >= deadline) return false;
    await sleep(POLL_MS);
  }
  return true;
}

function isLockContention(err: unknown): boolean {
  return typeof err === "object" && err !== null
    && ((err as { code?: unknown }).code === "ELOCKED"
      || (err as { code?: unknown }).code === "conflict");
}

/**
 * Boot guard with automatic non-risky upgrades (K143).
 *
 * Every surface calls this where it used to call `requireSupportedSchema`,
 * on first use of a tracker:
 *
 *  - A tracker at `CURRENT_SCHEMA_VERSION` passes and returns null.
 *  - A tracker whose upgrade path is made only of steps that are not
 *    `risky` is upgraded here, through `migrateToCurrent` (backup of
 *    `.loctt/` first, the crash sentinel around each step), and the
 *    result is returned so the surface can show `upgradeNotice`.
 *  - A path with a risky step refuses exactly as before: `loctt migrate`.
 *  - Too new, missing, unreadable, or interrupted: the same refusals as
 *    `requireSupportedSchema`.
 *
 * Concurrency: two processes opening the same old tracker upgrade it
 * once. The second waits while the first holds the migration lock (the
 * sentinel the first writes is not mistaken for a crash while that lock
 * is held), then finds the tracker current and returns null.
 * `migrateToCurrent` re-reads the version inside its lock, so the second
 * never runs a step twice even when both pass the first check together.
 */
export async function upgradeIfSafe(locttDir: string): Promise<MigrationResult | null> {
  const deadline = Date.now() + WAIT_FOR_OTHER_UPGRADE_MS;
  const sentinelPath = getSchemaMigrationInProgressPath(locttDir);
  for (;;) {
    const sentinel = await fileExists(sentinelPath);
    const recorded = await readSchemaVersion(locttDir).catch(() => undefined);
    const behind = recorded !== undefined && recorded !== null
      && compareFormatVersions(recorded, CURRENT_SCHEMA_VERSION) < 0;

    // Nothing to upgrade: current, too new, missing or unreadable. Refuse
    // or pass exactly as the guard does, without waiting on any lock (a
    // write racing a migration is refused by `withStateLock` itself).
    if (!sentinel && !behind) {
      await requireSupportedSchema(locttDir);
      return null;
    }

    // Behind, or a sentinel: if another process is upgrading, its lock is
    // held (and the sentinel is its live one, not a crash). Wait for it,
    // then look again.
    if (await isMigrationLocked(locttDir)) {
      if (!(await waitForOtherUpgrade(locttDir, deadline))) {
        throw new SchemaVersionError(
          `A schema migration is in progress for ${locttDir}. `
          + `Wait for it to complete before retrying.`,
        );
      }
      continue;
    }

    // A sentinel nobody holds a lock for is a crashed upgrade.
    if (sentinel || recorded === undefined || recorded === null) {
      await requireSupportedSchema(locttDir);
      return null;
    }

    const path = findMigrationPath(recorded, CURRENT_SCHEMA_VERSION);
    if (path === null || path.length === 0) {
      throw new SchemaVersionError(
        `No upgrade path found from format ${recorded} to ${CURRENT_SCHEMA_VERSION}.`,
      );
    }
    const risky = path.filter(step => step.risky === true);
    if (risky.length > 0) {
      throw new SchemaVersionError(
        `This tracker's format is ${recorded}; this build reads ${CURRENT_SCHEMA_VERSION}. `
        + `The upgrade includes a step that needs your go-ahead `
        + `(${risky.map(step => step.description).join("; ")}). `
        + `Run \`loctt migrate\` to upgrade.`,
      );
    }

    try {
      const result = await migrateToCurrent(locttDir);
      return result.steps.length > 0 ? result : null;
    } catch (err) {
      // Another process took a lock between our check and ours: go back
      // to waiting for it, then re-read the version.
      if (isLockContention(err) && Date.now() < deadline) {
        await sleep(POLL_MS);
        continue;
      }
      throw err;
    }
  }
}
