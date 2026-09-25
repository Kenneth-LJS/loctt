import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * B21 (K129): saved-view names are unique. Ken: "if you save a view, and
 * the name already matches, then we should just error." Core refuses, so
 * `create_view` and a renaming `edit_view` both come back as tool errors
 * and write nothing.
 */
describe("MCP view names are unique (stdio)", () => {
  // @verifies VUE-20
  it("create_view and a renaming edit_view refuse a taken name", async () => {
    await withTmpLoctt(async ({ root }) => {
      const client = await startMcpClient(root);
      try {
        const first = await client.callTool("create_view", { name: "Overdue", filters: [] });
        expect(first.isError).toBeFalsy();
        const second = await client.callTool("create_view", { name: "mine", filters: [] });
        expect(second.isError).toBeFalsy();
        const queriesPath = path.join(root, ".loctt/config/queries.yaml");
        const before = await readFile(queriesPath, "utf8");

        const dup = await client.callTool("create_view", { name: "overdue ", filters: [] });
        expect(dup.isError).toBe(true);
        expect(dup.content[0]?.text).toContain("Another view with that name already exists.");

        const rename = await client.callTool("edit_view", { view: "mine", name: "OVERDUE" });
        expect(rename.isError).toBe(true);
        expect(rename.content[0]?.text).toContain("Another view with that name already exists.");

        expect(await readFile(queriesPath, "utf8")).toBe(before);
      } finally {
        await client.close();
      }
    });
  });
});
