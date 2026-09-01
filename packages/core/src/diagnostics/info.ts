import { access, readFile } from "node:fs/promises";

import type { InitState, LocttState,QueriesConfig, WorkflowConfig } from "@loctt/contracts";

import { loadQueriesConfig } from "../config/queries.js";
import { loadWorkflowConfig } from "../config/workflow.js";
import { isEmptyTracker, missingCoreFiles } from "../init/core-files.js";
import { getSchemaMigrationInProgressPath, resolveLocttDir } from "../paths/index.js";
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
  /**
   * A `.schema-migration-in-progress` sentinel is present: a previous
   * migration crashed part-way. Distinct from every other kind
   * because no in-app action is safe here — re-running a migration
   * over a half-rewritten tracker compounds the damage — and because
   * recovery needs the backup path the sentinel recorded.
   */
  | {
      kind: "interrupted";
      from?: number;
      to?: number;
      backup?: string;
      sentinel_path: string;
    }
  | { kind: "unknown"; message: string };

/** Information about a .loctt tracker. */
export interface TrackerInfo {
  readonly locttDir: string;
  readonly exists: boolean;
  /**
   * Whether the tracker is usable, and if not, why. Prefer this over
   * `exists` for any decision about offering initialization.
   */
  readonly initState: InitState;
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
      initState: "absent",
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

  // A `.loctt/` missing any core file is not a working tracker. Which
  // *kind* of not-working decides what the surface may offer, and the
  // two are not interchangeable: initializing into an empty shell is
  // safe, initializing over surviving tasks destroys them.
  const missing = await missingCoreFiles(locttDir);
  const initState: InitState =
    missing.length === 0
      ? "ready"
      // `isEmptyTracker` is the shared definition of "nothing here",
      // so the web server's per-request guard and this read cannot
      // disagree about which directories are safe to initialize into.
      // The extra `queriesConfig`/`state` test is this function's
      // own: those loaded from files `isEmptyTracker` does not check,
      // and a readable config is someone's configuration even with no
      // tasks — so it is content, and this is `damaged`.
      : (await isEmptyTracker(locttDir))
          && workflowConfig === null && queriesConfig === null && state === null
        ? "empty"
        : "damaged";

  return {
    locttDir,
    exists: true,
    initState,
    taskCount: taskIds.length,
    workflowConfig,
    queriesConfig,
    state,
    schemaStatus,
  };
}

/**
 * The tracker's schema state, as four distinct kinds.
 *
 * Exported because the web server's boot guard needs it: the guard
 * refuses `/api/info` on a mismatch, so the surface cannot learn the
 * kind from the info payload it just blocked. Without this the client
 * was left recovering the kind from the error's prose, which turns a
 * copy edit into a behaviour change.
 */
export async function computeSchemaStatus(locttDir: string): Promise<SchemaStatus> {
  // The sentinel outranks the recorded version: a tracker can be
  // half-migrated *and* carry a version that looks perfectly current,
  // because the crash may have landed between the last step's version
  // stamp and the sentinel's removal. Checking the version first would
  // report that tracker as healthy.
  const sentinelPath = getSchemaMigrationInProgressPath(locttDir);
  const sentinel = await readMigrationSentinel(sentinelPath);
  if (sentinel !== null) return sentinel;

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

/**
 * Reads the interrupted-migration sentinel, or null when absent.
 *
 * An unreadable or malformed sentinel still reports `interrupted`
 * with whatever fields parsed. The file's presence is the fact that
 * matters; its contents are recovery guidance, and losing them is a
 * reason to show less, not a reason to report the tracker healthy.
 */
async function readMigrationSentinel(
  sentinelPath: string,
): Promise<SchemaStatus | null> {
  let raw: string;
  try {
    raw = await readFile(sentinelPath, "utf8");
  } catch {
    return null;
  }
  const field = (name: string): string | undefined =>
    new RegExp(`^${name}:\\s*(.+)$`, "m").exec(raw)?.[1]?.trim();
  const num = (name: string): number | undefined => {
    const v = field(name);
    if (v === undefined) return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  const from = num("from");
  const to = num("to");
  const backup = field("backup");
  return {
    kind: "interrupted",
    ...(from !== undefined ? { from } : {}),
    ...(to !== undefined ? { to } : {}),
    ...(backup !== undefined ? { backup } : {}),
    sentinel_path: sentinelPath,
  };
}
