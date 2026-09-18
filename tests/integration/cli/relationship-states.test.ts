import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * The CLI/MCP relationship display distinguishes the four target states
 * core resolves and the web renders (DEG-15):
 *   1. healthy               — resolved, no marker
 *   2. corrupt-but-present   — resolved, field-local health, marked ⚠
 *   3. corrupt-unreadable    — on disk, object-fatally unreadable → "corrupt"
 *   4. absent/deleted        — no task at all → "deleted"
 *
 * Before this the CLI collapsed all four into missing-vs-healthy: an
 * unreadable target rendered identically to a deleted one (telling the
 * user a file that exists was removed), and a corrupt-but-present target
 * passed as an ordinary healthy row.
 *
 * A source task (T-1) links to one target of each kind (T-2..T-5).
 *
 * @verifies DEG-C5
 */
describe("CLI/MCP relationship display mirrors the four target states", () => {
  const taskFileForKey = async (root: string, key: string): Promise<string> => {
    const dir = path.join(root, ".loctt/tasks");
    for (const id of await readdir(dir)) {
      const file = path.join(dir, id, "task.md");
      if ((await readFile(file, "utf-8")).includes(`key: ${key}\n`)) return file;
    }
    throw new Error(`no task file for ${key}`);
  };

  /** Field-local corruption: a wrong-typed estimate. Task still resolves. */
  const fieldCorrupt = async (root: string, key: string): Promise<void> => {
    const file = await taskFileForKey(root, key);
    const before = await readFile(file, "utf-8");
    await writeFile(file, before.replace(/^key: .*$/m, m => `${m}\nestimate:\n  - bad`), "utf-8");
  };

  /** Object-fatal: unparseable YAML. Task is on disk but unreadable. */
  const objectFatal = async (root: string, key: string): Promise<void> => {
    const file = await taskFileForKey(root, key);
    const before = await readFile(file, "utf-8");
    await writeFile(file, before.replace(/^title: (.*)$/m, 'title: "$1'), "utf-8");
  };

  const seed = async (root: string): Promise<void> => {
    await runCli(["create", "source"], { cwd: root });      // T-1
    await runCli(["create", "healthy"], { cwd: root });     // T-2
    await runCli(["create", "corrupt present"], { cwd: root }); // T-3
    await runCli(["create", "unreadable"], { cwd: root });  // T-4
    await runCli(["create", "will delete"], { cwd: root }); // T-5
    await runCli(["link", "T-1", "blocks", "T-2"], { cwd: root });
    await runCli(["link", "T-1", "blocks", "T-3"], { cwd: root });
    await runCli(["link", "T-1", "blocks", "T-4"], { cwd: root });
    await runCli(["link", "T-1", "blocks", "T-5"], { cwd: root });
    // Now corrupt / delete the targets. Order matters: delete last so the
    // links exist first.
    await fieldCorrupt(root, "T-3");
    await objectFatal(root, "T-4");
    await runCli(["delete", "T-5", "--yes"], { cwd: root });
  };

  it("loctt show T-1 marks corrupt-present, corrupt-unreadable and deleted apart", async () => {
    await withTmpLoctt(async ({ root }) => {
      await seed(root);
      const res = await runCli(["show", "T-1"], { cwd: root });
      expect(res.exitCode).toBe(0);
      const lines = res.stdout.split("\n").filter(l => l.includes("blocks →"));
      const joined = lines.join("\n");

      // 1. healthy → resolved key, no ⚠, no "corrupt"/"deleted" tag.
      const healthy = lines.find(l => l.includes("T-2"));
      expect(healthy).toBeDefined();
      expect(healthy).not.toMatch(/⚠|corrupt|deleted/);

      // 2. corrupt-but-present → resolved key, marked ⚠, not "deleted".
      const present = lines.find(l => l.includes("T-3"));
      expect(present).toMatch(/⚠/);
      expect(present).not.toMatch(/deleted/);

      // 3. corrupt-unreadable → marked "corrupt", NOT "deleted".
      expect(joined).toMatch(/corrupt/);
      // 4. absent/deleted → marked "deleted".
      expect(joined).toMatch(/deleted/);

      // corrupt and deleted are distinct lines, not the same rendering.
      const corruptLine = lines.find(l => /corrupt/.test(l) && !/T-3/.test(l));
      const deletedLine = lines.find(l => /deleted/.test(l));
      expect(corruptLine).toBeDefined();
      expect(deletedLine).toBeDefined();
      expect(corruptLine).not.toBe(deletedLine);
    });
  });

  it("MCP get_task carries targetCorrupt on the corrupt edges, missing on the gone ones", async () => {
    await withTmpLoctt(async ({ root }) => {
      await seed(root);
      const client = await startMcpClient(root);
      try {
        const res = await client.callTool("get_task", { ref: "T-1" });
        const parsed = JSON.parse(res.content[0]?.text ?? "{}") as {
          relationships?: { target: string; missing?: boolean; targetCorrupt?: boolean }[];
        };
        const rels = parsed.relationships ?? [];

        // 1. healthy: resolved key, neither flag.
        const healthy = rels.find(r => r.target === "T-2");
        expect(healthy).toBeDefined();
        expect(healthy?.missing).toBeUndefined();
        expect(healthy?.targetCorrupt).toBeUndefined();

        // 2. corrupt-but-present: resolved key (T-3), targetCorrupt, NOT missing.
        const present = rels.find(r => r.target === "T-3");
        expect(present?.targetCorrupt).toBe(true);
        expect(present?.missing).toBeUndefined();

        // The two gone-from-this-task edges (unreadable, deleted) both
        // carry missing; exactly one of them is corrupt (unreadable).
        const gone = rels.filter(r => r.missing === true);
        expect(gone.length).toBe(2);
        expect(gone.filter(r => r.targetCorrupt === true).length).toBe(1);
        expect(gone.filter(r => r.targetCorrupt === undefined).length).toBe(1);
      } finally {
        await client.close();
      }
    });
  });
});
