import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * @verifies CMT-C8
 *
 * The original hazard: `get_task_history` reversed `readHistory`'s array
 * **in place**, safe only because `readHistory` re-read the file each
 * call. A cache there would have flipped the order on every second call
 * with nothing to catch it — and the test that "guarded" it was vacuous,
 * passing even with the defensive copy removed, because a cache-free
 * callee makes the mutation unobservable across calls.
 *
 * That hazard is now gone by construction, not by a defensive copy: the
 * handler uses core's paginating `readHistory({ order: "desc" })`, which
 * builds its result with `[...filtered].sort(...)` — a fresh array it
 * never hands out twice and never mutates in place. So there is nothing
 * for a cache to corrupt.
 *
 * This test pins the observable guarantee that remains meaningful:
 * repeated calls return the same newest-first ordering. (Ordering lives
 * in core now; the deep non-mutation property is a core unit concern,
 * `history.test.ts`, not something the MCP boundary can assert.)
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
          const page = JSON.parse(result.content[0]?.text ?? "{}") as {
            entries: { kind: string; timestamp: string }[];
          };
          calls.push(page.entries.map(e => e.timestamp));
        }

        // Three entries, so a reversal between calls is visible rather
        // than being a fixed point.
        expect(calls[0]).toHaveLength(3);

        // Newest first.
        const first = calls[0] ?? [];
        expect([...first].sort().reverse()).toEqual(first);

        // Every call agrees.
        expect(calls[1]).toEqual(calls[0]);
        expect(calls[2]).toEqual(calls[0]);
      } finally {
        await client.close();
      }
    });
  });
});
