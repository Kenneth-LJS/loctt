import { writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * @verifies ONB-C5
 * @verifies TSK-C4
 * @verifies REL-C2
 *
 * `getTrackerInfo` computes a schema status that neither surface
 * printed, so the one command whose job is "what is this tracker" left
 * out the fact that decides whether any other command will run.
 */
describe("loctt info reports schema status", () => {
  it("names the current version on a healthy tracker", async () => {
    await withTmpLoctt(async ({ root }) => {
      const res = await runCli(["info"], { cwd: root });
      expect(res.exitCode).toBe(0);
      expect(res.stdout).toMatch(/Schema: 0\.4\.0 \(current\)/);
    });
  });

  it("names the mismatch rather than printing a bare number", async () => {
    await withTmpLoctt(async ({ root }) => {
      // K142: newer is refused naming the release to install.
      await writeFile(path.join(root, ".loctt/.schema-version"), "9.9.9\n", "utf-8");

      const res = await runCli(["info"], { cwd: root });
      const out = `${res.stdout}${res.stderr}`;
      expect(out).toMatch(/Schema: 9\.9\.9, this build reads 0\.4\.0/);
      // Not just the number: what to do about it.
      expect(out).toMatch(/This tracker needs loctt 9\.9\.9 or newer/);
    });
  });

  // K154 (was K143's "the next command upgrades it", the superseded
  // rule): info describes and never writes, and says what to run.
  it("reports an older tracker as needing an upgrade, and leaves it as it is", async () => {
    await withTmpLoctt(async ({ root }) => {
      await writeFile(path.join(root, ".loctt/.schema-version"), "0.1.0\n", "utf-8");
      const res = await runCli(["info"], { cwd: root });
      expect(res.exitCode).toBe(0);
      expect(res.stdout).toContain(
        "Schema: needs upgrading from 0.1.0 to 0.4.0. Run `loctt migrate` (a backup is made first)",
      );
      const { readFile } = await import("node:fs/promises");
      expect((await readFile(path.join(root, ".loctt/.schema-version"), "utf-8")).trim()).toBe("0.1.0");
    });
  });

  it("still runs when the version is missing entirely", async () => {
    await withTmpLoctt(async ({ root }) => {
      const { rm } = await import("node:fs/promises");
      await rm(path.join(root, ".loctt/.schema-version"), { force: true });

      // info is exempt from the boot guard for the same reason doctor
      // is: it describes the tracker, and this is one of the states
      // worth describing.
      const res = await runCli(["info"], { cwd: root });
      expect(res.exitCode).toBe(0);
      expect(res.stdout).toMatch(/not recorded/i);
    });
  });
});

describe("unset and link edge cases behave the same everywhere", () => {
  it("unsetting a never-set field succeeds quietly (TSK-C4)", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "a"], { cwd: root });
      // Idempotent: a script that clears a field should not have to
      // check whether it was set first.
      const res = await runCli(["unset", "T-1", "assignee"], { cwd: root });
      expect(res.exitCode).toBe(0);
    });
  });

  it("refuses an unknown relationship type, listing the known ones (REL-C2)", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "a"], { cwd: root });
      await runCli(["create", "b"], { cwd: root });

      const res = await runCli(["link", "T-1", "nosuchrel", "T-2"], { cwd: root });
      expect(res.exitCode).not.toBe(0);
      // The vocabulary is configurable, so naming it is the only way
      // the user can know what to type.
      expect(`${res.stdout}${res.stderr}`).toMatch(/blocks/);
    });
  });
});
