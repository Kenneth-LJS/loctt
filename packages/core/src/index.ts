// @loctt/core — shared LocTT logic

export type { OptionalConfigs } from "./config/index.js";
export type { ConfigKeyDef } from "./config/index.js";
export { loadWorkflowConfig, parseWorkflowConfig } from "./config/index.js";
export { loadQueriesConfig, parseQueriesConfig } from "./config/index.js";
export { loadOptionalConfigs } from "./config/index.js";
export { validateTaskAgainstWorkflow, validateWorkflowConfig } from "./config/index.js";
export {
  CONFIG_KEYS,
  ConfigRouterError,
  getConfigValue,
  listConfigKeys,
  setConfigValue,
  unsetConfigValue,
} from "./config/index.js";
export { QueriesConfigError } from "./config/queries.js";
export type { ValidationError } from "./config/validation.js";
export { WorkflowConfigError } from "./config/workflow.js";
export type { TrackerInfo } from "./diagnostics/index.js";
export type { CheckStatus,DiagnosticCheck } from "./diagnostics/index.js";
export { getTrackerInfo } from "./diagnostics/index.js";
export { runDoctor } from "./diagnostics/index.js";
export type { FetchResult, GitStatusResult, PushResult } from "./git/index.js";
export type { RekeyResult } from "./git/index.js";
export {
  commitToLocttBranch,
  disableGit,
  enableGit,
  fetchLocttBranch,
  getGitStatus,
  GitSyncError,
  publish,
  pullFromLocttBranch,
  pushLocttBranch,
  sync,
} from "./git/index.js";
export { mergeKeyHistory,mergeRelationships, rekeyCollisions } from "./git/index.js";
export type { InitOptions, InitResult } from "./init/index.js";
export { initLoctt } from "./init/index.js";
export {
  assertSafeBasename,
  getAttachmentPath,
  getAttachmentsDir,
  getConfigDir,
  getDocsDir,
  getHistoryFilePath,
  getKeyIndexPath,
  getLegacyHistoryFilePath,
  getLocalDir,
  getQueriesConfigPath,
  getReconcileStatePath,
  getStateFilePath,
  getSyncStatePath,
  getTaskDir,
  getTaskFilePath,
  getTasksDir,
  getWorkflowConfigPath,
  resolveLocttDir,
} from "./paths/index.js";
export type { Token, TokenType } from "./query/index.js";
export type { ComparisonOp,QueryNode, QueryValue } from "./query/index.js";
export type { EvalContext } from "./query/index.js";
export type { ListContext,ListOptions, ListTasksOptions } from "./query/index.js";
export { tokenize, TokenizeError } from "./query/index.js";
export { ParseError,parseQuery } from "./query/index.js";
export { evaluateQuery } from "./query/index.js";
export { buildListContext, listTasks, resolveView } from "./query/index.js";
export type { KeyIndex } from "./state/index.js";
export { loadState, parseState, saveState, serializeState, StateError } from "./state/index.js";
export { loadSyncState, parseSyncState, saveSyncState, serializeSyncState, SyncStateError } from "./state/index.js";
export { clearReconcileState, loadReconcileState, parseReconcileState, ReconcileStateError,saveReconcileState, serializeReconcileState } from "./state/index.js";
export { allocateKey, appendKeyHistory, initKeyAllocation, KeyAllocationError } from "./state/index.js";
export { addToKeyIndex,loadKeyIndex, lookupKeyInIndex, rebuildKeyIndex, saveKeyIndex } from "./state/index.js";
export type { AttachOptions, AttachResult, DetachOptions } from "./task/index.js";
export type { CreateTaskOptions, CreateTaskParams } from "./task/index.js";
export type { AttachmentInfo, TaskShowModel } from "./task/index.js";
export type { RelationshipValidationError } from "./task/index.js";
export type { SetFieldOptions } from "./task/index.js";
export type { LinkTaskOptions, UnlinkTaskOptions } from "./task/index.js";
export {
  attachFile,
  AttachmentExistsError,
  AttachmentNotFoundError,
  AttachmentSourceError,
  detachFile,
} from "./task/index.js";
export { appendHistory, readHistory } from "./task/index.js";
export { assembleTaskFile, parseFrontmatter, serializeFrontmatter, splitTaskFile, TaskParseError } from "./task/index.js";
export { appendTaskBody, readTask, readTaskBody, writeTask, writeTaskBody } from "./task/index.js";
export { listTaskIds, loadAllTasks, lookupById, lookupByKey, lookupTask, TaskNotFoundError } from "./task/index.js";
export { createTask } from "./task/index.js";
export { buildShowModel,discoverAttachments } from "./task/index.js";
export { setField, TaskUpdateError,unsetField } from "./task/index.js";
export { archiveTask, deleteTask, TaskLifecycleError,unarchiveTask } from "./task/index.js";
export { linkTask, RelationshipError,unlinkTask } from "./task/index.js";
export { buildTree, getChildren, getParents,getRelatedTasks, validateRelationships } from "./task/index.js";
