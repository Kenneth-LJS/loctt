import type { WorkflowConfig } from "@loctt/contracts";
import { relationshipTypeKeys } from "@loctt/contracts";

import { LocttError } from "../errors.js";
import type { QueryNode } from "./parser.js";

/**
 * Raised when a query is syntactically valid but references something
 * that doesn't exist — a misspelled field, an unknown custom field, or
 * an enum value outside the workflow config.
 *
 * Distinct from TokenizeError/ParseError, which cover *syntax*. Those
 * already surfaced properly; this closes the semantic gap where
 * `stat = done` (typo for `status`) silently matched zero tasks and
 * read as "no tasks match" rather than "your query is wrong".
 *
 * `position` points at the offending token so callers can underline it,
 * matching the parse errors. `suggestions` holds near-miss candidates
 * for a "did you mean" hint — possibly empty.
 */
export class QueryValidationError extends LocttError {
  constructor(
    message: string,
    public readonly position: number,
    public readonly suggestions: readonly string[] = [],
  ) {
    const hint = suggestions.length > 0 ? ` — did you mean ${suggestions.map(s => `"${s}"`).join(" or ")}?` : "";
    // A mistyped query is a known, nameable cause — the position and
    // any suggestions are right here. Left as a bare `Error` it reached
    // a surface as `unknown`, which ERR-31 forbids: the generic handler
    // is for causes that genuinely cannot be determined, not a
    // convenience for ones nobody wired up.
    super("validation_failed", `${message} at position ${position}${hint}`, {
      field: "query",
      recovery: { kind: "retry" },
    });
    this.name = "QueryValidationError";
  }
}

/**
 * Built-in queryable fields. Mirrors TaskFrontmatterSchema's keys plus
 * the evaluator's aliases (`text`, `parent`).
 *
 * Kept as an explicit list rather than derived from the zod schema:
 * TaskFrontmatterSchema is `.passthrough()`, so deriving from it would
 * accept nothing extra anyway, and the alias fields don't exist on it
 * at all. An explicit list also lets the error message enumerate what
 * *is* valid.
 */
export const QUERYABLE_FIELDS: readonly string[] = [
  "id", "key", "project", "title", "created_at", "updated_at",
  "status", "status_updated_at", "task_type", "priority", "labels",
  "assignee", "reporter", "start_date", "due_date", "estimate",
  "completed_date", "milestone", "sprint", "archived", "archived_at",
  "relationships", "key_history", "board_rank",
  // Evaluator aliases, not frontmatter keys.
  "text", "parent",
];

/**
 * Nested attributes readable off a workflow-config enum def via
 * `status.category`, `priority.value`, etc. The evaluator resolves
 * these through workflowDefList → the matching def object.
 */
const ENUM_ATTRS: readonly string[] = ["key", "label", "category", "value", "color", "description"];

/** Top-level fields whose values are constrained by workflow config. */
const ENUM_FIELDS = ["status", "priority", "task_type"] as const;
type EnumField = (typeof ENUM_FIELDS)[number];

function isEnumField(field: string): field is EnumField {
  return (ENUM_FIELDS as readonly string[]).includes(field);
}

function enumKeys(wf: WorkflowConfig, field: EnumField): string[] {
  const defs = field === "status" ? wf.statuses
    : field === "priority" ? wf.priorities
    : wf.task_types;
  return (defs ?? []).map(d => d.key);
}

/**
 * Levenshtein distance, capped early. Only used to rank "did you mean"
 * candidates over short field names, so the naive O(n*m) fill is fine.
 */
function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i += 1) {
    const cur: number[] = Array.from({ length: n + 1 }, () => 0);
    cur[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(
        (cur[j - 1] ?? 0) + 1,
        (prev[j] ?? 0) + 1,
        (prev[j - 1] ?? 0) + cost,
      );
    }
    prev = cur;
  }
  return prev[n] ?? 0;
}

/**
 * Returns up to `limit` candidates closest to `input`. The threshold
 * scales with length so short names ("id") don't match everything and
 * long ones tolerate a two-character slip.
 */
function suggest(input: string, candidates: readonly string[], limit = 2): string[] {
  const threshold = input.length <= 4 ? 1 : input.length <= 8 ? 2 : 3;
  const lower = input.toLowerCase();
  return candidates
    .map(c => ({ c, d: editDistance(lower, c.toLowerCase()) }))
    .filter(({ c, d }) => d <= threshold || c.toLowerCase().startsWith(lower) || lower.startsWith(c.toLowerCase()))
    .sort((x, y) => x.d - y.d)
    .slice(0, limit)
    .map(({ c }) => c);
}

export interface ValidateQueryOptions {
  /**
   * Workflow config. When present, enum *values* are checked against
   * it (`status = frobnik` fails) and custom-field keys are read from
   * `custom_fields`. When absent, only field *names* are validated —
   * a caller without config loaded still catches typo'd field names.
   */
  readonly workflow?: WorkflowConfig;
  /**
   * Enum values some task actually stores, even though the config no
   * longer declares them.
   *
   * A status deleted from `workflow.yaml` while tasks still reference
   * it made those tasks **unfindable**: the query that would locate
   * them was rejected as a typo. LST-24 requires the opposite — the
   * dropdown stops offering the value, but a URL still carrying it
   * keeps matching. Without this, the one query that could find the
   * affected rows is the one the validator refuses.
   *
   * Typos are still caught: a value neither declared nor stored has no
   * business in a query, and that is the case the check was written
   * for.
   */
  readonly inUse?: ReadonlySet<string>;
}

/**
 * Walks a parsed query once and raises on the first semantic problem.
 *
 * Deliberately separate from evaluation. Validating per-task would
 * fire N times for one mistake and still couldn't distinguish "bad
 * field" from "no matches" at zero results — which is the whole bug.
 * One pass over the AST, before any task is read.
 *
 * A well-formed query that legitimately matches nothing passes here
 * and returns zero tasks, which stays distinguishable from an error.
 */
export function validateQuery(node: QueryNode, opts: ValidateQueryOptions = {}): void {
  switch (node.type) {
    case "and":
    case "or":
      validateQuery(node.left, opts);
      validateQuery(node.right, opts);
      return;
    case "not":
      validateQuery(node.operand, opts);
      return;
    case "comparison":
      validateComparison(node, opts);
      return;
    case "has_link":
      validateRelationshipKind(node.kind, node.position ?? 0, opts);
      return;
  }
}

/**
 * Rejects comparisons that cannot be true for any task.
 *
 * These are not semantic errors the evaluator reports — it silently
 * returns false — so the user sees an empty result and concludes nothing
 * matched. A query nobody can satisfy is a mistake, and saying so beats
 * answering it.
 */
function assertSatisfiable(
  node: Extract<QueryNode, { type: "comparison" }>,
  pos: number,
): void {
  const value = node.value;
  const isList = value.type === "list";

  // `link_count(...)` yields a number; the evaluator resolves a list to
  // `undefined` and returns false, so `in` / `not in` never hold. `not
  // in` is the worse of the two: false everywhere reads as "no task
  // lacks these counts".
  if (node.call?.name === "link_count" && isList) {
    throw new QueryValidationError(
      `link_count(...) compares a number, so "${node.op}" with a list can never match `
      + `— use =, !=, <, <=, > or >=`,
      pos,
      [],
    );
  }

  if (value.type === "list" && value.values.length === 0) {
    throw new QueryValidationError(
      `an empty list can never match — remove the comparison or give it values`,
      pos,
      [],
    );
  }

  // `1.2.3` and `3-4` tokenize as numbers and become NaN, and every
  // comparison against NaN is false.
  const values = value.type === "list" ? value.values : [value];
  for (const v of values) {
    if (v.type === "number" && Number.isNaN(v.value)) {
      throw new QueryValidationError(
        `${node.field} was given a value that is not a number`,
        pos,
        [],
      );
    }
  }
}

function validateComparison(
  node: Extract<QueryNode, { type: "comparison" }>,
  opts: ValidateQueryOptions,
): void {
  const { field, position } = node;
  const pos = position ?? 0;

  // Reject the shapes that parse, validate, and then match nothing.
  // Each is accepted end-to-end and evaluates false for every task,
  // which is indistinguishable from "no tasks matched" — the exact
  // failure this module exists to prevent.
  assertSatisfiable(node, pos);

  // The old `relationship.*` grammar is gone. Catch it here so the
  // message names the replacement rather than reporting an unknown
  // field.
  if (field === "relationship" || field.startsWith("relationship.")) {
    throw new QueryValidationError(
      `"${field}" is no longer supported — use has_link("<kind>"), `
      + `has_link("<kind>", "<target>"), or link_count("<kind>")`,
      pos,
      [],
    );
  }

  // link_count("child") > 3 — validate the kind, not the field name.
  if (node.call?.name === "link_count") {
    validateRelationshipKind(node.call.kind, pos, opts);
    return;
  }

  if (field.includes(".")) {
    validateDottedField(field, pos, opts);
    return;
  }

  if (!QUERYABLE_FIELDS.includes(field)) {
    throw new QueryValidationError(
      `unknown field "${field}"`,
      pos,
      suggest(field, [...QUERYABLE_FIELDS, ...customFieldKeys(opts).map(k => `fields.${k}`)]),
    );
  }

  // `text` is a substring-search alias, not a value: only `~` is
  // meaningful. Every other operator was accepted end-to-end and then
  // evaluated wrongly — `text = x` in particular returned the *complement*
  // of what was asked (the evaluator's "found it" exits all test
  // `op === "~"`). Reject the nonsensical operators here rather than let
  // them silently produce a confidently wrong result.
  if (field === "text" && node.op !== "~") {
    throw new QueryValidationError(
      `"text" is a substring search — use "text ~ <term>". `
      + `The operator "${node.op}" is not supported on text.`,
      pos,
      [],
    );
  }

  validateEnumValue(node, pos, opts);
}

/**
 * `fields.<key>` (custom field, optionally with a nested path) and
 * `status.category` / `priority.value` / `task_type.<attr>`.
 */
function validateDottedField(field: string, pos: number, opts: ValidateQueryOptions): void {
  const [head, ...rest] = field.split(".");
  if (head === undefined) return;

  if (head === "fields") {
    const key = rest[0];
    if (key === undefined || key.length === 0) {
      throw new QueryValidationError(`"fields." needs a custom field key`, pos, customFieldKeys(opts));
    }
    // Without workflow config we can't know the declared custom
    // fields, so accept and let evaluation proceed.
    if (!opts.workflow) return;
    const known = customFieldKeys(opts);
    if (!known.includes(key)) {
      throw new QueryValidationError(
        `unknown custom field "${key}"`,
        pos,
        suggest(key, known),
      );
    }
    // Deeper path segments index into an object-valued custom field.
    // Shapes are user-defined and unvalidated at the contract layer,
    // so there's nothing to check them against.
    return;
  }

  if (isEnumField(head)) {
    const attr = rest[0];
    if (attr !== undefined && !ENUM_ATTRS.includes(attr)) {
      throw new QueryValidationError(
        `unknown attribute "${attr}" on ${head}`,
        pos,
        suggest(attr, ENUM_ATTRS),
      );
    }
    return;
  }

  // A dotted path on anything else — the head still has to be real.
  if (!QUERYABLE_FIELDS.includes(head)) {
    throw new QueryValidationError(
      `unknown field "${head}"`,
      pos,
      suggest(head, QUERYABLE_FIELDS),
    );
  }
}

/**
 * `status = frobnik` — the field is real but the value isn't one of
 * the configured keys. Only checked with workflow config present.
 *
 * `!=` is checked too: comparing against a nonexistent status is
 * equally a mistake, even though it happens to match everything.
 */
function validateEnumValue(
  node: Extract<QueryNode, { type: "comparison" }>,
  pos: number,
  opts: ValidateQueryOptions,
): void {
  const wf = opts.workflow;
  if (!wf || !isEnumField(node.field)) return;

  // Ordering operators on priority are meaningful against `value`,
  // and `~` is a substring match — neither implies an exact key.
  if (node.op !== "=" && node.op !== "!=" && node.op !== "in" && node.op !== "not in") return;

  const known = enumKeys(wf, node.field);
  const values = node.value.type === "list"
    ? node.value.values
    : [node.value];

  for (const v of values) {
    // Only string-ish literals name an enum key. `today`/numbers/
    // booleans in this position are a different kind of mistake and
    // the evaluator's comparison already handles them as non-matches.
    if (v.type !== "string") continue;
    if (!known.includes(v.value) && opts.inUse?.has(v.value) !== true) {
      throw new QueryValidationError(
        `unknown ${node.field} value "${v.value}"`,
        pos,
        suggest(v.value, known),
      );
    }
  }
}

/**
 * Validates a relationship kind named in `has_link(...)` /
 * `link_count(...)`.
 *
 * Accepts **both directions** via `relationshipTypeKeys`, which returns
 * the forward key and the inverse. The previous validator mapped
 * `r => r.key` only, so `is_blocked_by` failed validation even though
 * the evaluator handled it — rejecting exactly the reverse-direction
 * queries that make link querying worth having. `linkTask` writes the
 * inverse edge on the target, so both directions are real stored data.
 */
function validateRelationshipKind(
  kind: string | undefined,
  pos: number,
  opts: ValidateQueryOptions,
): void {
  if (kind === undefined) return;
  const wf = opts.workflow;
  // Without config there is nothing to check against; a caller that has
  // not loaded a workflow still gets field-name validation elsewhere.
  if (!wf) return;
  const known = (wf.relationships ?? []).flatMap(relationshipTypeKeys);
  if (!known.includes(kind)) {
    throw new QueryValidationError(
      `unknown relationship type "${kind}"`,
      pos,
      suggest(kind, known),
    );
  }
}

function customFieldKeys(opts: ValidateQueryOptions): string[] {
  return (opts.workflow?.custom_fields ?? []).map(d => d.key);
}
