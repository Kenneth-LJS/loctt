/**
 * Runs one case on one surface: fresh seed copy → setup → pre → for each
 * step (action → captures → post → bilateral on touched links → doctor)
 * → known-finding bookkeeping → check_script.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { parse as parseYaml } from "yaml";

import type { McpClient } from "../../integration/adapters/mcp-stdio.ts";
import { bilateralViolations, describeCheck, runCheck, touchedLinkTaskIds } from "./checks.ts";
import type { Capture, Case, Check, McpCall, Step, SurfaceName } from "./schema.ts";
import { freshTracker } from "./seed.ts";
import { type Snapshot,snapshot } from "./snapshot.ts";
import { type ActionResult, doctorFindings, runCliCommands, runMcpCalls, withMcp } from "./surfaces.ts";
import { TrackerView } from "./tracker.ts";
import { interpolate, type SeedIndex, splitCommandLine, type VarContext } from "./vars.ts";

export interface Failure {
  readonly caseId: string;
  readonly surface: SurfaceName;
  /** "setup", "pre", a step name, "check_script". */
  readonly step: string;
  /** Which check (or "action", "capture", "doctor", "bilateral"). */
  readonly check: string;
  readonly message: string;
}

export function formatFailure(f: Failure): string {
  return `[${f.caseId}] [${f.surface}] step "${f.step}" › ${f.check}\n    ${f.message.split("\n").join("\n    ")}`;
}

export interface CaseState {
  readonly root: string;
  readonly vars: Record<string, string | Record<string, string>>;
  /** `known_doctor_findings` patterns that matched a finding so far. */
  readonly knownSeen: string[];
}

function ctxOf(seed: SeedIndex, state: CaseState): VarContext {
  return { seed, vars: state.vars, root: state.root };
}

function stepLabel(c: Case, i: number): string {
  const step = c.steps[i] as Step;
  return c.steps.length > 1 ? `${i + 1}. ${step.name}` : step.name;
}

function runChecks(
  checks: readonly Check[],
  c: Case,
  surface: SurfaceName,
  step: string,
  seed: SeedIndex,
  state: CaseState,
  before: Snapshot,
  output: string | undefined,
): Failure[] {
  const tracker = new TrackerView(state.root);
  const failures: Failure[] = [];
  for (const raw of checks) {
    let check: Check;
    try {
      check = interpolate(raw, ctxOf(seed, state));
    } catch (err) {
      failures.push({ caseId: c.id, surface, step, check: describeCheck(raw), message: String(err instanceof Error ? err.message : err) });
      continue;
    }
    let message: string | null;
    try {
      message = runCheck(check, { tracker, before, output, surface });
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    if (message !== null) failures.push({ caseId: c.id, surface, step, check: describeCheck(check), message });
  }
  return failures;
}

/** Fresh seed copy, setup files and patches, and the pre-checks. */
async function prepare(c: Case, seed: SeedIndex, surface: SurfaceName): Promise<{ state: CaseState; failures: Failure[] }> {
  const root = await freshTracker(seed, `${c.id}-${surface}`);
  const state: CaseState = { root, vars: {}, knownSeen: [] };
  for (const [rel, content] of Object.entries(c.setupFiles)) {
    const file = path.join(root, rel);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, interpolate(content, ctxOf(seed, state)), "utf-8");
  }
  for (const patch of c.setupPatch) {
    const p = interpolate(patch, ctxOf(seed, state));
    const file = path.join(root, ".loctt", p.file);
    const text = await readFile(file, "utf-8");
    const count = text.split(p.find).length - 1;
    if (count !== 1) {
      return { state, failures: [{ caseId: c.id, surface, step: "setup", check: "setup_patch", message: `${p.file}: expected the text to occur once, found ${count}: ${JSON.stringify(p.find)}` }] };
    }
    await writeFile(file, text.replace(p.find, p.replace), "utf-8");
  }
  const now = snapshot(path.join(root, ".loctt"));
  return { state, failures: runChecks(c.pre, c, surface, "pre", seed, state, now, undefined) };
}

/** Interpolated argv lists / MCP calls for a step. */
function stepActions(step: Step, seed: SeedIndex, state: CaseState): { cli: string[][]; mcp: McpCall[] } {
  const ctx = ctxOf(seed, state);
  const lines = step.cli === undefined ? [] : Array.isArray(step.cli) ? step.cli : [step.cli];
  const cli = lines.map(l => splitCommandLine(l).map(tok => interpolate(tok, ctx)));
  const calls = step.mcp?.call === undefined ? [] : Array.isArray(step.mcp.call) ? step.mcp.call : [step.mcp.call];
  return { cli, mcp: calls.map(call => interpolate(call, ctx)) };
}

async function runAction(
  step: Step,
  surface: SurfaceName,
  seed: SeedIndex,
  state: CaseState,
  mcp: McpClient | undefined,
): Promise<ActionResult> {
  const actions = stepActions(step, seed, state);
  if (surface === "cli") return runCliCommands(actions.cli, state.root);
  if (!mcp) throw new Error("MCP surface without a client");
  return runMcpCalls(mcp, actions.mcp);
}

function commentIdsIn(text: string | undefined): Set<string> {
  if (text === undefined) return new Set();
  const doc = parseYaml(text) as { comments?: Array<{ id?: unknown }> } | null;
  return new Set((doc?.comments ?? []).map(c => String(c.id)));
}

function applyCapture(name: string, cap: Capture, tracker: TrackerView, before: Snapshot, output: string, state: CaseState, seed: SeedIndex): string | null {
  if ("new_task" in cap) {
    const fresh = tracker.tasks().filter(t => !before.has(t.file.split(path.sep).join("/")));
    const hits = cap.new_task.title === undefined ? fresh : fresh.filter(t => t.frontmatter["title"] === cap.new_task.title);
    if (hits.length !== 1) {
      return `capture ${name}: expected exactly one new task${cap.new_task.title !== undefined ? ` titled "${cap.new_task.title}"` : ""}, found ${hits.length} ${JSON.stringify(hits.map(t => t.key))}`;
    }
    const t = hits[0] as { key: string; id: string };
    state.vars[name] = { key: t.key, id: t.id };
    return null;
  }
  if ("new_comment" in cap) {
    const task = tracker.task(interpolate(cap.new_comment.task, ctxOf(seed, state)));
    const rel = path.join(path.dirname(task.file), "_comments.yaml").split(path.sep).join("/");
    const old = commentIdsIn(before.get(rel));
    const fresh = tracker.comments(task).filter(cm => !old.has(String(cm["id"])));
    if (fresh.length !== 1) return `capture ${name}: expected exactly one new comment on ${task.key}, found ${fresh.length}`;
    state.vars[name] = { id: String(fresh[0]?.["id"]) };
    return null;
  }
  if ("entity" in cap) {
    const { kind, name: entityName } = interpolate(cap.entity, ctxOf(seed, state));
    let list: Array<Record<string, unknown>>;
    if (kind === "user") list = tracker.users();
    else {
      const [file, key] = ({ project: ["config/projects.yaml", "projects"], label: ["config/labels.yaml", "labels"], milestone: ["config/milestones.yaml", "milestones"], sprint: ["config/sprints.yaml", "sprints"], view: ["config/queries.yaml", "queries"] } as const)[kind];
      const doc = tracker.readYaml(file) as Record<string, unknown> | undefined;
      list = Array.isArray(doc?.[key]) ? doc[key] as Array<Record<string, unknown>> : [];
    }
    const hits = list.filter(e => e["name"] === entityName);
    if (hits.length !== 1) return `capture ${name}: expected one ${kind} named "${entityName}", found ${hits.length}`;
    state.vars[name] = { id: String(hits[0]?.["id"]) };
    return null;
  }
  const m = new RegExp(cap.output).exec(output);
  if (!m || m[1] === undefined) return `capture ${name}: /${cap.output}/ did not match the output:\n${output}`;
  state.vars[name] = m[1];
  return null;
}

/**
 * Everything after a step's action: the error expectation, captures,
 * post-checks, the automatic bilateral check on touched links, and
 * doctor against the pristine seed's baseline.
 */
async function verifyStep(
  c: Case,
  stepIndex: number,
  surface: SurfaceName,
  seed: SeedIndex,
  state: CaseState,
  before: Snapshot,
  result: ActionResult,
  baselineDoctor: readonly string[],
): Promise<Failure[]> {
  const step = c.steps[stepIndex] as Step;
  const label = stepLabel(c, stepIndex);
  const fail = (check: string, message: string): Failure => ({ caseId: c.id, surface, step: label, check, message });
  const failures: Failure[] = [];
  const tracker = new TrackerView(state.root);
  const output = result.output;

  if (result.earlyFailure) return [fail("action", result.earlyFailure)];

  if (step.expect_error) {
    if (!result.error) {
      failures.push(fail("expect_error", `expected the action to fail, but it succeeded:\n${result.output}`));
    } else if (surface === "cli") {
      const want = step.expect_error.cli;
      if (want && result.error.exitCode !== want.exit_code) {
        failures.push(fail("expect_error", `expected exit code ${want.exit_code}, got ${String(result.error.exitCode)}: ${result.error.message}`));
      }
      if (want?.message !== undefined && !result.error.message.includes(want.message)) {
        failures.push(fail("expect_error", `expected the error to contain ${JSON.stringify(want.message)}, got: ${result.error.message}`));
      }
    } else {
      const want = step.expect_error.mcp;
      if (want?.message !== undefined && !result.error.message.includes(want.message)) {
        failures.push(fail("expect_error", `expected the error to contain ${JSON.stringify(want.message)}, got: ${result.error.message}`));
      }
    }
    // K144: an error case proves nothing changed.
    failures.push(...runChecks([{ tracker_unchanged: true }], c, surface, label, seed, state, before, output));
  } else if (result.error) {
    failures.push(fail("action", `the action failed${result.error.exitCode !== undefined ? ` (exit ${result.error.exitCode})` : ""}:\n${result.error.message}`));
    return failures;
  }

  for (const [name, cap] of Object.entries(step.capture ?? {})) {
    let msg: string | null;
    try {
      msg = applyCapture(name, cap, tracker, before, output, state, seed);
    } catch (err) {
      msg = err instanceof Error ? err.message : String(err);
    }
    if (msg !== null) {
      failures.push(fail("capture", msg));
      return failures; // later checks would only report the missing var
    }
  }

  failures.push(...runChecks(step.post, c, surface, label, seed, state, before, output));

  for (const id of touchedLinkTaskIds(before, tracker)) {
    const task = tracker.findTask(id);
    if (!task) continue;
    const violations = bilateralViolations(tracker, task);
    if (violations.length > 0) failures.push(fail("bilateral (touched links)", violations.join("\n")));
  }

  let findings: string[];
  try {
    findings = await doctorFindings(state.root);
  } catch (err) {
    failures.push(fail("doctor", err instanceof Error ? err.message : String(err)));
    return failures;
  }
  const fresh = findings.filter(f => !baselineDoctor.includes(f)).filter(f => {
    const known = c.knownDoctorFindings.find(k => new RegExp(k.match).test(f));
    if (!known) return true;
    if (!state.knownSeen.includes(known.match)) state.knownSeen.push(known.match);
    return false;
  });
  if (fresh.length > 0) failures.push(fail("doctor", `new finding(s) not present on the pristine seed:\n${fresh.join("\n")}`));
  return failures;
}

export type CheckScript = (tracker: TrackerView, ctx: { vars: CaseState["vars"]; seed: SeedIndex; root: string }) => void | Promise<void>;

async function finish(c: Case, surface: SurfaceName, seed: SeedIndex, state: CaseState): Promise<Failure[]> {
  const stale = c.knownDoctorFindings.filter(k => !state.knownSeen.includes(k.match));
  if (stale.length > 0) {
    return stale.map(k => ({
      caseId: c.id, surface, step: "known_doctor_findings", check: k.match,
      message: `this known finding (${k.bug}) no longer appears — if the bug is fixed, remove the entry from the case`,
    }));
  }
  if (c.checkScript === undefined) return [];
  try {
    const mod = await import(pathToFileURL(c.checkScript).href) as { default?: CheckScript };
    if (typeof mod.default !== "function") throw new Error(`${c.checkScript} has no default export function`);
    await mod.default(new TrackerView(state.root), { vars: state.vars, seed, root: state.root });
    return [];
  } catch (err) {
    return [{ caseId: c.id, surface, step: "check_script", check: path.basename(c.checkScript), message: err instanceof Error ? err.message : String(err) }];
  }
}

/** The whole case on one scripted surface. */
export async function runCase(
  c: Case,
  surface: SurfaceName,
  seed: SeedIndex,
  baselineDoctor: readonly string[],
): Promise<{ failures: Failure[]; root: string }> {
  const { state, failures } = await prepare(c, seed, surface);
  if (failures.length > 0) return { failures, root: state.root };

  const body = async (mcp: McpClient | undefined): Promise<Failure[]> => {
    for (let i = 0; i < c.steps.length; i++) {
      const before = snapshot(path.join(state.root, ".loctt"));
      let result: ActionResult;
      try {
        result = await runAction(c.steps[i] as Step, surface, seed, state, mcp);
      } catch (err) {
        return [{ caseId: c.id, surface, step: stepLabel(c, i), check: "action", message: err instanceof Error ? err.message : String(err) }];
      }
      const stepFailures = await verifyStep(c, i, surface, seed, state, before, result, baselineDoctor);
      if (stepFailures.length > 0) return stepFailures; // later steps build on this one
    }
    return finish(c, surface, seed, state);
  };

  const out = surface === "mcp" ? await withMcp(state.root, mcp => body(mcp)) : await body(undefined);
  return { failures: out, root: state.root };
}
