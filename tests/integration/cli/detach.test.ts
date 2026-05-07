import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

async function findAttachment(root: string, name: string): Promise<string | null> {
  const tasksDir = path.join(root, ".loctt", "tasks");
  const entries = await readdir(tasksDir);
  for (const id of entries) {
    const p = path.join(tasksDir, id, "attachments", name);
    try {
      await stat(p);
      return p;
    } catch {
      // not here
    }
  }
  return null;
}

describe("CLI detach (spawned binary)", () => {
  it("removes a previously attached file", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "detach happy"], { cwd: root });

      const srcDir = await mkdtemp(path.join(root, "src-"));
      const sourcePath = path.join(srcDir, "notes.txt");
      await writeFile(sourcePath, "bye\n", "utf8");

      const attach = await runCli(["attach", "T-1", sourcePath], { cwd: root });
      expect(attach.exitCode).toBe(0);
      expect(await findAttachment(root, "notes.txt")).not.toBeNull();

      const detach = await runCli(["detach", "T-1", "notes.txt"], { cwd: root });
      expect(detach.exitCode).toBe(0);
      expect(detach.stdout).toContain("Detached notes.txt");
      expect(detach.stdout).toContain("T-1");

      expect(await findAttachment(root, "notes.txt")).toBeNull();

      await rm(srcDir, { recursive: true, force: true });
    });
  });

  it("fails when the attachment does not exist", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "detach missing"], { cwd: root });

      const r = await runCli(["detach", "T-1", "ghost.txt"], { cwd: root });
      expect(r.exitCode).not.toBe(0);
      expect(r.stderr).toContain("not found");
    });
  });
});
