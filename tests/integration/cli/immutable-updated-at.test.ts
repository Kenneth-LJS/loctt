import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * @verifies TSK-C2
 *
 * `updated_at` is what git-sync reconciliation, recency sort and the
 * activity feed all read. Per-field merging leans on it harder still:
 * whole-record recency is the fallback whenever history cannot explain a
 * field, so a forged timestamp decides which side of a merge wins.
 *
 * USER_IMMUTABLE_FIELDS omitted it, so `loctt set` wrote it directly.
 */
describe("CLI updated_at is not hand-writable (spawned binary)", () => {
  it("refuses a direct write and leaves the stored value alone", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "a task"], { cwd: root });
      const before = await runCli(["show", "T-1"], { cwd: root });

      const set = await runCli(
        ["set", "T-1", "updated_at", "2020-01-01T00:00:00.000Z"],
        { cwd: root },
      );
      expect(set.exitCode).not.toBe(0);

      const out = `${set.stdout}${set.stderr}`;
      // The message must name the field and say why, or the user is left
      // guessing which of their fields was the problem.
      //
      // "immutable" alone satisfied the old pattern and says nothing
      // about *why* — which is what this test's own comment asks for,
      // and what BLK-40 requires. `updated_at` sat in
      // USER_IMMUTABLE_FIELDS, so the generic guard fired first and the
      // explanation written for it was unreachable on every path.
      expect(out).toMatch(/updated_at/);
      expect(out).toMatch(/stamped on every write/);

      // And nothing was written.
      const after = await runCli(["show", "T-1"], { cwd: root });
      expect(after.stdout).toBe(before.stdout);
    });
  });

  it("still bumps updated_at as a side effect of a normal write", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "a task"], { cwd: root });
      const before = await runCli(["log", "T-1"], { cwd: root });

      // The guard blocks direct writes only. If it blocked the side
      // effect too, every edit would leave a stale timestamp — worse
      // than the bug being fixed.
      const set = await runCli(["set", "T-1", "status", "in_progress"], { cwd: root });
      expect(set.exitCode).toBe(0);

      const after = await runCli(["log", "T-1"], { cwd: root });
      expect(after.stdout).not.toBe(before.stdout);
    });
  });

  it("refuses to unset it too", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "a task"], { cwd: root });
      const unset = await runCli(["unset", "T-1", "updated_at"], { cwd: root });
      expect(unset.exitCode).not.toBe(0);
    });
  });
});
