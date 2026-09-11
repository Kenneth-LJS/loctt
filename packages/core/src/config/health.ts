import type { BrokenEntry } from "@loctt/contracts";
import { parse as parseYaml } from "yaml";
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

/**
 * K28 — config-level preserve-others. A config *writer* re-serializes
 * only its VALID entries; without this, a `broken` (corrupt-but-preserved)
 * entry another process left is silently dropped from disk on any
 * unrelated write — the config analogue of the task write guard, and a
 * P1 data-loss violation.
 *
 * `BrokenEntry.rawText` is the entry's own YAML (`renderRawText` =
 * `stringifyYaml(raw)`), so parsing it back reconstructs the entry's
 * values (K27 value-preserved, not byte-identity). This returns the
 * broken entries as plain objects to splice back into the written array,
 * so a save preserves them. Any entry whose `rawText` will not re-parse
 * to an object is skipped rather than corrupting the write (it cannot be
 * faithfully re-emitted; that is a separate, rarer failure).
 */
export function brokenEntriesToPlain(
  broken: readonly BrokenEntry[] | undefined,
  // K29 / DEG-24: ids already present among the serialized VALID entries.
  // A broken entry whose `id` collides with a valid one is DROPPED rather
  // than written, so a save never puts two members with one `id` on disk.
  // Without this, the collision is invisible to `doctor` until the broken
  // twin is repaired — at which point the duplicate surfaces and every
  // write is refused (the same trap the workflow writer's
  // `mergeBrokenIntoPlain` closes, here generalized to the id-keyed flat
  // configs). Omitting `excludeIds` keeps the old behaviour.
  excludeIds?: ReadonlySet<string>,
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const b of broken ?? []) {
    try {
      const parsed: unknown = parseYaml(b.rawText);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        const obj = parsed as Record<string, unknown>;
        const id = obj["id"];
        if (excludeIds !== undefined && typeof id === "string" && excludeIds.has(id)) {
          // Collision with a valid entry's id — drop the broken twin.
          continue;
        }
        out.push(obj);
      }
    } catch {
      // Unparseable rawText — cannot re-emit faithfully; skip rather than
      // write a broken shape. Rare; the common case is a wrong-TYPED field
      // whose YAML is well-formed.
    }
  }
  return out;
}

export { renderRawText };
