import type { Task, WorkflowConfig } from "@loctt/contracts";
import { stringify as stringifyYaml } from "yaml";

import { getWorkflowConfigPath } from "../paths/index.js";
import { withStateLock } from "../state/index.js";
import { writeTask } from "../task/io.js";
import { loadAllTasks } from "../task/lookup.js";
import { writeYamlAtomically } from "../utils/atomic-yaml.js";
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
}

/**
 * Atomically writes workflow.yaml. Round-trips through parse to
 * enforce all invariants before persisting.
 */
export async function saveWorkflowConfig(
  locttDir: string,
  config: WorkflowConfig,
): Promise<void> {
  // Re-encode and re-parse so any caller-side issues surface as
  // validation errors rather than corrupting on-disk state.
  const yaml = serializeWorkflowConfigAsYaml(config);
  parseWorkflowConfig(yaml);
  await writeYamlAtomically(getWorkflowConfigPath(locttDir), buildPlainObject(config));
}

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
  inUse: { statuses: ReadonlySet<string>; priorities: ReadonlySet<string>; task_types: ReadonlySet<string>; custom_field_values: Readonly<Record<string, ReadonlySet<string>>> },
): void {
  function checkSimple(
    name: "statuses" | "priorities" | "task_types",
    prevKeys: readonly string[],
    nextKeys: readonly string[],
    inUseKeys: ReadonlySet<string>,
  ): void {
    const nextSet = new Set(nextKeys);
    const remapTable = remap[name] ?? {};
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

  // Custom field enum values: per field, validate that any deleted
  // value either has a remap target in the same field or wasn't
  // in use. If the whole custom field is deleted, the field-level
  // sweep below clears it from tasks; we don't require a remap for
  // the values in that case (the parent field is going away).
  const nextFieldKeys = new Set(next.custom_fields.map(f => f.key));
  for (const prevField of prev.custom_fields) {
    if (!nextFieldKeys.has(prevField.key)) continue; // whole field gone
    const nextField = next.custom_fields.find(f => f.key === prevField.key);
    if (!nextField) continue;
    if (!prevField.values || prevField.values.length === 0) continue;
    if (!nextField.values || nextField.values.length === 0) continue;

    const nextValueKeys = new Set(nextField.values.map(v => v.key));
    const inUseValues = inUse.custom_field_values[prevField.key] ?? new Set<string>();
    const remapForField = remap.custom_fields?.[prevField.key] ?? {};
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
} {
  const usage = {
    statuses: new Set<string>(),
    priorities: new Set<string>(),
    task_types: new Set<string>(),
    custom_field_values: {} as Record<string, Set<string>>,
  };
  for (const t of tasks) {
    if (t.frontmatter.status) usage.statuses.add(t.frontmatter.status);
    if (t.frontmatter.priority) usage.priorities.add(t.frontmatter.priority);
    if (t.frontmatter.task_type) usage.task_types.add(t.frontmatter.task_type);
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

    // Walk tasks and apply remaps. Track which tasks changed.
    const nextStatusKeys = new Set(next.statuses.map(s => s.key));
    const nextPriorityKeys = new Set(next.priorities.map(p => p.key));
    const nextTypeKeys = new Set(next.task_types.map(t => t.key));
    const nextFieldsByKey = new Map(next.custom_fields.map(f => [f.key, f]));

    let rewrittenTaskCount = 0;
    // Single timestamp for the whole logical operation so every
    // task touched in this remap shares the same updated_at.
    const operationNow = new Date().toISOString();
    for (const task of tasks) {
      const fm = { ...task.frontmatter } as Record<string, unknown>;
      let changed = false;

      if (fm["status"] && !nextStatusKeys.has(fm["status"] as string)) {
        const oldStatus = fm["status"] as string;
        const target = remap.statuses?.[oldStatus];
        // Validation upstream guarantees a mapping for every
        // in-use deleted status; an undefined here means validation
        // was bypassed. Throw so the bug is visible rather than
        // silently skipping the rest of this task's remaps.
        if (target === undefined) {
          throw new Error(`internal: missing status remap for "${oldStatus}" on task ${task.frontmatter.key}`);
        }
        if (target === null) { delete fm["status"]; }
        else { fm["status"] = target; }
        changed = true;
      }
      if (fm["priority"] && !nextPriorityKeys.has(fm["priority"] as string)) {
        const oldPriority = fm["priority"] as string;
        const target = remap.priorities?.[oldPriority];
        if (target === undefined) {
          throw new Error(`internal: missing priority remap for "${oldPriority}" on task ${task.frontmatter.key}`);
        }
        if (target === null) { delete fm["priority"]; }
        else { fm["priority"] = target; }
        changed = true;
      }
      if (fm["task_type"] && !nextTypeKeys.has(fm["task_type"] as string)) {
        const oldTaskType = fm["task_type"] as string;
        const target = remap.task_types?.[oldTaskType];
        if (target === undefined) {
          throw new Error(`internal: missing task_type remap for "${oldTaskType}" on task ${task.frontmatter.key}`);
        }
        if (target === null) { delete fm["task_type"]; }
        else { fm["task_type"] = target; }
        changed = true;
      }

      // Custom fields: drop fields entirely if the field is gone.
      // For surviving fields, remap enum values per the field-specific
      // remap table.
      if (fm["fields"] && typeof fm["fields"] === "object") {
        const fields = { ...(fm["fields"] as Record<string, unknown>) };
        for (const [fkey, fval] of Object.entries(fields)) {
          const def = nextFieldsByKey.get(fkey);
          if (!def) {
            delete fields[fkey];
            changed = true;
            continue;
          }
          if (def.type === "enum" && def.values) {
            const validValues = new Set(def.values.map(v => v.key));
            const fieldRemap = remap.custom_fields?.[fkey] ?? {};
            if (typeof fval === "string" && !validValues.has(fval)) {
              const t = fieldRemap[fval];
              if (t === null) { delete fields[fkey]; }
              else if (typeof t === "string") { fields[fkey] = t; }
              changed = true;
            } else if (Array.isArray(fval)) {
              const out: string[] = [];
              for (const v of fval) {
                if (typeof v !== "string") continue;
                if (validValues.has(v)) { out.push(v); continue; }
                const t = fieldRemap[v];
                if (t === null) { changed = true; continue; }
                if (typeof t === "string") { out.push(t); changed = true; continue; }
              }
              if (out.length === 0) {
                delete fields[fkey];
              } else {
                fields[fkey] = out;
              }
            }
          }
        }
        if (Object.keys(fields).length === 0) {
          delete fm["fields"];
        } else {
          fm["fields"] = fields;
        }
      }

      if (changed) {
        fm["updated_at"] = operationNow;
        const updated: Task = { ...task, frontmatter: fm as unknown as Task["frontmatter"] };
        await writeTask(locttDir, task.frontmatter.id, updated);
        rewrittenTaskCount += 1;
      }
    }

    await saveWorkflowConfig(locttDir, next);
    return { rewrittenTaskCount };
  });
}

function serializeWorkflowConfigAsYaml(config: WorkflowConfig): string {
  return stringifyYaml(buildPlainObject(config));
}

function buildPlainObject(config: WorkflowConfig): Record<string, unknown> {
  const out: Record<string, unknown> = {
    key: { prefix: config.key.prefix },
    statuses: config.statuses.map(s => ({ key: s.key, label: s.label, category: s.category })),
    priorities: config.priorities.map(p => ({
      key: p.key,
      label: p.label,
      ...(p.value !== undefined ? { value: p.value } : {}),
    })),
    task_types: config.task_types.map(t => ({ key: t.key, label: t.label })),
    relationships: config.relationships.map(r => ({
      key: r.key,
      label: r.label,
      inverse: r.inverse,
      inverse_label: r.inverse_label,
      ...(r.structural === true ? { structural: true } : {}),
      ...(r.ranked === true ? { ranked: true } : {}),
    })),
    custom_fields: config.custom_fields.map(f => ({
      key: f.key,
      label: f.label,
      type: f.type,
      multi: f.multi,
      searchable: f.searchable,
      ...(f.values !== undefined
        ? { values: f.values.map(v => ({
            key: v.key,
            label: v.label,
            ...(v.value !== undefined ? { value: v.value } : {}),
          })) }
        : {}),
    })),
  };
  if (config.estimation !== undefined) {
    out["estimation"] = {
      enabled: config.estimation.enabled,
      unit: config.estimation.unit,
      ...(config.estimation.unit_label !== undefined ? { unit_label: config.estimation.unit_label } : {}),
      ...(config.estimation.scale !== undefined ? { scale: config.estimation.scale } : {}),
      ...(config.estimation.preset_values !== undefined ? { preset_values: [...config.estimation.preset_values] } : {}),
    };
  }
  return out;
}
