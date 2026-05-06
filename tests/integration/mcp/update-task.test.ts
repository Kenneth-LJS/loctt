import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

describe("MCP update_task (stdio)", () => {
  it("sets a field and reads it back", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "needs status"], { cwd: root });

      const client = await startMcpClient(root);
      try {
        const update = await client.callTool("update_task", {
          ref: "T-1",
          field: "status",
          value: "in_progress",
        });
        expect(update.isError).toBeFalsy();

        const get = await client.callTool("get_task", { ref: "T-1" });
        expect(get.content[0]?.text ?? "").toContain("in_progress");
      } finally {
        await client.close();
      }
    });
  });
});
