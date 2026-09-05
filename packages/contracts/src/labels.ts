import { z } from "zod";

import { HexColor } from "./brands.js";
import { BrokenEntrySchema } from "./health.js";

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
  /**
   * Per-entry corruption, if any. A structurally-corrupt label entry
   * (a wrong-typed field other than the salvaged `color`) degrades to a
   * `BrokenEntry` rather than blanking the whole labels surface, exactly
   * like `QueriesConfig.broken`. Omitted (not `[]`) when every entry
   * parsed, so existing consumers that read only `labels` are unaffected
   * and "none broken" stays distinct from "not inspected". Never written
   * back to disk — it is a load-time diagnostic.
   */
  broken: z.array(BrokenEntrySchema).optional(),
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
