/**
 * A single non-working day. `date` is a YYYY-MM-DD string;
 * `label` is human-readable for tooltips.
 */
export interface HolidayDef {
  readonly date: string;
  readonly label: string;
}

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
export interface CalendarConfig {
  readonly timezone: string;
  readonly first_day_of_week: number;
  readonly working_days: readonly number[];
  readonly holidays: readonly HolidayDef[];
}
