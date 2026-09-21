import type { ArchivedScope, QueriesConfig, Task, WorkflowConfig } from "@loctt/contracts";
import { DEFAULT_ARCHIVED_SCOPE } from "@loctt/contracts";

import { QueriesConfigError } from "../config/queries.js";
import { listComments } from "../task/comments.js";
import { readField } from "../task/mutable.js";
import type { EvalContext } from "./evaluator.js";
import { evaluateQuery } from "./evaluator.js";
import { parseQuery } from "./parser.js";
import { tokenize } from "./tokenizer.js";
import { QueryValidationError, validateQuery } from "./validate.js";

/**
 * Default page size for `listTasks` when the caller doesn't supply
 * `limit`. Exposed so surface descriptions (CLI help, MCP tool
 * `limit` schema, HTTP API docs) can reference the same constant
 * and stay in sync if it ever changes.
 */
export const DEFAULT_LIST_LIMIT = 30;

/** Filter/sort options within a list call. */
export interface ListOptions {
  /** Ad hoc query string. */
  readonly query?: string;
  /** Named saved view from queries.yaml. */
  readonly view?: string;
  /** Sort specifiers. Overrides view sort if provided. */
  readonly sort?: readonly { field: string; direction: "asc" | "desc" }[];
  /** Maximum number of results. Defaults to {@link DEFAULT_LIST_LIMIT}. */
  readonly limit?: number;
  /**
   * The archived scope (K107). `active` (default) hides archived tasks by
   * ANDing `archived != true` onto the effective query; `archived` shows
   * ONLY archived (`archived = true`); `all` applies no archived filter.
   *
   * Precedence: when the user-provided query already mentions `archived`,
   * the user's term wins and NO scope filter is injected — the scope
   * effectively resolves to `all` for that call. When that happens under a
   * non-`all` requested scope it is a CONFLICT, surfaced via
   * {@link ListOptions.onArchivedConflict} rather than silently resolved.
   *
   * Saved views (`view`) are respected as authored — the scope is not
   * injected into a view's own query here (a view carries its own scope
   * once K102 lands; today a view's stored query decides).
   */
  readonly archivedScope?: ArchivedScope;
  /**
   * Project filter. When set, only tasks with this project key are
   * returned. Applied as a post-query filter against `frontmatter.project`
   * (rather than concatenated into the query string) so callers can
   * pass user-controlled project keys without escaping concerns. Like
   * `includeArchived`, this is *not* applied when `view` is set — saved
   * views are respected as authored.
   */
  readonly project?: string;
  /**
   * Today's date as `YYYY-MM-DD` in the workspace timezone, used to
   * resolve the `today` literal in queries. Callers derive it with
   * `todayInZone(calendar.timezone)`.
   *
   * Resolved once per list call rather than per task, so a list that
   * straddles midnight compares every task against the same date.
   * Defaults to the UTC date when absent.
   */
  readonly today?: string;
  /**
   * The querying user's id, used to resolve `currentUser()` in a query
   * (K80) — e.g. `assignee = currentUser()`. Each surface supplies its
   * own notion of "current user" (the web session, the CLI's configured
   * user, MCP's caller). When absent, `currentUser()` matches nothing.
   */
  readonly currentUserId?: string;
  /**
   * K80: full ISO-8601 timestamp for `now()`, in the workspace clock.
   * Derived once per list call like `today`. Defaults to the real UTC now.
   */
  readonly now?: string;
  /**
   * K80: first day of the week (0=Sun..6=Sat) for `startOfWeek`/
   * `endOfWeek`, from `calendar.first_day_of_week`. Defaults to Monday.
   */
  readonly weekStartsOn?: number;
}

/** Full options bag for listTasks. */
export interface ListTasksOptions {
  readonly tasks: readonly Task[];
  readonly options: ListOptions;
  readonly queriesConfig?: QueriesConfig;
  readonly workflowConfig?: WorkflowConfig;
  readonly ctx?: ListContext;
  /**
   * Called instead of throwing when a *saved view's* query fails
   * semantic validation — e.g. it references a custom field that has
   * since been deleted. Such a view used to work, so it keeps running
   * and returns what it matches; the caller decides how to surface the
   * problem. Ad hoc queries throw instead.
   */
  readonly onWarning?: (err: QueryValidationError) => void;
  /**
   * Called when the requested {@link ListOptions.archivedScope} conflicts
   * with an explicit `archived` term in the user's query (e.g. scope
   * `active` but the query says `archived = true`). The user's term wins
   * (scope resolves to `all` for the call); this callback lets a surface
   * warn that the flag was overridden rather than resolving it silently
   * (K107). Not called when the scope is `all`, or when the query does not
   * mention `archived`.
   */
  readonly onArchivedConflict?: (scope: ArchivedScope) => void;
}

/** Context provider for building EvalContext per task. */
export interface ListContext {
  /** Returns the body for a given task ID. */
  readonly getBody?: (taskId: string) => string | undefined;
  /** Resolves a task ID to its key. */
  readonly resolveKey?: (id: string) => string | undefined;
  /**
   * CMT-10: returns the merged set of user ids mentioned across a task's
   * comments, or undefined when no mention data was loaded for it. Sibling
   * of {@link getBody}: it feeds `EvalContext.commentMentions` so
   * `comment_mentions = currentUser()` can match without the evaluator
   * reading `_comments.yaml`.
   *
   * Unlike `getBody`/`resolveKey`, this cannot be built from the in-memory
   * task array (comments live in a separate file), so `buildListContext`
   * does not populate it. A surface loads it with `loadCommentMentions`
   * (an async, gated step) and merges the result into the context it
   * passes to `listTasks`.
   */
  readonly getCommentMentions?: (taskId: string) => readonly string[] | undefined;
}

/**
 * Builds a ListContext with a resolveKey function from a task array.
 * This enables parent-key queries like `parent = T-5` in list surfaces.
 */
export function buildListContext(tasks: readonly Task[]): ListContext {
  const idToKey = new Map<string, string>();
  const idToBody = new Map<string, string>();
  for (const task of tasks) {
    idToKey.set(task.frontmatter.id, task.frontmatter.key);
    idToBody.set(task.frontmatter.id, task.body);
  }
  return {
    resolveKey: (id: string) => idToKey.get(id),
    // `text ~ q` searches the body, but no caller ever supplied
    // getBody — so body search was documented and reachable in the
    // evaluator while matching nothing on every surface. The bodies are
    // already in memory on these very tasks, so wiring it here costs a
    // map rather than any extra I/O.
    getBody: (id: string) => idToBody.get(id),
  };
}

/**
 * Resolves a view ref — an id or a unique name — from queries config.
 * Returns undefined if nothing matches.
 *
 * Matching on `name` alone was wrong twice over (QRY-C6). Names are not
 * unique, so `find` silently picked whichever entry came first and ran a
 * different view than the caller meant, with exit 0 and no warning. And
 * because ids were not accepted, the documented escape hatch — "refer by
 * id instead", which `findView` tells the user — did not work here.
 *
 * Ambiguity throws rather than guessing: running the wrong view is worse
 * than refusing, because nothing about the output says it happened.
 */
export function resolveView(
  queriesConfig: QueriesConfig,
  ref: string,
): QueriesConfig["queries"][number] | undefined {
  const byId = queriesConfig.queries.find(q => q.id === ref);
  if (byId) return byId;
  const byName = queriesConfig.queries.filter(q => q.name === ref);
  if (byName.length > 1) {
    throw new Error(
      `multiple views named '${ref}'; refer by id instead `
      + `(${byName.map(q => q.id).join(", ")})`,
    );
  }
  return byName[0];
}

/**
 * Result envelope for paginated task listing. `total` is the count
 * *before* applying `limit`, so the UI can show "1-50 of 128".
 */
export interface ListTasksResult {
  readonly items: Task[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

/**
 * Filters, sorts, and paginates tasks. Returns the page of items
 * plus the unsliced count and the effective limit/offset.
 *
 * `offset` defaults to 0 and is taken from `options.offset` when present
 * (which is not currently surfaced on ListTasksOptions; callers that
 * paginate beyond the first page pass it via the same options bag).
 */
export function listTasksPaginated(opts: ListTasksOptions & { offset?: number }): ListTasksResult {
  const filtered = applyListTasksFilterAndSort(opts);
  const offset = Math.max(0, opts.offset ?? 0);
  const limit = opts.options.limit ?? DEFAULT_LIST_LIMIT;
  return {
    items: filtered.slice(offset, offset + limit),
    total: filtered.length,
    limit,
    offset,
  };
}

/**
 * Filters and sorts tasks according to ListOptions.
 * Applies query filtering, sorting, and limit.
 *
 * Legacy single-array return. Prefer `listTasksPaginated` for UI
 * surfaces that need the unsliced count.
 */
export function listTasks(opts: ListTasksOptions): Task[] {
  const filtered = applyListTasksFilterAndSort(opts);
  const limit = opts.options.limit ?? DEFAULT_LIST_LIMIT;
  return filtered.slice(0, limit);
}

/**
 * Returns the filtered + sorted task list before any limit/offset is
 * applied. Shared by `listTasks` and `listTasksPaginated`.
 */
/**
 * Every enum value the given tasks actually store.
 *
 * Feeds the validator's `inUse` set: a status or type deleted from the
 * config while tasks still reference it must stay queryable, or the
 * affected rows become unreachable (LST-24). Cheap — one pass over
 * tasks already in memory.
 */
function storedEnumValues(tasks: readonly Task[]): ReadonlySet<string> {
  const out = new Set<string>();
  for (const t of tasks) {
    const fm = t.frontmatter;
    if (fm.status !== undefined) out.add(fm.status);
    if (fm.priority !== undefined) out.add(fm.priority);
    if (fm.task_type !== undefined) out.add(fm.task_type);
  }
  return out;
}

function applyListTasksFilterAndSort(opts: ListTasksOptions): Task[] {
  const { tasks, options, queriesConfig, workflowConfig, ctx = {} } = opts;
  let queryStr: string | undefined = options.query;
  let sortSpec = options.sort;
  let usedView = false;
  // Distinct from `usedView`: a caller can pass `--view` *and*
  // `--query`, in which case the query is the user's own typing and a
  // typo in it should still throw. Only a query that actually came
  // from the saved view gets the lenient treatment.
  let queryFromView = false;

  // Resolve view if specified
  if (options.view) {
    if (!queriesConfig) {
      throw new QueriesConfigError(
        `Cannot use --view '${options.view}': no queries.yaml found.`,
      );
    }
    const view = resolveView(queriesConfig, options.view);
    if (!view) {
      throw new Error(`unknown view "${options.view}"`);
    }
    if (!queryStr) {
      queryStr = view.query;
      queryFromView = true;
    }
    if (!sortSpec && view.sort) sortSpec = view.sort;
    usedView = true;
  }

  // Semantic validation runs against the query *as authored*, before
  // the archived-wrapping below rewrites it. Validating the rewritten
  // string would report positions shifted by the `(` prefix, so a UI
  // underlining the error would point one character off.
  //
  // Severity differs by origin. A query the user just typed is a
  // mistake worth stopping on. A saved view referencing a
  // since-deleted custom field is a pre-existing tracker that used to
  // work — breaking `loctt list --view x` outright would be a
  // regression, so it warns and runs, returning whatever it matches.
  // Callers surface `onWarning` (a banner in the UI, a stderr line in
  // the CLI).
  if (queryStr) {
    try {
      validateQuery(
        parseQuery(tokenize(queryStr)),
        workflowConfig
          ? { workflow: workflowConfig, inUse: storedEnumValues(opts.tasks) }
          : {},
      );
    } catch (err) {
      if (!(err instanceof QueryValidationError)) throw err;
      if (!queryFromView) throw err;
      opts.onWarning?.(err);
    }
  }

  // Archived scope (K107). Saved views are respected as authored (the scope
  // is not injected into a view's own query). For ad-hoc queries:
  //  - `active`   → AND `archived != true` (hide archived) — the default.
  //  - `archived` → AND `archived = true`  (only archived).
  //  - `all`      → inject nothing.
  // When the user's own query mentions `archived`, their term wins and
  // nothing is injected; if the requested scope was not `all`, that is a
  // conflict surfaced via `onArchivedConflict` (the flag was overridden).
  const scope: ArchivedScope = options.archivedScope ?? DEFAULT_ARCHIVED_SCOPE;
  if (!usedView && scope !== "all") {
    const mentions = queryStr !== undefined && queryMentionsArchived(queryStr);
    if (mentions) {
      // User's term wins; report the conflict rather than double-filtering.
      opts.onArchivedConflict?.(scope);
    } else {
      const term = scope === "active" ? "archived != true" : "archived = true";
      queryStr = queryStr === undefined || queryStr === ""
        ? term
        : `(${queryStr}) and ${term}`;
    }
  }

  // Filter by query
  let filtered: Task[];
  if (queryStr) {
    const tokens = tokenize(queryStr);
    const ast = parseQuery(tokens);
    filtered = tasks.filter(task => {
      const body = ctx.getBody?.(task.frontmatter.id);
      const commentMentions = ctx.getCommentMentions?.(task.frontmatter.id);
      const evalCtx: EvalContext = {
        ...(body !== undefined ? { body } : {}),
        ...(commentMentions !== undefined ? { commentMentions } : {}),
        ...(ctx.resolveKey !== undefined ? { resolveKey: ctx.resolveKey } : {}),
        ...(workflowConfig !== undefined ? { workflow: workflowConfig } : {}),
        ...(options.today !== undefined ? { today: options.today } : {}),
        ...(options.currentUserId !== undefined ? { currentUserId: options.currentUserId } : {}),
        ...(options.now !== undefined ? { now: options.now } : {}),
        ...(options.weekStartsOn !== undefined ? { weekStartsOn: options.weekStartsOn } : {}),
      };
      return evaluateQuery(ast, task.frontmatter, evalCtx);
    });
  } else {
    filtered = [...tasks];
  }

  // Project filter applied as a structured post-query step. Skipped
  // when a saved view is in play, matching the includeArchived
  // policy: views are respected as authored.
  if (options.project !== undefined && !usedView) {
    filtered = filtered.filter(t => t.frontmatter.project === options.project);
  }

  // Sort
  if (sortSpec && sortSpec.length > 0) {
    const priorityMap = buildPriorityMap(workflowConfig);
    // SET-8: custom enum fields sort by their configured value weights
    // (XS=1, S=2, M=3, L=5), not alphabetically. Keyed by the sort field
    // token as it arrives (`fields.<key>`), so `compareTasks` can look up
    // the right weight map without re-deriving the field name.
    const enumWeightMaps = buildCustomFieldWeightMaps(workflowConfig);

    filtered.sort((a, b) => {
      for (const spec of sortSpec) {
        const cmp = compareTasks(a, b, spec.field, spec.direction, priorityMap, enumWeightMaps);
        if (cmp !== 0) return cmp;
      }
      return 0;
    });
  } else {
    // Default sort: most recently updated first. updated_at is optional
    // now (K26); a task with a degraded timestamp sorts as "" (oldest),
    // which lands it at the end of a most-recent-first list.
    filtered.sort((a, b) =>
      (b.frontmatter.updated_at ?? "").localeCompare(a.frontmatter.updated_at ?? ""),
    );
  }

  return filtered;
}

/**
 * Returns true if the query string references the `archived` field.
 * Uses the tokenizer to avoid false positives from string literals or
 * other field names that happen to contain "archived".
 */
function queryMentionsArchived(queryStr: string): boolean {
  try {
    const tokens = tokenize(queryStr);
    return tokens.some(t => t.type === "FIELD" && t.value === "archived");
  } catch {
    // If tokenization fails, fall through and let the main parser report
    // the error with proper context.
    return false;
  }
}

/**
 * CMT-10: whether a query string references the `comment_mentions` field.
 *
 * The gate for `loadCommentMentions`: a list that does not filter on
 * mentions must do zero comment I/O, so a surface calls this first and
 * only scans comments when it returns true. Tokenizes (like
 * {@link queryMentionsArchived}) so a `comment_mentions` substring inside
 * a string literal or another field name is not a false positive.
 */
export function queryReferencesCommentMentions(queryStr: string): boolean {
  try {
    const tokens = tokenize(queryStr);
    return tokens.some(t => t.type === "FIELD" && t.value === "comment_mentions");
  } catch {
    // Tokenize failure is reported with context by the main parser later.
    return false;
  }
}

/**
 * CMT-10: reads every task's comments and returns, per task id, the merged
 * union of user ids mentioned across *all* its comments (deduplicated).
 *
 * This is the async, I/O-bearing step that `buildListContext` deliberately
 * is not: comments live in `_comments.yaml`, separate from the loaded
 * Task, and the evaluator must stay pure. A surface awaits this and wires
 * the result into `ListContext.getCommentMentions`.
 *
 * Callers gate on {@link queryReferencesCommentMentions} so a list that
 * does not filter on mentions never calls this — the scan is O(tasks)
 * file reads and is only worth paying when the query needs it.
 *
 * A task whose comments cannot be read (unreadable/unparseable file) is
 * skipped rather than failing the whole list: a read filter should not be
 * taken down by one corrupt thread. Such a task simply contributes no
 * mentions, so it does not match `comment_mentions = X` — the same outcome
 * as a task with no comments.
 */
export async function loadCommentMentions(
  locttDir: string,
  tasks: readonly Task[],
): Promise<Map<string, string[]>> {
  const byTask = new Map<string, string[]>();
  for (const task of tasks) {
    const id = task.frontmatter.id;
    let comments;
    try {
      comments = await listComments(locttDir, id);
    } catch {
      // Corrupt/unreadable thread — contribute nothing, keep the list alive.
      continue;
    }
    const merged = new Set<string>();
    for (const c of comments) {
      for (const m of c.mentions ?? []) merged.add(m);
    }
    if (merged.size > 0) byTask.set(id, [...merged]);
  }
  return byTask;
}

/**
 * CMT-10: returns `base` extended with a `getCommentMentions` lookup, but
 * only when one of `queries` references `comment_mentions` — otherwise it
 * returns `base` unchanged and reads no comment files at all.
 *
 * This is the surface glue for the mention scan, factored into core so the
 * CLI, MCP and web gate and load identically (P10) rather than each
 * re-deriving the gate. `queries` is the set of query strings a list call
 * might run — the ad-hoc `--query` and, when a saved view is used, its
 * resolved query — with `undefined`s tolerated so callers can pass
 * optionals straight through.
 */
export async function resolveCommentMentionsContext(
  locttDir: string,
  tasks: readonly Task[],
  base: ListContext,
  queries: readonly (string | undefined)[],
): Promise<ListContext> {
  const referenced = queries.some(
    q => q !== undefined && queryReferencesCommentMentions(q),
  );
  if (!referenced) return base;
  const byTask = await loadCommentMentions(locttDir, tasks);
  return { ...base, getCommentMentions: (id: string) => byTask.get(id) };
}

function buildPriorityMap(
  config: WorkflowConfig | undefined,
): Map<string, number> {
  const map = new Map<string, number>();
  if (!config) return map;
  for (const p of config.priorities) {
    if (p.value !== undefined) {
      map.set(p.key, p.value);
    }
  }
  return map;
}

/**
 * Per-custom-enum-field value→weight maps, keyed by the sort field token
 * `fields.<key>` (SET-8). A field appears here only when it is an enum
 * **and at least one** of its values carries a numeric `value` weight —
 * so a field with no weights set is absent, and `compareTasks` falls
 * back to its ordinary (alphabetical) comparison, which is SET-8's
 * "clearing all weights falls back" branch. A value with no weight is
 * simply not in its field's map, so it sorts to the end like any unset
 * value.
 */
function buildCustomFieldWeightMaps(
  config: WorkflowConfig | undefined,
): Map<string, Map<string, number>> {
  const maps = new Map<string, Map<string, number>>();
  if (!config) return maps;
  for (const def of config.custom_fields) {
    if (def.type !== "enum" || def.values === undefined) continue;
    const weights = new Map<string, number>();
    for (const v of def.values) {
      if (v.value !== undefined) weights.set(v.key, v.value);
    }
    if (weights.size > 0) maps.set(`fields.${def.key}`, weights);
  }
  return maps;
}

function getTaskFieldValue(task: Task, field: string): unknown {
  // `fields.effort` is one dotted key, not a key called
  // "fields.effort". Both lookups below miss it: the frontmatter has
  // `fields` (an object), and `fields` has `effort`.
  //
  // So sorting by a custom field was a **silent no-op** — accepted by
  // `isSortableTaskField`, kept in the URL, shown with a sort
  // indicator, and returning identical order for `asc` and `desc`.
  // Measured on three tasks: the same sequence both ways.
  //
  // That is the state LST-29's bullets 2 and 3 forbid — a column
  // shown as sorting when it is not, persisting as though applied —
  // reached by a path LST-29 does not cover, because the key is
  // *known* rather than unknown. The predicate and the resolver
  // disagreed, and the predicate is the one the URL is validated
  // against.
  if (field.startsWith("fields.")) {
    const key = field.slice("fields.".length);
    return task.frontmatter.fields
        && Object.prototype.hasOwnProperty.call(task.frontmatter.fields, key)
      ? task.frontmatter.fields[key]
      : undefined;
  }
  if (Object.prototype.hasOwnProperty.call(task.frontmatter, field)) {
    return readField(task.frontmatter, field);
  }
  // `hasOwnProperty`, not `in`: the line above was narrowed for exactly
  // this hazard and this one was left behind. `"toString" in fields` is
  // true on every object, so sorting by a prototype key returned a
  // *function* as the sort value. The comparator tolerates it today, but
  // that is luck rather than intent, and a function reaching the YAML
  // formatter is not.
  if (
    task.frontmatter.fields
    && Object.prototype.hasOwnProperty.call(task.frontmatter.fields, field)
  ) {
    return task.frontmatter.fields[field];
  }
  return undefined;
}

function compareTasks(
  a: Task,
  b: Task,
  field: string,
  direction: "asc" | "desc",
  priorityMap: Map<string, number>,
  enumWeightMaps?: Map<string, Map<string, number>>,
): number {
  let aVal = getTaskFieldValue(a, field);
  let bVal = getTaskFieldValue(b, field);

  // Use numeric priority values for sorting if available
  if (field === "priority") {
    const aNum = priorityMap.get(String(aVal));
    const bNum = priorityMap.get(String(bVal));
    if (aNum !== undefined) aVal = aNum;
    if (bNum !== undefined) bVal = bNum;
  }

  // SET-8: a custom enum field with configured weights sorts by weight,
  // exactly as priority does above. Only when this field has a weight map
  // (at least one value carried a `value`); otherwise the map is absent
  // and the value falls through to the string comparison below —
  // SET-8's "clear all weights → alphabetical fallback". A value with no
  // weight is not in the map and stays a string, so it sorts to the end.
  const weights = enumWeightMaps?.get(field);
  if (weights !== undefined) {
    const aW = weights.get(String(aVal));
    const bW = weights.get(String(bVal));
    if (aW !== undefined) aVal = aW;
    if (bW !== undefined) bVal = bW;
  }

  // Handle undefined — push to end regardless of direction
  if (aVal === undefined && bVal === undefined) return 0;
  if (aVal === undefined) return 1;
  if (bVal === undefined) return -1;

  // Try numeric comparison
  if (typeof aVal === "number" && typeof bVal === "number") {
    const cmp = aVal - bVal;
    return direction === "desc" ? -cmp : cmp;
  }

  // Objects/arrays can't be meaningfully sorted as strings — treat as equal
  if (typeof aVal === "object" || typeof bVal === "object") return 0;

  const aStr = String(aVal as string | number | boolean);
  const bStr = String(bVal as string | number | boolean);
  const cmp = aStr.localeCompare(bStr);
  return direction === "desc" ? -cmp : cmp;
}
