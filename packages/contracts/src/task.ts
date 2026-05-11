import { z } from "zod";

import { SlugKey, SprintKey } from "./brands.js";

/**
 * Date-or-timestamp string. Frontmatter date fields can be authored
 * either as `YYYY-MM-DD` (date only) or as a full ISO-8601 timestamp.
 * YAML's auto-Date coercion lands on the latter; this brand accepts
 * both forms and surfaces a clearer error than `string` would.
 */
const DateOrIsoString = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/,
    "must be YYYY-MM-DD or full ISO-8601 timestamp",
  );

/**
 * Full ISO-8601 timestamp. Used for `created_at` / `updated_at` /
 * `status_updated_at` / `archived_at` — fields the system writes,
 * never date-only.
 */
const IsoTimestamp = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/,
    "must be a full ISO-8601 timestamp",
  );

/** A single relationship edge stored in task frontmatter. */
export const TaskRelationshipSchema = z.object({
  type: z.string().min(1),
  target: z.string().min(1),
  /**
   * Lexorank string used to order the targets of a single
   * relationship type within one source task. Only set when the
   * relationship type is configured as `ranked: true` in the
   * workflow. Tasks without rank sort below ranked ones.
   */
  rank: z.string().min(1).optional(),
}).strict();
export type TaskRelationship = z.infer<typeof TaskRelationshipSchema>;

/**
 * Task frontmatter — the structured metadata stored in task.md
 * YAML. The schema is intentionally lenient on optional fields:
 * narrow types are enforced where possible, but `fields:` accepts
 * any object so custom-field shapes aren't rejected before
 * `validateTaskAgainstWorkflow` gets a chance to inspect them.
 */
export const TaskFrontmatterSchema = z.object({
  id: z.string().min(1),
  key: z.string().min(1),
  project: SlugKey.optional(),
  title: z.string().min(1),
  created_at: IsoTimestamp,
  updated_at: IsoTimestamp,
  status: z.string().optional(),
  status_updated_at: IsoTimestamp.optional(),
  task_type: z.string().optional(),
  priority: z.string().optional(),
  labels: z.array(SlugKey).optional(),
  assignee: z.string().optional(),
  reporter: z.string().optional(),
  start_date: DateOrIsoString.optional(),
  due_date: DateOrIsoString.optional(),
  estimate: z.union([z.string(), z.number()]).transform(v => String(v)).optional(),
  /**
   * Auto-managed: set when status moves into a `completed`-category
   * status; cleared when moved out. Not user-editable.
   */
  completed_date: DateOrIsoString.optional(),
  milestone: SlugKey.optional(),
  sprint: SprintKey.optional(),
  archived: z.boolean().optional(),
  archived_at: IsoTimestamp.optional(),
  relationships: z.array(TaskRelationshipSchema).optional(),
  key_history: z.array(z.string()).optional(),
  // Custom field values are user-defined and shape-varying per workflow
  // config; semantic validation runs in core (validateTaskAgainstWorkflow)
  // against the field's `type`, not at the contract layer.
  fields: z.record(z.string(), z.unknown()).optional(),
  /**
   * Lexorank string for manual drag-reorder within a board column.
   * Independent from relationship rank. Cards without `board_rank`
   * sort below ranked ones, fallback to created.
   */
  board_rank: z.string().optional(),
  // .passthrough(): unknown frontmatter keys are preserved on
  // round-trip rather than dropped. Authors may attach experimental
  // or tool-specific metadata; semantic checks live in core, and
  // discarding here would silently destroy that data.
}).passthrough();
export type TaskFrontmatter = z.infer<typeof TaskFrontmatterSchema>;

/** A full task: frontmatter + markdown body. */
export interface Task {
  readonly frontmatter: TaskFrontmatter;
  readonly body: string;
}
