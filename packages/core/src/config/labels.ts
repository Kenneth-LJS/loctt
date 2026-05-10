import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { LabelsConfig } from "@loctt/contracts";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { getConfigDir } from "../paths/index.js";
import {
  assertArray as _assertArray,
  assertObject as _assertObject,
  assertString as _assertString,
} from "../utils/assert.js";
import { writeYamlAtomically } from "../utils/atomic-yaml.js";
import { fileExists } from "../utils/fs.js";

export class LabelsConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LabelsConfigError";
  }
}

function assertString(value: unknown, path: string): asserts value is string {
  _assertString(value, path, LabelsConfigError);
}

function assertArray(value: unknown, path: string): asserts value is unknown[] {
  _assertArray(value, path, LabelsConfigError);
}

function assertObject(value: unknown, path: string): asserts value is Record<string, unknown> {
  _assertObject(value, path, LabelsConfigError);
}

const LABELS_FILE = "labels.yaml";
const KEY_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

/** Returns the path to .loctt/config/labels.yaml. */
export function getLabelsConfigPath(locttDir: string): string {
  return join(getConfigDir(locttDir), LABELS_FILE);
}

function assertLabelKey(value: unknown, path: string): asserts value is string {
  assertString(value, path);
  if (!KEY_PATTERN.test(value)) {
    throw new LabelsConfigError(
      `${path} must be a slug (lowercase letters, digits, hyphen, underscore), got: ${value}`,
    );
  }
}

/** Parses raw YAML content into a LabelsConfig. */
export function parseLabelsConfig(yamlContent: string): LabelsConfig {
  const raw: unknown = parseYaml(yamlContent);
  assertObject(raw, "labels config");

  const labels = raw["labels"];
  assertArray(labels, "labels");

  const seen = new Set<string>();
  const parsed = labels.map((item, i) => {
    assertObject(item, `labels[${i}]`);
    assertLabelKey(item["key"], `labels[${i}].key`);
    assertString(item["label"], `labels[${i}].label`);
    const color = item["color"];
    if (color !== undefined) assertString(color, `labels[${i}].color`);

    if (seen.has(item["key"])) {
      throw new LabelsConfigError(`duplicate label key: ${item["key"]}`);
    }
    seen.add(item["key"]);

    return {
      key: item["key"],
      label: item["label"],
      ...(color !== undefined ? { color: color } : {}),
    };
  });

  return { labels: parsed };
}

/** Serializes a LabelsConfig to YAML with stable key order. */
export function serializeLabelsConfig(config: LabelsConfig): string {
  return stringifyYaml({
    labels: config.labels.map(l => ({
      key: l.key,
      label: l.label,
      ...(l.color !== undefined ? { color: l.color } : {}),
    })),
  });
}

/**
 * Loads labels.yaml. Returns an empty config when the file is
 * absent — labels are an additive concept, so trackers without any
 * registered labels just have an empty registry.
 */
export async function loadLabelsConfig(locttDir: string): Promise<LabelsConfig> {
  const path = getLabelsConfigPath(locttDir);
  if (!(await fileExists(path))) return { labels: [] };
  const raw = await readFile(path, "utf-8");
  return parseLabelsConfig(raw);
}

/** Atomically writes labels.yaml. */
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
    })),
  });
}

export async function labelsConfigExists(locttDir: string): Promise<boolean> {
  return fileExists(getLabelsConfigPath(locttDir));
}
