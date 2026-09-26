import { describe, expect, it } from "vitest";

import { runCli } from "../integration/adapters/cli-spawn.js";
import { withTmpLoctt } from "../integration/fixtures/tmp-loctt.js";

describe("E2E journey: error paths", () => {
  it("unknown command exits non-zero with usage hint", async () => {
    await withTmpLoctt(async ({ root }) => {
      const result = await runCli(["definitely-not-a-command"], { cwd: root });
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr.toLowerCase()).toMatch(/unknown command|usage/);
    });
  });

  it("unparseable query exits non-zero with parse error", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "t"], { cwd: root });
      const result = await runCli(["list", "--query", "broken {{{"], { cwd: root });
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toMatch(/Error|unexpected/i);
    });
  });

  it("show on a nonexistent ref exits non-zero", async () => {
    await withTmpLoctt(async ({ root }) => {
      const result = await runCli(["show", "T-99"], { cwd: root });
      expect(result.exitCode).not.toBe(0);
    });
  });

  it("self-link rejected", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "self"], { cwd: root });
      const result = await runCli(["link", "T-1", "blocks", "T-1"], { cwd: root });
      expect(result.exitCode).not.toBe(0);
    });
  });

  it("delete refuses to prompt when not attached to a terminal", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "doomed"], { cwd: root });

      // This test was titled "delete on an already-archived task without
      // --hard exits non-zero" and asserted the second of two deletes
      // failed because the first had archived. Neither happened: `delete`
      // is hard and permanent, there is no `--hard` flag, and the first
      // bare `delete` never got that far — it exits on the confirmation
      // gate with the task untouched. It passed for the wrong reason and
      // would still pass with the already-archived check deleted.
      const first = await runCli(["delete", "T-1"], { cwd: root });
      expect(first.exitCode).not.toBe(0);
      expect(`${first.stdout}${first.stderr}`).toMatch(/non-interactive/i);

      // The refusal must mean the task is still there.
      const show = await runCli(["show", "T-1"], { cwd: root });
      expect(show.exitCode).toBe(0);
      expect(show.stdout).toContain("doomed");
    });
  });

  it("delete removes the task once confirmation is given", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "doomed"], { cwd: root });
      expect((await runCli(["delete", "T-1", "--yes"], { cwd: root })).exitCode).toBe(0);

      // And a second delete of a task that no longer exists fails.
      const again = await runCli(["delete", "T-1", "--yes"], { cwd: root });
      expect(again.exitCode).not.toBe(0);
    });
  });

  it("config set before git enable exits non-zero", async () => {
    await withTmpLoctt(async ({ root }) => {
      const result = await runCli(["config", "set", "git.auto_push", "true"], { cwd: root });
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("Git mode is not enabled. Run 'loctt git enable' first.");
    });
  });

  it("show without arguments exits non-zero with usage hint", async () => {
    await withTmpLoctt(async ({ root }) => {
      const result = await runCli(["show"], { cwd: root });
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr.toLowerCase()).toContain("usage");
    });
  });
});
