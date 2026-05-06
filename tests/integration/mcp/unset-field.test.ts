import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

describe("MCP unset_field (stdio)", () => {
  it("clears a previously set field", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "with priority"], { cwd: root });

      const client = await startMcpClient(root);
      try {
        await client.callTool("update_task", { ref: "T-1", field: "priority", value: "high" });
        const unset = await client.callTool("unset_field", { ref: "T-1", field: "priority" });
        expect(unset.isError).toBeFalsy();

        const get = await client.callTool("get_task", { ref: "T-1" });
        const text = get.content[0]?.text ?? "";
        expect(text).not.toContain("\"priority\": \"high\"");
      } finally {
        await client.close();
      }
    });
  });
});
