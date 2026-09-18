import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";

import {
  createTask,
  loadOptionalConfigs,
  loadState,
  resolveProjectIdForUser,
  saveState,
} from "@loctt/core";
import { describe, expect, it } from "vitest";

import { withTmpLoctt } from "../integration/fixtures/tmp-loctt.js";

const TASK_COUNT = 1000;
const WALL_TIME_BUDGET_MS = 30_000;

describe("perf: bulk create 1000 tasks", () => {
  it("creates 1000 tasks under the wall-time budget", async () => {
    await withTmpLoctt(async ({ root }) => {
      const locttDir = path.join(root, ".loctt");
      const state = await loadState(locttDir);
      const { workflowConfig } = await loadOptionalConfigs(locttDir);

      const project = await resolveProjectIdForUser(locttDir);

      const t0 = performance.now();
      for (let i = 0; i < TASK_COUNT; i++) {
        await createTask({
          locttDir,
          state,
          ...(workflowConfig !== undefined ? { workflowConfig } : {}),
          options: { project, title: `bulk task ${i}` },
        });
      }
      // Persist state once at the end (matches CLI behavior per-call, but
      // batched here since we share state across the loop).
      await saveState(locttDir, state);
      const elapsedMs = performance.now() - t0;

      const stateBytes = (await stat(path.join(locttDir, "state.yaml"))).size;
      const taskDirs = await readdir(path.join(locttDir, "tasks"));

      const seconds = elapsedMs / 1000;
      const throughput = TASK_COUNT / seconds;
      const meanMs = elapsedMs / TASK_COUNT;
      console.log(
        `bulk-create: ${TASK_COUNT} tasks in ${seconds.toFixed(2)}s ` +
          `(${throughput.toFixed(1)} tasks/sec, ${meanMs.toFixed(2)} ms/task), ` +
          `state.yaml=${stateBytes} bytes`,
      );

      expect(taskDirs.length).toBe(TASK_COUNT);
      expect(elapsedMs).toBeLessThan(WALL_TIME_BUDGET_MS);
    });
  });
});
