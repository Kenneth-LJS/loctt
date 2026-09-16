import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { execaSync } from "execa";
import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

describe("MCP sync_from_git (stdio)", () => {
  it("syncs the loctt branch into local workspace", async () => {
    await withTmpLoctt(async ({ root }) => {
      execaSync("git", ["init"], { cwd: root });
      execaSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
      execaSync("git", ["config", "user.name", "test"], { cwd: root });
      execaSync("git", ["commit", "--allow-empty", "-m", "init"], { cwd: root });

      const enable = await runCli(["git", "enable"], { cwd: root });
      expect(enable.exitCode).toBe(0);

      const client = await startMcpClient(root);
      try {
        const result = await client.callTool("sync_from_git", {});
        expect(result.isError).toBeFalsy();
        expect(result.content[0]?.text ?? "").toMatch(/up to date|Synced/);
      } finally {
        await client.close();
      }
    });
  });

  // @verifies GIT-9
  it("auto-applies a rekey and reports old→new (K92 — MCP stays scriptable)", async () => {
    await withTmpLoctt(async ({ root }) => {
      execaSync("git", ["init"], { cwd: root });
      execaSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
      execaSync("git", ["config", "user.name", "test"], { cwd: root });
      execaSync("git", ["commit", "--allow-empty", "-m", "init"], { cwd: root });

      const locttDir = join(root, ".loctt");
      expect((await runCli(["git", "enable"], { cwd: root })).exitCode).toBe(0);
      expect((await runCli(["create", "base"], { cwd: root })).exitCode).toBe(0);
      expect((await runCli(["git", "publish"], { cwd: root })).exitCode).toBe(0);

      // A local offline task (T-2), then a branch task colliding on T-2 with
      // an earlier created_at, so the branch keeps the key and the local
      // task is renumbered.
      const created = await runCli(["create", "local next"], { cwd: root });
      expect(created.exitCode).toBe(0);
      const key = /Created (\S+):/.exec(created.stdout)?.[1] ?? "";
      // Find the local task's dir + pin its created_at later.
      const tasksDir = join(locttDir, "tasks");
      const { readdir } = await import("node:fs/promises");
      const ids = await readdir(tasksDir);
      for (const id of ids) {
        const p = join(tasksDir, id, "task.md");
        const raw = await readFile(p, "utf8");
        if (new RegExp(`^key: ${key}$`, "m").test(raw)) {
          await writeFile(p, raw.replace(/^created_at: .*$/m, "created_at: 2099-01-01T00:00:00.000Z"));
        }
      }
      // Read the project id from state, then commit the colliding task on the
      // branch via a worktree.
      const wt = join(root, ".wt-mcp-rekey");
      execaSync("git", ["worktree", "add", "-q", wt, "loctt"], { cwd: root });
      const projectId = /project:\s*(\S+)/.exec(
        await readFile(join(tasksDir, ids[0] as string, "task.md"), "utf8"),
      )?.[1] ?? "";
      const otherId = "01MCPBRANCHREKEY00000000A";
      await mkdir(join(wt, "tasks", otherId), { recursive: true });
      await writeFile(
        join(wt, "tasks", otherId, "task.md"),
        `---\nid: ${otherId}\nkey: ${key}\ntitle: Branch\nstatus: todo\n`
        + `project: ${projectId}\ncreated_at: 2020-01-01T00:00:00.000Z\n`
        + "updated_at: 2020-01-01T00:00:00.000Z\n---\nbody\n",
      );
      execaSync("git", ["add", "-A"], { cwd: wt });
      execaSync("git", ["commit", "-m", "colliding branch task"], { cwd: wt });
      execaSync("git", ["worktree", "remove", "--force", wt], { cwd: root });

      const client = await startMcpClient(root);
      try {
        const result = await client.callTool("sync_from_git", {});
        expect(result.isError).toBeFalsy();
        const out = result.content[0]?.text ?? "";
        // MCP auto-applies (no confirm) and names the renumber old → new.
        expect(out).toMatch(/Renumbered \d+ task\(s\) to resolve key collisions:/);
        expect(out).toMatch(new RegExp(`${key} → \\S+`));
      } finally {
        await client.close();
      }
    });
  });
});
