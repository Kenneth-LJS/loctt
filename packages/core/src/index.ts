// @loctt/core — shared LocTT logic

export { loadWorkflowConfig, parseWorkflowConfig } from "./config/index.js";
export { loadQueriesConfig, parseQueriesConfig } from "./config/index.js";
export { WorkflowConfigError } from "./config/workflow.js";
export { QueriesConfigError } from "./config/queries.js";
export { validateTaskAgainstWorkflow, validateWorkflowConfig } from "./config/index.js";
export type { ValidationError } from "./config/validation.js";

export { loadState, saveState, parseState, serializeState, StateError } from "./state/index.js";
export { loadSyncState, saveSyncState, parseSyncState, serializeSyncState, SyncStateError } from "./state/index.js";
export { loadReconcileState, saveReconcileState, clearReconcileState, parseReconcileState, serializeReconcileState, ReconcileStateError } from "./state/index.js";
export { allocateKey, initKeyAllocation, appendKeyHistory, KeyAllocationError } from "./state/index.js";

export { splitTaskFile, parseFrontmatter, serializeFrontmatter, assembleTaskFile, TaskParseError } from "./task/index.js";
export { readTask, writeTask, readTaskBody, writeTaskBody } from "./task/index.js";
export { listTaskIds, loadAllTasks, lookupById, lookupByKey, lookupTask, TaskNotFoundError } from "./task/index.js";
export { createTask } from "./task/index.js";
export type { CreateTaskOptions } from "./task/index.js";
export { discoverAttachments, buildShowModel } from "./task/index.js";
export type { AttachmentInfo, TaskShowModel } from "./task/index.js";

export {
  resolveLocttDir,
  getTaskDir,
  getTasksDir,
  getTaskFilePath,
  getConfigDir,
  getStateFilePath,
  getLocalDir,
  getWorkflowConfigPath,
  getQueriesConfigPath,
  getSyncStatePath,
  getReconcileStatePath,
  getDocsDir,
} from "./paths/index.js";
