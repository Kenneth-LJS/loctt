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

  it("appends text to an existing body with a blank-line separator", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "appendable"], { cwd: root });

      const set = await runCli(["body", "T-1", "--set", "first"], { cwd: root });
      expect(set.exitCode).toBe(0);

      const append = await runCli(["body", "T-1", "--append", "second"], { cwd: root });
      expect(append.exitCode).toBe(0);

      const read = await runCli(["body", "T-1"], { cwd: root });
      expect(read.exitCode).toBe(0);
      expect(read.stdout).toContain("first");
      expect(read.stdout).toContain("second");
      // Blank-line separator between the two parts.
      expect(read.stdout).toMatch(/first\n\nsecond/);
    });
  });

  it("rejects --set and --append together", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "conflicting"], { cwd: root });

      const result = await runCli(
        ["body", "T-1", "--set", "a", "--append", "b"],
        { cwd: root },
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("mutually exclusive");
    });
  });
});
