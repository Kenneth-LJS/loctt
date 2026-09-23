import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initLoctt, loadQueriesConfig, resolveLocttDir } from "@loctt/core";
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
      filters: [{ kind: "simple", field: "status", op: "=", values: ["backlog"] }],
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

  it("create_view stores a multi-key sort", async () => {
    const created = await executeTool(root, "create_view", {
      name: "sorted",
      filters: [{ kind: "simple", field: "status", op: "=", values: ["backlog"] }],
      sort: [{ field: "priority", direction: "desc" }, { field: "created", direction: "asc" }],
    });
    expect(created.isError).toBeUndefined();
    const parsed = JSON.parse(created.content[0]?.text ?? "") as { sort?: unknown };
    expect(parsed.sort).toEqual([
      { field: "priority", direction: "desc" },
      { field: "created", direction: "asc" },
    ]);
  });

  it("create_view rejects a malformed advanced filter with an actionable error, not a server fault", async () => {
    const bad = await executeTool(root, "create_view", {
      name: "broken",
      filters: [{ kind: "advanced", query: "status = = =" }],
    });
    expect(bad.isError).toBe(true);
    // ViewError text reaches the agent (isKnownDomainError), not an
    // opaque rethrow. It must NOT have been written.
    const list = await executeTool(root, "list_views", {});
    expect(list.content[0]?.text ?? "").not.toContain("broken");
  });

  it("edit_view changes name, filters, and sort; sort:null clears it", async () => {
    const created = await executeTool(root, "create_view", {
      name: "before",
      filters: [{ kind: "simple", field: "status", op: "=", values: ["backlog"] }],
      sort: [{ field: "priority", direction: "desc" }],
    });
    const id = idOf(created.content[0]?.text ?? "");

    const edited = await executeTool(root, "edit_view", {
      view: id,
      name: "after",
      filters: [{ kind: "simple", field: "status", op: "=", values: ["done"] }],
    });
    expect(edited.isError).toBeUndefined();
    const parsed = JSON.parse(edited.content[0]?.text ?? "") as {
      name: string; filters: unknown; sort?: unknown;
    };
    expect(parsed.name).toBe("after");
    expect(parsed.filters).toEqual([
      { kind: "simple", field: "status", op: "=", values: ["done"] },
    ]);
    // sort omitted → unchanged.
    expect(parsed.sort).toEqual([{ field: "priority", direction: "desc" }]);

    const cleared = await executeTool(root, "edit_view", { view: id, sort: null });
    const clearedParsed = JSON.parse(cleared.content[0]?.text ?? "") as { sort?: unknown };
    expect(clearedParsed.sort).toBeUndefined();
  });

  it("archive_view then unarchive_view toggles the flag; archived stays runnable by id", async () => {
    const created = await executeTool(root, "create_view", {
      name: "v",
      filters: [{ kind: "simple", field: "status", op: "=", values: ["backlog"] }],
    });
    const id = idOf(created.content[0]?.text ?? "");

    const archived = await executeTool(root, "archive_view", { view: id });
    expect(archived.isError).toBeUndefined();
    // K107: the default scope is `active`, so an archived view is now hidden
    // from a plain list_views. (This assertion previously expected the
    // archived view in the default list — it was asserting the old show-all
    // default.) Pass `archived: "all"` to see it and confirm the flag set.
    const defaultList = JSON.parse((await executeTool(root, "list_views", {})).content[0]?.text ?? "") as Array<{ id: string; archived?: boolean }>;
    expect(defaultList.find(v => v.id === id)).toBeUndefined();
    let list = JSON.parse((await executeTool(root, "list_views", { archived: "all" })).content[0]?.text ?? "") as Array<{ id: string; archived?: boolean }>;
    expect(list.find(v => v.id === id)?.archived).toBe(true);

    const unarchived = await executeTool(root, "unarchive_view", { view: id });
    expect(unarchived.isError).toBeUndefined();
    // Once unarchived it is back in the default (active) list.
    list = JSON.parse((await executeTool(root, "list_views", {})).content[0]?.text ?? "") as Array<{ id: string; archived?: boolean }>;
    expect(list.find(v => v.id === id)?.archived).toBeUndefined();
  });

  it("delete_view requires confirm:true and then removes the view", async () => {
    const created = await executeTool(root, "create_view", {
      name: "doomed",
      filters: [{ kind: "simple", field: "status", op: "=", values: ["backlog"] }],
    });
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

/**
 * @verifies K102-broken-repair on the MCP surface.
 *
 * `replaceBroken` is MCP's spelling of the explicit opt-in. Before this,
 * `edit_view` and `delete_view` aimed at a broken entry failed with
 * `unknown view: <ref>` — an agent could SEE the broken view in
 * `list_views` and had no tool that could act on it.
 */
describe("MCP saved-view broken repair (replaceBroken)", () => {
  let root: string;
  const BROKEN_ID = "01BROKEN00000000000000000B";

  async function seedBroken(): Promise<void> {
    await writeFile(
      join(resolveLocttDir(root), "config", "queries.yaml"),
      "queries:\n"
      + "  - id: 01KEEP000000000000000000AA\n"
      + "    name: keep\n"
      + "    filters:\n"
      + "      - kind: simple\n"
      + "        field: status\n"
      + "        op: \"!=\"\n"
      + "        values: [\"done\"]\n"
      + `  - id: ${BROKEN_ID}\n`
      + "    name: broken-one\n"
      + "    filters: \"not a list\"\n",
      "utf-8",
    );
  }

  const bytes = async (): Promise<string> =>
    readFile(join(resolveLocttDir(root), "config", "queries.yaml"), "utf-8");

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-mcp-views-broken-"));
    await initLoctt(root);
    await seedBroken();
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("edit_view without replaceBroken errors, names the view, and leaves the file byte-identical", async () => {
    const before = await bytes();

    const res = await executeTool(root, "edit_view", {
      view: BROKEN_ID,
      filters: [{ kind: "simple", field: "status", op: "=", values: ["done"] }],
    });

    expect(res.isError).toBe(true);
    const msg = res.content[0]?.text ?? "";
    expect(msg).toContain("broken-one");
    expect(msg).toContain("replaceBroken: true");
    expect(msg).not.toContain("unknown view");
    expect(await bytes()).toBe(before);
  });

  it("edit_view with replaceBroken repairs the entry, keeping its id", async () => {
    const res = await executeTool(root, "edit_view", {
      view: BROKEN_ID,
      filters: [{ kind: "simple", field: "status", op: "=", values: ["done"] }],
      replaceBroken: true,
    });

    expect(res.isError).toBeUndefined();
    const config = await loadQueriesConfig(resolveLocttDir(root));
    expect(config.broken).toBeUndefined();
    expect(config.queries.find(q => q.id === BROKEN_ID)?.filters).toEqual([
      { kind: "simple", field: "status", op: "=", values: ["done"] },
    ]);
    expect(await bytes()).not.toContain("not a list");
  });

  it("delete_view with confirm but no replaceBroken errors and changes nothing", async () => {
    const before = await bytes();

    // `confirm` is the every-delete gate; it is NOT the broken-entry
    // opt-in, and passing it alone must not be enough.
    const res = await executeTool(root, "delete_view", { view: BROKEN_ID, confirm: true });

    expect(res.isError).toBe(true);
    expect(res.content[0]?.text ?? "").toContain("replaceBroken: true");
    expect(await bytes()).toBe(before);
  });

  it("delete_view with confirm AND replaceBroken removes the broken entry", async () => {
    const res = await executeTool(root, "delete_view", {
      view: BROKEN_ID,
      confirm: true,
      replaceBroken: true,
    });

    expect(res.isError).toBeUndefined();
    const config = await loadQueriesConfig(resolveLocttDir(root));
    expect(config.broken).toBeUndefined();
    expect(config.queries.find(q => q.id === BROKEN_ID)).toBeUndefined();
    expect(config.queries.find(q => q.name === "keep")).toBeDefined();
  });

  it("archive_view on a broken entry errors with a clear message", async () => {
    const before = await bytes();

    const res = await executeTool(root, "archive_view", { view: BROKEN_ID });

    expect(res.isError).toBe(true);
    expect(res.content[0]?.text ?? "").toContain("cannot be archived");
    expect(await bytes()).toBe(before);
  });

  it("a HEALTHY view still edits and deletes with no new parameter", async () => {
    // Constraint 4: no new friction on the normal path.
    const edited = await executeTool(root, "edit_view", {
      view: "01KEEP000000000000000000AA",
      name: "renamed",
    });
    expect(edited.isError).toBeUndefined();
    let config = await loadQueriesConfig(resolveLocttDir(root));
    expect(config.queries.find(q => q.name === "renamed")).toBeDefined();

    const deleted = await executeTool(root, "delete_view", {
      view: "01KEEP000000000000000000AA",
      confirm: true,
    });
    expect(deleted.isError).toBeUndefined();
    config = await loadQueriesConfig(resolveLocttDir(root));
    expect(config.queries.find(q => q.name === "renamed")).toBeUndefined();
    // The broken sibling was never in the way.
    expect(config.broken).toHaveLength(1);
    expect(await bytes()).toContain("not a list");
  });
});

/**
 * @verifies K103 colour on a saved view, MCP half — "a capability in
 * core is not done until CLI and MCP have it".
 *
 * Plus the icon one-grapheme rule (Ken, 2026-09-23). An agent is the
 * caller most likely to send `"🎈🎈"`, and the MCP boundary is where
 * that must be refused rather than written to a config the UI then
 * cannot render sensibly.
 */
describe("MCP saved-view colour + icon validation", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-mcp-viewcolor-"));
    await initLoctt(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const idOf = (text: string): string => (JSON.parse(text) as { id: string }).id;

  it("create_view stores each of the three colour shapes", async () => {
    const locttDir = resolveLocttDir(root);
    for (const [name, color] of [
      ["hexed", "#1e6fcb"],
      ["palled", { palette: "teal" }],
      ["paired", { light: "#0F766E", dark: "#39A88F" }],
    ] as const) {
      const res = await executeTool(root, "create_view", { name, filters: [], color });
      expect(res.isError).toBeUndefined();
    }
    const cfg = await loadQueriesConfig(locttDir);
    expect(cfg.queries.find(q => q.name === "hexed")?.color).toBe("#1e6fcb");
    expect(cfg.queries.find(q => q.name === "palled")?.color).toEqual({ palette: "teal" });
    expect(cfg.queries.find(q => q.name === "paired")?.color)
      .toEqual({ light: "#0F766E", dark: "#39A88F" });
  });

  it("list_views returns a view's colour", async () => {
    await executeTool(root, "create_view", {
      name: "tinted", filters: [], color: { palette: "blue" },
    });
    const list = await executeTool(root, "list_views", {});
    expect(list.content[0]?.text ?? "").toContain("palette");
  });

  it("edit_view clears the colour on an explicit null", async () => {
    const locttDir = resolveLocttDir(root);
    const created = await executeTool(root, "create_view", {
      name: "clearme", filters: [], color: "#1e6fcb",
    });
    const id = idOf(created.content[0]?.text ?? "");
    const res = await executeTool(root, "edit_view", { view: id, color: null });
    expect(res.isError).toBeUndefined();
    const cfg = await loadQueriesConfig(locttDir);
    expect(cfg.queries.find(q => q.id === id)?.color).toBeUndefined();
  });

  it("REJECTS an icon that is two emoji, or an emoji glued to a letter", async () => {
    for (const icon of ["🎈🎈", "🎈A"]) {
      const res = await executeTool(root, "create_view", { name: "bad", filters: [], icon });
      expect(res.isError).toBe(true);
    }
  });

  it("ACCEPTS a single emoji icon, including a combined form", async () => {
    for (const icon of ["🎈", "👨‍👩‍👧", "circle-check"]) {
      const res = await executeTool(root, "create_view", { name: `ok-${icon}`, filters: [], icon });
      expect(res.isError).toBeUndefined();
    }
  });
});
