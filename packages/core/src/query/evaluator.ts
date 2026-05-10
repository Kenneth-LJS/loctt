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
 * Resolves a single (non-list) QueryValue to a primitive for comparison.
 * "today" resolves to today's date as YYYY-MM-DD.
 * Returns undefined for list values — callers handle lists explicitly.
 */
function resolvePrimitive(qv: QueryValue): string | number | boolean | undefined {
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
    return (fm as unknown as Record<string, unknown>)[field];
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
        const resolved = resolvePrimitive(node.value);
        if (resolved === undefined) return false;
        return evaluateTextAlias(fm, node.op, String(resolved), ctx);
      }

      if (node.field === "parent") {
        const resolved = resolvePrimitive(node.value);
        if (resolved === undefined) return false;
        return evaluateParentAlias(fm, node.op, resolved, ctx);
      }

      // Handle relationship-based query: relationship.type syntax
      if (node.field.startsWith("relationship.")) {
        const relType = node.field.slice("relationship.".length);
        const rels = (fm.relationships ?? []).filter(r => r.type === relType);
        if (rels.length === 0) {
          return node.op === "!=" || node.op === "not in";
        }
        if (node.op === "in" || node.op === "not in") {
          const items = resolveList(node.value);
          if (!items) return false;
          const listValues = items.map(v => {
            const p = resolvePrimitive(v);
            return p !== undefined ? String(p) : "";
          });
          const hasMatch = rels.some(r => listValues.includes(r.target));
          return node.op === "in" ? hasMatch : !hasMatch;
        }
        const resolved = resolvePrimitive(node.value);
        if (resolved === undefined) return false;
        return rels.some(r => compareValues(r.target, node.op, resolved));
      }

      const fieldVal = getFieldValue(fm, node.field);

      if (node.op === "in" || node.op === "not in") {
        if (fieldVal === undefined || fieldVal === null) {
          return node.op === "not in";
        }
        const items = resolveList(node.value);
        if (!items) return false;
        const rhs = items
          .map(v => resolvePrimitive(v))
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

      const resolved = resolvePrimitive(node.value);
      if (resolved === undefined) return false;
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
