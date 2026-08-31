import type { LocttState, ProjectDef, ProjectsConfig } from "@loctt/contracts";
import { ulid } from "ulid";

import {
  loadProjectsConfig,
  saveProjectsConfig,
} from "../config/projects.js";
import type { LocttErrorOptions } from "../errors.js";
import { LocttError } from "../errors.js";
import {
  appendJournalEntry,
  clearJournalEntry,
  initKeyAllocation,
  KeyAllocationError,
  loadJournal,
  loadState,
  registerRecoveryHandler,
  replayTaskRemap,
  saveJournal,
  saveState,
  withStateLock,
} from "../state/index.js";
import type { JournalEntry } from "../state/journal.js";
import { loadAllTasks } from "../task/load-all.js";
import { getCurrentUser } from "../users/manage.js";
import { loadUserSettings } from "../users/settings.js";
import { allocateSlug, isValidSlug } from "./slug.js";

/**
 * Entity errors carry `validation_failed` and `not_saved`: every throw
 * site is a rejected input, checked before the write.
 *
 * A caller that knows better overrides — `not_found` for an unknown
 * name, say — but the default is the common case rather than something
 * each throw site has to remember.
 */
export class ProjectError extends LocttError {
  constructor(message: string, opts: LocttErrorOptions = {}) {
    super("validation_failed", message, { dataState: "not_saved", ...opts });
    this.name = "ProjectError";
  }
}

/**
 * Result of looking up a project by name.
 *
 *  - `ok`: a single match (or no matches with `notFound: true`)
 *  - `ambiguous`: two or more projects share the name. Caller must
 *    disambiguate by id.
 */
export type ProjectByNameResult =
  | { kind: "match"; project: ProjectDef }
  | { kind: "ambiguous"; matches: readonly ProjectDef[] }
  | { kind: "not_found" };

/**
 * Looks up a project by name (case-sensitive exact match). Returns
 * a discriminated union so CLI/MCP callers can produce the right
 * error message for "unknown" vs "ambiguous". Names are not unique
 * — only ids are. The UI shows names; the CLI accepts names with
 * disambiguation errors.
 *
 * Pass `{ includeArchived: true }` to also match archived projects.
 */
export function resolveProjectByName(
  config: ProjectsConfig,
  name: string,
  options: { includeArchived?: boolean } = {},
): ProjectByNameResult {
  const pool = options.includeArchived === true
    ? config.projects
    : config.projects.filter(p => p.archived !== true);
  const matches = pool.filter(p => p.name === name);
  if (matches.length === 0) return { kind: "not_found" };
  if (matches.length === 1) return { kind: "match", project: matches[0] as ProjectDef };
  return { kind: "ambiguous", matches };
}

/**
 * Resolves user input (project name or id) to a project id. Tries id
 * lookup first (UI/agents pass id), then unique-name lookup. Throws
 * ProjectError on miss/ambiguous so callers get a clean domain error.
 */
export function resolveProjectIdFromInput(
  config: ProjectsConfig,
  input: string,
  options: { includeArchived?: boolean } = {},
): string {
  // Direct id match (fast path)
  const byId = config.projects.find(p => p.id === input
    && (options.includeArchived === true || p.archived !== true));
  if (byId) return byId.id;

  // Slug next, ahead of name: it is the handle URLs and the CLI carry,
  // it is unique where names are not, and it is immutable where names
  // are not (K3). A name that happens to equal another project's slug
  // therefore loses — the unambiguous identifier wins.
  const bySlug = config.projects.find(p => p.slug === input
    && (options.includeArchived === true || p.archived !== true));
  if (bySlug) return bySlug.id;

  const byName = resolveProjectByName(config, input, options);
  if (byName.kind === "match") return byName.project.id;
  if (byName.kind === "ambiguous") {
    const ids = byName.matches.map(p => p.id).join(", ");
    throw new ProjectError(
      `project name '${input}' is ambiguous — matches ${byName.matches.length} projects (${ids}). Pass the id instead.`,
    );
  }
  // An *archived* project exists — saying "unknown" sends the user
  // looking for a typo instead of at the archive, and the recovery is
  // different: unarchive it, or pick another (BLK-46). Named rather
  // than echoed as an id, since the caller may have passed a ULID and
  // P-4 keeps those out of what a surface prints.
  // Case-sensitive on the name, matching `resolveProjectByName` above.
  // A looser comparison here would let an archived "Ops" claim an input
  // that an active "OPS" should have taken.
  const archived = config.projects.find(
    p => p.id === input || p.slug === input || p.name === input,
  );
  if (archived?.archived === true) {
    throw new ProjectError(
      `project "${archived.name}" is archived; unarchive it or pick another`,
    );
  }
  throw new ProjectError(`unknown project: ${input}`);
}

/**
 * Resolves the active project for an operation by walking the
 * default-resolution order: explicit > workspace default > unique
 * single project > error. All resolution values are project ids.
 *
 * Per-user defaults aren't visible to core (they live in user
 * settings), so callers that have a user-default should pass it as
 * `userDefault`. Both `explicit` and `userDefault` may be either a
 * project id or a name — `resolveProjectIdFromInput` is applied.
 */
export function resolveProjectId(
  config: ProjectsConfig,
  options: { explicit?: string; userDefault?: string } = {},
): string {
  if (options.explicit !== undefined) {
    return resolveProjectIdFromInput(config, options.explicit);
  }
  if (options.userDefault !== undefined) {
    try {
      return resolveProjectIdFromInput(config, options.userDefault);
    } catch {
      // Stale user default — fall through to workspace default.
    }
  }
  if (config.default !== undefined) {
    return config.default;
  }
  const active = config.projects.filter(p => p.archived !== true);
  if (active.length === 1) {
    const only = active[0];
    if (only) return only.id;
  }
  throw new ProjectError(
    `no default project configured and multiple projects exist; pass --project explicitly`,
  );
}

/**
 * Convenience over `resolveProjectId` that also picks up the per-user
 * default from `users/<id>/settings.yaml` for the active user. The
 * same chain used by CLI / MCP / web surfaces:
 *
 *   explicit > per-user default > workspace default > sole project
 *
 * If no user is registered, the per-user step is skipped and the
 * chain falls through to the workspace default.
 */
export async function resolveProjectIdForUser(
  locttDir: string,
  explicit?: string,
): Promise<string> {
  const config = await loadProjectsConfig(locttDir);
  const current = await getCurrentUser(locttDir);
  let userDefault: string | undefined;
  if (current) {
    const settings = await loadUserSettings(locttDir, current.id);
    const raw = settings["default_project"];
    if (typeof raw === "string" && raw.length > 0) userDefault = raw;
  }
  return resolveProjectId(config, {
    ...(explicit !== undefined ? { explicit } : {}),
    ...(userDefault !== undefined ? { userDefault } : {}),
  });
}

/** Returns the project definition for an id, or throws. */
export function findProject(config: ProjectsConfig, id: string): ProjectDef {
  const proj = config.projects.find(p => p.id === id);
  if (!proj) throw new ProjectError(`unknown project: ${id}`);
  return proj;
}

/**
 * Input for `createProject`. The caller supplies `name` and `prefix`;
 * core generates the `id` (ULID).
 */
export interface CreateProjectInput {
  readonly name: string;
  readonly prefix: string;
  readonly archived?: boolean;
  /**
   * Explicit slug. Omitted, one is generated from the name. Rejected
   * if malformed or already held by another project (K3).
   */
  readonly slug?: string;
}

/**
 * Creates a new project: generates a ULID, initializes a key counter
 * in state.yaml under the new id, and appends to projects.yaml. State
 * is written first so a crash mid-operation never leaves a project
 * visible without a counter.
 *
 * Retired counters from previously-hard-deleted projects with the
 * same prefix are NOT auto-restored under this code path — ids are
 * unique per creation, so collisions don't apply. Counter recovery
 * for repeated deletion+creation cycles is handled at the prefix
 * level by `next_number`.
 *
 * Returns the created project (including the generated id).
 */
export async function createProject(
  locttDir: string,
  input: CreateProjectInput,
): Promise<ProjectDef> {
  return withStateLock(locttDir, async () => {
    const config = await loadProjectsConfig(locttDir);

    if (config.projects.some(p => p.prefix === input.prefix)) {
      throw new ProjectError(
        `project with prefix '${input.prefix}' already exists — prefixes must be unique`,
      );
    }

    // An explicitly-requested slug is validated and must be free: only
    // a *generated* one may be suffixed to dodge a collision, because
    // silently handing back `web-2` to a caller that asked for `web`
    // would put a different URL in their hands than the one they chose.
    if (input.slug !== undefined) {
      if (!isValidSlug(input.slug)) {
        throw new ProjectError(
          `invalid project slug '${input.slug}' — must start with a letter and `
          + `contain only lowercase letters, digits, hyphen, or underscore`,
        );
      }
      const clash = config.projects.find(p => p.slug === input.slug);
      if (clash) {
        throw new ProjectError(
          `project slug '${input.slug}' is already used by project "${clash.name}" `
          + `— slugs must be unique`,
        );
      }
    }
    const slug = allocateSlug(config.projects, input.name, input.slug);

    // Generate the id up front so we can use it as the state.keys key
    // before the projects.yaml write.
    const id = ulid();
    const def: ProjectDef = {
      id,
      name: input.name,
      ...(slug !== undefined ? { slug } : {}),
      prefix: input.prefix,
      ...(input.archived === true ? { archived: true } : {}),
    };

    // 1. Write state first (counter under the new id).
    const state = await loadState(locttDir);
    try {
      initKeyAllocation(state, id, input.prefix, 1);
    } catch (err) {
      if (err instanceof KeyAllocationError) {
        // Collision on a freshly-generated ULID is essentially impossible
        // (entropy >= 80 bits), but if it ever happens, surface it.
        throw new ProjectError(
          `internal: state.keys already has an entry for generated id '${id}' — retry`,
        );
      }
      throw err;
    }
    await saveState(locttDir, state);

    // 2. Then append to projects.yaml.
    const newConfig: ProjectsConfig = {
      projects: [...config.projects, def],
      ...(config.default !== undefined ? { default: config.default } : {}),
    };
    await saveProjectsConfig(locttDir, newConfig);

    return def;
  });
}

/**
 * Edits an existing project's name.
 *
 * `id` is immutable — tasks reference it. `prefix` is excluded here not
 * because it cannot change, but because changing it is not a config edit:
 * the prefix is duplicated into `state.yaml`'s counter and into every
 * task's `key`, so a rewrite of all three has to happen as one
 * transaction. {@link setProjectPrefix} does that.
 */
export async function editProject(
  locttDir: string,
  id: string,
  changes: { name?: string },
): Promise<void> {
  await withStateLock(locttDir, async () => {
    const config = await loadProjectsConfig(locttDir);
    const idx = config.projects.findIndex(p => p.id === id);
    if (idx === -1) throw new ProjectError(`unknown project: ${id}`);

    if (changes.name === undefined) return; // nothing to do

    const existing = config.projects[idx];
    if (!existing) throw new ProjectError(`unknown project: ${id}`);
    const updated: ProjectDef = {
      ...existing,
      name: changes.name,
    };
    const newProjects = [...config.projects];
    newProjects[idx] = updated;
    await saveProjectsConfig(locttDir, {
      projects: newProjects,
      ...(config.default !== undefined ? { default: config.default } : {}),
    });
  });
}

/**
 * Sets (or clears, with `null`) the workspace default project.
 * `id` may be a project id or a name; names are resolved through
 * `resolveProjectIdFromInput`.
 */
export async function setDefaultProject(
  locttDir: string,
  id: string | null,
): Promise<void> {
  await withStateLock(locttDir, async () => {
    const config = await loadProjectsConfig(locttDir);
    let resolved: string | null = null;
    if (id !== null) {
      resolved = resolveProjectIdFromInput(config, id);
    }
    const newConfig: ProjectsConfig = resolved === null
      ? { projects: config.projects }
      : { projects: config.projects, default: resolved };
    await saveProjectsConfig(locttDir, newConfig);
  });
}

/** Marks a project as archived. No-op when already archived. */
export async function archiveProject(locttDir: string, id: string): Promise<void> {
  await withStateLock(locttDir, async () => {
    const config = await loadProjectsConfig(locttDir);
    const idx = config.projects.findIndex(p => p.id === id);
    if (idx === -1) throw new ProjectError(`unknown project: ${id}`);
    const existing = config.projects[idx];
    if (!existing) throw new ProjectError(`unknown project: ${id}`);
    if (existing.archived === true) return;
    const next = [...config.projects];
    next[idx] = { ...existing, archived: true };
    const newConfig: ProjectsConfig = {
      projects: next,
      ...(config.default !== undefined && config.default !== id
        ? { default: config.default }
        : {}),
    };
    await saveProjectsConfig(locttDir, newConfig);
  });
}

/** Clears the archived flag on a project. */
export async function unarchiveProject(locttDir: string, id: string): Promise<void> {
  await withStateLock(locttDir, async () => {
    const config = await loadProjectsConfig(locttDir);
    const idx = config.projects.findIndex(p => p.id === id);
    if (idx === -1) throw new ProjectError(`unknown project: ${id}`);
    const existing = config.projects[idx];
    if (!existing) throw new ProjectError(`unknown project: ${id}`);
    if (existing.archived !== true) return;
    const cleared: ProjectDef = {
      id: existing.id,
      name: existing.name,
      prefix: existing.prefix,
    };
    const next = [...config.projects];
    next[idx] = cleared;
    await saveProjectsConfig(locttDir, {
      projects: next,
      ...(config.default !== undefined ? { default: config.default } : {}),
    });
  });
}

export interface DeleteProjectOptions {
  /**
   * If true, hard-delete the project: rewrites task references to
   * `remapTo` (required when tasks exist), removes the project from
   * projects.yaml, and moves the counter to `LocttState.retired_keys`.
   * The default is a soft-delete (archive) — the project stays in
   * projects.yaml with `archived: true`.
   */
  readonly hard?: boolean;
  /**
   * Hard-delete only: required when the project has any tasks.
   * Re-targets the affected tasks at another project (by id). Note:
   * this does not rewrite task `key` strings — moving a task across
   * projects keeps its existing key intact. (CW-13 introduces a
   * separate `moveTaskToProject` that reallocates keys.)
   */
  readonly remapTo?: string;
}

/**
 * Deletes a project. Default is soft-delete: sets `archived: true`
 * and clears the workspace default if the project was it. With
 * `hard: true`, rewrites all affected tasks to `remapTo` (required
 * when the project has tasks), then removes the project from
 * projects.yaml and moves the counter to retired_keys.
 */
export async function deleteProject(
  locttDir: string,
  id: string,
  options: DeleteProjectOptions = {},
): Promise<{ remappedTaskCount: number }> {
  if (options.hard !== true) {
    if (options.remapTo !== undefined) {
      throw new ProjectError(`--remap-to only applies to --hard delete`);
    }
    await archiveProject(locttDir, id);
    return { remappedTaskCount: 0 };
  }
  return withStateLock(locttDir, async () => {
    const config = await loadProjectsConfig(locttDir);
    const target = config.projects.find(p => p.id === id);
    if (!target) throw new ProjectError(`unknown project: ${id}`);

    if (config.projects.length === 1) {
      throw new ProjectError(
        `cannot delete the only project; create another project first`,
      );
    }

    const tasks = await loadAllTasks(locttDir);
    const affected = tasks.filter(t => t.frontmatter.project === id);

    let remapTo: string | undefined;
    if (affected.length > 0) {
      if (options.remapTo === undefined) {
        throw new ProjectError(
          `project '${id}' has ${affected.length} task(s); pass remapTo to migrate them to another project`,
        );
      }
      const remapTarget = config.projects.find(p => p.id === options.remapTo);
      if (!remapTarget) {
        throw new ProjectError(`unknown remap target project: ${options.remapTo}`);
      }
      if (options.remapTo === id) {
        throw new ProjectError(`remap target must differ from the project being deleted`);
      }
      if (remapTarget.archived === true) {
        throw new ProjectError(
          `remap target project '${options.remapTo}' is archived; unarchive it first or pick an active project`,
        );
      }
      remapTo = options.remapTo;
    }

    // Journal-then-apply: write a recovery entry describing the
    // entire op BEFORE touching any task or config. If the process
    // crashes anywhere below, the next critical section's recovery
    // hook replays this same handler and re-applies whatever wasn't
    // finished. Every step below is idempotent.
    const entry: JournalEntry = {
      id: ulid(),
      kind: "remap_project",
      started_at: new Date().toISOString(),
      from: id,
      to: remapTo ?? id, // unused when no tasks; recovery checks task_ids
      task_ids: affected.map(t => t.frontmatter.id),
    };
    const journal = await loadJournal(locttDir);
    await saveJournal(locttDir, appendJournalEntry(journal, entry));

    if (remapTo !== undefined) {
      await replayTaskRemap(locttDir, entry);
    }

    await applyProjectConfigDeletion(locttDir, id);

    await clearJournalEntry(locttDir, entry.id);

    return { remappedTaskCount: affected.length };
  });
}

/**
 * The config-edit half of `deleteProject`: drop the project from
 * `projects.yaml` and move its counter to `retired_keys` in
 * `state.yaml`. Idempotent — if the project is already gone (a
 * crash mid-op left the journal entry but the config edit had
 * already landed), this is a no-op.
 */
async function applyProjectConfigDeletion(locttDir: string, id: string): Promise<void> {
  const config = await loadProjectsConfig(locttDir);
  if (!config.projects.some(p => p.id === id)) {
    // Project is already gone from projects.yaml — either a recovery
    // replay after the config write succeeded but the journal-clear
    // didn't, or a human edit between the journal write and replay.
    const state = await loadState(locttDir);
    if (state.keys[id] === undefined) return;
  }

  const remainingProjects = config.projects.filter(p => p.id !== id);
  const newConfig: ProjectsConfig = {
    projects: remainingProjects,
    ...(config.default !== undefined && config.default !== id
      ? { default: config.default }
      : {}),
  };
  await saveProjectsConfig(locttDir, newConfig);

  // Move the project's counter to retired_keys. Re-creating the same
  // prefix later won't restore numbering automatically (ids are
  // unique per creation), but retired_keys preserves the high-water
  // mark so an admin recovery script can re-set the counter
  // explicitly if needed.
  const state = await loadState(locttDir);
  const newKeys: Record<string, { prefix: string; next_number: number }> = {};
  for (const [k, v] of Object.entries(state.keys)) {
    if (k !== id) newKeys[k] = v;
  }
  const retired: Record<string, { prefix: string; next_number: number }> = {
    ...(state.retired_keys ?? {}),
  };
  const removed = state.keys[id];
  if (removed !== undefined) {
    retired[id] = { prefix: removed.prefix, next_number: removed.next_number };
  }
  const newState: LocttState = {
    keys: newKeys,
    ...(Object.keys(retired).length > 0 ? { retired_keys: retired } : {}),
  };
  await saveState(locttDir, newState);
}

// Register a crash-recovery handler that runs the same steps the
// happy-path code does, in the same order, but each idempotently.
registerRecoveryHandler("remap_project", async (locttDir, entry) => {
  if (entry.kind !== "remap_project") return; // narrow the union
  await replayTaskRemap(locttDir, entry);
  await applyProjectConfigDeletion(locttDir, entry.from);
  await clearJournalEntry(locttDir, entry.id);
});
