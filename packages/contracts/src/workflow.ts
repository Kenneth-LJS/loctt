/** Status categories used to group statuses semantically. */
export type StatusCategory = "pending" | "active" | "completed" | "discarded";

/** A single status definition from workflow.yaml. */
export interface StatusDef {
  readonly key: string;
  readonly label: string;
  readonly category: StatusCategory;
}

/** A single priority definition from workflow.yaml. */
export interface PriorityDef {
  readonly key: string;
  readonly label: string;
  readonly value?: number;
}

/** A single task type definition from workflow.yaml. */
export interface TaskTypeDef {
  readonly key: string;
  readonly label: string;
}

/** A single relationship type definition from workflow.yaml. */
export interface RelationshipDef {
  readonly key: string;
  readonly label: string;
  readonly inverse: string;
  readonly inverse_label: string;
  readonly structural?: boolean;
  /**
   * If true, links of this type carry a `rank` field used to order
   * targets within one source task. UI surfaces drag handles for
   * ranked relationships.
   */
  readonly ranked?: boolean;
}

/** Supported custom field types. */
export type CustomFieldType = "string" | "number" | "date" | "boolean" | "enum";

/** A single allowed value for an enum custom field. */
export interface CustomFieldValueDef {
  readonly key: string;
  readonly label: string;
  readonly value?: number;
}

/** A custom field definition from workflow.yaml. */
export interface CustomFieldDef {
  readonly key: string;
  readonly label: string;
  readonly type: CustomFieldType;
  readonly multi: boolean;
  readonly searchable: boolean;
  readonly values?: readonly CustomFieldValueDef[];
}

/** Key prefix configuration from workflow.yaml. */
export interface KeyConfig {
  readonly prefix: string;
}

/**
 * Estimation system. Two modes:
 *  - **Numeric** (`points` / `hours` / `days` / `custom_numeric`):
 *    estimate values are numbers; aggregate as a sum.
 *  - **Enum** (`custom_enum`): estimate values are categorical
 *    (e.g. XS / S / M / L); aggregate as counts per category.
 *
 * Only relevant when `enabled: true`. UI hides the field otherwise.
 */
export type EstimationUnit =
  | "points"
  | "hours"
  | "days"
  | "custom_numeric"
  | "custom_enum";

export type EstimationScale = "free" | "linear" | "fibonacci";

export interface EstimationConfig {
  readonly enabled: boolean;
  readonly unit: EstimationUnit;
  /** Required for `custom_numeric` and `custom_enum`. */
  readonly unit_label?: string;
  /** Numeric units only. */
  readonly scale?: EstimationScale;
  /**
   * For numeric units: optional preset values (e.g. fibonacci).
   * For `custom_enum`: required list of category labels in order
   *   (e.g. `["XS", "S", "M", "L", "XL"]`).
   */
  readonly preset_values?: readonly (number | string)[];
}

/** The full workflow.yaml shape. */
export interface WorkflowConfig {
  readonly key: KeyConfig;
  readonly statuses: readonly StatusDef[];
  readonly priorities: readonly PriorityDef[];
  readonly task_types: readonly TaskTypeDef[];
  readonly relationships: readonly RelationshipDef[];
  readonly custom_fields: readonly CustomFieldDef[];
  /** Optional estimation config. Defaults to `{ enabled: false }`. */
  readonly estimation?: EstimationConfig;
}
