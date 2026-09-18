import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * @verifies QRY-C5
 *
 * A truncated list that does not say it was truncated reads as a
 * complete answer. An agent told "here are your tasks" acts on all of
 * them; if that was 30 of 100, it acts on a third of the tracker
 * believing it saw everything.
 */
describe("MCP list_tasks reports truncation honestly", () => {
  const seed = async (root: string, n: number): Promise<void> => {
    for (let i = 0; i < n; i += 1) {
      await runCli(["create", `task ${String(i)}`], { cwd: root });
    }
  };

  it("states the total matched, not just the returned slice", async () => {
    await withTmpLoctt(async ({ root }) => {
      await seed(root, 12);
      const client = await startMcpClient(root);
      try {
        const res = await client.callTool("list_tasks", { limit: 5 });
        const parsed = JSON.parse(res.content[0]?.text ?? "{}") as {
          matched?: number; returned?: number; tasks?: unknown[];
        };

        // Matching /12/ in the raw text is not enough: twelve tasks are
        // named in the body regardless, so that passes with no total
        // reported at all. Assert the field.
        expect(parsed.matched).toBe(12);
        expect(parsed.returned).toBe(5);
        expect(parsed.tasks).toHaveLength(5);
      } finally {
        await client.close();
      }
    });
  });

  it("pages without overlap or omission", async () => {
    await withTmpLoctt(async ({ root }) => {
      await seed(root, 12);
      const client = await startMcpClient(root);
      try {
        const keys: string[] = [];
        for (let offset = 0; offset < 12; offset += 5) {
          const res = await client.callTool("list_tasks", { limit: 5, offset });
          for (const m of (res.content[0]?.text ?? "").matchAll(/"key": "(T-\d+)"/g)) {
            keys.push(m[1] as string);
          }
        }
        // Union of pages equals the whole set, each row once.
        expect(new Set(keys).size).toBe(12);
        expect(keys).toHaveLength(12);
      } finally {
        await client.close();
      }
    });
  });

  it("says nothing about truncation when nothing was truncated", async () => {
    await withTmpLoctt(async ({ root }) => {
      await seed(root, 3);
      const client = await startMcpClient(root);
      try {
        const res = await client.callTool("list_tasks", {});
        expect(res.content[0]?.text ?? "").not.toMatch(/truncat/i);
      } finally {
        await client.close();
      }
    });
  });
});
