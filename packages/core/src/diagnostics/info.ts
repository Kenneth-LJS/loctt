import { access } from "node:fs/promises";

import type { LocttState,QueriesConfig, WorkflowConfig } from "@loctt/contracts";

import { loadQueriesConfig } from "../config/queries.js";
import { loadWorkflowConfig } from "../config/workflow.js";
import { resolveLocttDir } from "../paths/index.js";
import { loadState } from "../state/state.js";
import { listTaskIds } from "../task/lookup.js";

/** Information about a .loctt tracker. */
export interface TrackerInfo {
  readonly locttDir: string;
  readonly exists: boolean;
  readonly taskCount: number;
  readonly workflowConfig: WorkflowConfig | null;
  readonly queriesConfig: QueriesConfig | null;
  readonly state: LocttState | null;
}

/** Gathers information about the tracker at the given root. */
export async function getTrackerInfo(root: string): Promise<TrackerInfo> {
  const locttDir = resolveLocttDir(root);

  let exists = true;
  try {
    await access(locttDir);
  } catch {
    exists = false;
  }

  if (!exists) {
    return {
      locttDir,
      exists: false,
      taskCount: 0,
      workflowConfig: null,
      queriesConfig: null,
      state: null,
    };
  }

  let workflowConfig: WorkflowConfig | null = null;
  try {
    workflowConfig = await loadWorkflowConfig(locttDir);
  } catch { /* missing or invalid */ }

  let queriesConfig: QueriesConfig | null = null;
  try {
    queriesConfig = await loadQueriesConfig(locttDir);
  } catch { /* missing or invalid */ }

  let state: LocttState | null = null;
  try {
    state = await loadState(locttDir);
  } catch { /* missing or invalid */ }

  const taskIds = await listTaskIds(locttDir);

  return {
    locttDir,
    exists: true,
    taskCount: taskIds.length,
    workflowConfig,
    queriesConfig,
    state,
  };
}
