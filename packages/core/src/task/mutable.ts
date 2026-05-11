import type { TaskFrontmatter } from "@loctt/contracts";

/**
 * A mutable, untyped view of a `TaskFrontmatter`. The schema is mostly
 * `readonly` and uses unions of optional fields, which makes legitimate
 * mutation (e.g. `delete copy.priority`, `copy[field] = value` for a
 * dynamic field name) impossible without per-call casts.
 *
 * This module centralizes the unsafe shape conversion at one boundary
 * so the rest of the task module never reaches for `as unknown as
 * TaskFrontmatter` casts. Callers should:
 *
 *   1. `toMutable(fm)` — get an editable shallow copy.
 *   2. Mutate the copy (add/delete/rename fields).
 *   3. `toFrontmatter(copy)` — convert back, typically right before
 *      a workflow- or schema-level validator runs (which is what
 *      actually re-establishes the invariant).
 *
 * The cast in `toFrontmatter` is unsafe by language rules but correct
 * by construction: every call site we use it from is followed by a
 * Zod schema validation (`validateTaskAgainstWorkflow`, `parseFrontmatter`
 * on the round-trip, etc.) before the value reaches disk or the wider
 * API.
 */
export type MutableFrontmatter = Record<string, unknown>;

/** Returns a shallow mutable copy of `fm` suitable for in-place edits. */
export function toMutable(fm: TaskFrontmatter): MutableFrontmatter {
  return { ...fm };
}

/**
 * Re-types a mutable frontmatter back to `TaskFrontmatter`. The caller
 * is responsible for ensuring the shape is valid — typically via a
 * subsequent `validateTaskAgainstWorkflow` call or by writing through
 * `writeTask`, which round-trips the file through the schema.
 */
export function toFrontmatter(m: MutableFrontmatter): TaskFrontmatter {
  return m as unknown as TaskFrontmatter;
}

/**
 * Reads a single field from a frontmatter by dynamic name. Used by
 * history-diff helpers that need to compare the prior value of a
 * builtin or pass-through field without enumerating the union.
 */
export function readField(fm: TaskFrontmatter, field: string): unknown {
  return (fm as unknown as MutableFrontmatter)[field];
}
