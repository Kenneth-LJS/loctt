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

  const steps = "steps" in c
    ? c.steps.map((s, i) => (i === c.steps.length - 1 && c.post.length > 0 ? { ...s, post: [...s.post, ...c.post] } : s))
    : [{
      name: "action",
      post: c.post,
      ...(c.cli !== undefined ? { cli: c.cli } : {}),
      ...(c.mcp !== undefined ? { mcp: c.mcp } : {}),
      ...(c.capture !== undefined ? { capture: c.capture } : {}),
      ...(c.expect_error !== undefined ? { expect_error: c.expect_error } : {}),
    }];

  for (const [i, s] of steps.entries()) {
    const where = steps.length > 1 ? `step ${i + 1} (${s.name})` : "case";
    if (c.surfaces.includes("cli") && s.cli === undefined) throw new Error(`${rel}: ${where} runs on cli but has no \`cli\``);
    if (c.surfaces.includes("mcp") && s.mcp?.call === undefined) throw new Error(`${rel}: ${where} runs on mcp but has no \`mcp.call\``);
    if (s.expect_error && s.expect_error.cli === undefined && c.surfaces.includes("cli")) {
      throw new Error(`${rel}: ${where} expects an error but gives no \`expect_error.cli\``);
    }
    if (s.expect_error && s.expect_error.mcp === undefined && c.surfaces.includes("mcp")) {
      throw new Error(`${rel}: ${where} expects an error but gives no \`expect_error.mcp\``);
    }
  }

  return {
    id: c.id,
    name: c.name,
    description: c.description,
    tags: c.tags,
    surfaces: c.surfaces,
    setupFiles: c.setup_files ?? {},
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
