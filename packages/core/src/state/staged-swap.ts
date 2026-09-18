/**
 * Multi-file writes that survive a crash (V6).
 *
 * The gap this closes: `bulkSetFields` and its siblings write tasks in
 * a plain loop under one lock. A process killed at task nineteen of
 * forty leaves nineteen changed and twenty-one not. Every file is
 * individually valid, so nothing is corrupt, `doctor` has nothing to
 * report, and LocTT never mentions it again — the user finds out weeks
 * later when the numbers do not add up. It is the only failure here
 * that is invisible by design.
 *
 * The scheme, in order:
 *
 *   1. Write every new file into a staging directory.
 *   2. Back up every destination about to be replaced.
 *   3. Journal the operation — **flushed before the first swap**, or
 *      the crash we are protecting against happens in the window where
 *      nothing is recorded.
 *   4. Move staged files into place, one at a time.
 *   5. On success: delete the backups, then clear the journal entry.
 *      The entry goes last, so "entry exists" always means unfinished.
 *   6. On failure: restore every destination from its backup.
 *
 * Rollback that itself fails is fatal. It leaves the journal entry in
 * place and refuses rather than carrying on, because a half-restored
 * set is the one state nobody can reason about — matching how
 * `.schema-migration-in-progress` already behaves.
 */

import { copyFile, mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { ulid } from "ulid";

import { fileExists } from "../utils/fs.js";
import {
  appendJournalEntry,
  clearJournalEntry,
  loadJournal,
  registerRecoveryHandler,
  saveJournal,
} from "./journal.js";

/** One file to write as part of an atomic set. */
export interface StagedWrite {
  /** Absolute destination path. */
  readonly path: string;
  readonly content: string;
}

/**
 * Raised when the swap failed *and* the rollback failed.
 *
 * The tracker is in an unknown state and the journal entry is
 * deliberately left behind. Recovery is manual: the message names the
 * backup directory holding every original.
 */
export class SwapRollbackError extends Error {
  readonly name = "SwapRollbackError" as const;
  readonly backupDir: string;
  readonly journalEntryId: string;

  constructor(backupDir: string, journalEntryId: string, cause: unknown) {
    super(
      `a multi-file write failed and could not be rolled back. The originals are `
      + `in ${backupDir} and journal entry ${journalEntryId} has been left in place. `
      + `Restore them by hand before running further commands. `
      + `Cause: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
    this.backupDir = backupDir;
    this.journalEntryId = journalEntryId;
  }
}

function opDir(locttDir: string, opId: string): string {
  return join(locttDir, "local", "swap", opId);
}

/**
 * Applies every write, or none of them.
 *
 * Call inside `withStateLock` — the journal read-modify-write and the
 * swap must not race another process.
 *
 * Returns the paths written, in the order given.
 */
export async function stagedSwap(
  locttDir: string,
  writes: ReadonlyArray<StagedWrite>,
): Promise<string[]> {
  if (writes.length === 0) return [];

  const opId = ulid();
  const base = opDir(locttDir, opId);
  const stageDir = join(base, "staged");
  const backupDir = join(base, "backup");
  await mkdir(stageDir, { recursive: true });
  await mkdir(backupDir, { recursive: true });

  // 1. Stage. Nothing in the tracker has been touched yet, so a crash
  //    here leaves only an orphan directory.
  const staged: { staged: string; backup: string; dest: string }[] = [];
  for (const [i, w] of writes.entries()) {
    const stagedPath = join(stageDir, String(i));
    await writeFile(stagedPath, w.content, "utf-8");
    staged.push({ staged: stagedPath, backup: join(backupDir, String(i)), dest: w.path });
  }

  // 2. Back up every destination that already exists.
  //
  //    Copied, never moved. Moving the original out of the way makes
  //    the destination briefly absent, so a crash between the move and
  //    the swap leaves the file simply gone — and it also silently
  //    consumes a *directory* sitting at the destination, which the
  //    swap would then have failed on. A destination that is not a
  //    regular file is refused outright before anything is touched.
  //
  //    A destination that does not exist records no backup; rollback
  //    deletes it instead of restoring it.
  //    Every destination is checked before *any* is copied, so a bad
  //    one at the end of the set cannot leave the earlier ones
  //    half-backed-up.
  const hadOriginal = new Set<string>();
  for (const s of staged) {
    const info = await stat(s.dest).catch(() => undefined);
    if (info === undefined) continue;
    if (!info.isFile()) {
      await rm(base, { recursive: true, force: true });
      throw new Error(
        `${s.dest} exists and is not a regular file, so LocTT will not replace it.`,
      );
    }
    hadOriginal.add(s.dest);
  }
  for (const s of staged) {
    if (hadOriginal.has(s.dest)) await copyFile(s.dest, s.backup);
  }

  // 3. Journal, flushed before the first swap. Written after the
  //    backups exist, so the entry never points at a backup that is
  //    not there yet.
  const journal = await loadJournal(locttDir);
  await saveJournal(locttDir, appendJournalEntry(journal, {
    id: opId,
    kind: "staged_swap",
    started_at: new Date().toISOString(),
    swap: {
      base_dir: base,
      files: staged.map(s => ({
        dest: s.dest,
        backup: s.backup,
        had_original: hadOriginal.has(s.dest),
      })),
    },
  }));

  // 4. Swap.
  try {
    for (const s of staged) {
      await mkdir(dirname(s.dest), { recursive: true });
      await rename(s.staged, s.dest);
    }
  } catch (err) {
    await rollback(staged, hadOriginal, backupDir, opId, err);
    throw err;
  }

  // 5. Backups first, journal entry last — "entry exists" must always
  //    mean unfinished.
  await rm(base, { recursive: true, force: true });
  await clearJournalEntry(locttDir, opId);
  return writes.map(w => w.path);
}

/**
 * Puts every destination back the way it was.
 *
 * Best-effort per file, then fatal if any failed: a partially restored
 * set is worse than either end state.
 */
async function rollback(
  staged: ReadonlyArray<{ staged: string; backup: string; dest: string }>,
  hadOriginal: ReadonlySet<string>,
  backupDir: string,
  opId: string,
  swapError: unknown,
): Promise<void> {
  const failures: unknown[] = [];
  for (const s of staged) {
    try {
      if (hadOriginal.has(s.dest)) {
        // Copy, not move: the backup must survive until the whole
        // rollback has succeeded, or a failure halfway leaves earlier
        // files with neither a destination nor a backup.
        await copyFile(s.backup, s.dest);
      } else {
        // Nothing was there before this op, so "restored" means gone.
        await rm(s.dest, { force: true });
      }
    } catch (err) {
      failures.push(err);
    }
  }
  if (failures.length > 0) {
    // The journal entry and backup directory are deliberately NOT
    // cleaned up here — they are the recovery path.
    throw new SwapRollbackError(backupDir, opId, failures[0] ?? swapError);
  }
}

/**
 * Finishes an interrupted swap found at boot.
 *
 * Rolls **back**, never forward. The staged files may be complete, but
 * a crash gives no way to tell which destinations were already
 * swapped, and restoring known-good originals is the only choice that
 * cannot invent a state the user never had.
 */
export async function recoverStagedSwap(
  locttDir: string,
  entry: { id: string; swap?: { base_dir: string; files: ReadonlyArray<{ dest: string; backup: string; had_original: boolean }> } },
): Promise<void> {
  const swap = entry.swap;
  if (swap === undefined) return;

  // "Did this swap finish?" — step 5 removes `base_dir` as one unit
  // *before* clearing the journal entry, so a stranded entry whose
  // `base_dir` is already gone means the swap completed and only the
  // cleanup was interrupted: every destination is already correct and
  // must be left alone. A `base_dir` still on disk means the op was
  // interrupted mid-swap and must be rolled back.
  //
  // This is the created-file (`had_original:false`) analogue of the
  // per-file `fileExists(f.backup)` guard below: a created file has no
  // backup to key on (line 136-138 never writes one), so the
  // op-completed signal is the base dir, not a per-file backup.
  const opUnfinished = await fileExists(swap.base_dir);

  for (const f of swap.files) {
    if (f.had_original) {
      // Only restore when the backup is still there: a completed swap
      // whose cleanup was interrupted has none, and its destination is
      // already correct.
      if (await fileExists(f.backup)) {
        await mkdir(dirname(f.dest), { recursive: true });
        await copyFile(f.backup, f.dest);
      }
    } else if (opUnfinished) {
      // A created destination has no backup file — rollback means
      // delete it. Gate on the swap being unfinished so a completed
      // swap (base dir already gone) does not delete a file that is
      // correctly in place, which would roll one file back while a
      // sibling stays forward — the split state V6 exists to prevent.
      await rm(f.dest, { force: true });
    }
  }
  await rm(swap.base_dir, { recursive: true, force: true });
  await clearJournalEntry(locttDir, entry.id);
}

/**
 * Registered at module load, matching how the remap kinds do it — a
 * stranded entry with no handler means an interrupted write nobody can
 * finish, which `recoverPendingJournal` escalates loudly.
 */
registerRecoveryHandler("staged_swap", async (locttDir, entry) => {
  if (entry.kind !== "staged_swap") return;
  await recoverStagedSwap(locttDir, entry);
});
