import { describe, expect, it } from "vitest";

import { runCli } from "../../adapters/cli-spawn.js";
import { withTmpLoctt } from "../../fixtures/tmp-loctt.js";

/**
 * Edge cases for the two-verb delete/archive contract (post-Phase-2.7):
 * `delete` is always permanent; `archive` is the reversible path.
 */
describe("CLI delete edge cases (spawned binary)", () => {
  // K25: idempotent archive/unarchive (behavior recorded in decisions.md K25/A127; no canonical case)
  it("archive on an already-archived task is an idempotent no-op success (K25)", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "t"], { cwd: root });
      await runCli(["archive", "T-1"], { cwd: root });

      // K25: the second archive no longer errors — the task is already
      // in the requested state, so the CLI succeeds (matching the web
      // and bulk paths, and never surfacing the old generic 500 that
      // the web layer produced from the thrown TaskLifecycleError).
      const result = await runCli(["archive", "T-1"], { cwd: root });
      expect(result.exitCode).toBe(0);

      // Task should still exist on disk and still be archived.
      const show = await runCli(["show", "T-1"], { cwd: root });
      expect(show.exitCode).toBe(0);
      expect(show.stdout).toMatch(/archived/i);
    });
  });

  it("delete on a nonexistent task errors", async () => {
    await withTmpLoctt(async ({ root }) => {
      const result = await runCli(["delete", "T-99", "--yes"], { cwd: root });
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("not found");
    });
  });

  /**
   * @verifies REL-C8
   *
   * K147 (G4). This test used to assert the bug: it documented that the
   * source kept an edge to the deleted task and that `show` printed it as
   * `(deleted)`. Delete now removes the partner's side of every link in
   * the same operation and records it in the partner's history.
   */
  it("deleting a link target removes the source's edge and logs it there", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "first"], { cwd: root });
      await runCli(["create", "second"], { cwd: root });
      await runCli(["link", "T-1", "blocks", "T-2"], { cwd: root });

      const del = await runCli(["delete", "T-2", "--yes"], { cwd: root });
      expect(del.exitCode).toBe(0);

      const show = await runCli(["show", "T-1"], { cwd: root });
      expect(show.exitCode).toBe(0);
      expect(show.stdout).not.toContain("Relationships:");
      expect(show.stdout).not.toContain("(deleted)");

      const log = await runCli(["log", "T-1"], { cwd: root });
      expect(log.stdout).toMatch(/link removed: blocks → 01[0-9A-Z]{24}/);

      const doctor = await runCli(["doctor"], { cwd: root });
      expect(doctor.stdout).not.toMatch(/relationships: \d+ issue/);
    });
  });
});
