import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initLoctt, lookupByKey, resolveLocttDir } from "@loctt/core";
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

  describe("tool-level arg validation (chunk 8)", () => {
    it("rejects an unknown field name in args (strict mode)", async () => {
      // The tool's inputSchema doesn't declare `tite`. Without strict
      // arg parsing the typo would be silently ignored and the
      // missing required `title` would surface as a downstream
      // create error. With strict() the LLM gets a clean rejection
      // pointing at the typo.
      const result = await executeTool(root, "create_task", {
        tite: "typo!",
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text ?? "").toMatch(/invalid args for create_task/);
    });

    it("rejects a wrong-type arg with the field path in the error", async () => {
      // `ref` should be a string. Pass a number.
      const result = await executeTool(root, "get_task", {
        ref: 42,
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text ?? "").toMatch(/ref/);
      expect(result.content[0]?.text ?? "").toMatch(/expected string/i);
    });

    it("accepts well-shaped args without complaint", async () => {
      await executeTool(root, "create_task", { title: "ok" });
      const result = await executeTool(root, "get_task", { ref: "T-1" });
      expect(result.isError).toBeUndefined();
    });

    it("create_task surfaces a 'Known: ...' hint for an unknown status", async () => {
      // Mirrors the CLI's enum pre-validation: instead of letting
      // createTask throw a generic 'invalid task' string, the MCP
      // boundary returns a clear errorResult with the workflow's
      // valid keys listed.
      const result = await executeTool(root, "create_task", {
        title: "x",
        status: "nope",
      });
      expect(result.isError).toBe(true);
      const msg = result.content[0]?.text ?? "";
      expect(msg).toMatch(/unknown status 'nope'/);
      expect(msg).toMatch(/Known: /);
    });

    it("create_task accepts a known status without complaint", async () => {
      // backlog is the first default workflow status.
      const result = await executeTool(root, "create_task", {
        title: "x",
        status: "backlog",
      });
      expect(result.isError).toBeUndefined();
    });

    it("tools with empty inputSchema still validate (and accept {})", async () => {
      // info has inputSchema: {}. Strict mode means an unknown arg
      // is rejected; empty args succeed.
      const ok = await executeTool(root, "info", {});
      expect(ok.isError).toBeUndefined();
      const bad = await executeTool(root, "info", { surprise: 1 });
      expect(bad.isError).toBe(true);
      expect(bad.content[0]?.text ?? "").toMatch(/invalid args for info/);
    });
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
      // Caught at the outer parseToolArgs layer now (chunk 8); the
      // message names the field path and the expected type rather
      // than the older inner-validator wording.
      expect(result.content[0]?.text ?? "").toMatch(/field/);
      expect(result.content[0]?.text ?? "").toMatch(/expected string/i);
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

  describe("delete-confirm gating across entities", () => {
    // Every delete_* tool MUST refuse without confirm: true. This is
    // the contract documented in docs/user/mcp/reference.md and the
    // agent's safety net: a delete_* call without confirm means the
    // agent misunderstood the destructive nature; archive_* is the
    // reversible alternative.

    it("delete_project without confirm is rejected", async () => {
      // Need two projects so the lone-project guard doesn't fire
      // first.
      await executeTool(root, "create_project", { name: "Alt", prefix: "ALT-" });
      const result = await executeTool(root, "delete_project", { project: "Alt" });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toMatch(/confirm/i);
    });

    it("delete_label without confirm is rejected", async () => {
      await executeTool(root, "create_label", { name: "Blocker" });
      const result = await executeTool(root, "delete_label", { label: "Blocker" });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toMatch(/confirm/i);
    });

    it("delete_milestone without confirm is rejected", async () => {
      await executeTool(root, "create_milestone", { name: "v1" });
      const result = await executeTool(root, "delete_milestone", { milestone: "v1" });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toMatch(/confirm/i);
    });

    it("delete_sprint without confirm is rejected", async () => {
      await executeTool(root, "create_sprint", {
        name: "Sprint 1",
        start_date: "2026-05-04",
        end_date: "2026-05-08",
        state: "active",
      });
      const result = await executeTool(root, "delete_sprint", { sprint: "Sprint 1" });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toMatch(/confirm/i);
    });

    it("delete_user without confirm is rejected", async () => {
      // delete_user accepts a `ref` (id-or-name); pass "Alice" to
      // skip the need to parse the ULID out of create_user output.
      await executeTool(root, "create_user", { name: "Alice" });
      const result = await executeTool(root, "delete_user", { ref: "Alice" });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toMatch(/confirm/i);
    });
  });

  describe("get_sprint_burndown", () => {
    it("returns the series for a known sprint", async () => {
      const { resolveLocttDir, saveSprintsConfig } = await import("@loctt/core");
      const locttDir = resolveLocttDir(root);
      const sprintId = "01HXSPRINT0000000000000001";
      await saveSprintsConfig(locttDir, {
        sprints: [{
          id: sprintId,
          name: "Sprint 1",
          start_date: "2026-05-04",
          end_date: "2026-05-08",
          state: "active",
        }],
      });

      const result = await executeTool(root, "get_sprint_burndown", { sprint: sprintId });
      expect(result.isError).toBeUndefined();
      const payload = JSON.parse(result.content[0]?.text ?? "{}") as {
        sprintId: string;
        series: { date: string }[];
      };
      expect(payload.sprintId).toBe(sprintId);
      expect(payload.series.length).toBe(5);
    });

    it("returns a clean error for an unknown sprint", async () => {
      const result = await executeTool(root, "get_sprint_burndown", { sprint: "01HXNOSUCH" });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text ?? "").toMatch(/unknown sprint/);
    });
  });

  describe("reorder_board", () => {
    it("is registered with the expected schema", () => {
      const tool = getTools().find(t => t.name === "reorder_board");
      expect(tool).toBeDefined();
      expect(tool?.inputSchema).toHaveProperty("ref");
      expect(tool?.inputSchema).toHaveProperty("before");
      expect(tool?.inputSchema).toHaveProperty("after");
    });

    it("moves a task before another and persists the new rank", async () => {
      // Verifying the on-disk rank change here — not just the returned
      // payload — so a regression that returns a rank but skips the
      // write can't slip through.
      await executeTool(root, "create_task", { title: "a" });
      await executeTool(root, "create_task", { title: "b" });
      await executeTool(root, "create_task", { title: "c" });
      const result = await executeTool(root, "reorder_board", {
        ref: "T-3",
        before: "T-1",
      });
      expect(result.isError).toBeUndefined();
      const payload = JSON.parse(result.content[0]?.text ?? "{}") as {
        rank: string;
      };
      expect(typeof payload.rank).toBe("string");
      expect(payload.rank.length).toBeGreaterThan(0);

      const locttDir = resolveLocttDir(root);
      const t1 = await lookupByKey(locttDir, "T-1");
      const t3 = await lookupByKey(locttDir, "T-3");
      expect(t3.frontmatter.board_rank).toBe(payload.rank);
      if (t1.frontmatter.board_rank !== undefined) {
        expect(t3.frontmatter.board_rank! < t1.frontmatter.board_rank).toBe(true);
      }
    });

    it("moves a task after another", async () => {
      await executeTool(root, "create_task", { title: "a" });
      await executeTool(root, "create_task", { title: "b" });
      await executeTool(root, "create_task", { title: "c" });
      const result = await executeTool(root, "reorder_board", {
        ref: "T-1",
        after: "T-3",
      });
      expect(result.isError).toBeUndefined();
      const locttDir = resolveLocttDir(root);
      const t1 = await lookupByKey(locttDir, "T-1");
      const t3 = await lookupByKey(locttDir, "T-3");
      if (t3.frontmatter.board_rank !== undefined) {
        expect(t1.frontmatter.board_rank! > t3.frontmatter.board_rank).toBe(true);
      }
    });

    it("with neither before nor after, moves the task to the end of the column", async () => {
      await executeTool(root, "create_task", { title: "a" });
      await executeTool(root, "create_task", { title: "b" });
      await executeTool(root, "create_task", { title: "c" });
      const result = await executeTool(root, "reorder_board", { ref: "T-1" });
      expect(result.isError).toBeUndefined();
      const locttDir = resolveLocttDir(root);
      const t1 = await lookupByKey(locttDir, "T-1");
      const t2 = await lookupByKey(locttDir, "T-2");
      const t3 = await lookupByKey(locttDir, "T-3");
      if (
        t2.frontmatter.board_rank !== undefined &&
        t3.frontmatter.board_rank !== undefined
      ) {
        expect(t1.frontmatter.board_rank! > t2.frontmatter.board_rank).toBe(true);
        expect(t1.frontmatter.board_rank! > t3.frontmatter.board_rank).toBe(true);
      }
    });

    it("rejects before + after together", async () => {
      await executeTool(root, "create_task", { title: "a" });
      await executeTool(root, "create_task", { title: "b" });
      await executeTool(root, "create_task", { title: "c" });
      const result = await executeTool(root, "reorder_board", {
        ref: "T-3",
        before: "T-1",
        after: "T-2",
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text ?? "").toMatch(/mutually exclusive/);
    });

    it("returns a clean error when the task ref does not resolve", async () => {
      const result = await executeTool(root, "reorder_board", { ref: "T-999" });
      expect(result.isError).toBe(true);
    });
  });

  describe("get_task response shape", () => {
    // Regression: the attachments shape gained an optional `mime` field
    // (commit 4472ed3). These tests pin down the contract so future
    // changes don't accidentally promote mime to required or strip it.

    async function getTaskJson(ref: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
      const result = await executeTool(root, "get_task", { ref, ...args });
      expect(result.isError).toBeUndefined();
      return JSON.parse(result.content[0]?.text ?? "{}") as Record<string, unknown>;
    }

    it("attachments array is empty when none are attached", async () => {
      await executeTool(root, "create_task", { title: "no attachments" });
      const body = await getTaskJson("T-1");
      expect(body["attachments"]).toEqual([]);
    });

    it("attachment with known extension includes `mime`", async () => {
      const { writeFile } = await import("node:fs/promises");
      await executeTool(root, "create_task", { title: "with png" });
      const src = join(root, "img.png");
      await writeFile(src, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      const attachResult = await executeTool(root, "attach_file", {
        ref: "T-1",
        source_path: src,
      });
      expect(attachResult.isError).toBeUndefined();

      const body = await getTaskJson("T-1");
      const attachments = body["attachments"] as Array<Record<string, unknown>>;
      expect(attachments).toHaveLength(1);
      expect(attachments[0]?.["name"]).toBe("img.png");
      expect(typeof attachments[0]?.["size"]).toBe("number");
      expect(attachments[0]?.["mime"]).toBe("image/png");
    });

    it("attachment with unknown extension omits `mime`", async () => {
      // Strict optionality: when the extension can't be mapped, `mime`
      // is absent (not null, not empty string). Consumers treat
      // absence as application/octet-stream.
      const { writeFile } = await import("node:fs/promises");
      await executeTool(root, "create_task", { title: "with weird" });
      const src = join(root, "data.xyzunknown");
      await writeFile(src, "raw");
      const attachResult = await executeTool(root, "attach_file", {
        ref: "T-1",
        source_path: src,
      });
      expect(attachResult.isError).toBeUndefined();

      const body = await getTaskJson("T-1");
      const attachments = body["attachments"] as Array<Record<string, unknown>>;
      expect(attachments).toHaveLength(1);
      expect(attachments[0]).not.toHaveProperty("mime");
    });

    it("body is included by default, omitted when include_body=false", async () => {
      await executeTool(root, "create_task", { title: "with body", body: "hello" });
      const withBody = await getTaskJson("T-1");
      expect(withBody["body"]).toBe("hello");
      const withoutBody = await getTaskJson("T-1", { include_body: false });
      expect(withoutBody).not.toHaveProperty("body");
    });

    it("relationships key is omitted when there are none", async () => {
      // Stable contract for agents: empty relationships array is
      // silenced to keep the JSON minimal.
      await executeTool(root, "create_task", { title: "no rels" });
      const body = await getTaskJson("T-1");
      expect(body).not.toHaveProperty("relationships");
    });
  });
});

describe("list_tasks — stale saved view warning", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-mcp-warn-"));
    await initLoctt(root);
    await writeFile(
      join(resolveLocttDir(root), "config", "queries.yaml"),
      "queries:\n"
      + "  - id: 01HSV0000000000000STALE4\n"
      + "    name: stale\n"
      + "    query: fields.deleted_field = x\n",
      "utf-8",
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  // An agent has no stderr to read. A bare short list would read as a
  // definitive answer, so the incompleteness goes in the response.
  it("surfaces the warning in the response body", async () => {
    const result = await executeTool(root, "list_tasks", { view: "stale" });
    const body = JSON.stringify(result);
    expect(body).toContain("unknown custom field");
    expect(body).toContain("Results may be incomplete");
  });

  it("returns a clean body for a healthy view", async () => {
    await writeFile(
      join(resolveLocttDir(root), "config", "queries.yaml"),
      "queries:\n"
      + "  - id: 01HSV0000000000000FINE02\n"
      + "    name: fine\n"
      + "    query: status != done\n",
      "utf-8",
    );
    const result = await executeTool(root, "list_tasks", { view: "fine" });
    expect(JSON.stringify(result)).not.toContain("Results may be incomplete");
  });
});
