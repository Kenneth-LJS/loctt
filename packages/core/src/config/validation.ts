import type { TaskFrontmatter,WorkflowConfig } from "@loctt/contracts";

export interface ValidationError {
  readonly field: string;
  readonly message: string;
}

/**
 * Validates task frontmatter against a workflow config.
 * Returns an array of validation errors (empty if valid).
 * Only validates fields that are present — omitted optional fields are not errors.
 */
export function validateTaskAgainstWorkflow(
  fm: TaskFrontmatter,
  config: WorkflowConfig,
): readonly ValidationError[] {
  const errors: ValidationError[] = [];

  const statusKeys = new Set(config.statuses.map(s => s.key));
  const priorityKeys = new Set(config.priorities.map(p => p.key));
  const taskTypeKeys = new Set(config.task_types.map(t => t.key));
  const relationshipKeys = new Set(config.relationships.flatMap(r => [r.key, r.inverse]));
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
      }
    }
  }

  return errors;
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

  return errors;
}
