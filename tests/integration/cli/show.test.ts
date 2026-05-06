import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

describe("CLI show (spawned binary)", () => {
  it("prints task title and key", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "showable task"], { cwd: root });

      const result = await runCli(["show", "T-1"], { cwd: root });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("T-1");
      expect(result.stdout).toContain("showable task");
    });
  });
});
