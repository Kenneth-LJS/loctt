import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initLoctt } from "@loctt/core";
import { afterEach,beforeEach, describe, expect, it } from "vitest";

import { executeTool,getTools } from "./index.js";

describe("MCP tools", () => {
  it("exports getTools", () => {
    expect(typeof getTools).toBe("function");
  });

  it("returns tool definitions", () => {
    const tools = getTools();
    expect(tools.length).toBeGreaterThan(0);
    const names = tools.map(t => t.name);
    expect(names).toContain("get_task");
    expect(names).toContain("list_tasks");
    expect(names).toContain("create_task");
  });
});

describe("MCP executeTool", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-mcp-"));
    await initLoctt(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("creates and retrieves a task", async () => {
    const createResult = await executeTool(root, "create_task", { title: "MCP test" });
    expect(createResult.isError).toBeUndefined();
    expect(createResult.content[0]?.text).toContain("T-1");

    const listResult = await executeTool(root, "list_tasks", {});
    expect(listResult.content[0]?.text).toContain("MCP test");
  });

  it("returns error for unknown tool", async () => {
    const result = await executeTool(root, "nonexistent", {});
    expect(result.isError).toBe(true);
  });

  it("returns a schema-guard error for tools other than init when schema is newer", async () => {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(root, ".loctt", ".schema-version"), "999\n", "utf-8");
    const result = await executeTool(root, "list_tasks", {});
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/newer version/i);
  });

  it("init bypasses the schema guard so a fresh tracker can be created", async () => {
    // Create a brand-new dir without a .loctt and run init through MCP.
    const fresh = await mkdtemp(join(tmpdir(), "loctt-mcp-init-"));
    try {
      const result = await executeTool(fresh, "init", {});
      expect(result.isError).toBeUndefined();
    } finally {
      await rm(fresh, { recursive: true, force: true });
    }
  });
});
