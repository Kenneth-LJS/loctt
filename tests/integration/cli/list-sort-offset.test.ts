import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * @verifies QRY-C4
 *
 * Core has sort and offset; the CLI had neither flag and MCP neither
 * parameter, so the web was the only surface that could order or page a
 * list. An agent asking for "the highest-priority open task" had to
 * fetch everything and sort it itself.
 */
describe("sort and offset exist on CLI and MCP", () => {
  const seed = async (root: string): Promise<void> => {
    await runCli(["create", "low one"], { cwd: root });
    await runCli(["create", "high one"], { cwd: root });
    await runCli(["create", "critical one"], { cwd: root });
    await runCli(["set", "T-1", "priority", "low"], { cwd: root });
    await runCli(["set", "T-2", "priority", "high"], { cwd: root });
    await runCli(["set", "T-3", "priority", "critical"], { cwd: root });
  };

  const keys = (s: string): string[] => [...s.matchAll(/\bT-\d+\b/g)].map(m => m[0]);

  it("orders by priority using the workflow value, not lexicographically", async () => {
    await withTmpLoctt(async ({ root }) => {
      await seed(root);

      const res = await runCli(["list", "--sort", "priority", "--dir", "asc"], { cwd: root });
      expect(res.exitCode, `${res.stdout}${res.stderr}`).toBe(0);

      // low=1 … critical=4, so ascending is low → critical. Alphabetical
      // order would be critical, high, low — the reverse — which is what
      // makes this assertion prove the numeric `value` is being used.
      expect(keys(res.stdout)).toEqual(["T-1", "T-2", "T-3"]);
    });
  });

  it("reverses with --dir desc", async () => {
    await withTmpLoctt(async ({ root }) => {
      await seed(root);
      const res = await runCli(["list", "--sort", "priority", "--dir", "desc"], { cwd: root });
      expect(keys(res.stdout)).toEqual(["T-3", "T-2", "T-1"]);
    });
  });

  it("skips rows with --offset", async () => {
    await withTmpLoctt(async ({ root }) => {
      await seed(root);
      const all = await runCli(["list", "--sort", "priority"], { cwd: root });
      const skipped = await runCli(["list", "--sort", "priority", "--offset", "1"], { cwd: root });
      expect(keys(skipped.stdout)).toEqual(keys(all.stdout).slice(1));
    });
  });

  it("produces the same order on MCP", async () => {
    await withTmpLoctt(async ({ root }) => {
      await seed(root);
      const cli = await runCli(["list", "--sort", "priority"], { cwd: root });

      const client = await startMcpClient(root);
      try {
        const res = await client.callTool("list_tasks", {
          sort: "priority", direction: "asc",
        });
        expect(res.isError, res.content[0]?.text).toBeFalsy();
        // Same field, same direction, same sequence — or an agent and a
        // person looking at one tracker disagree about what is on top.
        expect(keys(res.content[0]?.text ?? "")).toEqual(keys(cli.stdout));
      } finally {
        await client.close();
      }
    });
  });
});
