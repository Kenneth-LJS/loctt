import { writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * @verifies TSK-C8
 *
 * `show` promised "full details" and omitted labels, milestone, sprint,
 * estimate, start_date, reporter and completed_date — every one of them
 * writable through `create` or `set`. A field you can write and cannot
 * read back is invisible state.
 */
describe("loctt show renders every field the task carries", () => {
  it("shows what create and set can write", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["milestone", "create", "v1"], { cwd: root });
      await runCli(
        ["sprint", "create", "S1", "--start", "2026-05-01", "--end", "2026-05-14", "--state", "active"],
        { cwd: root },
      );
      await runCli(["label", "create", "urgent"], { cwd: root });
      await runCli(["create", "full"], { cwd: root });

      await runCli(["set", "T-1", "milestone", "v1"], { cwd: root });
      await runCli(["set", "T-1", "sprint", "S1"], { cwd: root });
      await runCli(["set", "T-1", "estimate", "5"], { cwd: root });
      await runCli(["set", "T-1", "start_date", "2026-05-02"], { cwd: root });

      const show = await runCli(["show", "T-1"], { cwd: root });
      const out = show.stdout;

      // Names, not ids: the stored value is a ULID, and printing that
      // would violate P-4 as much as omitting the field does.
      expect(out, "milestone missing").toMatch(/v1/);
      expect(out, "sprint missing").toMatch(/S1/);
      expect(out, "estimate missing").toMatch(/\b5\b/);
      expect(out, "start_date missing").toMatch(/2026-05-02/);
    });
  });

  it("omits fields the task lacks rather than printing them empty", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "sparse"], { cwd: root });
      const show = await runCli(["show", "T-1"], { cwd: root });

      // A wall of "Milestone: (none)" lines buries the fields that are
      // actually set.
      expect(show.stdout).not.toMatch(/Milestone:/);
      expect(show.stdout).not.toMatch(/Estimate:/);
      expect(show.stdout).not.toMatch(/\(none\)/);
    });
  });

  it("shows a completed_date once the task is completed", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "done soon"], { cwd: root });
      await runCli(["set", "T-1", "status", "done"], { cwd: root });

      // Auto-managed, so it is exactly the kind of field a user cannot
      // discover any other way.
      const show = await runCli(["show", "T-1"], { cwd: root });
      expect(show.stdout).toMatch(/Completed/i);
    });
  });

  /**
   * @verifies TSK-C12
   *
   * G7: assignee and reporter print as names, as the CLI reference's
   * example does, and fall back to the stored id when the user's
   * profile can't be read (a drift signal rather than a blank).
   */
  it("prints assignee and reporter by name, or the id when the profile is unreadable", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["user", "create", "Alex Reed"], { cwd: root });
      await runCli(["create", "named", "--assignee", "Alex Reed", "--reporter", "Alex Reed"], { cwd: root });

      const shown = await runCli(["show", "T-1"], { cwd: root });
      expect(shown.stdout).toMatch(/^Assignee: Alex Reed$/m);
      expect(shown.stdout).toMatch(/^Reporter: Alex Reed$/m);

      const users = await runCli(["user", "list"], { cwd: root });
      const id = /(01[0-9A-Z]{24})/.exec(
        users.stdout.split("\n").find(l => l.includes("Alex Reed")) ?? "",
      )?.[1];
      expect(id, users.stdout).toBeDefined();
      await writeFile(path.join(root, ".loctt/users", String(id), "profile.yaml"), "{ not yaml", "utf-8");

      const degraded = await runCli(["show", "T-1"], { cwd: root });
      expect(degraded.exitCode, degraded.stderr).toBe(0);
      expect(degraded.stdout).toMatch(new RegExp(`^Assignee: ${String(id)}$`, "m"));
    });
  });
});
