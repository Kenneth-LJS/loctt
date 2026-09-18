import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/**
 * @verifies PRU-C8
 * @verifies GIT-C8
 * @verifies TSK-C9
 *
 * A tool description is the only thing an agent has to go on — it cannot
 * read the source. A description that claims behaviour the code does not
 * implement is worse than a missing one, because the agent acts on it.
 */
describe("MCP descriptions match what the tools do", () => {
  const reference = async (): Promise<string> =>
    readFile(path.join(repoRoot, "docs/user/mcp/reference.md"), "utf-8");

  it("does not name a tool that does not exist (PRU-C8)", async () => {
    await withTmpLoctt(async ({ root }) => {
      const client = await startMcpClient(root);
      try {
        const names = new Set((await client.listTools()).map(t => t.name));
        const doc = await reference();

        // Every `tool_name` the reference names as callable must exist.
        // set_user_setting was documented as step 2 of the project
        // resolution chain and existed nowhere.
        // Only headings: `### \`tool_name\`` is the reference's shape for
        // a callable tool. Matching every backticked identifier catches
        // field names like `bulk_op_id` too.
        for (const m of doc.matchAll(/^### `([a-z][a-z0-9_]+)`/gm)) {
          const word = m[1] ?? "";
          expect(names.has(word), `reference documents \`${word}\`, which no tool provides`).toBe(true);
        }
      } finally {
        await client.close();
      }
    });
  });

  it("enable_git does not claim to create the branch (GIT-C8)", async () => {
    await withTmpLoctt(async ({ root }) => {
      const client = await startMcpClient(root);
      try {
        const tools = await client.listTools();
        const desc = tools.find(t => t.name === "enable_git")?.description ?? "";
        expect(desc).not.toBe("");

        // The branch is created on first publish. Claiming otherwise
        // sends an agent looking for a branch that is not there.
        expect(desc).toMatch(/first publish|not here/i);
      } finally {
        await client.close();
      }
    });
  });

  it("points at the rank tools from the task section (TSK-C9)", async () => {
    const doc = await reference();
    // An agent reading about tasks should find the reorder tools
    // without scanning the Relationships section.
    expect(doc).toMatch(/### Reordering/);
    expect(doc).toMatch(/reorder_board/);
  });
});
