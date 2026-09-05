import { z } from "zod";

import { IanaTimezone, IsoDate } from "./brands.js";
import { BrokenEntrySchema } from "./health.js";

/**
 * A single non-working day. `date` is a YYYY-MM-DD string;
 * `label` is human-readable for tooltips.
 */
export const HolidayDefSchema = z.object({
  date: IsoDate,
  label: z.string().min(1),
}).strict();
export type HolidayDef = z.infer<typeof HolidayDefSchema>;

/**
 * Weekday index, 0..6 with 0 = Sunday.
 */
const Weekday = z.number().int().min(0).max(6);

/**
 * Workspace-level calendar. Used by the timeline/Gantt view for
 * shading. No business-day math — purely cosmetic.
 *
 *  - `timezone` is the workspace IANA timezone for shared rendering
 *    (today-marker, weekend shading). Per-user timezones live on
 *    user profiles.
 *  - `working_days` are 0..6 with 0 = Sunday.
 *  - `first_day_of_week` is 0..6, also 0 = Sunday.
 */
export const CalendarConfigSchema = z.object({
  timezone: IanaTimezone,
  first_day_of_week: Weekday,
  working_days: z.array(Weekday),
  holidays: z.array(HolidayDefSchema),
  /**
   * Per-entry corruption in the holidays list, if any. One holiday whose
   * fields no longer validate (a hand-edited `date` in the wrong format,
   * a missing `label`) becomes a `BrokenEntry` rather than blanking the
   * whole calendar (north-star principle 5) — exactly like
   * `QueriesConfig.broken` / `MilestonesConfig.broken`. Omitted (not `[]`)
   * when every holiday parsed, so a consumer reading only `holidays` is
   * unaffected and "none broken" stays distinct from "not inspected". A
   * load-time diagnostic — never written back to disk.
   *
   * Only the `holidays` list degrades this way. The scalar fields
   * (`timezone`, `first_day_of_week`, `working_days`) stay object-fatal:
   * they are single values other rendering references, not a collection
   * to degrade around. An unresolvable `timezone` in particular keeps its
   * existing fatal behaviour (SET-24 handles the render-time fallback on
   * the surface, not by salvaging a partial calendar here).
   */
  broken: z.array(BrokenEntrySchema).optional(),
}).strict().superRefine((cfg, ctx) => {
  // An empty working week is not a configuration, it is a tracker where
  // no date calculation can land anywhere. Rejecting it here beats
  // every consumer having to decide what "no working days" means.
  if (cfg.working_days.length === 0) {
    ctx.addIssue({
      code: "custom",
      message: "working_days must name at least one day",
      path: ["working_days"],
    });
  }
  const seen = new Set<number>();
  for (const [i, d] of cfg.working_days.entries()) {
    if (seen.has(d)) {
      ctx.addIssue({
        code: "custom",
        message: `duplicate working day ${d}`,
        path: ["working_days", i],
      });
    }
    seen.add(d);
  }
});
export type CalendarConfig = z.infer<typeof CalendarConfigSchema>;
