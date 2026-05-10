import { readdir } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { startMcpClient } from "../integration/adapters/mcp-stdio.js";
import { withTmpLoctt } from "../integration/fixtures/tmp-loctt.js";

describe("E2E journey: MCP-only full lifecycle", () => {
  it("walks every MCP tool mutation and verifies via tool responses", async () => {
    await withTmpLoctt(async ({ root }) => {
      const client = await startMcpClient(root);
      try {
        const c1 = await client.callTool("create_task", { title: "primary" });
        expect(c1.isError).toBeFalsy();
        const c2 = await client.callTool("create_task", { title: "secondary" });
        expect(c2.isError).toBeFalsy();

        const get1 = await client.callTool("get_task", { ref: "T-1" });
        expect(get1.isError).toBeFalsy();
        expect(get1.content[0]?.text ?? "").toContain("primary");

        const status = await client.callTool("update_task", {
          ref: "T-1", field: "status", value: "in_progress",
        });
        expect(status.isError).toBeFalsy();

        const prio = await client.callTool("update_task", {
          ref: "T-1", field: "priority", value: "high",
        });
        expect(prio.isError).toBeFalsy();

        const replaceBody = await client.callTool("replace_task_body", {
          ref: "T-1", body: "first body",
        });
        expect(replaceBody.isError).toBeFalsy();

        const appendBody = await client.callTool("append_task_body", {
          ref: "T-1", text: "more text",
        });
        expect(appendBody.isError).toBeFalsy();

        const fetched = await client.callTool("get_task", { ref: "T-1" });
        expect(fetched.isError).toBeFalsy();
        const fetchedText = fetched.content[0]?.text ?? "";
        expect(fetchedText).toContain("first body");
        expect(fetchedText).toContain("more text");
        expect(fetchedText).toContain("in_progress");
        expect(fetchedText).toContain("high");

        const link = await client.callTool("link_tasks", {
          ref: "T-1", type: "blocks", target: "T-2",
        });
        expect(link.isError).toBeFalsy();

        const unlink = await client.callTool("unlink_tasks", {
          ref: "T-1", type: "blocks", target: "T-2",
        });
        expect(unlink.isError).toBeFalsy();

        const archive = await client.callTool("archive_task", { ref: "T-1" });
        expect(archive.isError).toBeFalsy();

        const unarchive = await client.callTool("unarchive_task", { ref: "T-1" });
        expect(unarchive.isError).toBeFalsy();

        const unset = await client.callTool("unset_field", { ref: "T-1", field: "priority" });
        expect(unset.isError).toBeFalsy();

        const del = await client.callTool("delete_task", { ref: "T-1", hard: true, confirm: true });
        expect(del.isError).toBeFalsy();
      } finally {
        await client.close();
      }

      const ids = await readdir(path.join(root, ".loctt/tasks"));
      expect(ids.length).toBe(1);
    });
  });
});
