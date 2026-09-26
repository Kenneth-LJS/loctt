export { MAX_AVATAR_BYTES, removeAvatar } from "./avatar.js";
export {
  CurrentUserError,
  readCurrentUserId,
  writeCurrentUserId,
} from "./current.js";
export { UserError } from "./errors.js";
export type { CreateUserOptions, DeleteUserOptions, EditUserOptions, UserReferenceCounts } from "./lifecycle.js";
export {
  archiveUser,
  countUserReferences,
  createUser,
  deleteUser,
  detectSystemTimezone,
  unarchiveUser,
  updateUser,
} from "./lifecycle.js";
export {
  defaultUserDisplayName,
  ensureDefaultUser,
  getCurrentUser,
  resolveUserRef,
  switchCurrentUser,
} from "./manage.js";
export type { PinSweep } from "./pins.js";
export { readSidebarPins, sweepSidebarPins } from "./pins.js";
export type { AllUsers, UnreadableUser } from "./profile.js";
export {
  loadAllUsers,
  loadAllUsersDetailed,
  loadUserProfile,
  parseUserProfile,
  saveUserProfile,
  serializeUserProfile,
  userExists,
  UserProfileError,
} from "./profile.js";
export type { RecentEntry } from "./recents.js";
export { pushRecent, readRecents, RECENTS_CAP, removeRecent } from "./recents.js";
export type { UserSettings } from "./settings.js";
export type { KeyboardShortcutsDropReport, SidebarGroupsDropReport } from "./settings.js";
export { loadUserSettings, saveUserSettings } from "./settings.js";
export { collectKeyboardShortcutsDrops, collectSidebarGroupsDrops } from "./settings.js";
export type { KeyboardShortcutsDrop, ResolvedKeyboardShortcuts, ResolvedShortcut, SalvagedKeyboardShortcuts, ShortcutChanges } from "./shortcuts.js";
export { applyShortcutChanges, isShortcutActive, readKeyboardShortcuts, resolveKeyboardShortcuts, salvageKeyboardShortcuts, SHORTCUT_VALID_IDS, singleKeyShortcutsOn, validateShortcutIds, withKeyboardShortcuts } from "./shortcuts.js";
export type { GroupedSidebarRow, ResolvedSidebarItem, SalvagedSidebarGroups, SidebarGroupsDrop } from "./sidebarGroups.js";
export { readSidebarGroups, resolveGroupedSidebarOrder, resolveRenderedSidebarItems, resolveSidebarOrder, salvageSidebarGroups, SIDEBAR_VALID_IDS, validateSidebarIds } from "./sidebarGroups.js";
