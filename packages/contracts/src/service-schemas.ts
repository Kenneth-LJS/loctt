/**
 * Zod schemas for HTTP API request bodies.
 *
 * These mirror the TS interfaces in `service.ts` but exist as
 * runtime validators so the web server can verify request shapes
 * before forwarding them to core. Without this layer, handlers
 * cast incoming JSON to a core function's parameter type — which
 * is a TypeScript fiction that says nothing about what actually
 * arrived on the wire.
 *
 * Keep these schemas in sync with the `Request` interfaces in
 * `service.ts` and the core function signatures they feed. When
 * a core function's input shape changes, the schema here is the
 * single point where the HTTP boundary acknowledges the change.
 *
 * Server handlers should:
 *   const parsed = SomeRequestSchema.safeParse(body);
 *   if (!parsed.success) { 400 with parsed.error.issues; return; }
 *   const r = parsed.data;
 */

import { z } from "zod";

import { EntityColorSchema } from "./color.js";
import { ArchivedScopeSchema, FilterSchema, QuerySortSchema } from "./query.js";
import { IconStringSchema, WorkflowConfigSchema } from "./workflow.js";

/**
 * Body of `POST /api/query/validate`.
 *
 * Deliberately allows an *empty* string, unlike the view schemas: the
 * advanced editor validates on every settle, and a box the user has
 * just cleared must come back as an ordinary "invalid" marker rather
 * than a shape rejection the editor has to special-case.
 */
export const ValidateQueryRequestSchema = z.object({
  query: z.string(),
}).strict();
export type ValidateQueryRequest = z.infer<typeof ValidateQueryRequestSchema>;

/**
 * Body of `POST /api/views`. Mirrors `core/views/manage.CreateViewInput`.
 *
 * A view carries an ORDERED list of filters (K102), each either a `simple`
 * field/op/values filter or an `advanced` DSL string. All three surfaces
 * author the same shape — there is no separate "web sends structure, CLI
 * sends DSL" split any more, and no derived canonical query string.
 *
 * `filters` may be empty (a view that matches everything in its scope).
 */
export const CreateViewRequestSchema = z.object({
  name: z.string().min(1),
  filters: z.array(FilterSchema),
  sort: z.array(QuerySortSchema).optional(),
  archivedScope: ArchivedScopeSchema.optional(),
  icon: IconStringSchema.optional(),
  /** K103's three-shape colour. See `SavedQuerySchema.color`. */
  color: EntityColorSchema.optional(),
}).strict();
export type CreateViewRequest = z.infer<typeof CreateViewRequestSchema>;

/**
 * Body of `PATCH /api/views/:ref`. Mirrors `core/views/manage.EditViewInput`.
 *
 * `sort: null` is the explicit "clear sort" signal — distinct from
 * `sort: undefined` (leave unchanged). The schema accepts both.
 *
 * `filters` replaces the whole ordered list when present; omitting it
 * leaves the view's filters untouched. There is no partial-filter patch:
 * order is meaningful (K102), so the client sends the list it wants.
 */
export const EditViewRequestSchema = z.object({
  name: z.string().min(1).optional(),
  filters: z.array(FilterSchema).optional(),
  sort: z.array(QuerySortSchema).nullable().optional(),
  archivedScope: ArchivedScopeSchema.optional(),
  icon: IconStringSchema.nullable().optional(),
  /** `null` clears the colour; omitting it leaves the view's colour alone. */
  color: EntityColorSchema.nullable().optional(),
  /**
   * Explicit opt-in to REPLACE a broken entry — one whose stored filters
   * did not load, so `queries.yaml` still holds its original text
   * (K102-broken-repair). Without it a write aimed at such an entry is
   * rejected with a message naming the view and what the flag does.
   *
   * It has NO effect on a healthy view: the gate is on the resolved
   * entry, never on the flag, so the ordinary edit path is unchanged
   * whether the flag is sent or not.
   */
  replaceBroken: z.boolean().optional(),
}).strict();
export type EditViewRequest = z.infer<typeof EditViewRequestSchema>;

/**
 * Body of `PUT /api/workflow`. Carries the full replacement
 * workflow config plus an optional `remap` table describing how to
 * rewrite tasks that reference keys being removed/renamed.
 *
 * The `remap` shape mirrors core's `WorkflowRemap`. Source keys
 * are validated against the existing `prev` config at the apply
 * step; here we only enforce shape.
 */
const WorkflowRemapTableSchema = z.record(z.string(), z.string().nullable());
export const PutWorkflowRequestSchema = z.object({
  workflow: WorkflowConfigSchema,
  remap: z.object({
    statuses: WorkflowRemapTableSchema.optional(),
    priorities: WorkflowRemapTableSchema.optional(),
    task_types: WorkflowRemapTableSchema.optional(),
    relationships: WorkflowRemapTableSchema.optional(),
    custom_fields: z.record(z.string(), WorkflowRemapTableSchema).optional(),
  }).optional(),
}).strict();
export type PutWorkflowRequest = z.infer<typeof PutWorkflowRequestSchema>;

/**
 * Body of `POST /api/init`.
 *
 * `projectLabel` maps to core's `InitOptions.projectName` — the name
 * of the starting project. There is deliberately no `projectKey`:
 * `projects.yaml` stores `{id, name, prefix}` with no slug field, so
 * a key could never be honoured. It was previously declared here and
 * silently discarded; being absent from a `.strict()` schema means a
 * caller sending it now gets a validation error instead.
 */
export const InitRequestSchema = z.object({
  prefix: z.string().optional(),
  projectLabel: z.string().optional(),
  docs: z.boolean().optional(),
}).strict();
export type InitRequest = z.infer<typeof InitRequestSchema>;

/**
 * Task references for a bulk operation. Ids or keys; each is resolved
 * at the time of the lock.
 *
 * Capped so one request cannot hold the tracker-wide state lock
 * indefinitely — every bulk op runs under a single lock, which is what
 * makes the batch consistent but also makes an unbounded batch a
 * denial of service against every other writer.
 */
/**
 * Most tasks one bulk request may carry.
 *
 * Exported so a surface can state the limit *before* sending (BLK-47)
 * rather than letting a validator rejection be the first the user hears
 * of it — a Zod message is jargon ERR-16 keeps out of user-facing copy.
 */
export const MAX_BULK_REFS = 500;

const BulkTaskRefsSchema = z.array(z.string().min(1)).min(1).max(MAX_BULK_REFS);

/**
 * Body of `POST /api/tasks/bulk/set`.
 *
 * `value: null` clears the field. JSON has no `undefined`, which is
 * what core's `SetFieldsEntry` uses for an unset, so the route maps
 * null → undefined. That mapping is the only reason a separate
 * "bulk unset" endpoint is unnecessary.
 */
export const BulkSetRequestSchema = z.object({
  refs: BulkTaskRefsSchema,
  changes: z.array(z.object({
    field: z.string().min(1),
    value: z.unknown(),
  })).min(1),
}).strict();
export type BulkSetRequest = z.infer<typeof BulkSetRequestSchema>;

/** Body of `POST /api/tasks/bulk/archive`. */
export const BulkArchiveRequestSchema = z.object({
  refs: BulkTaskRefsSchema,
  archive: z.boolean(),
}).strict();
export type BulkArchiveRequest = z.infer<typeof BulkArchiveRequestSchema>;

/**
 * Body of `POST /api/tasks/bulk/delete`.
 *
 * `confirm` must be the literal string "DELETE". The UI already gates
 * this behind a typed confirmation (BLK-11); requiring it in the body
 * too means a stray or replayed POST cannot permanently remove tasks,
 * and the server is not relying on the client having asked.
 */
export const BulkDeleteRequestSchema = z.object({
  refs: BulkTaskRefsSchema,
  confirm: z.literal("DELETE"),
}).strict();
export type BulkDeleteRequest = z.infer<typeof BulkDeleteRequestSchema>;

/** Body of `POST /api/tasks/bulk/move`. */
export const BulkMoveRequestSchema = z.object({
  refs: BulkTaskRefsSchema,
  project: z.string().min(1),
}).strict();
export type BulkMoveRequest = z.infer<typeof BulkMoveRequestSchema>;

/** Body of `POST /api/tasks/bulk/link`. */
export const BulkLinkRequestSchema = z.object({
  refs: BulkTaskRefsSchema,
  type: z.string().min(1),
  target: z.string().min(1),
}).strict();
export type BulkLinkRequest = z.infer<typeof BulkLinkRequestSchema>;

/** Body of `POST /api/tasks/:ref/comments`. */
export const PostCommentRequestSchema = z.object({
  body: z.string().min(1),
}).strict();
export type PostCommentRequest = z.infer<typeof PostCommentRequestSchema>;

/** Body of `PUT /api/tasks/:ref/comments/:id`. */
export const EditCommentRequestSchema = z.object({
  body: z.string().min(1),
}).strict();
export type EditCommentRequest = z.infer<typeof EditCommentRequestSchema>;

/**
 * Body of `POST /api/doctor/repair` — the one programmatic repair action to
 * run (K-diagnostics-repair). Mirrors a finding's `fix` value: not a blanket
 * "repair all" (core has no such action).
 */
export const DoctorRepairRequestSchema = z.object({
  action: z.enum(["rebuild-index", "restore-missing"]),
}).strict();
export type DoctorRepairRequest = z.infer<typeof DoctorRepairRequestSchema>;
