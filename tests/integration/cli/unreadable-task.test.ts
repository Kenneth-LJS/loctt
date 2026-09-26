import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * A task.md that will not parse, asked for by key, through the real
 * CLI binary and the real MCP stdio server.
 *
 * `loctt show T-1` printed `Error: task not found: "T-1"` with the
 * file sitting on disk — ERR-1's prohibition, that a failure and an
 * absence must not look alike. The lookup is shared, so MCP said the
 * same thing through `get_task`. TSK-54 sets what they must say
 * instead: could not be parsed, the path under `.loctt/tasks/<id>/`,
 * and the line or field.
 *
 * Both surfaces are asserted here rather than only core, because a
 * core capability is not done until CLI and MCP carry it, and because
 * each surface has its own rendering step that can drop the message —
 * MCP in particular had to classify the new error as a domain error or
 * it would have surfaced as an opaque server fault instead.
 *
 * @verifies TSK-54
 * @verifies XS-51
 * @verifies ERR-1
 */
describe("an unreadable task.md is reported as unreadable, not as missing", () => {
  /** The path of the single task's file, and its parent directory id. */
  const taskFile = async (root: string): Promise<string> => {
    const dir = path.join(root, ".loctt/tasks");
    const [id] = (await readdir(dir)).sort();
    return path.join(dir, id ?? "", "task.md");
  };

  /**
   * Corrupts the frontmatter the way a hand edit does — an unclosed
   * quote. The `yaml` package names the line and the column, which is
   * the actionable detail TSK-54 asks for.
   */
  const corrupt = async (root: string): Promise<string> => {
    const file = await taskFile(root);
    const before = await readFile(file, "utf-8");
    const after = before.replace(/^title: (.*)$/m, 'title: "$1');
    expect(after).not.toBe(before);
    await writeFile(file, after, "utf-8");
    return file;
  };

  it("loctt show names the file and the parse line, never 'task not found'", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "corrupt me"], { cwd: root });
      const file = await corrupt(root);

      const res = await runCli(["show", "T-1"], { cwd: root });
      const out = `${res.stdout}${res.stderr}`;

      expect(res.exitCode).not.toBe(0);
      // ERR-1: the exact sentence that told the user their task was
      // gone while the file was on disk.
      expect(out).not.toMatch(/task not found/i);
      // TSK-54: the path under .loctt/tasks/<id>/, and the line.
      expect(out).toContain(file);
      expect(out).toMatch(/line \d+/);
      // A348: named once. `readTask`'s own message leads with the path
      // and the headline names it again unless the reason is unwrapped.
      expect(out.split(file).length - 1).toBe(1);
    });
  });

  // A348: `loctt list` prints each unreadable row as `path: reason`.
  // The reason used to be `readTask`'s message, which already led with
  // the path, so every row said the path twice.
  it("loctt list names the unreadable file exactly once on stderr", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "corrupt me"], { cwd: root });
      const file = await corrupt(root);

      const res = await runCli(["list"], { cwd: root });

      expect(res.stderr).toContain(file);
      expect(res.stderr).toMatch(/line \d+/);
      expect(res.stderr.split(file).length - 1).toBe(1);
    });
  });

  it("loctt show still says not found for a key that genuinely does not exist", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "perfectly fine"], { cwd: root });

      const res = await runCli(["show", "T-99"], { cwd: root });
      const out = `${res.stdout}${res.stderr}`;

      // The inverse conflation: absence must stay absence. Every file
      // here parses, so there is nothing to be uncertain about.
      expect(res.exitCode).not.toBe(0);
      expect(out).toMatch(/task not found/i);
    });
  });

  it("MCP get_task returns an actionable tool error, not a server fault", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "corrupt me"], { cwd: root });
      const file = await corrupt(root);

      const client = await startMcpClient(root);
      try {
        const res = await client.callTool("get_task", { ref: "T-1" });
        const text = res.content[0]?.text ?? "";

        // A domain error the agent can act on and relay, rather than
        // an unhandled throw the MCP framework reports as a fault.
        expect(res.isError).toBe(true);
        expect(text).not.toMatch(/task not found/i);
        expect(text).toContain(file);
        expect(text).toMatch(/line \d+/);
        // A348: named once on MCP too.
        expect(text.split(file).length - 1).toBe(1);
      } finally {
        await client.close();
      }
    });
  });

  it("one corrupt task does not stop the CLI reading its neighbours", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "corrupt me"], { cwd: root });
      await runCli(["create", "perfectly fine"], { cwd: root });

      // Corrupt T-1 specifically, leaving T-2 intact.
      const dir = path.join(root, ".loctt/tasks");
      for (const id of await readdir(dir)) {
        const file = path.join(dir, id, "task.md");
        const before = await readFile(file, "utf-8");
        if (!before.includes("key: T-1")) continue;
        await writeFile(file, before.replace(/^title: (.*)$/m, 'title: "$1'), "utf-8");
      }

      // P-11: leniency keeps, never destroys. A bad neighbour must not
      // make a healthy task unreadable.
      const res = await runCli(["show", "T-2"], { cwd: root });
      expect(res.exitCode).toBe(0);
      expect(res.stdout).toContain("perfectly fine");
    });
  });
});
