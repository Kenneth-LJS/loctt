import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";

import { WORKSPACE_ROOT } from "./tmp-loctt.js";

/**
 * Removes any `loctt-*` directory under tests/workspace/ that was created
 * before this sweep started. Called from a Vitest globalSetup so it runs
 * once per `vitest run`, before any test executes.
 *
 * Belt-and-braces: per-test fixtures already clean up. This catches the
 * case where a previous run was killed (SIGKILL, OOM, ctrl-C) and left
 * orphan dirs.
 */
export default async function sweepWorkspace(): Promise<void> {
  const sweepStart = Date.now();
  let entries: string[];
  try {
    entries = await readdir(WORKSPACE_ROOT);
  } catch {
    return;
  }

  await Promise.all(
    entries
      .filter(name => name.startsWith("loctt-"))
      .map(async name => {
        const full = path.join(WORKSPACE_ROOT, name);
        try {
          const info = await stat(full);
          if (info.mtimeMs >= sweepStart) return;
          await rm(full, { recursive: true, force: true });
        } catch (err) {
          console.error(`[global-sweep] failed to remove ${full}:`, err);
        }
      }),
  );
}
