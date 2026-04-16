import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readTask, writeTask, readTaskBody, writeTaskBody } from "./io.js";
import type { Task } from "@loctt/contracts";

describe("task I/O", () => {
  let locttDir: string;

  beforeEach(async () => {
    const tmp = await mkdtemp(join(tmpdir(), "loctt-test-"));
    locttDir = join(tmp, ".loctt");
  });

  afterEach(async () => {
    // Clean up temp dir (parent of .loctt)
    await rm(join(locttDir, ".."), { recursive: true, force: true });
  });

  const sampleTask: Task = {
    frontmatter: {
      id: "abc123",
      key: "T-1",
      title: "Test task",
      created_at: "2026-04-16T14:30:00Z",
      updated_at: "2026-04-16T14:30:00Z",
      status: "not_started",
    },
    body: "Some task description.\n",
  };

  it("writes and reads a task round-trip", async () => {
    await writeTask(locttDir, "abc123", sampleTask);
    const loaded = await readTask(locttDir, "abc123");

    expect(loaded.frontmatter.id).toBe("abc123");
    expect(loaded.frontmatter.key).toBe("T-1");
    expect(loaded.frontmatter.title).toBe("Test task");
    expect(loaded.frontmatter.status).toBe("not_started");
    expect(loaded.body).toBe("Some task description.\n");
  });

  it("reads only the body", async () => {
    await writeTask(locttDir, "abc123", sampleTask);
    const body = await readTaskBody(locttDir, "abc123");
    expect(body).toBe("Some task description.\n");
  });

  it("replaces the body while preserving frontmatter", async () => {
    await writeTask(locttDir, "abc123", sampleTask);
    await writeTaskBody(locttDir, "abc123", "Updated body.\n");

    const loaded = await readTask(locttDir, "abc123");
    expect(loaded.frontmatter.title).toBe("Test task");
    expect(loaded.body).toBe("Updated body.\n");
  });

  it("creates task directory if it does not exist", async () => {
    await writeTask(locttDir, "newid", sampleTask);
    const loaded = await readTask(locttDir, "newid");
    expect(loaded.frontmatter.id).toBe("abc123");
  });

  it("throws when reading a nonexistent task", async () => {
    await expect(readTask(locttDir, "nonexistent")).rejects.toThrow();
  });
});
