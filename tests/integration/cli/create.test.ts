import { readdir } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

describe("CLI create (spawned binary)", () => {
  it("creates a task and prints its key", async () => {
    await withTmpLoctt(async ({ root }) => {
      const result = await runCli(["create", "first task via spawn"], { cwd: root });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("T-1");

      const tasksDir = path.join(root, ".loctt/tasks");
      const taskDirs = await readdir(tasksDir);
      expect(taskDirs.length).toBe(1);
    });
  });

  it("exits non-zero on unknown command", async () => {
    await withTmpLoctt(async ({ root }) => {
      const result = await runCli(["definitely-not-a-command"], { cwd: root });
      expect(result.exitCode).not.toBe(0);
    });
  });
});
