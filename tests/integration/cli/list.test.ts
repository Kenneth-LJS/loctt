import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

describe("CLI list (spawned binary)", () => {
  it("shows all tasks", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "alpha"], { cwd: root });
      await runCli(["create", "beta"], { cwd: root });

      const result = await runCli(["list"], { cwd: root });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("alpha");
      expect(result.stdout).toContain("beta");
    });
  });

  it("hides archived tasks by default", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "active task"], { cwd: root });
      await runCli(["create", "to be archived"], { cwd: root });
      await runCli(["archive", "T-2"], { cwd: root });

      const result = await runCli(["list"], { cwd: root });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("active task");
      expect(result.stdout).not.toContain("to be archived");
    });
  });

  it("includes archived tasks when --archived is passed", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "active task"], { cwd: root });
      await runCli(["create", "to be archived"], { cwd: root });
      await runCli(["archive", "T-2"], { cwd: root });

      const result = await runCli(["list", "--archived"], { cwd: root });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("active task");
      expect(result.stdout).toContain("to be archived");
    });
  });

  it("respects an explicit archived filter in --query", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "active task"], { cwd: root });
      await runCli(["create", "to be archived"], { cwd: root });
      await runCli(["archive", "T-2"], { cwd: root });

      // User explicitly asks for archived tasks — don't silently filter them out
      const result = await runCli(["list", "--query", "archived = true"], { cwd: root });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("to be archived");
      expect(result.stdout).not.toContain("active task");
    });
  });
});
