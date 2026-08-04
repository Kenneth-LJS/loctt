import { z } from "zod";

/**
 * Search-param schema for the list view. The URL is the source of
 * truth for filters/sort/page — bookmarking and back-forward both rely
 * on this. Multi-value filters arrive as comma-separated strings in
 * the URL and parse to arrays here.
 *
 * Sort keys are intentionally typed as `string` rather than an enum.
 * Custom-field columns ("fields.impact") are valid sort keys and the
 * set isn't known until the workflow config loads. The list view
 * validates the key against the active workflow before applying.
 */

/**
 * URL-safe boolean. `z.coerce.boolean()` is `Boolean(value)`, and every
 * non-empty string is truthy — so `?archived=false` would parse as
 * `true` and silently invert the toggle. Parse the string forms the
 * serializer can emit ("true"/"false") plus the common hand-written
 * "1"/"0", and treat anything else (absent, empty, garbage) as
 * undefined so consumers fall back to their own default rather than
 * failing the whole route's validateSearch.
 */
const urlBool = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform(v => {
    if (typeof v === "boolean") return v;
    if (v === undefined) return undefined;
    const s = v.trim().toLowerCase();
    if (s === "true" || s === "1") return true;
    if (s === "false" || s === "0") return false;
    return undefined;
  });

const csv = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform(v => {
    if (v === undefined) return undefined;
    const arr = Array.isArray(v) ? v : v.split(",");
    const trimmed = arr.map(s => s.trim()).filter(Boolean);
    return trimmed.length > 0 ? trimmed : undefined;
  });

export const listSearchSchema = z.object({
  // Free-text query, applied client-side via the same DSL as saved
  // views (text ~ "...")
  q: z.string().optional(),

  // Filters. Each is an optional array of ids / keys depending on the
  // domain (projects/users/labels/milestones/sprints are ULIDs;
  // status/priority/type are workflow keys).
  project: csv,
  status: csv,
  priority: csv,
  type: csv,
  assignee: csv,
  reporter: csv,
  labels: csv,
  milestone: csv,
  sprint: csv,

  // Sort: column key + direction. Both optional; falls back to view
  // default or updated_at desc.
  sort: z.string().optional(),
  dir: z.enum(["asc", "desc"]).optional(),

  // Pagination
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),

  // Toggles
  archived: urlBool,

  // Saved-view id — when set, the view's own filters/sort apply and
  // the params above act as overrides
  view: z.string().optional(),
})
  // Pass unknown keys through rather than reject. TanStack Router
  // preserves search params across route transitions so other routes
  // (or global concerns like `?debug=1`) can share the URL bag without
  // tripping a parse error here.
  .passthrough();

export type ListSearch = z.infer<typeof listSearchSchema>;

/**
 * Serializes a ListSearch back to a URLSearchParams-compatible record
 * for emitting URLs. Arrays become comma-joined; undefined fields are
 * dropped (so they don't show up as `?project=` in the URL).
 *
 * The schema's input type accepts comma strings *or* arrays; round-
 * tripping uses arrays in memory and CSV in the URL.
 */
export function serializeListSearch(search: Partial<ListSearch>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(search)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      if (v.length === 0) continue;
      out[k] = v.join(",");
    } else if (typeof v === "string") {
      out[k] = v;
    } else if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") {
      out[k] = v.toString();
    } else {
      // Objects/symbols/functions don't have a useful URL form. Skip
      // rather than emit "[object Object]".
      continue;
    }
  }
  return out;
}
