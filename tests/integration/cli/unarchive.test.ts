import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

describe("CLI unarchive (spawned binary)", () => {
  it("restores an archived task to the list", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "revivable"], { cwd: root });
      await runCli(["archive", "T-1"], { cwd: root });

      const unarchive = await runCli(["unarchive", "T-1"], { cwd: root });
      expect(unarchive.exitCode).toBe(0);

      const list = await runCli(["list"], { cwd: root });
      expect(list.stdout).toContain("revivable");
    });
  });
});
