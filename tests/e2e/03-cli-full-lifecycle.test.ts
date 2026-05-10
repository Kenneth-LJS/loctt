import { readdir } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../integration/adapters/cli-spawn.js";
import { withTmpLoctt } from "../integration/fixtures/tmp-loctt.js";

describe("E2E journey: CLI-only full lifecycle", () => {
  it("walks every CLI mutation and verifies state at each step", async () => {
    await withTmpLoctt(async ({ root }) => {
      // create T-1, T-2
      expect((await runCli(["create", "primary"], { cwd: root })).exitCode).toBe(0);
      expect((await runCli(["create", "secondary"], { cwd: root })).exitCode).toBe(0);

      const show1 = await runCli(["show", "T-1"], { cwd: root });
      expect(show1.exitCode).toBe(0);
      expect(show1.stdout).toContain("primary");

      // set status
      expect((await runCli(["set", "T-1", "status", "in_progress"], { cwd: root })).exitCode).toBe(0);
      expect((await runCli(["show", "T-1"], { cwd: root })).stdout).toContain("Status: in_progress");

      // set priority
      expect((await runCli(["set", "T-1", "priority", "high"], { cwd: root })).exitCode).toBe(0);
      expect((await runCli(["show", "T-1"], { cwd: root })).stdout).toContain("Priority: high");

      // body --set
      expect((await runCli(["body", "T-1", "--set", "first body"], { cwd: root })).exitCode).toBe(0);
      expect((await runCli(["show", "T-1"], { cwd: root })).stdout).toContain("first body");

      // body --append
      expect((await runCli(["body", "T-1", "--append", "more text"], { cwd: root })).exitCode).toBe(0);
      const afterAppend = await runCli(["show", "T-1"], { cwd: root });
      expect(afterAppend.stdout).toContain("first body");
      expect(afterAppend.stdout).toContain("more text");

      // link
      expect((await runCli(["link", "T-1", "blocks", "T-2"], { cwd: root })).exitCode).toBe(0);
      expect((await runCli(["show", "T-1"], { cwd: root })).stdout).toMatch(/blocks → T-2/);

      // unlink
      expect((await runCli(["unlink", "T-1", "blocks", "T-2"], { cwd: root })).exitCode).toBe(0);
      expect((await runCli(["show", "T-1"], { cwd: root })).stdout).not.toMatch(/blocks → T-2/);

      // archive
      expect((await runCli(["archive", "T-1"], { cwd: root })).exitCode).toBe(0);
      expect((await runCli(["show", "T-1"], { cwd: root })).stdout).toContain("Archived:");

      // unarchive
      expect((await runCli(["unarchive", "T-1"], { cwd: root })).exitCode).toBe(0);
      expect((await runCli(["show", "T-1"], { cwd: root })).stdout).not.toContain("Archived:");

      // delete --hard (soft-delete is the default; --hard removes the directory)
      expect((await runCli(["delete", "T-1", "--hard"], { cwd: root })).exitCode).toBe(0);
      const showDeleted = await runCli(["show", "T-1"], { cwd: root });
      expect(showDeleted.exitCode).not.toBe(0);

      // T-2 still exists; tasks dir holds exactly one entry.
      const ids = await readdir(path.join(root, ".loctt/tasks"));
      expect(ids.length).toBe(1);
    });
  });
});
