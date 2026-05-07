import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

describe("CLI attach (spawned binary)", () => {
  it("copies a file into the task's attachments directory", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "task with attachment"], { cwd: root });

      const srcDir = await mkdtemp(path.join(root, "src-"));
      const sourcePath = path.join(srcDir, "notes.txt");
      const content = "hello attachment\n";
      await writeFile(sourcePath, content, "utf8");

      const result = await runCli(["attach", "T-1", sourcePath], { cwd: root });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Attached notes.txt");
      expect(result.stdout).toContain("T-1");
      expect(result.stdout).toMatch(/\d+ bytes/);

      // Verify the file landed under .loctt/tasks/<id>/attachments/<name>.
      const list = await runCli(["show", "T-1"], { cwd: root });
      expect(list.stdout).toContain("notes.txt");

      await rm(srcDir, { recursive: true, force: true });
    });
  });

  it("rejects a duplicate attach without --force", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "dup task"], { cwd: root });

      const srcDir = await mkdtemp(path.join(root, "src-"));
      const sourcePath = path.join(srcDir, "doc.txt");
      await writeFile(sourcePath, "first\n", "utf8");

      const first = await runCli(["attach", "T-1", sourcePath], { cwd: root });
      expect(first.exitCode).toBe(0);

      const second = await runCli(["attach", "T-1", sourcePath], { cwd: root });
      expect(second.exitCode).not.toBe(0);
      expect(second.stderr).toContain("already exists");
      expect(second.stderr).toContain("--force");

      await rm(srcDir, { recursive: true, force: true });
    });
  });

  it("overwrites an existing attachment with --force", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "force task"], { cwd: root });

      const srcDir = await mkdtemp(path.join(root, "src-"));
      const sourcePath = path.join(srcDir, "doc.txt");
      await writeFile(sourcePath, "first\n", "utf8");
      const first = await runCli(["attach", "T-1", sourcePath], { cwd: root });
      expect(first.exitCode).toBe(0);

      await writeFile(sourcePath, "second content\n", "utf8");
      const second = await runCli(["attach", "T-1", sourcePath, "--force"], {
        cwd: root,
      });
      expect(second.exitCode).toBe(0);
      expect(second.stdout).toContain("overwrote existing");

      // Find the attached file via show output and verify size matches "second content\n".
      const show = await runCli(["show", "T-1"], { cwd: root });
      const match = show.stdout.match(/doc\.txt \((\d+) bytes\)/);
      expect(match).not.toBeNull();
      expect(Number(match![1])).toBe("second content\n".length);

      // Verify content on disk.
      // Locate the attachment by walking .loctt/tasks/*/attachments/doc.txt
      const tasksDir = path.join(root, ".loctt", "tasks");
      const { readdir } = await import("node:fs/promises");
      const entries = await readdir(tasksDir);
      let found: string | null = null;
      for (const id of entries) {
        const p = path.join(tasksDir, id, "attachments", "doc.txt");
        try {
          await stat(p);
          found = p;
          break;
        } catch {
          // not in this dir
        }
      }
      expect(found).not.toBeNull();
      const onDisk = await readFile(found!, "utf8");
      expect(onDisk).toBe("second content\n");

      await rm(srcDir, { recursive: true, force: true });
    });
  });

  it("show lists the attachment after attach", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "show task"], { cwd: root });

      const srcDir = await mkdtemp(path.join(root, "src-"));
      const sourcePath = path.join(srcDir, "report.md");
      await writeFile(sourcePath, "# report\n", "utf8");

      const r = await runCli(["attach", "T-1", sourcePath], { cwd: root });
      expect(r.exitCode).toBe(0);

      const show = await runCli(["show", "T-1"], { cwd: root });
      expect(show.stdout).toContain("Attachments:");
      expect(show.stdout).toContain("report.md");

      await rm(srcDir, { recursive: true, force: true });
    });
  });
});
