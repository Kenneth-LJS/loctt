import type { TaskFrontmatter, WorkflowConfig } from "@loctt/contracts";

import { readField } from "../task/mutable.js";
import type { QueryNode, QueryValue } from "./parser.js";

/** Context for query evaluation that provides access to task body and other tasks. */
export interface EvalContext {
  /** The markdown body of the task (for text search). */
  readonly body?: string;
  /** Resolves a task ID to its key (for parent alias). */
  readonly resolveKey?: (id: string) => string | undefined;
  /**
   * Workflow config used to resolve nested-field queries like
   * `status.category = completed`. When omitted, nested access on
   * enum-like fields (status/priority/task_type) returns undefined.
   */
  readonly workflow?: WorkflowConfig;
  /**
   * Today's date as `YYYY-MM-DD` in the workspace timezone, used to
   * resolve the `today` literal (`due_date < today`).
   *
   * Passed in rather than computed here so the evaluator stays pure —
   * no clock, no config I/O — and so every task in one list call
   * compares against the same date even if evaluation straddles
   * midnight. Callers derive it with `todayInZone(calendar.timezone)`.
   *
   * Defaults to the UTC date when absent, which is the pre-existing
   * behaviour and correct for UTC workspaces.
   */
  readonly today?: string;
}

/**
 * Maps a top-level enum-like field name to its workflow config list.
 * Used by getNestedFieldValue to look up a status/priority/task_type
 * record by key when the query says `status.category` etc.
 */
function workflowDefList(
  wf: WorkflowConfig,
  field: string,
): readonly Record<string, unknown>[] | undefined {
  switch (field) {
    case "status": return wf.statuses as readonly Record<string, unknown>[];
    case "priority": return wf.priorities as readonly Record<string, unknown>[];
    case "task_type": return wf.task_types as readonly Record<string, unknown>[];
    default: return undefined;
  }
}

/**
 * Resolves a dotted field path like `status.category` or
 * `fields.impact.severity` against a frontmatter object.
 *
 * - `status.<attr>` / `priority.<attr>` / `task_type.<attr>`:
 *   when workflow config is available, looks up the matching def by
 *   key and reads `<attr>` off it (e.g. `category`, `color`).
 * - `fields.<custom>.<sub>`: nested access into a custom field that
 *   itself holds an object value.
 *
 * Returns undefined when any segment can't resolve.
 */
function getNestedFieldValue(
  fm: TaskFrontmatter,
  path: readonly string[],
  ctx: EvalContext,
): unknown {
  const [head, ...rest] = path;
  if (head === undefined || rest.length === 0) {
    return head !== undefined ? getFieldValue(fm, head) : undefined;
  }
  if (ctx.workflow) {
    const defs = workflowDefList(ctx.workflow, head);
    if (defs) {
      const key = getFieldValue(fm, head);
      if (typeof key !== "string") return undefined;
      const def = defs.find(d => d["key"] === key);
      if (!def) return undefined;
      return descend(def, rest);
    }
  }
  if (head === "fields" && rest[0] !== undefined) {
    const val = fm.fields?.[rest[0]];
    return rest.length === 1 ? val : descend(val, rest.slice(1));
  }
  const base = getFieldValue(fm, head);
  return descend(base, rest);
}

function descend(value: unknown, path: readonly string[]): unknown {
  let cur: unknown = value;
  for (const seg of path) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

/**
 * Resolves a single (non-list) QueryValue to a primitive for comparison.
 * "today" resolves to today's date as YYYY-MM-DD.
 * Returns undefined for list values — callers handle lists explicitly.
 */
function resolvePrimitive(
  qv: QueryValue,
  ctx: EvalContext = {},
): string | number | boolean | undefined {
  switch (qv.type) {
    case "string":
      return qv.value;
    case "number":
      return qv.value;
    case "boolean":
      return qv.value;
    case "date":
      return qv.value;
    case "today":
      // Workspace timezone, supplied by the caller. Falls back to the
      // UTC date — see EvalContext.today.
      return ctx.today ?? new Date().toISOString().slice(0, 10);
    case "list":
      return undefined;
  }
}

/**
 * Resolves a QueryValue that must be a list, returning the list items.
 * Returns undefined for non-list values.
 */
function resolveList(qv: QueryValue): readonly QueryValue[] | undefined {
  return qv.type === "list" ? qv.values : undefined;
}

/**
 * Gets a field value from task frontmatter.
 * Supports built-in fields and custom fields under `fields:`.
 */
function getFieldValue(fm: TaskFrontmatter, field: string): unknown {
  // Check built-in fields first. Use hasOwnProperty so we don't
  // pick up inherited prototype keys (e.g. "toString").
  if (Object.prototype.hasOwnProperty.call(fm, field)) {
    return readField(fm, field);
  }
  if (fm.fields && Object.prototype.hasOwnProperty.call(fm.fields, field)) {
    return fm.fields[field];
  }
  return undefined;
}

/**
 * Coerces a field value to a string for comparison.
 * Arrays and objects are not meaningfully comparable as strings — return undefined.
 */
function toComparableString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

/**
 * Returns the array of comparable strings from a value if it's an
 * array of primitive values, otherwise undefined. Used so that
 * array-valued fields like `labels: [bug, ui]` evaluate
 * member-wise: `labels = bug` → true if "bug" is in the array.
 */
function toComparableArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  for (const v of value) {
    const s = toComparableString(v);
    if (s === undefined) return undefined; // mixed/object array — give up
    out.push(s);
  }
  return out;
}

function compareValues(left: unknown, op: string, right: string | number | boolean): boolean {
  // Handle undefined left — field not set
  if (left === undefined || left === null) {
    if (op === "!=") return true;
    return false;
  }

  // Array-valued fields (labels, multi-valued custom fields, etc.)
  // are compared member-wise: any element matching the comparison
  // counts as a match. `!=` requires that no element matches.
  const arr = toComparableArray(left);
  if (arr !== undefined) {
    if (arr.length === 0) return op === "!=";
    const rightStr = String(right);
    switch (op) {
      case "=":
        return arr.includes(rightStr);
      case "!=":
        return !arr.includes(rightStr);
      case "~": {
        const needle = rightStr.toLowerCase();
        return arr.some(a => a.toLowerCase().includes(needle));
      }
      // Ordering operators on arrays don't really make sense; fall
      // back to "any element matches the ordering."
      case "<":
      case "<=":
      case ">":
      case ">=":
        return arr.some(a => compareValues(a, op, right));
      default:
        return false;
    }
  }

  const leftStr = toComparableString(left);
  if (leftStr === undefined) {
    // Objects/arrays can't be meaningfully compared as strings
    return op === "!=";
  }
  const rightStr = String(right);

  switch (op) {
    case "=":
      return leftStr === rightStr;
    case "!=":
      return leftStr !== rightStr;
    case "~":
      return leftStr.toLowerCase().includes(rightStr.toLowerCase());
    case "<":
    case "<=":
    case ">":
    case ">=": {
      // Use numeric comparison when both sides parse as numbers
      const leftNum = Number(left);
      const rightNum = Number(right);
      if (!Number.isNaN(leftNum) && !Number.isNaN(rightNum)) {
        switch (op) {
          case "<": return leftNum < rightNum;
          case "<=": return leftNum <= rightNum;
          case ">": return leftNum > rightNum;
          case ">=": return leftNum >= rightNum;
        }
      }
      // Fall back to string comparison for non-numeric values
      switch (op) {
        case "<": return leftStr < rightStr;
        case "<=": return leftStr <= rightStr;
        case ">": return leftStr > rightStr;
        case ">=": return leftStr >= rightStr;
      }
      return false;
    }
    default:
      return false;
  }
}

// Built-in searchable text fields for the "text" alias
const TEXT_SEARCH_FIELDS: readonly string[] = ["title", "key", "id"];

/**
 * Handles the "text" alias — full-text search across textual fields and body.
 * Only supports the ~ operator.
 */
function evaluateTextAlias(
  fm: TaskFrontmatter,
  op: string,
  searchTerm: string,
  ctx: EvalContext,
): boolean {
  const term = searchTerm.toLowerCase();

  // Search built-in text fields
  for (const field of TEXT_SEARCH_FIELDS) {
    const val = toComparableString(getFieldValue(fm, field));
    if (val !== undefined && val.toLowerCase().includes(term)) {
      return op === "~";
    }
  }

  // Custom fields, but only those declared `searchable: true`.
  //
  // `searchable` is a required field on every custom-field definition
  // and the docs promise `text` honours it, but this searched every
  // string-valued custom field regardless — so a field a user
  // deliberately excluded still matched, which is a leak rather than
  // merely a wrong result.
  //
  // Without workflow config there is nothing to check against. Erring
  // toward NOT searching keeps the exclusion honoured on the
  // config-less path rather than leaking there instead.
  if (fm.fields) {
    // With config in hand, only fields declared `searchable: true` are
    // searched. Without it there is nothing to check against, so every
    // string field is searched as before.
    //
    // That asymmetry is deliberate rather than a gap: every production
    // path reaches here through `listTasks`, which passes the loaded
    // workflow config, so the permissive branch is confined to
    // hand-built contexts. Failing closed there would silently weaken
    // `text ~` for callers that simply have no config to consult.
    const searchable = ctx.workflow === undefined
      ? undefined
      : new Set(
          ctx.workflow.custom_fields
            .filter(f => f.searchable === true)
            .map(f => f.key),
        );
    for (const [key, val] of Object.entries(fm.fields)) {
      if (searchable !== undefined && !searchable.has(key)) continue;
      if (typeof val === "string" && val.toLowerCase().includes(term)) {
        return op === "~" ? true : false;
      }
    }
  }

  // Search body
  if (ctx.body && ctx.body.toLowerCase().includes(term)) {
    return op === "~" ? true : false;
  }

  return op === "~" ? false : true;
}

/**
 * Handles the `parent` alias — `parent = T-5` asks whether the task's
 * hierarchy edge points at T-5. Kept because it is core JQL and we
 * already match its spelling.
 *
 * The kind is read from config rather than hardcoded to the literal
 * `"parent"`: a workspace that renames its hierarchy relationship would
 * otherwise see this alias silently stop matching while still passing
 * validation. The first `graph: tree` relationship is the hierarchy;
 * with none configured, and only then, the literal name is the last
 * resort so an in-memory config without `graph` still behaves.
 */
function hierarchyKind(ctx: EvalContext): string {
  const tree = ctx.workflow?.relationships.find(r => r.graph === "tree");
  return tree?.key ?? "parent";
}

function evaluateParentAlias(
  fm: TaskFrontmatter,
  op: string,
  value: string | number | boolean,
  ctx: EvalContext,
): boolean {
  const kind = hierarchyKind(ctx);
  const parentRel = (fm.relationships ?? []).find(r => r.type === kind);
  if (!parentRel) {
    return op === "!=" ? true : false;
  }

  // Resolve parent ID to key for user-friendly comparison
  let parentRef = parentRel.target;
  if (ctx.resolveKey) {
    const key = ctx.resolveKey(parentRel.target);
    if (key) parentRef = key;
  }

  return compareValues(parentRef, op, value);
}

/**
 * Evaluates `has_link(kind?, target?)`.
 *
 * Arity picks the question:
 *  - `has_link()`               — any link at all
 *  - `has_link(kind)`           — any edge of that kind
 *  - `has_link(kind, target)`   — a **single** edge matching both
 *
 * The two-argument form is why this replaced `relationship.type` /
 * `relationship.target`: those were two independent existential
 * filters, so a task with `blocks → T-20` and `parent → T-10` satisfied
 * `relationship.type = blocks and relationship.target = T-10` while
 * having no edge that blocks T-10. One call, one edge, no trap.
 *
 * Targets match against the task's stored id **or** its current key, so
 * a user can write the reference they actually see. Storage is by ULID.
 *
 * Both directions are queryable as plain predicates because `linkTask`
 * writes the forward edge on A and the inverse on B, so "what blocks
 * T-2" is a forward lookup on the inverse key.
 */
function evaluateHasLink(
  fm: TaskFrontmatter,
  kind: string | undefined,
  target: string | undefined,
  ctx: EvalContext,
): boolean {
  const rels = fm.relationships ?? [];
  return rels.some(r => {
    if (kind !== undefined && r.type !== kind) return false;
    if (target === undefined) return true;
    if (r.target === target) return true;
    // Compare against the current key too — a key may have changed, and
    // key_history means an old key can still resolve.
    const key = ctx.resolveKey?.(r.target);
    return key !== undefined && key === target;
  });
}

/**
 * Evaluates a parsed query AST against a task's frontmatter.
 * Returns true if the task matches the query.
 *
 * Pass an EvalContext for text alias and parent alias support.
 */
export function evaluateQuery(
  node: QueryNode,
  fm: TaskFrontmatter,
  ctx: EvalContext = {},
): boolean {
  switch (node.type) {
    case "comparison": {
      // Handle special aliases
      if (node.field === "text") {
        const resolved = resolvePrimitive(node.value, ctx);
        if (resolved === undefined) return false;
        return evaluateTextAlias(fm, node.op, String(resolved), ctx);
      }

      if (node.field === "parent") {
        const resolved = resolvePrimitive(node.value, ctx);
        if (resolved === undefined) return false;
        return evaluateParentAlias(fm, node.op, resolved, ctx);
      }

      // The old `relationship.<kind>` / `relationship.type` /
      // `relationship.target` forms are gone, replaced by has_link().
      // A clear error beats silently matching nothing.
      if (node.field === "relationship" || node.field.startsWith("relationship.")) {
        throw new Error(
          `"${node.field}" is no longer supported. Use has_link("<kind>") to test for a link, `
          + `has_link("<kind>", "<target>") for a specific edge, or link_count("<kind>") for a count.`,
        );
      }

      // link_count("child") > 3 — the left side is a call, not a field.
      if (node.call?.name === "link_count") {
        const kind = node.call.kind;
        const count = (fm.relationships ?? [])
          .filter(r => kind === undefined || r.type === kind)
          .length;
        const resolved = resolvePrimitive(node.value, ctx);
        if (resolved === undefined) return false;
        return compareValues(count, node.op, resolved);
      }

      const fieldVal = node.field.includes(".")
        ? getNestedFieldValue(fm, node.field.split("."), ctx)
        : getFieldValue(fm, node.field);

      if (node.op === "in" || node.op === "not in") {
        if (fieldVal === undefined || fieldVal === null) {
          return node.op === "not in";
        }
        const items = resolveList(node.value);
        if (!items) return false;
        const rhs = items
          .map(v => resolvePrimitive(v, ctx))
          .filter((p): p is string | number | boolean => p !== undefined)
          .map(p => String(p));
        const fieldArr = toComparableArray(fieldVal);
        if (fieldArr !== undefined) {
          // `labels in (bug, ui)` → any element of labels appears in rhs
          const matches = fieldArr.some(s => rhs.includes(s));
          return node.op === "in" ? matches : !matches;
        }
        const fieldStr = toComparableString(fieldVal);
        if (fieldStr === undefined) return node.op === "not in";
        const matches = rhs.includes(fieldStr);
        return node.op === "in" ? matches : !matches;
      }

      const resolved = resolvePrimitive(node.value, ctx);
      if (resolved === undefined) return false;
      return compareValues(fieldVal, node.op, resolved);
    }

    case "has_link":
      return evaluateHasLink(fm, node.kind, node.target, ctx);

    case "and":
      return evaluateQuery(node.left, fm, ctx) && evaluateQuery(node.right, fm, ctx);

    case "or":
      return evaluateQuery(node.left, fm, ctx) || evaluateQuery(node.right, fm, ctx);

    case "not":
      return !evaluateQuery(node.operand, fm, ctx);
  }
}
