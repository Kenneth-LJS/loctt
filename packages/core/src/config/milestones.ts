import { join } from "node:path";

import type { MilestonesConfig } from "@loctt/contracts";
import { MilestonesConfigSchema } from "@loctt/contracts";
import { stringify as stringifyYaml } from "yaml";
import { z } from "zod";

import { getConfigDir } from "../paths/index.js";
import { writeYamlAtomically } from "../utils/atomic-yaml.js";
import { fileExists } from "../utils/fs.js";
import { readFileState, UnreadableFileError } from "../utils/read-state.js";
import { coerceYaml, safeParseYaml } from "./yaml-coerce.js";
import { formatZodIssues } from "./zod-error.js";

export class MilestonesConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MilestonesConfigError";
  }
}

const MILESTONES_FILE = "milestones.yaml";

export function getMilestonesConfigPath(locttDir: string): string {
  return join(getConfigDir(locttDir), MILESTONES_FILE);
}

export function parseMilestonesConfig(yamlContent: string): MilestonesConfig {
  const raw = coerceYaml(safeParseYaml(yamlContent, "milestones.yaml"));
  let parsed: MilestonesConfig;
  try {
    parsed = MilestonesConfigSchema.parse(raw);
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new MilestonesConfigError(formatZodIssues("milestones config", err));
    }
    throw err;
  }
  // Schema enforces uniqueness on id via superRefine.
  return parsed;
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
