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

/**
 * GIT-19. When the task open in this tab is rekeyed elsewhere (its
 * current key no longer matches the URL, and the URL key is now one of
 * its retired keys), the detail view *follows* the rekey: it navigates
 * to the current key and carries the retired key here so the note can
 * still explain what changed. Without it the redirect would land on the
 * new key with no trace of the rename, and the user — who never touched
 * this tab — would see the key silently swap. Garbage parses to
 * `undefined` like `tab`, so a hand-typed value only suppresses the note.
 */
const rekeyedFromParam = z
  .string()
  .optional()
  .transform((v): string | undefined => {
    if (v === undefined) return undefined;
    const s = v.trim();
    return s.length > 0 ? s : undefined;
  });

export const taskDetailSearchSchema = z.object({
  tab: tabParam,
  rekeyedFrom: rekeyedFromParam,
});

export type TaskDetailSearch = z.infer<typeof taskDetailSearchSchema>;
