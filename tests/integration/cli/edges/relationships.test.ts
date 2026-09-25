import { describe, expect, it } from "vitest";

import { runCli } from "../../adapters/cli-spawn.js";
import { withTmpLoctt } from "../../fixtures/tmp-loctt.js";

describe("CLI link relationship edge cases (spawned binary)", () => {
  it("rejects a link with an unknown relationship type", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "first"], { cwd: root });
      await runCli(["create", "second"], { cwd: root });

      const result = await runCli(
        ["link", "T-1", "nonexistent_type", "T-2"],
        { cwd: root },
      );
      expect(result.exitCode).not.toBe(0);
      // CLI's assertWorkflowRelationshipKey produces "unknown
      // relationship 'X'. Known: <list>" — surfaces a friendly hint
      // at the boundary instead of letting core throw a deeper error.
      expect(result.stderr).toContain("unknown relationship");
      expect(result.stderr).toContain("nonexistent_type");
      expect(result.stderr).toContain("Known:");
    });
  });

  it("rejects a link to a nonexistent target", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "first"], { cwd: root });

      const result = await runCli(["link", "T-1", "blocks", "T-99"], { cwd: root });
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("not found");
      expect(result.stderr).toContain("T-99");
    });
  });

  it("rejects a self-link", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "first"], { cwd: root });

      const result = await runCli(["link", "T-1", "blocks", "T-1"], { cwd: root });
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("A task can't link to itself");
      expect(result.stderr).toContain("T-1");
    });
  });

  it("rejects a link from a nonexistent source", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "first"], { cwd: root });

      const result = await runCli(["link", "T-99", "blocks", "T-1"], { cwd: root });
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("not found");
    });
  });

  it("rejects a structural cycle (parent A -> B -> C -> A)", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "A"], { cwd: root });
      await runCli(["create", "B"], { cwd: root });
      await runCli(["create", "C"], { cwd: root });

      const r1 = await runCli(["link", "T-1", "parent", "T-2"], { cwd: root });
      expect(r1.exitCode).toBe(0);
      const r2 = await runCli(["link", "T-2", "parent", "T-3"], { cwd: root });
      expect(r2.exitCode).toBe(0);
      const r3 = await runCli(["link", "T-3", "parent", "T-1"], { cwd: root });
      expect(r3.exitCode).not.toBe(0);
      expect(r3.stderr).toContain("cannot create cycle in relationship 'parent'");
    });
  });

  it("allows a cycle on a graph: none relationship (relates_to)", async () => {
    // Was written against `blocks`, which the shipped default has always
    // constrained — `structural: true` at b4f0fbf, `graph: acyclic` now.
    // So this asserted a premise the config never held, and had been
    // failing before the graph rename. `relates_to` carries no
    // constraint, which is what the case is actually about.
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "A"], { cwd: root });
      await runCli(["create", "B"], { cwd: root });
      await runCli(["create", "C"], { cwd: root });

      const r1 = await runCli(["link", "T-1", "relates_to", "T-2"], { cwd: root });
      expect(r1.exitCode).toBe(0);
      const r2 = await runCli(["link", "T-2", "relates_to", "T-3"], { cwd: root });
      expect(r2.exitCode).toBe(0);
      const r3 = await runCli(["link", "T-3", "relates_to", "T-1"], { cwd: root });
      expect(r3.exitCode).toBe(0);
    });
  });

  it("rejects a cycle on graph: acyclic (blocks), which is not a tree axis", () => {
    // `acyclic` and `tree` differ only in tree-drawability; both refuse
    // cycles. A blocks cycle is a deadlock.
    return withTmpLoctt(async ({ root }) => {
      await runCli(["create", "A"], { cwd: root });
      await runCli(["create", "B"], { cwd: root });

      expect((await runCli(["link", "T-1", "blocks", "T-2"], { cwd: root })).exitCode).toBe(0);
      const r = await runCli(["link", "T-2", "blocks", "T-1"], { cwd: root });
      expect(r.exitCode).not.toBe(0);
      expect(r.stderr).toContain("cannot create cycle in relationship 'blocks'");
    });
  });
});
