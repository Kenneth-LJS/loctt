import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { LabelsConfig } from "@loctt/contracts";
import { LabelsConfigSchema } from "@loctt/contracts";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";

import { getConfigDir } from "../paths/index.js";
import { writeYamlAtomically } from "../utils/atomic-yaml.js";
import { fileExists } from "../utils/fs.js";
import { formatZodIssues } from "./zod-error.js";

export class LabelsConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LabelsConfigError";
  }
}

const LABELS_FILE = "labels.yaml";

export function getLabelsConfigPath(locttDir: string): string {
  return join(getConfigDir(locttDir), LABELS_FILE);
}

/** Parses raw YAML content into a LabelsConfig. */
export function parseLabelsConfig(yamlContent: string): LabelsConfig {
  const raw: unknown = parseYaml(yamlContent);
  let parsed: LabelsConfig;
  try {
    parsed = LabelsConfigSchema.parse(raw);
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new LabelsConfigError(formatZodIssues("labels config", err));
    }
    throw err;
  }
  // Uniqueness check (zod schema doesn't enforce cross-element constraints).
  const seen = new Set<string>();
  for (const l of parsed.labels) {
    if (seen.has(l.key)) {
      throw new LabelsConfigError(`duplicate label key: ${l.key}`);
    }
    seen.add(l.key);
  }
  return parsed;
}

/** Serializes a LabelsConfig to YAML with stable key order. */
export function serializeLabelsConfig(config: LabelsConfig): string {
  return stringifyYaml({
    labels: config.labels.map(l => ({
      key: l.key,
      label: l.label,
      ...(l.color !== undefined ? { color: l.color } : {}),
      ...(l.archived === true ? { archived: true } : {}),
    })),
  });
}

export async function loadLabelsConfig(locttDir: string): Promise<LabelsConfig> {
  const path = getLabelsConfigPath(locttDir);
  if (!(await fileExists(path))) return { labels: [] };
  const raw = await readFile(path, "utf-8");
  return parseLabelsConfig(raw);
}

export async function saveLabelsConfig(
  locttDir: string,
  config: LabelsConfig,
): Promise<void> {
  // Round-trip through parse to enforce uniqueness/key validation.
  const validated = parseLabelsConfig(serializeLabelsConfig(config));
  await writeYamlAtomically(getLabelsConfigPath(locttDir), {
    labels: validated.labels.map(l => ({
      key: l.key,
      label: l.label,
      ...(l.color !== undefined ? { color: l.color } : {}),
      ...(l.archived === true ? { archived: true } : {}),
    })),
  });
}

export async function labelsConfigExists(locttDir: string): Promise<boolean> {
  return fileExists(getLabelsConfigPath(locttDir));
}
