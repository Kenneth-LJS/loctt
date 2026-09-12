import type { HistoryEntry } from "@loctt/contracts";

import type { UserIndex } from "../comments/users.ts";
import { authorTitle } from "../comments/users.ts";
import { timeIn } from "./days.ts";
import type { DescribeContext, RenderedValue } from "./describe.ts";
import {
  describeEntry,
  DRIFT_SUFFIX,
  KIND_ICONS,
  KIND_LABELS,
  NO_ACTOR,
} from "./describe.ts";

/**
 * One activity row: icon, kind word, actor, what happened, time, and —
 * where the kind has one — the before → after pair.
 *
 * ## The actor is a ULID until this joins it
 *
 * `entry.actor` is a raw user id, the LST-33 shape. It goes through
 * the same `UserIndex` the comments use, so an id that resolves to
 * nobody says "Unknown user" rather than showing 26 characters of
 * ULID — and an entry with **no** `actor` at all says "System"
 * (CMT-28), which is a different claim from "we could not name them"
 * and is rendered as a different string on purpose.
 */
export function ActivityEntry({
  entry,
  ctx,
  users,
  timezone,
}: {
  readonly entry: HistoryEntry;
  readonly ctx: DescribeContext;
  readonly users: UserIndex;
  readonly timezone: string;
}): React.JSX.Element {
  const described = describeEntry(entry, ctx, id => users.name(id));

  return (
    <li
      data-testid="activity-entry"
      data-kind={entry.kind}
      className="flex gap-2.5 py-2"
    >
      <span
        aria-hidden="true"
        data-testid="activity-icon"
        className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-bg-muted text-[0.7857rem]"
      >
        {KIND_ICONS[entry.kind]}
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-[0.9286rem] leading-snug text-text-secondary">
          {/* The kind, in words. CMT-15's second bullet: the icon above
              is never the only thing carrying the meaning. */}
          <span
            data-testid="activity-kind"
            className="mr-1.5 rounded bg-bg-muted px-1 py-0.5 text-[0.7857rem] font-medium uppercase tracking-wide text-text-tertiary"
          >
            {KIND_LABELS[entry.kind]}
          </span>
          <Actor entry={entry} users={users} />
          {" "}
          <span data-testid="activity-summary">{described.summary}</span>
          {" "}
          <ActivityTime timestamp={entry.timestamp} timezone={timezone} />
        </p>

        {described.change !== undefined && (
          <p
            data-testid="activity-change"
            className="mt-0.5 text-[0.9286rem] text-text-primary"
          >
            <span className="text-text-tertiary">{described.change.field}: </span>
            <Value value={described.change.before} testId="activity-before" />
            {" → "}
            <Value value={described.change.after} testId="activity-after" />
          </p>
        )}
      </div>
    </li>
  );
}

/**
 * The byline.
 *
 * Three distinct states, none of which may be confused for another:
 * a named user; a user id that resolved to nobody ("Unknown user",
 * with the id in a `title` for whoever is debugging); and **no actor
 * recorded at all**, which is CMT-28 and says "System".
 */
export function Actor({
  entry,
  users,
}: {
  readonly entry: HistoryEntry;
  readonly users: UserIndex;
}): React.JSX.Element {
  const actor = entry.actor;
  if (actor === undefined) {
    return (
      <span
        data-testid="activity-actor"
        data-actor="system"
        title="No user was recorded for this change — it was made by LocTT itself."
        className="font-medium text-text-tertiary"
      >
        {NO_ACTOR}
      </span>
    );
  }
  const title = authorTitle(users, actor);
  return (
    <span
      data-testid="activity-actor"
      data-actor={users.known(actor) ? "user" : "unknown"}
      {...(title !== undefined ? { title } : {})}
      className={
        users.known(actor)
          ? "font-medium text-text-primary"
          : "font-medium italic text-text-tertiary"
      }
    >
      {users.name(actor)}
    </span>
  );
}

/**
 * The clock time, in the **workspace** timezone, with the full
 * timestamp on hover.
 *
 * The day heading above already says which day; this says when within
 * it. Both are computed in the workspace zone so the two cannot
 * disagree at a boundary (CMT-13's last bullet).
 */
export function ActivityTime({
  timestamp,
  timezone,
}: {
  readonly timestamp: string;
  readonly timezone: string;
}): React.JSX.Element {
  return (
    <time
      data-testid="activity-time"
      dateTime={timestamp}
      title={timestamp}
      className="text-[0.8571rem] text-text-tertiary"
    >
      {timeIn(timestamp, timezone)}
    </time>
  );
}

/**
 * One side of a change.
 *
 * A stored value the config no longer declares keeps its raw key and
 * gains an explicit marker (CMT-26, CMT-27's last bullet) — never a
 * blank, and never dressed as a label. The marker is text, not only a
 * colour, for the same reason the kind is.
 */
function Value({
  value,
  testId,
}: {
  readonly value: RenderedValue;
  readonly testId: string;
}): React.JSX.Element {
  return (
    <span
      data-testid={testId}
      {...(value.drifted ? { "data-drifted": "true" } : {})}
      className={value.drifted ? "text-warn-fg" : undefined}
    >
      {value.text}
      {value.drifted && (
        <span className="ml-1 text-[0.8571rem] italic text-text-tertiary">
          {DRIFT_SUFFIX}
        </span>
      )}
    </span>
  );
}
