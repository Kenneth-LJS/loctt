import { z } from "zod";

import { HexColor } from "./brands.js";

/**
 * Display-only icon identifier on a workflow entity. The UI renders this
 * as either a Lucide icon (when it matches a known catalog name) or
 * verbatim text (which is how emoji fallback works — they're just
 * strings). Core treats it as opaque: any non-empty, non-blank string
 * is accepted. Pure-whitespace identifiers are rejected so a hand-edited
 * yaml with `icon: "  "` can't slip past.
 */
export const IconStringSchema = z
  .string()
  .min(1)
  .regex(/\S/, "icon must contain at least one non-whitespace character");
export type IconString = z.infer<typeof IconStringSchema>;

/** Status categories used to group statuses semantically. */
export const StatusCategorySchema = z.enum(["pending", "active", "completed", "discarded"]);
export type StatusCategory = z.infer<typeof StatusCategorySchema>;

/** A single status definition from workflow.yaml. */
export const StatusDefSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  category: StatusCategorySchema,
  icon: IconStringSchema.optional(),
  color: HexColor.optional(),
}).strict();
export type StatusDef = z.infer<typeof StatusDefSchema>;

/** A single priority definition from workflow.yaml. */
export const PriorityDefSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  value: z.number().optional(),
  icon: IconStringSchema.optional(),
  color: HexColor.optional(),
}).strict();
export type PriorityDef = z.infer<typeof PriorityDefSchema>;

/** A single task type definition from workflow.yaml. */
export const TaskTypeDefSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  icon: IconStringSchema.optional(),
  color: HexColor.optional(),
}).strict();
export type TaskTypeDef = z.infer<typeof TaskTypeDefSchema>;

/** A single relationship type definition from workflow.yaml. */
export const RelationshipDefSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  inverse: z.string().min(1),
  inverse_label: z.string().min(1),
  structural: z.boolean().optional(),
  ranked: z.boolean().optional(),
  icon: IconStringSchema.optional(),
  color: HexColor.optional(),
}).strict();
export type RelationshipDef = z.infer<typeof RelationshipDefSchema>;

/** Supported custom field types. */
export const CustomFieldTypeSchema = z.enum(["string", "number", "date", "boolean", "enum"]);
export type CustomFieldType = z.infer<typeof CustomFieldTypeSchema>;

/** A single allowed value for an enum custom field. */
export const CustomFieldValueDefSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  value: z.number().optional(),
  icon: IconStringSchema.optional(),
  color: HexColor.optional(),
}).strict();
export type CustomFieldValueDef = z.infer<typeof CustomFieldValueDefSchema>;

/** A custom field definition from workflow.yaml. */
export const CustomFieldDefSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: CustomFieldTypeSchema,
  multi: z.boolean(),
  searchable: z.boolean(),
  values: z.array(CustomFieldValueDefSchema).optional(),
}).strict();
export type CustomFieldDef = z.infer<typeof CustomFieldDefSchema>;

/** Key prefix configuration from workflow.yaml. */
export const KeyConfigSchema = z.object({
  prefix: z.string().min(1),
}).strict();
export type KeyConfig = z.infer<typeof KeyConfigSchema>;

/**
 * Estimation system. Two modes:
 *  - **Numeric** (`points` / `hours` / `days` / `custom_numeric`):
 *    estimate values are numbers; aggregate as a sum.
 *  - **Enum** (`custom_enum`): estimate values are categorical
 *    (e.g. XS / S / M / L); aggregate as counts per category.
 *
 * Only relevant when `enabled: true`. UI hides the field otherwise.
 */
export const EstimationUnitSchema = z.enum([
  "points",
  "hours",
  "days",
  "custom_numeric",
  "custom_enum",
]);
export type EstimationUnit = z.infer<typeof EstimationUnitSchema>;

export const EstimationScaleSchema = z.enum(["free", "linear", "fibonacci"]);
export type EstimationScale = z.infer<typeof EstimationScaleSchema>;

/**
 * Optional per-category weight map for `custom_enum` estimation. When
 * present, every key must appear in `preset_values` and every value
 * must be a finite non-negative number. Burndown uses `sum(weights)`
 * when this is set; otherwise it falls back to a task-count remaining.
 * Ignored for non-enum units.
 *
 * An empty `weights: {}` is rejected — declare the map or omit it
 * entirely. A zero-entry map would silently produce a flat burndown,
 * which is almost certainly a config mistake rather than intent.
 */
export const EstimationWeightsSchema = z
  .record(z.string().min(1), z.number().finite().nonnegative())
  .refine(w => Object.keys(w).length > 0, {
    message: "weights must have at least one entry (omit the field to disable)",
  });
export type EstimationWeights = z.infer<typeof EstimationWeightsSchema>;

export const EstimationConfigSchema = z.object({
  enabled: z.boolean(),
  unit: EstimationUnitSchema,
  unit_label: z.string().min(1).optional(),
  scale: EstimationScaleSchema.optional(),
  preset_values: z.array(z.union([z.number(), z.string()])).optional(),
  weights: EstimationWeightsSchema.optional(),
}).strict().superRefine((cfg, ctx) => {
  // unit_label is required for custom_* units; preset_values is
  // required for custom_enum.
  if ((cfg.unit === "custom_numeric" || cfg.unit === "custom_enum") && cfg.unit_label === undefined) {
    ctx.addIssue({
      code: "custom",
      message: `unit_label is required when unit is ${cfg.unit}`,
      path: ["unit_label"],
    });
  }
  if (cfg.unit === "custom_enum" && (cfg.preset_values === undefined || cfg.preset_values.length === 0)) {
    ctx.addIssue({
      code: "custom",
      message: `preset_values is required (and non-empty) when unit is custom_enum`,
      path: ["preset_values"],
    });
  }
  // weights is only meaningful for custom_enum, and every weight key
  // must reference a declared preset value. preset_values stores numbers
  // or strings; coerce to strings for the membership check.
  //
  // When preset_values is missing/empty for custom_enum the dedicated
  // issue above already fires — skip the per-key check so we don't pile
  // a confusing "key not in preset_values" message on every weight
  // entry. Surface the real problem (missing preset_values) alone.
  if (cfg.weights !== undefined) {
    if (cfg.unit !== "custom_enum") {
      ctx.addIssue({
        code: "custom",
        message: `weights is only valid when unit is custom_enum (got ${cfg.unit})`,
        path: ["weights"],
      });
    } else if (cfg.preset_values !== undefined && cfg.preset_values.length > 0) {
      const presetKeys = new Set(cfg.preset_values.map(v => String(v)));
      for (const k of Object.keys(cfg.weights)) {
        if (!presetKeys.has(k)) {
          ctx.addIssue({
            code: "custom",
            message: `weights key '${k}' is not in preset_values`,
            path: ["weights", k],
          });
        }
      }
    }
  }
});
export type EstimationConfig = z.infer<typeof EstimationConfigSchema>;

/**
 * A board column groups one or more statuses under a single label, with
 * an optional WIP (work-in-progress) limit. When absent from
 * `workflow.yaml`, the UI renders one column per status (1:1). The
 * `wip` limit is a passive indicator only — the UI surfaces it as a
 * counter but core does not enforce it.
 */
export const BoardColumnDefSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  statuses: z.array(z.string().min(1)).min(1),
  wip: z.number().int().positive().optional(),
}).strict();
export type BoardColumnDef = z.infer<typeof BoardColumnDefSchema>;

/**
 * Optional board layout config. Empty `columns` is rejected — pick one
 * or omit. Column `key`s must be unique across the board (UI uses them
 * as React keys / drag-drop identifiers) and the flattened
 * `columns[].statuses` must be unique across all columns (a single
 * status can only belong to one column, otherwise drag-drop targets
 * become ambiguous).
 */
export const BoardsConfigSchema = z.object({
  columns: z.array(BoardColumnDefSchema).min(1),
}).strict().superRefine((cfg, ctx) => {
  const seenKeys = new Set<string>();
  const seenStatuses = new Map<string, number>();
  cfg.columns.forEach((col, i) => {
    if (seenKeys.has(col.key)) {
      ctx.addIssue({
        code: "custom",
        message: `duplicate column key '${col.key}'`,
        path: ["columns", i, "key"],
      });
    } else {
      seenKeys.add(col.key);
    }
    col.statuses.forEach((status, j) => {
      const prevColumn = seenStatuses.get(status);
      if (prevColumn !== undefined) {
        ctx.addIssue({
          code: "custom",
          message: `status '${status}' already appears in column index ${prevColumn}`,
          path: ["columns", i, "statuses", j],
        });
      } else {
        seenStatuses.set(status, i);
      }
    });
  });
});
export type BoardsConfig = z.infer<typeof BoardsConfigSchema>;

/**
 * Optional timeline (Gantt) config. `dependency_relationship` names the
 * relationship key whose links the timeline renders as dependency arrows
 * (e.g. "blocks"). When the key is deleted from `relationships`, the
 * workflow writer auto-clears this field in the same atomic write.
 */
export const TimelineConfigSchema = z.object({
  dependency_relationship: z.string().min(1).nullable().optional(),
}).strict();
export type TimelineConfig = z.infer<typeof TimelineConfigSchema>;

/** The full workflow.yaml shape. */
export const WorkflowConfigSchema = z.object({
  key: KeyConfigSchema,
  statuses: z.array(StatusDefSchema),
  priorities: z.array(PriorityDefSchema),
  task_types: z.array(TaskTypeDefSchema),
  relationships: z.array(RelationshipDefSchema),
  custom_fields: z.array(CustomFieldDefSchema),
  estimation: EstimationConfigSchema.optional(),
  boards: BoardsConfigSchema.optional(),
  timeline: TimelineConfigSchema.optional(),
}).strict();
export type WorkflowConfig = z.infer<typeof WorkflowConfigSchema>;
