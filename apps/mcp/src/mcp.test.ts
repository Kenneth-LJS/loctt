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

  describe("update_task validation", () => {
    it("rejects an immutable field with a useful message", async () => {
      await executeTool(root, "create_task", { title: "x" });
      const result = await executeTool(root, "update_task", {
        ref: "T-1",
        field: "id",
        value: "new-id",
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text ?? "").toMatch(/immutable field "id"/);
    });

    it("rejects an auto-managed field", async () => {
      await executeTool(root, "create_task", { title: "x" });
      const result = await executeTool(root, "update_task", {
        ref: "T-1",
        field: "completed_date",
        value: "2026-01-01",
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text ?? "").toMatch(/auto-managed field/);
    });

    it("rejects a labels value that isn't an array of strings", async () => {
      await executeTool(root, "create_task", { title: "x" });
      const result = await executeTool(root, "update_task", {
        ref: "T-1",
        field: "labels",
        value: "bug",
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text ?? "").toMatch(/invalid value for field "labels"/);
    });

    it("rejects a title that isn't a string", async () => {
      await executeTool(root, "create_task", { title: "x" });
      const result = await executeTool(root, "update_task", {
        ref: "T-1",
        field: "title",
        value: 42,
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text ?? "").toMatch(/invalid value for field "title"/);
    });

    it("rejects a missing field argument", async () => {
      await executeTool(root, "create_task", { title: "x" });
      const result = await executeTool(root, "update_task", { ref: "T-1", value: "x" });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text ?? "").toMatch(/`field` is required/);
    });

    it("accepts a valid labels array", async () => {
      await executeTool(root, "create_task", { title: "x" });
      const result = await executeTool(root, "update_task", {
        ref: "T-1",
        field: "labels",
        value: ["bug", "urgent"],
      });
      expect(result.isError).toBeUndefined();
    });

    it("forwards a valid-shape but workflow-invalid status to the validator", async () => {
      // Shape passes (`status` accepts any non-empty string), but the
      // workflow's status enum doesn't recognise "definitely-not-real".
      // The error reaches the agent as a clean TaskUpdateError, not a
      // raw stack from setField.
      await executeTool(root, "create_task", { title: "x" });
      const result = await executeTool(root, "update_task", {
        ref: "T-1",
        field: "status",
        value: "definitely-not-real",
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text ?? "").toMatch(/status/i);
    });

    it("rejects setting updated_at via MCP", async () => {
      // updated_at is built-in writable via setField but not exposed
      // in the MCP schema map; without the writability check, it
      // would silently fall through to the custom-field path and
      // write `fields.updated_at`.
      await executeTool(root, "create_task", { title: "x" });
      const result = await executeTool(root, "update_task", {
        ref: "T-1",
        field: "updated_at",
        value: "2026-01-01T00:00:00.000Z",
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text ?? "").toMatch(/not settable via MCP/);
    });

    it("forwards unknown fields to setField, which then defers to the workflow validator", async () => {
      // The MCP layer doesn't reject unknown fields outright; it
      // hands them to setField which checks them against the
      // workflow's custom_fields. With no custom field declared, the
      // workflow validator returns the rejection — but the error
      // reaches the agent as a clean TaskUpdateError, not a stack.
      await executeTool(root, "create_task", { title: "x" });
      const result = await executeTool(root, "update_task", {
        ref: "T-1",
        field: "story_points",
        value: 5,
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text ?? "").toMatch(/story_points/);
    });
  });

  describe("unset_field validation", () => {
    it("rejects unsetting an immutable field", async () => {
      await executeTool(root, "create_task", { title: "x" });
      const result = await executeTool(root, "unset_field", { ref: "T-1", field: "id" });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text ?? "").toMatch(/immutable field "id"/);
    });

    it("rejects unsetting title (required)", async () => {
      await executeTool(root, "create_task", { title: "x" });
      const result = await executeTool(root, "unset_field", { ref: "T-1", field: "title" });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text ?? "").toMatch(/required field "title"/);
    });

    it("rejects unsetting an auto-managed field", async () => {
      await executeTool(root, "create_task", { title: "x" });
      const result = await executeTool(root, "unset_field", {
        ref: "T-1",
        field: "completed_date",
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text ?? "").toMatch(/auto-managed/);
    });

    it("clears a previously-set built-in optional field", async () => {
      await executeTool(root, "create_task", { title: "x" });
      await executeTool(root, "update_task", {
        ref: "T-1",
        field: "priority",
        value: "high",
      });
      const result = await executeTool(root, "unset_field", { ref: "T-1", field: "priority" });
      expect(result.isError).toBeUndefined();
    });
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
