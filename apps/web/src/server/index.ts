// @loctt/web — combined HTTP server + API + web UI
// Merged from former apps/service + apps/web. Same-origin, no CORS needed.

export type { AttachResultResponse } from "./client.js";
export { AttachmentExistsError, LocttClient } from "./client.js";
export type { WebAppOptions } from "./server.js";
export { createWebApp } from "./server.js";
