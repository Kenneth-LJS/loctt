import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Task } from "@loctt/contracts";
import { afterEach,beforeEach, describe, expect, it } from "vitest";

import { readHistory } from "./history.js";
import { readTask,writeTask } from "./io.js";
import { archiveTask, deleteTask,unarchiveTask } from "./lifecycle.js";
import { listTaskIds } from "./list-ids.js";

describe("task lifecycle", () => {
  let locttDir: string;

  beforeEach(async () => {
    const tmp = await mkdtemp(join(tmpdir(), "loctt-lifecycle-"));
    locttDir = join(tmp, ".loctt");
  });

  afterEach(async () => {
    await rm(join(locttDir, ".."), { recursive: true, force: true });
  });

  const seed: Task = {
    frontmatter: {
      id: "abc",
      key: "T-1",
      title: "Lifecycle test",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    },
    body: "Body.\n",
  };

  async function seedTask(): Promise<void> {
    await writeTask(locttDir, "abc", seed);
  }

  describe("archiveTask", () => {
    it("sets archived and archived_at", async () => {
      await seedTask();
      const result = await archiveTask(locttDir, "abc");
      expect(result.frontmatter.archived).toBe(true);
      expect(result.frontmatter.archived_at).toBeTruthy();
    });

    it("persists to disk", async () => {
      await seedTask();
      await archiveTask(locttDir, "abc");
      const loaded = await readTask(locttDir, "abc");
      expect(loaded.frontmatter.archived).toBe(true);
    });

    // K25: idempotent archive/unarchive (behavior recorded in decisions.md K25/A127; no canonical case)
    it("is idempotent: archiving an already-archived task is a no-op success (K25)", async () => {
      await seedTask();
      const first = await archiveTask(locttDir, "abc");
      const historyAfterFirst = await readHistory(locttDir, "abc");

      // K25: a second archive does NOT throw — it returns the task in
      // the requested (archived) state, matching bulkArchive. Before
      // K25 this threw TaskLifecycleError, which the web layer turned
      // into a generic 500 (TSK-57 / B16).
      const second = await archiveTask(locttDir, "abc");
      expect(second.frontmatter.archived).toBe(true);

      // ...and writes nothing new: no extra history entry, and the
      // archived_at timestamp is not bumped by the no-op.
      const historyAfterSecond = await readHistory(locttDir, "abc");
      expect(historyAfterSecond.length).toBe(historyAfterFirst.length);
      expect(second.frontmatter.archived_at).toBe(first.frontmatter.archived_at);
    });
  });

  describe("unarchiveTask", () => {
    it("removes archived fields", async () => {
      await seedTask();
      await archiveTask(locttDir, "abc");
      const result = await unarchiveTask(locttDir, "abc");
      expect(result.frontmatter.archived).toBeUndefined();
      expect(result.frontmatter.archived_at).toBeUndefined();
    });

    // K25: idempotent archive/unarchive (behavior recorded in decisions.md K25/A127; no canonical case)
    it("is idempotent: unarchiving a task that is not archived is a no-op success (K25)", async () => {
      await seedTask();
      const historyBefore = await readHistory(locttDir, "abc");
      // K25 (mirror): returns the task in the requested (unarchived)
      // state rather than throwing.
      const result = await unarchiveTask(locttDir, "abc");
      expect(result.frontmatter.archived).toBeUndefined();
      const historyAfter = await readHistory(locttDir, "abc");
      expect(historyAfter.length).toBe(historyBefore.length);
    });
  });

  describe("deleteTask", () => {
    it("removes the task directory with force", async () => {
      await seedTask();
      await deleteTask(locttDir, "abc", { force: true });
      const ids = await listTaskIds(locttDir);
      expect(ids).not.toContain("abc");
    });

    it("throws without force flag", async () => {
      await seedTask();
      await expect(deleteTask(locttDir, "abc", { force: false }))
        .rejects.toThrow("requires --force");
    });

    it("throws for nonexistent task", async () => {
      await expect(deleteTask(locttDir, "nonexistent", { force: true }))
        .rejects.toThrow();
    });
  });
});
