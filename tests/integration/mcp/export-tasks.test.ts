import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * @verifies TSK-C7 (F4 / K30)
 *
 * Task export used to be web-only; K30 built the `export_tasks` MCP
 * tool so an agent can produce a CSV/JSON report without the web
 * server. Fail-first proof for F4 on the MCP surface.
 */
describe("MCP export_tasks", () => {
  it("exports tasks as CSV by default", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "Alpha task"], { cwd: root });
      await runCli(["create", "Beta task"], { cwd: root });
      const client = await startMcpClient(root);
      try {
        const res = await client.callTool("export_tasks", {});
        const body = res.content[0]?.text ?? "";
        expect(body).toMatch(/key,id,title,/);
        expect(body).toContain("Alpha task");
        expect(body).toContain("Beta task");
      } finally {
        await client.close();
      }
    });
  });

  it("exports tasks as JSON when format=json", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "JSON task"], { cwd: root });
      const client = await startMcpClient(root);
      try {
        const res = await client.callTool("export_tasks", { format: "json" });
        const body = res.content[0]?.text ?? "";
        const parsed = JSON.parse(body) as { title?: string }[];
        expect(parsed.some(r => r.title === "JSON task")).toBe(true);
      } finally {
        await client.close();
      }
    });
  });

  it("honours a query filter", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "Keep"], { cwd: root });
      await runCli(["create", "Drop"], { cwd: root });
      await runCli(["set", "T-1", "status", "done"], { cwd: root });
      const client = await startMcpClient(root);
      try {
        const res = await client.callTool("export_tasks", {
          format: "json",
          query: "status = done",
        });
        const parsed = JSON.parse(res.content[0]?.text ?? "[]") as { title?: string }[];
        expect(parsed.some(r => r.title === "Keep")).toBe(true);
        expect(parsed.some(r => r.title === "Drop")).toBe(false);
      } finally {
        await client.close();
      }
    });
  });
});
