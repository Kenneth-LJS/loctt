export { loadWorkflowConfig, parseWorkflowConfig } from "./workflow.js";
export { loadQueriesConfig, parseQueriesConfig } from "./queries.js";
export { validateTaskAgainstWorkflow, validateWorkflowConfig } from "./validation.js";

import type { WorkflowConfig, QueriesConfig } from "@loctt/contracts";
import { loadWorkflowConfig } from "./workflow.js";
import { loadQueriesConfig } from "./queries.js";

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
