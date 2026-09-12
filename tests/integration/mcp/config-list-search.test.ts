import { describe, expect, it } from "vitest";

import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * @verifies K90
 *
 * K90: the config-list tools (list_labels, list_milestones, list_sprints,
 * list_users, list_projects) gain a `q` name search and `limit`/`offset`
 * pagination, matching the web server's filter-then-paginate order.
 * Names match on name; projects also match slug and prefix. This is the
 * MCP half of the ruling. Paths under test: apps/mcp/src/tools/{label,
 * project}.ts list handlers.
 */
describe("MCP config-list name search + pagination (K90)", () => {
  it("list_labels q returns only name matches", async () => {
    await withTmpLoctt(async ({ root }) => {
      const client = await startMcpClient(root);
      try {
        await client.callTool("create_label", { name: "Frontend" });
        await client.callTool("create_label", { name: "Backend" });
        await client.callTool("create_label", { name: "Docs" });

        const res = await client.callTool("list_labels", { q: "end" });
        expect(res.isError).toBeFalsy();
        const parsed = JSON.parse(res.content[0]?.text ?? "{}") as {
          labels: Array<{ name: string }>;
        };
        const names = parsed.labels.map(l => l.name);
        expect(names).toContain("Frontend");
        expect(names).toContain("Backend");
        expect(names).not.toContain("Docs");
      } finally {
        await client.close();
      }
    });
  });

  it("list_labels limit/offset page the list", async () => {
    await withTmpLoctt(async ({ root }) => {
      const client = await startMcpClient(root);
      try {
        for (const n of ["L0", "L1", "L2", "L3"]) {
          await client.callTool("create_label", { name: n });
        }
        const first = await client.callTool("list_labels", { limit: 2 });
        const firstParsed = JSON.parse(first.content[0]?.text ?? "{}") as {
          labels: Array<{ name: string }>;
        };
        expect(firstParsed.labels.map(l => l.name)).toEqual(["L0", "L1"]);

        const next = await client.callTool("list_labels", { limit: 2, offset: 2 });
        const nextParsed = JSON.parse(next.content[0]?.text ?? "{}") as {
          labels: Array<{ name: string }>;
        };
        expect(nextParsed.labels.map(l => l.name)).toEqual(["L2", "L3"]);
      } finally {
        await client.close();
      }
    });
  });

  it("list_projects q matches on prefix and slug, not only name", async () => {
    await withTmpLoctt(async ({ root }) => {
      const client = await startMcpClient(root);
      try {
        await client.callTool("create_project", {
          name: "Website",
          prefix: "WEB",
          slug: "webapp",
        });

        const byPrefix = await client.callTool("list_projects", { q: "WEB" });
        const prefixParsed = JSON.parse(byPrefix.content[0]?.text ?? "{}") as {
          projects: Array<{ name: string }>;
        };
        expect(prefixParsed.projects.map(p => p.name)).toContain("Website");

        const bySlug = await client.callTool("list_projects", { q: "webapp" });
        const slugParsed = JSON.parse(bySlug.content[0]?.text ?? "{}") as {
          projects: Array<{ name: string }>;
        };
        expect(slugParsed.projects.map(p => p.name)).toContain("Website");

        const miss = await client.callTool("list_projects", { q: "zzzznope" });
        const missParsed = JSON.parse(miss.content[0]?.text ?? "{}") as {
          projects: Array<{ name: string }>;
        };
        expect(missParsed.projects.map(p => p.name)).not.toContain("Website");
        expect(missParsed.projects.map(p => p.name)).not.toContain("Tasks");
      } finally {
        await client.close();
      }
    });
  });
});
