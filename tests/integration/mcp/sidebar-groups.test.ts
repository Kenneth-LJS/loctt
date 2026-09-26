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
  stored: { order?: string[]; hidden?: string[] };
  resolved: { id: string; hidden: boolean }[];
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
        "theme: dark\nsidebar_groups:\n  hidden: [labels]\n",
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

  // @verifies SHL-45 — A346: `resolved` goes through the grouped
  // resolver the web sidebar uses (K125 migration), not the flat order.
  it("resolves a pre-K125 stored order the way the sidebar renders it", async () => {
    await withTmpLoctt(async ({ root }) => {
      await writeFile(
        await settingsPath(root),
        "sidebar_groups:\n  order: [overdue, projects]\n",
        "utf8",
      );
      const client = await startMcpClient(root);
      try {
        const result = await client.callTool("get_sidebar_groups", {});
        expect(result.isError).toBeFalsy();
        const payload = JSON.parse(String(result.content[0]?.text)) as SidebarGroupsPayload;
        const ids = payload.resolved.map(r => r.id);
        expect(ids.slice(0, 3)).toEqual(["filters", "overdue", "assigned-to-me"]);
        expect(ids.indexOf("projects")).toBe(7);
        expect(ids[8]).toBe("views");
        // The stored value is reported as stored, unmigrated.
        expect(payload.stored.order).toEqual(["overdue", "projects"]);
      } finally {
        await client.close();
      }
    });
  });

  // @verifies SHL-45 — A346: a hidden Filters group hides every built-in.
  it("reports every built-in filter hidden when the Filters group is hidden", async () => {
    await withTmpLoctt(async ({ root }) => {
      const client = await startMcpClient(root);
      try {
        const set = await client.callTool("set_sidebar_groups", { hidden: ["filters"] });
        expect(set.isError).toBeFalsy();
        const payload = JSON.parse(String(set.content[0]?.text)) as SidebarGroupsPayload;
        const hidden = payload.resolved.filter(r => r.hidden).map(r => r.id).sort();
        expect(hidden).toEqual([
          "assigned-to-me", "due-this-week", "filters", "high-priority",
          "mentions-me", "overdue", "reported-by-me",
        ]);
        const get = await client.callTool("get_sidebar_groups", {});
        const getPayload = JSON.parse(String(get.content[0]?.text)) as SidebarGroupsPayload;
        expect(getPayload.resolved.find(r => r.id === "overdue")?.hidden).toBe(true);
      } finally {
        await client.close();
      }
    });
  });
});
