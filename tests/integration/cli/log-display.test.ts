import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * @verifies CMT-C5
 *
 * The unit tests in apps/cli cover the resolution rules; this one covers
 * the wiring. `formatHistoryEntry` takes its context as an optional
 * parameter, so a `log` command that never built one would keep printing
 * raw keys with every formatter test still green.
 */
describe("CLI log rendering (spawned binary)", () => {
  it("renders labels and the acting user, not stored keys and ULIDs", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "log probe"], { cwd: root });
      await runCli(["set", "T-1", "status", "in_progress"], { cwd: root });

      const log = await runCli(["log", "T-1"], { cwd: root });
      expect(log.exitCode).toBe(0);

      // The default workflow labels these "Backlog" and "In progress".
      expect(log.stdout).toContain("Backlog");
      expect(log.stdout).toContain("In progress");
      expect(log.stdout).not.toContain("in_progress");

      // Some actor must be attributed on every line. init creates a
      // default user, so "actor unknown" here would mean the context
      // never reached the formatter.
      for (const line of log.stdout.trim().split("\n")) {
        expect(line).toMatch(/\([^)]+\)\s*$/);
      }
      expect(log.stdout).not.toMatch(/actor unknown/i);

      // A raw ULID is 26 chars of Crockford base32; the actor id would
      // match if the user lookup silently failed.
      expect(log.stdout).not.toMatch(/\(0[0-9A-HJKMNP-TV-Z]{25}\)/);
    });
  });
});
