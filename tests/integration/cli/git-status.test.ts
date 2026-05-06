import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

describe("CLI git status (spawned binary)", () => {
  it("reports not-in-git on a plain workspace", async () => {
    await withTmpLoctt(async ({ root }) => {
      const result = await runCli(["git", "status"], { cwd: root });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Enabled: false");
      expect(result.stdout).toContain("Branch:");
    });
  });
});
