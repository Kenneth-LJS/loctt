import { execaSync } from "execa";
import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

describe("MCP sync_from_git (stdio)", () => {
  it("syncs the loctt branch into local workspace", async () => {
    await withTmpLoctt(async ({ root }) => {
      execaSync("git", ["init"], { cwd: root });
      execaSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
      execaSync("git", ["config", "user.name", "test"], { cwd: root });
      execaSync("git", ["commit", "--allow-empty", "-m", "init"], { cwd: root });

      const enable = await runCli(["git", "enable"], { cwd: root });
      expect(enable.exitCode).toBe(0);

      const client = await startMcpClient(root);
      try {
        const result = await client.callTool("sync_from_git", {});
        expect(result.isError).toBeFalsy();
        expect(result.content[0]?.text ?? "").toMatch(/up to date|Synced/);
      } finally {
        await client.close();
      }
    });
  });
});
