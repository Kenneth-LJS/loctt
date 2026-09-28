import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { initLoctt } from "@loctt/core";

import { abandonDoctorGate, beginDoctorGate, finishDoctorGate } from "./doctor-gate.js";

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
  /**
   * K145: doctor findings this test's surface writes are expected to
   * cause (a test of a refusal that deliberately leaves such a state).
   * Each must be justified at the call site. Default: none.
   */
  readonly allowDoctorFindings?: readonly RegExp[];
  /**
   * Turns the doctor gate off for this test. Only for a test whose
   * subject is doctor's own findings over a state the surfaces produce.
   */
  readonly doctorGate?: boolean;
}

/**
 * Run `fn` against a freshly created tmpdir under tests/workspace/.
 *
 * Doctor gate (K145): every CLI run and MCP call the test makes through
 * the shared adapters is watched, and once `fn` returns, `loctt doctor`
 * must report nothing those writes introduced (`doctor-gate.ts`).
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
    // K145: after a test that wrote through the CLI or MCP, `loctt
    // doctor` must report nothing new (see doctor-gate.ts).
    if (opts.doctorGate !== false) beginDoctorGate(root, opts.allowDoctorFindings);
    let result: T;
    try {
      result = await fn({ root });
    } catch (err) {
      abandonDoctorGate(root);
      throw err;
    }
    finishDoctorGate(root);
    return result;
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

/**
 * Removes a task's directory directly, as a hand delete or a `git pull`
 * would, leaving every edge that points at it dangling.
 *
 * `loctt delete` no longer leaves dangling edges (K147: it removes the
 * partners' side of every link), so a test that needs a dangling edge
 * has to make one out of band. Returns the removed task's id.
 */
export async function removeTaskOutOfBand(root: string, key: string): Promise<string> {
  const dir = path.join(root, ".loctt/tasks");
  for (const id of await readdir(dir)) {
    const file = path.join(dir, id, "task.md");
    let raw: string;
    try {
      raw = await readFile(file, "utf-8");
    } catch {
      continue;
    }
    if (raw.includes(`\nkey: ${key}\n`)) {
      await rm(path.join(dir, id), { recursive: true, force: true });
      return id;
    }
  }
  throw new Error(`no task file for ${key}`);
}
