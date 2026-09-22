import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/** MCP comment tools (item 9). */
describe("MCP comments (stdio)", () => {
  it("posts, lists, edits and deletes", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "subject"], { cwd: root });
      const client = await startMcpClient(root);
      try {
        const posted = await client.callTool("post_comment", { ref: "T-1", body: "hello" });
        expect(posted.isError).toBeFalsy();

        const listed = await client.callTool("list_comments", { ref: "T-1" });
        const comments = JSON.parse(listed.content[0]?.text ?? "[]") as
          { id: string; body: string; edited?: boolean }[];
        expect(comments).toHaveLength(1);
        expect(comments[0]?.body).toBe("hello");

        const id = comments[0]!.id;
        const edited = await client.callTool("edit_comment", {
          ref: "T-1", comment_id: id, body: "goodbye",
        });
        expect(edited.isError).toBeFalsy();

        const afterEdit = JSON.parse(
          (await client.callTool("list_comments", { ref: "T-1" })).content[0]?.text ?? "[]",
        ) as { body: string; edited?: boolean }[];
        expect(afterEdit[0]?.body).toBe("goodbye");
        expect(afterEdit[0]?.edited).toBe(true);

        // delete_comment now requires confirm: true, matching every other
        // destructive delete_* tool (A221). This call previously omitted it
        // and passed only because the gate did not yet exist.
        await client.callTool("delete_comment", { ref: "T-1", comment_id: id, confirm: true });
        const afterDelete = JSON.parse(
          (await client.callTool("list_comments", { ref: "T-1" })).content[0]?.text ?? "[]",
        ) as unknown[];
        expect(afterDelete).toEqual([]);
      } finally {
        await client.close();
      }
    });
  });

  it("sees a comment written by the CLI", async () => {
    // The file is the truth; neither surface owns the data.
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "subject"], { cwd: root });
      await runCli(["comment", "T-1", "from the cli"], { cwd: root });

      const client = await startMcpClient(root);
      try {
        const listed = await client.callTool("list_comments", { ref: "T-1" });
        expect(listed.content[0]?.text ?? "").toContain("from the cli");
      } finally {
        await client.close();
      }
    });
  });

  it("errors on an empty body rather than writing one", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "subject"], { cwd: root });
      const client = await startMcpClient(root);
      try {
        const res = await client.callTool("post_comment", { ref: "T-1", body: "" });
        expect(res.isError).toBe(true);
        const listed = await client.callTool("list_comments", { ref: "T-1" });
        expect(JSON.parse(listed.content[0]?.text ?? "[]")).toEqual([]);
      } finally {
        await client.close();
      }
    });
  });
});
