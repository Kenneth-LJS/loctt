import type { LocttState, ProjectDef, ProjectsConfig } from "@loctt/contracts";
import { ulid } from "ulid";

import {
  loadProjectsConfig,
  saveProjectsConfig,
} from "../config/projects.js";
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

export class ProjectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectError";
  }
}

/**
 * Resolves the active project for an operation by walking the
 * default-resolution order: explicit > workspace default > unique
 * single project > error.
 *
 * Per-user defaults aren't visible to core (they live in user
 * settings), so callers that have a user-default should pass it as
 * `userDefault`.
 */
export function resolveProjectKey(
  config: ProjectsConfig,
  options: { explicit?: string; userDefault?: string } = {},
): string {
  if (options.explicit !== undefined) {
    if (!config.projects.some(p => p.key === options.explicit)) {
      throw new ProjectError(`unknown project: ${options.explicit}`);
    }
    return options.explicit;
  }
  if (options.userDefault !== undefined) {
    if (config.projects.some(p => p.key === options.userDefault)) {
      return options.userDefault;
    }
    // Stale user default — fall through to workspace default.
  }
  if (config.default !== undefined) {
    return config.default;
  }
  if (config.projects.length === 1) {
    const only = config.projects[0];
    if (only) return only.key;
  }
  throw new ProjectError(
    `no default project configured and multiple projects exist; pass --project explicitly`,
  );
}

/**
 * Convenience over `resolveProjectKey` that also picks up the
 * per-user default from `users/<id>/settings.yaml` for the active
 * user. The same chain used by CLI / MCP / web surfaces:
 *
 *   explicit > per-user default > workspace default > sole project
 *
 * If no user is registered, the per-user step is skipped and the
 * chain falls through to the workspace default.
 */
export async function resolveProjectKeyForUser(
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
  return resolveProjectKey(config, {
    ...(explicit !== undefined ? { explicit } : {}),
    ...(userDefault !== undefined ? { userDefault } : {}),
  });
}

/** Returns the project definition for a key, or throws. */
export function findProject(config: ProjectsConfig, key: string): ProjectDef {
  const proj = config.projects.find(p => p.key === key);
  if (!proj) throw new ProjectError(`unknown project: ${key}`);
  return proj;
}

/**
 * Creates a new project: initializes a key counter in state.yaml and
 * appends to projects.yaml. State is written first so a crash mid-
 * operation never leaves a project visible without a counter.
 *
 * If the requested key matches a previously-deleted project, its
 * retired counter is restored — re-creating the project resumes
 * numbering from where it left off, avoiding collisions with tasks
 * still carrying the old keys.
 */
export async function createProject(
  locttDir: string,
  def: ProjectDef,
): Promise<void> {
  await withStateLock(locttDir, async () => {
    const config = await loadProjectsConfig(locttDir);

    if (config.projects.some(p => p.key === def.key)) {
      throw new ProjectError(`project with key '${def.key}' already exists`);
    }
    if (config.projects.some(p => p.prefix === def.prefix)) {
      throw new ProjectError(
        `project with prefix '${def.prefix}' already exists — prefixes must be unique`,
      );
    }

    // 1. Write state first.
    const state = await loadState(locttDir);
    const retired = state.retired_keys?.[def.key];
    if (retired !== undefined) {
      // Restore the retired counter. Prefix may have changed between
      // the original project and the recreation; honor the new
      // prefix but keep the next_number so we never reuse old keys.
      state.keys[def.key] = {
        prefix: def.prefix,
        next_number: retired.next_number,
      };
      const remainingRetired: Record<string, { prefix: string; next_number: number }> = {};
      for (const [k, v] of Object.entries(state.retired_keys ?? {})) {
        if (k !== def.key) remainingRetired[k] = v;
      }
      if (Object.keys(remainingRetired).length > 0) {
        state.retired_keys = remainingRetired;
      } else {
        delete state.retired_keys;
      }
    } else {
      try {
        initKeyAllocation(state, def.key, def.prefix, 1);
      } catch (err) {
        if (err instanceof KeyAllocationError) {
          // A counter for this key already exists in state — most
          // likely a partial write from a prior `createProject`
          // that crashed between saveState and saveProjectsConfig.
          // Recovery is fine *if* the existing counter's prefix
          // matches the new project's prefix; otherwise the user
          // has changed the prefix on a name collision and silently
          // resuming would mint keys under the wrong prefix.
          const existing = state.keys[def.key];
          if (existing && existing.prefix !== def.prefix) {
            throw new ProjectError(
              `cannot create project '${def.key}' with prefix '${def.prefix}': ` +
              `a counter for this key already exists with prefix '${existing.prefix}'. ` +
              `If this is a partial-write recovery, retry with the original prefix.`,
            );
          }
          // Prefix matches: safe to continue, the counter survives.
        } else {
          throw err;
        }
      }
    }
    await saveState(locttDir, state);

    // 2. Then append to projects.yaml.
    const newConfig: ProjectsConfig = {
      projects: [...config.projects, def],
      ...(config.default !== undefined ? { default: config.default } : {}),
    };
    await saveProjectsConfig(locttDir, newConfig);
  });
}

/**
 * Edits an existing project. Only `label` is mutable. Attempting to
 * change `key` or `prefix` is an error.
 */
export async function editProject(
  locttDir: string,
  key: string,
  changes: { label?: string },
): Promise<void> {
  await withStateLock(locttDir, async () => {
    const config = await loadProjectsConfig(locttDir);
    const idx = config.projects.findIndex(p => p.key === key);
    if (idx === -1) throw new ProjectError(`unknown project: ${key}`);

    if (changes.label === undefined) return; // nothing to do

    const existing = config.projects[idx];
    if (!existing) throw new ProjectError(`unknown project: ${key}`);
    const updated: ProjectDef = {
      ...existing,
      label: changes.label,
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
 */
export async function setDefaultProject(
  locttDir: string,
  key: string | null,
): Promise<void> {
  await withStateLock(locttDir, async () => {
    const config = await loadProjectsConfig(locttDir);
    if (key !== null && !config.projects.some(p => p.key === key)) {
      throw new ProjectError(`unknown project: ${key}`);
    }
    const newConfig: ProjectsConfig = key === null
      ? { projects: config.projects }
      : { projects: config.projects, default: key };
    await saveProjectsConfig(locttDir, newConfig);
  });
}

/** Marks a project as archived. No-op when already archived. */
export async function archiveProject(locttDir: string, key: string): Promise<void> {
  await withStateLock(locttDir, async () => {
    const config = await loadProjectsConfig(locttDir);
    const idx = config.projects.findIndex(p => p.key === key);
    if (idx === -1) throw new ProjectError(`unknown project: ${key}`);
    const existing = config.projects[idx];
    if (!existing) throw new ProjectError(`unknown project: ${key}`);
    if (existing.archived === true) return;
    const next = [...config.projects];
    next[idx] = { ...existing, archived: true };
    const newConfig: ProjectsConfig = {
      projects: next,
      // If the archived project was the default, clear the default
      // so future creates don't land in a hidden project.
      ...(config.default !== undefined && config.default !== key
        ? { default: config.default }
        : {}),
    };
    await saveProjectsConfig(locttDir, newConfig);
  });
}

/** Clears the archived flag on a project. */
export async function unarchiveProject(locttDir: string, key: string): Promise<void> {
  await withStateLock(locttDir, async () => {
    const config = await loadProjectsConfig(locttDir);
    const idx = config.projects.findIndex(p => p.key === key);
    if (idx === -1) throw new ProjectError(`unknown project: ${key}`);
    const existing = config.projects[idx];
    if (!existing) throw new ProjectError(`unknown project: ${key}`);
    if (existing.archived !== true) return;
    const cleared: ProjectDef = {
      key: existing.key,
      label: existing.label,
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
   * Re-targets the affected tasks at another project. Note: this
   * does not rewrite task `key` strings — moving a task across
   * projects keeps its existing key intact.
   */
  readonly remapTo?: string;
}

/**
 * Deletes a project. Default is soft-delete: sets `archived: true`
 * and clears the workspace default if the project was it. With
 * `hard: true`, rewrites all affected tasks to `remapTo` (required
 * when the project has tasks), then removes the project from
 * projects.yaml and moves the counter to retired_keys so re-creation
 * resumes numbering.
 */
export async function deleteProject(
  locttDir: string,
  key: string,
  options: DeleteProjectOptions = {},
): Promise<{ remappedTaskCount: number }> {
  if (options.hard !== true) {
    if (options.remapTo !== undefined) {
      throw new ProjectError(`--remap-to only applies to --hard delete`);
    }
    await archiveProject(locttDir, key);
    return { remappedTaskCount: 0 };
  }
  return withStateLock(locttDir, async () => {
    const config = await loadProjectsConfig(locttDir);
    const target = config.projects.find(p => p.key === key);
    if (!target) throw new ProjectError(`unknown project: ${key}`);

    if (config.projects.length === 1) {
      throw new ProjectError(
        `cannot delete the only project; create another project first`,
      );
    }

    const tasks = await loadAllTasks(locttDir);
    const affected = tasks.filter(t => t.frontmatter.project === key);

    let remapTo: string | undefined;
    if (affected.length > 0) {
      if (options.remapTo === undefined) {
        throw new ProjectError(
          `project '${key}' has ${affected.length} task(s); pass remapTo to migrate them to another project`,
        );
      }
      const target = config.projects.find(p => p.key === options.remapTo);
      if (!target) {
        throw new ProjectError(`unknown remap target project: ${options.remapTo}`);
      }
      if (options.remapTo === key) {
        throw new ProjectError(`remap target must differ from the project being deleted`);
      }
      if (target.archived === true) {
        throw new ProjectError(
          `remap target project "${options.remapTo}" is archived; unarchive it first or pick an active project`,
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
      from: key,
      to: remapTo ?? key, // unused when no tasks; recovery checks task_ids
      task_ids: affected.map(t => t.frontmatter.id),
    };
    const journal = await loadJournal(locttDir);
    await saveJournal(locttDir, appendJournalEntry(journal, entry));

    if (remapTo !== undefined) {
      await replayTaskRemap(locttDir, entry);
    }

    await applyProjectConfigDeletion(locttDir, key);

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
 *
 * Extracted as a top-level helper because the recovery handler
 * (registered below) re-uses it during crash replay.
 */
async function applyProjectConfigDeletion(locttDir: string, key: string): Promise<void> {
  const config = await loadProjectsConfig(locttDir);
  if (!config.projects.some(p => p.key === key)) {
    // Project is already gone from projects.yaml — either a recovery
    // replay after the config write succeeded but the journal-clear
    // didn't, or a human edit between the journal write and replay.
    // We still need to check state.keys: the counter migration is a
    // separate write below, so the previous run may have crashed
    // between the projects.yaml save and the state.yaml save. If
    // both sides are already done, fully no-op; otherwise fall
    // through and the counter-migration block below will complete.
    const state = await loadState(locttDir);
    if (state.keys[key] === undefined) return;
    // Fall through with config unchanged; the saveProjectsConfig
    // below is a no-op rewrite of the same content, which the
    // atomic-yaml writer collapses to a stable file.
  }

  const remainingProjects = config.projects.filter(p => p.key !== key);
  const newConfig: ProjectsConfig = {
    projects: remainingProjects,
    ...(config.default !== undefined && config.default !== key
      ? { default: config.default }
      : {}),
  };
  await saveProjectsConfig(locttDir, newConfig);

  // Move the project's counter to retired_keys. Re-creating the
  // same project later resumes numbering from this point so we
  // never reuse keys that surviving tasks may still reference.
  const state = await loadState(locttDir);
  const newKeys: Record<string, { prefix: string; next_number: number }> = {};
  for (const [k, v] of Object.entries(state.keys)) {
    if (k !== key) newKeys[k] = v;
  }
  const retired: Record<string, { prefix: string; next_number: number }> = {
    ...(state.retired_keys ?? {}),
  };
  const removed = state.keys[key];
  if (removed !== undefined) {
    retired[key] = { prefix: removed.prefix, next_number: removed.next_number };
  }
  const newState: LocttState = {
    keys: newKeys,
    ...(Object.keys(retired).length > 0 ? { retired_keys: retired } : {}),
  };
  await saveState(locttDir, newState);
}

// Register a crash-recovery handler that runs the same steps the
// happy-path code does, in the same order, but each idempotently.
// Fired by `withStateLock`'s recovery hook for any pending
// `remap_project` entry. Idempotent because:
//   - replayTaskRemap skips tasks already at the new project,
//   - applyProjectConfigDeletion no-ops when the project is gone.
registerRecoveryHandler("remap_project", async (locttDir, entry) => {
  if (entry.kind !== "remap_project") return; // narrow the union
  await replayTaskRemap(locttDir, entry);
  await applyProjectConfigDeletion(locttDir, entry.from);
  await clearJournalEntry(locttDir, entry.id);
});
