import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

describe("CLI delete (spawned binary)", () => {
  it("soft-deletes (archives) by default", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "doomed"], { cwd: root });

      const del = await runCli(["delete", "T-1"], { cwd: root });
      expect(del.exitCode).toBe(0);
      expect(del.stdout).toMatch(/Archived/);

      // Task still exists, just archived.
      const show = await runCli(["show", "T-1"], { cwd: root });
      expect(show.exitCode).toBe(0);
    });
  });

  it("removes a task permanently with --hard", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "doomed"], { cwd: root });

      const del = await runCli(["delete", "T-1", "--hard"], { cwd: root });
      expect(del.exitCode).toBe(0);

      const show = await runCli(["show", "T-1"], { cwd: root });
      expect(show.exitCode).not.toBe(0);
    });
  });
});
