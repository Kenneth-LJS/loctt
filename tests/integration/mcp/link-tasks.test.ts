import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

describe("MCP link_tasks (stdio)", () => {
  it("creates a relationship between two tasks", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "first"], { cwd: root });
      await runCli(["create", "second"], { cwd: root });

      const client = await startMcpClient(root);
      try {
        const link = await client.callTool("link_tasks", {
          ref: "T-1",
          type: "blocks",
          target: "T-2",
        });
        expect(link.isError).toBeFalsy();

        const get = await client.callTool("get_task", { ref: "T-1" });
        const text = get.content[0]?.text ?? "";
        expect(text).toContain("blocks");

        // Bilateral: T-2 should now show the inverse `blocked_by` edge.
        const getTarget = await client.callTool("get_task", { ref: "T-2" });
        const targetText = getTarget.content[0]?.text ?? "";
        expect(targetText).toContain("blocked_by");
      } finally {
        await client.close();
      }
    });
  });
});
