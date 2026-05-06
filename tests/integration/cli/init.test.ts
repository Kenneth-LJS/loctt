import { stat } from "node:fs/promises";
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
});
