import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * @verifies CFG-C2
 *
 * Hand-removing an in-use status left doctor printing "✓ workflow.yaml:
 * valid" — the reference check filtered workflow-key errors out as "out
 * of scope for this aggregate view". Compounding it, the DSL rejects the
 * deleted literal, so you could not query for the tasks you had to fix.
 */
describe("a drifted enum value is visible and findable", () => {
  /** Removes a status from workflow.yaml, leaving tasks pointing at it. */
  const dropStatus = async (root: string, key: string): Promise<void> => {
    const file = path.join(root, ".loctt/config/workflow.yaml");
    const raw = await readFile(file, "utf-8");
    const stripped = raw.replace(
      new RegExp(`\\n  - key: ${key}\\n(?:    [^\\n]*\\n)*`, "m"),
      "\n",
    );
    expect(stripped, `status ${key} not found in workflow.yaml`).not.toBe(raw);
    await writeFile(file, stripped, "utf-8");
  };

  const seedDrift = async (root: string): Promise<void> => {
    await runCli(["create", "drifted"], { cwd: root });
    await runCli(["set", "T-1", "status", "in_progress"], { cwd: root });
    await dropStatus(root, "in_progress");
  };

  it("doctor fails rather than reporting the workflow valid", async () => {
    await withTmpLoctt(async ({ root }) => {
      await seedDrift(root);

      const doctor = await runCli(["doctor"], { cwd: root });
      const out = `${doctor.stdout}${doctor.stderr}`;

      // A tracker holding a value its own config does not define is not
      // healthy, and reporting it as such is what hides the problem.
      expect(doctor.exitCode).not.toBe(0);
      expect(out).toMatch(/in_progress/);
    });
  });

  it("names the affected task so it can be found", async () => {
    await withTmpLoctt(async ({ root }) => {
      await seedDrift(root);

      const doctor = await runCli(["doctor"], { cwd: root });
      // Knowing a value drifted is useless without knowing which tasks
      // hold it — the DSL cannot be used to search for it.
      expect(`${doctor.stdout}${doctor.stderr}`).toMatch(/T-1/);
    });
  });

  it("still reports a healthy workflow as ok", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "fine"], { cwd: root });
      const doctor = await runCli(["doctor"], { cwd: root });
      expect(doctor.exitCode).toBe(0);
    });
  });
});
