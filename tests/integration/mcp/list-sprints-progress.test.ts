import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * MCP `list_sprints` with `progress: true` (F1 / K30 parity).
 *
 * Mirrors `list_milestones` progress: opt-in done/total per sprint,
 * computed from status CATEGORY with discarded tasks excluded from the
 * denominator, and an `unreadable` list when a task file cannot be read.
 */
describe("MCP list_sprints progress (stdio)", () => {
  async function seed(root: string): Promise<string> {
    await runCli(
      ["sprint", "create", "s1", "--start", "2026-01-01", "--end", "2026-01-14", "--state", "active"],
      { cwd: root },
    );
    const ids = await runCli(["sprint", "list", "--ids"], { cwd: root });
    return /\s(\w{26})/.exec(ids.stdout)![1]!;
  }

  async function task(root: string, title: string, sprint: string, status?: string) {
    const c = await runCli(["create", title], { cwd: root });
    const key = /Created\s+(\S+):/.exec(c.stdout)![1]!;
    await runCli(["set", key, "sprint", sprint], { cwd: root });
    if (status) await runCli(["set", key, "status", status], { cwd: root });
  }

  it("omits progress when not requested", async () => {
    await withTmpLoctt(async ({ root }) => {
      const id = await seed(root);
      await task(root, "a", id, "done");
      const client = await startMcpClient(root);
      try {
        const res = await client.callTool("list_sprints", {});
        const out = res.content[0]?.text ?? "";
        expect(out).not.toContain("progress");
      } finally {
        await client.close();
      }
    });
  });

  it("returns done/total per sprint when progress is true", async () => {
    await withTmpLoctt(async ({ root }) => {
      const id = await seed(root);
      await task(root, "shipped", id, "done");
      await task(root, "outstanding", id);
      const client = await startMcpClient(root);
      try {
        const res = await client.callTool("list_sprints", { progress: true });
        expect(res.isError).toBeFalsy();
        const parsed = JSON.parse(res.content[0]?.text ?? "{}") as {
          sprints: { id: string; progress?: { done: number; total: number } }[];
        };
        const s = parsed.sprints.find(x => x.id === id);
        expect(s?.progress?.done).toBe(1);
        expect(s?.progress?.total).toBe(2);
      } finally {
        await client.close();
      }
    });
  });

  it("reports an unreadable task rather than silently shortening the total", async () => {
    await withTmpLoctt(async ({ root }) => {
      const id = await seed(root);
      await task(root, "readable", id, "done");
      // Corrupt one task's frontmatter so it cannot be parsed. The
      // total must count only the readable corpus AND name the file.
      const { readdirSync, writeFileSync } = await import("node:fs");
      const { join } = await import("node:path");
      const tasksDir = join(root, ".loctt", "tasks");
      const dirs = readdirSync(tasksDir);
      writeFileSync(join(tasksDir, dirs[0]!, "task.md"), "---\n: : not: valid: yaml\n:::\n");

      const client = await startMcpClient(root);
      try {
        const res = await client.callTool("list_sprints", { progress: true });
        const parsed = JSON.parse(res.content[0]?.text ?? "{}") as {
          unreadable?: unknown[];
        };
        expect(Array.isArray(parsed.unreadable)).toBe(true);
        expect(parsed.unreadable?.length ?? 0).toBeGreaterThan(0);
      } finally {
        await client.close();
      }
    });
  });
});
