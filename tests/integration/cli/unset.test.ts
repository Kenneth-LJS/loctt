import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

describe("CLI unset (spawned binary)", () => {
  it("clears a previously set field", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "task with priority"], { cwd: root });
      await runCli(["set", "T-1", "priority", "high"], { cwd: root });

      const unset = await runCli(["unset", "T-1", "priority"], { cwd: root });
      expect(unset.exitCode).toBe(0);

      const show = await runCli(["show", "T-1"], { cwd: root });
      expect(show.exitCode).toBe(0);
      expect(show.stdout).not.toContain("Priority: high");
    });
  });
});
