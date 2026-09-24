import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initLoctt, lookupByKey, resolveLocttDir } from "@loctt/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { executeTool } from "../index.js";

/**
 * `replace_task_body` added "\n" to every body, so an agent passing
 * text that already ended in a newline stored two. The CLI's `--set`
 * had the same fault; both now go through core's `withTrailingNewline`.
 */
describe("replace_task_body trailing newline", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-mcp-body-"));
    await initLoctt(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function stored(): Promise<string> {
    const locttDir = resolveLocttDir(root);
    const task = await lookupByKey(locttDir, "T-1");
    return readFile(join(locttDir, "tasks", task.frontmatter.id, "task.md"), "utf-8");
  }

  it("stores a body that already ends in a newline with one newline, not two", async () => {
    await executeTool(root, "create_task", { title: "seeded" });
    await executeTool(root, "replace_task_body", { ref: "T-1", body: "Original.\n" });
    expect((await stored()).endsWith("\nOriginal.\n")).toBe(true);
  });

  it("still ends a body without one in a newline", async () => {
    await executeTool(root, "create_task", { title: "seeded" });
    await executeTool(root, "replace_task_body", { ref: "T-1", body: "Original." });
    expect((await stored()).endsWith("\nOriginal.\n")).toBe(true);
  });
});
