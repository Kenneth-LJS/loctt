export type { FsProbe, FsProbeResult, SyncFsAdvisory, SyncFsClass } from "./fstype.js";
export { classifySyncFs, defaultFsProbe, detectSyncFsAdvisory } from "./fstype.js";
export type { EnableGitResult, GitStatusResult } from "./git-mode.js";
export { disableGit, enableGit, getGitStatus } from "./git-mode.js";
export type { AppliedRekey, FetchResult, GitRemoteFailure, GitRemoteFailureKind, PreflightReport, PushResult, SyncOutcome, SyncProgress } from "./publish-sync.js";
export { classifyRemoteFailure } from "./publish-sync.js";
export { preflight, PreflightError } from "./publish-sync.js";
export {
  commitToLocttBranch,
  fetchLocttBranch,
  GitConflictError,
  GitHistoryRewrittenError,
  GitReconcileInterruptedError,
  GitReconcileNeededError,
  GitRekeyNeededError,
  GitRemoteSchemaNewerError,
  GitSyncError,
  GitSyncFirstError,
  publish,
  pullFromLocttBranch,
  pushLocttBranch,
  sync,
} from "./publish-sync.js";
export type { RekeyLoser, RekeyOutcome, RekeyPlan, RekeyResult, RekeySkip } from "./reconcile.js";
export { mergeKeyHistory, mergeRelationships, previewRekey, rekeyCollisions } from "./reconcile.js";
export type { ApplyReconcileResult, TaskApplyResult } from "./reconcile-apply.js";
export { applyReconcile } from "./reconcile-apply.js";
export type { ConflictComputation } from "./reconcile-plan.js";
export {
  computeReconcilePlan,
  computeTaskConflicts,
  statusExistsLocally,
} from "./reconcile-plan.js";
export type { ApplyReconcileOutcome, ConfirmRekeyOutcome } from "./reconcile-session.js";
export {
  abandonReconcile,
  applyReconcileDecisions,
  confirmRekey,
  getReconcileState,
  loadReconcileSession,
  saveReconcileDecisions,
} from "./reconcile-session.js";
export type { Disposition, PathPlan, SyncPlan } from "./three-way.js";
export { LOCAL_OWNED, NEVER_MIRROR, planSync } from "./three-way.js";
