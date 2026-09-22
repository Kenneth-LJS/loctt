import { useEffect, useMemo, useRef, useState } from "react";

import { Icon } from "../ui/Icon.tsx";
import { Sheet } from "../ui/Sheet.tsx";
import { ROW_H } from "./layout.ts";
import type { DateProblem, TimelineRow } from "./rows.ts";
import { dateProblemNote } from "./rows.ts";

/**
 * TML-5 / timeline redesign: the Unscheduled surface as a collapsible
 * footer drawer that is **collapsed by default**.
 *
 * The old always-expanded lane rendered an unbounded `<ul>` *below* the
 * chart's flex container, so a tracker with many undated tasks (measured
 * at 22) pushed the chart — `min-h-0 flex-1` — down to a strip while the
 * lane ate the panel. Ken approved: the chart is the hero; the
 * unscheduled tasks live in a drawer the user opens on demand.
 *
 * Behaviour:
 *  - An always-visible header strip (hidden only when there are zero
 *    unscheduled tasks) shows the count plus a breakdown by
 *    `DateProblem.kind` — e.g. "22 unscheduled · 19 undated · 2 due-only
 *    · 1 corrupt", with the corrupt/invalid count in the danger colour.
 *  - Collapsed by default. Collapse state is LOCAL (`useState`), like the
 *    band-collapse in `TimelineChart` — it is a display affordance, not a
 *    filter, so it stays out of the URL.
 *  - Expanded on desktop: an own `overflow-y-auto` region capped at ~40%
 *    of the panel, so it can never squeeze the chart again.
 *  - Expanded on a phone (<640, `useIsNarrow`): a `Sheet`, so the rows do
 *    not fight the chart for the short viewport.
 *
 * Testids preserved from the old lane so the existing suite keeps
 * pointing at the same things: `timeline-unscheduled`,
 * `timeline-unscheduled-count`, `timeline-unscheduled-row-<key>`,
 * `timeline-unscheduled-reason-<key>`.
 */

/** A count of unscheduled rows by the reason they are unscheduled. */
interface Breakdown {
  readonly undated: number;
  readonly openStart: number;
  readonly openDue: number;
  /** `invalid` + `corrupt` — the "this is broken, not merely undated" bucket. */
  readonly broken: number;
  readonly reversed: number;
}

function classify(problem: DateProblem | undefined): keyof Breakdown | undefined {
  if (problem === undefined) return undefined;
  switch (problem.kind) {
    case "undated":
      return "undated";
    case "open_start":
      return "openStart";
    case "open_due":
      return "openDue";
    case "invalid":
    case "corrupt":
      return "broken";
    case "reversed":
      return "reversed";
  }
}

function breakdownOf(rows: readonly TimelineRow[]): Breakdown {
  const b: Breakdown = { undated: 0, openStart: 0, openDue: 0, broken: 0, reversed: 0 };
  const out = { ...b };
  for (const r of rows) {
    const bucket = classify(r.problem);
    if (bucket !== undefined) out[bucket] += 1;
  }
  return out;
}

/** The header breakdown pieces, in a stable reading order. */
function breakdownParts(b: Breakdown): readonly { readonly label: string; readonly danger: boolean }[] {
  const parts: { label: string; danger: boolean }[] = [];
  if (b.undated > 0) parts.push({ label: `${b.undated} undated`, danger: false });
  if (b.openStart > 0) parts.push({ label: `${b.openStart} start-only`, danger: false });
  if (b.openDue > 0) parts.push({ label: `${b.openDue} due-only`, danger: false });
  if (b.reversed > 0) parts.push({ label: `${b.reversed} reversed`, danger: true });
  if (b.broken > 0) parts.push({ label: `${b.broken} corrupt`, danger: true });
  return parts;
}

/** One unscheduled row — the old lane markup, verbatim, reused in both surfaces. */
function UnscheduledRow(props: {
  readonly row: TimelineRow;
  readonly onOpenTask: (key: string) => void;
}) {
  const r = props.row;
  return (
    <li>
      <button
        type="button"
        data-testid={`timeline-unscheduled-row-${r.task.key}`}
        onClick={() => { props.onOpenTask(r.task.key); }}
        // Below sm the reason chip ("No start date — due …") would crush
        // the title to a few px on one fixed-height line (UX eval #9).
        // Allow the row to wrap the chip onto a second line on a phone,
        // and use min-height (not a fixed height) so the wrapped row is
        // not clipped. At >= sm it is the original single fixed-height row.
        className="flex w-full flex-wrap items-center gap-x-2 gap-y-0.5 px-3 py-1 text-left text-[0.8571rem] hover:bg-bg-canvas sm:flex-nowrap"
        style={{ minHeight: ROW_H }}
      >
        <span className="text-text-secondary">{r.task.key}</span>
        {/* K26: a corrupt title is absent from frontmatter, so fall back
            to the key rather than rendering an empty span. */}
        <span className="min-w-0 flex-1 truncate">{r.task.title ?? r.task.key}</span>
        {r.problem !== undefined && (
          <span
            data-testid={`timeline-unscheduled-reason-${r.task.key}`}
            data-corrupt={r.problem.kind === "corrupt" ? "true" : undefined}
            className={
              r.problem.kind === "corrupt"
                ? "ml-auto flex shrink-0 items-center gap-1 rounded border border-danger-fg/50 bg-danger-fg/10 px-1 text-[0.7857rem] text-danger-fg"
                : "ml-auto shrink-0 rounded border border-border-subtle px-1 text-[0.7857rem] text-text-secondary"
            }
          >
            {r.problem.kind === "corrupt" && <span aria-hidden="true">⚠</span>}
            {dateProblemNote(r.problem)}
          </span>
        )}
      </button>
    </li>
  );
}

export interface UnscheduledDrawerProps {
  readonly rows: readonly TimelineRow[];
  readonly onOpenTask: (key: string) => void;
  /** True below the `sm` breakpoint — the expanded surface is a Sheet. */
  readonly isNarrow: boolean;
  /**
   * TML-41: when the chart has no dated tasks the drawer auto-expands
   * once so the tasks are visible without a click. Controlled here as an
   * initial value only — the user may still collapse it afterwards.
   */
  readonly initiallyExpanded?: boolean;
}

export function UnscheduledDrawer(props: UnscheduledDrawerProps) {
  const [expanded, setExpanded] = useState<boolean>(props.initiallyExpanded ?? false);

  /**
   * TML-41: auto-expand once when `initiallyExpanded` becomes true.
   *
   * The `useState` seed alone misses the common case: the drawer mounts
   * while the feed is still paging in (so `noBars` is not yet decided),
   * then `noBars` flips true a render later. A one-shot effect catches
   * that transition. Guarded by a ref so it fires only the first time —
   * the user is free to collapse it afterwards and stays collapsed.
   */
  const autoExpanded = useRef(props.initiallyExpanded ?? false);
  useEffect(() => {
    if (props.initiallyExpanded === true && !autoExpanded.current) {
      autoExpanded.current = true;
      setExpanded(true);
    }
  }, [props.initiallyExpanded]);

  const breakdown = useMemo(() => breakdownOf(props.rows), [props.rows]);
  const parts = useMemo(() => breakdownParts(breakdown), [breakdown]);

  // Hidden entirely when there is nothing unscheduled — the header strip
  // is only meaningful when it has a count to show.
  if (props.rows.length === 0) return null;

  const count = props.rows.length;
  const header = (
    <button
      type="button"
      data-testid="timeline-unscheduled-toggle"
      aria-expanded={expanded}
      onClick={() => { setExpanded(v => !v); }}
      className="flex w-full items-center gap-2 border-b border-border-default px-3 py-1.5 text-left text-[0.8571rem] font-semibold hover:bg-bg-canvas"
    >
      <Icon name={expanded ? "chevronDown" : "chevronRight"} size={12} />
      <span>Unscheduled</span>
      <span className="font-normal text-text-secondary" data-testid="timeline-unscheduled-count">
        ({count})
      </span>
      {parts.length > 0 && (
        <span className="ml-1 flex flex-wrap items-center gap-x-1.5 text-[0.7857rem] font-normal text-text-secondary">
          {parts.map((p, i) => (
            <span key={p.label} className="flex items-center gap-1.5">
              {i > 0 && <span aria-hidden="true">·</span>}
              <span className={p.danger ? "text-danger-fg" : undefined}>{p.label}</span>
            </span>
          ))}
        </span>
      )}
    </button>
  );

  const rowList = (
    <ul>
      {props.rows.map(r => (
        <UnscheduledRow key={r.task.id} row={r} onOpenTask={props.onOpenTask} />
      ))}
    </ul>
  );

  // On a phone the expanded rows go in a Sheet so they never fight the
  // chart for the short viewport; on desktop they drop below the header
  // in an own-scroll region capped at 40% of the panel.
  return (
    <div
      className="shrink-0 rounded-md border border-border-default bg-bg-muted"
      data-testid="timeline-unscheduled"
    >
      {header}
      {expanded && !props.isNarrow && (
        <div className="max-h-[40vh] overflow-y-auto" data-testid="timeline-unscheduled-body">
          {rowList}
        </div>
      )}
      {expanded && props.isNarrow && (
        <Sheet
          title={`Unscheduled (${String(count)})`}
          testId="timeline-unscheduled-sheet"
          onClose={() => { setExpanded(false); }}
        >
          {rowList}
        </Sheet>
      )}
    </div>
  );
}
