import { describe, expect, it } from "vitest";

import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

describe("MCP get_workflow_config (stdio)", () => {
  it("returns the workflow configuration", async () => {
    await withTmpLoctt(async ({ root }) => {
      const client = await startMcpClient(root);
      try {
        const result = await client.callTool("get_workflow_config", {});

        expect(result.isError).toBeFalsy();
        const text = result.content[0]?.text ?? "";
        // `not_started` was renamed to `backlog` in the shipped default;
        // this assertion outlived it and had been failing since.
        expect(text).toContain("backlog");
        expect(text).toContain("in_progress");
        // The default-status flag must reach the agent: without it an
        // agent cannot know which status a task created without one
        // will land in.
        expect(text).toContain("\"default\": true");
      } finally {
        await client.close();
      }
    });
  });
});
