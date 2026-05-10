import { z } from "zod";

import { IsoDate, SlugKey } from "./brands.js";

/**
 * A single milestone definition. Milestones are named checkpoints
 * with an optional target date — release markers, not time boxes.
 *
 *  - `key` is immutable.
 *  - `label` is the human display name; editable.
 *  - `target_date` is an optional ISO date (YYYY-MM-DD).
 *  - `archived` hides milestones from pickers without breaking
 *    historical task references.
 */
export const MilestoneDefSchema = z.object({
  key: SlugKey,
  label: z.string().min(1),
  target_date: IsoDate.optional(),
  archived: z.boolean().optional(),
}).strict();
export type MilestoneDef = z.infer<typeof MilestoneDefSchema>;

export const MilestonesConfigSchema = z.object({
  milestones: z.array(MilestoneDefSchema),
}).strict();
export type MilestonesConfig = z.infer<typeof MilestonesConfigSchema>;
