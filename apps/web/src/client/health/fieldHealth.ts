import type { FieldHealthKind } from "@loctt/contracts";

/**
 * Phase-7B client foundation (decision A137 / A137.1).
 *
 * The corruption DATA model is split — healthy field values live in
 * `frontmatter`, corrupt ones in a `health` list — so consumers do not
 * get a typed lie. But the UI wants ONE uniform shape per field, so it
 * never special-cases "is this field in health?" inline. This helper is
 * that view-model, computed at the render edge from the wire `health`.
 *
 * A field can carry BOTH a value and health at once (A137.1): an
 * *intrinsic* wrong-typed field is lifted whole into health (value
 * absent, `fieldHealth` present); an *extrinsic* fault indexes one
 * element (`labels[2]`, `relationships[1].target`) while the field's
 * value stays in `frontmatter`. So `value` and health co-exist, and
 * element faults are a LIST.
 */

/** One health finding as it arrives on the wire (raw omitted; rawText travels). */
export interface WireHealth {
  readonly field: string;
  readonly kind: FieldHealthKind;
  readonly rawText: string;
  readonly error: string;
  readonly repair: "set" | "remove" | "set_or_remove";
}

/** The per-field view-model a Row / cell reads — one shape, healthy or not. */
export interface FieldView<V = unknown> {
  readonly field: string;
  /**
   * The healthy value, when present. Absent when an intrinsic fault
   * lifted the whole field into `fieldHealth`.
   */
  readonly value: V | undefined;
  /** A whole-field fault (wrong_type / missing_required / unrecognised). */
  readonly fieldHealth: WireHealth | undefined;
  /**
   * Per-element faults on an array/map field (`labels[2]`,
   * `relationships[1].target`, `fields.x[1]`). Empty for a scalar field.
   */
  readonly elementHealth: readonly WireHealth[];
}

/** True when a field needs an attention marker (whole-field OR any element). */
export function isDegraded(v: FieldView): boolean {
  return v.fieldHealth !== undefined || v.elementHealth.length > 0;
}

/**
 * Builds the view-model for one top-level field `f` by merging the
 * field's value with any matching entries in `health`.
 *
 * - `fieldHealth` = the whole-field entry whose `field` is exactly `f`,
 *   but ONLY for a kind that lifted the value OFF `frontmatter`
 *   (`wrong_type`, `missing_required`, `unrecognised`). For those the row
 *   would otherwise render a bare "—" hiding a real stored value, which is
 *   what the corrupt notice exists to prevent.
 *
 *   An EXTRINSIC fault (`dangling` — a deleted user; `invalid_value` —
 *   enum/custom-field-type drift) leaves the value ON `frontmatter`, so the
 *   field's own picker still renders it (with its own missing/orphaned
 *   indicator). Flagging those here too would put a "⚠ corrupt: ghost"
 *   notice with a Clear ABOVE a picker that still holds `ghost` — a double,
 *   mislabelled signal. So they are excluded (matching this function's
 *   long-standing docstring, which the unfiltered `find` had drifted from).
 * - `elementHealth` = entries whose `field` is `f[...]` or `f.something`
 *   (a sub-position of `f`), e.g. `labels[2]`, `relationships[1].target`.
 */
const VALUE_LIFTED_KINDS = new Set(["wrong_type", "missing_required", "unrecognised"]);

export function fieldView<V = unknown>(
  field: string,
  value: V | undefined,
  health: readonly WireHealth[] | undefined,
): FieldView<V> {
  const list = health ?? [];
  const fieldHealth = list.find(h => h.field === field && VALUE_LIFTED_KINDS.has(h.kind));
  const elementHealth = list.filter(
    h => h.field !== field && isElementOf(h.field, field),
  );
  return { field, value, fieldHealth, elementHealth };
}

/**
 * Whether `path` is a sub-position of top-level field `field` — i.e. it
 * starts with `field` immediately followed by `[` (array index) or `.`
 * (object member). `"labels"` is a sub-position of neither `"label"` nor
 * `"labels2"`, so the boundary check matters.
 */
export function isElementOf(path: string, field: string): boolean {
  if (!path.startsWith(field)) return false;
  const next = path.charAt(field.length);
  return next === "[" || next === ".";
}

/**
 * The health entries that belong to no known field — used to render the
 * "Not recognised" group. An `unrecognised` finding's `field` is the bare
 * unknown key, so this is just the entries of that kind.
 */
export function unrecognisedHealth(
  health: readonly WireHealth[] | undefined,
): readonly WireHealth[] {
  return (health ?? []).filter(h => h.kind === "unrecognised");
}
