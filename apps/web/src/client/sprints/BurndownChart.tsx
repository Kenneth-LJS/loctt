import type { WorkflowConfig } from "@loctt/contracts";

import { ErrorState } from "../ui/ErrorState.tsx";
import type { BurndownSeriesDto } from "./burndownModel.ts";
import { buildGeometry, countByEstimate, elapsedCount, resolveAxis } from "./burndownModel.ts";

/**
 * The sprint burndown (M4.7 · SPR-9 … SPR-12, SPR-16, SPR-18,
 * SPR-21 … SPR-23, SPR-29, SPR-30, SPR-34, SPR-35).
 *
 * Hand-drawn SVG rather than a charting library: the repo has no chart
 * dependency, and what these cases actually require — two polylines, a
 * thinned tick row, a shaded future region — is less code than
 * configuring one away from its defaults would be.
 *
 * The chart never computes a remaining value. Every number is the
 * server's, which is core's; this decides only where they land.
 */

const VIEW_W = 720;
const VIEW_H = 220;
const PAD_L = 48;
const PAD_B = 28;
const PAD_T = 8;
const PAD_R = 12;

interface Props {
  readonly series: BurndownSeriesDto | undefined;
  readonly workflow: WorkflowConfig | undefined;
  /** The tracker's today, for the elapsed/future split (SPR-21). */
  readonly today: string;
  /** The sprint's tasks, for enum-mode category counts (SPR-11). */
  readonly tasks: readonly { readonly estimate?: string | number | undefined }[];
  readonly sprintName: string;
  readonly error: Error | null;
  readonly loading: boolean;
  readonly onRetry: () => void;
}

export function BurndownChart(props: Props) {
  const { series, workflow, today, tasks, sprintName, error, loading, onRetry } = props;

  // SPR-34: a failure shows an error naming the sprint. Empty axes are
  // never drawn for a failure — "no work" and "we could not compute
  // it" are different facts, and the blank chart asserts the first.
  if (error !== null) {
    return (
      <section data-testid="burndown" aria-label="Burndown">
        <div data-testid="burndown-error">
          <ErrorState
            error={error}
            onRetry={onRetry}
            context={`The burndown for “${sprintName}” could not be computed.`}
          />
        </div>
      </section>
    );
  }

  if (loading || series === undefined) {
    return (
      <section data-testid="burndown" aria-label="Burndown" aria-busy="true">
        <p data-testid="burndown-loading" className="px-3 py-8 text-center text-[0.9286rem] text-text-tertiary">
          Loading the burndown…
        </p>
      </section>
    );
  }

  const axis = resolveAxis(series, workflow);
  const geo = buildGeometry(series, VIEW_W - PAD_L - PAD_R, VIEW_H - PAD_T - PAD_B);
  const elapsed = elapsedCount(series.series, today);
  const est = workflow?.estimation;

  // SPR-16: an empty sprint gets a stated "nothing to burn down",
  // rather than empty axes.
  //
  // The series alone cannot decide this. A sprint whose every task was
  // *completed* reports `incompleteTaskCount: 0` on every day and an
  // `initialTotal` of 0 — byte-identical on the wire to a sprint that
  // never held anything. Suppressing the chart on that shape hid the
  // burn-down-to-zero SPR-30 requires to be visible.
  //
  // The sprint's current task list is the discriminator the wire
  // lacks: "no tasks are assigned to this sprint" is the empty case,
  // and any assigned task means there is a real, finished sprint to
  // draw.
  const nothingToBurn =
    tasks.length === 0 && series.series.every(p => p.incompleteTaskCount === 0);

  const plot = (pts: readonly { x: number; y: number }[]): string =>
    pts.map(p => `${(p.x + PAD_L).toFixed(2)},${(p.y + PAD_T).toFixed(2)}`).join(" ");

  return (
    <section data-testid="burndown" aria-label="Burndown" className="rounded-md border border-border-subtle bg-bg-surface p-3">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="text-[0.9286rem] font-semibold text-text-primary">Burndown</h2>
        {/* SPR-9 / SPR-12 / SPR-29: the unit the config asked for.
            Never a hardcoded "Story points", never `weighted_enum`. */}
        <span data-testid="burndown-axis-label" className="text-[0.8571rem] text-text-secondary">
          {axis.label}
        </span>
      </div>

      {/* SPR-11: estimation is on and categorical, but with no weights
          the values cannot be summed — so the axis silently became a
          task count. Saying so, with the fix, is the difference
          between an honest fallback and a misleading one. */}
      {axis.reason === "enum-without-weights" && (
        <p
          data-testid="burndown-enum-fallback"
          className="mb-2 rounded border border-border-subtle bg-bg-muted px-2 py-1.5 text-[0.8571rem] text-text-secondary"
        >
          Estimation is set to <code>custom_enum</code>, which
          can't be added up. This chart is counting <strong>tasks</strong>,
          not effort. To burn down effort, add a{" "}
          <code>weights</code> map under{" "}
          <code>estimation</code> in{" "}
          <code>workflow.yaml</code>.
        </p>
      )}

      {nothingToBurn ? (
        // SPR-16: explicit, rather than a chart with no line in it.
        <p
          data-testid="burndown-empty"
          className="px-3 py-8 text-center text-[0.9286rem] text-text-tertiary"
        >
          Nothing to burn down. No tasks were in this sprint during its window.
        </p>
      ) : (
        <svg
          data-testid="burndown-chart"
          viewBox={`0 0 ${String(VIEW_W)} ${String(VIEW_H)}`}
          className="h-[220px] w-full"
          role="img"
          aria-label={`Burndown for ${sprintName}, ${axis.label}`}
        >
          {/* SPR-21: days that have not happened yet, shaded, so a flat
              line across them is not read as "no progress". */}
          {elapsed < series.series.length && (
            <rect
              data-testid="burndown-future-region"
              x={PAD_L + (geo.actual[elapsed]?.x ?? 0)}
              y={PAD_T}
              width={Math.max(0, VIEW_W - PAD_R - (PAD_L + (geo.actual[elapsed]?.x ?? 0)))}
              height={VIEW_H - PAD_T - PAD_B}
              className="fill-bg-muted"
              opacity={0.6}
            />
          )}

          {/* Axes */}
          <line
            x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={VIEW_H - PAD_B}
            className="stroke-border-default" strokeWidth={1}
          />
          <line
            x1={PAD_L} y1={VIEW_H - PAD_B} x2={VIEW_W - PAD_R} y2={VIEW_H - PAD_B}
            className="stroke-border-default" strokeWidth={1}
          />

          {/* Y bounds. `yMax` is the floored one, so a zero series
              still labels a readable axis rather than 0..0. */}
          <text x={PAD_L - 6} y={PAD_T + 4} textAnchor="end" className="fill-text-tertiary text-[0.7143rem]">
            {formatNum(geo.yMax)}
          </text>
          <text x={PAD_L - 6} y={VIEW_H - PAD_B} textAnchor="end" className="fill-text-tertiary text-[0.7143rem]">
            0
          </text>

          {/* SPR-9: the ideal line, visually distinct — dashed and a
              different stroke, so it is not colour alone. */}
          <polyline
            data-testid="burndown-ideal"
            points={plot(geo.ideal)}
            fill="none"
            strokeDasharray="5 4"
            className="stroke-text-tertiary"
            strokeWidth={1.5}
          />

          {/* SPR-23 / SPR-30: steps up and down are the data's, drawn
              as-is. Nothing here smooths or back-fills. */}
          <polyline
            data-testid="burndown-actual"
            points={plot(geo.actual)}
            fill="none"
            className="stroke-accent"
            strokeWidth={2}
          />

          {/* SPR-22: one sample is a point, not a line — a polyline of
              a single vertex draws nothing at all. */}
          {geo.actual.map(p => (
            <circle
              key={p.date}
              data-testid={`burndown-point-${p.date}`}
              data-remaining={String(p.remaining)}
              cx={p.x + PAD_L}
              cy={p.y + PAD_T}
              r={geo.actual.length === 1 ? 4 : 2}
              className="fill-accent"
            />
          ))}

          {/* SPR-18: thinned labels over an undiminished series. */}
          {geo.labelledTicks.map(i => {
            const p = geo.actual[i];
            if (p === undefined) return null;
            return (
              <text
                key={p.date}
                data-testid={`burndown-tick-${p.date}`}
                x={p.x + PAD_L}
                y={VIEW_H - PAD_B + 12}
                textAnchor="middle"
                className="fill-text-tertiary text-[0.6429rem]"
              >
                {p.date.slice(5)}
              </text>
            );
          })}
        </svg>
      )}

      <p data-testid="burndown-summary" className="mt-1 text-[0.7857rem] text-text-tertiary">
        {series.start} → {series.end} · {String(series.series.length)} day
        {series.series.length === 1 ? "" : "s"} · starting at{" "}
        <span data-testid="burndown-initial-total">{formatNum(series.initialTotal)}</span>
      </p>

      {/* SPR-11: for categorical estimation the distribution is the
          meaningful aggregate, so it is available on the page. */}
      {est?.enabled === true && est.unit === "custom_enum" && est.preset_values !== undefined && (
        <ul data-testid="burndown-enum-counts" className="mt-2 flex flex-wrap gap-2">
          {countByEstimate(tasks, est.preset_values).map(row => (
            <li
              key={row.value}
              data-testid={`burndown-enum-count-${row.value}`}
              className="rounded bg-bg-muted px-1.5 py-0.5 text-[0.7857rem] text-text-secondary"
            >
              {row.value}: <span className="tabular-nums">{String(row.count)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Trims the float dust an interpolated ideal value carries. */
function formatNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
