import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * @verifies REL-C1
 *
 * The web half is covered in apps/web's server.relationships.test.ts.
 * This is the parity half: identical trackers, the same edge removed
 * through CLI and MCP, identical files afterwards. Divergence here is
 * how one surface strands an inverse edge the others clean up.
 */
describe("unlink leaves identical state on CLI and MCP", () => {
  const seed = async (root: string): Promise<void> => {
    await runCli(["create", "source"], { cwd: root });
    await runCli(["create", "target"], { cwd: root });
    await runCli(["link", "T-1", "blocks", "T-2"], { cwd: root });
  };

  /** Both task files, with volatile fields stripped. */
  const snapshot = async (root: string): Promise<string> => {
    const dir = path.join(root, ".loctt/tasks");
    const { readdir } = await import("node:fs/promises");
    const ids = (await readdir(dir)).sort();
    const parts: string[] = [];
    for (const id of ids) {
      const raw = await readFile(path.join(dir, id, "task.md"), "utf-8");
      parts.push(
        raw
          .replace(/^id: .*$/m, "id: <id>")
          .replace(/^created_at: .*$/m, "created_at: <ts>")
          .replace(/^updated_at: .*$/m, "updated_at: <ts>")
          .replace(/^ {2}target: .*$/gm, "  target: <id>")
          .replace(/^project: .*$/m, "project: <id>"),
      );
    }
    return parts.join("\n---\n");
  };

  it("produces the same files whichever surface removed the edge", async () => {
    let viaCli = "";
    let viaMcp = "";

    await withTmpLoctt(async ({ root }) => {
      await seed(root);
      const res = await runCli(["unlink", "T-1", "blocks", "T-2"], { cwd: root });
      expect(res.exitCode).toBe(0);
      viaCli = await snapshot(root);
    });

    await withTmpLoctt(async ({ root }) => {
      await seed(root);
      const client = await startMcpClient(root);
      try {
        const res = await client.callTool("unlink_tasks", {
          ref: "T-1", type: "blocks", target: "T-2",
        });
        expect(res.isError, res.content[0]?.text).toBeFalsy();
      } finally {
        await client.close();
      }
      viaMcp = await snapshot(root);
    });

    // Neither may keep a relationships block: an inverse left behind
    // points at an edge the other side no longer has.
    expect(viaCli).not.toMatch(/relationships:/);
    expect(viaCli).toBe(viaMcp);
  });

  it("refuses an already-absent edge on both surfaces", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "one"], { cwd: root });
      await runCli(["create", "two"], { cwd: root });

      const cli = await runCli(["unlink", "T-1", "blocks", "T-2"], { cwd: root });
      expect(cli.exitCode).not.toBe(0);

      const client = await startMcpClient(root);
      try {
        const mcp = await client.callTool("unlink_tasks", {
          ref: "T-1", type: "blocks", target: "T-2",
        });
        expect(mcp.isError).toBeTruthy();
      } finally {
        await client.close();
      }
    });
  });

  /**
   * @verifies REL-24
   *
   * **The one operation for cleaning up after a deletion was the one a
   * deletion made impossible.** Delete the target of a link and the
   * edge is left dangling on the source — REL-24 requires the broken
   * row to be removable. Measured before the fix:
   *
   *   web route  404   (it resolved the target before calling core)
   *   CLI        exit 1, "task not found: <id>"
   *   core       raw ENOENT surfacing as a 500 with the file path
   *
   * The core and web halves were fixed with M2.5a. The CLI was not,
   * and a core fix only one surface can reach is not a fix — so this
   * asserts through the CLI specifically, which is the surface that
   * was still broken.
   *
   * The id is passed, not a key: a deleted task has no key to look up,
   * and the id is what the dangling edge actually stores.
   */
  it("removes an edge whose target was deleted", async () => {
    await withTmpLoctt(async ({ root }) => {
      await seed(root);
      // Capture the target's id before deleting it — afterwards there
      // is no task to resolve it from, which is the whole point.
      const before = await snapshot(root);
      const targetId = /target:\s*(\S+)/.exec(before)?.[1];
      expect(targetId, "seed should have written a relationship").toBeDefined();

      await runCli(["delete", "T-2", "--yes"], { cwd: root });

      const res = await runCli(
        ["unlink", "T-1", "blocks", String(targetId)],
        { cwd: root },
      );
      expect(res.exitCode, res.stderr).toBe(0);

      // The far end: the edge is gone from the file, not merely
      // reported as gone. Paired with the exit code deliberately — a
      // command that exits 0 and writes nothing would satisfy the
      // assertion above on its own.
      const after = await snapshot(root);
      expect(after).not.toContain(String(targetId));
      expect(after).not.toContain("blocks");
    });
  });
});
