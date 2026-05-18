import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * Post-Phase-2.7 CLI delete/archive contract: two distinct verbs,
 * no `--hard` flag. `archive` is soft-reversible; `delete` is
 * permanent and always requires `--yes` in non-interactive runs.
 */
describe("CLI delete + archive (spawned binary)", () => {
  it("archive is the soft (reversible) verb; task stays on disk", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "doomed"], { cwd: root });

      const arch = await runCli(["archive", "T-1"], { cwd: root });
      expect(arch.exitCode).toBe(0);
      expect(arch.stdout).toMatch(/Archived/);

      // Task still exists, just archived.
      const show = await runCli(["show", "T-1"], { cwd: root });
      expect(show.exitCode).toBe(0);
    });
  });

  it("delete --yes permanently removes the task from disk", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "doomed"], { cwd: root });

      const del = await runCli(["delete", "T-1", "--yes"], { cwd: root });
      expect(del.exitCode).toBe(0);

      const show = await runCli(["show", "T-1"], { cwd: root });
      expect(show.exitCode).not.toBe(0);
    });
  });

  it("delete without --yes refuses in non-TTY contexts (usage error, exit 2)", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "doomed"], { cwd: root });

      const del = await runCli(["delete", "T-1"], { cwd: root });
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
