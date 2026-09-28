/**
 * Whole-tracker snapshots for the "nothing changed" checks.
 *
 * `local/` is left out: it holds per-checkout caches (the key index,
 * the op journal) that a read is allowed to rebuild, and the seed does
 * not carry it at all (the repo's `.gitignore` ignores `.loctt/local/`).
 * Everything else under `.loctt/` — tasks, history, comments,
 * attachments, config, state, users — is compared byte for byte.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { listFiles } from "./tracker.ts";

export type Snapshot = ReadonlyMap<string, string>;

const EXCLUDED = /^local(\/|$)/;

export function snapshot(locttDir: string): Snapshot {
  const out = new Map<string, string>();
  for (const rel of listFiles(locttDir)) {
    const posix = rel.split(path.sep).join("/");
    if (EXCLUDED.test(posix)) continue;
    out.set(posix, readFileSync(path.join(locttDir, rel)).toString("utf-8"));
  }
  return out;
}

/**
 * A readable account of what differs: added and removed files by name,
 * and a line diff for each changed file. Empty string when equal.
 */
export function diffSnapshots(before: Snapshot, after: Snapshot, only?: string): string {
  const lines: string[] = [];
  const names = new Set([...before.keys(), ...after.keys()]);
  for (const name of [...names].sort()) {
    if (only !== undefined && name !== only) continue;
    const a = before.get(name);
    const b = after.get(name);
    if (a === b) continue;
    if (a === undefined) { lines.push(`+ added   ${name}`); continue; }
    if (b === undefined) { lines.push(`- removed ${name}`); continue; }
    lines.push(`~ changed ${name}`);
    lines.push(...lineDiff(a, b).map(l => `    ${l}`));
  }
  return lines.join("\n");
}

/** A minimal LCS line diff (files here are small). */
export function lineDiff(a: string, b: string): string[] {
  const x = a.split("\n");
  const y = b.split("\n");
  const n = x.length;
  const m = y.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const row = lcs[i] as number[];
      row[j] = x[i] === y[j] ? (lcs[i + 1]?.[j + 1] ?? 0) + 1 : Math.max(lcs[i + 1]?.[j] ?? 0, row[j + 1] ?? 0);
    }
  }
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) { i++; j++; continue; }
    if ((lcs[i + 1]?.[j] ?? 0) >= (lcs[i]?.[j + 1] ?? 0)) out.push(`- ${x[i++] ?? ""}`);
    else out.push(`+ ${y[j++] ?? ""}`);
  }
  while (i < n) out.push(`- ${x[i++] ?? ""}`);
  while (j < m) out.push(`+ ${y[j++] ?? ""}`);
  return out;
}
