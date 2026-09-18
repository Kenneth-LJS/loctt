import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * `loctt duplicate` (item 10). `duplicateTask` was exported, tested,
 * and reachable from nothing.
 */
describe("CLI duplicate (spawned binary)", () => {
  it("copies fields and body to a task with a fresh key", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "original", "--priority", "high"], { cwd: root });
      await runCli(["body", "T-1", "--set", "shared body"], { cwd: root });

      const dup = await runCli(["duplicate", "T-1"], { cwd: root });
      expect(dup.exitCode).toBe(0);
      expect(dup.stdout).toContain("T-2");
      expect(dup.stdout).toContain("(copy)");

      const shown = await runCli(["show", "T-2"], { cwd: root });
      expect(shown.stdout).toContain("high");
      expect(shown.stdout).toContain("shared body");
    });
  });

  it("accepts a title override", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "original"], { cwd: root });
      const dup = await runCli(["duplicate", "T-1", "--title", "renamed copy"], { cwd: root });
      expect(dup.stdout).toContain("renamed copy");
      expect(dup.stdout).not.toContain("(copy)");
    });
  });

  it("does not copy relationships", async () => {
    // Documented contract: the copy starts unlinked, so duplicating a
    // task cannot silently double every edge it participates in.
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "a"], { cwd: root });
      await runCli(["create", "b"], { cwd: root });
      await runCli(["link", "T-1", "blocks", "T-2"], { cwd: root });

      await runCli(["duplicate", "T-1"], { cwd: root });
      const shown = await runCli(["show", "T-3"], { cwd: root });
      expect(shown.stdout).not.toContain("blocks");
    });
  });

  it("leaves the source untouched", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "original"], { cwd: root });
      const before = await runCli(["show", "T-1"], { cwd: root });
      await runCli(["duplicate", "T-1"], { cwd: root });
      const after = await runCli(["show", "T-1"], { cwd: root });
      expect(after.stdout).toBe(before.stdout);
    });
  });

  it("exits non-zero for an unknown task", async () => {
    await withTmpLoctt(async ({ root }) => {
      const r = await runCli(["duplicate", "T-404"], { cwd: root });
      expect(r.exitCode).not.toBe(0);
    });
  });
});
