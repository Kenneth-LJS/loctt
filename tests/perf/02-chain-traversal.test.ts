import path from "node:path";
import { performance } from "node:perf_hooks";

import type { Task } from "@loctt/contracts";
import {
  createTask,
  getChildren,
  linkTask,
  loadAllTasks,
  loadOptionalConfigs,
  loadState,
  resolveProjectIdForUser,
  saveState,
} from "@loctt/core";
import { describe, expect, it } from "vitest";

import { withTmpLoctt } from "../integration/fixtures/tmp-loctt.js";

const CHAIN_LENGTH = 100;
const BUILD_BUDGET_MS = 30_000;
const TRAVERSAL_BUDGET_MS = 5_000;

describe("perf: 100-task chain traversal", () => {
  it("builds a 100-deep chain and traverses it under budget", async () => {
    await withTmpLoctt(async ({ root }) => {
      const locttDir = path.join(root, ".loctt");
      const state = await loadState(locttDir);
      const { workflowConfig } = await loadOptionalConfigs(locttDir);
      if (!workflowConfig) {
        throw new Error("workflow config missing in fresh tmp loctt");
      }

      // Build the chain: create 100 tasks, then link each to its predecessor
      // as parent. linkTask(taskId=child, type="parent", target=parentId)
      // gives us: T-1 (root) -> T-2 -> ... -> T-100 via the structural
      // `parent` edge (and inverse `child` written on the parent).
      const project = await resolveProjectIdForUser(locttDir);

      const tBuildStart = performance.now();
      const created: Task[] = [];
      for (let i = 0; i < CHAIN_LENGTH; i++) {
        const task = await createTask({
          locttDir,
          state,
          workflowConfig,
          options: { project, title: `chain ${i}` },
        });
        created.push(task);
      }
      await saveState(locttDir, state);

      for (let i = 1; i < CHAIN_LENGTH; i++) {
        const child = created[i];
        const parent = created[i - 1];
        if (child === undefined || parent === undefined) {
          throw new Error(`chain build produced no task at index ${i}`);
        }
        await linkTask({
          locttDir,
          taskId: child.frontmatter.id,
          type: "parent",
          target: parent.frontmatter.id,
          workflowConfig,
        });
      }
      const buildMs = performance.now() - tBuildStart;

      // Traverse from the root (T-1) following children over the
      // in-memory task set. `getChildren` finds tasks *holding* an
      // `axis` edge that targets the given id, so walking downward uses
      // the `parent` axis — the edge each child stores pointing up — not
      // the inverse `child` edge stored on the parent.
      const chainRoot = created[0];
      if (chainRoot === undefined) throw new Error("chain build produced no root task");

      const tTravStart = performance.now();
      const tasks = await loadAllTasks(locttDir);
      const visited: string[] = [];
      const stack: string[] = [chainRoot.frontmatter.id];
      while (stack.length > 0) {
        const id = stack.pop();
        if (id === undefined) break;
        visited.push(id);
        const children = getChildren(tasks, id, "parent");
        for (const c of children) {
          stack.push(c.frontmatter.id);
        }
      }
      const traversalMs = performance.now() - tTravStart;

      console.log(
        `chain-traversal: build ${CHAIN_LENGTH} tasks + links in ${(buildMs / 1000).toFixed(2)}s; ` +
          `traversal visited ${visited.length} nodes in ${traversalMs.toFixed(1)}ms`,
      );

      expect(visited.length).toBe(CHAIN_LENGTH);
      expect(buildMs).toBeLessThan(BUILD_BUDGET_MS);
      expect(traversalMs).toBeLessThan(TRAVERSAL_BUDGET_MS);
    });
  });
});
