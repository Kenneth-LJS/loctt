import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

describe("CLI delete (spawned binary)", () => {
  it("soft-deletes (archives) by default", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "doomed"], { cwd: root });

      const del = await runCli(["delete", "T-1"], { cwd: root });
      expect(del.exitCode).toBe(0);
      expect(del.stdout).toMatch(/Archived/);

      // Task still exists, just archived.
      const show = await runCli(["show", "T-1"], { cwd: root });
      expect(show.exitCode).toBe(0);
    });
  });

  it("removes a task permanently with --hard --yes", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "doomed"], { cwd: root });

      const del = await runCli(["delete", "T-1", "--hard", "--yes"], { cwd: root });
      expect(del.exitCode).toBe(0);

      const show = await runCli(["show", "T-1"], { cwd: root });
      expect(show.exitCode).not.toBe(0);
    });
  });

  it("--hard without --yes refuses in non-TTY contexts (usage error, exit 2)", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "doomed"], { cwd: root });

      const del = await runCli(["delete", "T-1", "--hard"], { cwd: root });
      // EXIT.USAGE = 2 — the script forgot `--yes`. Distinguishes
      // from EXIT.RUNTIME (1, a real error) and EXIT.SUCCESS (0,
      // user said no at an interactive prompt).
      expect(del.exitCode).toBe(2);
      expect(del.stderr).toMatch(/--yes/);

      // Task still on disk.
      const show = await runCli(["show", "T-1"], { cwd: root });
      expect(show.exitCode).toBe(0);
    });
  });
});
