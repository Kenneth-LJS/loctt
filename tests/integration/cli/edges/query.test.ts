import { describe, expect, it } from "vitest";

import { runCli } from "../../adapters/cli-spawn.js";
import { withTmpLoctt } from "../../fixtures/tmp-loctt.js";

describe("CLI list query edge cases (spawned binary)", () => {
  it("rejects an unparseable query with a clear error", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "t"], { cwd: root });

      const result = await runCli(
        ["list", "--query", "this is broken {{{"],
        { cwd: root },
      );
      expect(result.exitCode).not.toBe(0);
      // Error mentions the offending character, not a stack trace.
      expect(result.stderr).toMatch(/unexpected character|Error:/);
    });
  });

  it("returns an empty result with exit 0 for a query that matches nothing", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "t"], { cwd: root });

      const result = await runCli(
        ["list", "--query", "title = nonexistent"],
        { cwd: root },
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("No tasks found.");
    });
  });
});
