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
  /**
   * Phase-7B: set when THIS side's value for the field is corrupt — the
   * side's task has a `health` finding on it, so `raw`/`display` above are
   * the degraded stand-in (the value was lifted out of frontmatter). The
   * reconcile UI marks the side ⚠ so the user does not merge a corrupt
   * value thinking it is merely empty. `rawText` is the stored corrupt
   * value; `error` is what was expected.
   */
  corrupt: z
    .object({ rawText: z.string(), error: z.string().min(1) })
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

/**
 * A task deleted on one side and edited on the other (GIT-16).
 *
 * Unlike {@link TaskConflictField}, this is a whole-TASK decision, not a
 * per-field one: the task is present on only one side (the editing side)
 * and absent on the other (the deleting side), so there are no two values
 * to reconcile — the choice is keep-the-deletion or keep-the-task.
 *
 * `deletedSide`/`editedSide` are always opposite (`"local"`/`"remote"`),
 * stated plainly so the surface can say which side did which. The decision
 * reuses {@link ReconcileDecision} with the reserved field
 * {@link DELETE_VS_EDIT_FIELD} and `choice`:
 *   - `choice === deletedSide` → keep the deletion (the task is removed);
 *   - `choice === editedSide`  → keep the task (its edited version stands).
 * Keeping the task does NOT reissue a colliding key silently — the
 * completing sync routes a collision through the K92 rekey gate (A193/A196).
 */
export const DeleteVsEditConflictSchema = z.object({
  /** The task's ULID — the stable identity a decision is applied by. */
  taskId: z.string().min(1),
  /** The user-facing key (`WEB-3`), for display and result reporting. */
  taskKey: z.string().min(1),
  /** The task title, for display; falls back to the key when degraded (K26). */
  taskTitle: z.string(),
  /** Which side deleted the task. */
  deletedSide: z.enum(["local", "remote"]),
  /** Which side edited the task (always the opposite of `deletedSide`). */
  editedSide: z.enum(["local", "remote"]),
}).strict();
export type DeleteVsEditConflict = z.infer<typeof DeleteVsEditConflictSchema>;

/**
 * The reserved `ReconcileDecision.field` a delete-vs-edit decision carries.
 * A task can have at most one such row, so a single reserved field per task
 * is unambiguous, and it can never collide with a real frontmatter field
 * (no field starts with `__`).
 */
export const DELETE_VS_EDIT_FIELD = "__delete_vs_edit__";

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
  /**
   * Tasks deleted on one side and edited on the other (GIT-16). Each is a
   * whole-task keep-deletion / keep-task decision, distinct from the
   * per-field `conflicts`. Empty on a plan with no delete-vs-edit case.
   */
  deleteVsEdit: z.array(DeleteVsEditConflictSchema).default([]),
  autoMerged: z.array(AutoMergedFieldSchema),
}).strict();
export type ReconcilePlan = z.infer<typeof ReconcilePlanSchema>;

/**
 * The rekey PREVIEW model (GIT-8, GIT-9).
 *
 * When a divergent sync leaves two offline-created tasks sharing one key,
 * one is renumbered. Today that runs silently inside the sync write; K92
 * requires the web UI to show this preview and WAIT for a confirm before
 * anything is written, while CLI/MCP auto-apply and report the same
 * outcome. The plan is computed PURELY — it applies nothing — so the
 * preview the UI shows and the rekey CLI/MCP apply are derived from one
 * source and cannot drift (the anti-drift invariant, like `builderTree`'s
 * round-trip discipline).
 *
 * One `RekeyLoser` per task that will be renumbered, each paired against
 * the keeper of its key. A collision of N tasks yields the keeper plus
 * N-1 losers.
 */

/**
 * Why the keeper kept the key — the deterministic tiebreak, stated so the
 * user sees the rule rather than an unexplained winner (GIT-8, GIT-9).
 *
 * - `created_at` — the keeper's `created_at` is strictly earlier.
 * - `ulid` — the two `created_at` values tied (or both are absent/degraded),
 *   so the lexicographically-lower ULID `id` decided (GIT-9).
 */
export const RekeyTiebreakSchema = z.enum(["created_at", "ulid"]);
export type RekeyTiebreak = z.infer<typeof RekeyTiebreakSchema>;

/** One task that will be renumbered, paired against the keeper of its key. */
export const RekeyLoserSchema = z.object({
  /** The colliding key both tasks currently hold (e.g. `WEB-14`). */
  key: z.string().min(1),
  /** The loser's ULID — the stable identity the rekey is applied by. */
  loserId: z.string().min(1),
  /** The loser's `created_at`, or `null` when absent/degraded (K26). */
  loserCreatedAt: z.string().nullable(),
  /** The keeper's ULID — the task that keeps `key`. */
  keeperId: z.string().min(1),
  /** The keeper's `created_at`, or `null` when absent/degraded. */
  keeperCreatedAt: z.string().nullable(),
  /** Which rule decided the keeper (GIT-8 states it; GIT-9 is the `ulid` case). */
  tiebreak: RekeyTiebreakSchema,
  /**
   * The key the loser will be renumbered to (e.g. `WEB-31`), taken from
   * the loser's own project counter. Present only when the plan can
   * allocate one — a loser whose project has no key counter cannot be
   * renumbered and appears in `skipped` instead.
   */
  newKey: z.string().min(1).optional(),
}).strict();
export type RekeyLoser = z.infer<typeof RekeyLoserSchema>;

/** A collision the plan could not resolve, and why (mirrors `RekeySkip`). */
export const RekeySkipSchema = z.object({
  taskId: z.string().min(1),
  key: z.string().min(1),
  reason: z.string().min(1),
}).strict();
export type RekeySkip = z.infer<typeof RekeySkipSchema>;

/**
 * The full preview a rekey surfaces: every task that will be renumbered
 * (with the keeper it lost to and the tiebreak that decided it), and any
 * collision that cannot be resolved. `losers` empty means no rekey is
 * needed and no confirm gate should appear.
 */
export const RekeyPlanSchema = z.object({
  losers: z.array(RekeyLoserSchema),
  skipped: z.array(RekeySkipSchema),
}).strict();
export type RekeyPlan = z.infer<typeof RekeyPlanSchema>;

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
