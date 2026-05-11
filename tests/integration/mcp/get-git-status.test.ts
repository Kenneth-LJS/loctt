import { describe, expect, it } from "vitest";

import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

describe("MCP get_git_status (stdio)", () => {
  it("returns structured JSON describing git mode state", async () => {
    await withTmpLoctt(async ({ root }) => {
      const client = await startMcpClient(root);
      try {
        const result = await client.callTool("get_git_status", {});
        expect(result.isError).toBeFalsy();
        const parsed = JSON.parse(result.content[0]?.text ?? "{}") as Record<string, unknown>;
        expect(parsed["enabled"]).toBe(false);
        expect(typeof parsed["branch"]).toBe("string");
        expect("in_git_repo" in parsed).toBe(true);
        expect("last_synced_commit" in parsed).toBe(true);
      } finally {
        await client.close();
      }
    });
  });
});
