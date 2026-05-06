import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

describe("CLI set (spawned binary)", () => {
  it("updates a task field", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "do work"], { cwd: root });

      const setResult = await runCli(["set", "T-1", "status", "in_progress"], { cwd: root });
      expect(setResult.exitCode).toBe(0);

      const show = await runCli(["show", "T-1"], { cwd: root });
      expect(show.stdout).toContain("in_progress");
    });
  });
});
