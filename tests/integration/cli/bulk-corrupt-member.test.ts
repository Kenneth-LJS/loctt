import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * A bulk op over a corrupt member reports it correctly: an object-fatal
 * (on-disk unreadable) member lands in `failed` as failed-because-
 * unreadable — naming the path — distinct from "not found" (a genuinely
 * absent ref) and from `unchanged` (a no-op, K25/BLK-27). The rest of the
 * batch proceeds.
 *
 * A field-local-corrupt member is NOT a failure: a `set` repairs the
 * field (DEG-4), so it lands in the succeeded set — the corruption does
 * not exclude a task that is still identifiable. (The per-item *refusal*
 * of a derived op — CorruptFieldError in `failed` — is exercised by
 * corrupt-field-ops.test.ts / DEG-C4 on the single-item link path, which
 * is the only derived op the CLI/MCP expose per task; the exposed bulk
 * ops set/unset/archive/move repair or preserve rather than refuse.)
 *
 * Existing bulk tests use dangling refs, not an on-disk object-fatal
 * member — this is that gap.
 *
 * @verifies DEG-C8
 */
describe("a bulk op reports an object-fatal member as failed-because-unreadable", () => {
  const taskFileForKey = async (root: string, key: string): Promise<string> => {
    const dir = path.join(root, ".loctt/tasks");
    for (const id of await readdir(dir)) {
      const file = path.join(dir, id, "task.md");
      if ((await readFile(file, "utf-8")).includes(`key: ${key}\n`)) return file;
    }
    throw new Error(`no task file for ${key}`);
  };

  const fieldCorrupt = async (root: string, key: string): Promise<void> => {
    const file = await taskFileForKey(root, key);
    const before = await readFile(file, "utf-8");
    await writeFile(file, before.replace(/^key: .*$/m, m => `${m}\nestimate:\n  - bad`), "utf-8");
  };

  const objectFatal = async (root: string, key: string): Promise<string> => {
    const file = await taskFileForKey(root, key);
    const before = await readFile(file, "utf-8");
    await writeFile(file, before.replace(/^title: (.*)$/m, 'title: "$1'), "utf-8");
    return file;
  };

  /** T-1 healthy, T-2 field-local corrupt, T-3 object-fatal. */
  const seed = async (root: string): Promise<string> => {
    await runCli(["create", "healthy"], { cwd: root });
    await runCli(["create", "field local"], { cwd: root });
    await runCli(["create", "object fatal"], { cwd: root });
    await fieldCorrupt(root, "T-2");
    return objectFatal(root, "T-3");
  };

  it("CLI bulk set: object-fatal member fails with its path, field-local is repaired, healthy succeeds", async () => {
    await withTmpLoctt(async ({ root }) => {
      const fatalPath = await seed(root);

      const res = await runCli(["set", "T-1,T-2,T-3", "status", "backlog"], { cwd: root });
      const out = `${res.stdout}${res.stderr}`;
      // The batch processed; the object-fatal member fails, exit non-zero.
      expect(res.exitCode).not.toBe(0);
      // Two succeed (healthy + field-local repaired), one fails.
      expect(res.stdout).toMatch(/2 task/);
      // The failure names the unreadable file, and is NOT phrased as a
      // bare "task not found" (the dangling-ref message).
      expect(out).toContain(fatalPath);
      expect(out).toMatch(/could (not )?be read|could not read/i);
      // The T-3 failure line does not read as a plain "not found".
      const t3line = out.split("\n").find(l => l.includes("T-3"));
      expect(t3line).toBeDefined();
      expect(t3line).not.toBe("  T-3: task not found");
    });
  });

  it("CLI bulk set: a genuinely-absent ref still reads as 'not found', distinct from unreadable", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "healthy"], { cwd: root });
      const res = await runCli(["set", "T-1,T-99", "status", "backlog"], { cwd: root });
      const out = `${res.stdout}${res.stderr}`;
      expect(res.exitCode).not.toBe(0);
      // The absent ref is "not found" — every file here parses, so there
      // is no unreadable-file uncertainty to report.
      expect(out).toMatch(/T-99:\s*Task not found/i);
      expect(out).not.toMatch(/could (not )?be read|could not read/i);
    });
  });

  it("MCP bulk_update_tasks: object-fatal member lands in failed with its path", async () => {
    await withTmpLoctt(async ({ root }) => {
      const fatalPath = await seed(root);

      const client = await startMcpClient(root);
      try {
        const res = await client.callTool("bulk_update_tasks", {
          refs: ["T-1", "T-2", "T-3"],
          field: "status",
          value: "backlog",
        });
        const out = res.content[0]?.text ?? "";
        // 2 updated (healthy + repaired field-local), 1 failed.
        expect(out).toMatch(/2 updated, 1 failed/);
        // The failure names the unreadable path, not "not found".
        expect(out).toContain(fatalPath);
        expect(out).toMatch(/could (not )?be read|could not read/i);
      } finally {
        await client.close();
      }
    });
  });
});
