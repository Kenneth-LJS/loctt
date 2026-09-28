/**
 * The seed tracker: loading its index, copying it into a fresh temp
 * directory per test, and the format-version guard.
 */

import { existsSync, readFileSync } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { cliEntry, seedIndexPath, seedLoctt, TEMP_PREFIX, workspaceRoot } from "./paths.ts";
import { runCliArgv } from "./surfaces.ts";
import type { SeedIndex } from "./vars.ts";

export function loadSeedIndex(): SeedIndex {
  if (!existsSync(seedIndexPath)) {
    throw new Error(`No seed index at ${seedIndexPath}. Generate the seed: npm run seed:build`);
  }
  return JSON.parse(readFileSync(seedIndexPath, "utf-8")) as SeedIndex;
}

/**
 * Copies the seed into a fresh temp root and restores the per-checkout
 * pointer the seed cannot carry: `.loctt/.gitignore` ignores
 * `.current-user`, so a checkout of the seed has no current user and
 * every comment would fail. The index records who it should be.
 */
export async function freshTracker(seed: SeedIndex, label: string): Promise<string> {
  await mkdir(workspaceRoot, { recursive: true });
  const safe = label.replace(/[^a-z0-9-]+/gi, "-").slice(0, 60);
  const root = await mkdtemp(path.join(workspaceRoot, `${TEMP_PREFIX}${safe}-`));
  await cp(seedLoctt, path.join(root, ".loctt"), { recursive: true });
  await writeFile(path.join(root, ".loctt/.current-user"), `${seed.current_user}\n`, "utf-8");
  return root;
}

export async function removeTracker(root: string): Promise<void> {
  await rm(root, { recursive: true, force: true });
}

/** Removes temp trackers older than `olderThanMs` left by earlier runs. */
export async function sweepTemp(olderThanMs = 60 * 60 * 1000): Promise<void> {
  if (!existsSync(workspaceRoot)) return;
  const now = Date.now();
  for (const name of await readdir(workspaceRoot)) {
    if (!name.startsWith(TEMP_PREFIX)) continue;
    const full = path.join(workspaceRoot, name);
    try {
      if (now - (await stat(full)).mtimeMs > olderThanMs) await rm(full, { recursive: true, force: true });
    } catch {
      // raced with another sweeper; nothing to do
    }
  }
}

/**
 * The format version this build writes, read from a tracker it just
 * initialised — so the guard compares like with like whether the
 * version is today's integer or K142's semver, and needs no core import.
 */
async function codeFormatVersion(): Promise<string> {
  await mkdir(workspaceRoot, { recursive: true });
  const root = await mkdtemp(path.join(workspaceRoot, `${TEMP_PREFIX}version-`));
  try {
    const res = await runCliArgv(["init", "--no-docs", "--quiet", "--timezone", "UTC"], root);
    if (res.exitCode !== 0) throw new Error(`loctt init failed (${cliEntry}): ${res.stderr || res.stdout}`);
    return (await readFile(path.join(root, ".loctt/.schema-version"), "utf-8")).trim();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/**
 * K144: the seed must match the code's format version. Returns an
 * error message (pointing at `npm run seed:upgrade`) or `null`.
 */
export async function checkSeedVersion(): Promise<string | null> {
  if (!existsSync(cliEntry)) return `The CLI is not built (${cliEntry}). Run: npm run build`;
  const seedVersion = (await readFile(path.join(seedLoctt, ".schema-version"), "utf-8")).trim();
  const codeVersion = await codeFormatVersion();
  if (seedVersion === codeVersion) return null;
  return `The seed tracker is at format version ${seedVersion}, but this build writes ${codeVersion}.\n`
    + `Upgrade the seed with the tracker's own upgrade path, then check the result in:\n\n`
    + `    npm run seed:upgrade\n`;
}
