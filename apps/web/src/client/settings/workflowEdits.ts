import type {
  CustomFieldDef,
  EstimationConfig,
  HolidayDef,
  PriorityDef,
  RelationshipDef,
  StatusDef,
} from "@loctt/contracts";

/**
 * The pure edit rules behind the M4.2 workflow panels.
 *
 * These live outside the components so the rules that decide what gets
 * *sent* are testable without a browser — and, more to the point, so a
 * UI test asserting the file on disk cannot pass while the client sent
 * the wrong value and the server quietly repaired it. Each function
 * here produces exactly what the panel PUTs.
 */

/** Moves the item at `from` to index `to`, returning a new array. */
export function reorder<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return [...items];
  next.splice(to, 0, moved);
  return next;
}

/**
 * SET-6, SET-21: reordering priorities recomputes `value` from
 * position, so a priority sort matches the new order with no manual
 * edit.
 *
 * Lower `value` sorts first, and the panel renders priorities in the
 * order the user dragged them, so position 0 gets the lowest value.
 * Values are `10, 20, 30 …` rather than `0, 1, 2 …`: SET-21 is
 * explicitly about the resort *not* being a surprise, and leaving gaps
 * means a later hand-edit inserting one between two existing
 * priorities does not have to renumber the file.
 *
 * Every priority is renumbered, including ones whose position did not
 * change — a partial renumber is how two priorities end up sharing a
 * value.
 */
export function renumberPriorities(priorities: readonly PriorityDef[]): PriorityDef[] {
  return priorities.map((p, i) => ({ ...p, value: (i + 1) * 10 }));
}

/**
 * SET-5 / CW-15: the symmetric checkbox is a control over `kind`.
 *
 * Ticking it drops `inverse` and `inverse_label` — the schema rejects a
 * symmetric relationship whose `inverse` differs from its `key`, and it
 * writes no `symmetric` boolean because there is no such field.
 * Unticking restores the values the row had before, which is why the
 * caller passes them back in: SET-5's last bullet wants the previous
 * values, not blanks.
 */
export function setRelationshipSymmetric(
  rel: RelationshipDef,
  symmetric: boolean,
  restore?: { readonly inverse?: string; readonly inverse_label?: string },
): RelationshipDef {
  if (symmetric) {
    const { inverse: _inverse, inverse_label: _inverseLabel, ...rest } = rel;
    return { ...rest, kind: "symmetric" };
  }
  return {
    ...rel,
    kind: "directional",
    inverse: restore?.inverse ?? rel.inverse ?? "",
    inverse_label: restore?.inverse_label ?? rel.inverse_label ?? "",
  };
}

/** True when the relationship reads as symmetric (SET-4: `kind`, not a boolean). */
export function isSymmetric(rel: RelationshipDef): boolean {
  return rel.kind === "symmetric";
}

/**
 * SET-9 / SET-35: what blocks an estimation save, per field.
 *
 * The server rejects these too (the Zod superRefine on
 * `EstimationConfigSchema`), which is the point of duplicating them
 * here rather than relying on the round-trip: SET-35 wants the error
 * *attached to the field*, not delivered as a generic toast, and a
 * 400's envelope carries at most one field path.
 */
export interface EstimationProblems {
  readonly unit_label?: string;
  readonly preset_values?: string;
}

export function validateEstimation(cfg: EstimationConfig): EstimationProblems {
  const problems: { unit_label?: string; preset_values?: string } = {};
  if (cfg.unit === "custom_numeric" || cfg.unit === "custom_enum") {
    if (cfg.unit_label === undefined || cfg.unit_label.trim().length === 0) {
      problems.unit_label = `A unit label is required for any custom_* mode (this is ${cfg.unit}).`;
    }
  }
  if (cfg.unit === "custom_enum") {
    if (cfg.preset_values === undefined || cfg.preset_values.length === 0) {
      problems.preset_values =
        "custom_enum requires preset values — the categories an estimate can take. "
        + "A unit label is required too.";
    }
  }
  return problems;
}

/** `YYYY-MM-DD`, and a date that actually exists. */
export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  if (m < 1 || m > 12) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y
    && date.getUTCMonth() === m - 1
    && date.getUTCDate() === d;
}

/**
 * SET-36: which holiday rows are unparseable, by index.
 *
 * Returns indices rather than filtering, because SET-36 is explicit
 * that the twelve valid rows are **not** discarded — the panel marks
 * the one bad row and blocks the save. A function that returned "the
 * valid ones" would be the shape of the bug.
 */
export function invalidHolidayIndices(holidays: readonly { date: string }[]): number[] {
  return holidays.flatMap((h, i) => (isValidIsoDate(h.date) ? [] : [i]));
}

/**
 * SET-23: duplicate dates are shown as duplicates, not silently
 * deduplicated. Returns the indices of every row whose date appears
 * more than once (all occurrences, so both rows are marked).
 */
export function duplicateHolidayIndices(holidays: readonly { date: string }[]): number[] {
  const seen = new Map<string, number>();
  for (const h of holidays) seen.set(h.date, (seen.get(h.date) ?? 0) + 1);
  return holidays.flatMap((h, i) => ((seen.get(h.date) ?? 0) > 1 ? [i] : []));
}

/**
 * SET-24: is the stored timezone one this runtime can resolve?
 *
 * `Intl.DateTimeFormat` throws `RangeError` on an unknown zone, which
 * is the only check available in a browser. A renamed zone such as
 * `America/Godthab` may resolve on some runtimes via the CLDR alias
 * table and not others; the panel reports what *this* runtime found,
 * which is what governs the dates the user is looking at.
 */
export function timezoneResolves(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The zones the picker offers — never including an unresolvable current value. */
export function supportedTimezones(): string[] {
  const supported = (Intl as unknown as {
    supportedValuesOf?: (k: string) => string[];
  }).supportedValuesOf;
  if (typeof supported === "function") {
    try {
      return supported("timeZone");
    } catch {
      // fall through
    }
  }
  return ["UTC"];
}

/**
 * SET-8: whether a custom enum's values carry weights, and therefore
 * which sort applies. The panel states the fallback rather than
 * leaving the user to infer it.
 */
export type EnumSortBasis = "weight" | "declared";

export function enumSortBasis(field: CustomFieldDef): EnumSortBasis {
  const values = field.values ?? [];
  return values.some(v => v.value !== undefined) ? "weight" : "declared";
}

/**
 * Moves the default marker to `key`, clearing it everywhere else.
 *
 * `WorkflowConfigSchema` rejects a document with zero or two defaults,
 * so setting one has to unset the other in the same edit; doing it as
 * two panel actions would make the intermediate state unsavable.
 */
export function setDefaultStatus(
  statuses: readonly StatusDef[],
  key: string,
): StatusDef[] {
  return statuses.map(s => {
    if (s.key === key) return { ...s, default: true };
    const { default: _default, ...rest } = s;
    return rest;
  });
}

/** SET-36 helper: a holiday row the panel can render before it is valid. */
export function blankHoliday(): HolidayDef {
  return { date: "", label: "Holiday" };
}
