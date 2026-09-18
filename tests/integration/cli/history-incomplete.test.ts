import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * A malformed history row is reported incomplete through the CLI `log`
 * and MCP `get_task_history`, not silently shortened. Mirrors the web
 * activity feed's `unreadable` count (DEG-18 / CMT-37).
 *
 * Distinct from corrupt-history.test.ts (CMT-C7), which covers a WHOLE
 * `_history.yaml` that is not an array (object-fatal). Here the file IS a
 * valid array; one ROW lacks the timestamp/kind an entry needs, so it is
 * kept in the file (P-11) but excluded from the displayed entries — and
 * the count of what could not be read is surfaced.
 *
 * @verifies DEG-C7
 */
describe("a malformed history row is reported incomplete, not silently shortened", () => {
  const historyPath = async (root: string): Promise<string> => {
    const dir = path.join(root, ".loctt/tasks");
    const [id] = (await readdir(dir)).sort();
    return path.join(dir, id ?? "", "_history.yaml");
  };

  /**
   * Replaces the history with a valid YAML array: one readable entry and
   * one row that is not an entry (no timestamp/kind). The file parses; the
   * bad row is kept but unreadable.
   */
  const seedMixed = async (root: string): Promise<void> => {
    const file = await historyPath(root);
    const existing = await readFile(file, "utf-8");
    // Keep whatever real first entry exists, then append a junk row.
    const mixed = `${existing.trimEnd()}\n- garbage: yes\n  not: an-entry\n`;
    await writeFile(file, mixed, "utf-8");
  };

  it("loctt log keeps the readable rows and reports the unreadable count", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "a"], { cwd: root });
      await runCli(["set", "T-1", "priority", "high"], { cwd: root });
      await seedMixed(root);

      const res = await runCli(["log", "T-1"], { cwd: root });
      const out = `${res.stdout}${res.stderr}`;
      // The readable history still shows.
      expect(res.stdout).toMatch(/priority/);
      // And the log says it is incomplete rather than presenting the
      // readable subset as the whole thing.
      expect(out).toMatch(/could not be read/);
      expect(out).toMatch(/1 entr/);
    });
  });

  it("MCP get_task_history carries the incomplete count and the readable entries", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "a"], { cwd: root });
      await runCli(["set", "T-1", "priority", "high"], { cwd: root });
      await seedMixed(root);

      const client = await startMcpClient(root);
      try {
        const res = await client.callTool("get_task_history", { ref: "T-1" });
        const parsed = JSON.parse(res.content[0]?.text ?? "{}") as {
          entries?: unknown[];
          incomplete?: number;
        };
        expect((parsed.entries?.length ?? 0)).toBeGreaterThan(0);
        expect(parsed.incomplete).toBe(1);
      } finally {
        await client.close();
      }
    });
  });

  it("a clean history reports no incomplete count on either surface", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "a"], { cwd: root });
      await runCli(["set", "T-1", "priority", "high"], { cwd: root });

      const cli = await runCli(["log", "T-1"], { cwd: root });
      expect(`${cli.stdout}${cli.stderr}`).not.toMatch(/could not be read/);

      const client = await startMcpClient(root);
      try {
        const res = await client.callTool("get_task_history", { ref: "T-1" });
        const parsed = JSON.parse(res.content[0]?.text ?? "{}") as { incomplete?: number };
        expect(parsed.incomplete).toBeUndefined();
      } finally {
        await client.close();
      }
    });
  });
});
