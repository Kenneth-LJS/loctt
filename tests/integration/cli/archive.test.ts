import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

describe("CLI archive (spawned binary)", () => {
  it("hides the task from list but still shows it directly", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "old work"], { cwd: root });

      const archive = await runCli(["archive", "T-1"], { cwd: root });
      expect(archive.exitCode).toBe(0);

      const list = await runCli(["list"], { cwd: root });
      expect(list.stdout).not.toContain("old work");

      const show = await runCli(["show", "T-1"], { cwd: root });
      expect(show.exitCode).toBe(0);
      expect(show.stdout).toContain("old work");
    });
  });
});
