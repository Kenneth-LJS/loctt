import { z } from "zod";

/**
 * The conflict-DETAIL model for git reconciliation (GIT-6, GIT-11,
 * GIT-13, GIT-14).
 *
 * `three-way.ts` classifies whole *files*; `merge.ts` resolves task
 * frontmatter last-write-wins. Neither carries what the reconciliation
 * panel needs: which task, which field, the local and remote values,
 * whether the field is enum-typed, and whether a value references a
 * status/label/task that no longer exists locally (drift). This is that
 * model — computed in core, serialised over the API, rendered by the
 * panel, and echoed by CLI/MCP so all three surfaces answer the same
 * question the same way.
 *
 * A conflict is per-FIELD, not per-task: `WEB-3`'s title and status
 * conflicting produce two rows, each independently resolvable (GIT-6).
 * The panel groups rows by task for display (GIT-12), but the unit of a
 * decision is one field.
 */

/**
 * How a field's value is presented and picked.
 *
 * - `scalar` — a plain string/number/date/boolean (title, due_date, a
 *   `string`/`number`/`date`/`boolean` custom field). pick-value is a
 *   free-text box.
 * - `enum` — a built-in enum (`status`, `priority`, `task_type`) or an
 *   `enum`-typed custom field. Values render as their configured label,
 *   and pick-value offers the declared options (GIT-11).
 * - `relationship_parent` — the `parent` edge. Values render as task
 *   key + title, and pick-value is a task picker (GIT-13).
 */
export const ConflictFieldKindSchema = z.enum([
  "scalar",
  "enum",
  "relationship_parent",
]);
export type ConflictFieldKind = z.infer<typeof ConflictFieldKindSchema>;

/**
 * One side's value for a conflicting field.
 *
 * `raw` is what is stored (an enum key, a ULID, a scalar). `display` is
 * what the user should see — the enum label, or a task's `key · title`,
 * falling back to `raw` when nothing resolves it. `drift`, when present,
 * says the raw value references something absent from local config
 * (GIT-14: a status deleted from `workflow.yaml`) — the value renders
 * with a marker rather than blank, and keeping it is allowed with a
 * warning.
 */
export const ConflictValueSchema = z.object({
  /** The stored value: an enum key, a ULID, or a scalar. `null` = the field is unset on this side. */
  raw: z.unknown(),
  /** Human-facing rendering: enum label, `key · title`, or a stringified scalar. */
  display: z.string(),
  /** Set when `raw` references a config entry or task absent locally (GIT-14). */
  drift: z
    .object({ reason: z.string().min(1) })
    .optional(),
}).strict();
export type ConflictValue = z.infer<typeof ConflictValueSchema>;

/** A pick-value option for an enum or task-picker field. */
export const ConflictOptionSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
}).strict();
export type ConflictOption = z.infer<typeof ConflictOptionSchema>;

/**
 * One conflicting field on one task — a single panel row and a single
 * decision.
 */
export const TaskConflictFieldSchema = z.object({
  /** The task's ULID — the stable identity a decision is applied by. */
  taskId: z.string().min(1),
  /** The user-facing key (`WEB-3`), for display and result reporting. */
  taskKey: z.string().min(1),
  /** The task title, for the grouped display (GIT-12) and relationship rows (GIT-13). */
  taskTitle: z.string(),
  /**
   * The frontmatter field. Built-ins are bare (`title`, `status`,
   * `due_date`, `parent`); a custom field is `fields.<key>` (GIT-11's
   * `fields.team`).
   */
  field: z.string().min(1),
  /** Human label for the field (`Status`, `Team`, `Parent`). */
  fieldLabel: z.string().min(1),
  kind: ConflictFieldKindSchema,
  local: ConflictValueSchema,
  remote: ConflictValueSchema,
  /**
   * pick-value options for `enum`/`relationship_parent`. Only values
   * that actually exist locally (GIT-14: a deleted status is offered on
   * neither side). Absent for `scalar`.
   */
  options: z.array(ConflictOptionSchema).optional(),
}).strict();
export type TaskConflictField = z.infer<typeof TaskConflictFieldSchema>;

/** A field that merged or converged without a conflict, named so the result can mention it (GIT-5, GIT-17). */
export const AutoMergedFieldSchema = z.object({
  taskKey: z.string().min(1),
  /** Field labels that auto-merged (a union) or converged (identical both sides). */
  fields: z.array(z.string().min(1)),
  /** `union` = different keys merged (GIT-5); `converged` = both sides picked the same value (GIT-17). */
  kind: z.enum(["union", "converged"]),
}).strict();
export type AutoMergedField = z.infer<typeof AutoMergedFieldSchema>;

/**
 * The full report a reconciliation surfaces: what conflicts (needs a
 * decision) and what auto-merged (reported, not asked).
 *
 * When `conflicts` is empty the sync completed without opening the
 * panel; `autoMerged` still names the tasks touched so the merge is
 * visible rather than silent (GIT-5, GIT-17).
 */
export const ReconcilePlanSchema = z.object({
  mode: z.enum(["publish", "sync"]),
  base_commit: z.string(),
  remote_commit: z.string(),
  conflicts: z.array(TaskConflictFieldSchema),
  autoMerged: z.array(AutoMergedFieldSchema),
}).strict();
export type ReconcilePlan = z.infer<typeof ReconcilePlanSchema>;

/** A user's choice for one conflicting field. */
export const ConflictChoiceSchema = z.enum(["local", "remote", "value"]);
export type ConflictChoice = z.infer<typeof ConflictChoiceSchema>;

/**
 * A recorded decision for one field — persisted to `reconcile.yaml` so
 * the panel survives navigation, reload, and a browser restart (GIT-26),
 * and a partial Apply is resumable (GIT-32).
 *
 * `choice: "value"` carries the typed/picked third value in `value`
 * (GIT-6/GIT-7). Identity is `taskId` + `field`.
 */
export const ReconcileDecisionSchema = z.object({
  taskId: z.string().min(1),
  field: z.string().min(1),
  choice: ConflictChoiceSchema,
  /** Present only for `choice: "value"` — the picked/typed value (raw form). */
  value: z.unknown().optional(),
}).strict();
export type ReconcileDecision = z.infer<typeof ReconcileDecisionSchema>;
