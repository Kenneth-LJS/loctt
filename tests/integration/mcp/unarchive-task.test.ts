import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

describe("MCP unarchive_task (stdio)", () => {
  it("restores an archived task", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "round trip"], { cwd: root });

      const client = await startMcpClient(root);
      try {
        await client.callTool("archive_task", { refs: ["T-1"] });
        const unarchive = await client.callTool("unarchive_task", { refs: ["T-1"] });
        expect(unarchive.isError).toBeFalsy();

        const get = await client.callTool("get_task", { ref: "T-1" });
        const text = get.content[0]?.text ?? "";
        expect(text).not.toContain("\"archived\": true");
      } finally {
        await client.close();
      }
    });
  });
});
