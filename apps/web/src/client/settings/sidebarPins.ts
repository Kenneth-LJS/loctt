/**
 * Sidebar pin logic — re-exported from core.
 *
 * The sweep lives in core because two surfaces ask the same question:
 * the web pins panel and `loctt user settings --sweep-pins` /
 * MCP's `sweep_sidebar_pins`. See `packages/core/src/users/pins.ts`.
 *
 * Imported from the module directly, **not** through `@loctt/core`'s
 * barrel: the barrel pulls in core's filesystem paths module, and
 * `node:path` has no browser build. `users/pins.js` is pure logic over
 * ids and imports nothing from node.
 */
export type { PinSweep } from "@loctt/core/users/pins.js";
export { readSidebarPins, sweepSidebarPins } from "@loctt/core/users/pins.js";
