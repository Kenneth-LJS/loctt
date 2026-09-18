import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/** MCP `bulk_update_tasks` (CW-4). */
describe("MCP bulk_update_tasks (stdio)", () => {
  it("sets a field across several tasks and reports the split", async () => {
    await withTmpLoctt(async ({ root }) => {
      for (const t of ["a", "b", "c"]) await runCli(["create", t], { cwd: root });
      const client = await startMcpClient(root);
      try {
        const res = await client.callTool("bulk_update_tasks", {
          refs: ["T-1", "T-2"], field: "status", value: "in_progress",
        });
        expect(res.isError).toBeFalsy();
        expect(res.content[0]?.text ?? "").toContain("2 updated, 0 failed");

        const shown = await client.callTool("get_task", { ref: "T-1" });
        expect(shown.content[0]?.text ?? "").toContain("in_progress");
      } finally {
        await client.close();
      }
    });
  });

  it("clears the field when value is omitted", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "a"], { cwd: root });
      await runCli(["set", "T-1", "priority", "high"], { cwd: root });
      const client = await startMcpClient(root);
      try {
        const res = await client.callTool("bulk_update_tasks", {
          refs: ["T-1"], field: "priority",
        });
        expect(res.isError).toBeFalsy();
        const shown = await client.callTool("get_task", { ref: "T-1" });
        expect(shown.content[0]?.text ?? "").not.toContain("high");
      } finally {
        await client.close();
      }
    });
  });

  it("reports a bad ref without aborting the rest", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "a"], { cwd: root });
      const client = await startMcpClient(root);
      try {
        const res = await client.callTool("bulk_update_tasks", {
          refs: ["T-1", "T-404"], field: "status", value: "done",
        });
        const out = res.content[0]?.text ?? "";
        expect(out).toContain("1 updated, 1 failed");
        expect(out).toContain("T-404");
      } finally {
        await client.close();
      }
    });
  });
});
