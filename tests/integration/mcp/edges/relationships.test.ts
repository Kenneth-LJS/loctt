import { describe, expect, it } from "vitest";

import { runCli } from "../../adapters/cli-spawn.js";
import { startMcpClient } from "../../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../../fixtures/tmp-loctt.js";

describe("MCP link_tasks relationship edge cases (stdio)", () => {
  it("returns isError for an unknown relationship type", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "first"], { cwd: root });
      await runCli(["create", "second"], { cwd: root });

      const client = await startMcpClient(root);
      try {
        const result = await client.callTool("link_tasks", {
          ref: "T-1",
          type: "nonexistent_type",
          target: "T-2",
        });
        expect(result.isError).toBe(true);
        expect(result.content[0]?.text ?? "").toContain("unknown relationship type");
      } finally {
        await client.close();
      }
    });
  });

  it("returns isError for a link to a nonexistent target", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "first"], { cwd: root });

      const client = await startMcpClient(root);
      try {
        const result = await client.callTool("link_tasks", {
          ref: "T-1",
          type: "blocks",
          target: "T-99",
        });
        expect(result.isError).toBe(true);
        expect(result.content[0]?.text ?? "").toContain("not found");
      } finally {
        await client.close();
      }
    });
  });

  it("returns isError for a self-link", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "first"], { cwd: root });

      const client = await startMcpClient(root);
      try {
        const result = await client.callTool("link_tasks", {
          ref: "T-1",
          type: "blocks",
          target: "T-1",
        });
        expect(result.isError).toBe(true);
        expect(result.content[0]?.text ?? "").toContain("cannot link a task to itself");
      } finally {
        await client.close();
      }
    });
  });

  it("returns isError for a link from a nonexistent source", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "first"], { cwd: root });

      const client = await startMcpClient(root);
      try {
        const result = await client.callTool("link_tasks", {
          ref: "T-99",
          type: "blocks",
          target: "T-1",
        });
        expect(result.isError).toBe(true);
      } finally {
        await client.close();
      }
    });
  });
});
