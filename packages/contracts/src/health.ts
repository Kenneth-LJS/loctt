import { z } from "zod";

/**
 * Phase-7B — the generalized corruption marker for **list-shaped config**
 * (projects, labels, milestones, sprints, calendar holidays, and any
 * other `{ items: Entry[] }` file).
 *
 * A task degrades per-*field* (`FieldHealth` in `task.ts`): one record,
 * some of whose fields are corrupt. A config list degrades per-*entry*:
 * one bad entry among many, exactly the shape `BrokenSavedQuery` (VUE-22)
 * pioneered for saved views. `BrokenEntry` is that pattern generalized so
 * every list loader reports corruption the same way — a valid entry loads,
 * a corrupt one becomes a `BrokenEntry` carrying its index, its raw text
 * and the validator's message, and the rest of the file still loads
 * (north-star principle 5: one bad entry never blanks the surface).
 *
 * Object-fatal corruption — the file is not even a list, or the outer
 * structure is malformed — still throws, exactly as before: there is no
 * coherent collection to degrade around.
 */
export const BrokenEntrySchema = z.object({
  /**
   * The entry's `id` when it could be read (most schemas require one), so
   * a surface can name *which* entry is broken. Absent when the id itself
   * is what failed.
   */
  id: z.string().min(1).optional(),
  /** 0-based position in the file's array — always available. */
  index: z.number().int().nonnegative(),
  /** One-line rendering of the stored entry, for display. */
  rawText: z.string(),
  /** The validator's message — what was expected. */
  error: z.string().min(1),
}).strict();
export type BrokenEntry = z.infer<typeof BrokenEntrySchema>;
