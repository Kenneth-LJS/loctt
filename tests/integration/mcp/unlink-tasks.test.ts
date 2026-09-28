import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { startMcpClient } from "../adapters/mcp-stdio.js";
import { removeTaskOutOfBand, withTmpLoctt } from "../fixtures/tmp-loctt.js";

describe("MCP unlink_tasks (stdio)", () => {
  it("removes a previously created relationship", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "first"], { cwd: root });
      await runCli(["create", "second"], { cwd: root });

      const client = await startMcpClient(root);
      try {
        await client.callTool("link_tasks", { refs: ["T-1"], type: "blocks", target: "T-2" });
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

  /**
   * @verifies REL-24
   *
   * The tool's description has always said a target deleted out of band
   * is tolerated, but the handler resolved the target first and failed
   * with "task not found", so MCP could not clean up a dangling edge the
   * CLI and web could.
   */
  it("removes an edge whose target was deleted out of band, by the id it stores", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "first"], { cwd: root });
      await runCli(["create", "second"], { cwd: root });
      await runCli(["link", "T-1", "blocks", "T-2"], { cwd: root });
      const goneId = await removeTaskOutOfBand(root, "T-2");

      const client = await startMcpClient(root);
      try {
        const unlink = await client.callTool("unlink_tasks", { ref: "T-1", type: "blocks", target: goneId });
        expect(unlink.isError, unlink.content[0]?.text).toBeFalsy();
        const get = await client.callTool("get_task", { ref: "T-1" });
        expect(get.content[0]?.text ?? "").not.toContain(goneId);
      } finally {
        await client.close();
      }
    });
  });
});
