import { stat } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

describe("MCP init (stdio)", () => {
  it("initializes a fresh workspace at the bound root", async () => {
    await withTmpLoctt(async ({ root }) => {
      const client = await startMcpClient(root);
      try {
        const result = await client.callTool("init", {});
        expect(result.isError).toBeFalsy();
        const text = result.content[0]?.text ?? "";
        expect(text).toContain("Initialized");

        const workflow = await stat(path.join(root, ".loctt/config/workflow.yaml"));
        expect(workflow.isFile()).toBe(true);
      } finally {
        await client.close();
      }
    }, { init: false });
  });
});
