import { z } from "zod";

import { HexColor } from "./brands.js";

/**
 * A single label definition. Labels live in `.loctt/config/labels.yaml`
 * and are referenced by their `id` from a task's `labels` array.
 *
 *  - `id` is a ULID generated at creation, immutable, never shown to
 *    users. Tasks reference labels by id.
 *  - `name` is the human display name. Mutable. Not unique
 *    (disambiguated by id when ambiguous).
 *  - `color` is an optional hex string (e.g. "#1e6fcb").
 *  - `archived` hides the label from default lists and pickers.
 *    Hard-delete (with explicit remap) removes the entry entirely.
 */
export const LabelDefSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  color: HexColor.optional(),
  archived: z.boolean().optional(),
}).strict();

export type LabelDef = z.infer<typeof LabelDefSchema>;

/** The full labels.yaml shape. */
export const LabelsConfigSchema = z.object({
  labels: z.array(LabelDefSchema),
}).strict().superRefine((cfg, ctx) => {
  const seen = new Set<string>();
  for (const [i, l] of cfg.labels.entries()) {
    if (seen.has(l.id)) {
      ctx.addIssue({ code: "custom", message: `duplicate label id: ${l.id}`, path: ["labels", i, "id"] });
    }
    seen.add(l.id);
  }
});

export type LabelsConfig = z.infer<typeof LabelsConfigSchema>;
