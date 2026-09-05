import type { BrokenEntry } from "@loctt/contracts";
import type { z } from "zod";

import { renderRawText } from "../task/frontmatter.js";
import { formatZodIssues } from "./zod-error.js";

/**
 * Phase-7B — the generalized per-entry tolerant collect for list-shaped
 * config (projects, labels, milestones, sprints, calendar holidays, …).
 *
 * Given the already-extracted array of raw entries and the per-entry
 * schema, returns the entries that parse plus a `BrokenEntry[]` for the
 * ones that do not — the `BrokenSavedQuery` pattern (VUE-22,
 * `config/queries.ts`) generalized so every list loader degrades the same
 * way. A valid entry loads; a corrupt one is set aside with its index,
 * raw text and the validator's message; the rest of the file still loads.
 *
 * This is deliberately NOT the whole loader: the caller still owns
 * extracting the array (object-fatal if the file is not a list), and any
 * cross-entry checks (duplicate ids, a superRefine) that are themselves
 * object-fatal. It owns only the per-entry degrade.
 *
 * `idOf` lets the caller name which entry is broken when the raw entry
 * still carries a readable id; it must never throw (a corrupt entry may
 * have no id at all).
 */
export function collectValidEntries<T>(
  rawEntries: readonly unknown[],
  schema: z.ZodType<T>,
  label: string,
  idOf: (raw: unknown) => string | undefined = defaultIdOf,
): { valid: T[]; broken: BrokenEntry[] } {
  const valid: T[] = [];
  const broken: BrokenEntry[] = [];
  rawEntries.forEach((raw, index) => {
    const parsed = schema.safeParse(raw);
    if (parsed.success) {
      valid.push(parsed.data);
      return;
    }
    const id = idOf(raw);
    broken.push({
      ...(id !== undefined ? { id } : {}),
      index,
      rawText: renderRawText(raw),
      error: formatZodIssues(label, parsed.error),
    });
  });
  return { valid, broken };
}

/** Reads `raw.id` when the entry is an object with a string id. */
function defaultIdOf(raw: unknown): string | undefined {
  if (raw !== null && typeof raw === "object" && "id" in raw) {
    const id = (raw as { id: unknown }).id;
    if (typeof id === "string" && id.length > 0) return id;
  }
  return undefined;
}

export { renderRawText };
