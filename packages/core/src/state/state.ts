import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { LocttState } from "@loctt/contracts";
import { getStateFilePath } from "../paths/index.js";

export class StateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StateError";
  }
}

function assertObject(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new StateError(`${path} must be an object`);
  }
}

function assertString(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new StateError(`${path} must be a non-empty string`);
  }
}

function assertPositiveInt(value: unknown, path: string): asserts value is number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new StateError(`${path} must be a positive integer`);
  }
}

/**
 * Parses and validates raw YAML content into a LocttState.
 * Throws StateError for invalid data.
 */
export function parseState(yamlContent: string): LocttState {
  const raw: unknown = parseYaml(yamlContent);
  assertObject(raw, "state");

  const keys = raw["keys"];
  assertObject(keys, "keys");

  const parsed: Record<string, { prefix: string; next_number: number }> = {};

  for (const [entityType, entry] of Object.entries(keys)) {
    assertObject(entry, `keys.${entityType}`);
    assertString(entry["prefix"], `keys.${entityType}.prefix`);
    assertPositiveInt(entry["next_number"], `keys.${entityType}.next_number`);
    parsed[entityType] = {
      prefix: entry["prefix"],
      next_number: entry["next_number"],
    };
  }

  return { keys: parsed };
}

/** Serializes a LocttState to YAML string. */
export function serializeState(state: LocttState): string {
  return stringifyYaml({ keys: state.keys });
}

/**
 * Loads and parses state.yaml from the given .loctt directory.
 * Throws if file doesn't exist or content is invalid.
 */
export async function loadState(locttDir: string): Promise<LocttState> {
  const filePath = getStateFilePath(locttDir);
  const content = await readFile(filePath, "utf-8");
  return parseState(content);
}

/**
 * Writes state.yaml to the given .loctt directory.
 * Creates parent directories if needed.
 */
export async function saveState(locttDir: string, state: LocttState): Promise<void> {
  const filePath = getStateFilePath(locttDir);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, serializeState(state), "utf-8");
}
