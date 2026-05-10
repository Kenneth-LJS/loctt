import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { ProjectsConfig } from "@loctt/contracts";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { getConfigDir } from "../paths/index.js";
import {
  assertArray as _assertArray,
  assertObject as _assertObject,
  assertString as _assertString,
} from "../utils/assert.js";
import { writeYamlAtomically } from "../utils/atomic-yaml.js";
import { fileExists } from "../utils/fs.js";

export class ProjectsConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectsConfigError";
  }
}

function assertString(value: unknown, path: string): asserts value is string {
  _assertString(value, path, ProjectsConfigError);
}

function assertArray(value: unknown, path: string): asserts value is unknown[] {
  _assertArray(value, path, ProjectsConfigError);
}

function assertObject(value: unknown, path: string): asserts value is Record<string, unknown> {
  _assertObject(value, path, ProjectsConfigError);
}

const PROJECTS_FILE = "projects.yaml";

const KEY_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

/** Returns the path to .loctt/config/projects.yaml. */
export function getProjectsConfigPath(locttDir: string): string {
  return join(getConfigDir(locttDir), PROJECTS_FILE);
}

/**
 * Validates that a project key is a kebab/snake-case slug —
 * lowercase letters, digits, hyphen, underscore. The key is used
 * as a frontmatter field value and a state-file map key, so it
 * must be filesystem- and YAML-friendly.
 */
function assertProjectKey(value: unknown, path: string): asserts value is string {
  assertString(value, path);
  if (!KEY_PATTERN.test(value)) {
    throw new ProjectsConfigError(
      `${path} must be a slug (lowercase letters, digits, hyphen, underscore), got: ${value}`,
    );
  }
}

/**
 * Validates a project's prefix. Loose by design: most teams pick
 * something like `T-`, `BACKEND-`, or `WEB-`, but exotic shapes are
 * allowed. The only hard constraint is non-emptiness — the prefix
 * is concatenated with an integer to form the user-facing task key.
 */
function assertProjectPrefix(value: unknown, path: string): asserts value is string {
  assertString(value, path);
  if (value.length === 0) {
    throw new ProjectsConfigError(`${path} must be a non-empty string`);
  }
}

/**
 * Parses and validates raw YAML content into a ProjectsConfig.
 * Throws ProjectsConfigError for invalid data.
 */
export function parseProjectsConfig(yamlContent: string): ProjectsConfig {
  const raw: unknown = parseYaml(yamlContent);
  assertObject(raw, "projects config");

  const projects = raw["projects"];
  assertArray(projects, "projects");

  if (projects.length === 0) {
    throw new ProjectsConfigError("at least one project is required");
  }

  const seenKeys = new Set<string>();
  const seenPrefixes = new Set<string>();

  const parsed = projects.map((item, i) => {
    assertObject(item, `projects[${i}]`);
    assertProjectKey(item["key"], `projects[${i}].key`);
    assertString(item["label"], `projects[${i}].label`);
    assertProjectPrefix(item["prefix"], `projects[${i}].prefix`);
    const archived = item["archived"];
    if (archived !== undefined && typeof archived !== "boolean") {
      throw new ProjectsConfigError(`projects[${i}].archived must be a boolean`);
    }

    if (seenKeys.has(item["key"])) {
      throw new ProjectsConfigError(`duplicate project key: ${item["key"]}`);
    }
    seenKeys.add(item["key"]);
    if (seenPrefixes.has(item["prefix"])) {
      throw new ProjectsConfigError(
        `duplicate project prefix: ${item["prefix"]} — prefixes must be unique so task keys are unambiguous`,
      );
    }
    seenPrefixes.add(item["prefix"]);

    return {
      key: item["key"],
      label: item["label"],
      prefix: item["prefix"],
      ...(archived === true ? { archived: true } : {}),
    };
  });

  let defaultKey: string | undefined;
  if (raw["default"] !== undefined) {
    assertString(raw["default"], "default");
    defaultKey = raw["default"];
    if (!seenKeys.has(defaultKey)) {
      throw new ProjectsConfigError(
        `default project '${defaultKey}' is not in the projects list`,
      );
    }
  }

  return defaultKey !== undefined
    ? { projects: parsed, default: defaultKey }
    : { projects: parsed };
}

/** Serializes a ProjectsConfig to YAML. Stable key order. */
export function serializeProjectsConfig(config: ProjectsConfig): string {
  const out: Record<string, unknown> = {
    projects: config.projects.map(p => ({
      key: p.key,
      label: p.label,
      prefix: p.prefix,
      ...(p.archived === true ? { archived: true } : {}),
    })),
  };
  if (config.default !== undefined) {
    out["default"] = config.default;
  }
  return stringifyYaml(out);
}

/**
 * Loads projects.yaml. Throws ProjectsConfigError on parse failure.
 * Throws if the file is missing — projects.yaml is mandatory for any
 * tracker initialized by this version of LocTT.
 */
export async function loadProjectsConfig(locttDir: string): Promise<ProjectsConfig> {
  const path = getProjectsConfigPath(locttDir);
  const content = await readFile(path, "utf-8");
  return parseProjectsConfig(content);
}

/**
 * Writes projects.yaml atomically. Validates the supplied config
 * before writing to ensure on-disk state never holds a malformed
 * registry.
 */
export async function saveProjectsConfig(
  locttDir: string,
  config: ProjectsConfig,
): Promise<void> {
  // Round-trip through parse to enforce all invariants (uniqueness,
  // default-points-at-known-project, etc.) before persisting.
  const validated = parseProjectsConfig(serializeProjectsConfig(config));
  await writeYamlAtomically(getProjectsConfigPath(locttDir), {
    projects: validated.projects.map(p => ({
      key: p.key,
      label: p.label,
      prefix: p.prefix,
      ...(p.archived === true ? { archived: true } : {}),
    })),
    ...(validated.default !== undefined ? { default: validated.default } : {}),
  });
}

/** Returns true when projects.yaml exists. */
export async function projectsConfigExists(locttDir: string): Promise<boolean> {
  return fileExists(getProjectsConfigPath(locttDir));
}
