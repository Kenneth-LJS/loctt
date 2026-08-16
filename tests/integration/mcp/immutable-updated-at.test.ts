import { describe, expect, it } from "vitest";

import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * @verifies TSK-C2
 *
 * The CLI half lives in tests/integration/cli/immutable-updated-at.test.ts.
 * TSK-C2 is one requirement verified twice: both surfaces must refuse the
 * write, and both must say why. P10 — one mental model across three
 * front-ends — is the point of checking it here as well as there.
 */
describe("MCP update_task updated_at (stdio)", () => {
  it("refuses a direct write and leaves the stored value alone", async () => {
    await withTmpLoctt(async ({ root }) => {
      const client = await startMcpClient(root);
      try {
        await client.callTool("create_task", { title: "a task" });
        const before = await client.callTool("get_task", { ref: "T-1" });

        const result = await client.callTool("update_task", {
          ref: "T-1",
          field: "updated_at",
          value: "2020-01-01T00:00:00.000Z",
        });

        expect(result.isError).toBeTruthy();
        expect(result.content[0]?.text ?? "").toMatch(/updated_at/);

        const after = await client.callTool("get_task", { ref: "T-1" });
        expect(after.content[0]?.text).toBe(before.content[0]?.text);
      } finally {
        await client.close();
      }
    });
  });
});
