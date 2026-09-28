/**
 * The doctor gate (K145, B43): after a test that wrote to its tracker
 * through `loctt` or `loctt mcp`, `loctt doctor` must report nothing the
 * tracker did not already have when those writes began.
 *
 * ## How it attaches (no test is rewritten)
 *
 * `withTmpLoctt` registers each test's root and calls `finishDoctorGate`
 * when the test body returns. The two shared adapters report every
 * surface action to the gate: `runCli` (by its `cwd`, or a `--root`
 * argument, or `LOCTT_ROOT`) and each MCP `callTool` (by the client's
 * root). A root nobody registered is ignored, so the runthrough harness,
 * which reuses the MCP adapter, is untouched.
 *
 * ## "Writing" and "the starting tracker"
 *
 * The tracker is snapshotted (every file under `.loctt/`; `local/`, the
 * rebuildable cache, never counts as a write) before and after
 * each surface action. A test's surface actions are split into
 * *segments* at every out-of-band change — a file the test itself wrote,
 * or a task directory it removed, between two actions. Tests do that on
 * purpose to set up corrupt or dangling data, and doctor is right to
 * report it; that state is the segment's starting tracker, not a finding
 * the surface caused.
 *
 * For each segment in which a surface action changed a file, doctor's
 * findings at the segment's end must all have been present at its start.
 * Doctor runs on the live tracker for the last segment and on a restored
 * copy of the snapshot otherwise; the start is only examined (on a
 * restored copy) when the end has findings at all, so a clean write costs
 * one doctor run. Absolute paths are normalised so a copy compares
 * equal.
 *
 * `loctt doctor` itself is spawned directly, never through `runCli`, so
 * the gate does not observe its own runs.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const cliEntry = path.join(repoRoot, "apps/cli/dist/index.js");

type Snapshot = ReadonlyMap<string, string>;

interface Segment {
  readonly start: Snapshot;
  end: Snapshot;
  wrote: boolean;
}

interface GateState {
  readonly segments: Segment[];
  /** The tracker as the last surface action left it. */
  last: Snapshot | undefined;
  inFlight: number;
  /** Allowed finding patterns (`allowDoctorFindings`). */
  readonly allowed: RegExp[];
}

const gates = new Map<string, GateState>();

/** Starts watching a test's tracker root. */
export function beginDoctorGate(root: string, allowed: readonly RegExp[] = []): void {
  gates.set(path.resolve(root), { segments: [], last: undefined, inFlight: 0, allowed: [...allowed] });
}

/** Stops watching without checking (the test already failed). */
export function abandonDoctorGate(root: string): void {
  gates.delete(path.resolve(root));
}

/** The registered root a CLI invocation acts on, if any. */
export function gateRootForCli(args: readonly string[], cwd: string, env: Record<string, string | undefined>): string | undefined {
  const explicit = flagValue(args, "--root") ?? flagValue(args, "--cwd") ?? env["LOCTT_ROOT"];
  const target = path.resolve(cwd, explicit ?? ".");
  for (const root of gates.keys()) {
    if (target === root || target.startsWith(root + path.sep)) return root;
  }
  return undefined;
}

function flagValue(args: readonly string[], flag: string): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string;
    if (a === "--") return undefined;
    if (a === flag) return args[i + 1];
    if (a.startsWith(`${flag}=`)) return a.slice(flag.length + 1);
  }
  return undefined;
}

/** Wraps one surface action on `root` (a CLI run, an MCP call). */
export async function gated<T>(root: string | undefined, action: () => Promise<T>): Promise<T> {
  const state = root === undefined ? undefined : gates.get(root);
  if (state === undefined || root === undefined) return action();
  const before = snapshot(root);
  if (state.inFlight === 0) {
    const current = state.segments.at(-1);
    // First action, or the test changed the tracker itself since the
    // last one: that state starts a new segment.
    if (current === undefined || state.last === undefined || !sameSnapshot(before, state.last)) {
      state.segments.push({ start: before, end: before, wrote: false });
    }
  }
  state.inFlight += 1;
  try {
    return await action();
  } finally {
    state.inFlight -= 1;
    const after = snapshot(root);
    const segment = state.segments.at(-1);
    if (segment !== undefined) {
      if (!sameSnapshot(before, after)) segment.wrote = true;
      segment.end = after;
    }
    state.last = after;
  }
}

/**
 * Checks every segment that wrote; throws naming each new finding.
 * Called by `withTmpLoctt` after a test body returned normally.
 */
export function finishDoctorGate(root: string): void {
  const key = path.resolve(root);
  const state = gates.get(key);
  gates.delete(key);
  if (state === undefined) return;
  const problems: string[] = [];
  state.segments.forEach((segment, i) => {
    if (!segment.wrote) return;
    const isLast = i === state.segments.length - 1;
    const endFindings = isLast && state.last !== undefined && sameSnapshot(segment.end, snapshot(key))
      ? doctorFindings(key)
      : doctorOnCopy(segment.end);
    if (endFindings.length === 0) return;
    const startFindings = new Set(doctorOnCopy(segment.start));
    const fresh = endFindings
      .filter(f => !startFindings.has(f))
      .filter(f => !state.allowed.some(re => re.test(f)));
    if (fresh.length > 0) {
      problems.push(`after surface write #${String(i + 1)}: ${fresh.join("; ")}`);
    }
  });
  if (problems.length > 0) {
    throw new Error(
      "doctor gate (K145): loctt doctor reports finding(s) the tracker did not have before the test's "
      + `writes:\n  ${problems.join("\n  ")}\n(root: ${key})`,
    );
  }
}

/** `loctt doctor`'s non-✓ lines, with the root replaced by `<root>`. */
function doctorFindings(root: string): string[] {
  let out: string;
  try {
    out = execFileSync(process.execPath, [cliEntry, "doctor"], {
      cwd: root,
      encoding: "utf-8",
      env: doctorEnv(),
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
    });
  } catch (err) {
    // doctor exits non-zero when it has errors; its report is still stdout.
    const stdout = (err as { stdout?: unknown }).stdout;
    out = typeof stdout === "string" ? stdout : "";
  }
  const real = realpathOrSelf(root);
  return out.split("\n").map(l => l.trim())
    .filter(l => l.startsWith("!") || l.startsWith("✗"))
    .map(l => l.split(root).join("<root>").split(real).join("<root>"));
}

function doctorEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && k !== "LOCTT_ROOT" && k !== "LOCTT_DEBUG") env[k] = v;
  }
  env["NO_COLOR"] = "1";
  return env;
}

let freshCache: string[] | undefined;

/**
 * Doctor's findings on a tracker `loctt init` just made: the starting
 * point of a segment that began with no tracker at all (a test that runs
 * `init` itself).
 */
function freshTrackerFindings(): string[] {
  if (freshCache !== undefined) return freshCache;
  const tmp = mkdtempSync(path.join(repoRoot, "tests/workspace/doctor-gate-"));
  try {
    execFileSync(process.execPath, [cliEntry, "init", "--no-docs", "--quiet", "--timezone", "UTC"], {
      cwd: tmp, env: doctorEnv(), stdio: "ignore", timeout: 30_000,
    });
    freshCache = doctorFindings(tmp);
    return freshCache;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function doctorOnCopy(snap: Snapshot): string[] {
  if (snap.size === 0) return freshTrackerFindings();
  const tmp = mkdtempSync(path.join(repoRoot, "tests/workspace/doctor-gate-"));
  try {
    for (const [rel, content] of snap) {
      const file = path.join(tmp, ".loctt", rel);
      if (rel.endsWith("/")) {
        mkdirSync(file, { recursive: true });
        continue;
      }
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, content, "latin1");
    }
    return doctorFindings(tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function realpathOrSelf(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/**
 * Every file under `.loctt/`, as raw bytes (latin1 round-trips any
 * byte). `local/` (the key index, the op journal) is captured so a
 * restored copy reports the same key-index state, but is ignored when
 * deciding whether anything was written: a read may rebuild it.
 */
function snapshot(root: string): Snapshot {
  const dir = path.join(root, ".loctt");
  const out = new Map<string, string>();
  if (!existsSync(dir)) return out;
  const walk = (rel: string): void => {
    for (const name of readdirSync(path.join(dir, rel)).sort()) {
      const childRel = rel === "" ? name : path.join(rel, name);
      const full = path.join(dir, childRel);
      if (statSync(full).isDirectory()) {
        // Directories are entries too (`tasks/` starts empty, and a copy
        // without it is a different tracker to doctor).
        out.set(`${childRel}/`, "");
        walk(childRel);
      } else {
        out.set(childRel, readFileSync(full, "latin1"));
      }
    }
  };
  walk("");
  return out;
}

const CACHE = /^local([\\/]|$)/;

/** Equal except for `local/`. */
function sameSnapshot(a: Snapshot, b: Snapshot): boolean {
  const keys = new Set([...a.keys(), ...b.keys()]);
  for (const k of keys) {
    if (CACHE.test(k)) continue;
    if (a.get(k) !== b.get(k)) return false;
  }
  return true;
}
