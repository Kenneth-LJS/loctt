import { z } from "zod";

import { IsoDate, SprintKey } from "./brands.js";

/**
 * A single sprint definition. Watered-down per the design doc:
 * tasks belong to zero or one sprint via `TaskFrontmatter.sprint`,
 * `state` is just a field the user edits (no start/complete
 * lifecycle ceremony), and there's no carryover.
 *
 *  - `key` is immutable.
 *  - `label` is the human display name.
 *  - `start_date` / `end_date` define the sprint window
 *    (YYYY-MM-DD).
 *  - `state` is one of `active` / `completed` / `future`.
 *  - `goal` is an optional free-text note.
 *  - `archived` hides from default lists; hard-delete removes
 *    the entry entirely.
 */
export const SprintStateSchema = z.enum(["active", "completed", "future"]);
export type SprintState = z.infer<typeof SprintStateSchema>;

export const SprintDefSchema = z.object({
  key: SprintKey,
  label: z.string().min(1),
  start_date: IsoDate,
  end_date: IsoDate,
  state: SprintStateSchema,
  goal: z.string().optional(),
  archived: z.boolean().optional(),
}).strict().superRefine((s, ctx) => {
  if (s.end_date < s.start_date) {
    ctx.addIssue({
      code: "custom",
      message: `end_date (${s.end_date}) must not be before start_date (${s.start_date})`,
      path: ["end_date"],
    });
  }
});
export type SprintDef = z.infer<typeof SprintDefSchema>;

/** The full sprints.yaml shape. */
export const SprintsConfigSchema = z.object({
  sprints: z.array(SprintDefSchema),
}).strict();
export type SprintsConfig = z.infer<typeof SprintsConfigSchema>;
