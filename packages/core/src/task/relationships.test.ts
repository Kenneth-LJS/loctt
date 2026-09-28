import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Task, WorkflowConfig } from "@loctt/contracts";
import { afterEach,beforeEach, describe, expect, it } from "vitest";

import { readHistory } from "./history.js";
import { readTask,writeTask } from "./io.js";
import { linkTask, RelationshipError,unlinkTask } from "./relationships.js";

describe("relationships", () => {
  let locttDir: string;

  beforeEach(async () => {
    const tmp = await mkdtemp(join(tmpdir(), "loctt-rel-"));
    locttDir = join(tmp, ".loctt");
  });

  afterEach(async () => {
    await rm(join(locttDir, ".."), { recursive: true, force: true });
  });

  const seedA: Task = {
    frontmatter: {
      id: "a",
      key: "T-1",
      title: "A",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    },
    body: "",
  };

  const seedB: Task = {
    frontmatter: {
      id: "b",
      key: "T-2",
      title: "B",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    },
    body: "",
  };

  const workflow: WorkflowConfig = {
    key: { prefix: "T" },
    statuses: [],
    priorities: [],
    task_types: [],
    relationships: [
      { key: "blocks", label: "Blocks", inverse: "blocked_by", inverse_label: "Blocked by" },
      { key: "blocked_by", label: "Blocked by", inverse: "blocks", inverse_label: "Blocks" },
      { key: "parent", label: "Parent", inverse: "child", inverse_label: "Child", graph: "tree" },
      { key: "child", label: "Child", inverse: "parent", inverse_label: "Parent", graph: "tree" },
      { key: "related_to", label: "Related to", kind: "symmetric" },
    ],
    custom_fields: [],
  };

  async function seedAB(): Promise<void> {
    await writeTask(locttDir, "a", seedA);
    await writeTask(locttDir, "b", seedB);
  }

  describe("linkTask (bilateral)", () => {
    it("writes the forward edge on the source task", async () => {
      await seedAB();
      const updated = await linkTask({ locttDir, taskId: "a", type: "blocks", target: "b", workflowConfig: workflow });
      // K143: every link carries a rank; the first of its group is INITIAL.
      expect(updated.frontmatter.relationships).toEqual([
        { type: "blocks", target: "b", rank: "u" },
      ]);
    });

    it("writes the inverse edge on the target task", async () => {
      await seedAB();
      await linkTask({ locttDir, taskId: "a", type: "blocks", target: "b", workflowConfig: workflow });
      const targetLoaded = await readTask(locttDir, "b");
      expect(targetLoaded.frontmatter.relationships).toEqual([
        { type: "blocked_by", target: "a", rank: "u" },
      ]);
    });

    it("works in both directions of a non-symmetric pair", async () => {
      await seedAB();
      await linkTask({ locttDir, taskId: "a", type: "blocked_by", target: "b", workflowConfig: workflow });
      const a = await readTask(locttDir, "a");
      const b = await readTask(locttDir, "b");
      expect(a.frontmatter.relationships).toEqual([{ type: "blocked_by", target: "b", rank: "u" }]);
      expect(b.frontmatter.relationships).toEqual([{ type: "blocks", target: "a", rank: "u" }]);
    });

    it("self-inverse types do not produce duplicate edges on either side", async () => {
      await seedAB();
      await linkTask({ locttDir, taskId: "a", type: "related_to", target: "b", workflowConfig: workflow });
      const a = await readTask(locttDir, "a");
      const b = await readTask(locttDir, "b");
      expect(a.frontmatter.relationships).toEqual([{ type: "related_to", target: "b", rank: "u" }]);
      expect(b.frontmatter.relationships).toEqual([{ type: "related_to", target: "a", rank: "u" }]);
    });

    it("symmetric relationships record the same forward type on both endpoints", async () => {
      // Both endpoints store `type: related_to` (the canonical key), never
      // a separate inverse spelling. Distinguishes symmetric from directional.
      await seedAB();
      await linkTask({ locttDir, taskId: "a", type: "related_to", target: "b", workflowConfig: workflow });
      const a = await readTask(locttDir, "a");
      const b = await readTask(locttDir, "b");
      expect(a.frontmatter.relationships?.[0]?.type).toBe("related_to");
      expect(b.frontmatter.relationships?.[0]?.type).toBe("related_to");
    });

    it("writes history entries on both tasks reflecting their perspective", async () => {
      await seedAB();
      await linkTask({ locttDir, taskId: "a", type: "blocks", target: "b", workflowConfig: workflow });
      const histA = await readHistory(locttDir, "a");
      const histB = await readHistory(locttDir, "b");
      expect(histA.at(-1)).toMatchObject({ kind: "link_added", meta: { type: "blocks", target: "b" } });
      expect(histB.at(-1)).toMatchObject({ kind: "link_added", meta: { type: "blocked_by", target: "a" } });
    });

    it("falls back to forward-only when no inverse is defined and no workflow is supplied", async () => {
      await seedAB();
      const updated = await linkTask({ locttDir, taskId: "a", type: "parent", target: "b" });
      expect(updated.frontmatter.relationships).toEqual([{ type: "parent", target: "b", rank: "u" }]);
      const b = await readTask(locttDir, "b");
      expect(b.frontmatter.relationships).toBeUndefined();
    });

    it("appends to existing relationships", async () => {
      await writeTask(locttDir, "a", {
        ...seedA,
        frontmatter: {
          ...seedA.frontmatter,
          relationships: [{ type: "parent", target: "x" }],
        },
      });
      await writeTask(locttDir, "b", seedB);
      const updated = await linkTask({ locttDir, taskId: "a", type: "blocks", target: "b", workflowConfig: workflow });
      expect(updated.frontmatter.relationships).toHaveLength(2);
    });

    // K143: a new link is ranked at the end of *its type's* group on that
    // task: after the highest rank of that type, whatever other types hold.
    // @verifies REL-C10
    it("ranks a new link after the last of its own type, ignoring other types' ranks", async () => {
      await writeTask(locttDir, "a", {
        ...seedA,
        frontmatter: {
          ...seedA.frontmatter,
          relationships: [
            { type: "blocks", target: "x", rank: "c" },
            { type: "parent", target: "y", rank: "y" },
            { type: "blocks", target: "w", rank: "k" },
          ],
        },
      });
      await writeTask(locttDir, "b", seedB);
      const updated = await linkTask({ locttDir, taskId: "a", type: "blocks", target: "b", workflowConfig: workflow });
      const added = updated.frontmatter.relationships?.find(r => r.target === "b");
      // Strictly after "k" (the highest `blocks` rank), and not pushed
      // past "y" by the `parent` edge.
      expect(added?.rank).toBeDefined();
      expect((added?.rank ?? "") > "k").toBe(true);
      expect((added?.rank ?? "") < "y").toBe(true);
    });

    it("throws on duplicate relationship when both sides already exist", async () => {
      await seedAB();
      await linkTask({ locttDir, taskId: "a", type: "blocks", target: "b", workflowConfig: workflow });
      await expect(linkTask({ locttDir, taskId: "a", type: "blocks", target: "b", workflowConfig: workflow }))
        .rejects.toThrow(RelationshipError);
    });

    it("tolerantly fills in a missing inverse when only the forward edge exists", async () => {
      // simulate legacy one-sided data: A has blocks->B but B has nothing
      await writeTask(locttDir, "a", {
        ...seedA,
        frontmatter: {
          ...seedA.frontmatter,
          relationships: [{ type: "blocks", target: "b" }],
        },
      });
      await writeTask(locttDir, "b", seedB);

      // calling linkTask again should NOT throw — instead it should add the missing inverse
      await linkTask({ locttDir, taskId: "a", type: "blocks", target: "b", workflowConfig: workflow });
      const a = await readTask(locttDir, "a");
      const b = await readTask(locttDir, "b");
      // The forward edge was already there and is not rewritten; the
      // added inverse is ranked (K143). Doctor reports the forward edge's
      // missing rank, and the relationship repair gives it one.
      expect(a.frontmatter.relationships).toEqual([{ type: "blocks", target: "b" }]);
      expect(b.frontmatter.relationships).toEqual([{ type: "blocked_by", target: "a", rank: "u" }]);
    });

    it("rejects self-links and leaves the task frontmatter unchanged", async () => {
      await seedAB();
      const before = await readTask(locttDir, "a");
      await expect(
        linkTask({ locttDir, taskId: "a", type: "blocks", target: "a", workflowConfig: workflow }),
      ).rejects.toThrow(RelationshipError);
      await expect(
        linkTask({ locttDir, taskId: "a", type: "blocks", target: "a", workflowConfig: workflow }),
      ).rejects.toThrow(/T-1 is this task\. A task can't link to itself\./);
      const after = await readTask(locttDir, "a");
      expect(after.frontmatter).toEqual(before.frontmatter);
    });

    it("rejects unknown relationship types", async () => {
      await seedAB();
      await expect(linkTask({ locttDir, taskId: "a", type: "bogus", target: "b", workflowConfig: workflow }))
        .rejects.toThrow(RelationshipError);
    });

    it("persists to disk", async () => {
      await seedAB();
      await linkTask({ locttDir, taskId: "a", type: "blocks", target: "b", workflowConfig: workflow });
      const a = await readTask(locttDir, "a");
      const b = await readTask(locttDir, "b");
      expect(a.frontmatter.relationships).toHaveLength(1);
      expect(b.frontmatter.relationships).toHaveLength(1);
    });
  });

  describe("cycle detection on graph-constrained relationships", () => {
    const seedC: Task = {
      frontmatter: {
        id: "c",
        key: "T-3",
        title: "C",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
      body: "",
    };

    it("rejects a direct cycle on a graph: tree relationship", async () => {
      await seedAB();
      await linkTask({ locttDir, taskId: "a", type: "parent", target: "b", workflowConfig: workflow });
      await expect(
        linkTask({ locttDir, taskId: "b", type: "parent", target: "a", workflowConfig: workflow }),
      ).rejects.toThrow(/cannot create cycle in relationship 'parent'/);
    });

    it("rejects an indirect cycle on a graph: tree relationship", async () => {
      await seedAB();
      await writeTask(locttDir, "c", seedC);
      await linkTask({ locttDir, taskId: "a", type: "parent", target: "b", workflowConfig: workflow });
      await linkTask({ locttDir, taskId: "b", type: "parent", target: "c", workflowConfig: workflow });
      await expect(
        linkTask({ locttDir, taskId: "c", type: "parent", target: "a", workflowConfig: workflow }),
      ).rejects.toThrow(/cannot create cycle in relationship 'parent'/);
    });

    it("allows multiple children of the same parent (no cycle)", async () => {
      await seedAB();
      await writeTask(locttDir, "c", seedC);
      await linkTask({ locttDir, taskId: "b", type: "parent", target: "a", workflowConfig: workflow });
      await linkTask({ locttDir, taskId: "c", type: "parent", target: "a", workflowConfig: workflow });
      const a = await readTask(locttDir, "a");
      // A has two children: B and C
      expect(a.frontmatter.relationships).toHaveLength(2);
    });

    it("allows cycles on non-structural relationships", async () => {
      await seedAB();
      await writeTask(locttDir, "c", seedC);
      await linkTask({ locttDir, taskId: "a", type: "blocks", target: "b", workflowConfig: workflow });
      await linkTask({ locttDir, taskId: "b", type: "blocks", target: "c", workflowConfig: workflow });
      // Closing the loop should succeed.
      await linkTask({ locttDir, taskId: "c", type: "blocks", target: "a", workflowConfig: workflow });
      const c = await readTask(locttDir, "c");
      expect(c.frontmatter.relationships?.some(r => r.type === "blocks" && r.target === "a")).toBe(true);
    });

    it("does not crash when a chain points at a deleted intermediate task", async () => {
      // Set up A with a parent edge pointing to a non-existent task ID.
      await writeTask(locttDir, "a", {
        ...seedA,
        frontmatter: {
          ...seedA.frontmatter,
          relationships: [{ type: "parent", target: "ghost" }],
        },
      });
      await writeTask(locttDir, "c", seedC);
      // Now link C parent A; cycle DFS walks from A -> ghost (deleted), should not crash.
      await linkTask({ locttDir, taskId: "c", type: "parent", target: "a", workflowConfig: workflow });
      const c = await readTask(locttDir, "c");
      expect(c.frontmatter.relationships?.some(r => r.type === "parent" && r.target === "a")).toBe(true);
    });

    /**
     * Production-shaped workflow: only the forward direction is
     * listed as a workflow entry. The inverse direction is reached
     * only via `inverse`. Earlier code matched `r.key === type` and
     * silently skipped cycle detection on inverse-key calls.
     */
    const inverseOnlyWorkflow: WorkflowConfig = {
      key: { prefix: "T" },
      statuses: [],
      priorities: [],
      task_types: [],
      relationships: [
        { key: "parent", label: "Parent", inverse: "child", inverse_label: "Child", graph: "tree" },
      ],
      custom_fields: [],
    };

    it("rejects a direct cycle when called via the inverse key", async () => {
      await seedAB();
      // A is parent of B (canonical edge: A -[parent]-> B).
      await linkTask({ locttDir, taskId: "a", type: "parent", target: "b", workflowConfig: inverseOnlyWorkflow });
      // Now try to make A "child" of B. Canonically that's the edge
      // B -[parent]-> A, which would close the cycle. Pre-fix this
      // silently succeeded because the cycle walker couldn't find
      // a workflow entry whose `key === "child"`.
      await expect(
        linkTask({ locttDir, taskId: "a", type: "child", target: "b", workflowConfig: inverseOnlyWorkflow }),
      ).rejects.toThrow(/cannot create cycle in relationship 'parent'/);
    });

    it("rejects an indirect cycle when the final link uses the inverse key", async () => {
      await seedAB();
      await writeTask(locttDir, "c", seedC);
      // A is parent of B, B is parent of C.
      await linkTask({ locttDir, taskId: "a", type: "parent", target: "b", workflowConfig: inverseOnlyWorkflow });
      await linkTask({ locttDir, taskId: "b", type: "parent", target: "c", workflowConfig: inverseOnlyWorkflow });
      // Now try to make A "child" of C — canonically C -[parent]-> A,
      // which closes the chain.
      await expect(
        linkTask({ locttDir, taskId: "a", type: "child", target: "c", workflowConfig: inverseOnlyWorkflow }),
      ).rejects.toThrow(/cannot create cycle in relationship 'parent'/);
    });
  });

  describe("unlinkTask (bilateral)", () => {
    it("removes the forward edge and the inverse edge", async () => {
      await seedAB();
      await linkTask({ locttDir, taskId: "a", type: "blocks", target: "b", workflowConfig: workflow });
      await unlinkTask({ locttDir, taskId: "a", type: "blocks", target: "b", workflowConfig: workflow });
      const a = await readTask(locttDir, "a");
      const b = await readTask(locttDir, "b");
      expect(a.frontmatter.relationships).toBeUndefined();
      expect(b.frontmatter.relationships).toBeUndefined();
    });

    it("removes only the matching edge, preserving others", async () => {
      await writeTask(locttDir, "a", {
        ...seedA,
        frontmatter: {
          ...seedA.frontmatter,
          relationships: [
            { type: "parent", target: "x" },
            { type: "blocks", target: "b" },
          ],
        },
      });
      await writeTask(locttDir, "b", {
        ...seedB,
        frontmatter: {
          ...seedB.frontmatter,
          relationships: [{ type: "blocked_by", target: "a" }],
        },
      });
      const updated = await unlinkTask({ locttDir, taskId: "a", type: "blocks", target: "b", workflowConfig: workflow });
      expect(updated.frontmatter.relationships).toEqual([{ type: "parent", target: "x" }]);
      const b = await readTask(locttDir, "b");
      expect(b.frontmatter.relationships).toBeUndefined();
    });

    it("removes self-inverse edges from both sides", async () => {
      await seedAB();
      await linkTask({ locttDir, taskId: "a", type: "related_to", target: "b", workflowConfig: workflow });
      await unlinkTask({ locttDir, taskId: "a", type: "related_to", target: "b", workflowConfig: workflow });
      const a = await readTask(locttDir, "a");
      const b = await readTask(locttDir, "b");
      expect(a.frontmatter.relationships).toBeUndefined();
      expect(b.frontmatter.relationships).toBeUndefined();
    });

    it("writes link_removed history entries on both tasks", async () => {
      await seedAB();
      await linkTask({ locttDir, taskId: "a", type: "blocks", target: "b", workflowConfig: workflow });
      await unlinkTask({ locttDir, taskId: "a", type: "blocks", target: "b", workflowConfig: workflow });
      const histA = await readHistory(locttDir, "a");
      const histB = await readHistory(locttDir, "b");
      expect(histA.at(-1)).toMatchObject({ kind: "link_removed", meta: { type: "blocks", target: "b" } });
      expect(histB.at(-1)).toMatchObject({ kind: "link_removed", meta: { type: "blocked_by", target: "a" } });
    });

    it("tolerates legacy one-sided data and removes whatever exists", async () => {
      // forward edge present, inverse missing
      await writeTask(locttDir, "a", {
        ...seedA,
        frontmatter: {
          ...seedA.frontmatter,
          relationships: [{ type: "blocks", target: "b" }],
        },
      });
      await writeTask(locttDir, "b", seedB);
      await unlinkTask({ locttDir, taskId: "a", type: "blocks", target: "b", workflowConfig: workflow });
      const a = await readTask(locttDir, "a");
      expect(a.frontmatter.relationships).toBeUndefined();
    });

    it("throws when neither side has the edge", async () => {
      await seedAB();
      await expect(unlinkTask({ locttDir, taskId: "a", type: "blocks", target: "b", workflowConfig: workflow }))
        .rejects.toThrow(RelationshipError);
    });

    it("removes a dangling edge whose target no longer exists on disk", async () => {
      /**
       * REL-24. A task deleted out of band leaves every edge pointing
       * at it dangling, and this call is the only way the surviving
       * side gets cleaned up.
       *
       * It used not to work anywhere. `readTask` on the vanished target
       * raised a raw ENOENT out of the inverse branch, so the forward
       * edge could not be removed from any surface — the web API
       * answered 500 with the ENOENT path in `detail`, and
       * `loctt unlink` exited 1. Both measured before the fix.
       */
      await writeTask(locttDir, "a", {
        ...seedA,
        frontmatter: {
          ...seedA.frontmatter,
          relationships: [
            { type: "blocks", target: "vanished" },
            { type: "blocks", target: "b" },
          ],
        },
      });
      await writeTask(locttDir, "b", {
        ...seedB,
        frontmatter: { ...seedB.frontmatter, relationships: [{ type: "blocked_by", target: "a" }] },
      });
      // `vanished` was never written, so its directory does not exist.

      const updated = await unlinkTask({
        locttDir, taskId: "a", type: "blocks", target: "vanished", workflowConfig: workflow,
      });

      // The dangling edge is gone...
      expect(updated.frontmatter.relationships?.map(r => r.target)).toEqual(["b"]);
      // ...and the live sibling is untouched, so the removal was
      // targeted rather than a wholesale rewrite.
      const b = await readTask(locttDir, "b");
      expect(b.frontmatter.relationships).toEqual([{ type: "blocked_by", target: "a" }]);
    });

    it("still refuses when the target is missing AND the edge does not exist", async () => {
      // The tolerance above must not become "any unlink succeeds".
      await seedAB();
      await expect(unlinkTask({
        locttDir, taskId: "a", type: "blocks", target: "vanished", workflowConfig: workflow,
      })).rejects.toThrow(RelationshipError);
    });

    it("works without a workflow config (forward-only)", async () => {
      await writeTask(locttDir, "a", {
        ...seedA,
        frontmatter: {
          ...seedA.frontmatter,
          relationships: [{ type: "parent", target: "b" }],
        },
      });
      await writeTask(locttDir, "b", seedB);
      const updated = await unlinkTask({ locttDir, taskId: "a", type: "parent", target: "b" });
      expect(updated.frontmatter.relationships).toBeUndefined();
    });
  });

  /**
   * @verifies REL-C9
   *
   * G1: a link stored as a key more than one task has held. Resolving
   * the key finds one holder's id, so the id-based removal never matched
   * the stored text and no surface could remove the link.
   */
  describe("unlinkTask by the stored target (G1)", () => {
    const holderB: Task = { ...seedB, frontmatter: { ...seedB.frontmatter, key: "T-9" } };
    const formerC: Task = {
      frontmatter: {
        id: "c", key: "T-3", key_history: ["T-9"], title: "C",
        created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
      },
      body: "",
    };

    async function seedAmbiguous(bRels?: Task["frontmatter"]["relationships"]): Promise<void> {
      await writeTask(locttDir, "a", {
        ...seedA,
        frontmatter: { ...seedA.frontmatter, relationships: [{ type: "related_to", target: "T-9" }] },
      });
      await writeTask(locttDir, "b", {
        ...holderB,
        frontmatter: { ...holderB.frontmatter, ...(bRels ? { relationships: bRels } : {}) },
      });
      await writeTask(locttDir, "c", formerC);
    }

    it("removes the edge whose stored target is the ref as given, and logs it", async () => {
      await seedAmbiguous();
      // What every surface passes: the key resolved to its current holder.
      await unlinkTask({ locttDir, taskId: "a", type: "related_to", target: "b", storedTarget: "T-9", workflowConfig: workflow });
      expect((await readTask(locttDir, "a")).frontmatter.relationships).toBeUndefined();
      expect((await readHistory(locttDir, "a")).at(-1)).toMatchObject({
        kind: "link_removed", meta: { type: "related_to", target: "T-9" },
      });
    });

    it("removes the inverse from the holder that has it", async () => {
      await seedAmbiguous([{ type: "related_to", target: "a" }]);
      await unlinkTask({ locttDir, taskId: "a", type: "related_to", target: "b", storedTarget: "T-9", workflowConfig: workflow });
      expect((await readTask(locttDir, "a")).frontmatter.relationships).toBeUndefined();
      expect((await readTask(locttDir, "b")).frontmatter.relationships).toBeUndefined();
      expect((await readHistory(locttDir, "b")).at(-1)).toMatchObject({
        kind: "link_removed", meta: { type: "related_to", target: "a" },
      });
    });

    it("still refuses when no edge stores the ref", async () => {
      await seedAmbiguous();
      await expect(unlinkTask({ locttDir, taskId: "a", type: "related_to", target: "c", storedTarget: "T-3", workflowConfig: workflow }))
        .rejects.toThrow(/does not exist on task a/);
    });
  });
});
