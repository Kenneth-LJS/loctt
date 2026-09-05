import { join } from "node:path";

import type { SprintDef, SprintsConfig } from "@loctt/contracts";
import { SprintDefSchema } from "@loctt/contracts";
import { stringify as stringifyYaml } from "yaml";
import { z } from "zod";

import { LocttError } from "../errors.js";
import { getConfigDir } from "../paths/index.js";
import { writeYamlAtomically } from "../utils/atomic-yaml.js";
import { fileExists } from "../utils/fs.js";
import { readFileState, UnreadableFileError } from "../utils/read-state.js";
import { collectValidEntries } from "./health.js";
import { coerceYaml, safeParseYaml } from "./yaml-coerce.js";
import { formatZodIssues } from "./zod-error.js";

/**
 * The outer shape only: `sprints` is an array. Each entry is left as
 * `unknown` here so a single wrong-typed field degrades to a `BrokenEntry`
 * (via `collectValidEntries`) instead of the strict per-entry schema
 * throwing and blanking every sprint beside it. A file that is not even a
 * list — `sprints` missing or not an array — is object-fatal and still
 * throws, because there is no coherent collection to degrade around.
 */
const RawSprintsConfigSchema = z.object({
  sprints: z.array(z.unknown()),
}).strict();

export class SprintsConfigError extends LocttError {
  constructor(message: string) {
    // `config_invalid`, not the `unknown` an un-attributed Error
    // falls back to. The message already names the file, the field
    // path and what was expected (ERR-10); what was missing was a
    // code, so every surface reported a schema problem as an
    // unexplained server failure. V1: core states its own cause.
    super("config_invalid", message, {
      dataState: "not_saved",
      recovery: { kind: "command" },
    });
    this.name = "SprintsConfigError";
  }
}

const SPRINTS_FILE = "sprints.yaml";

export function getSprintsConfigPath(locttDir: string): string {
  return join(getConfigDir(locttDir), SPRINTS_FILE);
}

export function parseSprintsConfig(yamlContent: string): SprintsConfig {
  const raw = coerceYaml(safeParseYaml(yamlContent, "sprints.yaml"));

  // Object-fatal first: the file must be `{ sprints: [...] }`. A missing
  // or non-array `sprints`, or an unknown top-level key, still throws —
  // there is no coherent collection to degrade around. `coerceYaml` has
  // already normalized YAML Date values to YYYY-MM-DD strings inside each
  // entry, so the valid ones parse exactly as they did before.
  let outer: z.infer<typeof RawSprintsConfigSchema>;
  try {
    outer = RawSprintsConfigSchema.parse(raw);
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new SprintsConfigError(`sprints.yaml is not valid: ${formatZodIssues("sprints config", err)}`);
    }
    throw err;
  }

  // Per north-star principle 5: one sprint whose fields no longer validate
  // (a hand edit, most often — a bad date, an unknown state, an extra key,
  // end_date before start_date) must not blank the whole sprints surface.
  // Good entries become `SprintDef`s; a bad one becomes a `BrokenEntry`
  // carrying its index, raw text and the validator's message, so a surface
  // can list it as broken rather than 500-ing the healthy sprints beside
  // it. `SprintDefSchema`'s per-entry superRefine (end_date >= start_date)
  // runs inside `safeParse`, so it degrades too.
  const { valid, broken } = collectValidEntries<SprintDef>(
    outer.sprints,
    SprintDefSchema,
    "sprint",
  );

  // Duplicate ids are object-fatal: two sprints sharing an id makes any
  // "assign to sprint <id>" reference ambiguous, so we cannot silently
  // pick one. Checked only across the entries that actually parsed — a
  // broken entry has no trustworthy id to collide on.
  const seen = new Set<string>();
  for (const s of valid) {
    if (seen.has(s.id)) {
      throw new SprintsConfigError(`sprints.yaml is not valid: duplicate sprint id: ${s.id}`);
    }
    seen.add(s.id);
  }

  return {
    sprints: valid,
    // Omitted, not `[]`, when everything parsed — so a consumer reading
    // only `sprints` is unaffected and "none broken" stays distinct from
    // "not inspected". Never serialized back to disk.
    ...(broken.length > 0 ? { broken } : {}),
  };
}

export function serializeSprintsConfig(config: SprintsConfig): string {
  return stringifyYaml({
    sprints: config.sprints.map(s => ({
      id: s.id,
      name: s.name,
      start_date: s.start_date,
      end_date: s.end_date,
      state: s.state,
      ...(s.goal !== undefined ? { goal: s.goal } : {}),
      ...(s.archived === true ? { archived: true } : {}),
    })),
  });
}

export async function loadSprintsConfig(locttDir: string): Promise<SprintsConfig> {
  const path = getSprintsConfigPath(locttDir);
  // Absent is a supported state — a fresh tracker has not written this
  // file yet. Unreadable is not, and the two used to be one code path:
  // `fileExists` then `readFile` is two syscalls where the second can
  // still fail, and the failure surfaced as a bare errno.
  //
  // V9: config is not a log. A definition LocTT could not read is not
  // kept and merged like a comment — other data references it, so
  // LocTT refuses rather than building on top of it. The file itself is
  // never written over, which is what P-11 protects.
  const file = await readFileState(path);
  if (file.state === "unreadable") throw new UnreadableFileError(file);
  if (file.state === "absent") return { sprints: [] };
  return parseSprintsConfig(file.content);
}

export async function saveSprintsConfig(
  locttDir: string,
  config: SprintsConfig,
): Promise<void> {
  const validated = parseSprintsConfig(serializeSprintsConfig(config));
  await writeYamlAtomically(getSprintsConfigPath(locttDir), {
    sprints: validated.sprints.map(s => ({
      id: s.id,
      name: s.name,
      start_date: s.start_date,
      end_date: s.end_date,
      state: s.state,
      ...(s.goal !== undefined ? { goal: s.goal } : {}),
      ...(s.archived === true ? { archived: true } : {}),
    })),
  });
}

export async function sprintsConfigExists(locttDir: string): Promise<boolean> {
  return fileExists(getSprintsConfigPath(locttDir));
}
