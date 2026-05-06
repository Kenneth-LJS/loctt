import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

describe("CLI config list (spawned binary)", () => {
  it("lists all known config keys with their defaults", async () => {
    await withTmpLoctt(async ({ root }) => {
      const result = await runCli(["config", "list"], { cwd: root });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("git.enabled");
      expect(result.stdout).toContain("git.remote");
      expect(result.stdout).toContain("git.branch");
      expect(result.stdout).toContain("git.auto_push");
      expect(result.stdout).toContain("git.auto_fetch");
    });
  });
});
