import { join } from "node:path";

import type { ProjectsConfig } from "@loctt/contracts";
import { ProjectsConfigSchema } from "@loctt/contracts";
import { stringify as stringifyYaml } from "yaml";
import { z } from "zod";

import { LocttError } from "../errors.js";
import { getConfigDir } from "../paths/index.js";
import { writeYamlAtomically } from "../utils/atomic-yaml.js";
import { fileExists } from "../utils/fs.js";
import { readFileState, UnreadableFileError } from "../utils/read-state.js";
import { safeParseYaml } from "./yaml-coerce.js";
import { formatZodIssues } from "./zod-error.js";

export class ProjectsConfigError extends LocttError {
  constructor(message: string) {
    // `config_invalid`, not the `unknown` an un-attributed Error
    // falls back to. The message already names the file, the field
    // path and what was expected (ERR-10); what was missing was a
    // code, so every surface reported a schema problem as an
    // unexplained server failure. V1: core states its own cause.
    super("config_invalid", message, {
      dataState: "not_saved",
      recovery: { kind: "command" },
    });
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
      throw new ProjectsConfigError(`projects.yaml is not valid: ${formatZodIssues("projects config", err)}`);
    }
    throw err;
  }
}

/**
 * The on-disk shape, in one place.
 *
 * `serializeProjectsConfig` and `saveProjectsConfig` each built this
 * literal independently, so a field added to one and forgotten in the
 * other was silently dropped on save — the same failure
 * `projectTaskFrontmatter`'s hand-written key list had, in a file
 * where the loss is a config value rather than an API field.
 *
 * Follows `list-view.ts`'s `buildPlainObject`, which already did this.
 */
function buildPlainObject(config: ProjectsConfig): Record<string, unknown> {
  const out: Record<string, unknown> = {
    projects: config.projects.map(p => ({
      id: p.id,
      name: p.name,
      ...(p.slug !== undefined ? { slug: p.slug } : {}),
      prefix: p.prefix,
      ...(p.archived === true ? { archived: true } : {}),
    })),
  };
  if (config.default !== undefined) {
    out["default"] = config.default;
  }
  return out;
}

export function serializeProjectsConfig(config: ProjectsConfig): string {
  return stringifyYaml(buildPlainObject(config));
}

export async function loadProjectsConfig(locttDir: string): Promise<ProjectsConfig> {
  const path = getProjectsConfigPath(locttDir);
  // Rethrown as a named cause rather than a bare errno: these throw on
  // absence too (deliberately — the file is required), so the caller
  // needs to know which file and why.
  const file = await readFileState(path);
  if (file.state === "unreadable") throw new UnreadableFileError(file);
  if (file.state === "absent") {
    throw Object.assign(new Error(`ENOENT: no such file or directory, open '${path}'`), { code: "ENOENT", path: path });
  }
  return parseProjectsConfig(file.content);
}

export async function saveProjectsConfig(
  locttDir: string,
  config: ProjectsConfig,
): Promise<void> {
  // Round-trip through parse to enforce all invariants.
  const validated = parseProjectsConfig(serializeProjectsConfig(config));
  await writeYamlAtomically(
    getProjectsConfigPath(locttDir),
    buildPlainObject(validated),
  );
}

export async function projectsConfigExists(locttDir: string): Promise<boolean> {
  return fileExists(getProjectsConfigPath(locttDir));
}
