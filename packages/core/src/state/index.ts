export type { Journal, JournalEntry, RecoveryHandler } from "./journal.js";
export {
  appendJournalEntry,
  clearJournalEntry,
  loadJournal,
  recoverPendingJournal,
  registerRecoveryHandler,
  removeJournalEntry,
  replayTaskRemap,
  replayTaskRemapStrict,
  saveJournal,
} from "./journal.js";
export type { KeyIndex } from "./key-index.js";
export { addToKeyIndex, loadKeyIndex, lookupKeyInIndex, rebuildKeyIndex, removeFromKeyIndex, saveKeyIndex } from "./key-index.js";
export { allocateKey, appendKeyHistory, initKeyAllocation, KeyAllocationError } from "./keys.js";
export { setStateLockRecoveryHook, withStateLock } from "./lock.js";
export { clearReconcileState, loadReconcileState, parseReconcileState, readReconcileState, ReconcileStateError,saveReconcileState, serializeReconcileState } from "./reconcile.js";
export { loadState, parseState, saveState, serializeState, StateError } from "./state.js";
export { loadSyncState, parseSyncState, saveSyncState, serializeSyncState, SyncStateError } from "./sync.js";

// Eager-wire recovery at module load when callers come in via this
// barrel — keeps the first withStateLock call hot (no dynamic
// import on the critical path). lock.ts has a lazy fallback for
// importers that bypass this barrel.
import { recoverPendingJournal } from "./journal.js";
import { setStateLockRecoveryHook } from "./lock.js";
setStateLockRecoveryHook(recoverPendingJournal);
