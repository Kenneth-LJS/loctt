import { z } from "zod";

/**
 * Search-param schema for the task-detail route (`/tasks/$key`).
 *
 * The only param is `tab`: which of the activity lane's three tabs
 * (Comments / Activity / All) is open. CMT-18's second bullet requires
 * the open tab to record itself in the URL, "so a link to the activity
 * tab opens on the activity tab" — a param that lived only in component
 * state could not be shared or deep-linked.
 *
 * Garbage parses to `undefined` rather than throwing: this is the
 * route's `validateSearch`, so a throw would take down `/tasks/$key`
 * entirely instead of falling back. `?tab=nonsense` therefore opens on
 * the default tab (Comments), which is the desired fallback.
 */
export type TaskTab = "comments" | "activity" | "all";

const tabParam = z
  .string()
  .optional()
  .transform((v): TaskTab | undefined => {
    if (v === undefined) return undefined;
    const s = v.trim().toLowerCase();
    return s === "comments" || s === "activity" || s === "all" ? s : undefined;
  });

export const taskDetailSearchSchema = z.object({
  tab: tabParam,
});

export type TaskDetailSearch = z.infer<typeof taskDetailSearchSchema>;
