import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

describe("MCP list_tasks (stdio)", () => {
  it("returns all tasks", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "alpha"], { cwd: root });
      await runCli(["create", "beta"], { cwd: root });

      const client = await startMcpClient(root);
      try {
        const result = await client.callTool("list_tasks", {});

        expect(result.isError).toBeFalsy();
        const text = result.content[0]?.text ?? "";
        expect(text).toContain("alpha");
        expect(text).toContain("beta");
      } finally {
        await client.close();
      }
    });
  });

  it("hides archived tasks by default", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "active task"], { cwd: root });
      await runCli(["create", "to be archived"], { cwd: root });
      await runCli(["archive", "T-2"], { cwd: root });

      const client = await startMcpClient(root);
      try {
        const result = await client.callTool("list_tasks", {});
        expect(result.isError).toBeFalsy();
        const text = result.content[0]?.text ?? "";
        expect(text).toContain("active task");
        expect(text).not.toContain("to be archived");
      } finally {
        await client.close();
      }
    });
  });

  it("includes archived tasks when include_archived=true", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "active task"], { cwd: root });
      await runCli(["create", "to be archived"], { cwd: root });
      await runCli(["archive", "T-2"], { cwd: root });

      const client = await startMcpClient(root);
      try {
        const result = await client.callTool("list_tasks", { include_archived: true });
        expect(result.isError).toBeFalsy();
        const text = result.content[0]?.text ?? "";
        expect(text).toContain("active task");
        expect(text).toContain("to be archived");
      } finally {
        await client.close();
      }
    });
  });
});
