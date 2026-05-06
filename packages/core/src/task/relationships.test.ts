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
      { key: "parent", label: "Parent", inverse: "child", inverse_label: "Child", structural: true },
      { key: "child", label: "Child", inverse: "parent", inverse_label: "Parent", structural: true },
      { key: "related_to", label: "Related to", inverse: "related_to", inverse_label: "Related to" },
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
      expect(updated.frontmatter.relationships).toEqual([
        { type: "blocks", target: "b" },
      ]);
    });

    it("writes the inverse edge on the target task", async () => {
      await seedAB();
      await linkTask({ locttDir, taskId: "a", type: "blocks", target: "b", workflowConfig: workflow });
      const targetLoaded = await readTask(locttDir, "b");
      expect(targetLoaded.frontmatter.relationships).toEqual([
        { type: "blocked_by", target: "a" },
      ]);
    });

    it("works in both directions of a non-symmetric pair", async () => {
      await seedAB();
      await linkTask({ locttDir, taskId: "a", type: "blocked_by", target: "b", workflowConfig: workflow });
      const a = await readTask(locttDir, "a");
      const b = await readTask(locttDir, "b");
      expect(a.frontmatter.relationships).toEqual([{ type: "blocked_by", target: "b" }]);
      expect(b.frontmatter.relationships).toEqual([{ type: "blocks", target: "a" }]);
    });

    it("self-inverse types do not produce duplicate edges on either side", async () => {
      await seedAB();
      await linkTask({ locttDir, taskId: "a", type: "related_to", target: "b", workflowConfig: workflow });
      const a = await readTask(locttDir, "a");
      const b = await readTask(locttDir, "b");
      expect(a.frontmatter.relationships).toEqual([{ type: "related_to", target: "b" }]);
      expect(b.frontmatter.relationships).toEqual([{ type: "related_to", target: "a" }]);
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
      expect(updated.frontmatter.relationships).toEqual([{ type: "parent", target: "b" }]);
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
      expect(a.frontmatter.relationships).toEqual([{ type: "blocks", target: "b" }]);
      expect(b.frontmatter.relationships).toEqual([{ type: "blocked_by", target: "a" }]);
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
});
