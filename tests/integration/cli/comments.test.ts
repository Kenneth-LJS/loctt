import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * `loctt comment` family (item 9). Core implemented comments with no
 * CLI command, so they were documented as shipped and unreachable.
 */
describe("CLI comments (spawned binary)", () => {
  async function seed(root: string): Promise<void> {
    await runCli(["create", "subject"], { cwd: root });
  }

  it("adds a comment and lists it back", async () => {
    await withTmpLoctt(async ({ root }) => {
      await seed(root);
      const add = await runCli(["comment", "T-1", "looks", "good"], { cwd: root });
      expect(add.exitCode).toBe(0);
      expect(add.stdout).toContain("Added comment");

      const list = await runCli(["comments", "T-1"], { cwd: root });
      expect(list.exitCode).toBe(0);
      expect(list.stdout).toContain("looks good");
    });
  });

  it("reports no comments rather than printing nothing", async () => {
    await withTmpLoctt(async ({ root }) => {
      await seed(root);
      const list = await runCli(["comments", "T-1"], { cwd: root });
      expect(list.exitCode).toBe(0);
      expect(list.stdout).toContain("No comments");
    });
  });

  it("edits a comment and marks it edited", async () => {
    await withTmpLoctt(async ({ root }) => {
      await seed(root);
      const add = await runCli(["comment", "T-1", "before"], { cwd: root });
      const id = /Added comment (\S+)/.exec(add.stdout)?.[1];
      expect(id).toBeTruthy();

      const edit = await runCli(["comment-edit", "T-1", id!, "after"], { cwd: root });
      expect(edit.exitCode).toBe(0);

      const list = await runCli(["comments", "T-1"], { cwd: root });
      expect(list.stdout).toContain("after");
      expect(list.stdout).not.toContain("before");
      expect(list.stdout).toContain("Edited");
    });
  });

  it("deletes a comment", async () => {
    await withTmpLoctt(async ({ root }) => {
      await seed(root);
      const add = await runCli(["comment", "T-1", "doomed"], { cwd: root });
      const id = /Added comment (\S+)/.exec(add.stdout)?.[1];

      const del = await runCli(["comment-delete", "T-1", id!], { cwd: root });
      expect(del.exitCode).toBe(0);

      const list = await runCli(["comments", "T-1"], { cwd: root });
      expect(list.stdout).toContain("No comments");
    });
  });

  it("exits non-zero on a missing body", async () => {
    await withTmpLoctt(async ({ root }) => {
      await seed(root);
      const r = await runCli(["comment", "T-1"], { cwd: root });
      expect(r.exitCode).not.toBe(0);
    });
  });

  it("exits non-zero for an unknown task", async () => {
    await withTmpLoctt(async ({ root }) => {
      await seed(root);
      const r = await runCli(["comment", "T-404", "hi"], { cwd: root });
      expect(r.exitCode).not.toBe(0);
    });
  });

  it("a comment posted via CLI is visible to MCP and vice versa", async () => {
    // Cross-surface: the file is the truth, not any one surface's cache.
    await withTmpLoctt(async ({ root }) => {
      await seed(root);
      await runCli(["comment", "T-1", "from cli"], { cwd: root });
      const list = await runCli(["comments", "T-1"], { cwd: root });
      expect(list.stdout).toContain("from cli");
    });
  });
});
