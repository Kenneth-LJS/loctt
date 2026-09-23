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
 * non-empty string is truthy — so `?edit=false` would parse as
 * `true` and silently invert the flag. Parse the string forms the
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

/**
 * URL-safe positive integer with clamping. `z.coerce.number()` throws
 * on both garbage (`?page=abc`) and out-of-range (`?page=0`) — and
 * because this schema is the route's `validateSearch` and the client
 * has no `errorComponent`, a throw breaks the whole `/list` route
 * rather than just pagination.
 *
 * The two cases aren't the same bug, so they're handled differently:
 *
 * - Garbage (non-numeric, empty, NaN, Infinity) → `undefined`, so the
 *   consumer applies its own default. Matching `urlBool`.
 * - Out-of-range → clamped into `[min, max]`. The bound is still
 *   enforced (T0.3 called out range bounds as intentional); it just
 *   doesn't take the route down with it.
 *
 * Fractional values truncate toward zero before clamping, so
 * `?page=2.7` is page 2 rather than a route error.
 */
const urlInt = (min: number, max: number) =>
  z
    .union([z.number(), z.string()])
    .optional()
    .transform(v => {
      if (v === undefined) return undefined;
      const n = typeof v === "number" ? v : Number(v.trim());
      // Number("") is 0, and Number(" ") is 0 too — both are garbage
      // here, not "page zero". Guard on the raw string being empty.
      if (typeof v === "string" && v.trim() === "") return undefined;
      if (!Number.isFinite(n)) return undefined;
      return Math.min(max, Math.max(min, Math.trunc(n)));
    });

const csv = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform(v => {
    if (v === undefined) return undefined;
    const arr = Array.isArray(v) ? v : v.split(",");
    // De-duplicated here rather than at each consumer (LST-34). The
    // server tolerates repeats — `status in (done, done)` matches each
    // task once — so the result set looks correct while the chip row
    // renders the value twice, with a duplicate React key.
    const trimmed = [...new Set(arr.map(s => s.trim()).filter(Boolean))];
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

  // LST-40 / MSL-7: how multiple selected labels combine. `all` = a task
  // must have every selected label (AND); `any`/absent = any of them (OR,
  // the default). Only meaningful with 2+ labels; the label dropdown
  // shows the toggle then.
  labels_match: z.enum(["all", "any"]).optional(),

  // Sort: column key + direction. Both optional; falls back to view
  // default or updated_at desc.
  sort: z.string().optional(),
  dir: z.enum(["asc", "desc"]).optional(),

  // Pagination. Clamped rather than rejected — see `urlInt`.
  page: urlInt(1, Number.MAX_SAFE_INTEGER),
  limit: urlInt(1, 200),

  // VUE-22: open the advanced DSL editor on load, pre-populated from
  // `q`. Set by the "fix this view" affordance on a broken saved view,
  // so the malformed query lands in the editor to be repaired in place
  // rather than the user having to re-open it by hand.
  edit: urlBool,

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
/**
 * @deprecated Not wired to anything. The router's own `stringifySearch`
 * (router/index.tsx) is what actually produces list URLs; this
 * duplicates that logic and returns a record rather than a query
 * string. It had tests and no caller while the real URLs were being
 * JSON-encoded — which is how the CSV format in LST-9 drifted
 * unnoticed. Kept only so its tests keep documenting the intended
 * shape; delete it once nothing references it.
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
