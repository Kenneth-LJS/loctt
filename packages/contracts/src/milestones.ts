import { z } from "zod";

import { IsoDate } from "./brands.js";

/**
 * A single milestone definition. Milestones are named checkpoints
 * with an optional target date — release markers, not time boxes.
 *
 *  - `id` is a ULID generated at creation, immutable, never shown.
 *    Tasks reference milestones by id.
 *  - `name` is the human display name. Mutable. Not unique
 *    (disambiguated by id when ambiguous).
 *  - `target_date` is an optional ISO date (YYYY-MM-DD).
 *  - `archived` hides milestones from pickers without breaking
 *    historical task references.
 */
export const MilestoneDefSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  target_date: IsoDate.optional(),
  archived: z.boolean().optional(),
}).strict();
export type MilestoneDef = z.infer<typeof MilestoneDefSchema>;

export const MilestonesConfigSchema = z.object({
  milestones: z.array(MilestoneDefSchema),
}).strict().superRefine((cfg, ctx) => {
  const seen = new Set<string>();
  for (const [i, m] of cfg.milestones.entries()) {
    if (seen.has(m.id)) {
      ctx.addIssue({ code: "custom", message: `duplicate milestone id: ${m.id}`, path: ["milestones", i, "id"] });
    }
    seen.add(m.id);
  }
});
export type MilestonesConfig = z.infer<typeof MilestonesConfigSchema>;
