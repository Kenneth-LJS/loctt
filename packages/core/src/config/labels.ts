import { join } from "node:path";

import type { LabelsConfig } from "@loctt/contracts";
import { LabelsConfigSchema } from "@loctt/contracts";
import { stringify as stringifyYaml } from "yaml";
import { z } from "zod";

import { getConfigDir } from "../paths/index.js";
import { writeYamlAtomically } from "../utils/atomic-yaml.js";
import { fileExists } from "../utils/fs.js";
import { readFileState, UnreadableFileError } from "../utils/read-state.js";
import { safeParseYaml } from "./yaml-coerce.js";
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
  const raw: unknown = safeParseYaml(yamlContent, "labels.yaml");
  let parsed: LabelsConfig;
  try {
    parsed = LabelsConfigSchema.parse(raw);
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new LabelsConfigError(formatZodIssues("labels config", err));
    }
    throw err;
  }
  // Schema already enforces uniqueness on id via superRefine.
  return parsed;
}

/** Serializes a LabelsConfig to YAML with stable key order. */
export function serializeLabelsConfig(config: LabelsConfig): string {
  return stringifyYaml({
    labels: config.labels.map(l => ({
      id: l.id,
      name: l.name,
      ...(l.color !== undefined ? { color: l.color } : {}),
      ...(l.archived === true ? { archived: true } : {}),
    })),
  });
}

export async function loadLabelsConfig(locttDir: string): Promise<LabelsConfig> {
  const path = getLabelsConfigPath(locttDir);
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
  if (file.state === "absent") return { labels: [] };
  return parseLabelsConfig(file.content);
}

export async function saveLabelsConfig(
  locttDir: string,
  config: LabelsConfig,
): Promise<void> {
  // Round-trip through parse to enforce uniqueness/key validation.
  const validated = parseLabelsConfig(serializeLabelsConfig(config));
  await writeYamlAtomically(getLabelsConfigPath(locttDir), {
    labels: validated.labels.map(l => ({
      id: l.id,
      name: l.name,
      ...(l.color !== undefined ? { color: l.color } : {}),
      ...(l.archived === true ? { archived: true } : {}),
    })),
  });
}

export async function labelsConfigExists(locttDir: string): Promise<boolean> {
  return fileExists(getLabelsConfigPath(locttDir));
}
