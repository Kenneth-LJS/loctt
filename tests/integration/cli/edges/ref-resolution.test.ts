import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../../adapters/cli-spawn.js";
import { withTmpLoctt } from "../../fixtures/tmp-loctt.js";

describe("CLI ref resolution edge cases (spawned binary)", () => {
  it("show on a nonexistent ref exits non-zero with a clear message", async () => {
    await withTmpLoctt(async ({ root }) => {
      const result = await runCli(["show", "T-99"], { cwd: root });
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("task not found");
      expect(result.stderr).toContain("T-99");
    });
  });

  it("show resolves a task by its ULID id", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "lookup by id"], { cwd: root });

      // Locate the task dir and read the id from the frontmatter.
      const { readdir } = await import("node:fs/promises");
      const tasksDir = path.join(root, ".loctt", "tasks");
      const entries = await readdir(tasksDir);
      expect(entries.length).toBe(1);
      const taskFile = path.join(tasksDir, entries[0]!, "task.md");
      const content = await readFile(taskFile, "utf-8");
      const match = content.match(/^id:\s*([0-9A-HJKMNP-TV-Z]{26})/m);
      expect(match).not.toBeNull();
      const id = match![1]!;

      const result = await runCli(["show", id], { cwd: root });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("T-1");
      expect(result.stdout).toContain("lookup by id");
    });
  });

  it("show with an empty ref string exits non-zero with usage", async () => {
    await withTmpLoctt(async ({ root }) => {
      const result = await runCli(["show", ""], { cwd: root });
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("Usage: loctt show");
    });
  });
});
