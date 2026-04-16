import type { TaskFrontmatter } from "@loctt/contracts";
import type { QueryNode, QueryValue } from "./parser.js";

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

/**
 * Evaluates a parsed query AST against a task's frontmatter.
 * Returns true if the task matches the query.
 */
export function evaluateQuery(node: QueryNode, fm: TaskFrontmatter): boolean {
  switch (node.type) {
    case "comparison": {
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
      if (typeof resolved === "object") return false; // shouldn't happen for non-list
      return compareValues(fieldVal, node.op, resolved);
    }

    case "and":
      return evaluateQuery(node.left, fm) && evaluateQuery(node.right, fm);

    case "or":
      return evaluateQuery(node.left, fm) || evaluateQuery(node.right, fm);

    case "not":
      return !evaluateQuery(node.operand, fm);
  }
}
