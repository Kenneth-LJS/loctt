import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { SprintsConfig, SprintState } from "@loctt/contracts";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { getConfigDir } from "../paths/index.js";
import {
  assertArray as _assertArray,
  assertObject as _assertObject,
  assertString as _assertString,
} from "../utils/assert.js";
import { writeYamlAtomically } from "../utils/atomic-yaml.js";
import { fileExists } from "../utils/fs.js";

export class SprintsConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SprintsConfigError";
  }
}

function assertString(value: unknown, path: string): asserts value is string {
  _assertString(value, path, SprintsConfigError);
}

function assertArray(value: unknown, path: string): asserts value is unknown[] {
  _assertArray(value, path, SprintsConfigError);
}

function assertObject(value: unknown, path: string): asserts value is Record<string, unknown> {
  _assertObject(value, path, SprintsConfigError);
}

const SPRINTS_FILE = "sprints.yaml";
const KEY_PATTERN = /^[a-z0-9][a-z0-9_.-]*$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const VALID_STATES: ReadonlySet<SprintState> = new Set(["active", "completed", "future"]);

export function getSprintsConfigPath(locttDir: string): string {
  return join(getConfigDir(locttDir), SPRINTS_FILE);
}

function assertSprintKey(value: unknown, path: string): asserts value is string {
  assertString(value, path);
  if (!KEY_PATTERN.test(value)) {
    throw new SprintsConfigError(
      `${path} must be a slug (lowercase letters, digits, hyphen, dot, underscore), got: ${value}`,
    );
  }
}

function assertDateString(value: unknown, path: string): string {
  let s: string;
  if (value instanceof Date) {
    s = value.toISOString().slice(0, 10);
  } else if (typeof value === "string") {
    s = value;
  } else {
    throw new SprintsConfigError(`${path} must be a YYYY-MM-DD string`);
  }
  if (!DATE_PATTERN.test(s)) {
    throw new SprintsConfigError(`${path} must be YYYY-MM-DD, got: ${s}`);
  }
  return s;
}

export function parseSprintsConfig(yamlContent: string): SprintsConfig {
  const raw: unknown = parseYaml(yamlContent);
  assertObject(raw, "sprints config");

  const sprints = raw["sprints"];
  assertArray(sprints, "sprints");

  const seen = new Set<string>();
  const parsed = sprints.map((item, i) => {
    assertObject(item, `sprints[${i}]`);
    assertSprintKey(item["key"], `sprints[${i}].key`);
    assertString(item["label"], `sprints[${i}].label`);
    const startDate = assertDateString(item["start_date"], `sprints[${i}].start_date`);
    const endDate = assertDateString(item["end_date"], `sprints[${i}].end_date`);
    if (endDate < startDate) {
      throw new SprintsConfigError(
        `sprints[${i}]: end_date (${endDate}) must not be before start_date (${startDate})`,
      );
    }
    assertString(item["state"], `sprints[${i}].state`);
    if (!VALID_STATES.has(item["state"] as SprintState)) {
      throw new SprintsConfigError(
        `sprints[${i}].state must be one of active|completed|future, got: ${item["state"]}`,
      );
    }
    const goal = item["goal"];
    if (goal !== undefined) assertString(goal, `sprints[${i}].goal`);

    if (seen.has(item["key"])) {
      throw new SprintsConfigError(`duplicate sprint key: ${item["key"]}`);
    }
    seen.add(item["key"]);

    return {
      key: item["key"],
      label: item["label"],
      start_date: startDate,
      end_date: endDate,
      state: item["state"] as SprintState,
      ...(goal !== undefined ? { goal: goal } : {}),
    };
  });

  return { sprints: parsed };
}

export function serializeSprintsConfig(config: SprintsConfig): string {
  return stringifyYaml({
    sprints: config.sprints.map(s => ({
      key: s.key,
      label: s.label,
      start_date: s.start_date,
      end_date: s.end_date,
      state: s.state,
      ...(s.goal !== undefined ? { goal: s.goal } : {}),
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
      key: s.key,
      label: s.label,
      start_date: s.start_date,
      end_date: s.end_date,
      state: s.state,
      ...(s.goal !== undefined ? { goal: s.goal } : {}),
    })),
  });
}

export async function sprintsConfigExists(locttDir: string): Promise<boolean> {
  return fileExists(getSprintsConfigPath(locttDir));
}
