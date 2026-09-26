import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Task } from "@loctt/contracts";
import { afterEach,beforeEach, describe, expect, it } from "vitest";

import { getTaskFilePath } from "../paths/index.js";
import { TaskParseError } from "./frontmatter.js";
import { readTask, readTaskBody, writeTask, writeTaskBody } from "./io.js";
import { loadAllTasksDetailed } from "./load-all.js";

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

  it("updates updated_at when writing body", async () => {
    const oldTask: Task = {
      frontmatter: {
        ...sampleTask.frontmatter,
        updated_at: "2020-01-01T00:00:00Z",
      },
      body: sampleTask.body,
    };
    await writeTask(locttDir, "abc123", oldTask);

    await writeTaskBody(locttDir, "abc123", "New body.\n");
    const loaded = await readTask(locttDir, "abc123");

    expect(loaded.frontmatter.updated_at).not.toBe("2020-01-01T00:00:00Z");
    // updated_at is optional in the type now (K26) but always present on a
    // freshly-written task; assert it's set, then compare.
    expect(loaded.frontmatter.updated_at).toBeDefined();
    expect(new Date(loaded.frontmatter.updated_at ?? "").getTime()).toBeGreaterThan(
      new Date("2020-01-01T00:00:00Z").getTime(),
    );
  });

  it("creates task directory if it does not exist", async () => {
    await writeTask(locttDir, "newid", sampleTask);
    const loaded = await readTask(locttDir, "newid");
    expect(loaded.frontmatter.id).toBe("abc123");
  });

  it("throws when reading a nonexistent task", async () => {
    await expect(readTask(locttDir, "nonexistent")).rejects.toThrow();
  });

  // C110: an object-fatal frontmatter failure must name the broken file,
  // like every config-file parser already does ("{file} is not valid:
  // ..."). `parseFrontmatter` itself has no path to name (it's called
  // from git merge/backup-restore code that has no single obvious file),
  // so `readTask` wraps it with the path it already has (A345).
  it("names the task.md path in an object-fatal frontmatter error", async () => {
    const filePath = getTaskFilePath(locttDir, "corrupt1");
    await mkdir(join(locttDir, "tasks", "corrupt1"), { recursive: true });
    // Missing `id` is object-fatal (K26): the task cannot be addressed.
    await writeFile(
      filePath,
      "---\nkey: T-1\ntitle: Broken\ncreated_at: 2026-04-16T14:30:00Z\nupdated_at: 2026-04-16T14:30:00Z\n---\nBody.\n",
      "utf-8",
    );

    const err = await readTask(locttDir, "corrupt1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TaskParseError);
    const parseErr = err as TaskParseError;
    // A direct throw names the path, exactly once.
    expect(parseErr.message).toBe(
      `${filePath} is not valid: id is required (expected string)`,
    );
    expect(parseErr.message.split(filePath).length - 1).toBe(1);
    // A348: the unwrapped reason and the path are carried separately,
    // so a caller that prints `path: reason` says the path once.
    expect(parseErr.path).toBe(filePath);
    expect(parseErr.reason).toBe("id is required (expected string)");
    expect(parseErr.cause).toBeInstanceOf(TaskParseError);
  });

  // A348: every surface prints `loadAllTasksDetailed`'s rows as
  // `path: reason` (list/board/timeline banners, `loctt list`, sprint,
  // milestone). A reason that repeats the path said it twice.
  it("names the path once in loadAllTasksDetailed's unreadable row", async () => {
    const filePath = getTaskFilePath(locttDir, "corrupt2");
    await mkdir(join(locttDir, "tasks", "corrupt2"), { recursive: true });
    await writeFile(
      filePath,
      "---\nkey: T-2\ntitle: Broken\ncreated_at: 2026-04-16T14:30:00Z\nupdated_at: 2026-04-16T14:30:00Z\n---\n",
      "utf-8",
    );

    const { unreadable } = await loadAllTasksDetailed(locttDir);
    expect(unreadable).toHaveLength(1);
    const u = unreadable[0]!;
    expect(u.path).toBe(filePath);
    expect(u.reason).toBe("id is required (expected string)");
    expect(`${u.path}: ${u.reason}`.split(filePath).length - 1).toBe(1);
  });

  // A348: a file with no frontmatter delimiters failed before the wrap,
  // so its error named no file at all.
  it("names the task.md path when the file has no frontmatter", async () => {
    const filePath = getTaskFilePath(locttDir, "nofm");
    await mkdir(join(locttDir, "tasks", "nofm"), { recursive: true });
    await writeFile(filePath, "just a body, no frontmatter\n", "utf-8");

    const err = await readTask(locttDir, "nofm").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TaskParseError);
    expect((err as TaskParseError).message).toBe(
      `${filePath} is not valid: task.md must start with YAML frontmatter delimited by ---`,
    );
    expect((err as TaskParseError).path).toBe(filePath);
  });
});
