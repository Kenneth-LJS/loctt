/**
 * Sidebar-groups logic — re-exported from core (SHL-45).
 *
 * Same reasoning as `sidebarPins.ts`: the read/resolve logic lives in
 * core so the web sidebar, the settings panel, the CLI and the MCP tool
 * all order groups the same way. Imported from the module directly, not
 * through `@loctt/core`'s barrel — the barrel pulls in core's filesystem
 * paths module and `node:path` has no browser build. `users/sidebarGroups.js`
 * is pure logic over ids and imports nothing from node.
 */
export type { GroupedSidebarRow, ResolvedSidebarItem } from "@loctt/core/users/sidebarGroups.js";
export {
  readSidebarGroups,
  resolveGroupedSidebarOrder,
  resolveSidebarOrder,
} from "@loctt/core/users/sidebarGroups.js";
