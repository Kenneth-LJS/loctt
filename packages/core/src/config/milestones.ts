import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { MilestonesConfig } from "@loctt/contracts";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { getConfigDir } from "../paths/index.js";
import {
  assertArray as _assertArray,
  assertObject as _assertObject,
  assertString as _assertString,
} from "../utils/assert.js";
import { writeYamlAtomically } from "../utils/atomic-yaml.js";
import { fileExists } from "../utils/fs.js";

export class MilestonesConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MilestonesConfigError";
  }
}

function assertString(value: unknown, path: string): asserts value is string {
  _assertString(value, path, MilestonesConfigError);
}

function assertArray(value: unknown, path: string): asserts value is unknown[] {
  _assertArray(value, path, MilestonesConfigError);
}

function assertObject(value: unknown, path: string): asserts value is Record<string, unknown> {
  _assertObject(value, path, MilestonesConfigError);
}

const MILESTONES_FILE = "milestones.yaml";
const KEY_PATTERN = /^[a-z0-9][a-z0-9_.-]*$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function getMilestonesConfigPath(locttDir: string): string {
  return join(getConfigDir(locttDir), MILESTONES_FILE);
}

function assertMilestoneKey(value: unknown, path: string): asserts value is string {
  assertString(value, path);
  if (!KEY_PATTERN.test(value)) {
    throw new MilestonesConfigError(
      `${path} must be a slug (lowercase letters, digits, hyphen, dot, underscore), got: ${value}`,
    );
  }
}

export function parseMilestonesConfig(yamlContent: string): MilestonesConfig {
  const raw: unknown = parseYaml(yamlContent);
  assertObject(raw, "milestones config");

  const milestones = raw["milestones"];
  assertArray(milestones, "milestones");

  const seen = new Set<string>();
  const parsed = milestones.map((item, i) => {
    assertObject(item, `milestones[${i}]`);
    assertMilestoneKey(item["key"], `milestones[${i}].key`);
    assertString(item["label"], `milestones[${i}].label`);

    let targetDate: string | undefined;
    const td = item["target_date"];
    if (td !== undefined && td !== null) {
      // YAML can parse YYYY-MM-DD as a Date; coerce back.
      let s: string;
      if (td instanceof Date) {
        s = td.toISOString().slice(0, 10);
      } else if (typeof td === "string") {
        s = td;
      } else {
        throw new MilestonesConfigError(
          `milestones[${i}].target_date must be a YYYY-MM-DD string`,
        );
      }
      if (!DATE_PATTERN.test(s)) {
        throw new MilestonesConfigError(
          `milestones[${i}].target_date must be YYYY-MM-DD, got: ${s}`,
        );
      }
      targetDate = s;
    }

    const archived = item["archived"];
    if (archived !== undefined && typeof archived !== "boolean") {
      throw new MilestonesConfigError(`milestones[${i}].archived must be a boolean`);
    }

    if (seen.has(item["key"])) {
      throw new MilestonesConfigError(`duplicate milestone key: ${item["key"]}`);
    }
    seen.add(item["key"]);

    return {
      key: item["key"],
      label: item["label"],
      ...(targetDate !== undefined ? { target_date: targetDate } : {}),
      ...(archived === true ? { archived: true } : {}),
    };
  });

  return { milestones: parsed };
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
