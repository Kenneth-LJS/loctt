/**
 * Loads and validates every case file under `tests/runthrough/cases/`.
 *
 * A file that fails validation stops the whole run with the file path
 * and the zod issues — a half-loaded suite would report green on the
 * cases that happened to parse.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { parse as parseYaml } from "yaml";

import { casesRoot } from "./paths.ts";
import { type Case, CaseSchema, CheckSchema } from "./schema.ts";

function yamlFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...yamlFiles(full));
    else if (name.endsWith(".yaml") || name.endsWith(".yml")) out.push(full);
  }
  return out;
}

function at(root: unknown, path: ReadonlyArray<PropertyKey>): unknown {
  let cur = root;
  for (const p of path) cur = cur !== null && typeof cur === "object" ? (cur as Record<PropertyKey, unknown>)[p] : undefined;
  return cur;
}

/**
 * Readable issues for an invalid case. A zod union failure says only
 * "Invalid input", so each union is re-checked against the member the
 * file evidently meant: the single-step or `steps:` case shape, and for
 * a check, the member named by its one key.
 */
function explain(raw: unknown): string[] {
  const member = raw !== null && typeof raw === "object" && "steps" in raw ? CaseSchema.options[1] : CaseSchema.options[0];
  const res = member.safeParse(raw);
  if (res.success) return ["(root): does not match the case schema"];
  const out: string[] = [];
  for (const issue of res.error.issues) {
    const where = issue.path.map(String).join(".") || "(root)";
    const value = at(raw, issue.path);
    if (issue.code === "invalid_union" && value !== null && typeof value === "object" && !Array.isArray(value)) {
      const keys = Object.keys(value);
      const kind = keys[0];
      const opt = CheckSchema.options.find(o => kind !== undefined && kind in o.shape);
      if (keys.length !== 1 || !opt) {
        out.push(`${where}: a check is an object with exactly one key naming its kind; got ${JSON.stringify(keys)}`);
        continue;
      }
      const sub = opt.safeParse(value);
      if (!sub.success) {
        for (const s of sub.error.issues) out.push(`${[where, ...s.path.map(String)].join(".")}: ${s.message}`);
        continue;
      }
    }
    out.push(`${where}: ${issue.message}`);
  }
  return out;
}

export function loadCase(file: string): Case {
  const rel = path.relative(casesRoot, file);
  let raw: unknown;
  try {
    raw = parseYaml(readFileSync(file, "utf-8"));
  } catch (err) {
    throw new Error(`${rel}: not valid YAML: ${err instanceof Error ? err.message : String(err)}`);
  }
  const parsed = CaseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`${rel}: invalid case file\n${explain(raw).map(l => `  ${l}`).join("\n")}`);
  }
  const c = parsed.data;
  const base = path.basename(file).replace(/\.ya?ml$/, "");
  if (c.id !== base) throw new Error(`${rel}: id "${c.id}" must match the file name "${base}"`);

  const rawSteps = "steps" in c
    ? c.steps.map((s, i) => (i === c.steps.length - 1 && c.post.length > 0 ? { ...s, post: [...s.post, ...c.post] } : s))
    : [{
      name: "action",
      post: c.post,
      ...(c.cli !== undefined ? { cli: c.cli } : {}),
      ...(c.mcp !== undefined ? { mcp: c.mcp } : {}),
      ...(c.via !== undefined ? { via: c.via } : {}),
      ...(c.script !== undefined ? { script: c.script } : {}),
      ...(c.capture !== undefined ? { capture: c.capture } : {}),
      ...(c.expect_error !== undefined ? { expect_error: c.expect_error } : {}),
    }];
  // A step's `script` is relative to the case file.
  const steps = rawSteps.map(s => (s.script !== undefined ? { ...s, script: path.resolve(path.dirname(file), s.script) } : s));

  for (const [i, s] of steps.entries()) {
    const where = steps.length > 1 ? `step ${i + 1} (${s.name})` : "case";
    // The surfaces this step actually runs on: its own `via`, else the case's.
    const on = s.via !== undefined ? [s.via] : c.surfaces;
    if (s.script !== undefined) {
      if (s.cli !== undefined || s.mcp !== undefined) throw new Error(`${rel}: ${where} has a \`script\` and a \`cli\`/\`mcp\` action; give one`);
      continue;
    }
    if (on.includes("cli") && s.cli === undefined) throw new Error(`${rel}: ${where} runs on cli but has no \`cli\``);
    if (on.includes("mcp") && s.mcp?.call === undefined) throw new Error(`${rel}: ${where} runs on mcp but has no \`mcp.call\``);
    if (s.expect_error && s.expect_error.cli === undefined && on.includes("cli")) {
      throw new Error(`${rel}: ${where} expects an error but gives no \`expect_error.cli\``);
    }
    if (s.expect_error && s.expect_error.mcp === undefined && on.includes("mcp")) {
      throw new Error(`${rel}: ${where} expects an error but gives no \`expect_error.mcp\``);
    }
    // A partial result skips the automatic "tracker unchanged"; something
    // must still say what else stayed put (A366).
    if (s.expect_error?.cli?.partial === true && !(s.post ?? []).some(ch => "changed_only" in ch)) {
      throw new Error(`${rel}: ${where} is \`partial\` but has no \`changed_only\` post check`);
    }
  }

  return {
    id: c.id,
    name: c.name,
    description: c.description,
    tags: c.tags,
    surfaces: c.surfaces,
    setupFiles: c.setup_files ?? {},
    seed: c.seed,
    ...(c.git !== undefined ? { git: c.git } : {}),
    setupPatch: c.setup_patch ?? [],
    knownDoctorFindings: c.known_doctor_findings ?? [],
    pre: c.pre,
    steps,
    ...(c.check_script !== undefined ? { checkScript: path.resolve(path.dirname(file), c.check_script) } : {}),
    knownBug: c.known_bug ?? {},
    scenario: "steps" in c,
    file,
  };
}

export function loadAllCases(): Case[] {
  const cases = yamlFiles(casesRoot).map(loadCase);
  const seen = new Map<string, string>();
  for (const c of cases) {
    const prev = seen.get(c.id);
    if (prev) throw new Error(`duplicate case id "${c.id}": ${prev} and ${c.file}`);
    seen.set(c.id, c.file);
  }
  return cases;
}
