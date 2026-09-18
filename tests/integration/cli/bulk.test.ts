import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * `loctt set T-1,T-2 <field> <value>` (CW-4).
 *
 * Core had bulkSetFields and no surface reached it, so changing one
 * field across several tasks meant N commands and N history entries
 * that no consumer could group.
 */
describe("CLI bulk set (spawned binary)", () => {
  async function seed(root: string, n: number): Promise<void> {
    for (let i = 0; i < n; i += 1) {
      await runCli(["create", `task ${i + 1}`], { cwd: root });
    }
  }

  it("sets a field across several tasks in one command", async () => {
    await withTmpLoctt(async ({ root }) => {
      await seed(root, 3);
      const r = await runCli(["set", "T-1,T-2", "status", "in_progress"], { cwd: root });
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain("2 task(s)");

      // Assert the far end on each task, not the summary line.
      for (const key of ["T-1", "T-2"]) {
        const show = await runCli(["show", key], { cwd: root });
        expect(show.stdout).toContain("in_progress");
      }
      const untouched = await runCli(["show", "T-3"], { cwd: root });
      expect(untouched.stdout).toContain("backlog");
    });
  });

  it("keeps the single-ref path and its friendlier message", async () => {
    await withTmpLoctt(async ({ root }) => {
      await seed(root, 1);
      const r = await runCli(["set", "T-1", "status", "done"], { cwd: root });
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain("on T-1");
    });
  });

  it("reports per-task failures and exits non-zero", async () => {
    await withTmpLoctt(async ({ root }) => {
      await seed(root, 1);
      const r = await runCli(["set", "T-1,T-404", "status", "done"], { cwd: root });
      expect(r.exitCode).not.toBe(0);
      expect(r.stderr).toContain("T-404");
      // The good ref still landed — a bad ref does not abort the batch.
      const show = await runCli(["show", "T-1"], { cwd: root });
      expect(show.stdout).toContain("done");
    });
  });

  it("clears a field across several tasks via unset", async () => {
    await withTmpLoctt(async ({ root }) => {
      await seed(root, 2);
      await runCli(["set", "T-1,T-2", "priority", "high"], { cwd: root });
      const r = await runCli(["unset", "T-1,T-2", "priority"], { cwd: root });
      expect(r.exitCode).toBe(0);

      for (const key of ["T-1", "T-2"]) {
        const show = await runCli(["show", key], { cwd: root });
        expect(show.stdout).not.toContain("high");
      }
    });
  });

  it("tolerates a trailing comma", async () => {
    await withTmpLoctt(async ({ root }) => {
      await seed(root, 2);
      const r = await runCli(["set", "T-1,T-2,", "status", "done"], { cwd: root });
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain("2 task(s)");
    });
  });
});
