import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

describe("CLI init (spawned binary)", () => {
  it("initializes a fresh workspace", async () => {
    await withTmpLoctt(async ({ root }) => {
      const result = await runCli(["init"], { cwd: root });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Initialized");

      const workflow = await stat(path.join(root, ".loctt/config/workflow.yaml"));
      expect(workflow.isFile()).toBe(true);
    }, { init: false });
  });

  it("respects a custom prefix", async () => {
    await withTmpLoctt(async ({ root }) => {
      const result = await runCli(["init", "--prefix", "BUG-"], { cwd: root });
      expect(result.exitCode).toBe(0);

      const info = await runCli(["info"], { cwd: root });
      expect(info.exitCode).toBe(0);
      expect(info.stdout).toContain("BUG-");
    }, { init: false });
  });

  it("names the starting project from --project-label", async () => {
    // The flag was read and then dropped: core's option is
    // `projectName`, and every surface passed `projectLabel`, which
    // `InitOptions` does not have. It cost nothing at the type level
    // because a conditional spread is not excess-property-checked, and
    // no test anywhere mentioned the flag.
    await withTmpLoctt(async ({ root }) => {
      const result = await runCli(
        ["init", "--project-label", "Bug tracker"],
        { cwd: root },
      );
      expect(result.exitCode).toBe(0);

      const projects = await readFile(
        path.join(root, ".loctt/config/projects.yaml"),
        "utf8",
      );
      expect(projects).toContain("Bug tracker");
      expect(projects).not.toContain("Tasks");
    }, { init: false });
  });

  it("defaults the project name when --project-label is omitted", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["init"], { cwd: root });
      const projects = await readFile(
        path.join(root, ".loctt/config/projects.yaml"),
        "utf8",
      );
      expect(projects).toContain("Tasks");
    }, { init: false });
  });
});
