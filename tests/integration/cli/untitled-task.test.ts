import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * An untitled task shows its key where the title would go, on the CLI and
 * MCP — never a blank, never "undefined". Mirrors the web (DEG-8), which
 * renders `task.title ?? task.key`.
 *
 * A title is degradable (K26 — only `id`/`key` are object-fatal), so a
 * task can legitimately have none: never set, or a wrong-typed value
 * lifted whole into `health`. This test removes the `title:` line, which
 * yields a task that parses (valid YAML, present id/key) but carries no
 * title — the field-absent half of the case. The corrupt-title half is
 * covered by the frontmatter/health unit tests; here we assert the
 * surface renders the key rather than a blank either way.
 *
 * @verifies DEG-C2
 */
describe("an untitled task shows its key on the CLI and MCP, never a blank", () => {
  /** Strips the `title:` frontmatter line from the single task on disk. */
  const stripTitle = async (root: string): Promise<void> => {
    const dir = path.join(root, ".loctt/tasks");
    const [id] = (await readdir(dir)).sort();
    const file = path.join(dir, id ?? "", "task.md");
    const before = await readFile(file, "utf-8");
    const after = before.replace(/^title:.*$\n/m, "");
    expect(after).not.toBe(before);
    await writeFile(file, after, "utf-8");
  };

  it("loctt list prints the key where an absent title would go", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "temporary"], { cwd: root });
      await stripTitle(root);

      const res = await runCli(["list"], { cwd: root });
      expect(res.exitCode).toBe(0);
      // The key stands in for the title — never a blank, never the string
      // "undefined". A doubled key ("T-1  T-1") is exactly the fallback.
      expect(res.stdout).toMatch(/T-1\s+T-1/);
      expect(res.stdout).not.toMatch(/undefined/);
    });
  });

  it("loctt show prints the key in the header title slot", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "temporary"], { cwd: root });
      await stripTitle(root);

      const res = await runCli(["show", "T-1"], { cwd: root });
      expect(res.exitCode).toBe(0);
      // Header is `<key>: <title>`; with no title the title slot is the key.
      expect(res.stdout).toMatch(/^T-1: T-1/m);
      expect(res.stdout).not.toMatch(/undefined/);
      expect(res.stdout).not.toMatch(/\(no title\)/);
    });
  });

  it("MCP get_task returns the key as title, never null/absent", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "temporary"], { cwd: root });
      await stripTitle(root);

      const client = await startMcpClient(root);
      try {
        const res = await client.callTool("get_task", { ref: "T-1" });
        const parsed = JSON.parse(res.content[0]?.text ?? "{}") as { title?: unknown };
        expect(parsed.title).toBe("T-1");
      } finally {
        await client.close();
      }
    });
  });

  it("MCP list_tasks returns the key as title, never null/absent", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "temporary"], { cwd: root });
      await stripTitle(root);

      const client = await startMcpClient(root);
      try {
        const res = await client.callTool("list_tasks", {});
        const parsed = JSON.parse(res.content[0]?.text ?? "[]") as
          | { title?: unknown }[]
          | { tasks: { title?: unknown }[] };
        const rows = Array.isArray(parsed) ? parsed : parsed.tasks;
        expect(rows[0]?.title).toBe("T-1");
      } finally {
        await client.close();
      }
    });
  });
});
