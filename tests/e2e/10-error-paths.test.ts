import { describe, expect, it } from "vitest";

import { runCli } from "../integration/adapters/cli-spawn.js";
import { withTmpLoctt } from "../integration/fixtures/tmp-loctt.js";

describe("E2E journey: error paths", () => {
  it("unknown command exits non-zero with usage hint", async () => {
    await withTmpLoctt(async ({ root }) => {
      const result = await runCli(["definitely-not-a-command"], { cwd: root });
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr.toLowerCase()).toMatch(/unknown command|usage/);
    });
  });

  it("unparseable query exits non-zero with parse error", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "t"], { cwd: root });
      const result = await runCli(["list", "--query", "broken {{{"], { cwd: root });
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toMatch(/Error|unexpected/i);
    });
  });

  it("show on a nonexistent ref exits non-zero", async () => {
    await withTmpLoctt(async ({ root }) => {
      const result = await runCli(["show", "T-99"], { cwd: root });
      expect(result.exitCode).not.toBe(0);
    });
  });

  it("self-link rejected", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "self"], { cwd: root });
      const result = await runCli(["link", "T-1", "blocks", "T-1"], { cwd: root });
      expect(result.exitCode).not.toBe(0);
    });
  });

  it("delete without --force exits non-zero", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "doomed"], { cwd: root });
      const result = await runCli(["delete", "T-1"], { cwd: root });
      expect(result.exitCode).not.toBe(0);
    });
  });

  it("config set before git enable exits non-zero", async () => {
    await withTmpLoctt(async ({ root }) => {
      const result = await runCli(["config", "set", "git.auto_push", "true"], { cwd: root });
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("git mode is not enabled");
    });
  });

  it("show without arguments exits non-zero with usage hint", async () => {
    await withTmpLoctt(async ({ root }) => {
      const result = await runCli(["show"], { cwd: root });
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr.toLowerCase()).toContain("usage");
    });
  });
});
