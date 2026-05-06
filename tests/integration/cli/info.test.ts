import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

describe("CLI info (spawned binary)", () => {
  it("reports workspace info after init", async () => {
    await withTmpLoctt(async ({ root }) => {
      const result = await runCli(["info"], { cwd: root });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("LocTT");
      expect(result.stdout).toContain("T-");
    });
  });
});
