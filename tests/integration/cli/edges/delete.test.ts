import { describe, expect, it } from "vitest";

import { runCli } from "../../adapters/cli-spawn.js";
import { withTmpLoctt } from "../../fixtures/tmp-loctt.js";

describe("CLI delete edge cases (spawned binary)", () => {
  it("delete on an already-archived task without --hard hints at --hard", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "t"], { cwd: root });
      await runCli(["delete", "T-1"], { cwd: root }); // archives

      const result = await runCli(["delete", "T-1"], { cwd: root });
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toMatch(/already archived/);
      expect(result.stderr).toContain("--hard");

      // Task should still exist on disk.
      const show = await runCli(["show", "T-1"], { cwd: root });
      expect(show.exitCode).toBe(0);
    });
  });

  it("delete on a nonexistent task errors", async () => {
    await withTmpLoctt(async ({ root }) => {
      const result = await runCli(["delete", "T-99", "--hard"], { cwd: root });
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("not found");
    });
  });

  it("hard-deleting a link target leaves a dangling edge on the source", async () => {
    // Documents actual behavior: source's frontmatter still references the
    // deleted target's ULID, and `show` renders it as `(deleted)`.
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "first"], { cwd: root });
      await runCli(["create", "second"], { cwd: root });
      await runCli(["link", "T-1", "blocks", "T-2"], { cwd: root });

      const del = await runCli(["delete", "T-2", "--hard"], { cwd: root });
      expect(del.exitCode).toBe(0);

      const show = await runCli(["show", "T-1"], { cwd: root });
      expect(show.exitCode).toBe(0);
      expect(show.stdout).toContain("Relationships:");
      expect(show.stdout).toContain("blocks");
      expect(show.stdout).toContain("(deleted)");
    });
  });
});
