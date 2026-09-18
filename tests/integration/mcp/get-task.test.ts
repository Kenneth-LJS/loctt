import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

describe("MCP get_task (stdio)", () => {
  it("returns the task by key", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "fetch me"], { cwd: root });

      const client = await startMcpClient(root);
      try {
        const result = await client.callTool("get_task", { ref: "T-1" });

        expect(result.isError).toBeFalsy();
        const text = result.content[0]?.text ?? "";
        expect(text).toContain("fetch me");
        expect(text).toContain("T-1");
      } finally {
        await client.close();
      }
    });
  });

  it("returns relationship targets as user-facing keys, not raw IDs", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "first"], { cwd: root });
      await runCli(["create", "second"], { cwd: root });
      await runCli(["link", "T-1", "blocks", "T-2"], { cwd: root });

      const client = await startMcpClient(root);
      try {
        const result = await client.callTool("get_task", { ref: "T-1" });
        expect(result.isError).toBeFalsy();
        const text = result.content[0]?.text ?? "";
        const parsed = JSON.parse(text) as {
          relationships?: Array<{ type: string; target: string; title?: string; status?: string }>;
        };
        // The key, not the raw ULID — that is what this case is about.
        expect(parsed.relationships?.[0]).toMatchObject({ type: "blocks", target: "T-2" });
        // Title and status ride along so an agent learns what a linked
        // task is without a get_task per edge.
        expect(parsed.relationships?.[0]?.title).toBe("second");
        expect(parsed.relationships?.[0]?.status).toBe("backlog");
        // No ULIDs leaking through.
        expect(JSON.stringify(parsed.relationships)).not.toMatch(/[0-9A-HJKMNP-TV-Z]{26}/);
      } finally {
        await client.close();
      }
    });
  });
});
