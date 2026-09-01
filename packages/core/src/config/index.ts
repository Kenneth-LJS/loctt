export type {
  ArchivedGuardConfigs,
  ArchivedGuardField,
  UnreadableSlice,
} from "./archived-guard.js";
export {
  ArchivedReferenceError,
  assertNotArchivedReferences,
  assertNotArchivedRelationshipTarget,
  loadArchivedGuardConfigs,
} from "./archived-guard.js";
export {
  CalendarConfigError,
  calendarConfigExists,
  detectMachineTimezone,
  getCalendarConfigPath,
  loadCalendarConfig,
  parseCalendarConfig,
  saveCalendarConfig,
  serializeCalendarConfig,
} from "./calendar.js";
export {
  getLabelsConfigPath,
  LabelsConfigError,
  labelsConfigExists,
  loadLabelsConfig,
  parseLabelsConfig,
  saveLabelsConfig,
  serializeLabelsConfig,
} from "./labels.js";
export {
  ListViewConfigError,
  loadListViewConfig,
  parseListViewConfig,
  pruneListViewForRemovedCustomFields,
  saveListViewConfig,
} from "./list-view.js";
export {
  getMilestonesConfigPath,
  loadMilestonesConfig,
  MilestonesConfigError,
  milestonesConfigExists,
  parseMilestonesConfig,
  saveMilestonesConfig,
  serializeMilestonesConfig,
} from "./milestones.js";
export {
  getProjectsConfigPath,
  loadProjectsConfig,
  parseProjectsConfig,
  ProjectsConfigError,
  projectsConfigExists,
  saveProjectsConfig,
  serializeProjectsConfig,
} from "./projects.js";
export {
  loadQueriesConfig,
  parseQueriesConfig,
  saveQueriesConfig,
  serializeQueriesConfig,
} from "./queries.js";
export {
  CONFIG_KEYS,
  type ConfigContext,
  type ConfigKeyDef,
  ConfigRouterError,
  getConfigValue,
  listConfigKeys,
  setConfigValue,
  unsetConfigValue,
} from "./router.js";
export {
  getSprintsConfigPath,
  loadSprintsConfig,
  parseSprintsConfig,
  saveSprintsConfig,
  serializeSprintsConfig,
  SprintsConfigError,
  sprintsConfigExists,
} from "./sprints.js";
export { validateTaskAgainstWorkflow, validateWorkflowConfig } from "./validation.js";
export { loadWorkflowConfig, parseWorkflowConfig } from "./workflow.js";
export type { WorkflowRemap } from "./workflow-write.js";
export {
  applyWorkflowEdit,
  computeWorkflowKeyCounts,
  computeWorkflowKeyUsage,
  saveWorkflowConfig,
  validateRemapCoversDeletions,
} from "./workflow-write.js";

import type { QueriesConfig,WorkflowConfig } from "@loctt/contracts";

import { todayInZone } from "../utils/today.js";
import { loadCalendarConfig } from "./calendar.js";
import { loadQueriesConfig } from "./queries.js";
import { loadWorkflowConfig } from "./workflow.js";

export interface OptionalConfigs {
  workflowConfig?: WorkflowConfig;
  queriesConfig?: QueriesConfig;
  /**
   * Today's date (`YYYY-MM-DD`) in the workspace timezone from
   * calendar.yaml. Pass to `listTasks` as `options.today` so the
   * `today` literal in queries resolves against the workspace zone
   * rather than UTC.
   *
   * Resolved here so every list surface gets it from one place and
   * they can't drift apart on what "today" means.
   */
  today?: string;
}

/**
 * Loads workflow and queries configs, returning undefined for either
 * on failure, plus the workspace-timezone `today`.
 */
/** True when the error is "the file does not exist", not "it will not parse". */
function isMissingFile(err: unknown): boolean {
  return (err as NodeJS.ErrnoException)?.code === "ENOENT";
}

export async function loadOptionalConfigs(locttDir: string): Promise<OptionalConfigs> {
  // Absent is fine; malformed is not. These catches used to swallow
  // both, so a `workflow.yaml` that would not parse read as "no
  // workflow config" — and every downstream check is guarded on the
  // config being present, so validation silently stopped. `loctt create
  // --status not_a_real_status` reported success against a broken file.
  //
  // ENOENT means the file is not there, which is a supported state for
  // both of these. Anything else is a file the user has, that we cannot
  // read, and continuing as though it were absent is the wrong answer.
  let workflowConfig: WorkflowConfig | undefined;
  let queriesConfig: QueriesConfig | undefined;
  try {
    workflowConfig = await loadWorkflowConfig(locttDir);
  } catch (err) {
    if (!isMissingFile(err)) throw err;
  }
  try {
    queriesConfig = await loadQueriesConfig(locttDir);
  } catch (err) {
    if (!isMissingFile(err)) throw err;
  }
  // loadCalendarConfig defaults to UTC when the file is absent, so
  // this always resolves; the catch covers a malformed file.
  let today: string;
  try {
    today = todayInZone((await loadCalendarConfig(locttDir)).timezone);
  } catch {
    today = todayInZone();
  }
  return {
    ...(workflowConfig !== undefined ? { workflowConfig } : {}),
    ...(queriesConfig !== undefined ? { queriesConfig } : {}),
    today,
  };
}
