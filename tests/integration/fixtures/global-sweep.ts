import { readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { WORKSPACE_ROOT } from "./tmp-loctt.js";

/**
 * Orphan dirs older than this (by mtime) are reaped from the OS temp dir.
 * Generous on purpose: unit tests across the repo create
 * `mkdtemp(join(tmpdir(), "loctt-…"))` dirs and clean them per-test, so a
 * *concurrent* run's dirs are minutes old at most. Only a genuinely
 * orphaned dir — left by a SIGKILL/OOM/ctrl-C that skipped afterEach —
 * survives past an hour, and that is all this reaps. It never touches a
 * fresh dir another run is still using.
 */
const TMP_ORPHAN_AGE_MS = 60 * 60 * 1000; // 1 hour

async function sweepDir(
  dir: string,
  shouldRemove: (mtimeMs: number, sweepStart: number) => boolean,
  sweepStart: number,
): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  await Promise.all(
    entries
      .filter(name => name.startsWith("loctt-"))
      .map(async name => {
        const full = path.join(dir, name);
        try {
          const info = await stat(full);
          if (!info.isDirectory()) return;
          if (!shouldRemove(info.mtimeMs, sweepStart)) return;
          await rm(full, { recursive: true, force: true });
        } catch (err) {
          console.error(`[global-sweep] failed to remove ${full}:`, err);
        }
      }),
  );
}

/**
 * Removes orphaned `loctt-*` directories. Runs once per `vitest run` from
 * a Vitest globalSetup, before any test executes. Per-test fixtures
 * already clean up in the happy path; this catches dirs a previous run
 * left behind when it was killed (SIGKILL, OOM, ctrl-C).
 *
 * Two roots:
 *  - `tests/workspace/` (the integration/e2e fixture root) — reap
 *    anything created *before this sweep started*, since only this run
 *    writes there.
 *  - the OS temp dir (`$TMPDIR`), where the repo's unit tests create
 *    their own `loctt-*` dirs — reap only dirs older than an hour, so a
 *    concurrent test run's fresh dirs are never disturbed. Previously
 *    unswept, so a killed unit run leaked `loctt-*` into $TMPDIR forever.
 */
export default async function sweepWorkspace(): Promise<void> {
  const sweepStart = Date.now();
  await sweepDir(WORKSPACE_ROOT, (mtime, start) => mtime < start, sweepStart);
  await sweepDir(tmpdir(), mtime => sweepStart - mtime > TMP_ORPHAN_AGE_MS, sweepStart);
}
