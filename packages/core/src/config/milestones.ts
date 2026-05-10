import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { MilestonesConfig } from "@loctt/contracts";
import { MilestonesConfigSchema } from "@loctt/contracts";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";

import { getConfigDir } from "../paths/index.js";
import { writeYamlAtomically } from "../utils/atomic-yaml.js";
import { fileExists } from "../utils/fs.js";
import { coerceYaml } from "./yaml-coerce.js";
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
  const raw = coerceYaml(parseYaml(yamlContent));
  let parsed: MilestonesConfig;
  try {
    parsed = MilestonesConfigSchema.parse(raw);
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new MilestonesConfigError(formatZodIssues("milestones config", err));
    }
    throw err;
  }
  const seen = new Set<string>();
  for (const m of parsed.milestones) {
    if (seen.has(m.key)) {
      throw new MilestonesConfigError(`duplicate milestone key: ${m.key}`);
    }
    seen.add(m.key);
  }
  return parsed;
}

export function serializeMilestonesConfig(config: MilestonesConfig): string {
  return stringifyYaml({
    milestones: config.milestones.map(m => ({
      key: m.key,
      label: m.label,
      ...(m.target_date !== undefined ? { target_date: m.target_date } : {}),
      ...(m.archived === true ? { archived: true } : {}),
    })),
  });
}

export async function loadMilestonesConfig(locttDir: string): Promise<MilestonesConfig> {
  const path = getMilestonesConfigPath(locttDir);
  if (!(await fileExists(path))) return { milestones: [] };
  const raw = await readFile(path, "utf-8");
  return parseMilestonesConfig(raw);
}

export async function saveMilestonesConfig(
  locttDir: string,
  config: MilestonesConfig,
): Promise<void> {
  const validated = parseMilestonesConfig(serializeMilestonesConfig(config));
  await writeYamlAtomically(getMilestonesConfigPath(locttDir), {
    milestones: validated.milestones.map(m => ({
      key: m.key,
      label: m.label,
      ...(m.target_date !== undefined ? { target_date: m.target_date } : {}),
      ...(m.archived === true ? { archived: true } : {}),
    })),
  });
}

export async function milestonesConfigExists(locttDir: string): Promise<boolean> {
  return fileExists(getMilestonesConfigPath(locttDir));
}
