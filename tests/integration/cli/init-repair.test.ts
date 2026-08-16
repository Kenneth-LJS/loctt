import { readdir, rm } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * @verifies ONB-C3
 *
 * The CLI's own doc comment says init "only writes the missing files",
 * but core threw unconditionally on an existing `.loctt/`. So a tracker
 * whose config/ was deleted got "already exists" and nothing else — and
 * the only route back was `rm -rf .loctt/`, destroying every surviving
 * task.
 */
describe("init over a damaged tracker offers a route back", () => {
  it("names the missing files rather than only 'already exists'", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "precious"], { cwd: root });
      await rm(path.join(root, ".loctt/config"), { recursive: true, force: true });

      const res = await runCli(["init"], { cwd: root });
      const out = `${res.stdout}${res.stderr}`;

      // "already exists" alone is the failure the case names: true, and
      // useless, because it does not say what is wrong or what to do.
      expect(out).not.toMatch(/^Error: \.loctt directory already exists[^\n]*$/);
      expect(out).toMatch(/config/i);
    });
  });

  it("leaves the surviving tasks readable, whichever branch it takes", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "precious"], { cwd: root });
      const before = await readdir(path.join(root, ".loctt/tasks"));
      expect(before).toHaveLength(1);

      await rm(path.join(root, ".loctt/config"), { recursive: true, force: true });
      await runCli(["init"], { cwd: root });

      // Nothing about a repair may cost the user their tasks.
      expect(await readdir(path.join(root, ".loctt/tasks"))).toEqual(before);
    });
  });

  it("produces a tracker doctor reports clean", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "precious"], { cwd: root });
      await rm(path.join(root, ".loctt/config"), { recursive: true, force: true });

      // Bare init names the repair; this follows the route it gives.
      const guided = await runCli(["init"], { cwd: root });
      expect(`${guided.stdout}${guided.stderr}`).toMatch(/--repair/);

      const repair = await runCli(["init", "--repair"], { cwd: root });
      expect(repair.exitCode, `${repair.stdout}${repair.stderr}`).toBe(0);

      const doctor = await runCli(["doctor"], { cwd: root });
      expect(doctor.exitCode, doctor.stdout).toBe(0);

      // And the task is still reachable through the repaired config.
      const show = await runCli(["show", "T-1"], { cwd: root });
      expect(show.exitCode).toBe(0);
      expect(show.stdout).toContain("precious");
    });
  });

  it("still refuses to re-init a healthy tracker", async () => {
    await withTmpLoctt(async ({ root }) => {
      // Repair must not become a silent overwrite of a working tracker.
      const res = await runCli(["init"], { cwd: root });
      expect(res.exitCode).not.toBe(0);
      expect(`${res.stdout}${res.stderr}`).toMatch(/already/i);
    });
  });
});
