import { z } from "zod";

import { HexColor, SlugKey } from "./brands.js";

/**
 * A single label definition. Labels live in `.loctt/config/labels.yaml`
 * and are referenced by their `key` from a task's `labels` array.
 *
 *  - `key` is immutable.
 *  - `label` is the human display name; editable.
 *  - `color` is an optional hex string (e.g. "#1e6fcb").
 *  - `archived` hides the label from default lists and pickers.
 *    Hard-delete (with explicit remap) removes the entry entirely.
 */
export const LabelDefSchema = z.object({
  key: SlugKey,
  label: z.string().min(1),
  color: HexColor.optional(),
  archived: z.boolean().optional(),
}).strict();

export type LabelDef = z.infer<typeof LabelDefSchema>;

/** The full labels.yaml shape. */
export const LabelsConfigSchema = z.object({
  labels: z.array(LabelDefSchema),
}).strict();

export type LabelsConfig = z.infer<typeof LabelsConfigSchema>;
