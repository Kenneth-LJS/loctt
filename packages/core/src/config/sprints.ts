import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { SprintsConfig } from "@loctt/contracts";
import { SprintsConfigSchema } from "@loctt/contracts";
import { stringify as stringifyYaml } from "yaml";
import { z } from "zod";

import { getConfigDir } from "../paths/index.js";
import { writeYamlAtomically } from "../utils/atomic-yaml.js";
import { fileExists } from "../utils/fs.js";
import { coerceYaml, safeParseYaml } from "./yaml-coerce.js";
import { formatZodIssues } from "./zod-error.js";

export class SprintsConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SprintsConfigError";
  }
}

const SPRINTS_FILE = "sprints.yaml";

export function getSprintsConfigPath(locttDir: string): string {
  return join(getConfigDir(locttDir), SPRINTS_FILE);
}

export function parseSprintsConfig(yamlContent: string): SprintsConfig {
  const raw = coerceYaml(safeParseYaml(yamlContent, "sprints.yaml"));
  let parsed: SprintsConfig;
  try {
    parsed = SprintsConfigSchema.parse(raw);
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new SprintsConfigError(formatZodIssues("sprints config", err));
    }
    throw err;
  }
  // Schema enforces uniqueness on id via superRefine.
  return parsed;
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
  if (!(await fileExists(path))) return { sprints: [] };
  const raw = await readFile(path, "utf-8");
  return parseSprintsConfig(raw);
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
