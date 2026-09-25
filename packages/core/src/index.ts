// @loctt/core — shared LocTT logic

export type {
  BackupAttachment,
  BackupHeader,
  BackupRecord,
  BadLine,
  ExportBackupOptions,
  ExportBackupReport,
  RestoreMode,
  RestoreOptions,
  RestoreReport,
} from "./backup/index.js";
export {
  BackupFormatError,
  DEFAULT_SPLIT_THRESHOLD_BYTES,
  EXCLUDED_FROM_BACKUP,
  EXCLUSION_REASONS,
  exportBackup,
  readBackupHeader,
  resolveBackupSet,
  restoreBackup,
  RestoreRefusedError,
} from "./backup/index.js";
export type { BoardColumn, ColumnKind, ColumnTask } from "./board/index.js";
export {
  bucketTasks,
  deriveColumns,
  ORPHAN_COLUMN_ID,
  sortColumn,
  UNCOVERED_COLUMN_ID,
} from "./board/index.js";
export type { OptionalConfigs } from "./config/index.js";
export type { WorkflowRemap } from "./config/index.js";
export type { ConfigKeyDef } from "./config/index.js";
export type { ArchivedGuardConfigs } from "./config/index.js";
export type {
  AddFieldValueInput,
  CreateBoardColumnInput,
  CreateCustomFieldInput,
  CreatePriorityInput,
  CreateRelationshipInput,
  CreateStatusInput,
  CreateTaskTypeInput,
  EditBoardColumnChanges,
  EditCustomFieldChanges,
  EditEstimationChanges,
  EditFieldValueChanges,
  EditPriorityChanges,
  EditRelationshipChanges,
  EditStatusChanges,
  EditTaskTypeChanges,
  EditTimelineChanges,
  IconColorInput,
} from "./config/index.js";
export type {
  ColorResolution,
  ColorResolveFailure,
  PaletteEntry,
} from "./config/index.js";
export {
  applyWorkflowEdit,
  computeWorkflowKeyCounts,
  computeWorkflowKeyUsage,
  saveWorkflowConfig,
  validateRemapCoversDeletions,
} from "./config/index.js";
export {
  addFieldValue,
  createBoardColumn,
  createCustomField,
  createPriority,
  createRelationship,
  createStatus,
  createTaskType,
  deleteBoardColumn,
  deleteCustomField,
  deleteFieldValue,
  deletePriority,
  deleteRelationship,
  deleteStatus,
  deleteTaskType,
  editBoardColumn,
  editCustomField,
  editEstimationConfig,
  editFieldValue,
  editPriority,
  editRelationship,
  editStatus,
  editTaskType,
  editTimelineConfig,
  reorderBoardColumns,
  reorderFieldValues,
  reorderPriorities,
  reorderStatuses,
  reorderTaskTypes,
  WorkflowEntityError,
} from "./config/index.js";
export { loadWorkflowConfig, parseWorkflowConfig } from "./config/index.js";
export {
  loadQueriesConfig,
  parseQueriesConfig,
  saveQueriesConfig,
  serializeQueriesConfig,
} from "./config/index.js";
export {
  getProjectsConfigPath,
  loadProjectsConfig,
  parseProjectsConfig,
  ProjectsConfigError,
  projectsConfigExists,
  saveProjectsConfig,
  serializeProjectsConfig,
} from "./config/index.js";
export { loadOptionalConfigs } from "./config/index.js";
export { filterByName, filterProjects, isBlankQuery } from "./config/index.js";
export { brokenEntriesToPlain, collectValidEntries } from "./config/index.js";
export {
  BUILTIN_PALETTE,
  getPaletteEntry,
  isKnownPaletteId,
  resolveEntityColor,
  resolveEntityColorOr,
} from "./config/index.js";
export { validateTaskAgainstWorkflow, validateWorkflowConfig } from "./config/index.js";
export {
  ArchivedReferenceError,
  assertNotArchivedReferences,
  assertNotArchivedRelationshipTarget,
  loadArchivedGuardConfigs,
} from "./config/index.js";
export {
  CONFIG_KEYS,
  ConfigRouterError,
  getConfigValue,
  listConfigKeys,
  setConfigValue,
  unsetConfigValue,
} from "./config/index.js";
export {
  CalendarConfigError,
  calendarConfigExists,
  detectMachineTimezone,
  getCalendarConfigPath,
  loadCalendarConfig,
  parseCalendarConfig,
  saveCalendarConfig,
  serializeCalendarConfig,
} from "./config/index.js";
export {
  ListViewConfigError,
  loadListViewConfig,
  parseListViewConfig,
  pruneListViewForRemovedCustomFields,
  saveListViewConfig,
} from "./config/index.js";
export {
  applyArchivedScope,
  getLabelsConfigPath,
  LabelsConfigError,
  labelsConfigExists,
  loadLabelsConfig,
  parseLabelsConfig,
  saveLabelsConfig,
  serializeLabelsConfig,
} from "./config/index.js";
export {
  getMilestonesConfigPath,
  loadMilestonesConfig,
  MilestonesConfigError,
  milestonesConfigExists,
  parseMilestonesConfig,
  saveMilestonesConfig,
  serializeMilestonesConfig,
} from "./config/index.js";
export {
  getSprintsConfigPath,
  loadSprintsConfig,
  parseSprintsConfig,
  saveSprintsConfig,
  serializeSprintsConfig,
  SprintsConfigError,
  sprintsConfigExists,
} from "./config/index.js";
export { QueriesConfigError } from "./config/queries.js";
export type { ValidationError } from "./config/validation.js";
export { WorkflowConfigError } from "./config/workflow.js";
export { formatIfZodError } from "./config/zod-error.js";
export type { SchemaStatus, TrackerInfo } from "./diagnostics/index.js";
export type { CheckStatus,DiagnosticCheck } from "./diagnostics/index.js";
export type { IntegrityFinding, IntegritySeverity, IntegritySummary } from "./diagnostics/index.js";
export { computeSchemaStatus, getTrackerInfo } from "./diagnostics/index.js";
export { blockingFindings, checkDataIntegrity, computeIntegritySummary, runDoctor, runDoctorStream } from "./diagnostics/index.js";
export type { LocttErrorOptions } from "./errors.js";
export { errorEnvelope, LocttError } from "./errors.js";
export type { AppliedRekey, EnableGitOptions, EnableGitResult, FetchResult, FsProbe, FsProbeResult, GitRemoteFailure, GitRemoteFailureKind, GitStatusResult, MalformedSyncedTask, PreflightReport, PushResult, SyncFsAdvisory, SyncFsClass, SyncOutcome, SyncProgress } from "./git/index.js";
export type {
  ApplyReconcileOutcome,
  ApplyReconcileResult,
  ConflictComputation,
  RekeyLoser,
  RekeyOutcome,
  RekeyPlan,
  RekeyResult,
  RekeySkip,
  TaskApplyResult,
} from "./git/index.js";
export {
  abandonReconcile,
  applyReconcile,
  applyReconcileDecisions,
  classifySyncFs,
  commitToLocttBranch,
  computeReconcilePlan,
  computeTaskConflicts,
  confirmRekey,
  defaultFsProbe,
  DELETE_VS_EDIT_FIELD,
  detectSyncFsAdvisory,
  disableGit,
  enableGit,
  fetchLocttBranch,
  getGitStatus,
  // GIT-25: the adopt-or-stop refusal for a pre-existing LocTT-written
  // branch, so a surface can distinguish it from a foreign-content refusal.
  GitBranchAdoptNeededError,
  // Re-exported so callers can distinguish a conflict from any other git
  // failure (GIT-C5). It lived in git/index.ts only, which put it out of
  // reach of apps/web — the reason every git error there was reported
  // identically.
  GitConflictError,
  GitHistoryRewrittenError,
  GitReconcileInterruptedError,
  GitReconcileNeededError,
  GitRekeyNeededError,
  GitRemoteSchemaNewerError,
  GitSyncError,
  GitSyncFirstError,
  GitWorktreeMissingError,
  loadReconcileSession,
  preflight,
  PreflightError,
  previewRekey,
  publish,
  pullFromLocttBranch,
  pushLocttBranch,
  saveReconcileDecisions,
  statusExistsLocally,
  sync,
} from "./git/index.js";
export { classifyRemoteFailure } from "./git/index.js";
export { mergeKeyHistory, mergeRelationships, rekeyCollisions } from "./git/index.js";
export {
  assignProvisionalPrefixes,
  assignProvisionalSlugs,
  deriveKeyState,
  mergeById,
  mergeComments,
  mergeHistory,
  mergeTask,
} from "./git/merge.js";
export type { InitOptions, InitResult } from "./init/index.js";
export { initLoctt, InitRepairNeededError, isEmptyTracker, missingCoreFiles } from "./init/index.js";
export type { CreateLabelInput, DeleteLabelOptions, LabelByNameResult } from "./labels/index.js";
export {
  archiveLabel,
  assertLabelIdsRegistered,
  createLabel,
  deleteLabel,
  editLabel,
  findLabel,
  LabelError,
  resolveLabelByName,
  resolveLabelIdFromInput,
  unarchiveLabel,
} from "./labels/index.js";
export type { LossyConstruct } from "./markdown/index.js";
export { findLossyConstructs, requiresSourceMode } from "./markdown/index.js";
export type { CreateMilestoneInput, DeleteMilestoneOptions, MilestoneByNameResult } from "./milestones/index.js";
export {
  archiveMilestone,
  createMilestone,
  deleteMilestone,
  editMilestone,
  findMilestone,
  MilestoneError,
  resolveMilestoneByName,
  resolveMilestoneIdFromInput,
  unarchiveMilestone,
} from "./milestones/index.js";
export {
  assertSafeBasename,
  getAttachmentPath,
  getAttachmentsDir,
  getConfigDir,
  getCurrentUserPath,
  getDocsDir,
  getHistoryFilePath,
  getKeyIndexPath,
  getLocalDir,
  getPrefixRenameStatePath,
  getQueriesConfigPath,
  getReconcileStatePath,
  getSchemaMigrationInProgressPath,
  getSchemaVersionPath,
  getStateFilePath,
  getSyncStatePath,
  getTaskDir,
  getTaskFilePath,
  getTasksDir,
  getUserDir,
  getUserProfilePath,
  getUsersDir,
  getUserSettingsPath,
  getWorkflowConfigPath,
  resolveLocttDir,
} from "./paths/index.js";
export type { DeleteProjectOptions } from "./projects/index.js";
export type { SetPrefixResult } from "./projects/index.js";
export type { CreateProjectInput, ProjectByNameResult } from "./projects/index.js";
export {
  completeInterruptedPrefixRename,
  readPrefixRenameState,
  recoverInterruptedPrefixRename,
  setProjectPrefix,
} from "./projects/index.js";
export {
  allocateSlug,
  archiveProject,
  createProject,
  deleteProject,
  editProject,
  findProject,
  findProjectBySlug,
  isValidSlug,
  PartialRemapError,
  projectDefaultIsGhost,
  ProjectError,
  projectSlug,
  resolveProjectByName,
  resolveProjectId,
  resolveProjectIdForUser,
  resolveProjectIdFromInput,
  setDefaultProject,
  slugifyName,
  unarchiveProject,
} from "./projects/index.js";
export type { Token, TokenType } from "./query/index.js";
export type { ComparisonOp,QueryNode, QueryValue } from "./query/index.js";
export type { EvalContext } from "./query/index.js";
export type { ListContext,ListOptions, ListTasksOptions } from "./query/index.js";
export type { ListTasksResult } from "./query/index.js";
export type { ValidateQueryOptions } from "./query/index.js";
export { tokenize, TokenizeError } from "./query/index.js";
// The single tokenizer-checked DSL atom quoter. Exported so every
// producer — including the web server, whose private copy under-quotes
// grammar-colliding bare values — can share one round-trip-safe quoter.
export { dslAtom, queryNodeToDsl } from "./query/index.js";
// K102: a saved view stores an ordered filter list; these turn it into
// something runnable (an in-memory AST), readable (a display summary),
// or scannable, and normalize it for storage (spacing only).
export { FilterError, filtersToNode, filtersToScannableText, filtersToSummary, filterToNode, filterToSummary, normalizeFilter, normalizeFilters } from "./query/index.js";
export { QUERYABLE_FIELDS, QueryValidationError, validateQuery } from "./query/index.js";
export { ParseError,parseQuery } from "./query/index.js";
export { evaluateQuery } from "./query/index.js";
export { buildListContext, DEFAULT_LIST_LIMIT, listTasks, listTasksPaginated, loadCommentMentions, queryReferencesCommentMentions, resolveCommentMentionsContext, resolveView } from "./query/index.js";
export type { BoardMoveOptions, BoardMoveResult } from "./rank/index.js";
export type {
  ReorderBoardRankOptions,
  ReorderRelationshipOptions,
  ReorderResult,
} from "./rank/index.js";
export { boardMove } from "./rank/index.js";
export {
  MAX as LEXORANK_MAX,
  MIN as LEXORANK_MIN,
  between as lexorankBetween,
  compare as lexorankCompare,
  reorderBoardRank,
  ReorderError,
  reorderRelationship,
} from "./rank/index.js";
export type { Migration, MigrationPlan, MigrationResult } from "./schema/index.js";
export {
  backupLocttDir,
  CURRENT_SCHEMA_VERSION,
  findMigrationPath,
  isMigrationLocked,
  listMigrations,
  migrateToCurrent,
  planMigration,
  readSchemaVersion,
  requireSupportedSchema,
  SchemaTooNewError,
  SchemaUnmigratableError,
  SchemaVersionError,
  withMigrationLock,
  writeSchemaVersion,
} from "./schema/index.js";
export type {
  BurndownPoint,
  BurndownSeries,
  BurndownUnit,
  CreateSprintInput,
  DeleteSprintOptions,
  EditSprintOptions,
  IdealPoint,
  SprintByNameResult,
} from "./sprints/index.js";
export {
  archiveSprint,
  BurndownError,
  computeBurndown,
  createSprint,
  deleteSprint,
  editSprint,
  findSprint,
  readBurndownSeries,
  resolveSprintByName,
  resolveSprintIdFromInput,
  SprintError,
  unarchiveSprint,
} from "./sprints/index.js";
export type { KeyIndex } from "./state/index.js";
export { loadState, parseState, saveState, serializeState, StateError } from "./state/index.js";
export { withStateLock } from "./state/index.js";
export {
  appendJournalEntry,
  clearJournalEntry,
  loadJournal,
  saveJournal,
} from "./state/index.js";
export { loadSyncState, parseSyncState, saveSyncState, serializeSyncState, SyncStateError } from "./state/index.js";
export { clearReconcileState, loadReconcileState, parseReconcileState, readReconcileState, ReconcileStateError,saveReconcileState, serializeReconcileState } from "./state/index.js";
export { allocateKey, appendKeyHistory, initKeyAllocation, KeyAllocationError } from "./state/index.js";
export { addToKeyIndex, loadKeyIndex, lookupKeyInIndex, rebuildKeyIndex, removeFromKeyIndex, saveKeyIndex } from "./state/index.js";
export { classifyTaskHealth, CorruptFieldError } from "./task/health.js";
export { HistoryParseError } from "./task/history.js";
export type { AttachOptions, AttachResult, DetachOptions } from "./task/index.js";
export type { CreateTaskOptions, CreateTaskParams } from "./task/index.js";
export type { DuplicateTaskOverrides, DuplicateTaskParams } from "./task/index.js";
export type { AttachmentInfo, TaskShowModel } from "./task/index.js";
export type { RelationshipValidationError } from "./task/index.js";
export type { BulkArchiveOptions, BulkResult, BulkSetFieldsOptions } from "./task/index.js";
export type {
  Comment,
  DeleteCommentOptions,
  EditCommentOptions,
  PostCommentOptions,
} from "./task/index.js";
export type { CountTasksByReferenceOptions, TaskReferenceKind } from "./task/index.js";
export type { ExportOptions } from "./task/index.js";
export type { ReadHistoryOptions, ReadHistoryPage } from "./task/index.js";
export type { SetFieldOptions, SetFieldsEntry, SetFieldsOptions } from "./task/index.js";
export type { LinkTaskOptions, UnlinkTaskOptions } from "./task/index.js";
export type {
  BulkMoveTaskOptions,
  BulkMoveTaskResult,
  MoveTaskOptions,
  MoveTaskResult,
} from "./task/index.js";
export type { MilestoneProgressOptions, MilestoneProgressResult, Progress, ProgressReport, ProgressUnavailable } from "./task/index.js";
export type { BodyWriteOptions } from "./task/index.js";
export type { CommentsPage } from "./task/index.js";
export {
  buildMentionResolver,
  CommentError,
  deleteComment,
  editComment,
  extractMentions,
  formatCommentEditors,
  listComments,
  listCommentsPage,
  postComment,
} from "./task/index.js";
export {
  attachFile,
  AttachmentCaseCollisionError,
  AttachmentExistsError,
  AttachmentNotFoundError,
  AttachmentSourceError,
  DEFAULT_MAX_ATTACHMENT_BYTES,
  detachFile,
} from "./task/index.js";
export { appendHistory, isMalformedHistoryEntry, readHistory, readHistoryRows, validHistory } from "./task/index.js";
export { assembleTaskFile, parseFrontmatter, renderRawText, serializeFrontmatter, splitTaskFile, TaskParseError } from "./task/index.js";
export { ALL_FIELDS_TOUCHED, appendTaskBody, assertWriteSafe, CorruptWriteError, readTask, readTaskBody, withTrailingNewline, writeTask, writeTaskBody } from "./task/index.js";
export { listTaskIds, loadAllTasks, loadAllTasksDetailed, lookupById, lookupByKey, lookupTask, TaskNotFoundError, type UnreadableTask, UnreadableTaskError } from "./task/index.js";
export { createTask } from "./task/index.js";
export { type DuplicateResult,duplicateTask } from "./task/index.js";
export { buildShowModel,discoverAttachments } from "./task/index.js";
export { mimeForFilename } from "./task/index.js";
export {
  AUTO_MANAGED_FIELDS,
  BUILTIN_OPTIONAL_FIELDS,
  IMMUTABLE_FIELDS,
  setField,
  setFields,
  SYSTEM_MUTABLE_VIA,
  TaskUpdateError,
  unsetField,
  USER_IMMUTABLE_FIELDS,
  WRITABLE_BUILTIN_FIELDS,
} from "./task/index.js";
export { bulkArchive, bulkDelete, bulkLink, bulkSetFields } from "./task/index.js";
export { countTasksByReference, countTasksByReferences } from "./task/index.js";
export {
  DEFAULT_EXPORT_COLUMNS,
  exportTasksToCSV,
  exportTasksToJSON,
  filterForExport,
} from "./task/index.js";
export { archiveTask, deleteTask, TaskLifecycleError,unarchiveTask } from "./task/index.js";
export { bulkMoveTasksToProject, MoveTaskError,moveTaskToProject } from "./task/index.js";
export { linkTask, RelationshipError,unlinkTask } from "./task/index.js";
export { buildTree, getChildren, getParents,getRelatedTasks, validateRelationships } from "./task/index.js";
export {
  computeProgress,
  computeProgressFromStatuses,
  isProgressUnavailable,
  milestoneProgress,
  milestoneProgressDetailed,
  sprintProgress,
  sprintProgressDetailed,
  tallyStatusCategories,
} from "./task/index.js";
export { bodyToken, StaleBodyWriteError } from "./task/io.js";
export type { CreateUserOptions, DeleteUserOptions, EditUserOptions, UserReferenceCounts, UserSettings } from "./users/index.js";
export type { PinSweep } from "./users/index.js";
export type { RecentEntry } from "./users/index.js";
export type { ResolvedSidebarItem, SalvagedSidebarGroups, SidebarGroupsDrop, SidebarGroupsDropReport } from "./users/index.js";
export {
  archiveUser,
  collectSidebarGroupsDrops,
  countUserReferences,
  createUser,
  CurrentUserError,
  defaultUserDisplayName,
  deleteUser,
  detectSystemTimezone,
  ensureDefaultUser,
  getCurrentUser,
  loadAllUsers,
  loadUserProfile,
  loadUserSettings,
  MAX_AVATAR_BYTES,
  parseUserProfile,
  pushRecent,
  readCurrentUserId,
  readRecents,
  readSidebarGroups,
  readSidebarPins,
  RECENTS_CAP,
  removeRecent,
  resolveSidebarOrder,
  resolveUserRef,
  salvageSidebarGroups,
  saveUserProfile,
  saveUserSettings,
  serializeUserProfile,
  SIDEBAR_VALID_IDS,
  sweepSidebarPins,
  switchCurrentUser,
  unarchiveUser,
  updateUser,
  UserError,
  userExists,
  UserProfileError,
  validateSidebarIds,
  writeCurrentUserId,
} from "./users/index.js";
export type { FsFailureKind } from "./utils/fs-errors.js";
export { FsAccessError, rethrowFsError, withFsErrors } from "./utils/fs-errors.js";
export type { AbsentFile, FileState, LoadedFile, UnreadableFile } from "./utils/read-state.js";
export {
  contentOr,
  isMissingFile,
  readFileState,
  UnreadableFileError,
} from "./utils/read-state.js";
export { todayInZone } from "./utils/today.js";
export type { CreateViewInput, DeleteViewOptions, EditViewInput } from "./views/index.js";
export {
  archiveView,
  createView,
  deleteView,
  editView,
  findView,
  findViewOrBroken,
  unarchiveView,
  ViewError,
  ViewNameTakenError,
} from "./views/index.js";
