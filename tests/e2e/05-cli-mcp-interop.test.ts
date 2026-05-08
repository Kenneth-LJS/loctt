import { describe, expect, it } from "vitest";

import { runCli } from "../integration/adapters/cli-spawn.js";
import { startMcpClient } from "../integration/adapters/mcp-stdio.js";
import { withTmpLoctt } from "../integration/fixtures/tmp-loctt.js";

describe("E2E journey: CLI <-> MCP interop", () => {
  it("mutations made on one surface are visible from the other", async () => {
    await withTmpLoctt(async ({ root }) => {
      // Create T-1 via CLI
      const create = await runCli(["create", "interop"], { cwd: root });
      expect(create.exitCode).toBe(0);

      const client = await startMcpClient(root);
      try {
        // Read T-1 via MCP
        const got = await client.callTool("get_task", { ref: "T-1" });
        expect(got.isError).toBeFalsy();
        expect(got.content[0]?.text ?? "").toContain("interop");

        // Update via MCP
        const upd = await client.callTool("update_task", {
          ref: "T-1", field: "status", value: "in_progress",
        });
        expect(upd.isError).toBeFalsy();

        // Read back via CLI — sees the MCP write
        const show = await runCli(["show", "T-1"], { cwd: root });
        expect(show.exitCode).toBe(0);
        expect(show.stdout).toContain("Status: in_progress");

        // Mutate via CLI
        const setPrio = await runCli(["set", "T-1", "priority", "high"], { cwd: root });
        expect(setPrio.exitCode).toBe(0);

        // Read via MCP — sees the CLI write
        const got2 = await client.callTool("get_task", { ref: "T-1" });
        expect(got2.isError).toBeFalsy();
        expect(got2.content[0]?.text ?? "").toContain("high");
      } finally {
        await client.close();
      }
    });
  });
});
