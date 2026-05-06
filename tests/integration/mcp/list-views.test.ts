import { describe, expect, it } from "vitest";

import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

describe("MCP list_views (stdio)", () => {
  it("returns saved views without error", async () => {
    await withTmpLoctt(async ({ root }) => {
      const client = await startMcpClient(root);
      try {
        const result = await client.callTool("list_views", {});

        expect(result.isError).toBeFalsy();
        expect(result.content[0]?.text).toBeDefined();
      } finally {
        await client.close();
      }
    });
  });
});
