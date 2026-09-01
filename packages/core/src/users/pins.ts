import type { SidebarPins, UserSettings } from "@loctt/contracts";
import { SidebarPinsSchema } from "@loctt/contracts";

/**
 * The stale-pin sweep (SET-13, SET-27, VUE-38).
 *
 * A pinned saved view can be deleted from `queries.yaml` by a hand
 * edit, by `loctt view delete`, or by another checkout. The pin then
 * points at nothing.
 *
 * **The sweep does not drop it silently.** SET-13's third bullet says
 * it does, but that text was superseded: the README's P7 amendment
 * ("No carve-out for per-user preference drift", ui-test-cases
 * README.md:191-198) resolves the SHL-32 / SET-13 / SET-27 / XS-28
 * disagreement *in favour of the explaining cases*. So this returns
 * the removed ids alongside the surviving pins, and the caller says
 * what went — SET-27's second bullet.
 *
 * Zero matching tasks is **not** stale (SET-13's fourth bullet): this
 * asks only whether the view still exists, never how many tasks it
 * matches.
 */
export interface PinSweep {
  /** Pins whose views still exist, in their stored order. */
  readonly kept: SidebarPins;
  /** Pinned ids whose views are gone from `queries.yaml`. */
  readonly removed: readonly string[];
  /** Whether `kept` differs from what was stored — i.e. a write is owed. */
  readonly changed: boolean;
}

/**
 * Reads `sidebar_pins` out of settings, tolerating a hand-edited file.
 *
 * Settings round-trip through `.passthrough()`, so this key can hold
 * anything at all. A value that is not a clean id array is treated as
 * "no pins" rather than throwing — a broken preference must not make
 * the sidebar unrenderable (P7).
 */
export function readSidebarPins(settings: UserSettings | undefined): SidebarPins {
  const raw = (settings as { sidebar_pins?: unknown } | undefined)?.sidebar_pins;
  if (raw === undefined) return [];
  const parsed = SidebarPinsSchema.safeParse(raw);
  return parsed.success ? parsed.data : [];
}

/**
 * Partitions stored pins into those whose views still exist and those
 * whose views are gone.
 *
 * `existingViewIds` is the id set from `queries.yaml`. Order comes from
 * the pins, not from the view list: the pin order *is* the sidebar
 * order, which is the whole point of SET-13's drag list.
 */
export function sweepSidebarPins(
  pins: readonly string[],
  existingViewIds: Iterable<string>,
): PinSweep {
  const existing = new Set(existingViewIds);
  const kept: string[] = [];
  const removed: string[] = [];
  for (const id of pins) {
    if (existing.has(id)) kept.push(id);
    else removed.push(id);
  }
  return { kept, removed, changed: removed.length > 0 };
}
