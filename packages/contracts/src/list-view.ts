import { z } from "zod";

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
}).strict();
export type ListViewConfig = z.infer<typeof ListViewConfigSchema>;
