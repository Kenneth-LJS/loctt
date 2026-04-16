import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Task } from "@loctt/contracts";
import { writeTask } from "./io.js";
import { discoverAttachments, buildShowModel } from "./show.js";
import { getTaskDir } from "../paths/index.js";

describe("task show model", () => {
  let locttDir: string;

  beforeEach(async () => {
    const tmp = await mkdtemp(join(tmpdir(), "loctt-show-"));
    locttDir = join(tmp, ".loctt");
  });

  afterEach(async () => {
    await rm(join(locttDir, ".."), { recursive: true, force: true });
  });

  const task: Task = {
    frontmatter: {
      id: "abc123",
      key: "T-1",
      title: "Show test",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    },
    body: "Description here.\n",
  };

  it("discovers no attachments when only task.md exists", async () => {
    await writeTask(locttDir, "abc123", task);
    const attachments = await discoverAttachments(locttDir, "abc123");
    expect(attachments).toEqual([]);
  });

  it("discovers attachment files in the task directory", async () => {
    await writeTask(locttDir, "abc123", task);
    const taskDir = getTaskDir(locttDir, "abc123");
    await writeFile(join(taskDir, "screenshot.png"), "fake-image-data");
    await writeFile(join(taskDir, "notes.txt"), "some notes");

    const attachments = await discoverAttachments(locttDir, "abc123");
    expect(attachments).toHaveLength(2);
    const names = attachments.map(a => a.name).sort();
    expect(names).toEqual(["notes.txt", "screenshot.png"]);
    expect(attachments.every(a => a.size > 0)).toBe(true);
  });

  it("returns empty array for nonexistent task directory", async () => {
    const attachments = await discoverAttachments(locttDir, "nonexistent");
    expect(attachments).toEqual([]);
  });

  it("builds a complete show model", async () => {
    await writeTask(locttDir, "abc123", task);
    const taskDir = getTaskDir(locttDir, "abc123");
    await writeFile(join(taskDir, "doc.pdf"), "pdf-data");

    const model = await buildShowModel(locttDir, task);
    expect(model.task).toBe(task);
    expect(model.attachments).toHaveLength(1);
    expect(model.attachments[0]?.name).toBe("doc.pdf");
  });
});
