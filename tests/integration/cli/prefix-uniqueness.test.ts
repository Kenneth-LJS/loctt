import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * @verifies PRU-C11
 *
 * Prefix uniqueness is enforced at createProject, so the whole codebase
 * may rely on it. `set-prefix` is a second door onto the same invariant:
 * if it did not enforce the rule, two projects could claim one key space
 * and every key issued afterwards would be ambiguous.
 *
 * The behaviour already shipped; nothing asserted it.
 */
describe("CLI project set-prefix uniqueness (spawned binary)", () => {
  const projectsYaml = (root: string): string =>
    path.join(root, ".loctt/config/projects.yaml");

  it("refuses a prefix another project holds, and writes nothing", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["project", "create", "Backend", "--prefix", "B"], { cwd: root });
      await runCli(["create", "a task"], { cwd: root });
      const before = await readFile(projectsYaml(root), "utf-8");

      const res = await runCli(["project", "set-prefix", "Backend", "T", "--yes"], { cwd: root });
      expect(res.exitCode).not.toBe(0);

      const out = `${res.stdout}${res.stderr}`;
      // Naming both sides matters: "prefix in use" alone leaves the user
      // hunting for which project holds it.
      expect(out).toMatch(/\bT\b/);
      expect(out).toMatch(/Tasks/);

      // Nothing was written — a partially-applied rename would leave
      // keys pointing at a prefix no project claims.
      expect(await readFile(projectsYaml(root), "utf-8")).toBe(before);
    });
  });

  it("accepts a project's own prefix as a no-op rather than erroring", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["project", "create", "Backend", "--prefix", "B"], { cwd: root });

      // Re-asserting the current value is not a collision. Failing here
      // would make idempotent scripts break on a second run.
      const res = await runCli(["project", "set-prefix", "Backend", "B", "--yes"], { cwd: root });
      expect(res.exitCode).toBe(0);
    });
  });
});
