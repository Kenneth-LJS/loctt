import type {
  LabelsConfig,
  MilestonesConfig,
  ProjectsConfig,
  SprintsConfig,
  TaskFrontmatter,
  WorkflowConfig,
} from "@loctt/contracts";
import { relationshipTypeKeys } from "@loctt/contracts";

export interface ValidationError {
  readonly field: string;
  readonly message: string;
}

/**
 * Optional sibling configs that contribute additional reference
 * checks beyond the core workflow (statuses, priorities, etc.).
 * Pass whichever ones the caller has loaded.
 */
export interface AuxConfigs {
  readonly projects?: ProjectsConfig;
  readonly labels?: LabelsConfig;
  readonly milestones?: MilestonesConfig;
  readonly sprints?: SprintsConfig;
}

/**
 * Validates task frontmatter against a workflow config.
 * Returns an array of validation errors (empty if valid).
 * Only validates fields that are present — omitted optional fields are not errors.
 */
export function validateTaskAgainstWorkflow(
  fm: TaskFrontmatter,
  config: WorkflowConfig,
  aux: AuxConfigs = {},
): readonly ValidationError[] {
  const errors: ValidationError[] = [];

  const statusKeys = new Set(config.statuses.map(s => s.key));
  const priorityKeys = new Set(config.priorities.map(p => p.key));
  const taskTypeKeys = new Set(config.task_types.map(t => t.key));
  const relationshipKeys = new Set(config.relationships.flatMap(relationshipTypeKeys));
  const customFieldDefs = new Map(config.custom_fields.map(f => [f.key, f]));

  if (fm.status !== undefined && !statusKeys.has(fm.status)) {
    errors.push({
      field: "status",
      message: `unknown status "${fm.status}"; valid: ${[...statusKeys].join(", ")}`,
    });
  }

  if (fm.priority !== undefined && !priorityKeys.has(fm.priority)) {
    errors.push({
      field: "priority",
      message: `unknown priority "${fm.priority}"; valid: ${[...priorityKeys].join(", ")}`,
    });
  }

  if (fm.task_type !== undefined && !taskTypeKeys.has(fm.task_type)) {
    errors.push({
      field: "task_type",
      message: `unknown task_type "${fm.task_type}"; valid: ${[...taskTypeKeys].join(", ")}`,
    });
  }

  if (fm.relationships) {
    for (const [i, rel] of fm.relationships.entries()) {
      if (!relationshipKeys.has(rel.type)) {
        errors.push({
          field: `relationships[${i}].type`,
          message: `unknown relationship type "${rel.type}"; valid: ${[...relationshipKeys].join(", ")}`,
        });
      }
    }
  }

  if (aux.projects && fm.project !== undefined) {
    const known = new Set(aux.projects.projects.map(p => p.id));
    if (!known.has(fm.project)) {
      errors.push({
        field: "project",
        message: `unknown project "${fm.project}"; valid: ${[...known].join(", ") || "(none)"}`,
      });
    }
  }

  if (aux.milestones && fm.milestone !== undefined) {
    const known = new Set(aux.milestones.milestones.map(m => m.id));
    if (!known.has(fm.milestone)) {
      errors.push({
        field: "milestone",
        message: `unknown milestone "${fm.milestone}"; valid: ${[...known].join(", ") || "(none)"}`,
      });
    }
  }

  if (aux.sprints && fm.sprint !== undefined) {
    const known = new Set(aux.sprints.sprints.map(s => s.id));
    if (!known.has(fm.sprint)) {
      errors.push({
        field: "sprint",
        message: `unknown sprint "${fm.sprint}"; valid: ${[...known].join(", ") || "(none)"}`,
      });
    }
  }

  if (fm.labels !== undefined && !Array.isArray(fm.labels)) {
    // Shape before membership. This used to be unreachable because the
    // labels branch only ran under `aux`, which no write path passed —
    // so a non-array reached `.entries()` and crashed with
    // "fm.labels.entries is not a function" instead of saying what was
    // wrong.
    errors.push({
      field: "labels",
      message: `labels must be an array, got: ${typeof fm.labels}`,
    });
  } else if (aux.labels && fm.labels !== undefined) {
    const known = new Set(aux.labels.labels.map(l => l.id));
    for (const [i, k] of fm.labels.entries()) {
      if (!known.has(k)) {
        errors.push({
          field: `labels[${i}]`,
          message: `unknown label "${k}"; valid: ${[...known].join(", ") || "(none)"}`,
        });
      }
    }
  }

  if (fm.fields) {
    for (const [key, value] of Object.entries(fm.fields)) {
      const def = customFieldDefs.get(key);
      if (!def) {
        errors.push({
          field: `fields.${key}`,
          message: `unknown custom field "${key}"; declared: ${[...customFieldDefs.keys()].join(", ") || "(none)"}`,
        });
        continue;
      }

      if (def.type === "enum" && def.values) {
        const allowedValues = new Set(def.values.map(v => v.key));
        if (def.multi) {
          if (!Array.isArray(value)) {
            errors.push({
              field: `fields.${key}`,
              message: `multi enum field must be an array`,
            });
          } else {
            for (const item of value) {
              if (typeof item !== "string" || !allowedValues.has(item)) {
                errors.push({
                  field: `fields.${key}`,
                  message: `invalid enum value "${String(item)}"; valid: ${[...allowedValues].join(", ")}`,
                });
              }
            }
          }
        } else {
          if (typeof value !== "string" || !allowedValues.has(value)) {
            errors.push({
              field: `fields.${key}`,
              message: `invalid enum value "${String(value)}"; valid: ${[...allowedValues].join(", ")}`,
            });
          }
        }
      } else if (def.type === "string" || def.type === "number"
              || def.type === "date" || def.type === "boolean") {
        // Strict per-type validation for non-enum fields.
        //
        // `multi: true` for any type means the value must be an
        // array whose elements all satisfy the per-type predicate;
        // `multi: false` means a single value satisfying the same
        // predicate.
        const checkItem = (v: unknown): string | undefined => {
          switch (def.type) {
            case "string":
              return typeof v === "string"
                ? undefined
                : `expected string, got ${typeof v}`;
            case "number":
              return typeof v === "number" && Number.isFinite(v)
                ? undefined
                : `expected finite number, got ${describeType(v)}`;
            case "boolean":
              return typeof v === "boolean"
                ? undefined
                : `expected boolean, got ${typeof v}`;
            case "date":
              return typeof v === "string" && DATE_RE.test(v)
                ? undefined
                : `expected YYYY-MM-DD date string, got ${describeType(v)}`;
            default:
              return undefined;
          }
        };
        if (def.multi) {
          if (!Array.isArray(value)) {
            errors.push({
              field: `fields.${key}`,
              message: `multi ${def.type} field must be an array`,
            });
          } else {
            for (const [i, item] of value.entries()) {
              const err = checkItem(item);
              if (err) {
                errors.push({
                  field: `fields.${key}[${i}]`,
                  message: err,
                });
              }
            }
          }
        } else {
          const err = checkItem(value);
          if (err) {
            errors.push({ field: `fields.${key}`, message: err });
          }
        }
      }
    }
  }

  return errors;
}

/** YYYY-MM-DD matcher for `date`-typed custom fields. */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Human-readable description of a value's runtime type. `typeof null`
 * is "object" which is misleading; this surface flags `null` and
 * `array` distinctly so error messages are useful.
 */
function describeType(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

/**
 * Validates a workflow config for internal consistency.
 * Checks for duplicate keys, inverse relationship symmetry, etc.
 */
export function validateWorkflowConfig(config: WorkflowConfig): readonly ValidationError[] {
  const errors: ValidationError[] = [];

  // Check for duplicate status keys
  const statusKeys = new Set<string>();
  for (const s of config.statuses) {
    if (statusKeys.has(s.key)) {
      errors.push({ field: "statuses", message: `duplicate status key "${s.key}"` });
    }
    statusKeys.add(s.key);
  }

  // Check for duplicate priority keys
  const priorityKeys = new Set<string>();
  for (const p of config.priorities) {
    if (priorityKeys.has(p.key)) {
      errors.push({ field: "priorities", message: `duplicate priority key "${p.key}"` });
    }
    priorityKeys.add(p.key);
  }

  // Check for duplicate task type keys
  const taskTypeKeys = new Set<string>();
  for (const t of config.task_types) {
    if (taskTypeKeys.has(t.key)) {
      errors.push({ field: "task_types", message: `duplicate task_type key "${t.key}"` });
    }
    taskTypeKeys.add(t.key);
  }

  // Check for duplicate relationship keys
  const relKeys = new Set<string>();
  for (const r of config.relationships) {
    if (relKeys.has(r.key)) {
      errors.push({ field: "relationships", message: `duplicate relationship key "${r.key}"` });
    }
    relKeys.add(r.key);
  }

  // Check for duplicate custom field keys
  const fieldKeys = new Set<string>();
  for (const f of config.custom_fields) {
    if (fieldKeys.has(f.key)) {
      errors.push({ field: "custom_fields", message: `duplicate custom field key "${f.key}"` });
    }
    fieldKeys.add(f.key);
  }

  // Board columns naming a status that no longer exists. The schema
  // checks a column's own shape and that statuses are not shared
  // between columns, but nothing checked them against `statuses` — so
  // deleting a status left a column that renders permanently empty,
  // with no card able to reach it and nothing saying why.
  for (const [i, col] of (config.boards?.columns ?? []).entries()) {
    for (const key of col.statuses) {
      if (!statusKeys.has(key)) {
        errors.push({
          field: `boards.columns[${String(i)}].statuses`,
          message:
            `column "${col.key}" lists status "${key}", which is not in `
            + `statuses. The column would render permanently empty`,
        });
      }
    }
  }

  // A relationship whose `inverse` names a key that is itself a
  // declared relationship is a collision: linking would write an edge
  // the other definition also claims, and unlinking cannot tell which
  // one the user meant.
  for (const r of config.relationships) {
    if (r.inverse !== undefined && r.inverse !== r.key && relKeys.has(r.inverse)) {
      errors.push({
        field: "relationships",
        message:
          `relationship "${r.key}" declares inverse "${r.inverse}", which is `
          + `itself a declared relationship. The two would write the same edge`,
      });
    }
  }

  return errors;
}
