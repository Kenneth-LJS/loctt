import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../integration/adapters/cli-spawn.js";
import { withTmpLoctt } from "../integration/fixtures/tmp-loctt.js";

describe("E2E journey: init variants", () => {
  it("default init creates the standard config files", async () => {
    await withTmpLoctt(async ({ root }) => {
      const result = await runCli(["init"], { cwd: root });
      expect(result.exitCode).toBe(0);

      const workflow = await stat(path.join(root, ".loctt/config/workflow.yaml"));
      expect(workflow.isFile()).toBe(true);
      const queries = await stat(path.join(root, ".loctt/config/queries.yaml"));
      expect(queries.isFile()).toBe(true);
    }, { init: false });
  });

  it("--prefix BUG sets the prefix and tasks are created with BUG-N keys", async () => {
    await withTmpLoctt(async ({ root }) => {
      const init = await runCli(["init", "--prefix", "BUG"], { cwd: root });
      expect(init.exitCode).toBe(0);

      const workflow = await readFile(path.join(root, ".loctt/config/workflow.yaml"), "utf-8");
      expect(workflow).toMatch(/prefix:\s*"?BUG"?/);

      const create = await runCli(["create", "first bug"], { cwd: root });
      expect(create.exitCode).toBe(0);
      expect(create.stdout).toContain("BUG-1");
    }, { init: false });
  });

  it("--no-docs skips docs generation", async () => {
    await withTmpLoctt(async ({ root }) => {
      const init = await runCli(["init", "--no-docs"], { cwd: root });
      expect(init.exitCode).toBe(0);

      const docsPath = path.join(root, ".loctt/docs");
      let exists = true;
      try {
        await stat(docsPath);
      } catch {
        exists = false;
      }
      // Either absent, or empty if present.
      if (exists) {
        const { readdir } = await import("node:fs/promises");
        const entries = await readdir(docsPath);
        expect(entries.length).toBe(0);
      } else {
        expect(exists).toBe(false);
      }
    }, { init: false });
  });

  it("re-init over an existing .loctt/ is refused with a clear error", async () => {
    await withTmpLoctt(async ({ root }) => {
      const first = await runCli(["init"], { cwd: root });
      expect(first.exitCode).toBe(0);

      const second = await runCli(["init"], { cwd: root });
      expect(second.exitCode).not.toBe(0);
      expect(second.stderr.toLowerCase()).toMatch(/already exists|already initialized/);
    }, { init: false });
  });
});
