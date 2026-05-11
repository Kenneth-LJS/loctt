import { execaSync } from "execa";
import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

describe("MCP unset_config_value (stdio)", () => {
  it("unsets a config key and echoes the change", async () => {
    await withTmpLoctt(async ({ root }) => {
      execaSync("git", ["init"], { cwd: root });
      execaSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
      execaSync("git", ["config", "user.name", "test"], { cwd: root });
      execaSync("git", ["commit", "--allow-empty", "-m", "init"], { cwd: root });

      await runCli(["git", "enable"], { cwd: root });
      await runCli(["config", "set", "git.auto_push", "false"], { cwd: root });

      const client = await startMcpClient(root);
      try {
        const result = await client.callTool("unset_config_value", { key: "git.auto_push" });
        expect(result.isError).toBeFalsy();
        expect(result.content[0]?.text ?? "").toContain("git.auto_push");
      } finally {
        await client.close();
      }
    });
  });
});
