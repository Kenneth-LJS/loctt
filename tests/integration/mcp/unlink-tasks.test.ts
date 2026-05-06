import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

describe("MCP unlink_tasks (stdio)", () => {
  it("removes a previously created relationship", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "first"], { cwd: root });
      await runCli(["create", "second"], { cwd: root });

      const client = await startMcpClient(root);
      try {
        await client.callTool("link_tasks", { ref: "T-1", type: "blocks", target: "T-2" });
        const unlink = await client.callTool("unlink_tasks", {
          ref: "T-1",
          type: "blocks",
          target: "T-2",
        });
        expect(unlink.isError).toBeFalsy();

        const get = await client.callTool("get_task", { ref: "T-1" });
        const text = get.content[0]?.text ?? "";
        expect(text).not.toContain("\"target\"");

        // Bilateral: T-2 should also have the inverse edge removed.
        const getTarget = await client.callTool("get_task", { ref: "T-2" });
        const targetText = getTarget.content[0]?.text ?? "";
        expect(targetText).not.toContain("\"target\"");
      } finally {
        await client.close();
      }
    });
  });
});
