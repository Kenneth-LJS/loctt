import { describe, expect, it } from "vitest";

import { runCli } from "../../adapters/cli-spawn.js";
import { withTmpLoctt } from "../../fixtures/tmp-loctt.js";

describe("CLI body edge cases (spawned binary)", () => {
  it("set empty body and read back as empty", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "t"], { cwd: root });

      const set = await runCli(["body", "T-1", "--set", ""], { cwd: root });
      expect(set.exitCode).toBe(0);

      const read = await runCli(["body", "T-1"], { cwd: root });
      expect(read.exitCode).toBe(0);
      expect(read.stdout).toContain("(empty body)");
    });
  });

  it("100KB body round-trips intact", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "t"], { cwd: root });

      const big = "x".repeat(100_000);
      const set = await runCli(["body", "T-1", "--set", big], { cwd: root });
      expect(set.exitCode).toBe(0);

      const read = await runCli(["body", "T-1"], { cwd: root });
      expect(read.exitCode).toBe(0);
      // Allow trailing newline added by the read.
      expect(read.stdout.replace(/\n$/, "")).toBe(big);
    });
  });

  it("unicode and emoji body round-trips", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "t"], { cwd: root });

      const text = "日本語 🎉 testing";
      const set = await runCli(["body", "T-1", "--set", text], { cwd: root });
      expect(set.exitCode).toBe(0);

      const read = await runCli(["body", "T-1"], { cwd: root });
      expect(read.exitCode).toBe(0);
      expect(read.stdout).toContain(text);
    });
  });

  it("body containing --- delimiter does not corrupt frontmatter parse", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "t"], { cwd: root });

      const text = "intro\n---\nmore content";
      const set = await runCli(["body", "T-1", "--set", text], { cwd: root });
      expect(set.exitCode).toBe(0);

      const read = await runCli(["body", "T-1"], { cwd: root });
      expect(read.exitCode).toBe(0);
      expect(read.stdout).toContain("intro");
      expect(read.stdout).toContain("---");
      expect(read.stdout).toContain("more content");

      // The task is still parseable: show should still work.
      const show = await runCli(["show", "T-1"], { cwd: root });
      expect(show.exitCode).toBe(0);
      expect(show.stdout).toContain("T-1");
    });
  });

  it("append to a fresh task produces no leading newlines", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "t"], { cwd: root });

      const append = await runCli(["body", "T-1", "--append", "first"], { cwd: root });
      expect(append.exitCode).toBe(0);

      const read = await runCli(["body", "T-1"], { cwd: root });
      expect(read.exitCode).toBe(0);
      expect(read.stdout.replace(/\n$/, "")).toBe("first");
    });
  });

  it("append after another append separates with a single blank line", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "t"], { cwd: root });
      await runCli(["body", "T-1", "--append", "first"], { cwd: root });
      const second = await runCli(["body", "T-1", "--append", "second"], { cwd: root });
      expect(second.exitCode).toBe(0);

      const read = await runCli(["body", "T-1"], { cwd: root });
      expect(read.stdout).toMatch(/first\n\nsecond/);
      // Exactly one blank line, not two.
      expect(read.stdout).not.toMatch(/first\n\n\nsecond/);
    });
  });
});
