/**
 * The human label for a frontmatter field key, for prose that names the
 * field (the failure notice's headline, the save announcement — A11Y-24).
 *
 * Underscores to spaces, first letter capitalised. Deliberately **not**
 * a hardcoded map: a map would have to be kept in step with core's field
 * set, and a custom field the user declared (`fields.<key>` → the bare
 * `<key>` here) would fall out of it entirely and render blank.
 * Underscores-to-spaces is right for every one of them, so `start_date`
 * reads "Start date" and `points` reads "Points".
 *
 * Shared so the notice and the announcement cannot disagree about what a
 * field is called — the same rule the panel's own labels obey.
 */
export function fieldLabel(field: string): string {
  const words = field.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
