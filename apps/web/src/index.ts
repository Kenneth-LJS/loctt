// @loctt/web — combined HTTP server + API + web UI
// Merged from former apps/service + apps/web. Same-origin, no CORS needed.

export { createWebApp } from "./server.js";
export type { WebAppOptions } from "./server.js";
export { LocttClient } from "./client.js";
