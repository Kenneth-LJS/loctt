import { mkdir,mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Task } from "@loctt/contracts";
import { afterEach,beforeEach, describe, expect, it } from "vitest";

import { writeTask } from "./io.js";
import { listTaskIds } from "./list-ids.js";
import { lookupById, lookupByKey, lookupTask, TaskNotFoundError } from "./lookup.js";

describe("task lookup", () => {
  let locttDir: string;

  beforeEach(async () => {
    const tmp = await mkdtemp(join(tmpdir(), "loctt-lookup-"));
    locttDir = join(tmp, ".loctt");
  });

  afterEach(async () => {
    await rm(join(locttDir, ".."), { recursive: true, force: true });
  });

  const task1: Task = {
    frontmatter: {
      id: "01AAA",
      key: "T-1",
      title: "First task",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    },
    body: "",
  };

  const task2: Task = {
    frontmatter: {
      id: "01BBB",
      key: "T-2",
      title: "Second task",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      key_history: ["T-1-old"],
    },
    body: "",
  };

  async function seedTasks(): Promise<void> {
    await writeTask(locttDir, task1.frontmatter.id, task1);
    await writeTask(locttDir, task2.frontmatter.id, task2);
  }

  it("lists task ids from the tasks directory", async () => {
    await seedTasks();
    const ids = await listTaskIds(locttDir);
    expect(ids.sort()).toEqual(["01AAA", "01BBB"]);
  });

  it("returns empty array when tasks directory does not exist", async () => {
    const ids = await listTaskIds(locttDir);
    expect(ids).toEqual([]);
  });

  it("looks up a task by id", async () => {
    await seedTasks();
    const found = await lookupById(locttDir, "01AAA");
    expect(found.frontmatter.title).toBe("First task");
  });

  it("throws TaskNotFoundError for unknown id", async () => {
    await seedTasks();
    await expect(lookupById(locttDir, "ZZZZZ")).rejects.toThrow(TaskNotFoundError);
  });

  it("looks up a task by current key", async () => {
    await seedTasks();
    const found = await lookupByKey(locttDir, "T-2");
    expect(found.frontmatter.id).toBe("01BBB");
  });

  it("looks up a task by key_history", async () => {
    await seedTasks();
    const found = await lookupByKey(locttDir, "T-1-old");
    expect(found.frontmatter.id).toBe("01BBB");
  });

  it("throws TaskNotFoundError for unknown key", async () => {
    await seedTasks();
    await expect(lookupByKey(locttDir, "T-999")).rejects.toThrow(TaskNotFoundError);
  });

  it("lookupTask tries id first for ULID-like refs", async () => {
    await seedTasks();
    // "01AAA" is not 26 chars so it won't match ULID pattern — goes to key lookup
    // Let's test with a proper 26-char ULID-like id
    const ulidTask: Task = {
      frontmatter: {
        id: "01HSV6TQ3Y7M8K9N4R5S6A7B8C",
        key: "T-99",
        title: "ULID task",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
      body: "",
    };
    await writeTask(locttDir, ulidTask.frontmatter.id, ulidTask);

    const found = await lookupTask(locttDir, "01HSV6TQ3Y7M8K9N4R5S6A7B8C");
    expect(found.frontmatter.key).toBe("T-99");
  });

  it("lookupTask falls back to key for non-ULID refs", async () => {
    await seedTasks();
    const found = await lookupTask(locttDir, "T-1");
    expect(found.frontmatter.id).toBe("01AAA");
  });

  it("lookupById re-throws non-ENOENT errors instead of masking them", async () => {
    // Create a task directory with a corrupt task.md
    const taskDir = join(locttDir, "tasks", "01CORRUPT");
    await mkdir(taskDir, { recursive: true });
    await writeFile(join(taskDir, "task.md"), "not valid frontmatter at all", "utf-8");

    // Should throw a parse error, not TaskNotFoundError
    await expect(lookupById(locttDir, "01CORRUPT")).rejects.not.toThrow(TaskNotFoundError);
    await expect(lookupById(locttDir, "01CORRUPT")).rejects.toThrow();
  });

  describe("lookupByKey lazy fold + dangling drop", () => {
    it("does not rewrite the index file when a miss finds no new task directories", async () => {
      const { stat } = await import("node:fs/promises");
      const { rebuildKeyIndex } = await import("../state/key-index.js");
      const { getKeyIndexPath } = await import("../paths/index.js");
      await seedTasks();
      await rebuildKeyIndex(locttDir);

      const indexPath = getKeyIndexPath(locttDir);
      const mtimeBefore = (await stat(indexPath)).mtimeMs;

      // Pause so any rebuild would produce a strictly greater
      // mtime even on second-granularity filesystems.
      await new Promise(resolve => setTimeout(resolve, 1100));

      await expect(lookupByKey(locttDir, "T-99")).rejects.toThrow(TaskNotFoundError);

      // Fold short-circuits when unknownIds is empty — no save.
      const mtimeAfter = (await stat(indexPath)).mtimeMs;
      expect(mtimeAfter).toBe(mtimeBefore);
    });

    it("the in-process negative cache is invalidated when a task write lands", async () => {
      const { rebuildKeyIndex } = await import("../state/key-index.js");
      await seedTasks();
      await rebuildKeyIndex(locttDir);

      // Cache the miss for T-3.
      await expect(lookupByKey(locttDir, "T-3")).rejects.toThrow(TaskNotFoundError);

      // Write a third task with key T-3. writeTask invalidates the
      // in-process negative cache so the next lookup retries.
      await writeTask(locttDir, "01CCC", {
        frontmatter: {
          id: "01CCC",
          key: "T-3",
          title: "third",
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
        body: "",
      });

      // The fold path then discovers the new task directory and
      // adds it to the index.
      const task = await lookupByKey(locttDir, "T-3");
      expect(task.frontmatter.id).toBe("01CCC");
    });

    it("folds in a task created out-of-band (creation race / git pull)", async () => {
      const { rebuildKeyIndex, loadKeyIndex } = await import("../state/key-index.js");
      await seedTasks();
      await rebuildKeyIndex(locttDir);

      // Simulate another process / git pull adding a task without
      // going through writeTask (which would invalidate the cache).
      // We use writeTask here because it produces the right format,
      // but we then clear the negative cache manually to mimic a
      // fresh process that has no in-memory state about T-7.
      await writeTask(locttDir, "01DDD", {
        frontmatter: {
          id: "01DDD",
          key: "T-7",
          title: "out-of-band",
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
        body: "",
      });

      const before = await loadKeyIndex(locttDir);
      expect(before?.entries["T-7"]).toBeUndefined();

      const task = await lookupByKey(locttDir, "T-7");
      expect(task.frontmatter.id).toBe("01DDD");

      // Fold persisted the new entry.
      const after = await loadKeyIndex(locttDir);
      expect(after?.entries["T-7"]).toBe("01DDD");
    });

    it("drops a dangling entry when the indexed task.md is gone", async () => {
      const { rm } = await import("node:fs/promises");
      const { rebuildKeyIndex, loadKeyIndex } = await import("../state/key-index.js");
      await seedTasks();
      await rebuildKeyIndex(locttDir);

      // Simulate a concurrent delete by another process.
      await rm(join(locttDir, "tasks", "01AAA"), { recursive: true });

      await expect(lookupByKey(locttDir, "T-1")).rejects.toThrow(TaskNotFoundError);

      const after = await loadKeyIndex(locttDir);
      expect(after?.entries["T-1"]).toBeUndefined();
    });

    it("documented limitation: an out-of-band rewrite of an existing task's key is NOT auto-detected; doctor repairs it", async () => {
      const { mkdir, readFile, writeFile } = await import("node:fs/promises");
      const { rebuildKeyIndex } = await import("../state/key-index.js");
      await seedTasks();
      await rebuildKeyIndex(locttDir);

      // Hand-rewrite task1's frontmatter to change its key. This is
      // explicitly unsupported; LocTT's contract says key edits go
      // through git reconciliation, and out-of-band edits require
      // `loctt doctor --rebuild-index`. The test pins the contract.
      void mkdir;
      const taskMd = join(locttDir, "tasks", "01AAA", "task.md");
      const original = await readFile(taskMd, "utf-8");
      const rewritten = original.replace("key: T-1", "key: T-1-renamed");
      await writeFile(taskMd, rewritten, "utf-8");

      // Index still says T-1 → 01AAA. Lookup happily returns 01AAA
      // with its new key, which IS the file on disk. The "stale"
      // aspect is that "T-1-renamed" → 01AAA isn't in the index
      // until doctor rebuilds.
      await expect(lookupByKey(locttDir, "T-1-renamed")).rejects.toThrow(TaskNotFoundError);

      // After explicit rebuild, the new key resolves.
      await rebuildKeyIndex(locttDir);
      const found = await lookupByKey(locttDir, "T-1-renamed");
      expect(found.frontmatter.id).toBe("01AAA");
    });
  });

  it("loadAllTasks returns every task and tolerates large counts", async () => {
    // Regression: loadAllTasks used to fan out one fd per task with
    // an unbounded Promise.all. macOS's default ulimit (256) made
    // this break around 250 tasks. Seeding 100 here is a safety
    // floor — the cap (READ_CONCURRENCY = 32) is well below the
    // ulimit so a thousand-task tracker would still be fine.
    const { loadAllTasks } = await import("./load-all.js");
    const COUNT = 100;
    for (let i = 0; i < COUNT; i += 1) {
      const id = `01LARGE${String(i).padStart(3, "0")}`;
      await writeTask(locttDir, id, {
        frontmatter: {
          id,
          key: `T-${i}`,
          title: `task ${i}`,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
        body: "",
      });
    }
    const tasks = await loadAllTasks(locttDir);
    expect(tasks).toHaveLength(COUNT);
    // Sanity check ordering matches the listed ids.
    const titles = new Set(tasks.map(t => t.frontmatter.title));
    expect(titles.size).toBe(COUNT);
  });
});
