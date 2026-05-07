import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

describe("CLI schema (spawned binary)", () => {
  it("prints workflow config sections", async () => {
    await withTmpLoctt(async ({ root }) => {
      const result = await runCli(["schema"], { cwd: root });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Key prefix:");
      expect(result.stdout).toContain("Statuses:");
    });
  });

  it("respects a non-default key prefix", async () => {
    await withTmpLoctt(
      async ({ root }) => {
        await runCli(["init", "--prefix", "BUG-"], { cwd: root });
        const result = await runCli(["schema"], { cwd: root });
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain("Key prefix: BUG-");
      },
      { init: false },
    );
  });
});
