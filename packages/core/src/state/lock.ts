import { AsyncLocalStorage } from "node:async_hooks";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import * as lockfile from "proper-lockfile";

import { LocttError } from "../errors.js";
import { getStateFilePath } from "../paths/index.js";
import { isMigrationLocked } from "../schema/lock.js";
import { SchemaVersionError } from "../schema/version.js";
import { rethrowFsError } from "../utils/fs-errors.js";

/** Shared lock settings, so the two acquire sites cannot drift apart. */
const LOCK_OPTIONS = {
  retries: { retries: 10, factor: 2, minTimeout: 50, maxTimeout: 500 },
  stale: 10_000,
  realpath: false,
} as const;

/**
 * Acquires the state lock, naming filesystem failures the user can fix.
 *
 * The lock is the *first* write on nearly every mutating path — it
 * creates a `.lock` directory beside `state.yaml` — so an unwritable
 * `.loctt/` surfaces here rather than at the eventual file write. Left
 * unmapped it reached every front-end as a raw `EACCES`, which is
 * ERR-11's complaint and ERR-31's prohibition.
 *
 * `proper-lockfile` preserves the underlying errno, so the shared
 * mapper recognises it unchanged. Retrying is pointless for these —
 * a permission or a full disk will not clear between attempts — but the
 * backoff is bounded and the alternative is inspecting errnos before
 * deciding to retry, which would duplicate the mapper's job.
 */
/**
 * Another LocTT process is writing, and the retries did not outlast it.
 *
 * `proper-lockfile` throws `ELOCKED` with "Lock file is already being
 * held" — its own internals, naming neither the cause nor anything the
 * user can do (BLK-42, ERR-16). Contention is also not a filesystem
 * failure: it clears on its own, which is why this does not reach
 * `rethrowFsError`.
 *
 * `retry` rather than `none`, deliberately. The git-conflict envelope
 * next door carries `none` because retrying reproduces it exactly;
 * here the opposite is true, and BLK-42's last bullet says so:
 * "Retrying after the lock clears succeeds." The message carries the
 * *timing* — wait, then try again — because `ErrorRecoveryKind` has no
 * "wait" and offering no control at all would leave the user with a
 * transient failure and nothing to do about it.
 *
 * PRU-43 adds the second half. On a sync folder this error is not
 * transient at all: advisory locks are unreliable there, so Retry
 * alone sends the user round a loop that cannot terminate. The
 * filesystem caveat was a source comment on `withStateLock` below —
 * true, and invisible to the person actually hitting it — so the
 * message now names the filesystems and the fix.
 */
class StateLockedError extends LocttError {
  constructor(detail: string) {
    super(
      "conflict",
      "another LocTT process is writing to this tracker; wait for it to "
      + "finish and try again. If no other process is running, note that "
      + "the state lock uses POSIX advisory locks, which are not reliable "
      + "on iCloud Drive, Dropbox, OneDrive, NFS or SMB — move the tracker "
      + "to a local disk.",
      {
        // Nothing was attempted: the lock is taken before any write.
        dataState: "not_saved",
        recovery: { kind: "retry" },
        detail,
      },
    );
    this.name = "StateLockedError";
  }
}

function isLocked(err: unknown): boolean {
  return typeof err === "object" && err !== null
    && (err as { code?: unknown }).code === "ELOCKED";
}

async function acquireStateLock(target: string): Promise<() => Promise<void>> {
  try {
    return await lockfile.lock(target, LOCK_OPTIONS);
  } catch (err) {
    if (isLocked(err)) {
      throw new StateLockedError(err instanceof Error ? err.message : String(err));
    }
    rethrowFsError(err, target);
  }
}

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
 * Optional recovery hook fired inside the lock, before the user's
 * `fn` runs. Used by `state/journal.ts` to drain pending crash-
 * recovery entries on every critical-section entry. Lives behind
 * a setter so `lock.ts` doesn't import the journal module (which
 * itself depends on task IO and would close a layering cycle).
 */
type StateLockRecoveryHook = (locttDir: string) => Promise<void>;
let recoveryHook: StateLockRecoveryHook | null = null;

/**
 * Registers a recovery callback fired inside `withStateLock` before
 * the caller's `fn`. Idempotent: a second call replaces the
 * previous hook. Pass `null` to clear (used by tests).
 */
export function setStateLockRecoveryHook(hook: StateLockRecoveryHook | null): void {
  recoveryHook = hook;
}

/**
 * Lazy bootstrap of the journal recovery hook. Runs on the first
 * `withStateLock` call rather than at module load, so importing
 * `lock.ts` directly (e.g. from `task/relationships.ts`) still wires
 * up recovery without forcing every consumer to import via
 * `state/index.ts`. Without this, an import path that bypassed
 * `state/index.ts` would silently skip recovery wiring and strand
 * pending journal entries until something else happened to load the
 * index.
 *
 * Uses a dynamic import to break the layering cycle: `journal.ts`
 * depends on task IO, which transitively depends on `lock.ts`, so a
 * top-level import of journal here would close the cycle. Dynamic
 * import defers resolution until first use, by which point all
 * modules are fully initialized.
 */
let recoveryHookBootstrap: Promise<void> | null = null;
function ensureRecoveryHookWired(): Promise<void> {
  if (recoveryHookBootstrap !== null) return recoveryHookBootstrap;
  recoveryHookBootstrap = (async () => {
    if (recoveryHook !== null) return;
    const { recoverPendingJournal } = await import("./journal.js");
    if (recoveryHook === null) {
      recoveryHook = recoverPendingJournal;
    }
  })();
  return recoveryHookBootstrap;
}

// Kick off the lazy bootstrap at module load so the dynamic import
// is in flight by the time any caller invokes withStateLock. We
// intentionally don't await — the bootstrap promise is cached and
// the first withStateLock call will await it (usually already
// resolved). Errors are swallowed: if the import fails the next
// withStateLock will surface it through the awaited promise.
void ensureRecoveryHookWired().catch(() => {});

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
  await ensureRecoveryHookWired();

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
  //
  // We re-check after acquiring the OS lock so a migration that
  // grabbed its lock between our cheap pre-check and `lockfile.lock`
  // doesn't slip through. (Migration's own protocol grabs the state
  // lock first to flush in-flight writers, then the migration lock;
  // a writer that beats migration to the state lock will see the
  // pre-check false and not be racing — the post-acquire check is
  // for the case where migration started before the writer even
  // entered withStateLock.)
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
  const release = await acquireStateLock(target);
  try {
    // Post-acquire re-check: closes the TOCTOU window between the
    // pre-check above and the OS lock acquire. A migration that
    // started in that window has already raced past our pre-check;
    // we release the lock and fail loudly rather than letting the
    // caller mutate against an in-progress migration.
    if (await isMigrationLocked(locttDir)) {
      throw new SchemaVersionError(
        `A schema migration is in progress for ${locttDir}. ` +
        `Wait for it to complete before retrying.`,
      );
    }
    return await lockHeld.run(
      { locttDir, acquiredAt: new Date().toISOString() },
      async () => {
        // Drain pending crash-recovery entries (if a hook is
        // registered) BEFORE running the caller. This guarantees
        // every critical section sees a fully-applied prior op.
        // The hook itself uses lock-free helpers so it doesn't
        // re-enter withStateLock.
        if (recoveryHook) await recoveryHook(locttDir);
        return await fn();
      },
    );
  } finally {
    await release().catch(() => {
      // Releaser failed — usually because the lock file was already
      // removed or the lock expired. Swallow so it doesn't mask the
      // caller's outcome.
    });
  }
}

/**
 * Lock-free state-lock variant for the schema migration framework.
 * Acquires the OS-level state lock without checking migration
 * status — used by `migrateToCurrent` so it can briefly hold the
 * state lock at the start of migration to flush any in-flight
 * writers, then hand off to the migration lock.
 *
 * The callback receives a `releaseEarly` function. Once the
 * migration lock is held, the migration calls `releaseEarly()` to
 * drop the state lock so concurrent writers can fail fast with a
 * "migration in progress" message instead of queuing on
 * `state.yaml` for the whole migration. If the callback never
 * calls `releaseEarly`, the state lock is released on return.
 *
 * Do NOT use from ordinary writers. Use `withStateLock` instead.
 */
export async function withStateLockForMigration<T>(
  locttDir: string,
  fn: (releaseEarly: () => Promise<void>) => Promise<T>,
): Promise<T> {
  const target = getStateFilePath(locttDir);
  await mkdir(dirname(target), { recursive: true });
  const release = await acquireStateLock(target);
  let released = false;
  const releaseEarly = async (): Promise<void> => {
    if (released) return;
    released = true;
    await release().catch(() => {});
  };
  try {
    return await fn(releaseEarly);
  } finally {
    if (!released) {
      released = true;
      await release().catch(() => {});
    }
  }
}
