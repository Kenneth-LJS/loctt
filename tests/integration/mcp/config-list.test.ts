import { describe, expect, it } from "vitest";

import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

describe("MCP config_list (stdio)", () => {
  it("returns an array of config key entries with type and description", async () => {
    await withTmpLoctt(async ({ root }) => {
      const client = await startMcpClient(root);
      try {
        const result = await client.callTool("config_list", {});
        expect(result.isError).toBeFalsy();
        const parsed = JSON.parse(result.content[0]?.text ?? "[]") as Array<Record<string, unknown>>;
        expect(Array.isArray(parsed)).toBe(true);
        const keys = parsed.map(p => p["key"]);
        expect(keys).toContain("git.enabled");
        expect(keys).toContain("git.remote");
        const enabled = parsed.find(p => p["key"] === "git.enabled");
        expect(enabled?.["type"]).toBe("boolean");
        expect(typeof enabled?.["description"]).toBe("string");
      } finally {
        await client.close();
      }
    });
  });
});
