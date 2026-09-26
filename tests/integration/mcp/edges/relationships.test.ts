import { describe, expect, it } from "vitest";

import { runCli } from "../../adapters/cli-spawn.js";
import { startMcpClient } from "../../adapters/mcp-stdio.js";
import { withTmpLoctt } from "../../fixtures/tmp-loctt.js";

describe("MCP link_tasks relationship edge cases (stdio)", () => {
  it("returns isError for an unknown relationship type", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "first"], { cwd: root });
      await runCli(["create", "second"], { cwd: root });

      const client = await startMcpClient(root);
      try {
        const result = await client.callTool("link_tasks", { refs: ["T-1"],
          type: "nonexistent_type",
          target: "T-2",
        });
        expect(result.isError).toBe(true);
        expect(result.content[0]?.text ?? "").toMatch(/unknown relationship type/i);
      } finally {
        await client.close();
      }
    });
  });

  it("returns isError for a link to a nonexistent target", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "first"], { cwd: root });

      const client = await startMcpClient(root);
      try {
        const result = await client.callTool("link_tasks", { refs: ["T-1"],
          type: "blocks",
          target: "T-99",
        });
        expect(result.isError).toBe(true);
        expect(result.content[0]?.text ?? "").toContain("not found");
      } finally {
        await client.close();
      }
    });
  });

  it("returns isError for a self-link", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "first"], { cwd: root });

      const client = await startMcpClient(root);
      try {
        const result = await client.callTool("link_tasks", { refs: ["T-1"],
          type: "blocks",
          target: "T-1",
        });
        expect(result.isError).toBe(true);
        expect(result.content[0]?.text ?? "").toContain("A task can't link to itself");
      } finally {
        await client.close();
      }
    });
  });

  it("returns isError for a cycle on a graph: tree relationship", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "A"], { cwd: root });
      await runCli(["create", "B"], { cwd: root });
      await runCli(["create", "C"], { cwd: root });

      const client = await startMcpClient(root);
      try {
        const ok1 = await client.callTool("link_tasks", { refs: ["T-1"], type: "parent", target: "T-2" });
        expect(ok1.isError).toBeFalsy();
        const ok2 = await client.callTool("link_tasks", { refs: ["T-2"], type: "parent", target: "T-3" });
        expect(ok2.isError).toBeFalsy();
        const bad = await client.callTool("link_tasks", { refs: ["T-3"], type: "parent", target: "T-1" });
        expect(bad.isError).toBe(true);
        expect(bad.content[0]?.text ?? "").toContain("cannot create cycle in relationship 'parent'");
      } finally {
        await client.close();
      }
    });
  });

  it("allows a cycle on a graph: none relationship (relates_to)", async () => {
    // Was written against `blocks`, which the shipped default has always
    // constrained (`structural: true` at b4f0fbf, `graph: acyclic` now),
    // so it asserted a premise the config never held and was already
    // failing before the graph rename.
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "A"], { cwd: root });
      await runCli(["create", "B"], { cwd: root });
      await runCli(["create", "C"], { cwd: root });

      const client = await startMcpClient(root);
      try {
        const ok1 = await client.callTool("link_tasks", { refs: ["T-1"], type: "relates_to", target: "T-2" });
        expect(ok1.isError).toBeFalsy();
        const ok2 = await client.callTool("link_tasks", { refs: ["T-2"], type: "relates_to", target: "T-3" });
        expect(ok2.isError).toBeFalsy();
        const ok3 = await client.callTool("link_tasks", { refs: ["T-3"], type: "relates_to", target: "T-1" });
        expect(ok3.isError).toBeFalsy();
      } finally {
        await client.close();
      }
    });
  });

  it("returns isError for a link from a nonexistent source", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "first"], { cwd: root });

      const client = await startMcpClient(root);
      try {
        const result = await client.callTool("link_tasks", { refs: ["T-99"],
          type: "blocks",
          target: "T-1",
        });
        expect(result.isError).toBe(true);
      } finally {
        await client.close();
      }
    });
  });
});
