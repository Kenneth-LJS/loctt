import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * `get_workflow_key_usage` — the MCP half of core's
 * `computeWorkflowKeyCounts`.
 *
 * An agent asked to "clean up unused statuses" has no other way to
 * tell an unreferenced key from one nine tasks hold, and deleting the
 * second without a remap is refused by `applyWorkflowEdit` — so this
 * is what turns a blind edit into an informed one.
 */
describe("MCP get_workflow_key_usage (stdio)", () => {
  it("returns per-key task counts across every workflow collection", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "a", "--status", "in_progress"], { cwd: root });
      await runCli(["create", "b", "--status", "in_progress"], { cwd: root });
      await runCli(["create", "c"], { cwd: root });

      const client = await startMcpClient(root);
      try {
        const result = await client.callTool("get_workflow_key_usage", {});
        expect(result.isError).toBeFalsy();
        const parsed = JSON.parse(result.content[0]?.text ?? "{}") as {
          statuses: Record<string, number>;
          priorities: Record<string, number>;
          task_types: Record<string, number>;
          relationships: Record<string, number>;
          custom_field_values: Record<string, Record<string, number>>;
        };

        // Counts, not presence. A `1` here for `in_progress` would tell
        // an agent a two-task deletion was a one-task one.
        expect(parsed.statuses["in_progress"]).toBe(2);
        expect(parsed.statuses["backlog"]).toBe(1);
        // A key nothing references is absent, which is the documented
        // reading of "no tasks hold this".
        expect(parsed.statuses["done"]).toBeUndefined();

        // Every collection is present, so an agent can rely on the
        // shape without guarding each field.
        expect(parsed.priorities).toBeDefined();
        expect(parsed.task_types).toBeDefined();
        expect(parsed.relationships).toBeDefined();
        expect(parsed.custom_field_values).toBeDefined();
      } finally {
        await client.close();
      }
    });
  });

  it("agrees with the CLI's `config usage` on the same tracker", async () => {
    // P10: two surfaces must not answer the same question differently.
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "a", "--status", "in_progress"], { cwd: root });
      await runCli(["create", "b"], { cwd: root });

      const cli = await runCli(["config", "usage"], { cwd: root });
      const client = await startMcpClient(root);
      try {
        const result = await client.callTool("get_workflow_key_usage", {});
        const parsed = JSON.parse(result.content[0]?.text ?? "{}") as {
          statuses: Record<string, number>;
        };
        for (const [key, count] of Object.entries(parsed.statuses)) {
          expect(cli.stdout).toContain(`${key} = ${String(count)}`);
        }
      } finally {
        await client.close();
      }
    });
  });
});
