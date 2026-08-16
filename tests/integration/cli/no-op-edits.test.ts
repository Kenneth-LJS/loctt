import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * Audit group E: `user` / `label` / `milestone` / `sprint` `edit` with
 * no flags reported success.
 *
 * `loctt user edit Ken` printed "Updated user <id>" and exited 0 having
 * changed nothing — which reads as confirmation that a rename landed.
 * The likeliest way to reach it is a typo'd flag name, and until the
 * exit-code work above, that typo was silently dropped too: both halves
 * of the mistake reported success.
 *
 * Also covers `loctt ui --port`, where `Number(x) || undefined` mapped
 * "abc", "0" and "" alike to "pick any free port" — so a typo'd port
 * started the server somewhere the user was not looking.
 */
describe("edits that change nothing (spawned binary)", () => {
  /** Creates the entity each case edits, then returns its ref. */
  async function seed(root: string): Promise<void> {
    await runCli(["user", "create", "Ken"], { cwd: root });
    await runCli(["label", "create", "bug"], { cwd: root });
    await runCli(["milestone", "create", "v1"], { cwd: root });
    await runCli(
      ["sprint", "create", "s1", "--start", "2026-01-01", "--end", "2026-01-14"],
      { cwd: root },
    );
  }

  const CASES: Array<[string, string[], string[]]> = [
    ["user", ["user", "edit", "Ken"], ["--name", "Kenneth"]],
    ["label", ["label", "edit", "bug"], ["--name", "defect"]],
    ["milestone", ["milestone", "edit", "v1"], ["--name", "v1.0"]],
    ["sprint", ["sprint", "edit", "s1"], ["--name", "sprint-one"]],
  ];

  it.each(CASES)("refuses a no-op %s edit", async (_label, argv) => {
    await withTmpLoctt(async ({ root }) => {
      await seed(root);
      const result = await runCli(argv, { cwd: root });
      // Usage, not runtime: the command was invoked wrongly.
      expect(result.exitCode).toBe(2);
      const text = `${result.stdout}${result.stderr}`;
      expect(text).toMatch(/nothing to change/i);
      // And it must not claim to have updated anything.
      expect(result.stdout).not.toMatch(/Updated/i);
    });
  });

  it.each(CASES)("still performs a real %s edit", async (_label, argv, flags) => {
    await withTmpLoctt(async ({ root }) => {
      await seed(root);
      // Guards the fix from over-reaching: naming one thing to change
      // must still work.
      const result = await runCli([...argv, ...flags], { cwd: root });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/Updated/i);
    });
  });
});

describe("loctt ui --port validation (spawned binary)", () => {
  it.each(["abc", "0", "70000", "-1"])("refuses --port %s", async (port) => {
    await withTmpLoctt(async ({ root }) => {
      const result = await runCli(["ui", "--port", port], { cwd: root });
      // The old behaviour started a server on a *random* port, so the
      // user's `localhost:3000` did not answer and nothing said why.
      expect(result.exitCode).toBe(2);
      expect(`${result.stdout}${result.stderr}`).toMatch(/--port (must be|needs) an integer/);
    });
  });
});
