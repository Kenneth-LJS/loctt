import type {
  LabelsConfig,
  MilestonesConfig,
  ProjectsConfig,
  SprintsConfig,
  TaskFrontmatter,
  UserProfile,
} from "@loctt/contracts";

import { loadAllUsers } from "../users/profile.js";
import { loadLabelsConfig } from "./labels.js";
import { loadMilestonesConfig } from "./milestones.js";
import { loadProjectsConfig } from "./projects.js";
import { loadSprintsConfig } from "./sprints.js";

/**
 * Aux configs needed to detect archived references at write time.
 * Mirrors the validation.AuxConfigs shape but adds `users` because
 * assignee/reporter validation lives in the per-user profiles, not
 * in a single sibling config.
 */
export interface ArchivedGuardConfigs {
  readonly projects?: ProjectsConfig;
  readonly labels?: LabelsConfig;
  readonly milestones?: MilestonesConfig;
  readonly sprints?: SprintsConfig;
  readonly users?: ReadonlyArray<UserProfile>;
}

export class ArchivedReferenceError extends Error {
  readonly name = "ArchivedReferenceError" as const;
  constructor(message: string) {
    super(message);
  }
}

/**
 * Best-effort loader for the aux configs the archived guard needs.
 * Missing config slices are treated as "nothing to block against"
 * rather than as errors — a fresh tracker hasn't created the
 * sibling configs yet, but should still be able to create tasks.
 * Centralized so CLI/MCP/HTTP all enforce identical policy.
 */
export async function loadArchivedGuardConfigs(
  locttDir: string,
): Promise<ArchivedGuardConfigs> {
  const projects = await loadProjectsConfig(locttDir);
  let labels: Awaited<ReturnType<typeof loadLabelsConfig>> | undefined;
  let milestones: Awaited<ReturnType<typeof loadMilestonesConfig>> | undefined;
  let sprints: Awaited<ReturnType<typeof loadSprintsConfig>> | undefined;
  try { labels = await loadLabelsConfig(locttDir); } catch { /* ok */ }
  try { milestones = await loadMilestonesConfig(locttDir); } catch { /* ok */ }
  try { sprints = await loadSprintsConfig(locttDir); } catch { /* ok */ }
  const users = await loadAllUsers(locttDir);
  return {
    projects,
    ...(labels !== undefined ? { labels } : {}),
    ...(milestones !== undefined ? { milestones } : {}),
    ...(sprints !== undefined ? { sprints } : {}),
    users,
  };
}

/**
 * Returns the set of entity keys (or user IDs) that are currently
 * archived in the given aux configs. Empty set if the config slice
 * is absent.
 */
function archivedKeys(
  defs: ReadonlyArray<{ readonly key: string; readonly archived?: boolean | undefined }> | undefined,
): ReadonlySet<string> {
  if (!defs) return new Set();
  const out = new Set<string>();
  for (const d of defs) {
    if (d.archived === true) out.add(d.key);
  }
  return out;
}

/** Like archivedKeys but for projects, which identify by `id`. */
function archivedProjectIds(
  defs: ReadonlyArray<{ readonly id: string; readonly archived?: boolean | undefined }> | undefined,
): ReadonlySet<string> {
  if (!defs) return new Set();
  const out = new Set<string>();
  for (const d of defs) {
    if (d.archived === true) out.add(d.id);
  }
  return out;
}

function archivedUserIds(
  users: ReadonlyArray<UserProfile> | undefined,
): ReadonlySet<string> {
  if (!users) return new Set();
  const out = new Set<string>();
  for (const u of users) {
    if (u.archived === true) out.add(u.id);
  }
  return out;
}

/**
 * Throws ArchivedReferenceError if `fm` introduces a reference to an
 * archived entity that wasn't already present on `prev`. Existing
 * references that happen to be archived are preserved silently — the
 * point of archiving is to keep historical pointers valid while
 * blocking *new* uses.
 *
 * `prev = undefined` means "all references in fm are new" — the
 * createTask case.
 *
 * Checks: project, milestone, sprint, labels (per-item), assignee,
 * reporter. Relationships are task-to-task and handled separately
 * (see assertNotArchivedRelationshipTarget).
 *
 * Each aux config slice is optional; a missing slice means "skip
 * archived check for that field." Callers should pass whatever they
 * have loaded.
 */
export function assertNotArchivedReferences(
  fm: TaskFrontmatter,
  prev: TaskFrontmatter | undefined,
  aux: ArchivedGuardConfigs,
): void {
  const errors: string[] = [];

  // Scalar fields: report when the new value points at an archived
  // entity AND the value changed (or is set for the first time).
  const scalar: ReadonlyArray<{
    field: "project" | "milestone" | "sprint" | "assignee" | "reporter";
    archived: ReadonlySet<string>;
    kindLabel: string;
  }> = [
    { field: "project", archived: archivedProjectIds(aux.projects?.projects), kindLabel: "project" },
    { field: "milestone", archived: archivedKeys(aux.milestones?.milestones), kindLabel: "milestone" },
    { field: "sprint", archived: archivedKeys(aux.sprints?.sprints), kindLabel: "sprint" },
    { field: "assignee", archived: archivedUserIds(aux.users), kindLabel: "user" },
    { field: "reporter", archived: archivedUserIds(aux.users), kindLabel: "user" },
  ];

  for (const { field, archived, kindLabel } of scalar) {
    const next = fm[field];
    if (typeof next !== "string") continue;
    const prior = prev?.[field];
    if (prior === next) continue;
    if (archived.has(next)) {
      errors.push(
        `cannot assign archived ${kindLabel} "${next}" to ${field}; unarchive it first`,
      );
    }
  }

  // Labels: an array. Block newly-added labels that are archived,
  // tolerate ones that were already present.
  if (fm.labels !== undefined) {
    const archived = archivedKeys(aux.labels?.labels);
    const prior = new Set(prev?.labels ?? []);
    for (const k of fm.labels) {
      if (prior.has(k)) continue;
      if (archived.has(k)) {
        errors.push(
          `cannot attach archived label "${k}"; unarchive it first`,
        );
      }
    }
  }

  if (errors.length > 0) {
    throw new ArchivedReferenceError(errors.join("; "));
  }
}

/**
 * Throws when linking to a task whose `archived` flag is true and the
 * link is new (i.e. not already present on the source task). Used by
 * linkTask. Returns silently when the target task is live.
 */
export function assertNotArchivedRelationshipTarget(
  targetFm: TaskFrontmatter,
  alreadyLinkedKeys: ReadonlySet<string>,
): void {
  if (targetFm.archived !== true) return;
  // We pass the target's id as the linkage marker; if the link is
  // already present we tolerate it (the relationship pre-dates the
  // archive). The caller decides what counts as "already linked".
  if (alreadyLinkedKeys.has(targetFm.id)) return;
  throw new ArchivedReferenceError(
    `cannot link to archived task ${targetFm.key}; unarchive it first`,
  );
}
