import { AsyncLocalStorage } from "node:async_hooks";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import * as lockfile from "proper-lockfile";

import { getStateFilePath } from "../paths/index.js";
import { isMigrationLocked } from "../schema/lock.js";
import { SchemaVersionError } from "../schema/version.js";

/**
 * Per-async-context flag that records whether the current call
 * stack already holds the state lock for a given locttDir. Used by
 * {@link withStateLock} to detect nested-acquire attempts and fail
 * fast rather than deadlocking on the OS-level lock (proper-lockfile
 * is non-reentrant: the same process trying to acquire the same
 * lock twice would block until stale-timeout, then throw a confusing
 * "lock timeout" error 10 seconds later, with no hint about which
 * caller did the nested acquire).
 *
 * AsyncLocalStorage tracks state correctly across `await`,
 * `Promise.all`, `setTimeout` callbacks, and generator yields — so
 * "this async chain already has the lock" is the precise predicate
 * we need. Sibling top-level calls (different async roots) do not
 * see each other's storage, so they correctly serialize on the OS
 * lock instead of false-positiving as nested.
 */
const lockHeld = new AsyncLocalStorage<{ locttDir: string; acquiredAt: string }>();

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
 *
 * **Not re-entrant.** A nested call to `withStateLock(d, …)` from
 * inside an outer `withStateLock(d, …)` throws `Error` immediately
 * rather than deadlocking. Refactor the caller to do its work
 * inside the outer lock; nested patterns usually indicate that one
 * helper should expose a "lock-free" variant the outer caller can
 * call directly.
 *
 * Edge case: a `setTimeout`/`setImmediate` callback scheduled from
 * inside `fn` inherits the outer's AsyncLocalStorage scope. If the
 * timer fires AFTER `fn` returned and itself calls
 * `withStateLock(d, …)`, the guard will incorrectly fire (because
 * the timer's callback is a descendant of the outer's async
 * resource even though the lock has long since been released). Don't
 * fire-and-forget under the lock — but if you must, drop the
 * AsyncLocalStorage scope around the schedule with
 * `AsyncResource.bind(...)` or use a top-level scheduling utility.
 */
export async function withStateLock<T>(
  locttDir: string,
  fn: () => Promise<T>,
): Promise<T> {
  const existing = lockHeld.getStore();
  if (existing && existing.locttDir === locttDir) {
    throw new Error(
      `withStateLock is not re-entrant. The state lock for ${locttDir} ` +
      `was already acquired at ${existing.acquiredAt} earlier in this ` +
      `async context. Refactor the caller to do its work inside the ` +
      `outer lock instead of nesting.`,
    );
  }

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
    return await lockHeld.run(
      { locttDir, acquiredAt: new Date().toISOString() },
      fn,
    );
  } finally {
    await release().catch(() => {
      // Releaser failed — usually because the lock file was already
      // removed or the lock expired. Swallow so it doesn't mask the
      // caller's outcome.
    });
  }
}
