import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * @verifies L4
 *
 * The child-progress roll-up is a core capability (computeProgress's
 * `active`, category-based, discarded-excluded), and CLAUDE.md's parity
 * rule requires both surfaces to answer it the same way. This drives the
 * spawned CLI binary and the MCP stdio server against one real tracker,
 * so a drift between `loctt show`'s line and `get_task`'s `children`
 * block — or between either and the exclusion rule — fails here.
 *
 * The fixture: parent T-1 with four children, one in each status
 * category. done=1 (completed), active=1, one pending, one discarded.
 * Both surfaces must report done:1, active:1, total:3 (the discarded
 * child excluded), discarded:1.
 */
describe("child progress is reported the same on CLI show and MCP get_task", () => {
  const buildTree = async (root: string): Promise<void> => {
    // Parent, then four children.
    await runCli(["create", "parent"], { cwd: root }); // T-1
    await runCli(["create", "child completed"], { cwd: root }); // T-2
    await runCli(["create", "child active"], { cwd: root }); // T-3
    await runCli(["create", "child pending"], { cwd: root }); // T-4
    await runCli(["create", "child discarded"], { cwd: root }); // T-5

    // Each child points at the parent via the tree axis.
    await runCli(["link", "T-2", "parent", "T-1"], { cwd: root });
    await runCli(["link", "T-3", "parent", "T-1"], { cwd: root });
    await runCli(["link", "T-4", "parent", "T-1"], { cwd: root });
    await runCli(["link", "T-5", "parent", "T-1"], { cwd: root });

    // One child in each category.
    await runCli(["set", "T-2", "status", "done"], { cwd: root });
    await runCli(["set", "T-3", "status", "in_progress"], { cwd: root });
    // T-4 stays backlog (pending).
    await runCli(["set", "T-5", "status", "wont_do"], { cwd: root });
  };

  it("prints a child-progress line on `loctt show` with the discarded child excluded", async () => {
    await withTmpLoctt(async ({ root }) => {
      await buildTree(root);
      const show = await runCli(["show", "T-1"], { cwd: root });
      expect(show.exitCode, `${show.stdout}${show.stderr}`).toBe(0);
      // 1 done, 1 active / 3 total (the discarded child excluded).
      expect(show.stdout).toMatch(/Child progress: 1 done, 1 active \/ 3/);
      expect(show.stdout).toMatch(/1 discarded excluded/);
    });
  });

  it("returns a matching `children` block on MCP get_task", async () => {
    await withTmpLoctt(async ({ root }) => {
      await buildTree(root);
      const client = await startMcpClient(root);
      try {
        const get = await client.callTool("get_task", { ref: "T-1" });
        const text = get.content[0]?.text ?? "";
        const parsed = JSON.parse(text) as {
          children?: { done: number; active: number; total: number; discarded: number };
        };
        expect(parsed.children).toEqual({
          done: 1,
          active: 1,
          total: 3,
          discarded: 1,
        });
      } finally {
        await client.close();
      }
    });
  });

  it("omits child progress when the task has no children", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "lonely"], { cwd: root });
      const show = await runCli(["show", "T-1"], { cwd: root });
      expect(show.stdout).not.toMatch(/Child progress/);

      const client = await startMcpClient(root);
      try {
        const get = await client.callTool("get_task", { ref: "T-1" });
        const text = get.content[0]?.text ?? "";
        expect(text).not.toContain("\"children\"");
      } finally {
        await client.close();
      }
    });
  });
});
