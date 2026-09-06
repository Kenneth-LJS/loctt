import type {
  BoardsConfig,
  CustomFieldDef,
  EstimationConfig,
  PriorityDef,
  RelationshipDef,
  StatusDef,
  Task,
  TaskTypeDef,
  TimelineConfig,
  WorkflowBroken,
  WorkflowConfig,
} from "@loctt/contracts";
import { ulid } from "ulid";
import { stringify as stringifyYaml } from "yaml";

import { getWorkflowConfigPath } from "../paths/index.js";
import { brokenEntriesToPlain } from "./health.js";
import {
  appendJournalEntry,
  clearJournalEntry,
  loadJournal,
  registerRecoveryHandler,
  saveJournal,
  withStateLock,
} from "../state/index.js";
import { writeTask } from "../task/io.js";
import { loadAllTasks } from "../task/load-all.js";
import type { MutableFrontmatter } from "../task/mutable.js";
import { toFrontmatter, toMutable } from "../task/mutable.js";
import { writeYamlAtomically } from "../utils/atomic-yaml.js";
import {
  loadListViewConfig,
  pruneListViewForRemovedCustomFields,
  saveListViewConfig,
} from "./list-view.js";
import { validateWorkflowConfig } from "./validation.js";
import {
  loadWorkflowConfig,
  parseWorkflowConfig,
  WorkflowConfigError,
} from "./workflow.js";

/**
 * Remap directives for fields that became unknown when the new
 * workflow config was written. Each map's keys are old config keys
 * being deleted; values are the new key to remap onto, or `null`
 * to clear the field entirely.
 *
 * Custom field enum values are remapped via the `custom_fields`
 * sub-map — keyed by the field's key, and inside that the value
 * key being remapped.
 */
export interface WorkflowRemap {
  readonly statuses?: Readonly<Record<string, string | null>>;
  readonly priorities?: Readonly<Record<string, string | null>>;
  readonly task_types?: Readonly<Record<string, string | null>>;
  readonly custom_fields?: Readonly<Record<string, Readonly<Record<string, string | null>>>>;
  /**
   * Relationship-type remap: keys are old relationship-type keys being
   * deleted; values are the new type to remap onto, or `null` to drop
   * those relationship edges entirely from every task that referenced
   * the deleted type.
   *
   * Relationship keys themselves are immutable in `workflow.yaml`. To
   * "rename" a relationship, delete it and create a new one with the
   * desired key — that goes through this remap with the new key as the
   * target.
   */
  readonly relationships?: Readonly<Record<string, string | null>>;
}

/**
 * Atomically writes workflow.yaml. Round-trips through parse to
 * enforce all invariants before persisting.
 *
 * `timeline.dependency_relationship` is written through as given,
 * even when it names a relationship key that no longer exists. See
 * the note above `SimpleCollection` for why the previous auto-clear
 * was removed.
 */
export async function saveWorkflowConfig(
  locttDir: string,
  config: WorkflowConfig,
): Promise<void> {
  const cleaned = assertWorkflowConfigValid(config);
  // The schema validates each entry on its own, so it cannot see that
  // two entries in a collection collide. Cross-entry rules live in
  // `validateWorkflowConfig`, which until now had a single production
  // caller — `loctt doctor` — meaning invalid config could be written
  // and was only reported afterwards, by a command the user had to
  // think to run.
  //
  // `cleaned` is the final config: `executeWorkflowRemap` calls this
  // once at the end of a remap, never with an intermediate state.
  //
  // K28-WF (Ken, 2026-09-06): preserve any degraded sub-entries the
  // loader set aside, so an unrelated write (adding a priority, say)
  // never silently drops a hand-broken status the user has yet to fix.
  // The other six config writers thread `config.broken` forward from a
  // load-mutate-save, but workflow.yaml's main writer is a whole-
  // document PUT (`applyWorkflowEdit` ← the Settings form), and the
  // client cannot resubmit broken entries it never rendered — so the
  // incoming `config.broken` is empty on exactly the common path.
  // Preservation must not depend on the caller having carried the data:
  // re-read the on-disk broken entries here and merge them at write
  // time. Every caller holds the state lock (`applyWorkflowEdit` /
  // recovery replay), so the read is consistent with the write.
  // Broken entries are sticky — they survive every write until the user
  // fixes the file itself (Ken's ruling: fix-the-file-to-clear).
  const broken = await readOnDiskBroken(locttDir);
  await writeYamlAtomically(
    getWorkflowConfigPath(locttDir),
    mergeBrokenIntoPlain(buildPlainObject(cleaned), broken),
  );
}

/**
 * Re-reads the workflow file's degraded sub-entries, tolerating a
 * missing or unreadable file by reporting "none". A save always
 * targets an existing, lock-held file, so absence here is abnormal —
 * but preservation logic must never be the thing that breaks an
 * otherwise-legitimate write, so it degrades to an empty result rather
 * than throwing.
 */
async function readOnDiskBroken(locttDir: string): Promise<WorkflowBroken> {
  try {
    return (await loadWorkflowConfig(locttDir)).broken ?? {};
  } catch {
    return {};
  }
}

/**
 * Splices the preserved broken sub-entries back into the plain write
 * object, each into the sub-list it came from (K28-WF). A broken entry
 * re-emits as an ordinary member whose values do not validate, so a
 * later read re-sorts it back into `broken` — never lost, never
 * silently promoted to valid. `brokenEntriesToPlain` skips any entry
 * whose stored text will not re-parse to an object, so this can only
 * add faithfully-reconstructable siblings.
 */
function mergeBrokenIntoPlain(
  plain: Record<string, unknown>,
  broken: WorkflowBroken,
): Record<string, unknown> {
  const subLists: readonly (keyof WorkflowBroken)[] = [
    "statuses", "priorities", "task_types", "relationships", "custom_fields",
  ];
  for (const key of subLists) {
    const extra = brokenEntriesToPlain(broken[key]);
    if (extra.length === 0) continue;
    const existing = Array.isArray(plain[key]) ? plain[key] as unknown[] : [];
    plain[key] = [...existing, ...extra];
  }
  return plain;
}

/**
 * Runs every check `saveWorkflowConfig` would run, and returns the
 * cleaned config it would write. Throws on the first problem.
 *
 * Separate from the write so a caller can reject a bad config *before*
 * acting on it. `executeWorkflowRemap` rewrites tasks and prunes list
 * views on the way to saving, and validating only at the end meant a
 * refused edit still left those rewrites on disk — recoverable via the
 * journal, but "refused" should mean nothing happened.
 */
export function assertWorkflowConfigValid(config: WorkflowConfig): WorkflowConfig {
  const cleaned = renumberPriorities(config);
  // Re-encode and re-parse so any caller-side issues surface as
  // validation errors rather than corrupting on-disk state.
  parseWorkflowConfig(serializeWorkflowConfigAsYaml(cleaned));
  // The schema validates each entry on its own, so it cannot see that
  // two entries in a collection collide. Cross-entry rules live in
  // `validateWorkflowConfig`.
  const errors = validateWorkflowConfig(cleaned);
  if (errors.length > 0) {
    throw new WorkflowConfigError(
      `invalid workflow config: ${errors.map(e => `${e.field}: ${e.message}`).join("; ")}`,
    );
  }
  return cleaned;
}

/**
 * Returns `config` with priority `value`s renumbered 1..N in list order
 * (D20).
 *
 * `value` is what `order by priority` sorts on and is never displayed,
 * so a wrong number is invisible until a query returns the wrong order.
 * Reordering the list is the whole way a user expresses priority rank,
 * and nothing recomputed the numbers to match: duplicates, gaps, zero
 * and negatives all persisted, leaving the sort arbitrary between tied
 * entries.
 *
 * Done here rather than in the reorder UI (M4.2, unbuilt) because every
 * workflow write funnels through `assertWorkflowConfigValid`, so the
 * invariant holds regardless of which surface made the edit.
 */
function renumberPriorities(config: WorkflowConfig): WorkflowConfig {
  const renumbered = config.priorities.map((p, i) => ({ ...p, value: i + 1 }));
  const unchanged = renumbered.every((p, i) => p.value === config.priorities[i]?.value);
  return unchanged ? config : { ...config, priorities: renumbered };
}

/**
 * `timeline.dependency_relationship` is deliberately NOT validated
 * against `relationships` here, and a dangling value is written back
 * unchanged.
 *
 * This used to auto-clear: a value naming a relationship key that no
 * longer existed was silently deleted from the user's own
 * workflow.yaml on the next write. That is the worst of the three
 * available behaviours — a user who typos `dpends_on` gets no arrows,
 * no message, and the evidence of the mistake erased from the file
 * they would look at to find it. P7 forbids exactly this kind of
 * silent pruning.
 *
 * TML-34's third bullet is the requirement the old behaviour could not
 * meet: a missing key must produce "no arrows plus a visible
 * configuration notice naming the missing key — not a silent no-op and
 * not a crash". Naming it requires the value to still be there, so the
 * value survives and the timeline reports it.
 *
 * Consumers must therefore treat the field as a *reference that may
 * dangle*: resolve it against `relationships` and render nothing (plus
 * a notice) when it does not resolve, rather than assuming validity.
 */

type SimpleCollection = "statuses" | "priorities" | "task_types";

/**
 * Validates that key-immutability is preserved between two
 * workflow configs: any key present in `prev` must still exist in
 * `next` *unless* the caller has supplied a remap directive in
 * `remap`. Throws WorkflowConfigError when an in-use key is removed
 * without a remap.
 */
export function validateRemapCoversDeletions(
  prev: WorkflowConfig,
  next: WorkflowConfig,
  remap: WorkflowRemap,
  inUse: { statuses: ReadonlySet<string>; priorities: ReadonlySet<string>; task_types: ReadonlySet<string>; custom_field_values: Readonly<Record<string, ReadonlySet<string>>>; relationships: ReadonlySet<string> },
): void {
  function checkSimple(
    name: SimpleCollection,
    prevKeys: readonly string[],
    nextKeys: readonly string[],
    inUseKeys: ReadonlySet<string>,
  ): void {
    const nextSet = new Set(nextKeys);
    const prevSet = new Set(prevKeys);
    const remapTable = remap[name] ?? {};
    // Validate every remap source is a key that exists in the
    // previous config. A typo like `{ statuses: { "in_progresss":
    // "done" } }` would otherwise silently get journaled and
    // surface as a confusing "no-op" at apply time.
    for (const source of Object.keys(remapTable)) {
      if (!prevSet.has(source)) {
        throw new WorkflowConfigError(
          `${name} remap source '${source}' is not a key in the previous config`,
        );
      }
    }
    for (const k of prevKeys) {
      if (nextSet.has(k)) continue;
      if (!inUseKeys.has(k)) continue; // unused — fine to delete silently
      if (!(k in remapTable)) {
        throw new WorkflowConfigError(
          `${name} key '${k}' is in use; provide a remap target (or null to clear)`,
        );
      }
      const target = remapTable[k];
      if (target !== null && target !== undefined && !nextSet.has(target)) {
        throw new WorkflowConfigError(
          `${name} remap '${k}' → '${target}' targets a key not present in the new config`,
        );
      }
    }
  }

  checkSimple("statuses", prev.statuses.map(s => s.key), next.statuses.map(s => s.key), inUse.statuses);
  checkSimple("priorities", prev.priorities.map(p => p.key), next.priorities.map(p => p.key), inUse.priorities);
  checkSimple("task_types", prev.task_types.map(t => t.key), next.task_types.map(t => t.key), inUse.task_types);

  // Relationships use a parallel check but a separate code path
  // because `checkSimple` is parameterised over a `SimpleCollection`
  // string and `remap.relationships` lives at the same top level.
  // Inline the same logic here so the error messages share wording
  // with the scalar collections.
  const nextRelKeys = new Set(next.relationships.map(r => r.key));
  const prevRelKeys = new Set(prev.relationships.map(r => r.key));
  const relRemap = remap.relationships ?? {};
  for (const source of Object.keys(relRemap)) {
    if (!prevRelKeys.has(source)) {
      throw new WorkflowConfigError(
        `relationships remap source '${source}' is not a key in the previous config`,
      );
    }
  }
  for (const r of prev.relationships) {
    if (nextRelKeys.has(r.key)) continue;
    if (!inUse.relationships.has(r.key)) continue;
    if (!(r.key in relRemap)) {
      throw new WorkflowConfigError(
        `relationships key '${r.key}' is in use; provide a remap target (or null to clear)`,
      );
    }
    const target = relRemap[r.key];
    if (target !== null && target !== undefined && !nextRelKeys.has(target)) {
      throw new WorkflowConfigError(
        `relationships remap '${r.key}' → '${target}' targets a key not present in the new config`,
      );
    }
  }

  // Custom field enum values: per field, validate that any deleted
  // value either has a remap target in the same field or wasn't
  // in use. If the whole custom field is deleted, the field-level
  // sweep below clears it from tasks; we don't require a remap for
  // the values in that case (the parent field is going away).
  const nextFieldKeys = new Set(next.custom_fields.map(f => f.key));
  // Top-level: every key in remap.custom_fields must name a field
  // that existed in `prev`. Catches typos in the field name itself
  // before we drill into per-value remaps.
  const prevFieldKeys = new Set(prev.custom_fields.map(f => f.key));
  for (const fieldKey of Object.keys(remap.custom_fields ?? {})) {
    if (!prevFieldKeys.has(fieldKey)) {
      throw new WorkflowConfigError(
        `custom_fields remap source '${fieldKey}' is not a field in the previous config`,
      );
    }
  }
  for (const prevField of prev.custom_fields) {
    if (!nextFieldKeys.has(prevField.key)) continue; // whole field gone
    const nextField = next.custom_fields.find(f => f.key === prevField.key);
    if (!nextField) continue;
    if (!prevField.values || prevField.values.length === 0) continue;
    if (!nextField.values || nextField.values.length === 0) continue;

    const nextValueKeys = new Set(nextField.values.map(v => v.key));
    const prevValueKeys = new Set(prevField.values.map(v => v.key));
    const inUseValues = inUse.custom_field_values[prevField.key] ?? new Set<string>();
    const remapForField = remap.custom_fields?.[prevField.key] ?? {};
    // Per-value: each remap source must be a value that existed.
    for (const source of Object.keys(remapForField)) {
      if (!prevValueKeys.has(source)) {
        throw new WorkflowConfigError(
          `custom_fields.${prevField.key} remap source '${source}' is not a value in the previous config`,
        );
      }
    }
    for (const v of prevField.values) {
      if (nextValueKeys.has(v.key)) continue;
      if (!inUseValues.has(v.key)) continue;
      if (!(v.key in remapForField)) {
        throw new WorkflowConfigError(
          `custom_fields.${prevField.key} value '${v.key}' is in use; provide a remap target (or null to clear)`,
        );
      }
      const target = remapForField[v.key];
      if (target !== null && target !== undefined && !nextValueKeys.has(target)) {
        throw new WorkflowConfigError(
          `custom_fields.${prevField.key} remap '${v.key}' → '${target}' targets a value not present in the new config`,
        );
      }
    }
  }
}

/**
 * Computes which workflow keys are referenced by any task. Returns
 * a struct of sets used by `validateRemapCoversDeletions` and the
 * task-rewrite pass below.
 */
export function computeWorkflowKeyUsage(tasks: readonly Task[]): {
  statuses: Set<string>;
  priorities: Set<string>;
  task_types: Set<string>;
  custom_field_values: Record<string, Set<string>>;
  relationships: Set<string>;
} {
  const usage = {
    statuses: new Set<string>(),
    priorities: new Set<string>(),
    task_types: new Set<string>(),
    custom_field_values: {} as Record<string, Set<string>>,
    relationships: new Set<string>(),
  };
  for (const t of tasks) {
    if (t.frontmatter.status) usage.statuses.add(t.frontmatter.status);
    if (t.frontmatter.priority) usage.priorities.add(t.frontmatter.priority);
    if (t.frontmatter.task_type) usage.task_types.add(t.frontmatter.task_type);
    if (t.frontmatter.relationships) {
      for (const rel of t.frontmatter.relationships) {
        usage.relationships.add(rel.type);
      }
    }
    if (t.frontmatter.fields) {
      for (const [field, value] of Object.entries(t.frontmatter.fields)) {
        if (typeof value === "string") {
          (usage.custom_field_values[field] ??= new Set()).add(value);
        } else if (Array.isArray(value)) {
          for (const v of value) {
            if (typeof v === "string") {
              (usage.custom_field_values[field] ??= new Set()).add(v);
            }
          }
        }
      }
    }
  }
  return usage;
}

/**
 * Applies a remap directive to a single scalar frontmatter slot
 * (status / priority / task_type). Returns `true` when the slot
 * changed. Mutates `fm` in place.
 *
 * Throws when validation upstream allowed an in-use key through
 * without a remap — that's an internal bug, not user input, so the
 * exception surfaces the gap loudly rather than silently leaving
 * the task pointing at a deleted key.
 */
function applyScalarRemap(
  fm: MutableFrontmatter,
  slot: "status" | "priority" | "task_type",
  taskKey: string,
  nextKeys: ReadonlySet<string>,
  remapTable: Readonly<Record<string, string | null>> | undefined,
): boolean {
  const current = fm[slot];
  if (typeof current !== "string") return false;
  if (nextKeys.has(current)) return false;
  const target = remapTable?.[current];
  if (target === undefined) {
    throw new Error(`internal: missing ${slot} remap for "${current}" on task ${taskKey}`);
  }
  if (target === null) {
    delete fm[slot];
  } else {
    fm[slot] = target;
  }
  return true;
}

/**
 * Applies remaps to a single task's `fields` map. Drops fields whose
 * defining custom_field is gone from the new config; for surviving
 * enum fields, remaps stored values through `remap.custom_fields`.
 * Returns `true` when anything changed. Mutates `fm` in place.
 */
function applyCustomFieldsRemap(
  fm: MutableFrontmatter,
  nextFieldsByKey: ReadonlyMap<string, CustomFieldDef>,
  remap: WorkflowRemap,
): boolean {
  if (!fm["fields"] || typeof fm["fields"] !== "object") return false;
  const fields = { ...(fm["fields"] as Record<string, unknown>) };
  let changed = false;

  for (const [fkey, fval] of Object.entries(fields)) {
    const def = nextFieldsByKey.get(fkey);
    if (!def) {
      delete fields[fkey];
      changed = true;
      continue;
    }
    if (def.type !== "enum" || !def.values) continue;

    const validValues = new Set(def.values.map(v => v.key));
    const fieldRemap = remap.custom_fields?.[fkey] ?? {};

    if (typeof fval === "string") {
      if (validValues.has(fval)) continue;
      const t = fieldRemap[fval];
      if (t === null) {
        delete fields[fkey];
      } else if (typeof t === "string") {
        fields[fkey] = t;
      }
      changed = true;
    } else if (Array.isArray(fval)) {
      const out: string[] = [];
      let arrChanged = false;
      for (const v of fval) {
        if (typeof v !== "string") continue;
        if (validValues.has(v)) { out.push(v); continue; }
        const t = fieldRemap[v];
        if (t === null) { arrChanged = true; continue; }
        if (typeof t === "string") { out.push(t); arrChanged = true; continue; }
      }
      if (arrChanged) {
        if (out.length === 0) {
          delete fields[fkey];
        } else {
          fields[fkey] = out;
        }
        changed = true;
      }
    }
  }

  if (changed) {
    if (Object.keys(fields).length === 0) {
      delete fm["fields"];
    } else {
      fm["fields"] = fields;
    }
  }
  return changed;
}

/**
 * Applies a remap directive to a single task's `relationships` array.
 * Drops edges whose type is gone from the new config (when the remap
 * is `null`), remaps them onto the new type (when the remap is a
 * string), and leaves edges referencing surviving types untouched.
 * Returns `true` when anything changed. Mutates `fm` in place.
 */
function applyRelationshipsRemap(
  fm: MutableFrontmatter,
  taskKey: string,
  nextRelKeys: ReadonlySet<string>,
  remapTable: Readonly<Record<string, string | null>> | undefined,
): boolean {
  const rels = fm["relationships"];
  if (!Array.isArray(rels) || rels.length === 0) return false;

  const out: Array<Record<string, unknown>> = [];
  let changed = false;
  for (const rel of rels) {
    if (rel === null || typeof rel !== "object") {
      // Malformed edge entry: drop it. Preserving it would let the
      // downstream task-write validator throw mid-loop, leaving a
      // partial commit on disk. Dropping matches the `null`-remap
      // path's "edge is unusable, remove it" semantics.
      changed = true;
      continue;
    }
    const r = rel as Record<string, unknown>;
    const type = r["type"];
    if (typeof type !== "string") {
      // Same rationale as above: drop instead of preserving a shape
      // the schema would reject when we round-trip writeTask.
      changed = true;
      continue;
    }
    if (nextRelKeys.has(type)) {
      out.push(r);
      continue;
    }
    const target = remapTable?.[type];
    if (target === undefined) {
      throw new Error(
        `internal: missing relationships remap for "${type}" on task ${taskKey}`,
      );
    }
    if (target === null) {
      changed = true;
      continue; // drop the edge
    }
    out.push({ ...r, type: target });
    changed = true;
  }

  if (!changed) return false;
  if (out.length === 0) {
    delete fm["relationships"];
  } else {
    fm["relationships"] = out;
  }
  return true;
}

/** YYYY-MM-DD matcher mirroring the one in validation.ts. */
const DATE_FIELD_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Predicate: does `v` satisfy a single-value `type`? */
function isValidForCustomFieldType(v: unknown, type: CustomFieldDef["type"]): boolean {
  switch (type) {
    case "string": return typeof v === "string";
    case "number": return typeof v === "number" && Number.isFinite(v);
    case "boolean": return typeof v === "boolean";
    case "date": return typeof v === "string" && DATE_FIELD_RE.test(v);
    case "enum": return typeof v === "string";
  }
}

/**
 * Pre-flight check for type/multi changes on custom fields between
 * `prev` and `next`. For every field whose `type` or `multi` flag
 * shifted, walk all tasks and verify that any stored value is still
 * compatible with the new shape. Rejects the edit with a pointer to
 * the first offending task — the user must clean up that data (or
 * revert the type change) before re-applying.
 *
 * Enum→enum value remapping is handled separately by
 * `validateRemapCoversDeletions` + `applyCustomFieldsRemap`; this
 * function does NOT inspect enum value membership, only the
 * underlying type compatibility.
 */
function assertCustomFieldTypeChangesAreSafe(
  prev: WorkflowConfig,
  next: WorkflowConfig,
  tasks: readonly Task[],
): void {
  const nextByKey = new Map(next.custom_fields.map(f => [f.key, f]));
  const changedShape: Array<{ key: string; nextDef: CustomFieldDef }> = [];
  for (const prevDef of prev.custom_fields) {
    const nextDef = nextByKey.get(prevDef.key);
    if (!nextDef) continue; // whole field gone — handled by remap path
    if (prevDef.type === nextDef.type && prevDef.multi === nextDef.multi) continue;
    changedShape.push({ key: prevDef.key, nextDef });
  }
  if (changedShape.length === 0) return;

  for (const { key, nextDef } of changedShape) {
    for (const task of tasks) {
      const fields = task.frontmatter.fields;
      if (!fields || !(key in fields)) continue;
      const v = fields[key];
      const ok = nextDef.multi
        ? Array.isArray(v) && v.every(item => isValidForCustomFieldType(item, nextDef.type))
        : isValidForCustomFieldType(v, nextDef.type);
      if (!ok) {
        throw new WorkflowConfigError(
          `custom_fields.${key} type change to ${nextDef.multi ? "multi " : ""}${nextDef.type} ` +
          `is incompatible with existing data on task ${task.frontmatter.key} ` +
          `(value: ${JSON.stringify(v)}); clean up the task data or revert the type change`,
        );
      }
    }
  }
}

/**
 * High-level "edit workflow" entry point. Atomically:
 *  1. Reads the current workflow + all tasks.
 *  2. Validates that the proposed `next` config is internally valid.
 *  3. Confirms that every deleted key in use has a remap directive.
 *  4. Rewrites affected tasks to apply the remaps.
 *  5. Writes the new workflow.yaml.
 */
export async function applyWorkflowEdit(
  locttDir: string,
  next: WorkflowConfig,
  remap: WorkflowRemap = {},
): Promise<{ rewrittenTaskCount: number }> {
  return withStateLock(locttDir, async () => {
    const prev = await loadWorkflowConfig(locttDir);
    const tasks = await loadAllTasks(locttDir);
    const usage = computeWorkflowKeyUsage(tasks);

    validateRemapCoversDeletions(prev, next, remap, usage);

    // Strict type-change guard for custom fields. If a field's `type`
    // or `multi` flag changed, every task already carrying a value
    // for that field must have data compatible with the NEW shape;
    // otherwise the edit would leave the tracker holding invalid
    // data that the loaders would then reject. Surfaces a single
    // clear error pointing at the first offending task; the user
    // either cleans up the data first or reverts the type change.
    assertCustomFieldTypeChangesAreSafe(prev, next, tasks);

    // Validate before journaling, not just before writing. The journal
    // entry is the replay instruction: an invalid config recorded there
    // is re-applied by the next withStateLock caller, so a refused edit
    // would keep failing every later operation — and the failure names
    // the *original* mistake, which the user has since moved on from.
    assertWorkflowConfigValid(next);

    // Crash-recovery journal: append an entry carrying the full
    // `next` config + remap directive BEFORE any task or config
    // write. If we crash between writes, the next withStateLock
    // caller replays this entry (see registerRecoveryHandler below).
    // The entry is cleared at the end of the happy path.
    const journalEntryId = ulid();
    const journal = await loadJournal(locttDir);
    const withEntry = appendJournalEntry(journal, {
      id: journalEntryId,
      kind: "remap_workflow",
      started_at: new Date().toISOString(),
      next,
      remap,
    });
    await saveJournal(locttDir, withEntry);

    const result = await executeWorkflowRemap(locttDir, prev, next, remap, tasks);

    await clearJournalEntry(locttDir, journalEntryId);
    return result;
  });
}

/**
 * The core "apply this workflow edit" sequence: task rewrites +
 * list-view pruning + workflow save. Pulled out of
 * `applyWorkflowEdit` so the journal recovery handler can call it
 * with the on-disk `prev` to drive a replay. Each step is
 * idempotent on its own:
 *   - Task rewrites compare every task's value against the new
 *     config keys and only write when the current value is no
 *     longer valid; tasks already pointing at the new value are
 *     skipped.
 *   - list-view pruning compares prev vs next custom_fields and
 *     emits a save only when something actually changed.
 *   - saveWorkflowConfig is safe to re-run with the same `next`.
 *
 * Returns the number of tasks the rewrite pass touched.
 */
async function executeWorkflowRemap(
  locttDir: string,
  prev: WorkflowConfig,
  next: WorkflowConfig,
  remap: WorkflowRemap,
  tasks: readonly Task[],
): Promise<{ rewrittenTaskCount: number }> {
  // Validate before touching anything. Task rewrites and list-view
  // pruning below are real writes, and a config that will be rejected at
  // the end must not get that far.
  //
  // Redundant for applyWorkflowEdit, which now validates before it
  // journals — but this function is also the journal replay entry point
  // (registerRecoveryHandler below), and a replay must not trust the
  // entry it is replaying. Kept deliberately; no test covers the replay
  // path with an invalid entry because writing one requires corrupting
  // the journal by hand.
  assertWorkflowConfigValid(next);

  const nextStatusKeys = new Set(next.statuses.map(s => s.key));
  const nextPriorityKeys = new Set(next.priorities.map(p => p.key));
  const nextTypeKeys = new Set(next.task_types.map(t => t.key));
  const nextRelKeys = new Set(next.relationships.map(r => r.key));
  const nextFieldsByKey = new Map(next.custom_fields.map(f => [f.key, f]));

  let rewrittenTaskCount = 0;
  // Single timestamp for the whole logical operation so every
  // task touched in this remap shares the same updated_at.
  const operationNow = new Date().toISOString();
  for (const task of tasks) {
    const fm = toMutable(task.frontmatter);
    const taskKey = task.frontmatter.key;
    let changed = false;

    if (applyScalarRemap(fm, "status", taskKey, nextStatusKeys, remap.statuses)) changed = true;
    if (applyScalarRemap(fm, "priority", taskKey, nextPriorityKeys, remap.priorities)) changed = true;
    if (applyScalarRemap(fm, "task_type", taskKey, nextTypeKeys, remap.task_types)) changed = true;
    if (applyRelationshipsRemap(fm, taskKey, nextRelKeys, remap.relationships)) changed = true;
    if (applyCustomFieldsRemap(fm, nextFieldsByKey, remap)) changed = true;

    if (changed) {
      fm["updated_at"] = operationNow;
      const updated: Task = { ...task, frontmatter: toFrontmatter(fm) };
      await writeTask(locttDir, task.frontmatter.id, updated);
      rewrittenTaskCount += 1;
    }
  }

  // Prune list-view.yaml entries that referenced custom fields
  // about to be removed. Now covered by the journal entry that
  // wraps applyWorkflowEdit, so a SIGKILL between writes will be
  // replayed by recovery (see registerRecoveryHandler below).
  const removedCustomFieldKeys = new Set<string>();
  for (const f of prev.custom_fields) {
    if (!nextFieldsByKey.has(f.key)) removedCustomFieldKeys.add(f.key);
  }
  if (removedCustomFieldKeys.size > 0) {
    const lv = await loadListViewConfig(locttDir);
    const prunedLv = pruneListViewForRemovedCustomFields(lv, removedCustomFieldKeys);
    if (prunedLv !== lv) {
      await saveListViewConfig(locttDir, prunedLv);
    }
  }

  await saveWorkflowConfig(locttDir, next);
  return { rewrittenTaskCount };
}

/**
 * Journal entry id. Plain ulid() — same namespace and time-ordering
 * other journal handlers use, so log lines from a recovery run sort
 * naturally regardless of which kind of entry produced them.
 */
// Register the crash-recovery handler at module load.
//
// Recovery is straightforward: re-read the on-disk workflow config
// as `prev` (it may equal `next` already if the crash happened
// after saveWorkflowConfig but before clearJournalEntry — that's
// fine, executeWorkflowRemap is idempotent), then run the same
// rewrite/prune/save sequence and clear the entry.
//
// `next` and `remap` come from the journal entry — they're the
// authoritative target state and don't depend on anything that
// might have been partially written by the crashed op.
registerRecoveryHandler("remap_workflow", async (locttDir, entry) => {
  if (entry.kind !== "remap_workflow") return; // narrow the union
  const prev = await loadWorkflowConfig(locttDir);
  const tasks = await loadAllTasks(locttDir);
  // entry.remap is the Zod-inferred shape (mutable, optional fields
  // typed with `| undefined`); WorkflowRemap is the in-memory shape
  // (Readonly, no `| undefined`). The structural content matches —
  // a runtime cast keeps the journal schema simple without forcing
  // contracts to grow a separate persistence-side type.
  const remap = entry.remap as WorkflowRemap;
  await executeWorkflowRemap(locttDir, prev, entry.next, remap, tasks);
  await clearJournalEntry(locttDir, entry.id);
});

function serializeWorkflowConfigAsYaml(config: WorkflowConfig): string {
  return stringifyYaml(buildPlainObject(config));
}

/**
 * Conditional spread for the optional icon + color fields shared by
 * status / priority / task_type / relationship / custom_field_value.
 * Keeps every serializer's spread list short and consistent.
 */
function iconColorSpread(
  o: { icon?: string | undefined; color?: string | undefined },
): Record<string, unknown> {
  return {
    ...(o.icon !== undefined ? { icon: o.icon } : {}),
    ...(o.color !== undefined ? { color: o.color } : {}),
  };
}

function serializeStatus(s: StatusDef): Record<string, unknown> {
  return {
    key: s.key,
    label: s.label,
    category: s.category,
    // Must survive the round-trip: dropping it would leave the config
    // with no default status, which the schema then rejects on the very
    // next read — a write that bricks its own output.
    ...(s.default === true ? { default: true } : {}),
    ...iconColorSpread(s),
  };
}

function serializePriority(p: PriorityDef): Record<string, unknown> {
  return {
    key: p.key,
    label: p.label,
    ...(p.value !== undefined ? { value: p.value } : {}),
    ...iconColorSpread(p),
  };
}

function serializeTaskType(t: TaskTypeDef): Record<string, unknown> {
  return {
    key: t.key,
    label: t.label,
    ...iconColorSpread(t),
  };
}

function serializeRelationship(r: RelationshipDef): Record<string, unknown> {
  return {
    key: r.key,
    label: r.label,
    ...(r.kind !== undefined ? { kind: r.kind } : {}),
    ...(r.inverse !== undefined ? { inverse: r.inverse } : {}),
    ...(r.inverse_label !== undefined ? { inverse_label: r.inverse_label } : {}),
    ...(r.graph !== undefined && r.graph !== "none" ? { graph: r.graph } : {}),
    ...(r.ranked === true ? { ranked: true } : {}),
    ...iconColorSpread(r),
  };
}

function serializeCustomField(f: CustomFieldDef): Record<string, unknown> {
  return {
    key: f.key,
    label: f.label,
    type: f.type,
    multi: f.multi,
    searchable: f.searchable,
    ...(f.values !== undefined
      ? {
          values: f.values.map(v => ({
            key: v.key,
            label: v.label,
            ...(v.value !== undefined ? { value: v.value } : {}),
            ...iconColorSpread(v),
          })),
        }
      : {}),
  };
}

function serializeEstimation(e: EstimationConfig): Record<string, unknown> {
  return {
    enabled: e.enabled,
    unit: e.unit,
    ...(e.unit_label !== undefined ? { unit_label: e.unit_label } : {}),
    ...(e.scale !== undefined ? { scale: e.scale } : {}),
    ...(e.preset_values !== undefined ? { preset_values: [...e.preset_values] } : {}),
    ...(e.weights !== undefined ? { weights: { ...e.weights } } : {}),
  };
}

function serializeBoards(b: BoardsConfig): Record<string, unknown> {
  return {
    columns: b.columns.map(c => ({
      key: c.key,
      label: c.label,
      statuses: [...c.statuses],
      ...(c.wip !== undefined ? { wip: c.wip } : {}),
    })),
  };
}

function serializeTimeline(t: TimelineConfig): Record<string, unknown> {
  // `dependency_relationship: null` is meaningful (explicitly disabled
  // arrows); preserve it on disk rather than collapsing to absent.
  return {
    ...(t.dependency_relationship !== undefined
      ? { dependency_relationship: t.dependency_relationship }
      : {}),
    ...(t.default_zoom !== undefined ? { default_zoom: t.default_zoom } : {}),
    ...(t.show_arrows !== undefined ? { show_arrows: t.show_arrows } : {}),
    ...(t.default_grouping !== undefined ? { default_grouping: t.default_grouping } : {}),
  };
}

function buildPlainObject(config: WorkflowConfig): Record<string, unknown> {
  const out: Record<string, unknown> = {
    key: { prefix: config.key.prefix },
    statuses: config.statuses.map(serializeStatus),
    priorities: config.priorities.map(serializePriority),
    task_types: config.task_types.map(serializeTaskType),
    relationships: config.relationships.map(serializeRelationship),
    custom_fields: config.custom_fields.map(serializeCustomField),
  };
  if (config.estimation !== undefined) {
    out["estimation"] = serializeEstimation(config.estimation);
  }
  if (config.boards !== undefined) {
    out["boards"] = serializeBoards(config.boards);
  }
  if (config.timeline !== undefined) {
    // Skip emitting an empty timeline block (e.g. after auto-clear);
    // the schema treats absent and empty the same and the on-disk
    // file should not carry a no-op section.
    const t = serializeTimeline(config.timeline);
    if (Object.keys(t).length > 0) {
      out["timeline"] = t;
    }
  }
  return out;
}

/**
 * Reference **counts** per workflow key, for the settings panels.
 *
 * `computeWorkflowKeyUsage` above answers "is this key in use?", which
 * is all `validateRemapCoversDeletions` needs. SET-17 and SET-19 want
 * the number — "9 tasks use `in_review`" — before the delete is
 * confirmed, and a Set cannot answer that. Kept as a separate function
 * rather than widening the Sets to Maps because the validator's
 * membership checks are on the hot path of every workflow write and
 * gain nothing from carrying counts.
 *
 * A relationship is counted once per task that holds at least one link
 * of that type, not once per link: the number the panel reports is
 * "tasks affected by deleting this", and a task with three `blocks`
 * links is one task to rewrite.
 */
export function computeWorkflowKeyCounts(tasks: readonly Task[]): {
  statuses: Record<string, number>;
  priorities: Record<string, number>;
  task_types: Record<string, number>;
  relationships: Record<string, number>;
  custom_field_values: Record<string, Record<string, number>>;
} {
  const statuses: Record<string, number> = {};
  const priorities: Record<string, number> = {};
  const task_types: Record<string, number> = {};
  const relationships: Record<string, number> = {};
  const custom_field_values: Record<string, Record<string, number>> = {};

  const bump = (table: Record<string, number>, key: string): void => {
    table[key] = (table[key] ?? 0) + 1;
  };

  for (const t of tasks) {
    const fm = t.frontmatter;
    if (fm.status) bump(statuses, fm.status);
    if (fm.priority) bump(priorities, fm.priority);
    if (fm.task_type) bump(task_types, fm.task_type);
    if (fm.relationships) {
      // Once per task per type — see the note above.
      const typesOnThisTask = new Set(fm.relationships.map(r => r.type));
      for (const type of typesOnThisTask) bump(relationships, type);
    }
    if (fm.fields) {
      for (const [field, value] of Object.entries(fm.fields)) {
        const perField = (custom_field_values[field] ??= {});
        if (typeof value === "string") {
          bump(perField, value);
        } else if (Array.isArray(value)) {
          // A multi-select holding the same key twice is one task.
          for (const v of new Set(value.filter(x => typeof x === "string"))) {
            bump(perField, v);
          }
        }
      }
    }
  }

  return { statuses, priorities, task_types, relationships, custom_field_values };
}
