import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

describe("MCP task_history (stdio)", () => {
  it("returns history entries newest first", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "tracked"], { cwd: root });
      await runCli(["set", "T-1", "status", "in_progress"], { cwd: root });

      const client = await startMcpClient(root);
      try {
        const result = await client.callTool("task_history", { ref: "T-1" });
        expect(result.isError).toBeFalsy();

        const text = result.content[0]?.text ?? "";
        const entries = JSON.parse(text) as unknown[];
        expect(entries.length).toBeGreaterThanOrEqual(2);
      } finally {
        await client.close();
      }
    });
  });
});
