/**
 * K148: MCP results return both the ID and the name of every entity a
 * result refers to. Storage holds IDs, and an agent reading only an ID
 * has to make another call to learn what it is; reading only a name, it
 * cannot tell two entities with one name apart. The additions are new
 * sibling fields (`assignee_name`, `label_names`, …), so every existing
 * field keeps its shape.
 */

import { type EntityDirectory, loadEntityDirectory } from "@loctt/core";

export type EntityNames = Readonly<Record<keyof EntityDirectory, ReadonlyMap<string, string>>>;

/** id → name for each kind; a kind that could not be read is empty. */
export async function loadEntityNames(locttDir: string): Promise<EntityNames> {
  const dir = await loadEntityDirectory(locttDir);
  const map = (list: EntityDirectory[keyof EntityDirectory]): ReadonlyMap<string, string> =>
    new Map((list ?? []).flatMap(e => (e.name !== undefined ? [[e.id, e.name] as const] : [])));
  return {
    label: map(dir.label),
    user: map(dir.user),
    milestone: map(dir.milestone),
    sprint: map(dir.sprint),
    project: map(dir.project),
  };
}

/** The task fields that hold one entity id, and the kind each names. */
const SCALAR_REFS = [
  ["project", "project"],
  ["assignee", "user"],
  ["reporter", "user"],
  ["milestone", "milestone"],
  ["sprint", "sprint"],
] as const;

/**
 * The `*_name` siblings for a task's references: `project_name`,
 * `assignee_name`, `reporter_name`, `milestone_name`, `sprint_name`, and
 * `label_names` in the order of `labels`. A reference to an entity that
 * no longer exists gets no name (and `label_names` holds null for it),
 * so the absence is visible rather than papered over with the id.
 */
export function taskReferenceNames(
  fm: Readonly<Record<string, unknown>>,
  names: EntityNames,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [field, kind] of SCALAR_REFS) {
    const id = fm[field];
    if (typeof id !== "string") continue;
    const name = names[kind].get(id);
    if (name !== undefined) out[`${field}_name`] = name;
  }
  const labels = fm["labels"];
  if (Array.isArray(labels) && labels.length > 0) {
    out["label_names"] = labels.map(l => (typeof l === "string" ? names.label.get(l) ?? null : null));
  }
  return out;
}

/** The kind each history field or entry names, for `get_task_history`. */
const HISTORY_FIELD_KIND: Readonly<Record<string, keyof EntityNames>> = {
  project: "project",
  assignee: "user",
  reporter: "user",
  milestone: "milestone",
  sprint: "sprint",
};

/**
 * Adds `actor_name`, and `before_name` / `after_name` for a change to a
 * field that holds an entity id (including `label_added` /
 * `label_removed`), to one history entry.
 */
export function historyEntryNames(
  entry: Readonly<Record<string, unknown>>,
  names: EntityNames,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...entry };
  const actor = entry["actor"];
  if (typeof actor === "string") {
    const n = names.user.get(actor);
    if (n !== undefined) out["actor_name"] = n;
  }
  const kind = entry["kind"] === "label_added" || entry["kind"] === "label_removed"
    ? "label"
    : entry["kind"] === "field_change" && typeof entry["field"] === "string"
      ? HISTORY_FIELD_KIND[entry["field"]]
      : undefined;
  if (kind !== undefined) {
    for (const side of ["before", "after"] as const) {
      const v = entry[side];
      if (typeof v !== "string") continue;
      const n = names[kind].get(v);
      if (n !== undefined) out[`${side}_name`] = n;
    }
  }
  return out;
}

/** `name (id)`, or the id alone when the name is unknown. */
export function named(name: string | undefined, id: string): string {
  return name !== undefined ? `${name} (${id})` : id;
}
