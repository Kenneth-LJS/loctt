import { z } from "zod";

/** Status categories used to group statuses semantically. */
export const StatusCategorySchema = z.enum(["pending", "active", "completed", "discarded"]);
export type StatusCategory = z.infer<typeof StatusCategorySchema>;

/** A single status definition from workflow.yaml. */
export const StatusDefSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  category: StatusCategorySchema,
}).strict();
export type StatusDef = z.infer<typeof StatusDefSchema>;

/** A single priority definition from workflow.yaml. */
export const PriorityDefSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  value: z.number().optional(),
}).strict();
export type PriorityDef = z.infer<typeof PriorityDefSchema>;

/** A single task type definition from workflow.yaml. */
export const TaskTypeDefSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
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

export const EstimationConfigSchema = z.object({
  enabled: z.boolean(),
  unit: EstimationUnitSchema,
  unit_label: z.string().min(1).optional(),
  scale: EstimationScaleSchema.optional(),
  preset_values: z.array(z.union([z.number(), z.string()])).optional(),
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
});
export type EstimationConfig = z.infer<typeof EstimationConfigSchema>;

/** The full workflow.yaml shape. */
export const WorkflowConfigSchema = z.object({
  key: KeyConfigSchema,
  statuses: z.array(StatusDefSchema),
  priorities: z.array(PriorityDefSchema),
  task_types: z.array(TaskTypeDefSchema),
  relationships: z.array(RelationshipDefSchema),
  custom_fields: z.array(CustomFieldDefSchema),
  estimation: EstimationConfigSchema.optional(),
}).strict();
export type WorkflowConfig = z.infer<typeof WorkflowConfigSchema>;
