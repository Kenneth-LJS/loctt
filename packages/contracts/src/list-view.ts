import { z } from "zod";

import { BrokenEntrySchema } from "./health.js";

/**
 * Built-in field keys recognised as filter chips on the list view.
 * Used as the allowlist for entries in
 * `list-view.yaml#filters.visible/hidden`: an entry must either be
 * one of these built-ins or match a declared `custom_fields[].key`
 * in `workflow.yaml`. Doctor surfaces dangling references.
 *
 * Single source of truth — both the doctor check and (eventually) the
 * UI's "+ Filter" picker read this list rather than redeclaring it.
 */
export const BUILTIN_FILTER_FIELD_KEYS: ReadonlySet<string> = new Set([
  "status",
  "priority",
  "type",
  "assignee",
  "reporter",
  "labels",
  "milestone",
  "sprint",
  "project",
]);

/**
 * Workspace-level list-view filter chip configuration. Stored at
 * `.loctt/config/list-view.yaml` (committed, shared across the team).
 *
 * Two fields, both optional:
 *  - `visible`: explicit allowlist. When absent, all built-in field
 *    chips and every declared custom field are shown by default. When
 *    present, only the listed field keys render as chips.
 *  - `hidden`: explicit denylist. Always takes precedence over
 *    `visible` (an entry in both is hidden).
 *
 * Each entry must reference either a built-in field key (status,
 * priority, type, assignee, reporter, labels, milestone, sprint,
 * project) or a declared `custom_fields[].key` in workflow.yaml.
 * Validation of cross-config references happens in the workflow writer
 * — at the contract level we only enforce shape, uniqueness within
 * each array, and that no key appears in both arrays.
 *
 * Per-user overrides (theme, card layout, user-pinned filter chips,
 * etc.) live in `users/<id>/settings.yaml` and are out of scope here.
 */
export const ListViewFiltersSchema = z.object({
  visible: z.array(z.string().min(1)).optional(),
  hidden: z.array(z.string().min(1)).optional(),
}).strict().superRefine((cfg, ctx) => {
  const checkDuplicates = (arr: readonly string[], field: "visible" | "hidden") => {
    const seen = new Set<string>();
    arr.forEach((k, i) => {
      if (seen.has(k)) {
        ctx.addIssue({
          code: "custom",
          message: `duplicate entry '${k}' in ${field}`,
          path: [field, i],
        });
      }
      seen.add(k);
    });
  };
  if (cfg.visible) checkDuplicates(cfg.visible, "visible");
  if (cfg.hidden) checkDuplicates(cfg.hidden, "hidden");
  // visible ∩ hidden is documented as "hidden wins," but accepting
  // both invites typos that silently disagree across the team. Force
  // the user to remove one — keeps intent unambiguous.
  if (cfg.visible && cfg.hidden) {
    const hiddenSet = new Set(cfg.hidden);
    cfg.visible.forEach((k, i) => {
      if (hiddenSet.has(k)) {
        ctx.addIssue({
          code: "custom",
          message: `'${k}' appears in both visible and hidden`,
          path: ["visible", i],
        });
      }
    });
  }
});
export type ListViewFilters = z.infer<typeof ListViewFiltersSchema>;

export const ListViewConfigSchema = z.object({
  filters: ListViewFiltersSchema.optional(),
  /**
   * Per-entry corruption, if any — an individual filter-chip key inside
   * `filters.visible` / `filters.hidden` that no longer validates (a
   * non-string or empty string, a hand edit most often) becomes a
   * `BrokenEntry` rather than blanking the whole saved view (north-star
   * principle 5, the VUE-22 pattern generalized). The good keys in the
   * same array still load.
   *
   * Omitted (not `[]`) when every entry parsed, so a consumer reading
   * only `filters` is unaffected and "none broken" stays distinct from
   * "not inspected". A load-time diagnostic only — never serialized back
   * to disk. The loader parses the file through a separate raw schema
   * that has no `broken` key, so a stray `broken:` in a hand-edited file
   * is still rejected.
   *
   * Attached by `parseListViewConfig` after the fact, not by this
   * schema's own validation: object-fatal problems — a malformed outer
   * structure, a non-array `visible`/`hidden`, a duplicate within an
   * array, or a key in both arrays — still throw. list-view.yaml is more
   * record-shaped than the other configs; only these two sub-arrays hold
   * a genuine list of entries to degrade around.
   */
  broken: z.array(BrokenEntrySchema).optional(),
}).strict();
export type ListViewConfig = z.infer<typeof ListViewConfigSchema>;

/**
 * The object-fatal outer shape used by the loader. `filters` (when
 * present) must be an object whose `visible`/`hidden` are arrays, and no
 * unknown keys are allowed at either level — but the array *entries* stay
 * `unknown` so a single corrupt chip key does not fail the whole
 * `.parse()` and blank the saved view. Per-ENTRY validation happens
 * afterwards through `collectValidEntries` in the loader.
 *
 * No `broken` key here: a stray `broken:` in a hand-edited file is
 * rejected, and the loader attaches the real diagnostic itself.
 */
export const RawListViewConfigSchema = z.object({
  filters: z.object({
    visible: z.array(z.unknown()).optional(),
    hidden: z.array(z.unknown()).optional(),
  }).strict().optional(),
}).strict();
export type RawListViewConfig = z.infer<typeof RawListViewConfigSchema>;
