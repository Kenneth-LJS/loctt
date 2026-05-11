import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Task } from "@loctt/contracts";
import { afterEach,beforeEach, describe, expect, it } from "vitest";

import { getAttachmentsDir, getTaskDir } from "../paths/index.js";
import { writeTask } from "./io.js";
import { buildShowModel,discoverAttachments } from "./show.js";

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

  it("discovers attachment files in the attachments/ subdirectory", async () => {
    await writeTask(locttDir, "abc123", task);
    const attachmentsDir = getAttachmentsDir(locttDir, "abc123");
    await mkdir(attachmentsDir, { recursive: true });
    await writeFile(join(attachmentsDir, "screenshot.png"), "fake-image-data");
    await writeFile(join(attachmentsDir, "notes.txt"), "some notes");

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

  it("returns empty array when the task has no attachments/ directory", async () => {
    await writeTask(locttDir, "abc123", task);
    const attachments = await discoverAttachments(locttDir, "abc123");
    expect(attachments).toEqual([]);
  });

  it("does not list system files at the task root as attachments", async () => {
    await writeTask(locttDir, "abc123", task);
    const taskDir = getTaskDir(locttDir, "abc123");
    await writeFile(join(taskDir, "_history.yaml"), "[]");

    const attachments = await discoverAttachments(locttDir, "abc123");
    expect(attachments).toEqual([]);
  });

  it("skips dotfiles and nested subdirectories inside attachments/", async () => {
    await writeTask(locttDir, "abc123", task);
    const attachmentsDir = getAttachmentsDir(locttDir, "abc123");
    await mkdir(join(attachmentsDir, "nested"), { recursive: true });
    await writeFile(join(attachmentsDir, ".hidden"), "x");
    await writeFile(join(attachmentsDir, "real.txt"), "y");
    await writeFile(join(attachmentsDir, "nested", "inner.txt"), "z");

    const attachments = await discoverAttachments(locttDir, "abc123");
    expect(attachments.map(a => a.name)).toEqual(["real.txt"]);
  });

  it("builds a complete show model", async () => {
    await writeTask(locttDir, "abc123", task);
    const attachmentsDir = getAttachmentsDir(locttDir, "abc123");
    await mkdir(attachmentsDir, { recursive: true });
    await writeFile(join(attachmentsDir, "doc.pdf"), "pdf-data");

    const model = await buildShowModel(locttDir, task);
    expect(model.task).toBe(task);
    expect(model.attachments).toHaveLength(1);
    expect(model.attachments[0]?.name).toBe("doc.pdf");
    expect(model.relationships).toEqual([]);
  });

  it("resolves relationship target IDs to current keys", async () => {
    const targetTask: Task = {
      frontmatter: {
        id: "target-id",
        key: "T-2",
        title: "Target",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
      body: "",
    };
    const sourceTask: Task = {
      frontmatter: {
        ...task.frontmatter,
        relationships: [{ type: "blocks", target: "target-id" }],
      },
      body: task.body,
    };
    await writeTask(locttDir, "abc123", sourceTask);
    await writeTask(locttDir, "target-id", targetTask);

    const model = await buildShowModel(locttDir, sourceTask);
    expect(model.relationships).toHaveLength(1);
    expect(model.relationships[0]).toEqual({
      type: "blocks",
      target: "target-id",
      resolvedKey: "T-2",
      missing: false,
    });
  });

  it("marks relationship targets as missing when the task is gone", async () => {
    const sourceTask: Task = {
      frontmatter: {
        ...task.frontmatter,
        relationships: [{ type: "blocks", target: "vanished-id" }],
      },
      body: task.body,
    };
    await writeTask(locttDir, "abc123", sourceTask);

    const model = await buildShowModel(locttDir, sourceTask);
    expect(model.relationships).toHaveLength(1);
    expect(model.relationships[0]).toEqual({
      type: "blocks",
      target: "vanished-id",
      missing: true,
    });
  });
});
