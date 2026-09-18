import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * @verifies TSK-C3
 *
 * The CLI validated the enum before looking the task up, so a typo'd key
 * on a nonexistent task blamed the status vocabulary — and exited 2
 * (usage) rather than 1 (domain). MCP ordered it correctly, so the two
 * surfaces disagreed about what went wrong.
 */
describe("a missing task is reported before its arguments", () => {
  it("blames the missing task, not the status, and exits 1", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "exists"], { cwd: root });

      const res = await runCli(["set", "T-999", "status", "doing"], { cwd: root });
      const out = `${res.stdout}${res.stderr}`;

      expect(out).toMatch(/T-999/);
      expect(out).toMatch(/not found/i);
      // Naming the vocabulary here sends the user to fix the wrong thing.
      expect(out).not.toMatch(/Known:/);
      // Domain error, not usage: the command was well-formed.
      expect(res.exitCode).toBe(1);
    });
  });

  it("still reports an unknown status on a task that exists", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "exists"], { cwd: root });

      const res = await runCli(["set", "T-1", "status", "doing"], { cwd: root });
      expect(`${res.stdout}${res.stderr}`).toMatch(/Known:/);
      expect(res.exitCode).toBe(2);
    });
  });

  it("orders it the same way on MCP", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "exists"], { cwd: root });
      const client = await startMcpClient(root);
      try {
        const res = await client.callTool("update_task", {
          ref: "T-999", field: "status", value: "doing",
        });
        expect(res.isError).toBeTruthy();
        const text = res.content[0]?.text ?? "";
        expect(text).toMatch(/T-999/);
        expect(text).not.toMatch(/Known:/);
      } finally {
        await client.close();
      }
    });
  });

  it("holds for unset and archive too", async () => {
    await withTmpLoctt(async ({ root }) => {
      for (const argv of [
        ["unset", "T-999", "status"],
        ["archive", "T-999"],
      ]) {
        const res = await runCli(argv, { cwd: root });
        expect(`${res.stdout}${res.stderr}`, argv.join(" ")).toMatch(/not found/i);
      }
    });
  });
});
