import type { RowModel, TimelineRow } from "./rows.ts";

/**
 * Vertical layout for the chart (M3.3a).
 *
 * Separated from the React tree because the arrows need to know where
 * a row sits *before* anything renders: an arrow between two bars is
 * positioned from both endpoints' y-coordinates, and asking the DOM
 * for them after paint means measuring, a second render pass, and
 * arrows that lag a frame behind the bars they connect.
 *
 * Collapsing a band changes only which rows are laid out, never their
 * order — TML-6's "the collapsed state does not change the URL's task
 * scope" is about scope, and this keeps the same guarantee about
 * position: expanding a band puts every row back where it was.
 */

/** Height of one task row, in pixels. */
export const ROW_H = 28;

/** Height of a band's header strip. */
export const BAND_HEADER_H = 26;

/** A row placed at an absolute y within the chart body. */
export interface PlacedRow {
  readonly row: TimelineRow;
  readonly y: number;
}

/** A band placed at an absolute y, with its rows. */
export interface PlacedBand {
  readonly id: string;
  readonly label: string;
  readonly y: number;
  readonly count: number;
  readonly rows: readonly PlacedRow[];
}

export interface Layout {
  readonly bands: readonly PlacedBand[];
  /** Total body height, so the scroll container sizes correctly. */
  readonly height: number;
  /** Row centre-line y by task id — what the arrows anchor to. */
  readonly centreById: ReadonlyMap<string, number>;
}

/**
 * Places bands and rows top to bottom.
 *
 * `collapsed` names bands whose rows are not laid out. Their header
 * still occupies its strip, so collapsing a band does not make it
 * disappear — TML-6 requires bands to be collapsible, which implies
 * they can be *un*collapsed, which implies the header stays.
 */
export function buildLayout(
  model: RowModel,
  collapsed: ReadonlySet<string> = new Set(),
): Layout {
  const bands: PlacedBand[] = [];
  const centreById = new Map<string, number>();
  let y = 0;

  for (const band of model.bands) {
    const headerY = y;
    y += BAND_HEADER_H;
    const rows: PlacedRow[] = [];
    if (!collapsed.has(band.id)) {
      for (const row of band.rows) {
        rows.push({ row, y });
        centreById.set(row.task.id, y + ROW_H / 2);
        y += ROW_H;
      }
    }
    bands.push({
      id: band.id,
      label: band.label,
      y: headerY,
      // The header's count is the band's true size, not the number
      // currently laid out: TML-6 wants a count that "matches the
      // number of rows inside it", and a collapsed band showing 0
      // would be a lie about the data rather than about the display.
      count: band.rows.length,
      rows,
    });
  }

  return { bands, height: y, centreById };
}
