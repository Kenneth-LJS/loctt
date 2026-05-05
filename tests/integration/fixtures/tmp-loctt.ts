import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { initLoctt } from "@loctt/core";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const workspaceRoot = path.join(repoRoot, "tests/workspace");

export interface TmpLocttContext {
  /** Absolute path to the per-test workspace root. */
  readonly root: string;
}

export interface TmpLocttOptions {
  /**
   * If true (default), runs `initLoctt` so the workspace has a usable .loctt/.
   * Set false when the test wants to verify init behavior itself.
   */
  readonly init?: boolean;
}

/**
 * Run `fn` against a freshly created tmpdir under tests/workspace/.
 *
 * Cleanup contract:
 *  - The workspace is removed in a `finally` block, even if `fn` throws.
 *  - Cleanup never throws — failures are swallowed and logged to stderr.
 *  - process.cwd / process.env / process.argv are snapshot before `fn` and
 *    restored after, so a careless test can't leak ambient state.
 */
export async function withTmpLoctt<T>(
  fn: (ctx: TmpLocttContext) => Promise<T>,
  opts: TmpLocttOptions = {},
): Promise<T> {
  const root = await mkdtemp(path.join(workspaceRoot, "loctt-"));

  const cwdBefore = process.cwd();
  const envBefore = { ...process.env };
  const argvBefore = [...process.argv];

  try {
    if (opts.init !== false) {
      await initLoctt(root);
    }
    return await fn({ root });
  } finally {
    process.chdir(cwdBefore);
    // Restore env: remove keys that didn't exist before, reset values that changed.
    for (const key of Object.keys(process.env)) {
      if (!(key in envBefore)) delete process.env[key];
    }
    for (const [key, value] of Object.entries(envBefore)) {
      process.env[key] = value;
    }
    process.argv = argvBefore;

    try {
      await rm(root, { recursive: true, force: true });
    } catch (err) {
      console.error(`[tmp-loctt] cleanup failed for ${root}:`, err);
    }
  }
}

/**
 * Path prefix used for per-test workspaces. Exported for the global sweep.
 */
export const WORKSPACE_PREFIX = path.join(workspaceRoot, "loctt-");
export const WORKSPACE_ROOT = workspaceRoot;
