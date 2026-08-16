import { rm } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * Audit group D: a `UsageError` in an unwrapped command exits 1 where
 * its wrapped siblings exit 2, for identical error text — and
 * `user current` prints its failure to stdout while exiting 1.
 *
 * The exit-code half turned out worse than the finding described.
 * `info`, `views` and `schema` did not validate their flags at all, so
 * an unknown one was silently dropped and the command exited **0**,
 * reporting success for something it never did. The dispatcher's own
 * comment said these commands "throw no UsageError today", which stopped
 * being true once `doctor` gained flag validation in Phase 3.
 */
describe("CLI exit codes are consistent (spawned binary)", () => {
  // The contract: 2 means "you typed it wrong" on every command.
  const COMMANDS = ["info", "doctor", "views", "schema", "list", "create"];

  it.each(COMMANDS)("exits 2 on an unknown flag: %s", async (command) => {
    await withTmpLoctt(async ({ root }) => {
      const result = await runCli([command, "--definitely-not-a-flag"], { cwd: root });
      expect(result.exitCode).toBe(2);
      // And says so, rather than failing silently.
      expect(`${result.stdout}${result.stderr}`).toMatch(/unknown option/i);
    });
  });

  it("still succeeds when given no flags", async () => {
    await withTmpLoctt(async ({ root }) => {
      // Guards the fix from over-reaching: rejecting flags must not
      // reject the ordinary invocation.
      for (const command of ["info", "views", "schema"]) {
        const result = await runCli([command], { cwd: root });
        expect(result.exitCode, `${command} without flags`).toBe(0);
      }
    });
  });

  it("sends `user current`'s failure to stderr, not stdout", async () => {
    await withTmpLoctt(async ({ root }) => {
      // Remove every user so the command has nothing to report.
      await rm(path.join(root, ".loctt/users"), { recursive: true, force: true });
      await rm(path.join(root, ".loctt/.current-user"), { force: true });

      const result = await runCli(["user", "current"], { cwd: root });
      expect(result.exitCode).not.toBe(0);
      // The bug: this exits non-zero but printed to stdout, so
      // `loctt user current | cut -f2` read the failure text as a name.
      expect(result.stdout.trim()).toBe("");
      expect(result.stderr).toMatch(/no users registered/i);
    });
  });

  it("prints the current user to stdout on success", async () => {
    await withTmpLoctt(async ({ root }) => {
      // The other half of the same contract — and a guard against the
      // test above passing because the command prints nothing at all.
      const result = await runCli(["user", "current"], { cwd: root });
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).not.toBe("");
      expect(result.stderr.trim()).toBe("");
    });
  });
});
