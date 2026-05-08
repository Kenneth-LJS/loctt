import { randomBytes } from "node:crypto";
import { mkdir,readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { LocttState } from "@loctt/contracts";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { getStateFilePath } from "../paths/index.js";
import { assertObject as _assertObject, assertString as _assertString } from "../utils/assert.js";

export class StateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StateError";
  }
}

function assertObject(value: unknown, path: string): asserts value is Record<string, unknown> {
  _assertObject(value, path, StateError);
}

function assertString(value: unknown, path: string): asserts value is string {
  _assertString(value, path, StateError);
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
 *
 * Uses an atomic temp-file + rename so concurrent readers never observe
 * a half-written state.yaml. Coordination across writers requires the
 * caller to hold `withStateLock` around the read-modify-write pair.
 */
export async function saveState(locttDir: string, state: LocttState): Promise<void> {
  const filePath = getStateFilePath(locttDir);
  await mkdir(dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tmpPath, serializeState(state), "utf-8");
  await rename(tmpPath, filePath);
}
