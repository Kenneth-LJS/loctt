import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * @verifies PRU-C16
 *
 * K148: MCP results return both the ID and the name of every entity they
 * refer to. The additions are sibling fields, so existing fields keep
 * their shape (the ID stays where it was).
 */
const ID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

describe("MCP returns names beside IDs (K148)", () => {
  it("get_task, get_task_history and the entity tools", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["user", "create", "Bea"], { cwd: root });
      await runCli(["label", "create", "urgent"], { cwd: root });
      await runCli(["milestone", "create", "GA"], { cwd: root });
      await runCli(
        ["create", "named", "--assignee", "Bea", "--label", "urgent", "--milestone", "GA"],
        { cwd: root },
      );
      await runCli(["set", "T-1", "reporter", "Bea"], { cwd: root });

      const client = await startMcpClient(root);
      try {
        const task = JSON.parse((await client.callTool("get_task", { ref: "T-1" })).content[0]?.text ?? "{}") as Record<string, unknown>;
        expect(task["assignee"]).toMatch(ID);
        expect(task["assignee_name"]).toBe("Bea");
        expect(task["reporter_name"]).toBe("Bea");
        expect(task["milestone"]).toMatch(ID);
        expect(task["milestone_name"]).toBe("GA");
        expect((task["labels"] as string[])[0]).toMatch(ID);
        expect(task["label_names"]).toEqual(["urgent"]);
        expect(typeof task["project_name"]).toBe("string");

        const history = JSON.parse((await client.callTool("get_task_history", { ref: "T-1" })).content[0]?.text ?? "{}") as {
          entries: Record<string, unknown>[];
        };
        const reporter = history.entries.find(e => e["field"] === "reporter");
        expect(reporter?.["after"]).toMatch(ID);
        expect(reporter?.["after_name"]).toBe("Bea");

        const archived = await client.callTool("archive_label", { label: "urgent" });
        expect(archived.content[0]?.text).toMatch(/^Archived label urgent \([0-7][0-9A-HJKMNP-TV-Z]{25}\)$/);
      } finally {
        await client.close();
      }
    });
  });
});
