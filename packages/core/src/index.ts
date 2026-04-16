// @loctt/core — shared LocTT logic

export { loadWorkflowConfig, parseWorkflowConfig } from "./config/index.js";
export { loadQueriesConfig, parseQueriesConfig } from "./config/index.js";
export { loadOptionalConfigs } from "./config/index.js";
export type { OptionalConfigs } from "./config/index.js";
export { WorkflowConfigError } from "./config/workflow.js";
export { QueriesConfigError } from "./config/queries.js";
export { validateTaskAgainstWorkflow, validateWorkflowConfig } from "./config/index.js";
export type { ValidationError } from "./config/validation.js";

export { loadState, saveState, parseState, serializeState, StateError } from "./state/index.js";
export { loadSyncState, saveSyncState, parseSyncState, serializeSyncState, SyncStateError } from "./state/index.js";
export { loadReconcileState, saveReconcileState, clearReconcileState, parseReconcileState, serializeReconcileState, ReconcileStateError } from "./state/index.js";
export { allocateKey, initKeyAllocation, appendKeyHistory, KeyAllocationError } from "./state/index.js";
export { loadKeyIndex, saveKeyIndex, rebuildKeyIndex, lookupKeyInIndex, addToKeyIndex } from "./state/index.js";
export type { KeyIndex } from "./state/index.js";

export { splitTaskFile, parseFrontmatter, serializeFrontmatter, assembleTaskFile, TaskParseError } from "./task/index.js";
export { readTask, writeTask, readTaskBody, writeTaskBody } from "./task/index.js";
export { listTaskIds, loadAllTasks, lookupById, lookupByKey, lookupTask, TaskNotFoundError } from "./task/index.js";
export { createTask } from "./task/index.js";
export type { CreateTaskOptions } from "./task/index.js";
export { discoverAttachments, buildShowModel } from "./task/index.js";
export type { AttachmentInfo, TaskShowModel } from "./task/index.js";
export { setField, unsetField, TaskUpdateError } from "./task/index.js";
export { archiveTask, unarchiveTask, deleteTask, TaskLifecycleError } from "./task/index.js";
export { linkTask, unlinkTask, RelationshipError } from "./task/index.js";
export { validateRelationships, getRelatedTasks, buildTree, getChildren, getParents } from "./task/index.js";
export type { RelationshipValidationError } from "./task/index.js";

export { tokenize, TokenizeError } from "./query/index.js";
export type { Token, TokenType } from "./query/index.js";
export { parseQuery, ParseError } from "./query/index.js";
export type { QueryNode, QueryValue, ComparisonOp } from "./query/index.js";
export { evaluateQuery } from "./query/index.js";
export type { EvalContext } from "./query/index.js";
export { listTasks, resolveView } from "./query/index.js";
export type { ListOptions, ListContext } from "./query/index.js";

export { getTrackerInfo } from "./diagnostics/index.js";
export type { TrackerInfo } from "./diagnostics/index.js";
export { runDoctor } from "./diagnostics/index.js";
export type { DiagnosticCheck, CheckStatus } from "./diagnostics/index.js";

export { enableGit, disableGit, getGitStatus } from "./git/index.js";
export type { GitStatusResult } from "./git/index.js";
export { publish, sync, GitSyncError } from "./git/index.js";
export { rekeyCollisions, mergeRelationships, mergeKeyHistory } from "./git/index.js";
export type { RekeyResult } from "./git/index.js";

export { initLoctt } from "./init/index.js";
export type { InitOptions, InitResult } from "./init/index.js";

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
  getKeyIndexPath,
} from "./paths/index.js";
