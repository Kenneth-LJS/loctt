import { access } from "node:fs/promises";

import type { LocttState,QueriesConfig, WorkflowConfig } from "@loctt/contracts";

import { loadQueriesConfig } from "../config/queries.js";
import { loadWorkflowConfig } from "../config/workflow.js";
import { resolveLocttDir } from "../paths/index.js";
import { CURRENT_SCHEMA_VERSION, readSchemaVersion } from "../schema/index.js";
import { loadState } from "../state/state.js";
import { listTaskIds } from "../task/list-ids.js";

/**
 * Schema-version status relative to what the running core was built for.
 *
 *  - `current`: the on-disk schema version matches CURRENT_SCHEMA_VERSION.
 *  - `outdated`: on-disk is older; the user should run `loctt migrate`
 *    from the CLI before further writes.
 *  - `future`: on-disk is newer than this core knows about. Probably a
 *    too-old CLI/UI vs a tracker upgraded elsewhere. Read-only is safe;
 *    writes may corrupt data.
 *  - `missing`: no `.schema-version` file. Either an un-migrated legacy
 *    tracker or a corrupted setup.
 *  - `unknown`: the file existed but couldn't be parsed (treated as
 *    corrupted; surface in doctor).
 */
export type SchemaStatus =
  | { kind: "current"; version: number }
  | { kind: "outdated"; on_disk: number; current: number }
  | { kind: "future"; on_disk: number; current: number }
  | { kind: "missing" }
  | { kind: "unknown"; message: string };

/** Information about a .loctt tracker. */
export interface TrackerInfo {
  readonly locttDir: string;
  readonly exists: boolean;
  readonly taskCount: number;
  readonly workflowConfig: WorkflowConfig | null;
  readonly queriesConfig: QueriesConfig | null;
  readonly state: LocttState | null;
  readonly schemaStatus: SchemaStatus;
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
      schemaStatus: { kind: "missing" },
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
  const schemaStatus = await computeSchemaStatus(locttDir);

  return {
    locttDir,
    exists: true,
    taskCount: taskIds.length,
    workflowConfig,
    queriesConfig,
    state,
    schemaStatus,
  };
}

async function computeSchemaStatus(locttDir: string): Promise<SchemaStatus> {
  let onDisk: number | null;
  try {
    onDisk = await readSchemaVersion(locttDir);
  } catch (err) {
    return { kind: "unknown", message: (err as Error).message };
  }
  if (onDisk === null) return { kind: "missing" };
  if (onDisk === CURRENT_SCHEMA_VERSION) return { kind: "current", version: onDisk };
  if (onDisk < CURRENT_SCHEMA_VERSION) return { kind: "outdated", on_disk: onDisk, current: CURRENT_SCHEMA_VERSION };
  return { kind: "future", on_disk: onDisk, current: CURRENT_SCHEMA_VERSION };
}
