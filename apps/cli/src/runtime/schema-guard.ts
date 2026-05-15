/**
 * Boot-time schema-version guard for the CLI.
 *
 * Most commands fail-fast if the tracker's `.schema-version` is
 * out of date (run `loctt migrate` to fix). A small set of
 * commands are exempt because they either don't touch the tracker
 * or are the path that fixes the stale schema.
 *
 * Also lives here: filesystem-existence helpers used by the
 * `loctt ui` command's client-SPA discovery and the dispatcher's
 * skip-guard-on-init logic.
 */

import { stat as fsStat } from "node:fs/promises";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Commands exempt from the schema-version boot guard.
 *  - `init` runs before any tracker exists.
 *  - `migrate` is the path that fixes a stale schema.
 *  - help/usage commands don't touch the tracker.
 *  - `mcp` and `ui` are long-lived servers that run their own
 *    per-request boot guard.
 *
 * `undefined` is in the set so `loctt` with no command prints help
 * instead of failing the schema check first.
 */
export const SCHEMA_GUARD_EXEMPT_COMMANDS: ReadonlySet<string | undefined> = new Set([
  "init",
  "migrate",
  "mcp",
  "ui",
  "help",
  "--help",
  "-h",
  undefined,
]);

/** Returns true when `p` exists and is a directory. */
export async function dirExists(p: string): Promise<boolean> {
  try {
    const s = await fsStat(p);
    return s.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Locate the built client SPA directory. Tries (in order):
 *   1. LOCTT_CLIENT_DIR env override
 *   2. <cli-bundle>/client            (production: shipped alongside CLI bundle)
 *   3. <cli-bundle>/../../web/dist/client  (workspace dev: apps/web/dist/client)
 * Returns undefined if no client build is available — server still works as API-only.
 */
export async function resolveClientDir(): Promise<string | undefined> {
  const envDir = process.env.LOCTT_CLIENT_DIR;
  if (envDir && (await dirExists(envDir))) return envDir;

  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolvePath(here, "client"),
    resolvePath(here, "../../web/dist/client"),
  ];
  for (const c of candidates) {
    if (await dirExists(c)) return c;
  }
  return undefined;
}
