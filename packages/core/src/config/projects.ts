import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { ProjectsConfig } from "@loctt/contracts";
import { ProjectsConfigSchema } from "@loctt/contracts";
import { stringify as stringifyYaml } from "yaml";
import { z } from "zod";

import { getConfigDir } from "../paths/index.js";
import { writeYamlAtomically } from "../utils/atomic-yaml.js";
import { fileExists } from "../utils/fs.js";
import { safeParseYaml } from "./yaml-coerce.js";
import { formatZodIssues } from "./zod-error.js";

export class ProjectsConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectsConfigError";
  }
}

const PROJECTS_FILE = "projects.yaml";

export function getProjectsConfigPath(locttDir: string): string {
  return join(getConfigDir(locttDir), PROJECTS_FILE);
}

/**
 * Parses and validates raw YAML content into a ProjectsConfig.
 * The schema enforces uniqueness of keys/prefixes and that the
 * default points at a known project.
 */
export function parseProjectsConfig(yamlContent: string): ProjectsConfig {
  const raw: unknown = safeParseYaml(yamlContent, "projects.yaml");
  try {
    return ProjectsConfigSchema.parse(raw);
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new ProjectsConfigError(formatZodIssues("projects config", err));
    }
    throw err;
  }
}

export function serializeProjectsConfig(config: ProjectsConfig): string {
  const out: Record<string, unknown> = {
    projects: config.projects.map(p => ({
      id: p.id,
      name: p.name,
      prefix: p.prefix,
      ...(p.archived === true ? { archived: true } : {}),
    })),
  };
  if (config.default !== undefined) {
    out["default"] = config.default;
  }
  return stringifyYaml(out);
}

export async function loadProjectsConfig(locttDir: string): Promise<ProjectsConfig> {
  const path = getProjectsConfigPath(locttDir);
  const content = await readFile(path, "utf-8");
  return parseProjectsConfig(content);
}

export async function saveProjectsConfig(
  locttDir: string,
  config: ProjectsConfig,
): Promise<void> {
  // Round-trip through parse to enforce all invariants.
  const validated = parseProjectsConfig(serializeProjectsConfig(config));
  await writeYamlAtomically(getProjectsConfigPath(locttDir), {
    projects: validated.projects.map(p => ({
      id: p.id,
      name: p.name,
      prefix: p.prefix,
      ...(p.archived === true ? { archived: true } : {}),
    })),
    ...(validated.default !== undefined ? { default: validated.default } : {}),
  });
}

export async function projectsConfigExists(locttDir: string): Promise<boolean> {
  return fileExists(getProjectsConfigPath(locttDir));
}
