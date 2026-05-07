import { describe, expect, it } from "vitest";

import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

describe("MCP info (stdio)", () => {
  it("returns prose summary of the tracker", async () => {
    await withTmpLoctt(async ({ root }) => {
      const client = await startMcpClient(root);
      try {
        const result = await client.callTool("info", {});
        expect(result.isError).toBeFalsy();
        const text = result.content[0]?.text ?? "";
        expect(text).toContain("LocTT directory:");
        expect(text).toContain("Tasks:");
        expect(text).toContain("Key prefix:");
      } finally {
        await client.close();
      }
    });
  });
});
