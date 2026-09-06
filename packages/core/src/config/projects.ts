import { join } from "node:path";

import type { ProjectsConfig } from "@loctt/contracts";
import { ProjectDefSchema, ProjectsConfigSchema } from "@loctt/contracts";
import { stringify as stringifyYaml } from "yaml";
import { z } from "zod";

import { LocttError } from "../errors.js";
import { getConfigDir } from "../paths/index.js";
import { writeYamlAtomically } from "../utils/atomic-yaml.js";
import { fileExists } from "../utils/fs.js";
import { readFileState, UnreadableFileError } from "../utils/read-state.js";
import { brokenEntriesToPlain, collectValidEntries } from "./health.js";
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
 * The outer structure, validated object-fatally before any per-entry
 * degrade. `projects` is left as an array of `unknown` here so a single
 * wrong-typed project entry does not throw the whole file out — that is
 * `collectValidEntries`' job below. What still throws here is the file
 * not being an object with a `projects` list at all, an unknown
 * top-level key (`.strict()`), or a non-string `default`. Deliberately
 * has NO `broken` key: a stray `broken:` in a hand-edited file is
 * therefore rejected, and the field stays a load-time-only diagnostic.
 *
 * `.min(1)` is NOT enforced here — an all-broken file leaves zero valid
 * entries, and the "at least one project" object-fatal check runs on the
 * collected-valid set (via `ProjectsConfigSchema`) so both an empty
 * `projects: []` and an all-corrupt list report the same required-project
 * error rather than the emptiness slipping past.
 */
const RawProjectsConfigSchema = z.object({
  projects: z.array(z.unknown()),
  default: z.string().optional(),
}).strict();

/**
 * Parses and validates raw YAML content into a ProjectsConfig.
 *
 * Per north-star principle 5 (the VUE-22 pattern, `config/queries.ts`):
 * one project whose fields no longer validate — a hand edit, most often
 * — must not blank the whole projects surface. Each entry is routed
 * through `collectValidEntries`: a valid project loads, a corrupt one
 * becomes a `BrokenEntry` carrying its index, raw text and the
 * validator's message, and the rest of the file still loads. The broken
 * list rides the result (omitted when clean) so a surface can list them.
 *
 * Object-fatal problems still throw `ProjectsConfigError`: the file not
 * being a list / the outer structure malformed (RawProjectsConfigSchema
 * above), and the cross-entry checks — duplicate id / prefix / slug (two
 * projects sharing a prefix makes a task key ambiguous), an archived
 * default, and "at least one project" — all of which run below through
 * `ProjectsConfigSchema` on the collected-valid set. A ghost `default:`
 * (naming a project that does not exist) is tolerated, not thrown (K23).
 */
export function parseProjectsConfig(yamlContent: string): ProjectsConfig {
  const raw: unknown = safeParseYaml(yamlContent, "projects.yaml");

  // Outer structure — object-fatal.
  let outer: z.infer<typeof RawProjectsConfigSchema>;
  try {
    outer = RawProjectsConfigSchema.parse(raw);
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new ProjectsConfigError(`projects.yaml is not valid: ${formatZodIssues("projects config", err)}`);
    }
    throw err;
  }

  // Per-entry degrade: a corrupt project becomes a BrokenEntry; the good
  // ones carry on. `collectValidEntries` never throws.
  const { valid, broken } = collectValidEntries(outer.projects, ProjectDefSchema, "project");

  // The "at least one project" rule (XS-62) is about the FILE having a
  // project, not about how many parsed. A tracker whose only project is
  // corrupt is NOT "no projects" — it has one, and it is broken. So the
  // emptiness check must count valid + broken; enforcing `.min(1)` over
  // the collected-valid set alone would let one corrupt project blank the
  // whole surface, the exact regression Phase-7B removes (a fresh
  // tracker has one project; hand-breaking it must show it as broken, not
  // report "no projects" — PRU-37).
  if (valid.length + broken.length === 0) {
    throw new ProjectsConfigError(
      "projects.yaml is not valid: at least one project is required — "
      + "add one to projects.yaml, or run 'loctt project create'",
    );
  }

  // The remaining cross-entry checks (duplicate id/prefix/slug, archived
  // default) are object-fatal and reuse the contract schema over the
  // VALID set. A ghost default still parses through (K23). When every
  // project is broken, `valid` is empty; the schema's `.min(1)` would
  // fire, so we skip the schema round-trip in that case — there are no
  // valid entries to cross-check, and the emptiness rule above already
  // passed (a broken project exists).
  let parsed: ProjectsConfig;
  if (valid.length === 0) {
    parsed = { projects: [], ...(outer.default !== undefined ? { default: outer.default } : {}) };
  } else {
    try {
      parsed = ProjectsConfigSchema.parse({
        projects: valid,
        ...(outer.default !== undefined ? { default: outer.default } : {}),
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        throw new ProjectsConfigError(`projects.yaml is not valid: ${formatZodIssues("projects config", err)}`);
      }
      throw err;
    }
  }

  return {
    ...parsed,
    // Omitted, not `[]`, when everything parsed — so a consumer reading
    // only `projects` is unaffected and "none broken" stays distinct from
    // "not inspected". Never serialized back to disk (buildPlainObject
    // does not emit it).
    ...(broken.length > 0 ? { broken } : {}),
  };
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
function serializeProject(p: ProjectsConfig["projects"][number]): Record<string, unknown> {
  return {
    id: p.id,
    name: p.name,
    ...(p.slug !== undefined ? { slug: p.slug } : {}),
    prefix: p.prefix,
    ...(p.archived === true ? { archived: true } : {}),
  };
}

/**
 * The on-disk shape, in one place.
 *
 * K28: any preserved `broken` project (one another process left, corrupt
 * but degraded) is re-emitted alongside the valid ones — re-serializing
 * only the valid entries silently drops it from disk on an unrelated write
 * (P1 data loss). A broken entry re-loads back into `broken`.
 */
function buildPlainObject(config: ProjectsConfig): Record<string, unknown> {
  const out: Record<string, unknown> = {
    projects: [
      ...config.projects.map(serializeProject),
      ...brokenEntriesToPlain(config.broken),
    ],
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
