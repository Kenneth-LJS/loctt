import { z } from "zod";

import { IsoDate } from "./brands.js";
import { BrokenEntrySchema } from "./health.js";

/**
 * A single sprint definition. Time-boxed work intervals with no
 * lifecycle ceremony — `state` is just a label the user edits, no
 * automatic transitions or carryover.
 *
 *  - `id` is a ULID generated at creation, immutable, never shown.
 *    Tasks reference sprints by id via `TaskFrontmatter.sprint`.
 *  - `name` is the display name (e.g. "Sprint 12" or "2026.Q1").
 *    Mutable, not unique.
 *  - `start_date` / `end_date` define the sprint window (YYYY-MM-DD).
 *  - `state` is one of `active` / `completed` / `future`.
 *  - `goal` is an optional free-text note.
 *  - `archived` hides from default lists; hard-delete removes the
 *    entry entirely.
 */
export const SprintStateSchema = z.enum(["active", "completed", "future"]);
export type SprintState = z.infer<typeof SprintStateSchema>;

export const SprintDefSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  start_date: IsoDate,
  end_date: IsoDate,
  state: SprintStateSchema,
  goal: z.string().optional(),
  archived: z.boolean().optional(),
}).strict().superRefine((s, ctx) => {
  if (s.end_date < s.start_date) {
    ctx.addIssue({
      code: "custom",
      message: `End date is before the start date.`,
      path: ["end_date"],
    });
  }
});
export type SprintDef = z.infer<typeof SprintDefSchema>;

/** The full sprints.yaml shape. */
export const SprintsConfigSchema = z.object({
  sprints: z.array(SprintDefSchema),
  /**
   * Per-entry corruption, if any. One sprint whose fields no longer
   * validate (a hand edit, most often) becomes a `BrokenEntry` rather
   * than blanking the whole sprints surface (north-star principle 5).
   * Omitted (not `[]`) when every entry parsed, so a consumer reading
   * only `sprints` is unaffected and "none broken" stays distinct from
   * "not inspected". A load-time diagnostic — never written to disk.
   */
  broken: z.array(BrokenEntrySchema).optional(),
}).strict().superRefine((cfg, ctx) => {
  const seen = new Set<string>();
  for (const [i, s] of cfg.sprints.entries()) {
    if (seen.has(s.id)) {
      ctx.addIssue({ code: "custom", message: `duplicate sprint id: ${s.id}`, path: ["sprints", i, "id"] });
    }
    seen.add(s.id);
  }
});
export type SprintsConfig = z.infer<typeof SprintsConfigSchema>;
