export { loadQueriesConfig, parseQueriesConfig } from "./queries.js";
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
export { validateTaskAgainstWorkflow, validateWorkflowConfig } from "./validation.js";
export { loadWorkflowConfig, parseWorkflowConfig } from "./workflow.js";

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
  return { workflowConfig, queriesConfig };
}
