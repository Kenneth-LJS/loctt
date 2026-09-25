import type {
  LabelsConfig,
  MilestonesConfig,
  ProjectsConfig,
  SprintsConfig,
  TaskFrontmatter,
  UserProfile,
} from "@loctt/contracts";

import type { LocttErrorOptions } from "../errors.js";
import { LocttError } from "../errors.js";
import { loadAllUsersDetailed } from "../users/profile.js";
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
/** The frontmatter fields the guard checks. */
export type ArchivedGuardField =
  | "project"
  | "milestone"
  | "sprint"
  | "assignee"
  | "reporter"
  | "labels";

/**
 * A slice the guard needs and could not read, so it cannot say whether
 * references in that field are archived.
 */
export interface UnreadableSlice {
  readonly field: ArchivedGuardField;
  readonly reason: string;
}

export interface ArchivedGuardConfigs {
  readonly projects?: ProjectsConfig;
  readonly labels?: LabelsConfig;
  readonly milestones?: MilestonesConfig;
  readonly sprints?: SprintsConfig;
  readonly users?: ReadonlyArray<UserProfile>;
  /**
   * Slices that could not be read. Empty or absent means every answer
   * below is authoritative; non-empty means the guard must refuse for
   * the named fields rather than treat "not in the archived set" as
   * "not archived" (V7).
   */
  readonly unreadable?: ReadonlyArray<UnreadableSlice>;
}

export class ArchivedReferenceError extends LocttError {
  /**
   * Its own code, not `validation_failed`. The web used to infer the
   * code from the HTTP status, so this arrived as a 400 and became
   * `validation_failed` — indistinguishable from a bad enum value, when
   * the recovery is entirely different: unarchive the entity, or pick
   * another one.
   */
  constructor(message: string, opts: LocttErrorOptions = {}) {
    super("archived_reference", message, { dataState: "not_saved", ...opts });
    this.name = "ArchivedReferenceError";
  }
}

/**
 * Loads the aux configs the archived guard needs, recording which
 * slices it could not read.
 *
 * The bug this replaces: three bare catches left the slices undefined,
 * and `archivedIds(undefined)` is an empty set — so a `labels.yaml`
 * LocTT could not read let an archived label attach and report success,
 * on every create and update across all three surfaces. Verified
 * against core 2026-08-17: the guard blocks with the config intact and
 * silently allows when it cannot read it.
 *
 * A slice that is *absent* still means "nothing to block against" — a
 * fresh tracker has no `labels.yaml` and must still create tasks. The
 * loaders already return an empty config for that case, so it never
 * reaches the catch. Anything that does reach it is a file the user
 * has and we could not read, and there the honest answer is that we do
 * not know whether the reference is archived.
 *
 * V7: the guard fails **closed** on that. See
 * {@link assertNotArchivedReferences}.
 */
export async function loadArchivedGuardConfigs(
  locttDir: string,
): Promise<ArchivedGuardConfigs> {
  const projects = await loadProjectsConfig(locttDir);
  let labels: Awaited<ReturnType<typeof loadLabelsConfig>> | undefined;
  let milestones: Awaited<ReturnType<typeof loadMilestonesConfig>> | undefined;
  let sprints: Awaited<ReturnType<typeof loadSprintsConfig>> | undefined;
  const unreadable: UnreadableSlice[] = [];
  const record = (field: ArchivedGuardField, err: unknown): void => {
    unreadable.push({
      field,
      reason: err instanceof Error ? err.message : String(err),
    });
  };
  try { labels = await loadLabelsConfig(locttDir); } catch (err) { record("labels", err); }
  try { milestones = await loadMilestonesConfig(locttDir); } catch (err) { record("milestone", err); }
  try { sprints = await loadSprintsConfig(locttDir); } catch (err) { record("sprint", err); }

  const { profiles: users, unreadable: unreadableUsers } =
    await loadAllUsersDetailed(locttDir);
  for (const u of unreadableUsers) {
    // An unreadable profile drops the user from `archivedUserIds`, so
    // assignee and reporter are both unsafe to answer (V7).
    unreadable.push({ field: "assignee", reason: `${u.path}: ${u.reason}` });
    unreadable.push({ field: "reporter", reason: `${u.path}: ${u.reason}` });
  }

  return {
    projects,
    ...(labels !== undefined ? { labels } : {}),
    ...(milestones !== undefined ? { milestones } : {}),
    ...(sprints !== undefined ? { sprints } : {}),
    users,
    ...(unreadable.length > 0 ? { unreadable } : {}),
  };
}

/** Returns the set of ids currently archived in the given config slice. */
/**
 * A display name for an id, falling back to the id itself.
 *
 * The rejection message used to interpolate the raw id:
 *
 *     cannot assign archived milestone
 *     "01M19KQKWHX80KPY0WQ4B2Z067" to milestone; unarchive it first
 *
 * A ULID is not something the user chose, typed, or can recognise —
 * they picked "v1.0 launch" from a picker. P4 asks the message to name
 * the thing at fault in the user's own terms, and web case NEW-35
 * requires it explicitly ("names the milestone **by its label**").
 * Identity stays the id (P-2); only what is *shown* changes.
 */
function displayNameFor(
  defs: ReadonlyArray<{ readonly id: string; readonly name?: string }> | undefined,
  id: string,
): string {
  const found = defs?.find(d => d.id === id);
  return found?.name !== undefined && found.name !== "" ? found.name : id;
}

function archivedIds(
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
 *
 * `aux.unreadable` inverts that for the fields it names: a slice we
 * could not read means the archived answer is unknown, and the guard
 * refuses a *new* reference rather than allowing one it cannot vouch
 * for (V7). Existing references are untouched, so one damaged file
 * does not freeze the tracker.
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
    /** Definitions for this field's entity kind, to resolve id → name. */
    defs?: ReadonlyArray<{ readonly id: string; readonly name?: string }> | undefined;
  }> = [
    {
      field: "project",
      archived: archivedIds(aux.projects?.projects),
      kindLabel: "project",
      defs: aux.projects?.projects,
    },
    {
      field: "milestone",
      archived: archivedIds(aux.milestones?.milestones),
      kindLabel: "milestone",
      defs: aux.milestones?.milestones,
    },
    {
      field: "sprint",
      archived: archivedIds(aux.sprints?.sprints),
      kindLabel: "sprint",
      defs: aux.sprints?.sprints,
    },
    {
      field: "assignee",
      archived: archivedUserIds(aux.users),
      kindLabel: "user",
      defs: aux.users?.map(u => (u.name !== undefined ? { id: u.id, name: u.name } : { id: u.id })),
    },
    {
      field: "reporter",
      archived: archivedUserIds(aux.users),
      kindLabel: "user",
      defs: aux.users?.map(u => (u.name !== undefined ? { id: u.id, name: u.name } : { id: u.id })),
    },
  ];

  /**
   * The reason the named field's archived-state is unknown, if it is.
   *
   * Checked only where a *new* reference is being introduced: an
   * unreadable `labels.yaml` must not block a status change on a task
   * that already carries labels, or one damaged file makes the whole
   * tracker read-only — which is destruction by another route (P-11).
   */
  const unknownFor = (field: ArchivedGuardField): string | undefined =>
    aux.unreadable?.find(u => u.field === field)?.reason;

  for (const { field, archived, kindLabel, defs } of scalar) {
    const next = fm[field];
    if (typeof next !== "string") continue;
    const prior = prev?.[field];
    if (prior === next) continue;
    const unknown = unknownFor(field);
    if (unknown !== undefined) {
      // Fail closed (V7). "Not in the archived set" and "we could not
      // read the set" are different answers, and only one of them is
      // safe to act on.
      errors.push(
        `Cannot set ${field} to "${next}". Could not determine whether that ${kindLabel} is archived (${unknown}).`,
      );
      continue;
    }
    if (archived.has(next)) {
      // PRU-41: offer *both* next actions, matching the remap-target
      // messages in sprints/labels/projects/users/milestones which
      // already say "unarchive it first or pick an active <kind>". A
      // stale picker that submitted an archived user needs to hear it
      // can either unarchive them or choose someone else — the field
      // has already reverted, so "choose a different" is actionable.
      errors.push(
        `Cannot assign archived ${kindLabel} "${displayNameFor(defs, next)}" `
        + `to ${field}. Unarchive it first, or choose a different ${field}.`,
      );
    }
  }

  // Labels: an array. Block newly-added labels that are archived,
  // tolerate ones that were already present.
  if (fm.labels !== undefined) {
    const archived = archivedIds(aux.labels?.labels);
    const prior = new Set(prev?.labels ?? []);
    const unknown = unknownFor("labels");
    for (const k of fm.labels) {
      if (prior.has(k)) continue;
      if (unknown !== undefined) {
        errors.push(
          `Cannot attach label "${k}". Could not determine whether it is archived (${unknown}).`,
        );
        continue;
      }
      if (archived.has(k)) {
        errors.push(
          `Cannot attach archived label "${k}". Unarchive it first.`,
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
    `Cannot link to archived task ${targetFm.key}. Unarchive it first.`,
  );
}
