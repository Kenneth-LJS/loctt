import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Task } from "@loctt/contracts";
import { writeTask } from "./io.js";
import { listTaskIds, lookupById, lookupByKey, lookupTask, TaskNotFoundError } from "./lookup.js";

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
});
