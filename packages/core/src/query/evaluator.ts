import type { TaskFrontmatter } from "@loctt/contracts";
import type { QueryNode, QueryValue } from "./parser.js";

/** Context for query evaluation that provides access to task body and other tasks. */
export interface EvalContext {
  /** The markdown body of the task (for text search). */
  readonly body?: string;
  /** Resolves a task ID to its key (for parent alias). */
  readonly resolveKey?: (id: string) => string | undefined;
}

/**
 * Resolves a QueryValue to a concrete JS value for comparison.
 * "today" resolves to today's date as YYYY-MM-DD.
 */
function resolveValue(qv: QueryValue): string | number | boolean | readonly QueryValue[] {
  switch (qv.type) {
    case "string":
      return qv.value;
    case "number":
      return qv.value;
    case "boolean":
      return qv.value;
    case "date":
      return qv.value;
    case "today": {
      const now = new Date();
      return now.toISOString().slice(0, 10);
    }
    case "list":
      return qv.values;
  }
}

/**
 * Gets a field value from task frontmatter.
 * Supports built-in fields and custom fields under `fields:`.
 */
function getFieldValue(fm: TaskFrontmatter, field: string): unknown {
  // Check built-in fields first
  if (field in fm) {
    return (fm as unknown as Record<string, unknown>)[field];
  }
  // Check custom fields
  if (fm.fields && field in fm.fields) {
    return fm.fields[field];
  }
  return undefined;
}

function compareValues(left: unknown, op: string, right: string | number | boolean): boolean {
  // Handle undefined left — field not set
  if (left === undefined || left === null) {
    if (op === "!=") return true;
    return false;
  }

  const leftStr = String(left);
  const rightStr = String(right);

  switch (op) {
    case "=":
      return leftStr === rightStr;
    case "!=":
      return leftStr !== rightStr;
    case "~":
      return leftStr.toLowerCase().includes(rightStr.toLowerCase());
    case "<":
      return leftStr < rightStr;
    case "<=":
      return leftStr <= rightStr;
    case ">":
      return leftStr > rightStr;
    case ">=":
      return leftStr >= rightStr;
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
    const val = getFieldValue(fm, field);
    if (val !== undefined && String(val).toLowerCase().includes(term)) {
      return op === "~" ? true : false;
    }
  }

  // Search searchable custom fields (all string-valued custom fields)
  if (fm.fields) {
    for (const val of Object.values(fm.fields)) {
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
 * Handles the "parent" alias — resolves parent relationship target ID to a key
 * for comparison. e.g. `parent = T-5` checks if the task's parent rel target has key T-5.
 */
function evaluateParentAlias(
  fm: TaskFrontmatter,
  op: string,
  value: string | number | boolean,
  ctx: EvalContext,
): boolean {
  const parentRel = (fm.relationships ?? []).find(r => r.type === "parent");
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
        const resolved = resolveValue(node.value);
        return evaluateTextAlias(fm, node.op, String(resolved), ctx);
      }

      if (node.field === "parent") {
        const resolved = resolveValue(node.value);
        if (typeof resolved === "object") return false;
        return evaluateParentAlias(fm, node.op, resolved, ctx);
      }

      // Handle relationship-based query: relationship.type syntax
      if (node.field.startsWith("relationship.")) {
        const relType = node.field.slice("relationship.".length);
        const rels = (fm.relationships ?? []).filter(r => r.type === relType);
        if (rels.length === 0) {
          return node.op === "!=" || node.op === "not in";
        }
        const resolved = resolveValue(node.value);
        if (node.op === "in" || node.op === "not in") {
          if (!Array.isArray(resolved)) return false;
          const listValues = (resolved as readonly QueryValue[]).map(v => String(resolveValue(v)));
          const hasMatch = rels.some(r => listValues.includes(r.target));
          return node.op === "in" ? hasMatch : !hasMatch;
        }
        if (typeof resolved === "object") return false;
        return rels.some(r => compareValues(r.target, node.op, resolved));
      }

      const fieldVal = getFieldValue(fm, node.field);

      if (node.op === "in" || node.op === "not in") {
        const resolved = resolveValue(node.value);
        if (!Array.isArray(resolved)) return false;
        const fieldStr = String(fieldVal);
        const matches = (resolved as readonly QueryValue[]).some(v => {
          const rv = resolveValue(v);
          return String(rv) === fieldStr;
        });
        return node.op === "in" ? matches : !matches;
      }

      const resolved = resolveValue(node.value);
      if (typeof resolved === "object") return false;
      return compareValues(fieldVal, node.op, resolved);
    }

    case "and":
      return evaluateQuery(node.left, fm, ctx) && evaluateQuery(node.right, fm, ctx);

    case "or":
      return evaluateQuery(node.left, fm, ctx) || evaluateQuery(node.right, fm, ctx);

    case "not":
      return !evaluateQuery(node.operand, fm, ctx);
  }
}
