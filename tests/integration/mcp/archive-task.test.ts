import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

describe("MCP archive_task (stdio)", () => {
  it("archives a task", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "archivable"], { cwd: root });

      const client = await startMcpClient(root);
      try {
        const archive = await client.callTool("archive_task", { refs: ["T-1"] });
        expect(archive.isError).toBeFalsy();

        const get = await client.callTool("get_task", { ref: "T-1" });
        const text = get.content[0]?.text ?? "";
        expect(text).toContain("\"archived\": true");
      } finally {
        await client.close();
      }
    });
  });
});
