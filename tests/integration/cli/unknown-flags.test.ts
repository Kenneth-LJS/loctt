import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * `init` has always rejected unknown options; the task commands ignored
 * them. `rejectUnknownFlags` existed and was correct, with exactly one
 * call site.
 *
 * The sharpest case is `delete`: two e2e tests passed `--hard`, a flag
 * `cli/reference.md` says explicitly does not exist, and stayed green
 * because the parser dropped it and `--yes` did the work. A typo on an
 * irreversible command was accepted and the command proceeded.
 */
describe("CLI unknown flags (spawned binary)", () => {
  it("refuses a typo'd flag on delete rather than deleting anyway", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "keep me"], { cwd: root });

      const bad = await runCli(["delete", "T-1", "--hard", "--yes"], { cwd: root });
      expect(bad.exitCode).not.toBe(0);
      expect(`${bad.stdout}${bad.stderr}`).toMatch(/unknown option --hard/);

      // The task must still be there — refusing has to mean not deleting.
      const show = await runCli(["show", "T-1"], { cwd: root });
      expect(show.exitCode).toBe(0);
      expect(show.stdout).toContain("keep me");
    });
  });

  it.each([
    ["list", ["list", "--bogus"]],
    ["show", ["show", "T-1", "--bogus"]],
    ["archive", ["archive", "T-1", "--bogus"]],
    ["create", ["create", "x", "--bogus"]],
    ["duplicate", ["duplicate", "T-1", "--bogus"]],
    ["set", ["set", "T-1", "status", "done", "--bogus"]],
  ])("refuses an unknown flag on %s", async (_name, argv) => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "seed"], { cwd: root });
      const res = await runCli(argv, { cwd: root });
      expect(res.exitCode).not.toBe(0);
      expect(`${res.stdout}${res.stderr}`).toMatch(/unknown option --bogus/);
    });
  });

  it("still accepts every flag each command documents", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "seed"], { cwd: root });
      for (const argv of [
        ["list", "--limit", "5", "--archived"],
        ["list", "--project", "Tasks"],
        ["create", "another", "--status", "backlog"],
        ["duplicate", "T-1", "--title", "copy"],
        ["log", "T-1", "--limit", "3"],
      ]) {
        const res = await runCli(argv, { cwd: root });
        expect(res.exitCode, `${argv.join(" ")}: ${res.stderr}`).toBe(0);
      }
    });
  });

  it("does not treat a value after -- as a flag", async () => {
    await withTmpLoctt(async ({ root }) => {
      // A title that looks like a flag must survive the guard.
      const res = await runCli(["create", "--", "--not-a-flag"], { cwd: root });
      expect(res.exitCode).toBe(0);
    });
  });
});
