import type { TimelineGrouping, TimelineZoom } from "@loctt/contracts";
import { z } from "zod";

import { listSearchSchema } from "./listSearch.ts";

/**
 * Search-param schema for the timeline view (M3.3a).
 *
 * Built by extending the list's schema rather than redefining it, for
 * the same reason the board shares it outright (BRD-1, BRD-14): a
 * filter has to mean the same thing in every view, and `/timeline?assignee=…`
 * has to select the same tasks `/list?assignee=…` does. Extending adds
 * the three timeline-only display params without forking the filter
 * vocabulary.
 *
 * `zoom`, `grouping` and `arrows` are in the URL because TML-1, TML-3,
 * TML-8 and TML-15 each require the state to be shareable — pasting
 * the URL must reproduce the view "regardless of the workspace
 * default". A param that lives only in component state cannot do that.
 *
 * Every field is optional and garbage parses to `undefined` rather
 * than throwing: this is the route's `validateSearch`, so a throw
 * takes down `/timeline` entirely instead of falling back to a
 * default. `?zoom=fortnight` therefore opens at the configured
 * default, which is also what TML-1's fallback chain describes.
 */

/**
 * One of the three zooms, or undefined when absent/unrecognised.
 *
 * The return type is annotated rather than inferred: `.toLowerCase()`
 * widens to `string`, so without it the parsed search param types as
 * `string | undefined` and every consumer needs a cast back to
 * `TimelineZoom`. Annotating keeps the narrowing where it is checked,
 * so `resolveZoom` receives a real `TimelineZoom` and a typo in one of
 * these literals is a compile error rather than a silent widening.
 */
const zoomParam = z
  .string()
  .optional()
  .transform((v): TimelineZoom | undefined => {
    if (v === undefined) return undefined;
    const s = v.trim().toLowerCase();
    return s === "day" || s === "week" || s === "month" ? s : undefined;
  });

/**
 * A grouping value, or undefined when absent/unparseable.
 *
 * Parses *leniently* to a well-formed token, not to a value known to be
 * valid: the eight builtins, or a `field.<key>` custom-field reference.
 * Whether a `field.<key>` actually resolves against the live workflow is
 * `resolveGrouping`'s job (it holds the catalog); here we only reject
 * syntactic garbage so a `?grouping=fortnight` opens at the configured
 * default rather than throwing. Builtins are lowercased; a `field.` ref
 * keeps its key's case, since custom-field keys are case-sensitive.
 */
const BUILTIN_GROUPINGS = new Set<TimelineGrouping>([
  "none",
  "project",
  "milestone",
  "sprint",
  "assignee",
  "status",
  "priority",
  "task_type",
]);

const groupingParam = z
  .string()
  .optional()
  .transform((v): TimelineGrouping | undefined => {
    if (v === undefined) return undefined;
    const s = v.trim();
    const lower = s.toLowerCase();
    if (BUILTIN_GROUPINGS.has(lower as TimelineGrouping)) return lower as TimelineGrouping;
    if (/^field\.[A-Za-z0-9_-]+$/.test(s)) return s as TimelineGrouping;
    return undefined;
  });

/**
 * URL-safe boolean for the arrows toggle.
 *
 * Deliberately not `z.coerce.boolean()`: that is `Boolean(value)`, so
 * `?arrows=false` would parse as `true` and invert the toggle — the
 * exact trap `listSearch.ts` documents for its own `urlBool`.
 */
const arrowsParam = z
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

export const timelineSearchSchema = listSearchSchema.extend({
  zoom: zoomParam,
  grouping: groupingParam,
  arrows: arrowsParam,
});

export type TimelineSearch = z.infer<typeof timelineSearchSchema>;
