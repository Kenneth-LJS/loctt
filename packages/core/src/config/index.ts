export {
  CalendarConfigError,
  calendarConfigExists,
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
  computeWorkflowKeyUsage,
  saveWorkflowConfig,
  validateRemapCoversDeletions,
} from "./workflow-write.js";

import type { QueriesConfig,WorkflowConfig } from "@loctt/contracts";

import { loadQueriesConfig } from "./queries.js";
import { loadWorkflowConfig } from "./workflow.js";

export interface OptionalConfigs {
  workflowConfig?: WorkflowConfig;
  queriesConfig?: QueriesConfig;
}

/** Loads workflow and queries configs, returning undefined for either on failure. */
export async function loadOptionalConfigs(locttDir: string): Promise<OptionalConfigs> {
  let workflowConfig: WorkflowConfig | undefined;
  let queriesConfig: QueriesConfig | undefined;
  try { workflowConfig = await loadWorkflowConfig(locttDir); } catch { /* ok */ }
  try { queriesConfig = await loadQueriesConfig(locttDir); } catch { /* ok */ }
  return {
    ...(workflowConfig !== undefined ? { workflowConfig } : {}),
    ...(queriesConfig !== undefined ? { queriesConfig } : {}),
  };
}
