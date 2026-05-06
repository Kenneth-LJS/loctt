import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

describe("CLI unlink (spawned binary)", () => {
  it("removes a previously created link", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "first"], { cwd: root });
      await runCli(["create", "second"], { cwd: root });
      await runCli(["link", "T-1", "blocks", "T-2"], { cwd: root });

      const unlink = await runCli(["unlink", "T-1", "blocks", "T-2"], { cwd: root });
      expect(unlink.exitCode).toBe(0);

      const show = await runCli(["show", "T-1"], { cwd: root });
      expect(show.stdout).not.toContain("Relationships:");

      // Bilateral: the inverse edge on T-2 must also be gone.
      const showTarget = await runCli(["show", "T-2"], { cwd: root });
      expect(showTarget.stdout).not.toContain("Relationships:");
    });
  });
});
