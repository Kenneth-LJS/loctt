// CLI entrypoint for the LocTT web server. `npm run dev` and the
// future `loctt serve` command launch it with the cwd as the tracker
// root, on port LOCTT_API_PORT (default 7700).
//
// In production the same process serves the built client from
// dist/client/ when --client-dir is passed.

import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { createWebApp } from "./server.js";

const args = process.argv.slice(2);

function getArg(name: string): string | undefined {
  const eq = args.find(a => a.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const idx = args.indexOf(name);
  if (idx === -1) return undefined;
  const next = args[idx + 1];
  // Reject when the next token looks like another flag — `--port
  // --client-dir foo` should leave --port unset, not absorb the next
  // flag's name as its value.
  if (next === undefined || next.startsWith("--")) return undefined;
  return next;
}

const root = getArg("--root") ?? process.env.LOCTT_ROOT ?? process.cwd();
const port = Number(getArg("--port") ?? process.env.LOCTT_API_PORT ?? "7700");
const clientDirArg = getArg("--client-dir") ?? process.env.LOCTT_CLIENT_DIR;
const clientDir = clientDirArg ? resolve(clientDirArg) : undefined;

if (clientDir && !existsSync(clientDir)) {
  console.error(`client directory does not exist: ${clientDir}`);
  process.exit(1);
}

const app = createWebApp({
  root,
  port,
  ...(clientDir !== undefined ? { clientDir } : {}),
});

await app.start();

const addr = app.server.address();
const actualPort = typeof addr === "object" && addr ? addr.port : port;
console.log(`LocTT API listening on http://127.0.0.1:${actualPort}`);
console.log(`  root:       ${root}`);
if (clientDir) console.log(`  client dir: ${clientDir}`);

let shuttingDown = false;
const shutdown = async (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\nreceived ${signal}, shutting down…`);
  await app.stop();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
