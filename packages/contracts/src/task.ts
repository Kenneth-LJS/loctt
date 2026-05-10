import { z } from "zod";

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
  project: z.string().min(1).optional(),
  title: z.string().min(1),
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
  status: z.string().optional(),
  status_updated_at: z.string().optional(),
  task_type: z.string().optional(),
  priority: z.string().optional(),
  labels: z.array(z.string()).optional(),
  assignee: z.string().optional(),
  reporter: z.string().optional(),
  start_date: z.string().optional(),
  due_date: z.string().optional(),
  estimate: z.union([z.string(), z.number()]).transform(v => String(v)).optional(),
  /**
   * Auto-managed: set when status moves into a `completed`-category
   * status; cleared when moved out. Not user-editable.
   */
  completed_date: z.string().optional(),
  milestone: z.string().optional(),
  sprint: z.string().optional(),
  archived: z.boolean().optional(),
  archived_at: z.string().optional(),
  relationships: z.array(TaskRelationshipSchema).optional(),
  key_history: z.array(z.string()).optional(),
  fields: z.record(z.string(), z.unknown()).optional(),
  /**
   * Lexorank string for manual drag-reorder within a board column.
   * Independent from relationship rank. Cards without `board_rank`
   * sort below ranked ones, fallback to created.
   */
  board_rank: z.string().optional(),
}).passthrough();
export type TaskFrontmatter = z.infer<typeof TaskFrontmatterSchema>;

/** A full task: frontmatter + markdown body. */
export interface Task {
  readonly frontmatter: TaskFrontmatter;
  readonly body: string;
}
