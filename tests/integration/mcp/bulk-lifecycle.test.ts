import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { startMcpClient } from "../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * MCP bulk archive/delete/link parity.
 *
 * Core had bulkArchive/bulkDelete/bulkLink and only the web reached
 * them; the MCP archive_task/delete_task/link_tasks took a single
 * `ref`. These tools now take `refs[]` (matching move_task /
 * bulk_update_tasks). Each test was red-proven against the pre-change
 * single-`ref` tool: with the old `ref: z.string()` schema, a `refs`
 * array is an unknown property / missing required `ref`, so the call
 * errored rather than processing many — see the report's red-proof
 * notes.
 */
describe("MCP bulk archive_task (stdio)", () => {
  it("archives several tasks and reports the split", async () => {
    await withTmpLoctt(async ({ root }) => {
      for (const t of ["a", "b", "c"]) await runCli(["create", t], { cwd: root });
      const client = await startMcpClient(root);
      try {
        const res = await client.callTool("archive_task", { refs: ["T-1", "T-2"] });
        expect(res.isError).toBeFalsy();
        expect(res.content[0]?.text ?? "").toContain("Archived 2, failed 0");

        // T-1 is hidden from the default (non-archived) list; the archived
        // filter shows it.
        const listed = await client.callTool("list_tasks", { include_archived: true });
        expect(listed.content[0]?.text ?? "").toContain("T-1");
      } finally {
        await client.close();
      }
    });
  });

  it("counts already-archived tasks as unchanged in a mixed selection", async () => {
    await withTmpLoctt(async ({ root }) => {
      for (const t of ["a", "b"]) await runCli(["create", t], { cwd: root });
      await runCli(["archive", "T-1"], { cwd: root });
      const client = await startMcpClient(root);
      try {
        const res = await client.callTool("archive_task", { refs: ["T-1", "T-2"] });
        const out = res.content[0]?.text ?? "";
        expect(out).toContain("Archived 2, failed 0");
        expect(out).toContain("1 already in that state");
      } finally {
        await client.close();
      }
    });
  });

  it("unarchives several tasks in one call", async () => {
    await withTmpLoctt(async ({ root }) => {
      for (const t of ["a", "b"]) await runCli(["create", t], { cwd: root });
      await runCli(["archive", "T-1,T-2"], { cwd: root });
      const client = await startMcpClient(root);
      try {
        const res = await client.callTool("unarchive_task", { refs: ["T-1", "T-2"] });
        expect(res.content[0]?.text ?? "").toContain("Unarchived 2, failed 0");
        const shown = await client.callTool("get_task", { ref: "T-1" });
        expect(shown.isError).toBeFalsy();
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
        const res = await client.callTool("archive_task", { refs: ["T-1", "T-404"] });
        const out = res.content[0]?.text ?? "";
        expect(out).toContain("Archived 1, failed 1");
        expect(out).toContain("T-404");
      } finally {
        await client.close();
      }
    });
  });
});

describe("MCP bulk delete_task (stdio)", () => {
  it("deletes several tasks in one call with confirm", async () => {
    await withTmpLoctt(async ({ root }) => {
      for (const t of ["a", "b", "c"]) await runCli(["create", t], { cwd: root });
      const client = await startMcpClient(root);
      try {
        const res = await client.callTool("delete_task", {
          refs: ["T-1", "T-2"], confirm: true,
        });
        expect(res.isError).toBeFalsy();
        expect(res.content[0]?.text ?? "").toContain("Deleted 2, failed 0");

        const gone = await client.callTool("get_task", { ref: "T-1" });
        expect(gone.isError).toBeTruthy();
        const survivor = await client.callTool("get_task", { ref: "T-3" });
        expect(survivor.isError).toBeFalsy();
      } finally {
        await client.close();
      }
    });
  });

  it("refuses without confirm and deletes nothing", async () => {
    await withTmpLoctt(async ({ root }) => {
      for (const t of ["a", "b"]) await runCli(["create", t], { cwd: root });
      const client = await startMcpClient(root);
      try {
        const res = await client.callTool("delete_task", { refs: ["T-1", "T-2"] });
        expect(res.isError).toBeTruthy();
        // Both survive — the confirm gate fired before core.
        const survivor = await client.callTool("get_task", { ref: "T-1" });
        expect(survivor.isError).toBeFalsy();
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
        const res = await client.callTool("delete_task", {
          refs: ["T-1", "T-404"], confirm: true,
        });
        const out = res.content[0]?.text ?? "";
        expect(out).toContain("Deleted 1, failed 1");
        expect(out).toContain("T-404");
      } finally {
        await client.close();
      }
    });
  });
});

describe("MCP bulk link_tasks (stdio)", () => {
  it("links several sources to one target in one call", async () => {
    await withTmpLoctt(async ({ root }) => {
      for (const t of ["a", "b", "c"]) await runCli(["create", t], { cwd: root });
      const client = await startMcpClient(root);
      try {
        const res = await client.callTool("link_tasks", {
          refs: ["T-1", "T-2"], type: "blocks", target: "T-3",
        });
        expect(res.isError).toBeFalsy();
        expect(res.content[0]?.text ?? "").toContain("Linked 2, failed 0");

        const shown = await client.callTool("get_task", { ref: "T-1" });
        expect(shown.content[0]?.text ?? "").toContain("T-3");
      } finally {
        await client.close();
      }
    });
  });

  it("reports a bad source without aborting the rest", async () => {
    await withTmpLoctt(async ({ root }) => {
      for (const t of ["a", "b"]) await runCli(["create", t], { cwd: root });
      const client = await startMcpClient(root);
      try {
        const res = await client.callTool("link_tasks", {
          refs: ["T-1", "T-404"], type: "blocks", target: "T-2",
        });
        const out = res.content[0]?.text ?? "";
        expect(out).toContain("Linked 1, failed 1");
        expect(out).toContain("T-404");
      } finally {
        await client.close();
      }
    });
  });
});
