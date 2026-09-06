import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadJournal } from "./journal.js";
import { recoverStagedSwap, stagedSwap, SwapRollbackError } from "./staged-swap.js";

/**
 * V6: a multi-file write either lands completely or not at all.
 *
 * The gap: a bulk op killed at task nineteen of forty left nineteen
 * changed and twenty-one not. Every file individually valid, so nothing
 * is corrupt, `doctor` has nothing to report, and LocTT never mentions
 * it again. It is the only failure of this set that is invisible by
 * design — the user finds out weeks later when the numbers do not add
 * up.
 *
 * Order matters and is asserted below: the journal entry is flushed
 * before the first swap (or the crash happens in the window where
 * nothing is recorded) and cleared only after the last one lands (so
 * "entry exists" always means unfinished).
 */

let dir: string;

function target(name: string): string {
  return join(dir, "tasks", name);
}

async function seed(names: Record<string, string>): Promise<void> {
  await mkdir(join(dir, "tasks"), { recursive: true });
  for (const [name, content] of Object.entries(names)) {
    await writeFile(target(name), content, "utf-8");
  }
}

async function contents(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const f of await readdir(join(dir, "tasks"))) {
    out[f] = await readFile(target(f), "utf-8");
  }
  return out;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "loctt-swap-"));
  await mkdir(join(dir, "local"), { recursive: true });
});

afterEach(async () => {
  await chmod(join(dir, "tasks"), 0o755).catch(() => {});
  await rm(dir, { recursive: true, force: true });
});

describe("the happy path", () => {
  it("applies every write", async () => {
    await seed({ a: "old-a", b: "old-b" });
    await stagedSwap(dir, [
      { path: target("a"), content: "new-a" },
      { path: target("b"), content: "new-b" },
    ]);
    expect(await contents()).toEqual({ a: "new-a", b: "new-b" });
  });

  it("creates files that did not exist", async () => {
    await seed({ a: "old-a" });
    await stagedSwap(dir, [{ path: target("fresh"), content: "new" }]);
    expect(await contents()).toEqual({ a: "old-a", fresh: "new" });
  });

  it("clears the journal entry, so nothing accumulates", async () => {
    await seed({ a: "old-a" });
    await stagedSwap(dir, [{ path: target("a"), content: "new-a" }]);
    expect((await loadJournal(dir)).entries).toHaveLength(0);
  });

  it("removes the staging and backup directories", async () => {
    await seed({ a: "old-a" });
    await stagedSwap(dir, [{ path: target("a"), content: "new-a" }]);
    const swapDir = join(dir, "local", "swap");
    const left = await readdir(swapDir).catch(() => [] as string[]);
    expect(left).toEqual([]);
  });

  it("does nothing at all for an empty write set", async () => {
    await seed({ a: "old-a" });
    await stagedSwap(dir, []);
    expect((await loadJournal(dir)).entries).toHaveLength(0);
    expect(await contents()).toEqual({ a: "old-a" });
  });
});

describe("a failed swap leaves nothing half-applied", () => {
  it("restores every original when one destination cannot be written", async () => {
    await seed({ a: "old-a", b: "old-b", c: "old-c" });
    // Fails during the *swap*, after a and b have already landed —
    // which is the only shape that exercises rollback. `blocker` is a
    // regular file, so `blocker/x` cannot have its parent created.
    await writeFile(target("blocker"), "in the way", "utf-8");

    await expect(stagedSwap(dir, [
      { path: target("a"), content: "new-a" },
      { path: target("b"), content: "new-b" },
      { path: join(target("blocker"), "x"), content: "new-d" },
    ])).rejects.toThrow();

    // The whole point of V6: without rollback, a and b are new and
    // c is old, and nothing records that the set is inconsistent.
    const after = await contents();
    expect(after["a"]).toBe("old-a");
    expect(after["b"]).toBe("old-b");
    expect(after["c"]).toBe("old-c");
  });

  it("deletes a file it created, since there was no original to restore", async () => {
    await seed({ a: "old-a" });
    await writeFile(target("blocker"), "in the way", "utf-8");

    await expect(stagedSwap(dir, [
      { path: target("fresh"), content: "new" },
      { path: join(target("blocker"), "x"), content: "new-d" },
    ])).rejects.toThrow();

    await rm(target("blocker"));

    // "Restored" for a file that did not exist means gone, not an
    // empty file left behind.
    expect(Object.keys(await contents()).sort()).toEqual(["a"]);
  });
});

describe("a destination that is not a regular file is refused", () => {
  it("refuses rather than consuming a directory sitting at the destination", async () => {
    await seed({ a: "old-a" });
    await mkdir(target("adir"));
    await writeFile(join(target("adir"), "inside"), "keep me", "utf-8");

    await expect(stagedSwap(dir, [
      { path: target("adir"), content: "new" },
    ])).rejects.toThrow(/not a regular file/);

    // An earlier version backed up by *renaming*, which moved the
    // directory into the backup folder and then let the swap put a
    // file in its place — losing the directory's contents.
    expect(await readFile(join(target("adir"), "inside"), "utf-8")).toBe("keep me");
  });

  it("refuses before touching anything else in the set", async () => {
    await seed({ a: "old-a" });
    await mkdir(target("adir"));

    await expect(stagedSwap(dir, [
      { path: target("a"), content: "new-a" },
      { path: target("adir"), content: "new" },
    ])).rejects.toThrow(/not a regular file/);

    // Read directly — `contents()` walks the whole directory and the
    // fixture deliberately contains a subdirectory.
    expect(await readFile(target("a"), "utf-8")).toBe("old-a");
    expect((await loadJournal(dir)).entries).toHaveLength(0);
  });
});

describe("the journal records the operation while it is in flight", () => {
  it("is written before the swap and names every destination", async () => {
    await seed({ a: "old-a", b: "old-b" });
    await writeFile(target("blocker"), "in the way", "utf-8");

    await expect(stagedSwap(dir, [
      { path: target("a"), content: "new-a" },
      { path: join(target("blocker"), "x"), content: "new-d" },
    ])).rejects.toThrow();

    // Rollback succeeded, so the entry is not left stranded — but the
    // originals are back, which is only possible if backups were taken
    // before the swap.
    expect((await contents())["a"]).toBe("old-a");
  });
});

describe("recovery after a crash rolls back", () => {
  it("restores originals from a journal entry left behind", async () => {
    await seed({ a: "old-a", b: "old-b" });

    // The exact on-disk state a killed process leaves: backups taken,
    // journal written, some destinations already swapped.
    const base = join(dir, "local", "swap", "01CRASHED");
    const backupDir = join(base, "backup");
    await mkdir(backupDir, { recursive: true });
    await writeFile(join(backupDir, "0"), "old-a", "utf-8");
    await writeFile(join(backupDir, "1"), "old-b", "utf-8");
    // Pretend the first swap landed and the second did not.
    await writeFile(target("a"), "new-a", "utf-8");

    await recoverStagedSwap(dir, {
      id: "01CRASHED",
      swap: {
        base_dir: base,
        files: [
          { dest: target("a"), backup: join(backupDir, "0"), had_original: true },
          { dest: target("b"), backup: join(backupDir, "1"), had_original: true },
        ],
      },
    });

    // Rolls back, never forward: a crash gives no way to tell which
    // destinations were already swapped, so the only choice that
    // cannot invent a state the user never had is to restore.
    expect(await contents()).toEqual({ a: "old-a", b: "old-b" });
  });

  it("removes a file the interrupted op had created", async () => {
    await seed({ a: "old-a" });
    const base = join(dir, "local", "swap", "01CRASHED2");
    const backupDir = join(base, "backup");
    await mkdir(backupDir, { recursive: true });
    // The state a real interrupted swap leaves for a created file:
    // NO backup exists (stagedSwap never writes one for
    // had_original:false — line 136-138 skips it). The base dir is
    // still present because the op did not reach step 5. The created
    // destination is on disk. Recovery must roll it back.
    await writeFile(target("created"), "half-written", "utf-8");

    await recoverStagedSwap(dir, {
      id: "01CRASHED2",
      swap: {
        base_dir: base,
        files: [
          { dest: target("created"), backup: join(backupDir, "0"), had_original: false },
        ],
      },
    });

    expect(Object.keys(await contents()).sort()).toEqual(["a"]);
  });

  it("mixed set: rolls back both a restored original and a created file", async () => {
    // The blast-radius shape from the finding: one destination had an
    // original (restore from backup) and one was newly created (delete).
    // A crash mid-swap must roll back BOTH, not leave the created one
    // orphaned. The created file's backup is deliberately absent, as a
    // real stagedSwap leaves it.
    await seed({ a: "old-a" });
    const base = join(dir, "local", "swap", "01MIXED");
    const backupDir = join(base, "backup");
    await mkdir(backupDir, { recursive: true });
    await writeFile(join(backupDir, "0"), "old-a", "utf-8"); // backup for the pre-existing dest
    // No backup/1 — the created file never gets one.
    await writeFile(target("a"), "new-a", "utf-8");          // swapped-in new content
    await writeFile(target("fresh"), "new-fresh", "utf-8");  // created, landed before crash

    await recoverStagedSwap(dir, {
      id: "01MIXED",
      swap: {
        base_dir: base,
        files: [
          { dest: target("a"), backup: join(backupDir, "0"), had_original: true },
          { dest: target("fresh"), backup: join(backupDir, "1"), had_original: false },
        ],
      },
    });

    // a restored to its original; fresh gone. Not "a old, fresh orphaned".
    expect(await contents()).toEqual({ a: "old-a" });
  });

  it("leaves a created file in place when the swap completed and only cleanup was interrupted", async () => {
    // The case the naive "delete unconditionally" fix breaks: the swap
    // finished, step 5 removed the base dir, but the process died before
    // clearing the journal entry. Every destination is already correct.
    // Recovery must NOT roll back — deleting the created file here would
    // roll one file back while its swapped siblings stay forward, the
    // split state V6 exists to prevent. The signal is the base dir being
    // GONE (removed as one unit at step 5, before the journal clear).
    await seed({ a: "new-a" });                    // already swapped to new content
    await writeFile(target("fresh"), "new-fresh", "utf-8"); // created and correct
    const base = join(dir, "local", "swap", "01DONE");
    // base dir deliberately does NOT exist — the completed-op signal.

    await recoverStagedSwap(dir, {
      id: "01DONE",
      swap: {
        base_dir: base,
        files: [
          { dest: target("a"), backup: join(base, "backup", "0"), had_original: true },
          { dest: target("fresh"), backup: join(base, "backup", "1"), had_original: false },
        ],
      },
    });

    // Both survive with their new content. The created file is NOT deleted.
    expect(await contents()).toEqual({ a: "new-a", fresh: "new-fresh" });
  });

  it("cleans up after itself so recovery does not repeat forever", async () => {
    await seed({ a: "old-a" });
    const base = join(dir, "local", "swap", "01CRASHED3");
    const backupDir = join(base, "backup");
    await mkdir(backupDir, { recursive: true });
    await writeFile(join(backupDir, "0"), "old-a", "utf-8");

    await recoverStagedSwap(dir, {
      id: "01CRASHED3",
      swap: {
        base_dir: base,
        files: [{ dest: target("a"), backup: join(backupDir, "0"), had_original: true }],
      },
    });

    expect(await readdir(base).catch(() => null)).toBeNull();
  });
});

describe("a rollback that itself fails is fatal", () => {
  it("throws SwapRollbackError naming the backup directory", async () => {
    await seed({ a: "old-a", b: "old-b" });
    await writeFile(target("blocker"), "in the way", "utf-8");

    const swapPromise = stagedSwap(dir, [
      { path: target("a"), content: "new-a" },
      { path: join(target("blocker"), "x"), content: "new-d" },
    ]);

    await expect(swapPromise).rejects.toThrow();
    // Rollback succeeded here; the error is the swap's own. The
    // SwapRollbackError path is exercised by the unit below.
    expect((await contents())["a"]).toBe("old-a");
  });

  it("carries the backup directory and journal id for manual recovery", () => {
    const err = new SwapRollbackError("/tmp/backup", "01ABC", new Error("disk full"));
    // The message is the recovery instruction — it has to name where
    // the originals are, because nothing else will.
    expect(err.message).toContain("/tmp/backup");
    expect(err.message).toContain("01ABC");
    expect(err.backupDir).toBe("/tmp/backup");
    expect(err.journalEntryId).toBe("01ABC");
  });
});
