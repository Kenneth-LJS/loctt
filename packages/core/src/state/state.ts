import { readFile } from "node:fs/promises";

import type { LocttState } from "@loctt/contracts";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { getStateFilePath } from "../paths/index.js";
import { assertObject as _assertObject, assertString as _assertString } from "../utils/assert.js";
import { writeFileAtomically } from "../utils/atomic-yaml.js";

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

  let retired: Record<string, { prefix: string; next_number: number }> | undefined;
  const retiredRaw = raw["retired_keys"];
  if (retiredRaw !== undefined) {
    assertObject(retiredRaw, "retired_keys");
    retired = {};
    for (const [entityType, entry] of Object.entries(retiredRaw)) {
      assertObject(entry, `retired_keys.${entityType}`);
      assertString(entry["prefix"], `retired_keys.${entityType}.prefix`);
      assertPositiveInt(entry["next_number"], `retired_keys.${entityType}.next_number`);
      retired[entityType] = {
        prefix: entry["prefix"],
        next_number: entry["next_number"],
      };
    }
  }

  return { keys: parsed, ...(retired !== undefined ? { retired_keys: retired } : {}) };
}

/** Serializes a LocttState to YAML string. */
export function serializeState(state: LocttState): string {
  const out: Record<string, unknown> = { keys: state.keys };
  if (state.retired_keys !== undefined && Object.keys(state.retired_keys).length > 0) {
    out["retired_keys"] = state.retired_keys;
  }
  return stringifyYaml(out);
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
  await writeFileAtomically(getStateFilePath(locttDir), serializeState(state));
}
