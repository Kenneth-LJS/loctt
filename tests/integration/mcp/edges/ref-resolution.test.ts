import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../../adapters/cli-spawn.js";
import { startMcpClient } from "../../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../../fixtures/tmp-loctt.js";

describe("MCP get_task ref resolution edge cases (stdio)", () => {
  it("returns isError for a nonexistent ref", async () => {
    await withTmpLoctt(async ({ root }) => {
      const client = await startMcpClient(root);
      try {
        const result = await client.callTool("get_task", { ref: "T-99" });
        expect(result.isError).toBe(true);
        const text = result.content[0]?.text ?? "";
        expect(text).toContain("not found");
      } finally {
        await client.close();
      }
    });
  });

  it("resolves a task by its ULID id", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "lookup by id"], { cwd: root });

      const tasksDir = path.join(root, ".loctt", "tasks");
      const entries = await readdir(tasksDir);
      const taskFile = path.join(tasksDir, entries[0]!, "task.md");
      const content = await readFile(taskFile, "utf-8");
      const match = content.match(/^id:\s*([0-9A-HJKMNP-TV-Z]{26})/m);
      const id = match![1]!;

      const client = await startMcpClient(root);
      try {
        const result = await client.callTool("get_task", { ref: id });
        expect(result.isError).toBeFalsy();
        const text = result.content[0]?.text ?? "";
        expect(text).toContain("T-1");
        expect(text).toContain("lookup by id");
      } finally {
        await client.close();
      }
    });
  });

  it("returns isError for an empty ref", async () => {
    await withTmpLoctt(async ({ root }) => {
      const client = await startMcpClient(root);
      try {
        const result = await client.callTool("get_task", { ref: "" });
        expect(result.isError).toBe(true);
      } finally {
        await client.close();
      }
    });
  });
});
