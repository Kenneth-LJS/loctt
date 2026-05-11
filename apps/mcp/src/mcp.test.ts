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

  it("uses action-first naming exclusively", () => {
    // The convention is verb_noun, e.g. `create_task`, `list_users`.
    // Catches entity-first regressions like `task_create`, `user_list`,
    // `config_get`, `git_enable`.
    const ENTITY_FIRST_NAME = /^(task|project|user|label|milestone|sprint|config|git|view|attachment)_/;
    const tools = getTools();
    const entityFirstHits = tools.map(t => t.name).filter(n => ENTITY_FIRST_NAME.test(n));
    expect(entityFirstHits).toEqual([]);
  });

  it("descriptions don't reference any old entity-first tool names", () => {
    // Tool descriptions are read by LLMs; an old name in a description
    // (like "Equivalent to project_delete...") is actively misleading
    // even if the actual tool is named correctly. This catches
    // descriptions that drift behind a rename.
    const ENTITY_FIRST_REF = /\b(task|project|user|label|milestone|sprint|config|git|view|attachment)_(list|create|edit|delete|archive|unarchive|set_default|current|switch|get|set|unset|enable|disable|status|publish|sync|history)\b/;
    const tools = getTools();
    const offenders = tools
      .filter(t => ENTITY_FIRST_REF.test(t.description))
      .map(t => `${t.name}: ${t.description.match(ENTITY_FIRST_REF)?.[0]}`);
    expect(offenders).toEqual([]);
  });

  it("does not expose any soft-delete-via-hard-flag tools", () => {
    // The `delete_*` family is hard-only; soft delete lives in the
    // `archive_*` siblings. This test exists so a future PR that
    // re-adds a `hard` boolean field is caught.
    const tools = getTools();
    for (const tool of tools) {
      if (!/^delete_/.test(tool.name)) continue;
      expect(tool.inputSchema, `${tool.name} schema`).not.toHaveProperty("hard");
    }
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

  it("delete_task without confirm is rejected; archive_task is the soft path", async () => {
    await executeTool(root, "create_task", { title: "to-delete" });

    // Without confirm: refused.
    const refused = await executeTool(root, "delete_task", { ref: "T-1" });
    expect(refused.isError).toBe(true);
    expect(refused.content[0]?.text).toMatch(/confirm/i);

    // archive_task succeeds without confirm.
    const archived = await executeTool(root, "archive_task", { ref: "T-1" });
    expect(archived.isError).toBeUndefined();

    // delete_task with confirm succeeds and removes the task entirely.
    const deleted = await executeTool(root, "delete_task", { ref: "T-1", confirm: true });
    expect(deleted.isError).toBeUndefined();
  });
});
