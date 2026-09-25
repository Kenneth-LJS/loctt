import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { Task } from "@loctt/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getKeyIndexPath, getTaskFilePath } from "../paths/index.js";
import { writeTask } from "./io.js";
import {
  lookupById,
  lookupByKey,
  lookupTask,
  TaskNotFoundError,
  UnreadableTaskError,
} from "./lookup.js";

/**
 * A task.md that will not parse must never be reported as a task that
 * does not exist.
 *
 * Two distinct wrong answers shipped, both from `lookupByKey`:
 *
 *  - key **in** the index → `readTask`'s raw `YAMLParseError` escaped
 *    unattributed, which the web turned into
 *    `The server failed while handling GET /api/tasks/T-1` with the
 *    only useful sentence buried in `detail`.
 *  - key **not** in the index (the file was already bad when the fold
 *    ran, so `readKeyHeader` swallowed it) → `Task not found: "T-1"`,
 *    asserting the task did not exist with the file sitting on disk.
 *
 * The second is ERR-1's prohibition exactly: a failure and an absence
 * must not look alike. TSK-54 and XS-51 set what the surface must say
 * instead — could not be parsed, the path, and the line.
 *
 * The inverse matters just as much and is asserted here too: a key
 * that genuinely does not exist must not start reporting as a read
 * failure merely because an unrelated neighbour is corrupt.
 *
 * @verifies TSK-54
 * @verifies XS-51
 * @verifies ERR-1
 */
describe("lookup distinguishes an unreadable task from an absent one", () => {
  let root: string;
  let locttDir: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-unreadable-"));
    locttDir = join(root, ".loctt");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const task: Task = {
    frontmatter: {
      id: "01AAA",
      key: "T-1",
      title: "Corrupt me",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    },
    body: "",
  };

  const neighbour: Task = {
    frontmatter: {
      id: "01BBB",
      key: "T-2",
      title: "Perfectly fine",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    },
    body: "",
  };

  /**
   * Corrupts the frontmatter the way a hand edit does: an unclosed
   * quote. The `yaml` package reports it with a line and a column,
   * which is the detail TSK-54 asks the surface to carry.
   */
  async function corrupt(id: string): Promise<string> {
    const path = getTaskFilePath(locttDir, id);
    const before = await readFile(path, "utf-8");
    const after = before.replace(/^title: (.*)$/m, 'title: "$1');
    expect(after).not.toBe(before);
    await writeFile(path, after, "utf-8");
    return path;
  }

  it("names the file and the parse line when the key is in the index", async () => {
    await writeTask(locttDir, task.frontmatter.id, task);
    // Warm the index the way a real session does: one good lookup
    // before the file goes bad. This is the path that used to throw a
    // bare YAMLParseError.
    await lookupByKey(locttDir, "T-1");
    const path = await corrupt(task.frontmatter.id);

    const err = await lookupByKey(locttDir, "T-1").catch((e: unknown) => e);

    expect(err).toBeInstanceOf(UnreadableTaskError);
    expect(err).not.toBeInstanceOf(TaskNotFoundError);
    const unreadable = err as UnreadableTaskError;
    expect(unreadable.code).toBe("io_failed");
    expect(unreadable.path).toBe(path);
    // TSK-54: the path, and the line or field.
    expect(unreadable.message).toContain(path);
    expect(unreadable.message).toMatch(/line \d+/);
    expect(unreadable.message).toContain("could not be parsed");
    // ERR-1: never the absence wording.
    expect(unreadable.message).not.toContain("not found");
    // XS-51: writes are atomic, so the message commits to a hand edit
    // rather than hedging about a half-written file.
    expect(unreadable.message).toContain("by hand");
  });

  it("does not report a corrupt task as absent when the key never reached the index", async () => {
    await writeTask(locttDir, task.frontmatter.id, task);
    // No warm lookup: the file is corrupt before anything indexes it,
    // so `foldUnknownTasks` cannot harvest its key. This is the 404.
    const path = await corrupt(task.frontmatter.id);

    const err = await lookupByKey(locttDir, "T-1").catch((e: unknown) => e);

    expect(err).toBeInstanceOf(UnreadableTaskError);
    expect(err).not.toBeInstanceOf(TaskNotFoundError);
    const unreadable = err as UnreadableTaskError;
    expect(unreadable.code).toBe("io_failed");
    expect(unreadable.paths).toEqual([path]);
    expect(unreadable.message).toContain(path);
    expect(unreadable.message).toMatch(/line \d+/);
    // The key cannot be matched to the file whose key would not parse,
    // so the error says so rather than asserting either way.
    expect(unreadable.indeterminate).toBe(true);
    // K129 pass: "so it cannot confirm that the task does not exist"
    // reworded to "so whether the task exists is unknown" (drops the
    // self-reference, avoids the double-negative).
    expect(unreadable.message).toContain("whether the task exists is unknown");
  });

  it("still reports a genuinely absent key as not found when every file parses", async () => {
    await writeTask(locttDir, neighbour.frontmatter.id, neighbour);

    const err = await lookupByKey(locttDir, "T-99").catch((e: unknown) => e);

    // The inverse of the bug: absence must stay absence. Reporting a
    // missing key as a read failure would be the same conflation
    // pointed the other way.
    expect(err).toBeInstanceOf(TaskNotFoundError);
    expect((err as Error).message).toContain("Task not found");
  });

  it("does not claim a missing key was found when an unrelated file is corrupt", async () => {
    await writeTask(locttDir, task.frontmatter.id, task);
    await writeTask(locttDir, neighbour.frontmatter.id, neighbour);
    await corrupt(task.frontmatter.id);

    const err = await lookupByKey(locttDir, "T-99").catch((e: unknown) => e);

    // T-99 may not exist at all, or may be the key inside the file
    // that would not parse — LocTT cannot tell, and says so.
    expect(err).toBeInstanceOf(UnreadableTaskError);
    expect((err as UnreadableTaskError).indeterminate).toBe(true);
    expect((err as Error).message).toContain("T-99");
    expect((err as Error).message).toContain("whether the task exists is unknown");
  });

  it("one corrupt task does not stop the fold from indexing its neighbours", async () => {
    await writeTask(locttDir, task.frontmatter.id, task);
    await writeTask(locttDir, neighbour.frontmatter.id, neighbour);
    await corrupt(task.frontmatter.id);

    // Force the *fold* path rather than the cold-start rebuild: an
    // index file that exists but is empty makes `loadKeyIndex`
    // succeed, so `lookupByKey` folds unknown directories instead of
    // rebuilding. Without this the lookup below resolves through
    // `rebuildKeyIndex` and asserts nothing about the fold at all.
    await mkdir(dirname(getKeyIndexPath(locttDir)), { recursive: true });
    await writeFile(getKeyIndexPath(locttDir), "entries: {}\n", "utf-8");

    // P-11: leniency keeps, never destroys. Reporting the bad
    // directory must not stop the good one being folded in.
    const found = await lookupByKey(locttDir, "T-2");
    expect(found.frontmatter.key).toBe("T-2");
  });

  it("lookupById names the file too, and still reports a missing dir as not found", async () => {
    await writeTask(locttDir, task.frontmatter.id, task);
    const path = await corrupt(task.frontmatter.id);

    const bad = await lookupById(locttDir, "01AAA").catch((e: unknown) => e);
    expect(bad).toBeInstanceOf(UnreadableTaskError);
    expect((bad as UnreadableTaskError).path).toBe(path);

    // ENOENT is still a genuine absence — the fix must not swallow it.
    const gone = await lookupById(locttDir, "01ZZZ").catch((e: unknown) => e);
    expect(gone).toBeInstanceOf(TaskNotFoundError);
  });

  it("lookupTask carries the attribution through the ULID fallback", async () => {
    await writeTask(locttDir, task.frontmatter.id, task);
    await corrupt(task.frontmatter.id);

    // Every surface calls lookupTask, so the attribution has to
    // survive this wrapper or the fix reaches none of them.
    const err = await lookupTask(locttDir, "T-1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnreadableTaskError);
  });

  it("does not cache an unreadable miss as a negative lookup", async () => {
    await writeTask(locttDir, task.frontmatter.id, task);
    await corrupt(task.frontmatter.id);

    await expect(lookupByKey(locttDir, "T-1")).rejects.toBeInstanceOf(
      UnreadableTaskError,
    );

    // Repairing the file must take effect immediately. A negative
    // cache entry written during the corrupt lookup would pin
    // "not found" for the rest of the process even after the fix.
    await writeTask(locttDir, task.frontmatter.id, task);
    const found = await lookupByKey(locttDir, "T-1");
    expect(found.frontmatter.title).toBe("Corrupt me");
  });
});
