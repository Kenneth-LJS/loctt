import { execaSync } from "execa";
import { describe, expect, it } from "vitest";

import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

describe("MCP enable_git (stdio)", () => {
  it("enables git-backed mode", async () => {
    await withTmpLoctt(async ({ root }) => {
      execaSync("git", ["init"], { cwd: root });
      execaSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
      execaSync("git", ["config", "user.name", "test"], { cwd: root });
      execaSync("git", ["commit", "--allow-empty", "-m", "init"], { cwd: root });

      const client = await startMcpClient(root);
      try {
        const result = await client.callTool("enable_git", {});
        expect(result.isError).toBeFalsy();
        expect(result.content[0]?.text ?? "").toContain("enabled");
      } finally {
        await client.close();
      }
    });
  });
});
