import { readLocal, writeLocal } from "../shell/storage.ts";
import type { SprintColumn } from "./columns.ts";
import { defaultExpanded } from "./columns.ts";

/**
 * Expand/collapse persistence for the sprints view (SPR-3).
 *
 * **`localStorage`, per browser — V12, already decided.** SPR-3's
 * third bullet is explicit that this is per-user UI state and must not
 * write to `sprints.yaml`: a collapse is a preference, and putting it
 * in config would make one user's reading posture a change every other
 * surface sees in a git diff.
 *
 * ## Why overrides rather than a full expanded-set
 *
 * SPR-3's second bullet: "the default is a default, not an override
 * applied on every render". Storing the set of expanded ids cannot
 * express *collapsing the active sprint* — on reload the active
 * sprint's default would put it straight back. So what is stored is
 * the set of columns whose state **differs from their default**, and
 * the default is re-applied to everything else. A new sprint the user
 * has never touched picks up the correct default rather than
 * inheriting whatever was last written.
 */
const STORAGE_KEY = "loctt.sprints.collapse";

/** Column ids whose expanded state differs from the default. */
export type CollapseOverrides = ReadonlySet<string>;

export function readOverrides(): CollapseOverrides {
  const raw = readLocal(STORAGE_KEY);
  if (raw === null) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    // Anything else in the slot is another version's shape, or a hand
    // edit. Ignored rather than thrown — a bad preference must not
    // take the view down (SHL-18's posture).
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is string => typeof v === "string"));
  } catch {
    return new Set();
  }
}

export function writeOverrides(overrides: CollapseOverrides): void {
  writeLocal(STORAGE_KEY, JSON.stringify([...overrides]));
}

/** Whether a column renders expanded, defaults plus the user's overrides. */
export function isExpanded(column: SprintColumn, overrides: CollapseOverrides): boolean {
  const base = defaultExpanded(column);
  return overrides.has(column.id) ? !base : base;
}

/**
 * The overrides after toggling one column.
 *
 * Toggling a column back to its default *removes* the entry rather
 * than storing the default explicitly, so the set never grows without
 * bound and a later change to a sprint's `state` still moves the
 * columns the user never touched.
 */
export function toggle(column: SprintColumn, overrides: CollapseOverrides): CollapseOverrides {
  const next = new Set(overrides);
  if (next.has(column.id)) next.delete(column.id);
  else next.add(column.id);
  return next;
}
