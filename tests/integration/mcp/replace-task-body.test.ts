import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

describe("MCP replace_task_body (stdio)", () => {
  it("replaces the task body", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "replaceable"], { cwd: root });

      const client = await startMcpClient(root);
      try {
        const replace = await client.callTool("replace_task_body", {
          ref: "T-1",
          body: "fresh body text",
        });
        expect(replace.isError).toBeFalsy();

        const get = await client.callTool("get_task", { ref: "T-1" });
        expect(get.content[0]?.text ?? "").toContain("fresh body text");
      } finally {
        await client.close();
      }
    });
  });
});
