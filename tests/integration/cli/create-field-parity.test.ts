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

  it("pre-links a parent under the tree axis on the CLI (--parent)", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "the parent"], { cwd: root });
      const res = await runCli(["create", "the child", "--parent", "T-1"], { cwd: root });
      expect(res.exitCode, `${res.stdout}${res.stderr}`).toBe(0);

      // The default tree axis is `parent`, so the child carries a
      // `parent → T-1` edge — created by the create, not a follow-up link.
      const show = await runCli(["show", "T-2"], { cwd: root });
      expect(show.stdout).toContain("Relationships:");
      expect(show.stdout).toMatch(/parent → T-1/);
    });
  });

  it("pre-links a parent under the tree axis on MCP (parent)", async () => {
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
      const show = await runCli(["show", "T-2"], { cwd: root });
      expect(show.stdout).toMatch(/parent → T-1/);
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
