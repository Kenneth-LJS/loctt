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

  it("a task created with no --status gets the default status", async () => {
    // Was silently created with no `status` key at all, so it matched
    // neither `status = backlog` nor `status != done` and was invisible
    // to ordinary filtering. Asserted through the spawned binary
    // because the defect was in what each surface passed to core.
    await withTmpLoctt(async ({ root }) => {
      expect((await runCli(["create", "no status"], { cwd: root })).exitCode).toBe(0);

      const show = await runCli(["show", "T-1"], { cwd: root });
      expect(show.exitCode).toBe(0);
      expect(show.stdout).toContain("backlog");

      // Reachable by an ordinary filter, which is the actual point.
      const list = await runCli(
        ["list", "--query", "status = backlog"],
        { cwd: root },
      );
      expect(list.exitCode).toBe(0);
      expect(list.stdout).toContain("T-1");
    });
  });

  it("exits non-zero on unknown command", async () => {
    await withTmpLoctt(async ({ root }) => {
      const result = await runCli(["definitely-not-a-command"], { cwd: root });
      expect(result.exitCode).not.toBe(0);
    });
  });
});
