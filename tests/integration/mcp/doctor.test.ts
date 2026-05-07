import { describe, expect, it } from "vitest";

import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

describe("MCP doctor (stdio)", () => {
  it("returns prose diagnostic output", async () => {
    await withTmpLoctt(async ({ root }) => {
      const client = await startMcpClient(root);
      try {
        const result = await client.callTool("doctor", {});
        expect(result.isError).toBeFalsy();
        const text = result.content[0]?.text ?? "";
        expect(text).toContain(".loctt directory");
        expect(text).toContain("workflow.yaml");
      } finally {
        await client.close();
      }
    });
  });
});
