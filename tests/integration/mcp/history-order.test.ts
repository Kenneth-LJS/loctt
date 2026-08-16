import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * @verifies CMT-C8
 *
 * `get_task_history` reversed the array `readHistory` returned, in
 * place. That is safe only because `readHistory` re-reads and re-parses
 * the file on every call, so each caller gets a fresh array — a
 * property of the callee that the handler had no right to depend on.
 * Adding a cache there would have flipped the ordering on every second
 * call, and nothing would have caught it.
 *
 * The handler now copies. This test pins the observable guarantee:
 * repeated calls agree, and they agree on newest-first.
 */
describe("MCP get_task_history ordering (stdio)", () => {
  it("returns the same newest-first ordering on repeated calls", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "order probe"], { cwd: root });
      await runCli(["set", "T-1", "status", "in_progress"], { cwd: root });
      await runCli(["set", "T-1", "priority", "high"], { cwd: root });

      const client = await startMcpClient(root);
      try {
        const calls: string[][] = [];
        for (let i = 0; i < 3; i += 1) {
          const result = await client.callTool("get_task_history", { ref: "T-1" });
          expect(result.isError).toBeFalsy();
          const entries = JSON.parse(result.content[0]?.text ?? "[]") as Array<{
            kind: string;
            timestamp: string;
          }>;
          calls.push(entries.map(e => e.timestamp));
        }

        // Three entries, so a reversal between calls is visible rather
        // than being a fixed point.
        expect(calls[0]).toHaveLength(3);

        // Newest first.
        const first = calls[0] ?? [];
        expect([...first].sort().reverse()).toEqual(first);

        // Every call agrees. This is the assertion an in-place reverse
        // on a memoised array would break.
        expect(calls[1]).toEqual(calls[0]);
        expect(calls[2]).toEqual(calls[0]);
      } finally {
        await client.close();
      }
    });
  });
});
