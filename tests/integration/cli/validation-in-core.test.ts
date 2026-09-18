import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * V1: one rule in core, reported identically everywhere.
 *
 * Sprint state had four hand-maintained copies — two in the CLI, two in
 * MCP, one in core — and produced three different sentences for the
 * same rejected input:
 *
 *   CORE : state must be one of active|completed|future, got: bogus
 *   CLI  : --state must be one of active|completed|future
 *   MCP  : Invalid enum value. Expected 'active' | … received 'bogus'
 *
 * Only core's named the value the user actually passed, which is the
 * one piece of information that tells them what to change.
 */

describe("a rejected sprint state", () => {
  it("names the value the user passed, not just the valid set", async () => {
    await withTmpLoctt(async ({ root }) => {
      const r = await runCli(
        ["sprint", "create", "s1", "--start", "2026-01-01", "--end", "2026-01-14", "--state", "bogus"],
        { cwd: root },
      );

      expect(r.exitCode).not.toBe(0);
      const out = `${r.stdout}${r.stderr}`;
      // The CLI's own copy listed the valid states and stopped there.
      expect(out).toContain("bogus");
      expect(out).toMatch(/active\|completed\|future/);
    });
  });

  it("is still accepted when the state is valid", async () => {
    await withTmpLoctt(async ({ root }) => {
      const r = await runCli(
        ["sprint", "create", "s1", "--start", "2026-01-01", "--end", "2026-01-14", "--state", "active"],
        { cwd: root },
      );
      // Guards against the check rejecting everything — deleting the
      // CLI's copy must not have deleted the behaviour.
      expect(r.exitCode).toBe(0);
    });
  });

  it("rejects on MCP too, so the rule is not CLI-only", async () => {
    await withTmpLoctt(async ({ root }) => {
      const client = await startMcpClient(root);
      try {
        const result = await client.callTool("create_sprint", {
          name: "s1",
          start_date: "2026-01-01",
          end_date: "2026-01-14",
          state: "bogus",
        });
        expect(result.isError).toBe(true);
      } finally {
        await client.close();
      }
    });
  });
});

describe("an archived reference is distinguishable from a bad value", () => {
  it("core names the cause rather than leaving it to a status guess", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["milestone", "create", "v1"], { cwd: root });
      await runCli(["milestone", "archive", "v1"], { cwd: root });
      // Read the key from the output: `withTmpLoctt`'s prefix is not
      // guaranteed to be `T`, and assuming it made this assert against
      // a task-not-found instead of the archived guard.
      const created = await runCli(["create", "a task"], { cwd: root });
      const key = /Created (\S+):/.exec(created.stdout)?.[1];
      expect(key).toBeDefined();

      const r = await runCli(["set", key as string, "milestone", "v1"], { cwd: root });

      expect(r.exitCode).not.toBe(0);
      // The web used to infer the code from the 400 and report this as
      // `validation_failed` — same as a typo'd status, though the fix
      // is entirely different. The message says which it is.
      expect(`${r.stdout}${r.stderr}`).toMatch(/archived/i);
    });
  });
});
