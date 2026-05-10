import { z } from "zod";

import { IanaTimezone, IsoDate } from "./brands.js";

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
}).strict();
export type CalendarConfig = z.infer<typeof CalendarConfigSchema>;
