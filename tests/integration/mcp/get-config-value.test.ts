import { describe, expect, it } from "vitest";

import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

describe("MCP get_config_value (stdio)", () => {
  it("returns structured JSON with key, value, and type", async () => {
    await withTmpLoctt(async ({ root }) => {
      const client = await startMcpClient(root);
      try {
        const result = await client.callTool("get_config_value", { key: "git.enabled" });
        expect(result.isError).toBeFalsy();
        const parsed = JSON.parse(result.content[0]?.text ?? "{}") as Record<string, unknown>;
        expect(parsed["key"]).toBe("git.enabled");
        expect(parsed["type"]).toBe("boolean");
        expect(parsed["value"]).toBe(false);
      } finally {
        await client.close();
      }
    });
  });
});
