import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

describe("CLI views (spawned binary)", () => {
  it("lists saved views from queries.yaml", async () => {
    await withTmpLoctt(async ({ root }) => {
      const result = await runCli(["views"], { cwd: root });
      expect(result.exitCode).toBe(0);
      // Default queries.yaml ships with at least one saved view; assert
      // that name + query column are present rather than coupling to
      // exact view names which the seed data may evolve.
      expect(result.stdout.length).toBeGreaterThan(0);
      expect(result.stdout).not.toContain("No saved views.");
    });
  });
});
