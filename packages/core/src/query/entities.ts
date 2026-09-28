import { isIdShaped } from "@loctt/contracts";

import { loadLabelsConfig } from "../config/labels.js";
import { loadMilestonesConfig } from "../config/milestones.js";
import { loadProjectsConfig } from "../config/projects.js";
import { loadSprintsConfig } from "../config/sprints.js";
import { loadAllUsers } from "../users/profile.js";
import {
  entityAmbiguousMessage,
  type EntityKind,
  entityNotFoundMessage,
  matchEntityRef,
  type NamedEntity,
} from "../utils/entity-ref.js";
import type { QueryNode, QueryValue } from "./parser.js";
import { QueryValidationError } from "./validate.js";

/**
 * The entities a query may name, loaded once per list call (K148).
 * A kind whose file could not be read is absent: its names are then
 * left as written (and match nothing), rather than refused as unknown
 * when the real cause is the unreadable file.
 */
export interface EntityDirectory {
  readonly label?: readonly NamedEntity[];
  readonly user?: readonly NamedEntity[];
  readonly milestone?: readonly NamedEntity[];
  readonly sprint?: readonly NamedEntity[];
  readonly project?: readonly NamedEntity[];
}

/** Which entity each queryable reference field holds. */
const FIELD_KIND: Readonly<Record<string, EntityKind>> = {
  labels: "label",
  assignee: "user",
  reporter: "user",
  comment_mentions: "user",
  milestone: "milestone",
  sprint: "sprint",
  project: "project",
};

/** The operators that compare a reference field with a value. */
const RESOLVED_OPS = new Set(["=", "!=", "in", "not in"]);

async function tolerant<T>(load: () => Promise<T>): Promise<T | undefined> {
  try {
    return await load();
  } catch {
    return undefined;
  }
}

/** Loads every kind a query can name, each independently of the others. */
export async function loadEntityDirectory(locttDir: string): Promise<EntityDirectory> {
  const [labels, users, milestones, sprints, projects] = await Promise.all([
    tolerant(async () => (await loadLabelsConfig(locttDir)).labels),
    tolerant(async () => loadAllUsers(locttDir)),
    tolerant(async () => (await loadMilestonesConfig(locttDir)).milestones),
    tolerant(async () => (await loadSprintsConfig(locttDir)).sprints),
    tolerant(async () => (await loadProjectsConfig(locttDir)).projects),
  ]);
  return {
    ...(labels !== undefined ? { label: labels } : {}),
    ...(users !== undefined ? { user: users } : {}),
    ...(milestones !== undefined ? { milestone: milestones } : {}),
    ...(sprints !== undefined ? { sprint: sprints } : {}),
    ...(projects !== undefined ? { project: projects } : {}),
  };
}

/**
 * Rewrites names in a query to the IDs the tasks store (K148), so
 * `labels = urgent` matches the tasks labelled "urgent" instead of
 * nothing. An ID-shaped value is an ID and is left alone (a task may
 * still hold the ID of an entity since deleted). A name matching several
 * entities, or none, is refused with the same sentence the write paths
 * use, at the comparison's position.
 *
 * Pure: returns a new AST and never mutates `node`.
 */
export function resolveQueryEntities(node: QueryNode, directory: EntityDirectory): QueryNode {
  switch (node.type) {
    case "and":
    case "or":
      return {
        ...node,
        left: resolveQueryEntities(node.left, directory),
        right: resolveQueryEntities(node.right, directory),
      };
    case "not":
      return { ...node, operand: resolveQueryEntities(node.operand, directory) };
    case "has_link":
      return node;
    case "comparison": {
      if (node.call !== undefined || !RESOLVED_OPS.has(node.op)) return node;
      const kind = FIELD_KIND[node.field];
      if (kind === undefined) return node;
      const entities = directory[kind];
      if (entities === undefined) return node;
      const position = node.position ?? 0;
      return { ...node, value: resolveValue(node.value, kind, entities, position) };
    }
  }
}

function resolveValue(
  value: QueryValue,
  kind: EntityKind,
  entities: readonly NamedEntity[],
  position: number,
): QueryValue {
  if (value.type === "list") {
    return { type: "list", values: value.values.map(v => resolveValue(v, kind, entities, position)) };
  }
  if (value.type !== "string" || isIdShaped(value.value)) return value;
  const found = matchEntityRef(entities, value.value, {
    includeArchived: true,
    prefix: kind === "user",
  });
  if (found.kind === "match") return { type: "string", value: found.entity.id };
  // QueryValidationError appends " at position N", so the sentence's
  // own full stop goes.
  if (found.kind === "ambiguous") {
    throw new QueryValidationError(
      entityAmbiguousMessage(kind, value.value, found.matches).replace(/\.$/, ""), position);
  }
  throw new QueryValidationError(entityNotFoundMessage(kind, value.value).replace(/\.$/, ""), position);
}
