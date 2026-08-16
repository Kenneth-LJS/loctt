import { rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * @verifies ONB-C4
 *
 * `doctor` explains a tracker that is failing. It was not exempt from
 * the schema-version boot guard, so a bad `.schema-version` blocked the
 * one command that could describe it — while the CLI's own prefix-rename
 * warning says "Run `loctt doctor` for detail", advice that could not
 * work.
 *
 * invariants.md is explicit: throwing "takes away the tools to diagnose
 * the tracker — including `doctor`, whose job is to explain the very
 * state that is failing."
 */
describe("CLI doctor reports schema problems (spawned binary)", () => {
  const versionFile = (root: string): string => path.join(root, ".loctt/.schema-version");

  it("runs and names the mismatch when the schema is too new", async () => {
    await withTmpLoctt(async ({ root }) => {
      await writeFile(versionFile(root), "99\n", "utf-8");

      const res = await runCli(["doctor"], { cwd: root });
      const out = `${res.stdout}${res.stderr}`;

      // Must actually run its checks, not be refused at the boot guard.
      // Matching only /schema/ would pass on the guard's own error text,
      // which is how the first version of this test passed while doctor
      // never ran at all.
      expect(out, "doctor did not run its checks").toMatch(/[✓✗×]\s|\bok\b|\berror\b/);
      expect(out).toMatch(/schema/i);
      // Both versions, so the user can see what to do about it.
      expect(out).toMatch(/99/);
      // A tracker in this state is not healthy, and the exit code says so.
      expect(res.exitCode).not.toBe(0);
    });
  });

  it("distinguishes a missing schema version from an outdated one", async () => {
    await withTmpLoctt(async ({ root }) => {
      await rm(versionFile(root), { force: true });

      const res = await runCli(["doctor"], { cwd: root });
      const out = `${res.stdout}${res.stderr}`;
      expect(out, "doctor did not run its checks").toMatch(/[✓✗×]\s|\bok\b|\berror\b/);
      expect(out).toMatch(/schema/i);
      expect(res.exitCode).not.toBe(0);
    });
  });

  it("reports ok on a healthy tracker", async () => {
    await withTmpLoctt(async ({ root }) => {
      const res = await runCli(["doctor"], { cwd: root });
      expect(res.exitCode).toBe(0);
      expect(res.stdout).toMatch(/schema/i);
    });
  });
});
