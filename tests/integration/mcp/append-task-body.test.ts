import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

describe("MCP append_task_body (stdio)", () => {
  it("appends text to the task body", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "appendable"], { cwd: root });

      const client = await startMcpClient(root);
      try {
        const append = await client.callTool("append_task_body", {
          ref: "T-1",
          text: "more content",
        });
        expect(append.isError).toBeFalsy();

        const get = await client.callTool("get_task", { ref: "T-1" });
        expect(get.content[0]?.text ?? "").toContain("more content");
      } finally {
        await client.close();
      }
    });
  });
});
