import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * @verifies PRU-C3
 * @verifies PRU-C4
 * @verifies PRU-C6
 * @verifies MSL-C2
 *
 * Preconditions on destructive entity operations. All behaved correctly
 * and none was asserted — so a regression here would have shipped
 * silently, and these are the guards that stop a tracker losing its only
 * project or stranding its active user.
 */
describe("entity operations enforce their preconditions", () => {
  const cfg = async (root: string, file: string): Promise<string> =>
    readFile(path.join(root, ".loctt/config", file), "utf-8");

  it("resolves the ref before prompting or mutating (PRU-C3)", async () => {
    await withTmpLoctt(async ({ root }) => {
      const before = await cfg(root, "projects.yaml");

      // An unknown ref must fail on the ref, not after a confirmation
      // the user only sees because the command got that far.
      const res = await runCli(["project", "delete", "NoSuchProject", "--yes"], { cwd: root });
      expect(res.exitCode).not.toBe(0);
      expect(`${res.stdout}${res.stderr}`).toMatch(/unknown project/i);
      expect(await cfg(root, "projects.yaml")).toBe(before);
    });
  });

  it("refuses to delete the only project (PRU-C4)", async () => {
    await withTmpLoctt(async ({ root }) => {
      const res = await runCli(["project", "delete", "Tasks", "--yes"], { cwd: root });
      expect(res.exitCode).not.toBe(0);
      // A tracker with no projects cannot allocate a key, so nothing
      // could be created afterwards.
      expect(`${res.stdout}${res.stderr}`).toMatch(/only project/i);
    });
  });

  it("refuses to archive or delete the active user (PRU-C6)", async () => {
    await withTmpLoctt(async ({ root }) => {
      const current = await runCli(["user", "current"], { cwd: root });
      const name = current.stdout.trim().split(/\s+/)[1] ?? "";
      expect(name).not.toBe("");

      for (const argv of [
        ["user", "archive", name],
        ["user", "delete", name, "--yes"],
      ]) {
        const res = await runCli(argv, { cwd: root });
        expect(res.exitCode, argv.join(" ")).not.toBe(0);
        // Naming the remedy matters: "cannot archive" alone leaves the
        // user with no next step.
        expect(`${res.stdout}${res.stderr}`).toMatch(/switch to another user/i);
      }
    });
  });

  it("round-trips a label archive, removing the flag (MSL-C2)", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["label", "create", "Blocker"], { cwd: root });

      await runCli(["label", "archive", "Blocker"], { cwd: root });
      expect(await cfg(root, "labels.yaml")).toMatch(/archived: true/);

      await runCli(["label", "unarchive", "Blocker"], { cwd: root });
      // Absent, not `false` — one state, one shape.
      expect(await cfg(root, "labels.yaml")).not.toMatch(/archived:/);
    });
  });

  it("round-trips a milestone archive the same way (MSL-C2)", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["milestone", "create", "v1"], { cwd: root });

      await runCli(["milestone", "archive", "v1"], { cwd: root });
      expect(await cfg(root, "milestones.yaml")).toMatch(/archived: true/);

      await runCli(["milestone", "unarchive", "v1"], { cwd: root });
      expect(await cfg(root, "milestones.yaml")).not.toMatch(/archived:/);
    });
  });
});
