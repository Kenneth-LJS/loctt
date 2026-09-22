import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initLoctt, lookupByKey, resolveLocttDir, serializeQueriesConfig } from "@loctt/core";
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

    // @verifies DEG-C6
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
      // The labels have to exist. This case is about the *shape* check
      // accepting an array, but the write behind it stores label ids
      // (P-2) and refuses a reference to a label that was never
      // created — so inventing names here would fail for an unrelated
      // reason and stop testing what it names.
      await executeTool(root, "create_label", { name: "bug" });
      await executeTool(root, "create_label", { name: "urgent" });
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
      // updated_at is immutable in core (USER_IMMUTABLE_FIELDS), so
      // every surface refuses it for the same reason. This used to
      // assert MCP's own "not settable via MCP" guard, which caught it
      // first only because core let it through — the CLI and web
      // therefore wrote the field happily (TSK-C2).
      //
      // Asserting the outcome rather than which layer produced it: the
      // requirement is that the write is refused and the message names
      // the field, not that a particular guard fires.
      await executeTool(root, "create_task", { title: "x" });
      const result = await executeTool(root, "update_task", {
        ref: "T-1",
        field: "updated_at",
        value: "2026-01-01T00:00:00.000Z",
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text ?? "").toMatch(/updated_at/);
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

  // These tools now take `refs` (bulk parity with the web); the single
  // task is `refs: ["T-1"]`. The confirm gate is unchanged.
  it("delete_task without confirm is rejected; archive_task is the soft path", async () => {
    await executeTool(root, "create_task", { title: "to-delete" });

    // Without confirm: refused.
    const refused = await executeTool(root, "delete_task", { refs: ["T-1"] });
    expect(refused.isError).toBe(true);
    expect(refused.content[0]?.text).toMatch(/confirm/i);

    // archive_task succeeds without confirm.
    const archived = await executeTool(root, "archive_task", { refs: ["T-1"] });
    expect(archived.isError).toBeUndefined();

    // delete_task with confirm succeeds and removes the task entirely.
    const deleted = await executeTool(root, "delete_task", { refs: ["T-1"], confirm: true });
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
      await executeTool(root, "create_project", { name: "Alt", prefix: "ALT" });
      const result = await executeTool(root, "delete_project", { project: "Alt" });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toMatch(/confirm/i);
    });

    it("set_project_prefix without confirm is rejected", async () => {
      // Not a delete, but it rewrites every task in the project — the
      // same class of blast radius the gate exists for.
      const result = await executeTool(root, "set_project_prefix", {
        project: "Tasks",
        prefix: "WEB",
      });
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

    it("delete_comment without confirm is rejected; confirm deletes", async () => {
      // delete_comment joins the delete_* confirm-gate family: like
      // delete_task, a call without confirm means the agent
      // misunderstood the destructive nature.
      await executeTool(root, "create_task", { title: "with-comment" });
      const posted = await executeTool(root, "post_comment", {
        ref: "T-1",
        body: "hello",
      });
      const commentId = posted.content[0]?.text?.match(/comment (\S+) on/)?.[1] ?? "";
      expect(commentId).not.toBe("");

      // Without confirm: refused, and the comment survives.
      const refused = await executeTool(root, "delete_comment", {
        ref: "T-1",
        comment_id: commentId,
      });
      expect(refused.isError).toBe(true);
      expect(refused.content[0]?.text).toMatch(/confirm/i);
      const stillThere = await executeTool(root, "list_comments", { ref: "T-1" });
      expect(stillThere.content[0]?.text).toContain(commentId);

      // With confirm: deleted.
      const deleted = await executeTool(root, "delete_comment", {
        ref: "T-1",
        comment_id: commentId,
        confirm: true,
      });
      expect(deleted.isError).toBeUndefined();
      const gone = await executeTool(root, "list_comments", { ref: "T-1" });
      expect(gone.content[0]?.text).not.toContain(commentId);
    });
  });

  /**
   * @verifies PRU-C10, PRU-C11
   *
   * The MCP half of set-prefix. Core's rewrite is covered in
   * packages/core; these assert what an agent sees — the reported
   * count, and that a collision is refused without writing.
   */
  describe("set_project_prefix", () => {
    it("renames every task and reports how many", async () => {
      await executeTool(root, "create_task", { title: "one" });
      await executeTool(root, "create_task", { title: "two" });

      const result = await executeTool(root, "set_project_prefix", {
        project: "Tasks",
        prefix: "WEB",
        confirm: true,
      });

      expect(result.isError).toBeUndefined();
      const payload = JSON.parse(result.content[0]?.text ?? "{}") as {
        from: string; to: string; renamed: number;
      };
      expect(payload).toMatchObject({ from: "T", to: "WEB", renamed: 2 });

      // The agent must be able to act on the new keys immediately.
      const list = await executeTool(root, "list_tasks", {});
      expect(list.content[0]?.text).toContain("WEB-1");
      expect(list.content[0]?.text).not.toContain("T-1");
    });

    it("keeps the old key resolvable so an agent's stale reference works", async () => {
      await executeTool(root, "create_task", { title: "one" });
      await executeTool(root, "set_project_prefix", {
        project: "Tasks", prefix: "WEB", confirm: true,
      });

      // An agent holding T-1 from earlier in its context must not get a
      // not-found — that is what key_history is for.
      const got = await executeTool(root, "get_task", { ref: "T-1" });
      expect(got.isError).toBeUndefined();
      expect(got.content[0]?.text).toContain("WEB-1");
    });

    it("refuses a prefix another project holds, renaming nothing", async () => {
      await executeTool(root, "create_task", { title: "one" });
      await executeTool(root, "create_project", { name: "API", prefix: "API" });

      const result = await executeTool(root, "set_project_prefix", {
        project: "Tasks", prefix: "API", confirm: true,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("API");
      const list = await executeTool(root, "list_tasks", {});
      expect(list.content[0]?.text).toContain("T-1");
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

  describe("move_board_card", () => {
    // @verifies K11
    it("is registered with a `status` parameter", () => {
      // The one thing that distinguishes it from `reorder_board`: the
      // ability to cross a column boundary. Without `status` this tool
      // is a duplicate of the one that already existed.
      const tool = getTools().find(t => t.name === "move_board_card");
      expect(tool).toBeDefined();
      expect(tool?.inputSchema).toHaveProperty("ref");
      expect(tool?.inputSchema).toHaveProperty("status");
      expect(tool?.inputSchema).toHaveProperty("before");
      expect(tool?.inputSchema).toHaveProperty("after");
    });

    // @verifies K11
    it("writes status and board_rank from one call", async () => {
      // K11: the two-write shape (`set_task_field` status, then
      // `reorder_board`) can fail between the halves. Asserted on
      // disk, both fields, from a single tool call.
      await executeTool(root, "create_task", { title: "a" });
      await executeTool(root, "create_task", { title: "b" });
      const locttDir = resolveLocttDir(root);
      const before = await lookupByKey(locttDir, "T-2");
      expect(before.frontmatter.status).not.toBe("in_progress");

      const result = await executeTool(root, "move_board_card", {
        ref: "T-2",
        status: "in_progress",
      });
      expect(result.isError).toBeUndefined();
      const payload = JSON.parse(result.content[0]?.text ?? "{}") as {
        status: string;
        board_rank: string;
      };
      expect(payload.status).toBe("in_progress");

      const t2 = await lookupByKey(locttDir, "T-2");
      expect(t2.frontmatter.status).toBe("in_progress");
      expect(t2.frontmatter.board_rank).toBe(payload.board_rank);
    });

    // @verifies K11
    it("omitting status leaves the task's status untouched", async () => {
      // XS-9: an intra-column reposition must not resend `status`.
      await executeTool(root, "create_task", { title: "a" });
      await executeTool(root, "create_task", { title: "b" });
      const set = await executeTool(root, "update_task", {
        ref: "T-2",
        field: "status",
        value: "in_progress",
      });
      expect(set.isError).toBeUndefined();
      const result = await executeTool(root, "move_board_card", { ref: "T-2" });
      expect(result.isError).toBeUndefined();
      const locttDir = resolveLocttDir(root);
      const t2 = await lookupByKey(locttDir, "T-2");
      expect(t2.frontmatter.status).toBe("in_progress");
    });

    // @verifies K11
    it("accepts before and after together, unlike reorder_board", async () => {
      // `reorder_board` refuses the pair; a drop lands BETWEEN two
      // neighbours (BRD-32), so this tool must not inherit that mutex.
      await executeTool(root, "create_task", { title: "a" });
      await executeTool(root, "create_task", { title: "b" });
      await executeTool(root, "create_task", { title: "c" });
      await executeTool(root, "reorder_board", { ref: "T-1" });
      await executeTool(root, "reorder_board", { ref: "T-2" });
      const locttDir = resolveLocttDir(root);
      const t1 = await lookupByKey(locttDir, "T-1");
      const t2 = await lookupByKey(locttDir, "T-2");
      expect(t1.frontmatter.board_rank! < t2.frontmatter.board_rank!).toBe(true);

      const result = await executeTool(root, "move_board_card", {
        ref: "T-3",
        after: "T-1",
        before: "T-2",
      });
      expect(result.isError).toBeUndefined();
      const t3 = await lookupByKey(locttDir, "T-3");
      expect(t3.frontmatter.board_rank! > t1.frontmatter.board_rank!).toBe(true);
      expect(t3.frontmatter.board_rank! < t2.frontmatter.board_rank!).toBe(true);
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
      // F1 narrowing: the agent surface confines the source to the DATA
      // DIR (.loctt/), so a legit attach stages the file there first
      // (was join(root, …), which is now outside the safe zone).
      const src = join(resolveLocttDir(root), "img.png");
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
      // F1 narrowing: stage inside the data dir (.loctt/), see above.
      const src = join(resolveLocttDir(root), "data.xyzunknown");
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

    // Attach source is confined to the PROJECT ROOT (A205): a real file
    // anywhere in the project attaches (an attachment legitimately comes
    // from the working tree, not only from inside .loctt/ — the A225
    // data-dir narrowing was reverted for breaking that). A path outside
    // the root is still refused by the core confinement.
    it("attach_file accepts a source elsewhere in the project", async () => {
      const { writeFile } = await import("node:fs/promises");
      await executeTool(root, "create_task", { title: "attach from project" });
      const src = join(root, "notes.txt");
      await writeFile(src, "a real project file");
      const result = await executeTool(root, "attach_file", {
        ref: "T-1",
        source_path: src,
      });
      expect(result.isError).toBeUndefined();
      const body = await getTaskJson("T-1");
      expect((body["attachments"] as unknown[]).length).toBe(1);
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

/**
 * @verifies K102 on the MCP surface — a saved view is an ORDERED filter
 * list, and that list is what crosses the tool boundary in both
 * directions.
 *
 * The old surface took a `query` DSL string and handed back a derived
 * `conditions` tree. Both are gone. What replaces them has two properties
 * an agent depends on and neither the core tests nor the tool's own types
 * can assert from here: that the array survives the round trip in the
 * order it was authored (never merged, never reordered), and that the
 * display-only `summary` is additive — it must not have crept back in as
 * a storable field under a new name.
 */
describe("saved views — K102 filter list over MCP", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-mcp-k102-"));
    await initLoctt(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  // Deliberately authored so a merge-and-canonicalize step would reorder
  // it: an advanced filter sits BETWEEN two simple ones. Any
  // implementation that grouped simple filters together, or folded the
  // list into one DSL string, would not return this array unchanged.
  // The advanced fragment is written already-normalized (no redundant
  // outer parens, single spaces) so this fixture asserts ORDER only. The
  // spacing normalization core applies is its own contract and is tested
  // there; encoding it here would just make this test brittle to it.
  const FILTERS = [
    { kind: "simple", field: "task_type", op: "=", values: ["bug"] },
    { kind: "advanced", query: "priority = high or priority = critical" },
    { kind: "simple", field: "status", op: "!=", values: ["done"] },
  ];

  it("create_view round-trips the filter list in the authored order", async () => {
    const created = await executeTool(root, "create_view", {
      name: "interleaved",
      filters: FILTERS,
    });
    expect(created.isError).toBeUndefined();
    const view = JSON.parse(created.content[0]?.text ?? "") as {
      id: string; filters: unknown;
    };
    expect(view.filters).toEqual(FILTERS);

    // And the same list comes back out of list_views, not a re-derived one.
    const list = await executeTool(root, "list_views", {});
    const entries = JSON.parse(list.content[0]?.text ?? "") as Array<{
      id: string; filters?: unknown; summary?: string;
    }>;
    const listed = entries.find(e => e.id === view.id);
    expect(listed).toBeDefined();
    expect(listed!.filters).toEqual(FILTERS);
  });

  it("list_views carries a display-only summary and no query/conditions field", async () => {
    await executeTool(root, "create_view", { name: "shaped", filters: FILTERS });
    const list = await executeTool(root, "list_views", {});
    const entry = (JSON.parse(list.content[0]?.text ?? "") as Array<Record<string, unknown>>)[0];
    expect(entry).toBeDefined();
    // Present, non-empty, and a string an agent can show a user.
    expect(typeof entry!["summary"]).toBe("string");
    expect(entry!["summary"] as string).not.toHaveLength(0);
    // The two fields K102 removed must not come back. A view has no
    // canonical DSL and no condition tree; an agent that saw either
    // would reasonably try to edit through it.
    expect(entry).not.toHaveProperty("query");
    expect(entry).not.toHaveProperty("conditions");
  });

  it("edit_view replaces the whole list; omitting filters leaves them untouched", async () => {
    const created = await executeTool(root, "create_view", {
      name: "before",
      filters: FILTERS,
    });
    const id = (JSON.parse(created.content[0]?.text ?? "") as { id: string }).id;

    // Omitted → untouched. (A handler that defaulted absent filters to []
    // would silently empty the view, which matches everything.)
    const renamed = await executeTool(root, "edit_view", { view: id, name: "after" });
    expect(renamed.isError).toBeUndefined();
    const afterRename = JSON.parse(renamed.content[0]?.text ?? "") as {
      name: string; filters: unknown;
    };
    expect(afterRename.name).toBe("after");
    expect(afterRename.filters).toEqual(FILTERS);

    // Supplied → replaces the WHOLE list, not appended or merged into it.
    const replacement = [
      { kind: "simple", field: "status", op: "=", values: ["backlog"] },
    ];
    const edited = await executeTool(root, "edit_view", {
      view: id,
      filters: replacement,
    });
    const afterEdit = JSON.parse(edited.content[0]?.text ?? "") as { filters: unknown };
    expect(afterEdit.filters).toEqual(replacement);
  });
});

describe("list_tasks — stale saved view warning", () => {
  let root: string;

  // K102: a saved view stores an ordered `filters[]` list — no `query`
  // string and no `conditions` tree. The fixture needs a view whose
  // filters reference a field that does not exist, and the shortest
  // honest way to author arbitrary DSL is a single `advanced` filter.
  function queriesYaml(id: string, name: string, query: string): string {
    return serializeQueriesConfig({
      queries: [{ id, name, filters: [{ kind: "advanced", query }] }],
    });
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-mcp-warn-"));
    await initLoctt(root);
    await writeFile(
      join(resolveLocttDir(root), "config", "queries.yaml"),
      queriesYaml("01HSV0000000000000STALE4", "stale", "fields.deleted_field = x"),
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
      queriesYaml("01HSV0000000000000FINE02", "fine", "status != done"),
      "utf-8",
    );
    const result = await executeTool(root, "list_tasks", { view: "fine" });
    expect(JSON.stringify(result)).not.toContain("Results may be incomplete");
  });
});

// ---------------------------------------------------------------------------
// edit_workflow_entity + the two singleton config tools (A265).
// The MCP half of the A252 core / A253 CLI parity wave. These call the
// same core `config/workflow-entities.ts` functions the web and CLI call,
// so behaviour is identical by construction; the tests below assert the
// MCP-layer additions: the entity/op legality matrix, the confirm gate on
// delete, the clear-only remap rejection, and that refusals from core
// (WorkflowEntityError) reach the agent as a clean errorResult rather than
// a rethrown server fault.
// ---------------------------------------------------------------------------

describe("edit_workflow_entity", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-mcp-wf-"));
    await initLoctt(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  /** Parses the get_workflow_config JSON into the config object. */
  async function workflow(): Promise<Record<string, unknown>> {
    const res = await executeTool(root, "get_workflow_config", {});
    expect(res.isError).toBeUndefined();
    return JSON.parse(res.content[0]?.text ?? "{}") as Record<string, unknown>;
  }

  it("registers the three new tools", () => {
    const names = getTools().map(t => t.name);
    expect(names).toContain("edit_workflow_entity");
    expect(names).toContain("set_estimation_config");
    expect(names).toContain("set_timeline_config");
  });

  it("creates a status visible via get_workflow_config", async () => {
    const res = await executeTool(root, "edit_workflow_entity", {
      entity: "status",
      op: "create",
      key: "blocked",
      fields: { label: "Blocked", category: "active", icon: "pause", color: "#ff0000" },
    });
    expect(res.isError).toBeUndefined();
    const cfg = await workflow();
    const statuses = cfg["statuses"] as { key: string; label: string; icon?: string; color?: string }[];
    const created = statuses.find(s => s.key === "blocked");
    expect(created).toBeDefined();
    expect(created?.label).toBe("Blocked");
    // icon/color round-trip through the create payload.
    expect(created?.icon).toBe("pause");
    expect(created?.color).toBe("#ff0000");
  });

  it("edits a status label", async () => {
    await executeTool(root, "edit_workflow_entity", {
      entity: "status", op: "create", key: "blocked",
      fields: { label: "Blocked", category: "active" },
    });
    const res = await executeTool(root, "edit_workflow_entity", {
      entity: "status", op: "edit", key: "blocked", fields: { label: "On hold" },
    });
    expect(res.isError).toBeUndefined();
    const cfg = await workflow();
    const statuses = cfg["statuses"] as { key: string; label: string }[];
    expect(statuses.find(s => s.key === "blocked")?.label).toBe("On hold");
  });

  it("rejects an edit that tries to rename via a key in fields", async () => {
    await executeTool(root, "edit_workflow_entity", {
      entity: "status", op: "create", key: "blocked",
      fields: { label: "Blocked", category: "active" },
    });
    // `key` inside `fields` is not a rename path — the top-level `key`
    // identifies the target, and `fields.key` is an unknown field. The
    // rename must be refused (keys are immutable).
    const res = await executeTool(root, "edit_workflow_entity", {
      entity: "status", op: "edit", key: "blocked",
      fields: { key: "renamed", label: "Still blocked" },
    });
    expect(res.isError).toBe(true);
    const cfg = await workflow();
    const statuses = cfg["statuses"] as { key: string }[];
    // No status was renamed; the original key survives and no new key appeared.
    expect(statuses.some(s => s.key === "blocked")).toBe(true);
    expect(statuses.some(s => s.key === "renamed")).toBe(false);
  });

  it("refuses a delete without confirm even when a remap is given", async () => {
    await executeTool(root, "edit_workflow_entity", {
      entity: "status", op: "create", key: "blocked",
      fields: { label: "Blocked", category: "active" },
    });
    const res = await executeTool(root, "edit_workflow_entity", {
      entity: "status", op: "delete", key: "blocked", remap_to: "todo",
    });
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text ?? "").toMatch(/confirm/i);
    // Still present — the delete did not run.
    const cfg = await workflow();
    expect((cfg["statuses"] as { key: string }[]).some(s => s.key === "blocked")).toBe(true);
  });

  it("refuses a delete-in-use without remap_to, succeeds with remap_to + confirm", async () => {
    // Seed a task that holds the status so it is in use.
    const defaultStatus = ((await workflow())["statuses"] as { key: string; default?: boolean }[])
      .find(s => s.default)?.key ?? "todo";
    await executeTool(root, "edit_workflow_entity", {
      entity: "status", op: "create", key: "blocked",
      fields: { label: "Blocked", category: "active" },
    });
    await executeTool(root, "create_task", { title: "held" });
    await executeTool(root, "update_task", { ref: "T-1", field: "status", value: "blocked" });

    // In use, no remap: refused (with confirm, so the confirm gate is not
    // what fires — the remap requirement is).
    const refused = await executeTool(root, "edit_workflow_entity", {
      entity: "status", op: "delete", key: "blocked", confirm: true,
    });
    expect(refused.isError).toBe(true);
    expect(refused.content[0]?.text ?? "").toMatch(/in use|remap/i);

    // With a remap target and confirm: succeeds, task moved to the target.
    const ok = await executeTool(root, "edit_workflow_entity", {
      entity: "status", op: "delete", key: "blocked", remap_to: defaultStatus, confirm: true,
    });
    expect(ok.isError).toBeUndefined();
    const cfg = await workflow();
    expect((cfg["statuses"] as { key: string }[]).some(s => s.key === "blocked")).toBe(false);
    const task = await executeTool(root, "get_task", { ref: "T-1" });
    expect(task.content[0]?.text ?? "").toContain(defaultStatus);
  });

  it("reorder changes a priority's derived value", async () => {
    const before = (await workflow())["priorities"] as { key: string; value?: number }[];
    expect(before.length).toBeGreaterThanOrEqual(3);
    const keys = before.map(p => p.key);
    // Move a MIDDLE key to the front so its list position (and therefore
    // its renumbered value) genuinely changes — endpoints can keep their
    // value under a swap, but an interior key that jumps to the front
    // cannot.
    const midIdx = 2; // keys.length >= 3 asserted above
    const mid = keys[midIdx]!;
    const midValueBefore = before.find(p => p.key === mid)?.value;
    const moved = [mid, ...keys.filter(k => k !== mid)];

    const res = await executeTool(root, "edit_workflow_entity", {
      entity: "priority", op: "reorder", order: moved,
    });
    expect(res.isError).toBeUndefined();

    const after = (await workflow())["priorities"] as { key: string; value?: number }[];
    // The list order now leads with the moved key (reorder took effect)...
    expect(after.map(p => p.key)).toEqual(moved);
    // ...and its derived value changed (value is renumbered from order),
    // proving the value is NOT carried over from before but recomputed.
    expect(after.find(p => p.key === mid)?.value).not.toBe(midValueBefore);
  });

  it("rejects a priority value in fields", async () => {
    const res = await executeTool(root, "edit_workflow_entity", {
      entity: "priority", op: "create", key: "urgent",
      fields: { label: "Urgent", value: 9 },
    });
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text ?? "").toMatch(/value/i);
  });

  it("rejects reorder for relationships (no such op)", async () => {
    const res = await executeTool(root, "edit_workflow_entity", {
      entity: "relationship", op: "reorder", order: ["blocks"],
    });
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text ?? "").toMatch(/not valid for entity "relationship"/);
  });

  it("rejects an unknown entity at the wire (strict enum)", async () => {
    const res = await executeTool(root, "edit_workflow_entity", {
      entity: "nonsense", op: "create", key: "x",
    });
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text ?? "").toMatch(/invalid args/);
  });

  it("rejects remap_to on a whole custom_field delete (clear-only)", async () => {
    // Two enum fields so a remap target would otherwise be plausible.
    await executeTool(root, "edit_workflow_entity", {
      entity: "custom_field", op: "create", key: "team",
      fields: { label: "Team", type: "enum", values: [{ key: "a", label: "A" }] },
    });
    const res = await executeTool(root, "edit_workflow_entity", {
      entity: "custom_field", op: "delete", key: "team", confirm: true, remap_to: "other",
    });
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text ?? "").toMatch(/clear-only|does not accept remap_to/i);
    // The field survives — the rejection happened before any write.
    const cfg = await workflow();
    expect((cfg["custom_fields"] as { key: string }[]).some(f => f.key === "team")).toBe(true);
  });

  it("rejects an immutable type change on custom_field edit", async () => {
    await executeTool(root, "edit_workflow_entity", {
      entity: "custom_field", op: "create", key: "size",
      fields: { label: "Size", type: "string" },
    });
    const res = await executeTool(root, "edit_workflow_entity", {
      entity: "custom_field", op: "edit", key: "size", fields: { type: "number" },
    });
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text ?? "").toMatch(/type.*immutable/i);
  });

  it("round-trips an enum field value with icon and color", async () => {
    await executeTool(root, "edit_workflow_entity", {
      entity: "custom_field", op: "create", key: "team",
      fields: { label: "Team", type: "enum", values: [{ key: "core", label: "Core" }] },
    });
    const res = await executeTool(root, "edit_workflow_entity", {
      entity: "custom_field_value", op: "create", field: "team", key: "ui",
      fields: { label: "UI", icon: "brush", color: "#00ff00" },
    });
    expect(res.isError).toBeUndefined();
    const cfg = await workflow();
    const field = (cfg["custom_fields"] as { key: string; values?: { key: string; icon?: string; color?: string }[] }[])
      .find(f => f.key === "team");
    const val = field?.values?.find(v => v.key === "ui");
    expect(val?.icon).toBe("brush");
    expect(val?.color).toBe("#00ff00");
  });

  it("round-trips estimation scale via set_estimation_config", async () => {
    const res = await executeTool(root, "set_estimation_config", {
      enabled: true, unit: "points", scale: "fibonacci",
    });
    expect(res.isError).toBeUndefined();
    const est = (await workflow())["estimation"] as { scale?: string };
    expect(est.scale).toBe("fibonacci");
  });

  it("round-trips estimation weights via set_estimation_config", async () => {
    // Core only accepts weights when the unit is custom_enum, which in
    // turn requires preset_values — set all three in one call (the
    // singleton edit validates the whole resulting config).
    const res = await executeTool(root, "set_estimation_config", {
      enabled: true, unit: "custom_enum", preset_values: ["low", "high"], weights: { high: 3, low: 1 },
    });
    expect(res.isError).toBeUndefined();
    const est = (await workflow())["estimation"] as { weights?: Record<string, number> };
    expect(est.weights).toEqual({ high: 3, low: 1 });
  });

  it("set_timeline_config with no fields is a clean error, not a write", async () => {
    const res = await executeTool(root, "set_timeline_config", {});
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text ?? "").toMatch(/nothing to change/i);
  });

  // -------------------------------------------------------------------------
  // K103 stage 3: MCP accepts all THREE colour shapes as the wire form.
  //
  // Before this, `fields.color` went through a string-only reader: the
  // object shapes were either REJECTED ("must be a string or null") on
  // entity colours, or — worse — SILENTLY DROPPED on a seeded enum
  // value, which created the field minus its colour with no error.
  // -------------------------------------------------------------------------

  it("accepts a palette REFERENCE on a status and stores the id, not a hex", async () => {
    const res = await executeTool(root, "edit_workflow_entity", {
      entity: "status", op: "create", key: "waiting",
      fields: { label: "Waiting", category: "pending", color: { palette: "teal" } },
    });
    expect(res.isError).toBeUndefined();
    const statuses = (await workflow())["statuses"] as { key: string; color?: unknown }[];
    // Live reference: the id is stored, never today's resolved hex.
    expect(statuses.find(s => s.key === "waiting")?.color).toEqual({ palette: "teal" });
  });

  it("accepts an explicit per-mode pair on a priority", async () => {
    const res = await executeTool(root, "edit_workflow_entity", {
      entity: "priority", op: "create", key: "urgent",
      fields: { label: "Urgent", color: { light: "#CC6600", dark: "#F0A868" } },
    });
    expect(res.isError).toBeUndefined();
    const priorities = (await workflow())["priorities"] as { key: string; color?: unknown }[];
    expect(priorities.find(p => p.key === "urgent")?.color)
      .toEqual({ light: "#CC6600", dark: "#F0A868" });
  });

  it("keeps a palette colour on a SEEDED enum value instead of dropping it", async () => {
    // The seed parser used `typeof color === "string"`, so this colour
    // vanished with no error and no way to notice from the response.
    const res = await executeTool(root, "edit_workflow_entity", {
      entity: "custom_field", op: "create", key: "area",
      fields: {
        label: "Area", type: "enum",
        values: [{ key: "api", label: "API", color: { palette: "blue" } }],
      },
    });
    expect(res.isError).toBeUndefined();
    const field = ((await workflow())["custom_fields"] as { key: string; values?: { key: string; color?: unknown }[] }[])
      .find(f => f.key === "area");
    expect(field?.values?.find(v => v.key === "api")?.color).toEqual({ palette: "blue" });
  });

  it("rejects a malformed colour object rather than writing a partial one", async () => {
    const res = await executeTool(root, "edit_workflow_entity", {
      entity: "status", op: "create", key: "broken",
      fields: { label: "Broken", category: "pending", color: { light: "#CC6600" } },
    });
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text ?? "").toMatch(/not a valid colour/i);
    const statuses = (await workflow())["statuses"] as { key: string }[];
    expect(statuses.find(s => s.key === "broken")).toBeUndefined();
  });

  it("list_palette_colors returns every built-in id with both mode values", async () => {
    const res = await executeTool(root, "list_palette_colors", {});
    expect(res.isError).toBeUndefined();
    const parsed = JSON.parse(res.content[0]?.text ?? "{}") as {
      colors?: { id: string; light: string; dark: string }[];
    };
    const teal = parsed.colors?.find(c => c.id === "teal");
    // Exact values: an agent picks an id from here, so a listing that
    // merely has the right shape but wrong values is still useless.
    expect(teal).toMatchObject({ id: "teal", light: "#0F766E", dark: "#39A88F" });
    expect((parsed.colors ?? []).length).toBeGreaterThan(1);
  });
});

describe("MCP reconcile resolve/abandon parity", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-mcp-reconcile-"));
    await initLoctt(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  // Parity: MCP had only the read side (get_reconcile_status); CLI/web could
  // resolve. These cover the two write tools now closing that gap.
  it("registers resolve_reconcile and abandon_reconcile as write-side reconcile tools", () => {
    const names = getTools().map(t => t.name);
    expect(names).toContain("get_reconcile_status");
    expect(names).toContain("resolve_reconcile");
    expect(names).toContain("abandon_reconcile");
  });

  it("resolve_reconcile is gated on confirm — without it, nothing is applied", async () => {
    // Red-proof: delete the requireConfirm gate in the handler and this goes
    // green while the destructive apply runs unconfirmed.
    const res = await executeTool(root, "resolve_reconcile", {
      decisions: [{ taskId: "01ABC", field: "title", choice: "local" }],
    });
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text ?? "").toMatch(/resolve_reconcile requires confirm: true/);
  });

  it("resolve_reconcile with confirm but no reconciliation in progress reaches core and reports it cleanly", async () => {
    // With confirm passed, the gate is cleared and the core fn is called; a
    // tracker with no sentinel makes core throw "no reconciliation is in
    // progress", which the handler maps to a clean error result (not a
    // rethrown server fault). Red-proof: change the handler to swallow/relabel
    // it and this message assertion fails.
    const res = await executeTool(root, "resolve_reconcile", {
      confirm: true,
      decisions: [{ taskId: "01ABC", field: "title", choice: "local" }],
    });
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text ?? "").toMatch(/no reconciliation is in progress/);
  });

  it("resolve_reconcile rejects a decision missing required fields (strict input validation)", async () => {
    // choice is required; a decision without it is an invalid-args error before
    // the handler runs. Red-proof: loosen decisionSchema and this goes green.
    const res = await executeTool(root, "resolve_reconcile", {
      confirm: true,
      decisions: [{ taskId: "01ABC", field: "title" }],
    });
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text ?? "").toMatch(/invalid args for resolve_reconcile/);
  });

  it("resolve_reconcile rejects an unknown key on a decision (strict)", async () => {
    // The decision shape is core's camelCase ReconcileDecision, byte-for-byte
    // the CLI file, and it is .strict(): an otherwise-valid decision carrying
    // an extra unknown key (e.g. a snake_case `task_id` alongside the required
    // `taskId`) is rejected. This pins the strictness so a later loosening to
    // .passthrough() can't slip an unvalidated key through. Red-proof: change
    // decisionSchema to .passthrough() and this goes green.
    const res = await executeTool(root, "resolve_reconcile", {
      confirm: true,
      decisions: [{ taskId: "01ABC", field: "title", choice: "local", task_id: "01ABC" }],
    });
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text ?? "").toMatch(/invalid args for resolve_reconcile/);
  });

  it("abandon_reconcile is gated on confirm", async () => {
    // Red-proof: remove the requireConfirm gate and this goes green.
    const res = await executeTool(root, "abandon_reconcile", {});
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text ?? "").toMatch(/abandon_reconcile requires confirm: true/);
  });

  it("abandon_reconcile with confirm is a no-op-safe clear when none is in progress", async () => {
    // abandonReconcile just clears the sentinel; with none present it succeeds
    // and reports local files are unchanged. Red-proof: make the handler throw
    // when no sentinel exists and this fails.
    const res = await executeTool(root, "abandon_reconcile", { confirm: true });
    expect(res.isError).toBeUndefined();
    expect(res.content[0]?.text ?? "").toMatch(/abandoned/i);
    expect(res.content[0]?.text ?? "").toMatch(/unchanged/i);
  });

  it("get_reconcile_status still reads clean when no reconciliation is in progress", async () => {
    // The read side is unchanged by adding the write tools.
    const res = await executeTool(root, "get_reconcile_status", {});
    expect(res.isError).toBeUndefined();
    const parsed = JSON.parse(res.content[0]?.text ?? "{}") as { in_progress?: boolean };
    expect(parsed.in_progress).toBe(false);
  });
});
