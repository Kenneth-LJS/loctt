import { describe, expect, it } from "vitest";

import { runCli } from "../../adapters/cli-spawn.js";
import { withTmpLoctt } from "../../fixtures/tmp-loctt.js";

/**
 * Edge cases for the two-verb delete/archive contract (post-Phase-2.7):
 * `delete` is always permanent; `archive` is the reversible path.
 */
describe("CLI delete edge cases (spawned binary)", () => {
  it("archive on an already-archived task surfaces a domain error", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "t"], { cwd: root });
      await runCli(["archive", "T-1"], { cwd: root });

      const result = await runCli(["archive", "T-1"], { cwd: root });
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toMatch(/already archived/);

      // Task should still exist on disk.
      const show = await runCli(["show", "T-1"], { cwd: root });
      expect(show.exitCode).toBe(0);
    });
  });

  it("delete on a nonexistent task errors", async () => {
    await withTmpLoctt(async ({ root }) => {
      const result = await runCli(["delete", "T-99", "--yes"], { cwd: root });
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("not found");
    });
  });

  it("deleting a link target leaves a dangling edge on the source", async () => {
    // Documents actual behavior: source's frontmatter still references the
    // deleted target's ULID, and `show` renders it as `(deleted)`.
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "first"], { cwd: root });
      await runCli(["create", "second"], { cwd: root });
      await runCli(["link", "T-1", "blocks", "T-2"], { cwd: root });

      const del = await runCli(["delete", "T-2", "--yes"], { cwd: root });
      expect(del.exitCode).toBe(0);

      const show = await runCli(["show", "T-1"], { cwd: root });
      expect(show.exitCode).toBe(0);
      expect(show.stdout).toContain("Relationships:");
      expect(show.stdout).toContain("blocks");
      expect(show.stdout).toContain("(deleted)");
    });
  });
});
