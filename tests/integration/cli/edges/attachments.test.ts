import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../../adapters/cli-spawn.js";
import { withTmpLoctt } from "../../fixtures/tmp-loctt.js";

describe("CLI attach/detach edge cases (spawned binary)", () => {
  it("rejects attaching a directory", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "t"], { cwd: root });

      const dirPath = path.join(root, "somedir");
      await mkdir(dirPath);

      const result = await runCli(["attach", "T-1", dirPath], { cwd: root });
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toMatch(/regular files|directory/i);
    });
  });

  it("rejects attaching a nonexistent source", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "t"], { cwd: root });

      const result = await runCli(
        ["attach", "T-1", "/nonexistent/path/to/file.txt"],
        { cwd: root },
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toMatch(/does not exist|not found/i);
    });
  });

  it("attach uses only the basename of the source path", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "t"], { cwd: root });

      // Place the file at <root>/foo.txt and reference via a path containing
      // a traversal segment. Only the basename should land in attachments/.
      const srcDir = await mkdtemp(path.join(root, "src-"));
      const sourcePath = path.join(srcDir, "passwd");
      await writeFile(sourcePath, "irrelevant\n", "utf8");

      // Build a path with `..` — resolves to the same file.
      const sub = path.join(srcDir, "sub");
      await mkdir(sub);
      const traversedPath = path.join(sub, "..", "passwd");

      const result = await runCli(["attach", "T-1", traversedPath], { cwd: root });
      expect(result.exitCode).toBe(0);

      // Look in the task's attachments dir.
      const tasksDir = path.join(root, ".loctt", "tasks");
      const taskIds = await readdir(tasksDir);
      const attachmentsDir = path.join(tasksDir, taskIds[0]!, "attachments");
      const entries = await readdir(attachmentsDir);
      expect(entries).toEqual(["passwd"]);

      await rm(srcDir, { recursive: true, force: true });
    });
  });

  it("rejects detach with a path-traversal name", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "t"], { cwd: root });

      const result = await runCli(["detach", "T-1", "../foo"], { cwd: root });
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toMatch(/basename|path separator|\.\./);
    });
  });
});
