import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import * as lockfile from "proper-lockfile";

import { getStateFilePath } from "../paths/index.js";
import { isMigrationLocked } from "../schema/lock.js";
import { SchemaVersionError } from "../schema/version.js";

/**
 * Serializes read-modify-write operations on `state.yaml` for a single
 * tracker. The lock is local-only (POSIX advisory) — it does not work
 * safely on network filesystems (NFS, SMB) or sync folders such as
 * Dropbox / iCloud Drive / OneDrive.
 *
 * Stale lock timeout is 10 seconds: a SIGKILL'd process will not block
 * other writers for longer than that. Lock granularity is per-tracker
 * (the path to `state.yaml`); concurrent mutations within one tracker
 * serialize, while different trackers do not block each other.
 *
 * Read-only callers (e.g. `loadState` for a status display) do not need
 * the lock — atomic writes already guarantee readers see either the old
 * or the new file, never a partial one.
 */
export async function withStateLock<T>(
  locttDir: string,
  fn: () => Promise<T>,
): Promise<T> {
  // Refuse to mutate while a migration is in progress. The migration
  // framework rewrites task frontmatter and config files atomically;
  // a concurrent state-lock holder would race those writes.
  if (await isMigrationLocked(locttDir)) {
    throw new SchemaVersionError(
      `A schema migration is in progress for ${locttDir}. ` +
      `Wait for it to complete before retrying.`,
    );
  }
  const target = getStateFilePath(locttDir);
  // Ensure the parent directory exists so proper-lockfile can create
  // the `.lock` directory next to state.yaml even on the first call
  // (before init has written state.yaml itself).
  await mkdir(dirname(target), { recursive: true });
  const release = await lockfile.lock(target, {
    retries: { retries: 10, factor: 2, minTimeout: 50, maxTimeout: 500 },
    stale: 10_000,
    realpath: false,
  });
  try {
    return await fn();
  } finally {
    await release().catch(() => {
      // Releaser failed — usually because the lock file was already
      // removed or the lock expired. Swallow so it doesn't mask the
      // caller's outcome.
    });
  }
}
