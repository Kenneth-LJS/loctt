import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { startMcpClient } from "../adapters/mcp-stdio.js";
import { removeTaskOutOfBand, withTmpLoctt } from "../fixtures/tmp-loctt.js";

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

      // Out of band: `loctt delete` now removes the source's edge too (K147).
      await removeTaskOutOfBand(root, "T-2");

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

  /**
   * @verifies REL-24
   *
   * **A retired key cannot be resolved once its task is deleted**, and
   * the message must say so rather than deny the edge exists.
   *
   * The key index is rebuilt from live task files, so a deleted task's
   * `key` and `key_history` are gone with it. Core then reported
   * "relationship blocks -> T-2 does not exist on task <id>", which is
   * false — the edge exists under the id the file stores. Found by the
   * M2 gate (F7).
   */
  it("explains an unresolvable target instead of denying the edge", async () => {
    await withTmpLoctt(async ({ root }) => {
      await seed(root);
      // Out of band: `loctt delete` now removes the source's edge too (K147).
      await removeTaskOutOfBand(root, "T-2");

      const res = await runCli(["unlink", "T-1", "blocks", "T-2"], { cwd: root });
      expect(res.exitCode).not.toBe(0);

      // Not "does not exist" — that was the lie.
      expect(res.stderr).not.toMatch(/does not exist on task/);
      expect(res.stderr).toMatch(/could not be resolved/);

      // And it hands over the id that works, rather than leaving the
      // user to find it. Asserted by USING it, not by matching a
      // shape: a message naming a wrong id would pass a regex.
      const suggested = /\b(01[A-Z0-9]{24})\b/.exec(res.stderr)?.[1];
      expect(suggested, res.stderr).toBeDefined();
      const second = await runCli(
        ["unlink", "T-1", "blocks", String(suggested)],
        { cwd: root },
      );
      expect(second.exitCode, second.stderr).toBe(0);

      // The far end: the edge is gone from the file.
      expect(await snapshot(root)).not.toContain("blocks");
    });
  });
});

/**
 * @verifies REL-C9
 *
 * G1: a link stored as a key more than one task has held. The repair
 * keeps it (A357 7) and doctor reported it, but every surface resolved
 * the key to one holder's id first, so `unlink` answered "does not
 * exist" on CLI and MCP alike and the link could not be removed.
 */
describe("unlink removes a link stored as an ambiguous key", () => {
  const taskFile = async (root: string, key: string): Promise<string> => {
    const dir = path.join(root, ".loctt/tasks");
    const { readdir } = await import("node:fs/promises");
    for (const id of await readdir(dir)) {
      const file = path.join(dir, id, "task.md");
      if ((await readFile(file, "utf-8")).includes(`\nkey: ${key}\n`)) return file;
    }
    throw new Error(`no task file for ${key}`);
  };

  /** T-1 stores `relates_to: T-2`; T-2 holds T-2 and T-3 once held it too. */
  const seed = async (root: string): Promise<string> => {
    const { writeFile } = await import("node:fs/promises");
    await runCli(["create", "source"], { cwd: root });
    await runCli(["create", "holder"], { cwd: root });
    await runCli(["create", "former holder"], { cwd: root });
    const former = await taskFile(root, "T-3");
    await writeFile(former, (await readFile(former, "utf-8"))
      .replace("\nkey: T-3\n", "\nkey: T-3\nkey_history:\n  - T-2\n"), "utf-8");
    const source = await taskFile(root, "T-1");
    await writeFile(source, (await readFile(source, "utf-8"))
      .replace("\nkey: T-1\n", "\nkey: T-1\nrelationships:\n  - type: relates_to\n    target: T-2\n"), "utf-8");
    return source;
  };

  it("through the CLI", async () => {
    await withTmpLoctt(async ({ root }) => {
      const source = await seed(root);
      const doctor = await runCli(["doctor"], { cwd: root });
      expect(doctor.stdout).toMatch(/more than one task has had/);
      expect(doctor.stdout).toMatch(/Remove this link, then link the right task/);

      const res = await runCli(["unlink", "T-1", "relates_to", "T-2"], { cwd: root });
      expect(res.exitCode, res.stderr).toBe(0);
      expect(await readFile(source, "utf-8")).not.toMatch(/relationships:/);
    });
  });

  it("through MCP", async () => {
    await withTmpLoctt(async ({ root }) => {
      const source = await seed(root);
      const client = await startMcpClient(root);
      try {
        const res = await client.callTool("unlink_tasks", { ref: "T-1", type: "relates_to", target: "T-2" });
        expect(res.isError, res.content[0]?.text).toBeFalsy();
      } finally {
        await client.close();
      }
      expect(await readFile(source, "utf-8")).not.toMatch(/relationships:/);
    });
  });
});
