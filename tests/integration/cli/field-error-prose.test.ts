import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * @verifies TSK-C1
 *
 * A ZodError reaching the top-level catch prints its `.message`, which
 * is the serialized issue array — braces, "code", "path" and all. MCP
 * returns prose for the same input, so the two surfaces described one
 * mistake in two different languages (P10).
 */
describe("CLI field errors are prose, not a validator dump", () => {
  it("names the field and the expected shape, without JSON", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "a task"], { cwd: root });

      const res = await runCli(["set", "T-1", "labels", "notanarray"], { cwd: root });
      const out = `${res.stdout}${res.stderr}`;

      // The specific shapes the case forbids.
      expect(out).not.toMatch(/[{}]/);
      expect(out).not.toMatch(/"code":/);
      expect(out).not.toMatch(/"path":/);

      // And what it must contain instead.
      expect(out).toMatch(/labels/);
      expect(out).toMatch(/array/i);

      // Domain error, not a crash.
      expect(res.exitCode).toBe(1);
    });
  });

  it("leaves the task unchanged when it refuses", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "a task"], { cwd: root });
      const before = await runCli(["show", "T-1"], { cwd: root });

      await runCli(["set", "T-1", "labels", "notanarray"], { cwd: root });

      const after = await runCli(["show", "T-1"], { cwd: root });
      expect(after.stdout).toBe(before.stdout);
    });
  });

  it("never leaks a regex source into a date error", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "a task"], { cwd: root });

      const res = await runCli(["set", "T-1", "due_date", "not-a-date"], { cwd: root });
      const out = `${res.stdout}${res.stderr}`;

      // A pattern is not an explanation.
      expect(out).not.toMatch(/\\\\d\{4\}/);
      expect(out).toMatch(/due_date/);
    });
  });
});
