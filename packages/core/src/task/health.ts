import type { FieldHealth, FieldHealthKind, Task, WorkflowConfig } from "@loctt/contracts";

import type { AuxConfigs } from "../config/validation.js";
import { validateTaskAgainstWorkflow } from "../config/validation.js";
import { LocttError, type LocttErrorOptions } from "../errors.js";
import { userExists } from "../users/profile.js";
import { renderRawText } from "./frontmatter.js";
import { readField } from "./mutable.js";
import { resolveRelationships } from "./show.js";

/**
 * An operation refused because a field it must *read* to compute its
 * result is corrupt (proposal § 3.2 / § 6, "Operation refused").
 *
 * Distinct from `CorruptWriteError` (the write-side guard): this is the
 * derived operation rule — an op that must interpret a structurally
 * broken field stops and warns rather than proceeding over garbage
 * (north-star P7). `field` names the corrupt field so a surface
 * attributes the refusal to it, not to whatever the user was editing.
 */
export class CorruptFieldError extends LocttError {
  constructor(field: string, rawText: string, opts: LocttErrorOptions = {}) {
    super(
      "validation_failed",
      `cannot complete this operation: it must read "${field}", whose stored `
      + `value is corrupt (${rawText || "malformed"}). Set a valid value for `
      + `"${field}", or remove it, then try again.`,
      { dataState: "not_saved", field, ...opts },
    );
    this.name = "CorruptFieldError";
  }
}

/**
 * Maps a `validateTaskAgainstWorkflow` error field to a health kind.
 *
 * Reference fields (a value that must resolve to an entity that exists)
 * are `dangling`; everything else the workflow validator reports is a
 * value the workflow does not define — `invalid_value` (§ 4.6).
 */
function extrinsicKind(field: string): FieldHealthKind {
  const top = field.replace(/[[.].*$/, "");
  const danglingScalars = new Set([
    "project",
    "milestone",
    "sprint",
    "assignee",
    "reporter",
  ]);
  if (danglingScalars.has(top)) return "dangling";
  if (top === "labels") return "dangling"; // labels[i] → unknown label id
  // relationships[i].target is dangling; relationships[i].type is invalid_value.
  if (field.startsWith("relationships") && field.endsWith(".target")) return "dangling";
  return "invalid_value";
}

/** Repair affordance for an extrinsic finding (§ 7.3). All are set_or_remove. */
function extrinsicRepair(): FieldHealth["repair"] {
  return "set_or_remove";
}

/**
 * Reads the raw stored value for an extrinsic finding's field so the
 * finding carries `raw`/`rawText` like an intrinsic one. Indexed paths
 * (`labels[2]`, `relationships[1].target`) read the element; a plain
 * field reads the top-level value.
 */
function rawForField(task: Task, field: string): unknown {
  const idx = /^(\w+)\[(\d+)\](?:\.(\w+))?$/.exec(field);
  if (idx) {
    const [, name, iStr, sub] = idx;
    const arr = readField(task.frontmatter, name as string);
    if (!Array.isArray(arr)) return undefined;
    const el: unknown = (arr as unknown[])[Number(iStr)];
    if (sub !== undefined && el !== null && typeof el === "object") {
      return (el as Record<string, unknown>)[sub];
    }
    return el;
  }
  if (field.startsWith("fields.")) {
    const key = field.slice("fields.".length).replace(/\[\d+\].*$/, "");
    return task.frontmatter.fields?.[key];
  }
  return readField(task.frontmatter, field);
}

/**
 * Extrinsic field-health classification (proposal § 4.6).
 *
 * A thin adapter over the checks that already exist:
 *   - `validateTaskAgainstWorkflow` for enum drift, custom-field
 *     type/declaration, and project/milestone/sprint/label existence
 *     (→ `invalid_value` or `dangling`);
 *   - `resolveRelationships` for relationship edges whose target is gone
 *     (→ `dangling` on `relationships[i].target`);
 *   - `userExists` for `assignee`/`reporter` pointing at a deleted user
 *     (PRU-25 / A123; → `dangling`).
 *
 * Run where the configs are already loaded (`buildShowModel`, the list
 * route, `doctor`) and concatenated onto the intrinsic `task.health` so a
 * surface reads one list. NOT run inside `readTask` — there is no config
 * there — and NOT part of the write guard (which is intrinsic-only).
 *
 * Deduplicates against `task.health` by `(field, kind)` so a field that
 * is already intrinsically corrupt is not double-reported (an
 * intrinsically wrong-typed value is not also validated for workflow
 * membership — it was lifted off `frontmatter`, so the validator never
 * sees it, but this guards the boundary regardless).
 */
export async function classifyTaskHealth(
  locttDir: string,
  task: Task,
  workflow: WorkflowConfig | undefined,
  aux: AuxConfigs = {},
): Promise<FieldHealth[]> {
  const out: FieldHealth[] = [];
  const seen = new Set((task.health ?? []).map(h => `${h.field} ${h.kind}`));

  const push = (field: string, kind: FieldHealthKind, error: string): void => {
    const k = `${field} ${kind}`;
    if (seen.has(k)) return;
    seen.add(k);
    const raw = rawForField(task, field);
    out.push({ field, kind, raw, rawText: renderRawText(raw), error, repair: extrinsicRepair() });
  };

  if (workflow) {
    for (const e of validateTaskAgainstWorkflow(task.frontmatter, workflow, aux)) {
      push(e.field, extrinsicKind(e.field), e.message);
    }
  }

  // Relationship edges whose target task no longer exists (dangling).
  // resolveRelationships already tolerates a missing/unparseable target.
  const rels = task.frontmatter.relationships ?? [];
  if (rels.length > 0) {
    const resolved = await resolveRelationships(locttDir, task);
    resolved.forEach((r, i) => {
      if (r.missing) {
        push(`relationships[${i}].target`, "dangling", `relationship target "${r.target}" does not exist`);
      }
    });
  }

  // assignee / reporter pointing at a deleted user (PRU-25 / A123). The
  // workflow validator does not check users, so this is the only place
  // the dangling user surfaces on the health channel.
  for (const field of ["assignee", "reporter"] as const) {
    const value = task.frontmatter[field];
    if (typeof value === "string" && value !== "") {
      let exists = true;
      try {
        exists = await userExists(locttDir, value);
      } catch {
        // If the users store cannot be read we cannot assert absence;
        // leave the reference unflagged rather than lie (ERR-1).
        exists = true;
      }
      if (!exists) {
        push(field, "dangling", `${field} "${value}" is not a known user`);
      }
    }
  }

  return out;
}

/**
 * Merges intrinsic `task.health` with the extrinsic findings, returning a
 * new `Task` whose `health` is the concatenation (omitted when empty).
 * Used by the surfaces that load configs.
 */
export function withExtrinsicHealth(task: Task, extrinsic: readonly FieldHealth[]): Task {
  const merged = [...(task.health ?? []), ...extrinsic];
  if (merged.length === 0) {
    const { health: _omit, ...rest } = task;
    return rest;
  }
  return { ...task, health: merged };
}
