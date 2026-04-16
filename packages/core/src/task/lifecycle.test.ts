import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Task } from "@loctt/contracts";
import { writeTask, readTask } from "./io.js";
import { archiveTask, unarchiveTask, deleteTask, TaskLifecycleError } from "./lifecycle.js";
import { listTaskIds } from "./lookup.js";

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

    it("throws if already archived", async () => {
      await seedTask();
      await archiveTask(locttDir, "abc");
      await expect(archiveTask(locttDir, "abc")).rejects.toThrow(TaskLifecycleError);
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

    it("throws if not archived", async () => {
      await seedTask();
      await expect(unarchiveTask(locttDir, "abc")).rejects.toThrow(TaskLifecycleError);
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
