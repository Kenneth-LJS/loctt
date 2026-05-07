import { describe, expect, it } from "vitest";

import { runCli } from "../../adapters/cli-spawn.js";
import { withTmpLoctt } from "../../fixtures/tmp-loctt.js";

describe("CLI link relationship edge cases (spawned binary)", () => {
  it("rejects a link with an unknown relationship type", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "first"], { cwd: root });
      await runCli(["create", "second"], { cwd: root });

      const result = await runCli(
        ["link", "T-1", "nonexistent_type", "T-2"],
        { cwd: root },
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("unknown relationship type");
      expect(result.stderr).toContain("nonexistent_type");
    });
  });

  it("rejects a link to a nonexistent target", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "first"], { cwd: root });

      const result = await runCli(["link", "T-1", "blocks", "T-99"], { cwd: root });
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("not found");
      expect(result.stderr).toContain("T-99");
    });
  });

  it("rejects a link from a nonexistent source", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "first"], { cwd: root });

      const result = await runCli(["link", "T-99", "blocks", "T-1"], { cwd: root });
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("not found");
    });
  });
});
