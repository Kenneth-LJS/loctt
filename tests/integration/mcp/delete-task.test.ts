import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

describe("MCP delete_task (stdio)", () => {
  it("rejects delete without confirm: true", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "doomed"], { cwd: root });

      const client = await startMcpClient(root);
      try {
        const del = await client.callTool("delete_task", { refs: ["T-1"] });
        expect(del.isError).toBe(true);
        expect(del.content[0]?.text ?? "").toMatch(/confirm/i);

        // Task still on disk.
        const get = await client.callTool("get_task", { ref: "T-1" });
        expect(get.isError).toBeFalsy();
      } finally {
        await client.close();
      }
    });
  });

  it("permanently removes a task with confirm: true", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "doomed"], { cwd: root });

      const client = await startMcpClient(root);
      try {
        const del = await client.callTool("delete_task", { refs: ["T-1"],
          confirm: true,
        });
        expect(del.isError).toBeFalsy();

        const get = await client.callTool("get_task", { ref: "T-1" });
        expect(get.isError).toBe(true);
      } finally {
        await client.close();
      }
    });
  });
});
