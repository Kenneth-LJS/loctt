import { rm } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * @verifies CMT-C2
 *
 * `postComment` threw "No current user is set. An author must be
 * given." — true, and unusable from a CLI that has no author flag. The
 * user is told what is wrong and neither how to fix it nor what
 * happened to the paragraph they just typed.
 */
describe("posting a comment with no current user", () => {
  it("names the fix and echoes the text back", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "a task"], { cwd: root });
      await rm(path.join(root, ".loctt/.current-user"), { force: true });

      const text = "a paragraph the user does not want to retype";
      const res = await runCli(["comment", "T-1", text], { cwd: root });
      const out = `${res.stdout}${res.stderr}`;

      expect(res.exitCode).not.toBe(0);
      expect(out).toMatch(/current user/i);
      // The command that fixes it — "pass an explicit author" is not a
      // thing the CLI can do.
      expect(out).toMatch(/loctt user switch/);
      // And the text, so it is recoverable by copy-paste rather than
      // retyped from memory.
      expect(out).toContain(text);
    });
  });

  it("still posts normally when a current user exists", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "a task"], { cwd: root });
      const res = await runCli(["comment", "T-1", "ordinary"], { cwd: root });
      expect(res.exitCode).toBe(0);
    });
  });
});
