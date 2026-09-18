import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * A task's health travels through the CLI/MCP list surfaces, and an
 * object-fatal task is attributed unreadable — not silently dropped and
 * not "not found". Mirrors the web list (DEG-23 wire shape, ERR-9 row
 * count).
 *
 * Two kinds of corruption, exercised together on a three-task tracker:
 *   - field-local (a wrong-typed `estimate`): the task still lists, but
 *     its row is marked so it does not pass as healthy.
 *   - object-fatal (unparseable YAML): the task cannot be a row at all,
 *     so it is named in a trailer (CLI) / `unreadable[]` list (MCP).
 *
 * The `list_tasks` MCP tool used to load with the plain `loadAllTasks`,
 * which drops the unreadable list entirely — a corpus of three read as
 * one with nothing said. The CLI `list` did the same.
 *
 * @verifies DEG-C1
 */
describe("task health and unreadable tasks travel through CLI/MCP list", () => {
  /** Adds a wrong-typed `estimate` (field-local) to the named task. */
  const fieldCorrupt = async (root: string, key: string): Promise<void> => {
    const file = await taskFileForKey(root, key);
    const before = await readFile(file, "utf-8");
    const after = before.replace(/^key: .*$/m, m => `${m}\nestimate:\n  - not\n  - a\n  - number`);
    expect(after).not.toBe(before);
    await writeFile(file, after, "utf-8");
  };

  /** Makes the named task's YAML unparseable (object-fatal). */
  const objectFatal = async (root: string, key: string): Promise<string> => {
    const file = await taskFileForKey(root, key);
    const before = await readFile(file, "utf-8");
    const after = before.replace(/^title: (.*)$/m, 'title: "$1');
    expect(after).not.toBe(before);
    await writeFile(file, after, "utf-8");
    return file;
  };

  const taskFileForKey = async (root: string, key: string): Promise<string> => {
    const dir = path.join(root, ".loctt/tasks");
    for (const id of await readdir(dir)) {
      const file = path.join(dir, id, "task.md");
      if ((await readFile(file, "utf-8")).includes(`key: ${key}\n`)) return file;
    }
    throw new Error(`no task file for ${key}`);
  };

  const seed = async (root: string): Promise<void> => {
    await runCli(["create", "healthy"], { cwd: root });
    await runCli(["create", "field local"], { cwd: root });
    await runCli(["create", "object fatal"], { cwd: root });
    await fieldCorrupt(root, "T-2");
  };

  it("loctt list marks the field-local row and names the unreadable file", async () => {
    await withTmpLoctt(async ({ root }) => {
      await seed(root);
      const file = await objectFatal(root, "T-3");

      const res = await runCli(["list"], { cwd: root });
      const out = `${res.stdout}${res.stderr}`;
      // The readable rows are a valid answer; exit stays 0.
      expect(res.exitCode).toBe(0);
      // Healthy row present; field-local row present AND marked.
      expect(res.stdout).toMatch(/T-1\s+healthy/);
      expect(res.stdout).toMatch(/⚠.*T-2/);
      // Object-fatal task named in the trailer, never dropped, never
      // rendered as a row.
      expect(out).toContain(file);
      expect(out).toMatch(/could not be read/);
      expect(out).not.toMatch(/T-3\s+object fatal/);
    });
  });

  it("loctt list leaves a clean tracker's output unmarked", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "one"], { cwd: root });
      const res = await runCli(["list"], { cwd: root });
      expect(res.exitCode).toBe(0);
      expect(res.stdout).not.toMatch(/⚠/);
      expect(`${res.stdout}${res.stderr}`).not.toMatch(/could not be read/);
    });
  });

  it("MCP list_tasks marks the corrupt row and reports the unreadable list", async () => {
    await withTmpLoctt(async ({ root }) => {
      await seed(root);
      const file = await objectFatal(root, "T-3");

      const client = await startMcpClient(root);
      try {
        const res = await client.callTool("list_tasks", {});
        const parsed = JSON.parse(res.content[0]?.text ?? "{}") as {
          tasks?: { key: string; health?: boolean }[];
          unreadable?: { path: string }[];
        };
        expect(res.isError).toBeFalsy();
        const rows = parsed.tasks ?? [];
        // The field-local corrupt row carries the health flag.
        expect(rows.find(r => r.key === "T-2")?.health).toBe(true);
        // The healthy row does not.
        expect(rows.find(r => r.key === "T-1")?.health).toBeUndefined();
        // The object-fatal task is in unreadable[], not "not found",
        // not silently dropped.
        expect(parsed.unreadable?.some(u => u.path === file)).toBe(true);
      } finally {
        await client.close();
      }
    });
  });

  it("MCP list_tasks returns a plain array (no unreadable) for a clean tracker", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "one"], { cwd: root });
      const client = await startMcpClient(root);
      try {
        const res = await client.callTool("list_tasks", {});
        const parsed = JSON.parse(res.content[0]?.text ?? "[]") as unknown;
        // Clean tracker keeps the bare-array shape — no envelope.
        expect(Array.isArray(parsed)).toBe(true);
        expect((parsed as { health?: boolean }[])[0]?.health).toBeUndefined();
      } finally {
        await client.close();
      }
    });
  });
});
