import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initLoctt } from "@loctt/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { executeTool, getTools } from "../index.js";

/**
 * @verifies K30 F2 — saved-view management on MCP.
 *
 * Before this build MCP had `list_views` and nothing else view-shaped;
 * an agent could run a view but not author, rename, re-sort, archive,
 * unarchive, or delete one. These exercise each new tool through the
 * dispatcher (`executeTool`), which is the same path the host uses.
 */
describe("MCP saved-view management", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-mcp-views-"));
    await initLoctt(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const idOf = (text: string): string => (JSON.parse(text) as { id: string }).id;

  it("create_view then list_views shows it", async () => {
    const created = await executeTool(root, "create_view", {
      name: "open-work",
      query: "status = backlog",
    });
    expect(created.isError).toBeUndefined();
    const id = idOf(created.content[0]?.text ?? "");
    expect(id.length).toBeGreaterThan(0);

    const list = await executeTool(root, "list_views", {});
    const body = list.content[0]?.text ?? "";
    expect(body).toContain("open-work");
    expect(body).toContain("status = backlog");
    expect(body).toContain(id);
  });

  it("create_view then list_views returns the derived structured `conditions`", async () => {
    // @verifies Stage-3 MCP parity for structured saved-view conditions.
    // The agent supplies DSL only; core derives the structured form and
    // both create_view's return and list_views must surface it, so an
    // agent introspecting a view sees the same tree the web builder edits.
    const created = await executeTool(root, "create_view", {
      name: "membership",
      query: "status in (backlog, in_progress)",
    });
    expect(created.isError).toBeUndefined();
    const createdView = JSON.parse(created.content[0]?.text ?? "") as {
      id: string; conditions: unknown;
    };
    const expectedConditions = {
      kind: "leaf",
      field: "status",
      op: "in",
      value: {
        type: "list",
        values: [
          { type: "string", value: "backlog" },
          { type: "string", value: "in_progress" },
        ],
      },
    };
    expect(createdView.conditions).toEqual(expectedConditions);

    const list = await executeTool(root, "list_views", {});
    const entries = JSON.parse(list.content[0]?.text ?? "") as Array<{
      id: string; conditions?: unknown;
    }>;
    const listed = entries.find(e => e.id === createdView.id);
    expect(listed).toBeDefined();
    // The parity assertion the red-proof breaks: list_views carries the
    // structured conditions, not just the DSL string.
    expect(listed!.conditions).toEqual(expectedConditions);
  });

  it("create_view stores a multi-key sort", async () => {
    const created = await executeTool(root, "create_view", {
      name: "sorted",
      query: "status = backlog",
      sort: [{ field: "priority", direction: "desc" }, { field: "created", direction: "asc" }],
    });
    expect(created.isError).toBeUndefined();
    const parsed = JSON.parse(created.content[0]?.text ?? "") as { sort?: unknown };
    expect(parsed.sort).toEqual([
      { field: "priority", direction: "desc" },
      { field: "created", direction: "asc" },
    ]);
  });

  it("create_view rejects a malformed query with an actionable error, not a server fault", async () => {
    const bad = await executeTool(root, "create_view", {
      name: "broken",
      query: "status = = =",
    });
    expect(bad.isError).toBe(true);
    // ViewError text reaches the agent (isKnownDomainError), not an
    // opaque rethrow. It must NOT have been written.
    const list = await executeTool(root, "list_views", {});
    expect(list.content[0]?.text ?? "").not.toContain("broken");
  });

  it("edit_view changes name, query, and sort; sort:null clears it", async () => {
    const created = await executeTool(root, "create_view", {
      name: "before",
      query: "status = backlog",
      sort: [{ field: "priority", direction: "desc" }],
    });
    const id = idOf(created.content[0]?.text ?? "");

    const edited = await executeTool(root, "edit_view", {
      view: id,
      name: "after",
      query: "status = done",
    });
    expect(edited.isError).toBeUndefined();
    const parsed = JSON.parse(edited.content[0]?.text ?? "") as {
      name: string; query: string; sort?: unknown;
    };
    expect(parsed.name).toBe("after");
    expect(parsed.query).toBe("status = done");
    // sort omitted → unchanged.
    expect(parsed.sort).toEqual([{ field: "priority", direction: "desc" }]);

    const cleared = await executeTool(root, "edit_view", { view: id, sort: null });
    const clearedParsed = JSON.parse(cleared.content[0]?.text ?? "") as { sort?: unknown };
    expect(clearedParsed.sort).toBeUndefined();
  });

  it("archive_view then unarchive_view toggles the flag; archived stays runnable by id", async () => {
    const created = await executeTool(root, "create_view", { name: "v", query: "status = backlog" });
    const id = idOf(created.content[0]?.text ?? "");

    const archived = await executeTool(root, "archive_view", { view: id });
    expect(archived.isError).toBeUndefined();
    let list = JSON.parse((await executeTool(root, "list_views", {})).content[0]?.text ?? "") as Array<{ id: string; archived?: boolean }>;
    expect(list.find(v => v.id === id)?.archived).toBe(true);

    const unarchived = await executeTool(root, "unarchive_view", { view: id });
    expect(unarchived.isError).toBeUndefined();
    list = JSON.parse((await executeTool(root, "list_views", {})).content[0]?.text ?? "") as Array<{ id: string; archived?: boolean }>;
    expect(list.find(v => v.id === id)?.archived).toBeUndefined();
  });

  it("delete_view requires confirm:true and then removes the view", async () => {
    const created = await executeTool(root, "create_view", { name: "doomed", query: "status = backlog" });
    const id = idOf(created.content[0]?.text ?? "");

    const refused = await executeTool(root, "delete_view", { view: id });
    expect(refused.isError).toBe(true);
    expect(refused.content[0]?.text ?? "").toMatch(/confirm: true/);
    // Still present — the gate blocked the write.
    expect((await executeTool(root, "list_views", {})).content[0]?.text ?? "").toContain("doomed");

    const deleted = await executeTool(root, "delete_view", { view: id, confirm: true });
    expect(deleted.isError).toBeUndefined();
    expect((await executeTool(root, "list_views", {})).content[0]?.text ?? "").not.toContain("doomed");
  });

  it("edit_view on an unknown ref returns an actionable error", async () => {
    const res = await executeTool(root, "edit_view", { view: "nope", name: "x" });
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text ?? "").toMatch(/unknown view/i);
  });
});

/**
 * First-run / new-user UX: get_workflow_config is the tool a cold agent
 * should call before writing any enum-valued field, so its description
 * must tell it what it returns and that it discovers valid values —
 * not the bare "Get the workflow configuration." it once carried.
 */
describe("get_workflow_config description", () => {
  it("tells the agent it discovers valid values before writing", () => {
    const tool = getTools().find(t => t.name === "get_workflow_config");
    expect(tool).toBeDefined();
    const desc = tool?.description ?? "";
    expect(desc.toLowerCase()).toContain("valid");
    // Names the field families whose keys it hands back.
    expect(desc).toMatch(/status/i);
    expect(desc).toMatch(/priorit/i);
    // Says to call it first / before writing.
    expect(desc.toLowerCase()).toMatch(/first|before/);
  });
});
