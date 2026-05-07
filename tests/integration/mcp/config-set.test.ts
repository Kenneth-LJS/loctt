import { execaSync } from "execa";
import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

describe("MCP config_set (stdio)", () => {
  it("sets a config value and echoes the change", async () => {
    await withTmpLoctt(async ({ root }) => {
      execaSync("git", ["init"], { cwd: root });
      execaSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
      execaSync("git", ["config", "user.name", "test"], { cwd: root });
      execaSync("git", ["commit", "--allow-empty", "-m", "init"], { cwd: root });

      await runCli(["git", "enable"], { cwd: root });

      const client = await startMcpClient(root);
      try {
        const result = await client.callTool("config_set", {
          key: "git.auto_push",
          value: "false",
        });
        expect(result.isError).toBeFalsy();
        const text = result.content[0]?.text ?? "";
        expect(text).toContain("git.auto_push");
        expect(text).toContain("false");
      } finally {
        await client.close();
      }
    });
  });
});
