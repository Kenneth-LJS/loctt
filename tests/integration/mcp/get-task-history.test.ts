import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

interface HistoryPage {
  entries: { kind: string; timestamp: string }[];
  total: number;
  offset: number;
  limit?: number;
}

describe("MCP get_task_history (stdio)", () => {
  it("returns a paginated page: newest-first entries plus total and offset", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "tracked"], { cwd: root });
      await runCli(["set", "T-1", "status", "in_progress"], { cwd: root });

      const client = await startMcpClient(root);
      try {
        const result = await client.callTool("get_task_history", { ref: "T-1" });
        expect(result.isError).toBeFalsy();

        const page = JSON.parse(result.content[0]?.text ?? "") as HistoryPage;
        expect(page.entries.length).toBeGreaterThanOrEqual(2);
        // total reflects the full history, and with no offset the page is
        // the whole thing.
        expect(page.total).toBe(page.entries.length);
        expect(page.offset).toBe(0);
        // Newest first.
        expect(
          page.entries[0]!.timestamp >= page.entries[page.entries.length - 1]!.timestamp,
        ).toBe(true);
      } finally {
        await client.close();
      }
    });
  });

  // @verifies CMT-C4
  it("offset + limit walk a long history without gaps or repeats, total stays constant", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "tracked"], { cwd: root });
      // Generate a history longer than one page. Each status change to a
      // *different* value is one `field_change`; alternating between two
      // valid default statuses forces 5 changes, +1 `created` = 6 total.
      // (Setting a status to its current value is a no-op and records
      // nothing, so the values must actually differ each step.)
      for (const s of ["in_progress", "done", "in_progress", "done", "in_progress"]) {
        await runCli(["set", "T-1", "status", s], { cwd: root });
      }

      const client = await startMcpClient(root);
      try {
        const all = JSON.parse(
          (await client.callTool("get_task_history", { ref: "T-1" })).content[0]?.text ?? "",
        ) as HistoryPage;
        expect(all.total).toBeGreaterThanOrEqual(6);
        const total = all.total;

        // Page 1: newest 3. Page 2: next 3 via offset. They must partition
        // the newest 6 with no repeats and no boundary gap — the exact
        // failure CMT-C4 names (an agent reads the newest N and nothing
        // older).
        const p1 = JSON.parse(
          (await client.callTool("get_task_history", { ref: "T-1", limit: 3 })).content[0]?.text ?? "",
        ) as HistoryPage;
        const p2 = JSON.parse(
          (await client.callTool("get_task_history", { ref: "T-1", limit: 3, offset: 3 })).content[0]?.text ?? "",
        ) as HistoryPage;

        expect(p1.entries).toHaveLength(3);
        expect(p1.total).toBe(total);
        expect(p2.total).toBe(total);
        expect(p2.offset).toBe(3);

        // No entry appears in both pages (timestamps as identity is enough
        // here — the seeded changes are distinct events).
        const p1Stamps = new Set(p1.entries.map(e => e.timestamp));
        const overlap = p2.entries.filter(e => p1Stamps.has(e.timestamp));
        expect(overlap).toHaveLength(0);

        // And offset actually reached older entries: the first of page 2
        // is older than (or equal to) the last of page 1 — the boundary
        // is contiguous, not skipped.
        expect(p2.entries[0]!.timestamp <= p1.entries[2]!.timestamp).toBe(true);
      } finally {
        await client.close();
      }
    });
  });
});
