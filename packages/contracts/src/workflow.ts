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

/** The full workflow.yaml shape. */
export interface WorkflowConfig {
  readonly key: KeyConfig;
  readonly statuses: readonly StatusDef[];
  readonly priorities: readonly PriorityDef[];
  readonly task_types: readonly TaskTypeDef[];
  readonly relationships: readonly RelationshipDef[];
  readonly custom_fields: readonly CustomFieldDef[];
}
