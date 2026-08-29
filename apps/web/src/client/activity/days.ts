/**
 * Day bucketing for the activity feed, in the **workspace** timezone.
 *
 * CMT-13's last bullet and CMT-31's last bullet both turn on the same
 * thing: the day an entry belongs to is decided by
 * `calendar.yaml`'s `timezone`, not the browser's. At 23:50 on the 4th
 * in Los Angeles, a workspace on `Asia/Singapore` is already on the
 * 5th, and the heading has to say what the CLI would say.
 *
 * `Intl.DateTimeFormat` with an explicit `timeZone` is the only way to
 * do this without shipping a tz database: it is the tz database, in
 * the runtime. `en-CA` because its short date format *is* `YYYY-MM-DD`,
 * which sorts and compares lexically.
 */

/** The calendar day (`YYYY-MM-DD`) an instant falls on, in `timezone`. */
export function dayKey(iso: string, timezone: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  } catch {
    // A `timezone` the runtime rejects is config drift (P7). Falling
    // back to UTC keeps the feed rendering — the alternative is a
    // thrown RangeError taking down a section over a typo in
    // `calendar.yaml`.
    return d.toISOString().slice(0, 10);
  }
}

/**
 * The heading for a day: "Today", "Yesterday", or a written date.
 *
 * `today` is the workspace's current day key, so the relative labels
 * are relative to the *workspace's* clock — CMT-31's second bullet.
 * Passed in rather than read here so the function is pure and a test
 * can place the boundary where it wants it.
 *
 * **Day-based, never week-based** (CMT-31's first bullet): nothing
 * here consults `first_day_of_week` or `holidays`, because a heading
 * that grouped a holiday into its neighbour would lose the day an
 * entry actually happened on. `first_day_of_week` is a week-grid
 * concern and there is no week grid here; a holiday is a day like any
 * other in a log of what people did.
 */
export function dayHeading(key: string, today: string): string {
  if (key === today) return "Today";
  if (key === previousDay(today)) return "Yesterday";
  const d = new Date(`${key}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return key;
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** The `YYYY-MM-DD` before this one. */
export function previousDay(key: string): string {
  const d = new Date(`${key}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return key;
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** The workspace's current day key. */
export function todayIn(timezone: string, now: number): string {
  return dayKey(new Date(now).toISOString(), timezone);
}

/** The clock time of an entry, in the workspace timezone. */
export function timeIn(iso: string, timezone: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      minute: "2-digit",
    }).format(d);
  } catch {
    return d.toISOString().slice(11, 16);
  }
}
