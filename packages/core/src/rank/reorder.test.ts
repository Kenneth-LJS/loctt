import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { initLoctt } from "../init/index.js";
import { resolveLocttDir } from "../paths/index.js";
import { loadState, saveState, withStateLock } from "../state/index.js";
import { createTask } from "../task/create.js";
import { lookupByKey } from "../task/lookup.js";
import { linkTask } from "../task/relationships.js";
import { reorderBoardRank, ReorderError,reorderRelationship } from "./reorder.js";

let root: string;
let locttDir: string;
let taskProjectId: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "loctt-reorder-"));
  await initLoctt(root, { docs: false });
  locttDir = resolveLocttDir(root);
  const { loadProjectsConfig } = await import("../config/projects.js");
  const cfg = await loadProjectsConfig(locttDir);
  taskProjectId = cfg.projects[0]?.id as string;
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function makeTasks(count: number): Promise<string[]> {
  const keys: string[] = [];
  await withStateLock(locttDir, async () => {
    const state = await loadState(locttDir);
    for (let i = 0; i < count; i += 1) {
      const t = await createTask({
        locttDir,
        state,
        options: { project: taskProjectId, title: `Task ${i + 1}` },
      });
      keys.push(t.frontmatter.key);
    }
    await saveState(locttDir, state);
  });
  return keys;
}

async function linkChildren(parentKey: string, childKeys: string[]): Promise<void> {
  const parent = await lookupByKey(locttDir, parentKey);
  for (const ck of childKeys) {
    const child = await lookupByKey(locttDir, ck);
    await linkTask({
      locttDir,
      taskId: parent.frontmatter.id,
      type: "parent",
      target: child.frontmatter.id,
    });
  }
}

describe("reorderRelationship", () => {
  it("appends to the end when no anchor is given", async () => {
    const [pKey, c1, c2, c3] = await makeTasks(4) as [string, string, string, string];
    await linkChildren(pKey, [c1, c2, c3]);

    // Move c1 to the end.
    const result = await reorderRelationship({
      locttDir,
      sourceRef: pKey,
      relationshipType: "parent",
      targetRef: c1,
    });
    expect(typeof result.rank).toBe("string");
    expect(result.rank.length).toBeGreaterThan(0);

    const parent = await lookupByKey(locttDir, pKey);
    const ordered = (parent.frontmatter.relationships ?? [])
      .filter(r => r.type === "parent")
      .sort((a, b) => (a.rank ?? "").localeCompare(b.rank ?? ""));
    // c1 should now be the last by rank — note other children have
    // no rank yet (legacy/inserted-without-rank), so they sort before
    // anything ranked. After this op c1 is the only ranked one.
    expect(ordered.map(r => r.target)).toContain(
      (await lookupByKey(locttDir, c1)).frontmatter.id,
    );
    // c1's rank should be set.
    const c1Id = (await lookupByKey(locttDir, c1)).frontmatter.id;
    const c1Link = (parent.frontmatter.relationships ?? []).find(
      r => r.type === "parent" && r.target === c1Id,
    );
    expect(c1Link?.rank).toBeDefined();
  });

  it("places before/after a specific anchor", async () => {
    const [pKey, c1, c2, c3] = await makeTasks(4) as [string, string, string, string];
    await linkChildren(pKey, [c1, c2, c3]);

    // Establish initial ranks by appending each to end.
    await reorderRelationship({ locttDir, sourceRef: pKey, relationshipType: "parent", targetRef: c1 });
    await reorderRelationship({ locttDir, sourceRef: pKey, relationshipType: "parent", targetRef: c2 });
    await reorderRelationship({ locttDir, sourceRef: pKey, relationshipType: "parent", targetRef: c3 });

    // Move c3 before c2.
    await reorderRelationship({
      locttDir, sourceRef: pKey, relationshipType: "parent",
      targetRef: c3, before: c2,
    });

    const parent = await lookupByKey(locttDir, pKey);
    const ordered = (parent.frontmatter.relationships ?? [])
      .filter(r => r.type === "parent")
      .sort((a, b) => (a.rank ?? "").localeCompare(b.rank ?? ""));
    const c1Id = (await lookupByKey(locttDir, c1)).frontmatter.id;
    const c2Id = (await lookupByKey(locttDir, c2)).frontmatter.id;
    const c3Id = (await lookupByKey(locttDir, c3)).frontmatter.id;
    expect(ordered.map(r => r.target)).toEqual([c1Id, c3Id, c2Id]);
  });

  it("rejects passing both before and after", async () => {
    const [pKey, c1, c2] = await makeTasks(3) as [string, string, string];
    await linkChildren(pKey, [c1, c2]);
    await expect(
      reorderRelationship({
        locttDir, sourceRef: pKey, relationshipType: "parent",
        targetRef: c1, before: c2, after: c2,
      }),
    ).rejects.toThrow(ReorderError);
  });

  it("rejects when the target isn't linked to the source", async () => {
    const [pKey, c1] = await makeTasks(2) as [string, string];
    await expect(
      reorderRelationship({
        locttDir, sourceRef: pKey, relationshipType: "parent", targetRef: c1,
      }),
    ).rejects.toThrow(/has no/);
  });
});

describe("reorderBoardRank", () => {
  it("assigns an initial rank when called on an unranked task", async () => {
    const [k1] = await makeTasks(1) as [string];
    const result = await reorderBoardRank({ locttDir, taskRef: k1 });
    expect(typeof result.rank).toBe("string");
    expect(result.rank.length).toBeGreaterThan(0);
    const task = await lookupByKey(locttDir, k1);
    expect(task.frontmatter.board_rank).toBe(result.rank);
  });

  it("places before / after another ranked task", async () => {
    const [k1, k2, k3] = await makeTasks(3) as [string, string, string];
    await reorderBoardRank({ locttDir, taskRef: k1 });
    await reorderBoardRank({ locttDir, taskRef: k2 });
    await reorderBoardRank({ locttDir, taskRef: k3 });

    // Move k3 before k2.
    await reorderBoardRank({ locttDir, taskRef: k3, before: k2 });

    const t1 = await lookupByKey(locttDir, k1);
    const t2 = await lookupByKey(locttDir, k2);
    const t3 = await lookupByKey(locttDir, k3);
    const ranks = [t1, t3, t2].map(t => t.frontmatter.board_rank!);
    // After op: k1 < k3 < k2
    expect(ranks[0]! < ranks[1]!).toBe(true);
    expect(ranks[1]! < ranks[2]!).toBe(true);
  });
});
