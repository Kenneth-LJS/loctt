import { lookupTask, resolveLocttDir } from "@loctt/core";
import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * @verifies TSK-C5
 *
 * Core's createTask has accepted assignee, labels, due_date, milestone
 * and sprint from the start. The CLI exposed four flags and MCP five
 * parameters, so the same "create a task" meant different things
 * depending on where you stood — and an agent had to follow every create
 * with update calls for the rest.
 */
describe("create accepts the same initial fields on CLI and MCP", () => {
  const setup = async (root: string): Promise<void> => {
    await runCli(["milestone", "create", "v1"], { cwd: root });
    await runCli(
      ["sprint", "create", "S1", "--start", "2026-05-01", "--end", "2026-05-14", "--state", "active"],
      { cwd: root },
    );
    await runCli(["label", "create", "urgent"], { cwd: root });
  };

  it("accepts all six on the CLI", async () => {
    await withTmpLoctt(async ({ root }) => {
      await setup(root);
      const current = await runCli(["user", "current"], { cwd: root });
      const user = current.stdout.trim().split(/\s+/)[1] ?? "";

      const res = await runCli([
        "create", "full",
        "--assignee", user,
        "--due", "2026-12-01",
        "--milestone", "v1",
        "--sprint", "S1",
        "--label", "urgent",
        "--body", "a description",
      ], { cwd: root });
      expect(res.exitCode, `${res.stdout}${res.stderr}`).toBe(0);

      const show = await runCli(["show", "T-1"], { cwd: root });
      expect(show.stdout).toMatch(/2026-12-01/);
      expect(show.stdout).toMatch(/a description/);
    });
  });

  it("accepts all six on MCP", async () => {
    await withTmpLoctt(async ({ root }) => {
      await setup(root);
      const client = await startMcpClient(root);
      try {
        const res = await client.callTool("create_task", {
          title: "full",
          due_date: "2026-12-01",
          milestone: "v1",
          sprint: "S1",
          body: "a description",
        });
        expect(res.isError, res.content[0]?.text).toBeFalsy();

        const got = await client.callTool("get_task", { ref: "T-1" });
        expect(got.content[0]?.text ?? "").toMatch(/2026-12-01/);
      } finally {
        await client.close();
      }
    });
  });

  // K140: these two tests used to assert `show` printed /parent → T-1/.
  // That regex also matched the bug's output, `parent → T-1… (deleted)`
  // (the child stored the key "T-1" and the parent had no child edge),
  // so both stayed green while the feature was broken. They now check
  // what is stored on both tasks.
  const expectLinkedBothWays = async (root: string, childKey: string, parentKey: string): Promise<void> => {
    const locttDir = resolveLocttDir(root);
    const child = await lookupTask(locttDir, childKey);
    const parent = await lookupTask(locttDir, parentKey);
    expect(child.frontmatter.relationships).toEqual([{ type: "parent", target: parent.frontmatter.id }]);
    expect(parent.frontmatter.relationships).toEqual([{ type: "child", target: child.frontmatter.id }]);
  };

  it("links a parent under the tree axis on the CLI (--parent)", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "the parent"], { cwd: root });
      const res = await runCli(["create", "the child", "--parent", "T-1"], { cwd: root });
      expect(res.exitCode, `${res.stdout}${res.stderr}`).toBe(0);
      await expectLinkedBothWays(root, "T-2", "T-1");

      const show = await runCli(["show", "T-2"], { cwd: root });
      expect(show.stdout).toMatch(/ {2}parent → T-1 {2}the parent/);
      expect(show.stdout).not.toMatch(/deleted/);
    });
  });

  it("links a parent under the tree axis on MCP (parent)", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "the parent"], { cwd: root });
      const client = await startMcpClient(root);
      try {
        const res = await client.callTool("create_task", {
          title: "the child",
          parent: "T-1",
        });
        expect(res.isError, res.content[0]?.text).toBeFalsy();
      } finally {
        await client.close();
      }
      await expectLinkedBothWays(root, "T-2", "T-1");
    });
  });

  it("fails naming the field rather than discarding it", async () => {
    await withTmpLoctt(async ({ root }) => {
      // An unknown field must be refused: a create that silently drops
      // half its input is worse than one that refuses.
      const res = await runCli(["create", "x", "--nosuchfield", "y"], { cwd: root });
      expect(res.exitCode).not.toBe(0);
      expect(`${res.stdout}${res.stderr}`).toMatch(/nosuchfield/);
    });
  });
});
