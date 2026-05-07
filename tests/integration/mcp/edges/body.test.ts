import { describe, expect, it } from "vitest";

import { runCli } from "../../adapters/cli-spawn.js";
import { startMcpClient } from "../../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../../fixtures/tmp-loctt.js";

describe("MCP body edge cases (stdio)", () => {
  it("replace_task_body with empty string round-trips", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "t"], { cwd: root });
      const client = await startMcpClient(root);
      try {
        const replace = await client.callTool("replace_task_body", {
          ref: "T-1",
          body: "",
        });
        expect(replace.isError).toBeFalsy();

        // Read body back via CLI to verify file is parseable and body is empty.
        const read = await runCli(["body", "T-1"], { cwd: root });
        expect(read.exitCode).toBe(0);
        expect(read.stdout).toContain("(empty body)");
      } finally {
        await client.close();
      }
    });
  });

  it("100KB body round-trips intact through replace_task_body", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "t"], { cwd: root });
      const big = "x".repeat(100_000);
      const client = await startMcpClient(root);
      try {
        const replace = await client.callTool("replace_task_body", {
          ref: "T-1",
          body: big,
        });
        expect(replace.isError).toBeFalsy();

        const get = await client.callTool("get_task", { ref: "T-1" });
        expect(get.isError).toBeFalsy();
        const text = get.content[0]?.text ?? "";
        expect(text).toContain(big);
      } finally {
        await client.close();
      }
    });
  });

  it("unicode and emoji body round-trips", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "t"], { cwd: root });
      const body = "日本語 🎉 testing";
      const client = await startMcpClient(root);
      try {
        const replace = await client.callTool("replace_task_body", { ref: "T-1", body });
        expect(replace.isError).toBeFalsy();

        const get = await client.callTool("get_task", { ref: "T-1" });
        const text = get.content[0]?.text ?? "";
        expect(text).toContain(body);
      } finally {
        await client.close();
      }
    });
  });

  it("body containing --- delimiter does not corrupt frontmatter parse", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "t"], { cwd: root });
      const body = "intro\n---\nmore content";
      const client = await startMcpClient(root);
      try {
        const replace = await client.callTool("replace_task_body", { ref: "T-1", body });
        expect(replace.isError).toBeFalsy();

        const get = await client.callTool("get_task", { ref: "T-1" });
        expect(get.isError).toBeFalsy();
        const text = get.content[0]?.text ?? "";
        expect(text).toContain("intro");
        expect(text).toContain("more content");
      } finally {
        await client.close();
      }
    });
  });
});
