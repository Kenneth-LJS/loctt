import { readdir } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

describe("MCP create_task (stdio)", () => {
  it("creates a task and writes it to disk", async () => {
    await withTmpLoctt(async ({ root }) => {
      const client = await startMcpClient(root);
      try {
        const result = await client.callTool("create_task", {
          title: "first task via stdio",
        });

        expect(result.isError).toBeFalsy();
        const text = result.content[0]?.text ?? "";
        expect(text).toContain("T-1");

        const tasksDir = path.join(root, ".loctt/tasks");
        const taskDirs = await readdir(tasksDir);
        expect(taskDirs.length).toBe(1);
      } finally {
        await client.close();
      }
    });
  });

  it("lists the loctt tools over stdio", async () => {
    await withTmpLoctt(async ({ root }) => {
      const client = await startMcpClient(root);
      try {
        const tools = await client.listTools();
        const names = tools.map(t => t.name);
        expect(names).toContain("create_task");
        expect(names).toContain("get_task");
        expect(names).toContain("list_tasks");
        expect(names).toContain("update_task");
      } finally {
        await client.close();
      }
    });
  });
});
