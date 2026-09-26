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
 *  - `doctor` explains a tracker that is failing, so the failure must
 *    not block it. invariants.md: throwing "takes away the tools to
 *    diagnose the tracker — including `doctor`, whose job is to explain
 *    the very state that is failing". The CLI's own prefix-rename
 *    warning says "Run `loctt doctor` for detail", which could not work
 *    while the guard refused it. Doctor reports the schema mismatch as
 *    a failing check instead.
 *
 * `undefined` is in the set so `loctt` with no command prints help
 * instead of failing the schema check first.
 */
export const SCHEMA_GUARD_EXEMPT_COMMANDS: ReadonlySet<string | undefined> = new Set([
  "init",
  "migrate",
  "doctor",
  // Same reason as doctor: `info` describes the tracker, and a schema
  // mismatch is one of the things worth describing. Refusing to run
  // meant the command that answers "what is this tracker" could not
  // answer it precisely when the answer mattered (ONB-C5).
  "info",
  "mcp",
  "ui",
  "help",
  "--version",
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
 * Locate the built client SPA directory `loctt ui` serves:
 *   1. LOCTT_CLIENT_DIR env override
 *   2. <cli-bundle>/client, the copy of the web client the CLI build
 *      puts beside its bundle (tsup.config.ts `onSuccess`, A352)
 * Returns undefined when neither exists; `loctt ui` then refuses to
 * start rather than serving an API with a 404 at `/`.
 *
 * There used to be a third candidate, `<cli-bundle>/../../web/dist/client`,
 * meant for the monorepo. It was the reason the defect RR-B4 describes
 * went unnoticed: nothing copied the client into the published package,
 * and inside the repo (or in a global install that also happened to
 * have `@loctt/web` beside it) this fallback found one anyway. The build
 * now always ships the copy, so the fallback could only ever hide its
 * absence.
 */
export async function resolveClientDir(): Promise<string | undefined> {
  const envDir = process.env.LOCTT_CLIENT_DIR;
  if (envDir && (await dirExists(envDir))) return envDir;

  const bundled = resolvePath(dirname(fileURLToPath(import.meta.url)), "client");
  return (await dirExists(bundled)) ? bundled : undefined;
}
