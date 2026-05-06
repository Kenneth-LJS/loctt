import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

describe("CLI log (spawned binary)", () => {
  it("shows history entries for a task", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "tracked"], { cwd: root });
      await runCli(["set", "T-1", "status", "in_progress"], { cwd: root });

      const log = await runCli(["log", "T-1"], { cwd: root });
      expect(log.exitCode).toBe(0);
      expect(log.stdout).toContain("created");
      expect(log.stdout).toContain("status");
    });
  });
});
