import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * @verifies CMT-C4
 *
 * `loctt log` had `--limit` and no `--offset`, so a long history was
 * reachable only from its newest end — the older entries existed on disk
 * and nothing could display them. readHistory has supported offset all
 * along.
 */
describe("long histories are reachable past the newest page", () => {
  const seed = async (root: string): Promise<void> => {
    await runCli(["create", "busy"], { cwd: root });
    for (let i = 0; i < 5; i += 1) {
      await runCli(["set", "T-1", "priority", "high"], { cwd: root });
      await runCli(["set", "T-1", "priority", "low"], { cwd: root });
    }
  };

  const lines = (s: string): string[] =>
    s.split("\n").map(l => l.trim()).filter(l => l.length > 0);

  it("skips entries with --offset", async () => {
    await withTmpLoctt(async ({ root }) => {
      await seed(root);

      const all = await runCli(["log", "T-1"], { cwd: root });
      const skipped = await runCli(["log", "T-1", "--offset", "2"], { cwd: root });
      expect(skipped.exitCode, `${skipped.stdout}${skipped.stderr}`).toBe(0);

      expect(lines(skipped.stdout)).toEqual(lines(all.stdout).slice(2));
    });
  });

  it("pages to the oldest entry, which limit alone cannot reach", async () => {
    await withTmpLoctt(async ({ root }) => {
      await seed(root);

      const all = lines((await runCli(["log", "T-1"], { cwd: root })).stdout);
      expect(all.length).toBeGreaterThan(3);

      const lastPage = await runCli(
        ["log", "T-1", "--offset", String(all.length - 1), "--limit", "1"],
        { cwd: root },
      );
      // The oldest entry is `created`, and without offset there is no
      // way to display it on a busy task.
      expect(lines(lastPage.stdout)).toEqual([all[all.length - 1]]);
      expect(lastPage.stdout).toMatch(/created/);
    });
  });

  it("rejects a negative offset rather than silently ignoring it", async () => {
    await withTmpLoctt(async ({ root }) => {
      await seed(root);
      const res = await runCli(["log", "T-1", "--offset", "-1"], { cwd: root });
      expect(res.exitCode).not.toBe(0);
    });
  });
});
