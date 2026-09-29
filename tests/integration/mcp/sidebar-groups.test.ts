import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * MCP's surface of the sidebar-groups editor (SHL-45).
 *
 * The third surface of Ken's layer rule: core holds the read/resolve,
 * the CLI has `user sidebar-groups`, and these are the tools.
 */

async function settingsPath(root: string): Promise<string> {
  const usersDir = path.join(root, ".loctt", "users");
  const [id] = await readdir(usersDir);
  return path.join(usersDir, String(id), "settings.yaml");
}

interface SidebarGroupsPayload {
  stored: { version?: number; order?: string[]; hidden?: string[] };
  resolved: { id: string; hidden: boolean; name?: string; broken?: boolean }[];
}

describe("MCP sidebar_groups (stdio)", () => {
  // @verifies SHL-45
  it("get_sidebar_groups returns the resolved default order, all visible", async () => {
    await withTmpLoctt(async ({ root }) => {
      const client = await startMcpClient(root);
      try {
        const result = await client.callTool("get_sidebar_groups", {});
        expect(result.isError).toBeFalsy();
        const payload = JSON.parse(String(result.content[0]?.text)) as SidebarGroupsPayload;
        expect(payload.resolved.map(r => r.id)).toContain("projects");
        expect(payload.resolved.every(r => !r.hidden)).toBe(true);
      } finally {
        await client.close();
      }
    });
  });

  // @verifies SHL-45
  it("set_sidebar_groups persists order + hidden and returns the resolved state", async () => {
    await withTmpLoctt(async ({ root }) => {
      const client = await startMcpClient(root);
      try {
        const result = await client.callTool("set_sidebar_groups", {
          order: ["labels", "projects"],
          hidden: ["sprints"],
        });
        expect(result.isError).toBeFalsy();
        const payload = JSON.parse(String(result.content[0]?.text)) as SidebarGroupsPayload;
        expect(payload.stored.order?.slice(0, 2)).toEqual(["labels", "projects"]);
        expect(payload.stored.hidden).toContain("sprints");
        const sprints = payload.resolved.find(r => r.id === "sprints");
        expect(sprints?.hidden).toBe(true);
      } finally {
        await client.close();
      }
      const file = await readFile(await settingsPath(root), "utf8");
      expect(file).toContain("sidebar_groups");
      expect(file).toContain("sprints");
    });
  });

  // @verifies SHL-45 — a WRITE rejects an unknown id (B2 bug 4), parity
  // with the CLI: a typo must not silently no-op.
  it("rejects an unknown id with an error naming it, writing nothing", async () => {
    await withTmpLoctt(async ({ root }) => {
      const client = await startMcpClient(root);
      try {
        const result = await client.callTool("set_sidebar_groups", {
          order: ["labels", "bogus", "projects"],
        });
        expect(result.isError).toBe(true);
        expect(String(result.content[0]?.text)).toContain("bogus");
      } finally {
        await client.close();
      }
      // Nothing was persisted.
      const file = await readFile(await settingsPath(root), "utf8").catch(() => "");
      expect(file).not.toContain("sidebar_groups");
    });
  });

  // @verifies SHL-45 — the resolved list round-trips a hidden FILTER,
  // not just groups (B2 bug 3), parity with the CLI read.
  it("resolves a hidden built-in filter (not only groups)", async () => {
    await withTmpLoctt(async ({ root }) => {
      const client = await startMcpClient(root);
      try {
        const set = await client.callTool("set_sidebar_groups", { hidden: ["overdue"] });
        expect(set.isError).toBeFalsy();
        const setPayload = JSON.parse(String(set.content[0]?.text)) as SidebarGroupsPayload;
        expect(setPayload.resolved.find(r => r.id === "overdue")?.hidden).toBe(true);

        const get = await client.callTool("get_sidebar_groups", {});
        const getPayload = JSON.parse(String(get.content[0]?.text)) as SidebarGroupsPayload;
        expect(getPayload.resolved.find(r => r.id === "overdue")?.hidden).toBe(true);
      } finally {
        await client.close();
      }
    });
  });

  // @verifies SHL-45
  it("reset clears the setting", async () => {
    await withTmpLoctt(async ({ root }) => {
      await writeFile(
        await settingsPath(root),
        "theme: dark\nsidebar_groups:\n  version: 2\n  hidden: [labels]\n",
        "utf8",
      );
      const client = await startMcpClient(root);
      try {
        const result = await client.callTool("set_sidebar_groups", { reset: true });
        expect(result.isError).toBeFalsy();
      } finally {
        await client.close();
      }
      const file = await readFile(await settingsPath(root), "utf8");
      expect(file).not.toContain("sidebar_groups");
      expect(file).toContain("theme: dark");
    });
  });

  // @verifies ONB-C23
  // @verifies SHL-54 — K160 (was B52's read-time migration test): on a
  // tracker still at 0.3.0 the tools are refused until migrate_schema runs
  // (confirmed); after it, get_sidebar_groups reads the converted layout,
  // the retired pins leading the saved views, and `stored` is version 2.
  it("K160: after migrate_schema, get_sidebar_groups reads the converted layout with the pinned view first", async () => {
    await withTmpLoctt(async ({ root }) => {
      const client = await startMcpClient(root);
      try {
        const created = await client.callTool("create_view", { name: "Open bugs", filters: [] });
        const viewId = (JSON.parse(String(created.content[0]?.text)) as { id: string }).id;
        const file = await settingsPath(root);
        await writeFile(path.join(root, ".loctt", ".schema-version"), "0.3.0\n", "utf8");
        await writeFile(
          file,
          `sidebar_pins: [${viewId}]\nsidebar_groups:\n  order: [overdue, projects, views, saved-filters]\n  hidden: [saved-filters]\n`,
          "utf8",
        );
        const refused = await client.callTool("get_sidebar_groups", {});
        expect(refused.isError).toBe(true);
        expect(String(refused.content[0]?.text)).toContain("This tracker needs upgrading from 0.3.0 to 0.4.0.");

        const plan = await client.callTool("migrate_schema", {});
        expect(String(plan.content[0]?.text)).toContain("0.3.0→0.4.0: Move sidebar settings to the Views layout");
        const done = await client.callTool("migrate_schema", { confirm: true });
        expect(String(done.content[0]?.text)).toContain("Upgraded this tracker from 0.3.0 to 0.4.0.");
        expect(await readFile(file, "utf8")).not.toContain("sidebar_pins");

        const result = await client.callTool("get_sidebar_groups", {});
        expect(result.isError).toBeFalsy();
        const payload = JSON.parse(String(result.content[0]?.text)) as SidebarGroupsPayload;
        const ids = payload.resolved.map(r => r.id);
        // One Views group where the first built-in sat (A339's rule), the
        // built-ins first; the pinned view leads init's seed view.
        expect(ids.slice(0, 3)).toEqual(["views", "overdue", "assigned-to-me"]);
        expect(ids[7]).toBe(`view:${viewId}`);
        expect(ids[8]?.startsWith("view:")).toBe(true);
        expect(ids.slice(9, 11)).toEqual(["projects", "layouts"]);
        // The old "Saved views hidden" is kept, on each view itself.
        expect(payload.resolved[7]).toEqual({ id: `view:${viewId}`, hidden: true, name: "Open bugs" });
        expect(payload.stored.version).toBe(2);
        expect(payload.stored.hidden).toEqual([`view:${viewId}`, ids[8]]);
      } finally {
        await client.close();
      }
    });
  });

  // @verifies SHL-54 — K160: a pre-K158 value left after the step is not
  // migrated on read: `stored` and `resolved` are the default layout.
  it("K160: a pre-K158 stored order is read as the default layout", async () => {
    await withTmpLoctt(async ({ root }) => {
      await writeFile(
        await settingsPath(root),
        "sidebar_groups:\n  order: [overdue, projects, views, saved-filters]\n  hidden: [saved-filters]\n",
        "utf8",
      );
      const client = await startMcpClient(root);
      try {
        const result = await client.callTool("get_sidebar_groups", {});
        expect(result.isError).toBeFalsy();
        const payload = JSON.parse(String(result.content[0]?.text)) as SidebarGroupsPayload;
        expect(payload.stored).toEqual({ version: 2 });
        expect(payload.resolved.map(r => r.id).slice(0, 3)).toEqual(["layouts", "projects", "views"]);
        expect(payload.resolved.every(r => !r.hidden)).toBe(true);
      } finally {
        await client.close();
      }
    });
  });

  // @verifies SHL-54 — K158: a hidden Views group hides every child.
  it("K158: reports every Views child hidden when the Views group is hidden", async () => {
    await withTmpLoctt(async ({ root }) => {
      const client = await startMcpClient(root);
      try {
        const set = await client.callTool("set_sidebar_groups", { hidden: ["views"] });
        expect(set.isError).toBeFalsy();
        const payload = JSON.parse(String(set.content[0]?.text)) as SidebarGroupsPayload;
        const hidden = payload.resolved.filter(r => r.hidden).map(r => r.id).filter(id => !id.startsWith("view:")).sort();
        expect(hidden).toEqual([
          "assigned-to-me", "due-this-week", "high-priority",
          "mentions-me", "overdue", "reported-by-me", "views",
        ]);
        // init's seed view too: every child of a hidden group reads hidden.
        expect(payload.resolved.filter(r => r.id.startsWith("view:")).every(r => r.hidden)).toBe(true);
        expect(payload.resolved.find(r => r.id === "projects")?.hidden).toBe(false);
      } finally {
        await client.close();
      }
    });
  });

  // @verifies SHL-54 — K158: saved views are ordered and hidden by
  // `view:<id>`; an id naming no view is refused.
  it("K158: orders and hides a saved view by view:<id>, and refuses one that does not exist", async () => {
    await withTmpLoctt(async ({ root }) => {
      const client = await startMcpClient(root);
      try {
        const created = await client.callTool("create_view", { name: "Open bugs", filters: [] });
        const viewId = (JSON.parse(String(created.content[0]?.text)) as { id: string }).id;
        const set = await client.callTool("set_sidebar_groups", {
          order: [`view:${viewId}`, "overdue"],
          hidden: [`view:${viewId}`],
        });
        expect(set.isError).toBeFalsy();
        const payload = JSON.parse(String(set.content[0]?.text)) as SidebarGroupsPayload;
        const ids = payload.resolved.map(r => r.id);
        const at = ids.indexOf("views");
        expect(ids.slice(at + 1, at + 3)).toEqual([`view:${viewId}`, "overdue"]);
        expect(payload.resolved.find(r => r.id === `view:${viewId}`)?.hidden).toBe(true);

        const bad = await client.callTool("set_sidebar_groups", { hidden: ["view:nope"] });
        expect(bad.isError).toBe(true);
        expect(String(bad.content[0]?.text)).toContain("view:nope");
      } finally {
        await client.close();
      }
    });
  });
});
