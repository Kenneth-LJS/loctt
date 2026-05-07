import { describe, expect, it } from "vitest";

import { runCli } from "../../adapters/cli-spawn.js";
import { startMcpClient } from "../../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../../fixtures/tmp-loctt.js";

describe("MCP delete_task edge cases (stdio)", () => {
  it("returns isError when confirm is false", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "t"], { cwd: root });

      const client = await startMcpClient(root);
      try {
        const result = await client.callTool("delete_task", { ref: "T-1", confirm: false });
        expect(result.isError).toBe(true);
        expect(result.content[0]?.text ?? "").toContain("confirm");

        // Task should still exist.
        const get = await client.callTool("get_task", { ref: "T-1" });
        expect(get.isError).toBeFalsy();
      } finally {
        await client.close();
      }
    });
  });

  it("returns isError on a nonexistent task", async () => {
    await withTmpLoctt(async ({ root }) => {
      const client = await startMcpClient(root);
      try {
        const result = await client.callTool("delete_task", { ref: "T-99", confirm: true });
        expect(result.isError).toBe(true);
        expect(result.content[0]?.text ?? "").toContain("not found");
      } finally {
        await client.close();
      }
    });
  });
});
