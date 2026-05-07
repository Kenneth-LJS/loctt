import { rm } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../../adapters/cli-spawn.js";
import { withTmpLoctt } from "../../fixtures/tmp-loctt.js";

describe("CLI workflow / queries config edge cases (spawned binary)", () => {
  it("rejects setting status to a value not in workflow", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "t"], { cwd: root });

      const result = await runCli(
        ["set", "T-1", "status", "not_a_real_status"],
        { cwd: root },
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("not_a_real_status");
      expect(result.stderr).toMatch(/valid:|unknown status/);
    });
  });

  it("rejects setting an unknown custom field", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "t"], { cwd: root });

      const result = await runCli(
        ["set", "T-1", "not_a_field", "value"],
        { cwd: root },
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("not_a_field");
      expect(result.stderr).toMatch(/unknown custom field|unknown field/);
    });
  });

  it("list works when queries.yaml is missing", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "t"], { cwd: root });
      await rm(path.join(root, ".loctt", "config", "queries.yaml"));

      const result = await runCli(["list"], { cwd: root });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("T-1");
    });
  });

  it("list --view <name> errors when the view does not exist (queries.yaml present)", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "t"], { cwd: root });

      const result = await runCli(["list", "--view", "no_such_view"], { cwd: root });
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toMatch(/unknown view|no_such_view/);
    });
  });
});
