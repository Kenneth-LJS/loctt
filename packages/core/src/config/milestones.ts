import { join } from "node:path";

import type { MilestoneDef, MilestonesConfig } from "@loctt/contracts";
import { MilestoneDefSchema } from "@loctt/contracts";
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
 * The outer shape only: `milestones` is an array. Each entry is left as
 * `unknown` here so a single wrong-typed field degrades to a `BrokenEntry`
 * (via `collectValidEntries`) instead of the strict per-entry schema
 * throwing and blanking every milestone beside it. A file that is not even
 * a list — `milestones` missing or not an array — is object-fatal and
 * still throws, because there is no coherent collection to degrade around.
 */
const RawMilestonesConfigSchema = z.object({
  milestones: z.array(z.unknown()),
}).strict();

export class MilestonesConfigError extends LocttError {
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
    this.name = "MilestonesConfigError";
  }
}

const MILESTONES_FILE = "milestones.yaml";

export function getMilestonesConfigPath(locttDir: string): string {
  return join(getConfigDir(locttDir), MILESTONES_FILE);
}

export function parseMilestonesConfig(yamlContent: string): MilestonesConfig {
  const raw = coerceYaml(safeParseYaml(yamlContent, "milestones.yaml"));

  // Object-fatal: the file must be a `{ milestones: [...] }`. A missing or
  // non-array `milestones` is not a collection we can degrade around, so it
  // still throws — exactly as before.
  let outer: z.infer<typeof RawMilestonesConfigSchema>;
  try {
    outer = RawMilestonesConfigSchema.parse(raw);
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new MilestonesConfigError(`milestones.yaml is not valid: ${formatZodIssues("milestones config", err)}`);
    }
    throw err;
  }

  // Per north-star principle 5: one milestone whose fields no longer
  // validate (a hand-edited target_date, a wrong-typed name) must not blank
  // the whole milestones surface. Good entries load; a bad one becomes a
  // `BrokenEntry` carrying its index, raw text and the validator's message,
  // so a surface can list it as broken beside the healthy ones (VUE-22).
  const { valid, broken } = collectValidEntries<MilestoneDef>(
    outer.milestones,
    MilestoneDefSchema,
    "milestone",
  );

  // Duplicate ids stay object-fatal: two milestones sharing an id makes a
  // task's `milestone: <id>` reference ambiguous, so we cannot silently
  // pick one. Checked over the entries that parsed — a duplicate whose
  // partner is itself broken simply drops out of contention.
  const seen = new Set<string>();
  for (const m of valid) {
    if (seen.has(m.id)) {
      throw new MilestonesConfigError(`milestones.yaml is not valid: duplicate milestone id: ${m.id}`);
    }
    seen.add(m.id);
  }

  return {
    milestones: valid,
    // Omitted, not `[]`, when everything parsed — a consumer reading only
    // `milestones` is unaffected and "none broken" stays distinct from
    // "not inspected". Never serialized back to disk.
    ...(broken.length > 0 ? { broken } : {}),
  };
}

export function serializeMilestonesConfig(config: MilestonesConfig): string {
  return stringifyYaml({
    milestones: config.milestones.map(m => ({
      id: m.id,
      name: m.name,
      ...(m.target_date !== undefined ? { target_date: m.target_date } : {}),
      ...(m.archived === true ? { archived: true } : {}),
    })),
  });
}

export async function loadMilestonesConfig(locttDir: string): Promise<MilestonesConfig> {
  const path = getMilestonesConfigPath(locttDir);
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
  if (file.state === "absent") return { milestones: [] };
  return parseMilestonesConfig(file.content);
}

export async function saveMilestonesConfig(
  locttDir: string,
  config: MilestonesConfig,
): Promise<void> {
  const validated = parseMilestonesConfig(serializeMilestonesConfig(config));
  await writeYamlAtomically(getMilestonesConfigPath(locttDir), {
    milestones: validated.milestones.map(m => ({
      id: m.id,
      name: m.name,
      ...(m.target_date !== undefined ? { target_date: m.target_date } : {}),
      ...(m.archived === true ? { archived: true } : {}),
    })),
  });
}

export async function milestonesConfigExists(locttDir: string): Promise<boolean> {
  return fileExists(getMilestonesConfigPath(locttDir));
}
