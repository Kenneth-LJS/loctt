import { mkdir } from "node:fs/promises";

import * as lockfile from "proper-lockfile";

import { getSchemaVersionPath } from "../paths/index.js";

/**
 * Serializes schema-migration operations against a single tracker.
 * Held for the duration of `migrateToCurrent`. Other writers in the
 * codebase are encouraged to bail out fast when this lock is held —
 * a migration is in progress and the data shape is potentially
 * inconsistent until the migration step finishes.
 *
 * Locks the `.schema-version` file (which always exists for any
 * versioned tracker). Stale-lock timeout is 5 minutes — long enough
 * to accommodate a slow migration over many tasks but short enough
 * that a SIGKILL'd process unblocks within bounded time.
 *
 * Local-only (POSIX advisory). Same caveats as `withStateLock`:
 * does not work safely on network filesystems or sync folders.
 */
export async function withMigrationLock<T>(
  locttDir: string,
  fn: () => Promise<T>,
): Promise<T> {
  const target = getSchemaVersionPath(locttDir);
  // The lock target must exist for proper-lockfile to attach. The
  // version file is written during `init` and persists forever, so
  // it's a stable target. We still ensure the parent dir exists in
  // case a caller invokes this on a fresh path.
  await mkdir(locttDir, { recursive: true });
  const release = await lockfile.lock(target, {
    retries: { retries: 5, factor: 2, minTimeout: 100, maxTimeout: 1000 },
    stale: 5 * 60 * 1000,
    realpath: false,
  });
  try {
    return await fn();
  } finally {
    await release().catch(() => {
      // Releaser failed — usually because the lock was already removed
      // or expired. Swallow so it doesn't mask the caller's outcome.
    });
  }
}

/**
 * Returns true if a migration lock is currently held by another
 * process. Used by writers that want to fail fast rather than block
 * when a migration is in progress.
 */
export async function isMigrationLocked(locttDir: string): Promise<boolean> {
  const target = getSchemaVersionPath(locttDir);
  try {
    return await lockfile.check(target, { realpath: false, stale: 5 * 60 * 1000 });
  } catch {
    // If `check` itself errors (e.g. file missing), treat as unlocked.
    // Callers that care about file presence handle that separately
    // via `requireSupportedSchema`.
    return false;
  }
}
