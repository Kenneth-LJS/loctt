/**
 * The "edited" marker's text (CMT-5, CMT-35).
 *
 * ## Why this is a copy of core's `formatCommentEditors`
 *
 * Core has the same function, tested, in `task/comments.ts`. It is not
 * imported here for the reason `useSetField.ts` gives for
 * `BUILTIN_OPTIONAL_FIELDS`: `@loctt/core` is a Node package whose
 * barrel reaches `node:fs`, `node:crypto` and `proper-lockfile`, and
 * pulling it into the browser bundle to read one pure string helper
 * would drag all of that in behind it. No client module imports core
 * today; the only client files that do are tests, which run in Node.
 *
 * The drift risk is real and bounded: this decides *display text*
 * only. It reads the same `edited` / `editors` fields the API returns
 * verbatim from the file, so the two cannot disagree about *who*
 * edited — only, at worst, about how to punctuate a list of three
 * names. `editors.test.ts` pins this copy against core's own cases.
 *
 * The one deliberate difference from core: core falls back to the raw
 * id for an editor it cannot name. This does not — a ULID in UI
 * content is the LST-33 defect, and the caller passes a resolver that
 * returns undefined for an unknown id so the honest fallback below
 * applies instead.
 */

/** What an editor we cannot name is called. Never the raw ULID. */
export const UNKNOWN_EDITOR = "an unknown user";

export function formatCommentEditors(
  comment: { readonly edited?: true; readonly editors?: readonly string[] },
  resolveName: (userId: string) => string | undefined,
): string | undefined {
  if (comment.edited !== true) return undefined;
  const editors = comment.editors ?? [];
  // No editors means the author edited their own comment: core
  // excludes self-edits from the list, so there is no name to show and
  // the marker is bare. CMT-5's "which marker depends on who edited".
  if (editors.length === 0) return "Edited";
  const names = editors.map(id => resolveName(id) ?? UNKNOWN_EDITOR);
  return `Edited by ${formatNameList(names)}`;
}

/** Joins names with an Oxford comma: "A", "A and B", "A, B, and C". */
function formatNameList(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}
