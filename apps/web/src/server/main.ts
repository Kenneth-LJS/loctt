// The dev server's entrypoint (`npm run dev` runs it via tsx): starts the
// LocTT web UI server on loopback, serves the built client, and opens the
// browser. Users start the same server with `loctt ui`; `@loctt/web` is an
// internal workspace and ships no command of its own (K139).
//
// When no `--client-dir` is given, `../client` relative to this file is
// used if it exists. `--client-dir`/`LOCTT_CLIENT_DIR` overrides it.

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

// `--root` is the canonical tracker-root flag (matching the CLI and the
// `LOCTT_ROOT` env var); `--cwd` is accepted as a back-compat alias so the
// vocabulary is the same across CLI/ui/mcp/web. Explicit flag > env > cwd.
const root = getArg("--root") ?? getArg("--cwd") ?? process.env.LOCTT_ROOT ?? process.cwd();
const port = Number(getArg("--port") ?? process.env.LOCTT_API_PORT ?? "7700");
const noOpen = args.includes("--no-open");

// Explicit --client-dir/env wins (the dev server passes Vite's output);
// otherwise fall back to `../client` beside this file, if present.
const explicitClientDir = getArg("--client-dir") ?? process.env.LOCTT_CLIENT_DIR;
let clientDir: string | undefined;
if (explicitClientDir) {
  clientDir = resolve(explicitClientDir);
  if (!existsSync(clientDir)) {
    console.error(`client directory does not exist: ${clientDir}`);
    process.exit(1);
  }
} else {
  const bundled = resolve(dirname(fileURLToPath(import.meta.url)), "../client");
  clientDir = existsSync(bundled) ? bundled : undefined;
}

const app = createWebApp({
  root,
  port,
  ...(clientDir !== undefined ? { clientDir } : {}),
});

await app.start();

const addr = app.server.address();
const actualPort = typeof addr === "object" && addr ? addr.port : port;
const url = `http://localhost:${actualPort}`;
console.log(`LocTT UI running at ${url}`);
console.log(`  root:       ${root}`);
if (clientDir) console.log(`  client dir: ${clientDir}`);
console.log(`Press Ctrl-C to stop.`);

// Auto-open the browser (nice-to-have; the URL is already printed). Off
// with --no-open, or when serving no client (API-only). Failures are
// silent unless LOCTT_DEBUG=1.
if (!noOpen && clientDir !== undefined) {
  const opener =
    process.platform === "darwin" ? "open" :
    process.platform === "win32" ? "start" :
    "xdg-open";
  const { spawn } = await import("node:child_process");
  try {
    spawn(opener, [url], { detached: true, stdio: "ignore", shell: process.platform === "win32" }).unref();
  } catch (err) {
    if (process.env["LOCTT_DEBUG"] === "1") console.error(`[loctt dev] failed to auto-open browser:`, err);
  }
}

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
