import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

describe("CLI doctor (spawned binary)", () => {
  it("runs cleanly on a fresh workspace", async () => {
    await withTmpLoctt(async ({ root }) => {
      const result = await runCli(["doctor"], { cwd: root });

      expect(result.exitCode).toBe(0);
      expect(result.stdout.length).toBeGreaterThan(0);
    });
  });
});
