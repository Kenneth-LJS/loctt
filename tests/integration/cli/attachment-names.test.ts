import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * @verifies REL-C4
 *
 * `loctt detach` rejected any name containing two consecutive dots,
 * using a hand-rolled `includes("..")` rather than core's guard. So
 * `notes..txt` could be attached and then never removed — a file the
 * user creates through a supported path and cannot delete through one.
 *
 * Traversal is about a `..` path *segment*, which is what
 * `assertSafeBasename` tests, and what MCP's `detach_file` already used.
 * The CLI was the only surface that disagreed.
 */

const sources: string[] = [];

afterEach(async () => {
  while (sources.length > 0) {
    const s = sources.pop();
    if (s) await rm(s, { recursive: true, force: true });
  }
});

/** Writes `name` into a scratch dir and returns its absolute path. */
async function sourceFile(name: string, body = "hello"): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "loctt-attach-"));
  sources.push(dir);
  const file = path.join(dir, name);
  await writeFile(file, body, "utf8");
  return file;
}

describe("attachment names (spawned binary)", () => {
  it("detaches a name containing consecutive dots", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "t1"], { cwd: root });
      const src = await sourceFile("notes..txt");

      const attach = await runCli(["attach", "T-1", src], { cwd: root });
      expect(attach.exitCode).toBe(0);

      const detach = await runCli(["detach", "T-1", "notes..txt"], { cwd: root });
      // The bug: attach accepted it, detach refused it, and the file
      // was unreachable from the CLI thereafter.
      expect(`${detach.stdout}${detach.stderr}`).not.toMatch(/plain basename/);
      expect(detach.exitCode).toBe(0);
    });
  });

  it("refuses a name with a path separator, naming the rule", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "t1"], { cwd: root });
      for (const bad of ["a/b.txt", "a\\b.txt"]) {
        const result = await runCli(["detach", "T-1", bad], { cwd: root });
        expect(result.exitCode).not.toBe(0);
        expect(`${result.stdout}${result.stderr}`).toMatch(/path separator/i);
      }
    });
  });

  it("refuses a name that is exactly `..`", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "t1"], { cwd: root });
      const result = await runCli(["detach", "T-1", ".."], { cwd: root });
      expect(result.exitCode).not.toBe(0);
      expect(`${result.stdout}${result.stderr}`).toMatch(/"\."|'\.'|\.\./);
    });
  });

  it("accepts and refuses the identical set through MCP", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "t1"], { cwd: root });
      const src = await sourceFile("notes..txt");
      await runCli(["attach", "T-1", src], { cwd: root });

      const client = await startMcpClient(root);
      try {
        const ok = await client.callTool("detach_file", { ref: "T-1", name: "notes..txt" });
        expect(ok.isError).toBeFalsy();

        for (const bad of ["a/b.txt", ".."]) {
          const refused = await client.callTool("detach_file", { ref: "T-1", name: bad });
          expect(refused.isError).toBe(true);
        }
      } finally {
        await client.close();
      }
    });
  });

  /**
   * @verifies REL-C5
   *
   * The case asks for a 300-character basename. That file cannot be
   * created: macOS (and Linux) cap a single path component at 255
   * bytes, so the *source* would have to exist first and cannot. A
   * 255-character name attaches successfully — verified — so there is
   * no reachable ENAMETOOLONG through the CLI on this platform.
   *
   * What is testable, and what the case actually protects, is the
   * handling: a filesystem refusal must not surface as a raw errno and
   * must not leave a partial file behind. That is asserted directly
   * against the core function in
   * packages/core/src/task/attachments.test.ts.
   */
  it("attaches a maximum-length filename without error or partial file", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "t1"], { cwd: root });
      // 251 + ".txt" = 255, the longest a filesystem component allows.
      const name = `${"a".repeat(251)}.txt`;
      const src = await sourceFile(name, "body");

      const result = await runCli(["attach", "T-1", src], { cwd: root });
      expect(result.exitCode).toBe(0);
      // No raw errno leaked on the path that does succeed.
      expect(`${result.stdout}${result.stderr}`).not.toMatch(/ENAMETOOLONG/);

      const taskDirs = await readdir(path.join(root, ".loctt/tasks"));
      const first = taskDirs[0];
      expect(first).toBeDefined();
      const attached = await readdir(
        path.join(root, ".loctt/tasks", first as string, "attachments"),
      );
      expect(attached).toContain(name);
    });
  });
});
