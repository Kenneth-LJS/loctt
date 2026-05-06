import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

describe("CLI body (spawned binary)", () => {
  it("sets and reads back a task body", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "with body"], { cwd: root });

      const set = await runCli(["body", "T-1", "--set", "hello world"], { cwd: root });
      expect(set.exitCode).toBe(0);

      const read = await runCli(["body", "T-1"], { cwd: root });
      expect(read.exitCode).toBe(0);
      expect(read.stdout).toContain("hello world");
    });
  });
});
