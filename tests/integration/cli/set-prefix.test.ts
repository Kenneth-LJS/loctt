import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * @verifies PRU-C10, PRU-C11
 *
 * `loctt project set-prefix` against the real spawned binary. The unit
 * tests drive `main()` in-process; these prove the exit codes a script
 * actually observes and that the rename reached the files on disk.
 */
describe("CLI project set-prefix (spawned binary)", () => {
  it("renames every task in the project, preserving numbers", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "one"], { cwd: root });
      await runCli(["create", "two"], { cwd: root });
      await runCli(["create", "three"], { cwd: root });
      // Delete the middle task so the surviving numbers are 1 and 3.
      // With a contiguous 1..3 a renumbering bug is invisible — it
      // produces exactly the same keys as preserving them.
      await runCli(["delete", "T-2", "--yes"], { cwd: root });

      const res = await runCli(
        ["project", "set-prefix", "Tasks", "WEB-", "--yes"],
        { cwd: root },
      );
      expect(res.exitCode).toBe(0);
      expect(res.stdout).toMatch(/Renamed 2 task\(s\)/);

      const list = await runCli(["list"], { cwd: root });
      expect(list.stdout).toContain("WEB-1");
      expect(list.stdout).toContain("WEB-3");
      // The gap must survive: renumbering would make this WEB-2 and
      // break every reference anyone wrote down for T-3.
      expect(list.stdout).not.toContain("WEB-2");
      expect(list.stdout).not.toContain("T-1");

      // projects.yaml is the declared source of truth; if it disagreed
      // with the task files the next created key would collide.
      const cfg = await readFile(
        join(root, ".loctt", "config", "projects.yaml"),
        "utf-8",
      );
      expect(cfg).toContain("WEB-");
    });
  });

  it("keeps old keys resolvable, so written-down references survive", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "one"], { cwd: root });
      await runCli(["project", "set-prefix", "Tasks", "WEB-", "--yes"], { cwd: root });

      const show = await runCli(["show", "T-1"], { cwd: root });
      expect(show.exitCode).toBe(0);
      expect(show.stdout).toContain("WEB-1");
    });
  });

  it("continues numbering from the carried-over counter", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "one"], { cwd: root });
      await runCli(["create", "two"], { cwd: root });
      await runCli(["project", "set-prefix", "Tasks", "WEB-", "--yes"], { cwd: root });

      const created = await runCli(["create", "three"], { cwd: root });
      // WEB-3, never WEB-1 — a reset counter would reissue a key over a
      // task that already exists.
      expect(created.stdout).toContain("WEB-3");
    });
  });

  it("exits non-zero on a prefix another project holds, renaming nothing", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "one"], { cwd: root });
      await runCli(["project", "create", "API", "--prefix", "API-"], { cwd: root });

      const res = await runCli(
        ["project", "set-prefix", "Tasks", "API-", "--yes"],
        { cwd: root },
      );
      expect(res.exitCode).toBe(1);
      expect(res.stderr).toContain("API-");

      const list = await runCli(["list"], { cwd: root });
      expect(list.stdout).toContain("T-1");

      // PRU-C11 requires the refusal to land *before anything is
      // written*, not merely to end with an error. A schema-level check
      // downstream also rejects the duplicate, but only after the state
      // counter has been rewritten and the crash sentinel dropped —
      // leaving a tracker that claims API- while its tasks carry T-.
      // These two assertions are what separate the two paths.
      const state = await readFile(join(root, ".loctt", "state.yaml"), "utf-8");
      expect(state).toContain("prefix: T-");
      expect(state).not.toContain("prefix: API-\n    next_number: 2");
      await expect(
        readFile(join(root, ".loctt", "local", "prefix-rename.yaml"), "utf-8"),
      ).rejects.toThrow();
    });
  });

  it("exits non-zero on an unknown project", async () => {
    await withTmpLoctt(async ({ root }) => {
      const res = await runCli(
        ["project", "set-prefix", "Nope", "WEB-", "--yes"],
        { cwd: root },
      );
      // RUNTIME (1), not SUCCESS: resolution happens before the prompt,
      // so a typo'd ref must not look like a completed rename.
      expect(res.exitCode).toBe(1);
      expect(res.stderr).toMatch(/unknown project/i);
    });
  });

  it("refuses without --yes in a non-interactive shell", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "one"], { cwd: root });

      const res = await runCli(["project", "set-prefix", "Tasks", "WEB-"], { cwd: root });
      // USAGE (2), not RUNTIME — the script forgot the flag. Spawned is
      // the only way to test this: stdin is genuinely not a TTY here.
      expect(res.exitCode).toBe(2);

      const list = await runCli(["list"], { cwd: root });
      expect(list.stdout).toContain("T-1");
    });
  });
});
