/**
 * Task CRUD + history — read, list, create, field-update, delete.
 *
 * Domain errors (TaskUpdateError, TaskNotFoundError, …) surface as
 * errorResult through the dispatcher's outer catch, so per-handler
 * try/catches that just rethrow the same class are omitted.
 *
 * `create_task` retains the explicit withStateLock wrapper because
 * createTask in core consumes a state object the caller must
 * persist; the lock ensures that read/derive-key/save cycle is
 * atomic.
 */

import type { ArchivedScope, WorkflowConfig } from "@loctt/contracts";
import { effectiveInverseKey, isSymmetricRelationship } from "@loctt/contracts";
import {
  bodyToken,
  buildListContext,
  buildShowModel,
  bulkDelete,
  bulkMoveTasksToProject,
  bulkSetFields,
  computeProgressFromStatuses,
  createTask,
  DEFAULT_LIST_LIMIT,
  duplicateTask,
  exportTasksToCSV,
  exportTasksToJSON,
  filterForExport,
  filtersToScannableText,  getCurrentUser,
  listTasks,
  loadAllTasksDetailed,
  loadArchivedGuardConfigs,
  loadOptionalConfigs,
  loadProjectsConfig,
  loadState,
  lookupTask,
  readHistory,
  resolveCommentMentionsContext,
  resolveProjectIdForUser,
  resolveProjectIdFromInput,
  resolveView,
  saveState,
  setField,
  unsetField,
  withStateLock,
} from "@loctt/core";
import { z } from "zod";

import { requireConfirm } from "../runtime/confirm.js";
import { errorResult, text } from "../runtime/errors.js";
import {
  validateUnsetFieldArgs,
  validateUpdateTaskArgs,
} from "../runtime/fields.js";
import { assertWorkflowEnumKey } from "../runtime/workflow-assert.js";
import type { ToolDef } from "../types.js";

/**
 * Spreads `{ key: value }` when the arg is a non-empty string, else
 * nothing — so an absent optional field stays absent rather than
 * becoming `undefined`, which exactOptionalPropertyTypes rejects.
 */
function optionalString(
  args: Record<string, unknown>,
  key: string,
): Record<string, string> {
  const v = args[key];
  return typeof v === "string" && v !== "" ? { [key]: v } : {};
}

/**
 * The type key of the *child* side of the `graph: "tree"` axis — the
 * side a parent holds to point at its children (`child` by default,
 * whatever `inverse` renames it to). `undefined` when there is no tree
 * axis, or when it is symmetric. Config-driven, matching the CLI `show`
 * helper and the web panel — never a literal `"child"`.
 */
function treeChildSideKey(
  workflow: WorkflowConfig | undefined,
): string | undefined {
  const treeDef = workflow?.relationships.find(r => r.graph === "tree");
  if (treeDef === undefined) return undefined;
  if (isSymmetricRelationship(treeDef)) return undefined;
  return effectiveInverseKey(treeDef);
}

export const TOOLS: readonly ToolDef[] = [
  {
    name: "get_task",
    description: "Get a task by key or ID, optionally including the markdown body. Relationship targets are returned as user-facing keys (e.g. T-2); deleted targets carry `missing: true` and retain the raw ID in `target`, and a target that is on disk but unreadable carries `targetCorrupt: true` (with `missing: true` when it could not be parsed at all, without it when it loaded but has field-level `health`) so a corrupt link is distinct from a deleted one. When the body is included the result carries `body_token` — pass it as `expected_token` to `replace_task_body` / `append_task_body` so your write is refused rather than overwriting a concurrent edit. A task with direct children on the tree axis carries a `children` roll-up ({done, active, total, discarded}) — category-based, with discarded children excluded from `total`, matching milestone/sprint progress.",
    inputSchema: {
      ref: z.string().describe("Task key (e.g. T-1) or ID"),
      include_body: z.boolean().optional().describe("Whether to include the markdown body (default true)"),
    },
    handler: async ({ locttDir }, args) => {
      const ref = args["ref"] as string;
      const includeBody = (args["include_body"] as boolean | undefined) ?? true;
      const task = await lookupTask(locttDir, ref);
      // Load configs so extrinsic health (invalid_value / dangling) is
      // classified alongside intrinsic. archived-guard configs are a
      // structural superset of AuxConfigs, so they double as `aux`.
      const { workflowConfig } = await loadOptionalConfigs(locttDir);
      const aux = await loadArchivedGuardConfigs(locttDir);
      const model = await buildShowModel(locttDir, task, {
        ...(workflowConfig !== undefined ? { workflow: workflowConfig } : {}),
        aux,
      });
      const result: Record<string, unknown> = {
        ...model.task.frontmatter,
        // DEG-C2: an untitled task (title never set, or lifted whole into
        // `health`) shows its key where the title would go — never absent,
        // never "undefined". Mirrors the web and `list_tasks` (DEG-8). The
        // corrupt title, when that is why it is absent, still rides in
        // `health` below so the agent can repair it.
        title: model.task.frontmatter.title ?? model.task.frontmatter.key,
        relationships: model.relationships.map(r => ({
          type: r.type,
          target: r.missing ? r.target : r.resolvedKey ?? r.target,
          // Title and status save the agent a get_task per edge to
          // learn what a linked task actually is.
          ...(r.resolvedTitle !== undefined ? { title: r.resolvedTitle } : {}),
          ...(r.resolvedStatus !== undefined ? { status: r.resolvedStatus } : {}),
          ...(r.missing ? { missing: true } : {}),
          // DEG-C5: carry the corrupt flag so the four target states are
          // distinguishable on the wire, matching core and the web (DEG-15):
          //   healthy               → missing absent, targetCorrupt absent
          //   corrupt-but-present   → missing absent, targetCorrupt:true
          //   corrupt-unreadable    → missing:true,   targetCorrupt:true
          //   absent/deleted        → missing:true,   targetCorrupt absent
          // Without this an agent could not tell a repairable corrupt target
          // from a deleted one, and would act on the wrong remedy (P-4).
          ...(r.targetCorrupt === true ? { targetCorrupt: true } : {}),
        })),
        attachments: model.attachments.map(a => ({
          name: a.name,
          size: a.size,
          ...(a.mime !== undefined ? { mime: a.mime } : {}),
        })),
        // REL-49. An agent reading this tool must not be told "no
        // attachments" about a directory that could not be read — it
        // would act on the absence, which is the whole point of P-4
        // and of ERR-1.
        ...(model.attachmentsError !== undefined
          ? { attachmentsError: model.attachmentsError }
          : {}),
      };
      if (model.relationships.length === 0) {
        delete result["relationships"];
      }
      // Field-level health (proposal § 6): a degraded field is NOT in the
      // main object above — its stored value is `rawText`. `set_field`
      // replaces it, `unset_field` removes it. Omitted when the task is
      // clean; `raw` is omitted (rawText is the display form).
      if (model.task.health !== undefined && model.task.health.length > 0) {
        result["health"] = model.task.health.map(h => ({
          field: h.field,
          kind: h.kind,
          rawText: h.rawText,
          error: h.error,
          repair: h.repair,
        }));
      }
      // L4: a done/active/todo roll-up of this task's direct children, on
      // the child side of the tree axis (the inverse of `parent` — the
      // forward side points at ancestors). Config-driven and category-
      // based, mirroring the web meter and CLI `show`; discarded children
      // are excluded from `total` exactly as milestones do. Omitted when
      // there is no tree axis or no children, so an agent that sees
      // `children` can trust it means something.
      const childSideKey = treeChildSideKey(workflowConfig);
      if (childSideKey !== undefined && workflowConfig !== undefined) {
        const childStatuses = model.relationships
          .filter(r => r.type === childSideKey)
          .map(r => r.resolvedStatus);
        if (childStatuses.length > 0) {
          const p = computeProgressFromStatuses(childStatuses, workflowConfig);
          result["children"] = {
            done: p.done,
            active: p.active,
            total: p.total,
            discarded: p.discarded,
          };
        }
      }
      if (includeBody) {
        result["body"] = model.task.body;
        // K10. The agent cannot derive this: it is
        // sha256(updated_at + "\0" + body) truncated, so `updated_at`
        // alone is not enough. Handing it out here is what makes
        // "pass it if it's provided in params" possible on the write
        // tools — an agent that read the task holds the token.
        result["body_token"] = await bodyToken(locttDir, task.frontmatter.id);
      }
      return text(JSON.stringify(result, null, 2));
    },
  },
  {
    name: "list_tasks",
    description: "List tasks with optional query, view, and limit. Archived tasks are hidden by default (archived='active'); pass archived='archived' for only-archived or archived='all' for both. Saved views are respected as authored — they are not modified by this flag.",
    inputSchema: {
      query: z.string().optional().describe("Ad hoc query string"),
      view: z.string().optional().describe("Named saved view"),
      project: z.string().optional().describe("Filter to a specific project. AND-merges with `query` if both are supplied."),
      limit: z.number().optional().describe(`Max results (default ${DEFAULT_LIST_LIMIT})`),
      archived: z.enum(["active", "archived", "all"]).optional().describe("Archived scope (K107): 'active' (default, hide archived), 'archived' (only archived), 'all' (both). Ignored when a query already mentions `archived` (the query's term wins) or when a saved view is used."),
      sort: z.string().optional().describe("Field to order by, e.g. priority, due_date, updated_at. Priority orders by its configured value, not alphabetically."),
      direction: z.enum(["asc", "desc"]).optional().describe("Sort direction (default asc)."),
      offset: z.number().optional().describe("Rows to skip, for paging past the first `limit`."),
    },
    handler: async ({ locttDir }, args) => {
      // DEG-C1 (P10 parity with the web list and the CLI): load with the
      // unreadable trailer, not plain `loadAllTasks`. A field-local corrupt
      // task rides in `tasks` carrying `health` (so its row can be marked);
      // an object-fatal one cannot be a row at all and is reported in the
      // `unreadable[]` list below rather than silently dropped, so a
      // corpus of 50 does not read as 48 with nothing said.
      const { tasks, unreadable } = await loadAllTasksDetailed(locttDir);
      const { workflowConfig, queriesConfig, today, now, weekStartsOn } = await loadOptionalConfigs(locttDir);
      // K80: the configured current user, so `currentUser()` in a query
      // resolves to the caller's id. Undefined when none is set.
      const currentUser = await getCurrentUser(locttDir);
      const projectFilter = args["project"] as string | undefined;
      const baseQuery = args["query"] as string | undefined;
      const view = args["view"] as string | undefined;
      const limit = args["limit"] as number | undefined;
      const archivedScope = args["archived"] as ArchivedScope | undefined;
      // Core supported both from the start; only the web exposed them,
      // so an agent wanting "the highest-priority open task" had to
      // fetch everything and order it itself (QRY-C4).
      const sortField = args["sort"] as string | undefined;
      const direction = (args["direction"] as "asc" | "desc" | undefined) ?? "asc";
      const offset = args["offset"] as number | undefined;
      // A saved view referencing a since-deleted custom field runs
      // anyway, but matches less than its author intended. An agent
      // has no stderr to read, so surface it in the response — a bare
      // short list would otherwise read as a definitive answer.
      const warnings: string[] = [];
      // CMT-10: load comment mentions only when the query references them.
      const listViewQuery = view !== undefined && queriesConfig !== undefined
        ? filtersToScannableText(resolveView(queriesConfig, view)?.filters ?? [])
        : [];
      const listCtx = await resolveCommentMentionsContext(
        locttDir, tasks, buildListContext(tasks), [baseQuery, ...listViewQuery],
      );
      const result = listTasks({
        tasks,
        options: {
          ...(baseQuery !== undefined ? { query: baseQuery } : {}),
          ...(view !== undefined ? { view } : {}),
          // Limit is applied after the offset slice below, not here:
          // `listTasks` truncates before we can page, so every page
          // would return the same first `limit` rows (QRY-C5).
          ...(sortField !== undefined ? { sort: [{ field: sortField, direction }] } : {}),
          ...(projectFilter !== undefined ? { project: projectFilter } : {}),
          ...(archivedScope !== undefined ? { archivedScope } : {}),
          ...(today !== undefined ? { today } : {}),
          ...(now !== undefined ? { now } : {}),
          ...(weekStartsOn !== undefined ? { weekStartsOn } : {}),
          ...(currentUser !== null ? { currentUserId: currentUser.id } : {}),
        },
        ...(queriesConfig !== undefined ? { queriesConfig } : {}),
        ...(workflowConfig !== undefined ? { workflowConfig } : {}),
        ctx: listCtx,
        onWarning: err => warnings.push(err.message),
      });
      // `result` is now the full match set, so it is also the honest
      // total — a truncated list that does not say it was truncated
      // reads as a complete answer.
      const matched = result.length;
      const effectiveLimit = limit ?? DEFAULT_LIST_LIMIT;
      const start = offset ?? 0;
      const paged = result.slice(start, start + effectiveLimit);
      const summary = paged.map(t => ({
        key: t.frontmatter.key,
        // DEG-C2: an untitled task shows its key where the title would go,
        // never null/undefined. Mirrors the web list and get_task (DEG-8).
        title: t.frontmatter.title ?? t.frontmatter.key,
        status: t.frontmatter.status,
        priority: t.frontmatter.priority,
        // DEG-C1: mark a field-local corrupt row so the agent knows to
        // `get_task` it for the field-level `health`. Omitted when the task
        // is clean, so a healthy list is unchanged. The full findings ride
        // on `get_task`, not here — a list row carries a flag, not the
        // rawText of every bad field.
        ...((t.health?.length ?? 0) > 0 ? { health: true } : {}),
      }));
      const truncated = paged.length < matched;
      // DEG-C1: object-fatal tasks (on disk, unparseable) are named in an
      // `unreadable[]` list — not silently omitted. An agent reading a bare
      // array would take a short list as the whole tracker (P-4). Present
      // only when non-empty, so a clean tracker returns the plain shape.
      const unreadableList = unreadable.map(u => ({ id: u.id, path: u.path, reason: u.reason }));
      const needsEnvelope = truncated || unreadableList.length > 0;
      const body = JSON.stringify(
        needsEnvelope
          ? {
              ...(truncated ? { matched, returned: paged.length, offset: start } : {}),
              tasks: summary,
              ...(unreadableList.length > 0 ? { unreadable: unreadableList } : {}),
            }
          : summary,
        null,
        2,
      );
      return text(
        warnings.length > 0
          ? `Warning: saved view "${view ?? ""}" — ${warnings.join("; ")}\nResults may be incomplete.\n\n${body}`
          : body,
      );
    },
  },
  {
    name: "export_tasks",
    description:
      "Export tasks as CSV or JSON, mirroring the list view's export. Filters "
      + "(query, view, project) resolve the same rows as list_tasks; the CSV "
      + "column set, formula-injection escaping and array handling come from "
      + "core, so the output matches the web download for the same rows. This "
      + "is a report for a spreadsheet, not a backup — it cannot restore (use "
      + "the `backup` tool for that). The output is raw CSV/JSON text; tasks "
      + "that cannot be read are named in a `Warning:` line prepended to that "
      + "text rather than silently dropped.",
    inputSchema: {
      format: z.enum(["csv", "json"]).optional().describe("Output format (default csv)."),
      query: z.string().optional().describe("Ad hoc query string, as in list_tasks."),
      view: z.string().optional().describe("Named saved view."),
      project: z.string().optional().describe("Filter to a specific project (key/slug, name or id)."),
      columns: z.array(z.string()).optional()
        .describe("Explicit column list (built-in field names or `fields.<custom>`). Defaults to the standard export columns."),
      include_body: z.boolean().optional().describe("Include the markdown body (JSON field / CSV column). Default false."),
      include_archived: z.boolean().optional().describe("Include archived tasks (default false)."),
    },
    handler: async ({ locttDir }, args) => {
      const format = (args["format"] as "csv" | "json" | undefined) ?? "csv";
      const includeArchived = args["include_archived"] as boolean | undefined ?? false;
      const includeBody = args["include_body"] as boolean | undefined ?? false;
      const columns = args["columns"] as string[] | undefined;

      // Detailed load so an unparseable task is named rather than
      // silently omitted (BLK-44) — the same guarantee the web export
      // and the CLI export give.
      const { tasks, unreadable } = await loadAllTasksDetailed(locttDir);
      const { workflowConfig, queriesConfig, today, now, weekStartsOn } = await loadOptionalConfigs(locttDir);
      const baseQuery = args["query"] as string | undefined;
      const view = args["view"] as string | undefined;

      const projectArg = args["project"] as string | undefined;
      const projectFilter = projectArg === undefined
        ? undefined
        : resolveProjectIdFromInput(await loadProjectsConfig(locttDir), projectArg, {
            includeArchived,
          });

      const warnings: string[] = [];
      // CMT-10: gate the comment-mention scan on the query, as list_tasks does.
      const exportViewQuery = view !== undefined && queriesConfig !== undefined
        ? filtersToScannableText(resolveView(queriesConfig, view)?.filters ?? [])
        : [];
      const exportCtx = await resolveCommentMentionsContext(
        locttDir, tasks, buildListContext(tasks), [baseQuery, ...exportViewQuery],
      );
      const result = listTasks({
        tasks,
        options: {
          ...(baseQuery !== undefined ? { query: baseQuery } : {}),
          ...(view !== undefined ? { view } : {}),
          ...(projectFilter !== undefined ? { project: projectFilter } : {}),
          // filterForExport applies the archived filter below (parity with
          // the web + CLI export), so the query filter is left open (K107).
          archivedScope: "all",
          ...(today !== undefined ? { today } : {}),
          ...(now !== undefined ? { now } : {}),
          ...(weekStartsOn !== undefined ? { weekStartsOn } : {}),
          limit: Number.MAX_SAFE_INTEGER,
        },
        ...(queriesConfig !== undefined ? { queriesConfig } : {}),
        ...(workflowConfig !== undefined ? { workflowConfig } : {}),
        ctx: exportCtx,
        onWarning: err => warnings.push(err.message),
      });
      const filtered = filterForExport(result, includeArchived);
      const opts = {
        ...(columns ? { columns } : {}),
        ...(includeBody ? { includeBody: true } : {}),
      };
      const data = format === "json"
        ? exportTasksToJSON(filtered, opts)
        : exportTasksToCSV(filtered, opts);

      // The export body is returned as text. An agent cannot read a
      // download header, so unreadable paths ride in the response
      // prose — a short export that hid a bad row would read as a
      // complete answer (BLK-44, P-4).
      const notes: string[] = [];
      if (warnings.length > 0) {
        notes.push(`Warning: saved view "${view ?? ""}" — ${warnings.join("; ")}`);
      }
      if (unreadable.length > 0) {
        notes.push(
          `Warning: ${unreadable.length} task(s) could not be read and were ` +
          `omitted:\n${unreadable.map(u => `  ${u.path}`).join("\n")}`,
        );
      }
      return text(notes.length > 0 ? `${notes.join("\n")}\n\n${data}` : data);
    },
  },
  {
    name: "create_task",
    description: "Create a new task and allocate its key under the resolved project. When the tracker has multiple projects, pass `project` to disambiguate; otherwise the workspace default (or the only project) is used. Enum fields (status, priority, task_type) are validated against workflow.yaml before anything is written — an unknown key is rejected with the valid keys listed. Referencing an archived milestone, sprint, label, or user is refused by the archived-reference guard. Pass `parent` to pre-link the task under the tree axis in the same operation.",
    inputSchema: {
      title: z.string(),
      project: z.string().optional().describe("Project slug, id, or name. Optional when a default project is configured or only one project exists."),
      status: z.string().optional(),
      priority: z.string().optional(),
      task_type: z.string().optional(),
      body: z.string().optional(),
      // Core's createTask has accepted these from the start. Exposing a
      // narrower set meant an agent had to follow every create with
      // update_task calls, and the CLI accepted a different subset
      // again (TSK-C5).
      assignee: z.string().optional().describe("User id or name."),
      reporter: z.string().optional().describe("User id or name."),
      due_date: z.string().optional().describe("YYYY-MM-DD"),
      start_date: z.string().optional().describe("YYYY-MM-DD"),
      estimate: z.string().optional(),
      milestone: z.string().optional().describe("Milestone id or name."),
      sprint: z.string().optional().describe("Sprint id or name."),
      labels: z.array(z.string()).optional(),
      parent: z.string().optional().describe(
        "Parent task key or id. Pre-links the new task under the "
        + "configured tree relationship (the workflow's `graph: tree` "
        + "axis), so a create can build a hierarchy without a follow-up "
        + "link_tasks call.",
      ),
    },
    handler: async ({ locttDir }, args) => {
      const { workflowConfig } = await loadOptionalConfigs(locttDir);
      let projectKey: string;
      try {
        projectKey = await resolveProjectIdForUser(
          locttDir,
          args["project"] as string | undefined,
        );
      } catch (err) {
        return errorResult((err as Error).message);
      }
      const status = args["status"] as string | undefined;
      const priority = args["priority"] as string | undefined;
      const taskType = args["task_type"] as string | undefined;
      const body = args["body"] as string | undefined;
      const enumCheck = assertWorkflowEnumKey(workflowConfig, "status", status)
        ?? assertWorkflowEnumKey(workflowConfig, "priority", priority)
        ?? assertWorkflowEnumKey(workflowConfig, "task_type", taskType);
      if (enumCheck) return enumCheck;
      const archivedGuard = await loadArchivedGuardConfigs(locttDir);
      const task = await withStateLock(locttDir, async () => {
        const state = await loadState(locttDir);
        const created = await createTask({
          locttDir,
          state,
          ...(workflowConfig !== undefined ? { workflowConfig } : {}),
          archivedGuard,
          options: {
            project: projectKey,
            title: args["title"] as string,
            ...(status !== undefined ? { status } : {}),
            ...(priority !== undefined ? { priority } : {}),
            ...(taskType !== undefined ? { task_type: taskType } : {}),
            ...optionalString(args, "assignee"),
            ...optionalString(args, "reporter"),
            ...optionalString(args, "due_date"),
            ...optionalString(args, "start_date"),
            ...optionalString(args, "estimate"),
            ...optionalString(args, "milestone"),
            ...optionalString(args, "sprint"),
            ...(Array.isArray(args["labels"]) ? { labels: args["labels"] as string[] } : {}),
            ...(body !== undefined ? { body } : {}),
            ...optionalString(args, "parent"),
          },
        });
        await saveState(locttDir, state);
        return created;
      });
      return text(`Created ${task.frontmatter.key}: ${task.frontmatter.title}`);
    },
  },
  {
    name: "update_task",
    description:
      "Set a field on a task. Writable built-in fields: title, status, " +
      "task_type, priority, labels, assignee, reporter, start_date, due_date, " +
      "estimate, milestone, sprint. Any other field is treated as a custom " +
      "field (must be declared in workflow.yaml under custom_fields). " +
      "These fields are managed elsewhere and rejected here: id, key, " +
      "created_at, project (immutable); relationships (use link_tasks / " +
      "unlink_tasks); archived / archived_at (use archive_task / " +
      "unarchive_task); status_updated_at (auto-stamped on status change); " +
      "completed_date and board_rank (auto-managed).",
    inputSchema: {
      ref: z.string().describe("Task key or ID"),
      field: z.string(),
      value: z.unknown().describe("The value to set"),
    },
    handler: async ({ locttDir }, args) => {
      const invalid = validateUpdateTaskArgs(args);
      if (invalid) return invalid;
      const task = await lookupTask(locttDir, args["ref"] as string);
      const { workflowConfig } = await loadOptionalConfigs(locttDir);
      const archivedGuard = await loadArchivedGuardConfigs(locttDir);
      const field = args["field"] as string;
      const value = args["value"];
      const updated = await setField({
        locttDir,
        taskId: task.frontmatter.id,
        field,
        value,
        ...(workflowConfig !== undefined ? { workflowConfig } : {}),
        archivedGuard,
      });
      return text(`Updated ${updated.frontmatter.key}: set ${field} = ${JSON.stringify(value)}`);
    },
  },
  {
    name: "unset_field",
    description:
      "Remove a field from a task. Same allowlist as update_task: writable " +
      "built-ins (status/priority/etc.) and declared custom fields. The " +
      "system-managed fields rejected by update_task are also rejected here. " +
      "title and updated_at cannot be unset (they are required).",
    inputSchema: {
      ref: z.string().describe("Task key or ID"),
      field: z.string(),
    },
    handler: async ({ locttDir }, args) => {
      const invalid = validateUnsetFieldArgs(args);
      if (invalid) return invalid;
      const task = await lookupTask(locttDir, args["ref"] as string);
      const field = args["field"] as string;
      const updated = await unsetField(locttDir, task.frontmatter.id, field);
      return text(`Updated ${updated.frontmatter.key}: unset ${field}`);
    },
  },
  {
    name: "move_task",
    description:
      "Move one or more tasks to another project. The key is reallocated " +
      "under the target project; the old key is retired into key_history " +
      "and stays resolvable, so existing references keep working. Pass " +
      "several refs to move them as one operation.",
    inputSchema: {
      refs: z.array(z.string()).min(1).max(500).describe("Task keys or IDs"),
      project: z.string().describe("Target project key or ID"),
    },
    handler: async ({ locttDir }, args) => {
      const refs = args["refs"] as string[];
      const project = args["project"] as string;
      try {
        const targetProjectId = await resolveProjectIdForUser(locttDir, project);
        const result = await bulkMoveTasksToProject({
          locttDir, taskRefs: refs, targetProjectId,
        });
        const lines = [`Moved ${result.succeeded.length}, failed ${result.failed.length}`];
        for (const s of result.succeeded) lines.push(`  ${s.oldKey} → ${s.newKey}`);
        for (const f of result.failed) lines.push(`  ${f.taskId}: ${f.error}`);
        return text(lines.join("\n"));
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  },
  {
    name: "duplicate_task",
    description:
      "Create a copy of a task with a fresh key. Copies title (suffixed " +
      "\"(copy)\" unless overridden), status, priority, type, assignee, " +
      "reporter, dates, estimate, milestone, sprint, labels, custom fields " +
      "and body. Deliberately does NOT copy relationships, attachments, or " +
      "archived state — the copy starts unlinked and active.",
    inputSchema: {
      ref: z.string().describe("Task key or ID to copy"),
      title: z.string().optional().describe("Title for the copy; defaults to '<source> (copy)'"),
      project: z.string().optional().describe("Target project; defaults to the source's"),
    },
    handler: async ({ locttDir }, args) => {
      const { workflowConfig } = await loadOptionalConfigs(locttDir);
      const archivedGuard = await loadArchivedGuardConfigs(locttDir);
      const title = args["title"] as string | undefined;
      const projectArg = args["project"] as string | undefined;
      // Resolve a name to its id (P-3). The CLI twin was fixed earlier;
      // this one still forwarded the raw string, so an agent passing
      // "Backend" got `no key allocation state for entity type
      // "Backend"` — an allocator internal, and identical to what a
      // nonexistent project produced.
      let project: string | undefined;
      if (projectArg !== undefined) {
        const projectsConfig = await loadProjectsConfig(locttDir);
        project = resolveProjectIdFromInput(projectsConfig, projectArg);
      }
      try {
        const { task: created, dropped } = await withStateLock(locttDir, async () => {
          const state = await loadState(locttDir);
          const result = await duplicateTask({
            locttDir,
            state,
            sourceRef: args["ref"] as string,
            ...(workflowConfig !== undefined ? { workflowConfig } : {}),
            archivedGuard,
            overrides: {
              ...(title !== undefined ? { title } : {}),
              ...(project !== undefined ? { project } : {}),
            },
          });
          await saveState(locttDir, state);
          return result;
        });
        // DUP-H1: tell the agent which corrupt source fields were not
        // copied, so it does not assume the copy is a faithful clone.
        const note = dropped.length > 0
          ? ` (${String(dropped.length)} corrupt source field(s) not copied: ${dropped.join(", ")})`
          : "";
        return text(`Created ${created.frontmatter.key}: ${created.frontmatter.title}${note}`);
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  },
  {
    name: "bulk_update_tasks",
    description:
      "Set or clear one field across many tasks in a single operation. " +
      "Prefer this over repeated update_task calls when changing the same " +
      "field on several tasks: it runs under one lock, stamps every " +
      "history entry with a shared bulk_op_id so the change reads as one " +
      "action, and reports per-task outcomes instead of failing at the " +
      "first bad ref. Omit `value` (or pass null) to CLEAR the field. " +
      "Same field allowlist as update_task.",
    inputSchema: {
      refs: z.array(z.string()).min(1).max(500)
        .describe("Task keys or IDs. Capped at 500 — one bulk op holds the tracker lock for its whole run."),
      field: z.string(),
      value: z.unknown().optional()
        .describe("The value to set. Omit or pass null to clear the field."),
    },
    handler: async ({ locttDir }, args) => {
      const refs = args["refs"] as string[];
      const field = args["field"] as string;
      const raw = args["value"];
      const { workflowConfig } = await loadOptionalConfigs(locttDir);
      const archivedGuard = await loadArchivedGuardConfigs(locttDir);
      const result = await bulkSetFields({
        locttDir,
        taskRefs: refs,
        // null and omitted both mean "clear" — core reads `undefined`
        // as the unset, and JSON cannot carry undefined.
        changes: [{ field, value: raw === null ? undefined : raw }],
        ...(workflowConfig !== undefined ? { workflowConfig } : {}),
        archivedGuard,
      });
      const lines = [
        `${result.succeeded.length} updated, ${result.failed.length} failed (bulk_op_id ${result.bulk_op_id})`,
      ];
      for (const f of result.failed) lines.push(`  ${f.taskId}: ${f.error}`);
      return text(lines.join("\n"));
    },
  },
  {
    name: "delete_task",
    description:
      "Permanently remove one or more task directories. Use `archive_task` " +
      "for the reversible (soft) variant. Always requires `confirm: true`. " +
      "Pass several refs to delete them as one operation (a single lock, a " +
      "shared bulk_op_id); a bad ref is reported without aborting the rest. " +
      "This is irreversible — there is no history entry, because the file it " +
      "would live in is deleted with the task.",
    inputSchema: {
      refs: z.array(z.string()).min(1).max(500)
        .describe("Task keys or IDs. Capped at 500 — one bulk op holds the tracker lock for its whole run."),
      confirm: z.boolean().optional().describe("Required: must be true to proceed"),
    },
    handler: async ({ locttDir }, args) => {
      const blocked = requireConfirm(args, "delete_task");
      if (blocked) return blocked;
      const refs = args["refs"] as string[];
      const result = await bulkDelete({ locttDir, taskRefs: refs });
      const lines = [
        `Deleted ${result.succeeded.length}, failed ${result.failed.length} (bulk_op_id ${result.bulk_op_id})`,
      ];
      for (const f of result.failed) lines.push(`  ${f.taskId}: ${f.error}`);
      // Any failed ref is an error (parity with the CLI's non-zero exit).
      return result.failed.length > 0 ? errorResult(lines.join("\n")) : text(lines.join("\n"));
    },
  },
  {
    name: "get_task_history",
    description:
      "Get the activity/history log for a task. Returns structured entries (newest first), " +
      "paginated: `{ entries, total, offset, limit }`. `total` is the full count so an agent " +
      "knows how much history remains beyond the page; `offset` skips that many entries from " +
      "the newest end, so `offset` + `limit` walk a long history without gaps or repeats. " +
      "When the history file has hand-broken rows that cannot be read as entries, an " +
      "`incomplete` count is included — the readable rows are still returned, but the log is " +
      "known to be partial.",
    inputSchema: {
      ref: z.string().describe("Task key (e.g. T-1) or ID"),
      limit: z.number().int().nonnegative().optional().describe("Max entries to return (default: all)"),
      offset: z.number().int().nonnegative().optional().describe("Entries to skip from the newest end (default: 0)"),
    },
    handler: async ({ locttDir }, args) => {
      const task = await lookupTask(locttDir, args["ref"] as string);
      const limit = args["limit"] as number | undefined;
      const offset = args["offset"] as number | undefined;
      // Use core's paginating overload rather than read-all → reverse →
      // slice: it applies newest-first order, offset and limit in one
      // place (the single source of truth CLI and web share), and returns
      // `total` so the caller can tell "the newest N" from "all there is"
      // (CMT-C4). Without offset here an agent could read the newest page
      // and never reach anything older.
      const page = await readHistory(locttDir, task.frontmatter.id, {
        order: "desc",
        ...(limit !== undefined ? { limit } : {}),
        ...(offset !== undefined ? { offset } : {}),
      });
      return text(JSON.stringify({
        entries: page.entries,
        total: page.total,
        offset: offset ?? 0,
        ...(limit !== undefined ? { limit } : {}),
        // DEG-C7: rows that could not be read as entries are kept in the
        // file but excluded from `entries`/`total`. Report the count so an
        // agent knows the log is incomplete rather than taking the readable
        // subset as the whole history (P10 parity with the web activity
        // feed's `unreadable`). Present only when non-zero.
        ...(page.incomplete > 0 ? { incomplete: page.incomplete } : {}),
      }, null, 2));
    },
  },
];
