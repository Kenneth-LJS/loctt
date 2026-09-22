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
import { assertValidPrefix } from "./prefix.js";
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
 * A hard-delete whose task remap only partly landed (PRU-34).
 *
 * Carries the true split so the surface can say what the user's data
 * looks like *now* rather than reporting a bare failure: `remapped`
 * tasks moved, the tasks in `failedKeys` did not, and the project is
 * still in `projects.yaml` because removing it would strand them.
 *
 * `recovery: retry` because it is genuinely retryable — a remap skips
 * tasks already at the target, so re-running finishes the stragglers
 * rather than double-applying anything.
 */
export class PartialRemapError extends LocttError {
  readonly remapped: number;
  readonly failedKeys: readonly string[];

  /**
   * `noun` names the entity whose delete only partly landed so the
   * message reads correctly for each caller: a label delete says "The
   * label has NOT been deleted", a project delete "The project ...".
   * Defaults to `"project"`, the original (PRU-34) caller, so that call
   * site and its test are unchanged; the label delete (MSL-33) passes
   * `"label"`.
   */
  constructor(remapped: number, failedKeys: readonly string[], noun = "project") {
    const n = failedKeys.length;
    super(
      "conflict",
      `remapped ${String(remapped)} task(s); ${String(n)} could not be written `
      + `(${failedKeys.join(", ")}). The ${noun} has NOT been deleted and those `
      + `tasks still reference it. Retry to finish — tasks already moved are skipped.`,
      // `saved` rather than `not_saved`: those 7 writes really did
      // land, and telling the user nothing was saved would send them
      // looking for tasks that have already moved. There is no
      // `partially_saved` in `ErrorDataState`, so the split lives in
      // the message, which names both halves and the affected keys.
      { dataState: "saved", recovery: { kind: "retry" } },
    );
    this.name = "PartialRemapError";
    this.remapped = remapped;
    this.failedKeys = failedKeys;
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
    // K23 / NEW-20: the schema no longer guarantees the default names a
    // real project — a rename or hand-edit can leave it pointing at
    // nothing. Returning it blindly would file the task into a
    // nonexistent project and consume the wrong key counter (NEW-14's
    // second bullet, not undoable). So a ghost default is ignored here
    // and resolution falls through to the unique-single rung, then to
    // the ask state — exactly NEW-20's first bullet. The drift is
    // surfaced separately (see `projectDefaultIsGhost`); it is not an
    // error at this rung, just an absent answer.
    if (config.projects.some(p => p.id === config.default)) {
      return config.default;
    }
  }
  const active = config.projects.filter(p => p.archived !== true);
  if (active.length === 1) {
    const only = active[0];
    if (only) return only.id;
  }
  // NEW-20 (K75): when the reason we fell through is a GHOST default (it
  // names a project that no longer exists), say so — don't blame the user
  // for "no default configured" when a broken default is the real cause.
  // The message forces an explicit choice AND names the config to repair.
  if (projectDefaultIsGhost(config)) {
    throw new ProjectError(
      `the configured default project "${config.default ?? ""}" no longer exists `
      + `(a rename or hand-edit left projects.yaml pointing at nothing). `
      + `Pass --project explicitly, and repair the default in projects.yaml.`,
    );
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

/**
 * K23 / NEW-20: is the workspace `default:` a stale pointer — a project
 * id that no longer appears in the projects list? A rename or a
 * hand-edit can leave it behind. This is drift, not a parse error (the
 * schema tolerates it), so surfaces call this to decide whether to show
 * a "your default no longer exists" notice while still rendering a
 * healthy projects list. Returns false when there is no default at all,
 * or when the default names a real project (archived or not — an
 * archived default is a different, harder failure the schema rejects).
 */
export function projectDefaultIsGhost(config: ProjectsConfig): boolean {
  return (
    config.default !== undefined &&
    !config.projects.some(p => p.id === config.default)
  );
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
 * **A retired counter for the same prefix is reclaimed** (PRU-18).
 * Hard-deleting a project moves its counter to `state.retired_keys`;
 * re-creating a project on that prefix resumes from where it left off
 * rather than restarting at 1.
 *
 * The match is on **prefix**, not on id or slug. The id is a fresh
 * ULID per creation, so it can never match. The prefix is the thing
 * that actually decides collisions: a key is `<prefix><number>`, so
 * two projects that never shared a prefix cannot mint the same key,
 * and two that do share one can — regardless of what they are called.
 * Restarting at 1 on a reused prefix reissues keys that surviving
 * tasks still answer to through `key_history`, which is precisely
 * what `retired_keys` exists to prevent (`contracts/state.ts`).
 *
 * The reclaimed entry is removed from `retired_keys` — it has moved
 * back under `keys`, and leaving a copy behind would let a second
 * delete/create cycle read a stale, lower high-water mark.
 *
 * Returns the created project (including the generated id).
 */
export async function createProject(
  locttDir: string,
  input: CreateProjectInput,
): Promise<ProjectDef> {
  return withStateLock(locttDir, async () => {
    // K88: the prefix is validated at every creation path, not only at
    // `init` and `setProjectPrefix`. A dash is REJECTED, not stripped —
    // the `-` separator is inserted at key render, so a stored `WEB-`
    // would render as `WEB--1`. This is the shared entry point both the
    // CLI (`project create`) and the web (`handleCreateProject`) funnel
    // through, so validating here covers both surfaces at once. Runs
    // before the uniqueness check: a malformed prefix is the more
    // fundamental error, and a config full of valid prefixes can never
    // collide with an invalid one anyway.
    assertValidPrefix(input.prefix);

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

    // Reclaim a retired counter for this prefix, if one is held. More
    // than one retired project could have used the prefix over the
    // tracker's life, so take the highest — the high-water mark below
    // which some surviving task may still resolve an old key.
    let retiredKeys = state.retired_keys;
    let startNumber = 1;
    if (retiredKeys !== undefined) {
      const matches = Object.entries(retiredKeys)
        .filter(([, v]) => v.prefix === input.prefix);
      if (matches.length > 0) {
        startNumber = Math.max(...matches.map(([, v]) => v.next_number));
        const remaining = Object.fromEntries(
          Object.entries(retiredKeys).filter(([k]) => !matches.some(([m]) => m === k)),
        );
        retiredKeys = Object.keys(remaining).length > 0 ? remaining : undefined;
      }
    }

    try {
      initKeyAllocation(state, id, input.prefix, startNumber);
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
    // Persist the reclaim alongside the new counter: same write, so a
    // crash cannot leave the counter moved but still listed as retired.
    if (retiredKeys !== undefined) {
      state.retired_keys = retiredKeys;
    } else {
      delete state.retired_keys;
    }
    await saveState(locttDir, state);

    // 2. Then append to projects.yaml.
    const newConfig: ProjectsConfig = {
      projects: [...config.projects, def],
      ...(config.default !== undefined ? { default: config.default } : {}),
      ...(config.broken ? { broken: config.broken } : {}),
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
      ...(config.broken ? { broken: config.broken } : {}),
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
      ? { projects: config.projects, ...(config.broken ? { broken: config.broken } : {}) }
      : { projects: config.projects, default: resolved, ...(config.broken ? { broken: config.broken } : {}) };
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
      ...(config.broken ? { broken: config.broken } : {}),
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
      ...(config.broken ? { broken: config.broken } : {}),
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
   * Hard-delete only: required when the project has any tasks (unless
   * `clearProjectField` is set). Re-targets the affected tasks at another
   * project (by id). Note: this does not rewrite task `key` strings —
   * moving a task across projects keeps its existing key intact. (CW-13
   * introduces a separate `moveTaskToProject` that reallocates keys.)
   */
  readonly remapTo?: string;
  /**
   * Hard-delete only: PRU-17's "clear the project field on these tasks"
   * choice — the alternative to `remapTo` when the project has tasks.
   * Each affected task's `project` is cleared (the field is optional), so
   * the tasks survive with no project rather than being remapped. Exactly
   * one of `remapTo` / `clearProjectField` is required when tasks exist;
   * passing both, or neither, is an error (there is no silent default
   * that orphans tasks).
   */
  readonly clearProjectField?: boolean;
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

    // PRU-17: exactly one of remapTo / clearProjectField when tasks exist.
    // `remapTo === null` (as a resolved value below) means "clear".
    let remapTo: string | null | undefined;
    if (affected.length > 0) {
      if (options.remapTo !== undefined && options.clearProjectField === true) {
        throw new ProjectError(
          `pass either remapTo or clearProjectField, not both`,
        );
      }
      if (options.remapTo === undefined && options.clearProjectField !== true) {
        throw new ProjectError(
          `project '${id}' has ${affected.length} task(s); pass remapTo to migrate `
          + `them to another project, or clearProjectField to clear their project`,
        );
      }
      if (options.clearProjectField === true) {
        remapTo = null; // clear the field on each affected task
      } else {
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
      // `to`: the target id, `null` to clear (PRU-17), or the project's
      // own id as a harmless placeholder when there are no tasks (recovery
      // keys off task_ids, so the value is unused then).
      to: remapTo === undefined ? id : remapTo,
      task_ids: affected.map(t => t.frontmatter.id),
    };
    const journal = await loadJournal(locttDir);
    await saveJournal(locttDir, appendJournalEntry(journal, entry));

    if (remapTo !== undefined) {
      const result = await replayTaskRemap(locttDir, entry);
      if (result.failed.length > 0) {
        // PRU-34: do NOT remove the project from projects.yaml while
        // tasks still reference it, and do NOT clear the journal —
        // the entry is what makes a retry (or crash recovery) able to
        // finish the job.
        const keys = result.failed.map(f => f.key ?? f.id);
        throw new PartialRemapError(result.remapped, keys);
      }
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
    ...(config.broken ? { broken: config.broken } : {}),
  };
  await saveProjectsConfig(locttDir, newConfig);

  // Move the project's counter to retired_keys, preserving the
  // high-water mark. Re-creating a project with the same prefix later
  // reclaims this counter (PRU-18, see `createProject`), so key
  // numbering continues past the retired maximum rather than restarting
  // at 1 and colliding with keys still referenced in history.
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
