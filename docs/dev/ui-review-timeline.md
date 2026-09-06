# Timeline (Gantt) — visual / layout review

Focused visual-quality pass. Live app at `http://localhost:7755/timeline`,
seeded demo (16 tasks). Reviewed at 1600×1000 desktop, day and week zoom.
Measurements are computed styles from the running app. Root font-size is
14px (same rem caveat as the board — see the board review's B3).

Files: `apps/web/src/client/timeline/TimelineView.tsx`,
`apps/web/src/client/timeline/TimelineChart.tsx`,
`apps/web/src/client/timeline/geometry.ts`,
`apps/web/src/client/timeline/layout.ts`.

### The overriding fact about this seed
**No task in the demo has *both* a `start_date` and a `due_date`.** Several
have a due date only (e.g. PLAT-4 "due 2026-08-30"), the rest have
neither, and DEMO-2 has a corrupt `due_date`. So the timeline renders its
`noBars` path (`TimelineView.tsx:431,580-588`): a full-width message
"None of these tasks has both a start date and a due date…", an **empty
chart grid**, and all 14 tasks in the Unscheduled lane. **I could not
visually verify real bars, lanes, band headers, or dependency arrows with
this seed** — those are reviewed from the source below and flagged where
the code implies a problem. That the demo seed never exercises the chart
is itself finding **T1**.

---

## Severity summary

| Sev | Count | Findings |
|-----|-------|----------|
| P1 (broken layout) | 1 | T2 empty chart grabs `flex-1` and renders a huge blank framed void |
| P2 (clearly bad) | 4 | T1 seed never renders a bar, T3 no vertical gridlines in the chart body, T4 partial-week header cell too narrow for its label (text wraps/overflows), T5 header strip `h-6` + `leading-6` clips its own text |
| P3 (polish) | 4 | T6 Unscheduled lane rows ragged (huge gap key→reason), T7 row height 28px / bar 22px feels tight with no lane separators, T8 today-marker & shading invisible when body height is 0, T9 bar label `text-[11px] leading-none` vertically mis-centred |

**Worst issue: T2** — with no dated tasks the chart region still takes all
remaining vertical space (`flex-1`) and paints a ~390px empty bordered
rectangle with a lone date header stranded in its top-left corner. This is
the single biggest source of the "jank" Ken saw: the default demo timeline
is a giant empty box.

---

## Findings

### T2 — Empty chart occupies `flex-1`, painting a huge blank void (P1)
`TimelineView.tsx:589-629` renders `<TimelineChart>` (which is
`min-h-0 flex-1 overflow-auto rounded-md border`, `TimelineChart.tsx:165`)
even on the `noBars` path. Measured with this seed: the scroll region is
**388px tall but its content is 386px** — i.e. the body height is **0**
(no bands → `layout.height = 0`, `layout.ts:87`), so the chart is an empty
bordered rectangle. The date header inside it is only **432px wide** (the
range) inside a **1362px** container, so the header sits alone in the
top-left and the entire rest of the box — right and below — is blank.

- **Fix direction:** when `noBars` (or `layout.height === 0`), do **not**
  render the full-height `flex-1` chart. Show the "nothing to chart"
  message and stop, letting the Unscheduled lane rise up — or give the
  chart a content-height (`min-h` sized to the header + a few empty rows)
  instead of `flex-1`. The chart should never be taller than it has
  content for.

### T1 — The demo seed never renders a single bar (P2)
Because no seeded task has both dates, the entire chart-rendering path
(bars, bands, arrows, drag) is invisible in the demo. A reviewer (or Ken)
opening Timeline sees only the empty state. Independent of T2's layout bug,
this makes the view look broken/empty on first visit.

- **Fix direction (data, not code):** give the seed 3–5 tasks with both
  `start_date` and `due_date`, at least one blocks-chain pair with both
  ends dated (so an arrow draws), and one multi-task milestone (so a band
  header with a count draws). Without this the timeline's actual visual
  quality cannot be assessed and the demo undersells the feature.

### T3 — No vertical gridlines in the chart body (P2)
`TimelineChart.tsx:192-380`. The header cells carry `border-r`
(`:184`) but the **body** has none — the only vertical marks in the chart
area are weekend/holiday shading strips (`:197-212`) and the 1px today
marker (`:214-226`). At day zoom the header shows "23 24 25 26…" but there
are no column separators beneath them, so a bar would float in an ungridded
field with nothing to read its start/end against. Verified: body contains
only `timeline-nonworking` strips + the today marker, no gridline
elements.

- This is a primary "janky" cause: a Gantt chart whose bars don't sit on
  visible gridlines reads as misaligned even when the arithmetic
  (`geometry.ts`) is exact.
- **Fix direction:** draw light vertical gridlines per column (day/week
  boundary) in the body, aligned to the same `dateToX` the bars use, at
  `border-subtle` weight. Behind bars, `pointer-events:none`. This
  visually ties every bar edge to its date.

### T4 — Partial-week header cell is too narrow for its label (P2)
`geometry.ts:294-310` (week zoom). The first cell is clamped to the
partial week: `span = Math.min(7 - offset, …)`. Measured, the leading cell
came out **12px wide** (a 1-day partial week) but still carries the label
`08-23` (`MM-DD`, `:307`). At `text-[10px]` centered, that string cannot
fit in 12px, so it **wraps to two lines and overflows** (measured
`scrollHeight 42` vs `clientHeight 20`). This is the "08-/23" broken label
visible at the top-left in the week-zoom screenshot.

- **Fix direction:** for a partial-week cell narrower than its label,
  either drop the label (leave the stub blank), right-align it into the
  next full cell, or don't emit a sub-3-day leading cell at all (fold it
  into the first full week). A label must never exceed its cell width.

### T5 — Header strip `h-6` with `leading-6` clips its own text (P2)
`TimelineChart.tsx:171-173` — header is `h-6` (21px) and cells use
`leading-6` (`:184`, 21px line-height). Measured cell height 20px with
`scrollHeight 21` — the text is 1px taller than its box on **every** cell,
so descenders/round caps clip. Zero vertical breathing room.

- **Fix direction:** give the header a hair more height (`h-7`) or reduce
  the line-height below the container height (`leading-5` in an `h-6`), and
  vertically center. Tie the header height to the S-7 scale rather than a
  literal that happens to equal the line-height.

### T6 — Unscheduled lane rows are ragged (P3)
`TimelineView.tsx:762-808`. Each row is a full-width flex button: key +
title on the left, reason chip `ml-auto` on the right. On a 1362px-wide
lane the reason ("No start or due date") is flung to the far right,
leaving a vast empty gap between the short title and the reason. Rows read
as sparse and disconnected. Row padding is `py-1` (3.5px) — tight
vertically, loose horizontally.

- **Fix direction:** cap the lane content width (or left-align the reason
  after the title with a fixed `gap`), so the key/title/reason form one
  readable cluster instead of stretching across the whole viewport.

### T7 — Row/bar heights are tight, no lane separators (P3)
`layout.ts:19` `ROW_H = 28`, bar drawn at `top: y+3, height: ROW_H-6` = 22px
(`TimelineChart.tsx:322-323`). 3px above/below a 22px bar in a 28px row is
serviceable but cramped, and there are **no horizontal row separators or
alternating lane backgrounds** in the body, so stacked bars would have no
lane to sit in. Combined with T3 (no vertical gridlines) the chart body is
a featureless field.

- **Fix direction:** add faint alternating row bands or a per-row bottom
  border in the body so each task has a visible lane; consider `ROW_H = 32`
  for a bit more air. Fold into S-7.

### T8 — Today-marker and shading vanish when the body is empty (P3)
`TimelineChart.tsx:209,225` — shading and today-marker both take
`height: layout.height`, which is **0** on the `noBars` path. So on the
default demo view there is no today line and no weekend shading at all —
the chart is fully blank. This is a symptom of T2; fixing T2 (giving the
empty chart a real content height, or not rendering it) resolves it.

### T9 — Bar label vertical centering (P3, unverifiable with this seed)
`TimelineChart.tsx:317,328` — the bar label is `text-[11px] leading-none`
in a 22px bar with only `px-1` (no vertical centering). `leading-none` at
the top of a 22px flex-less span will sit high, not centered. Flagged from
source; could not confirm live (no bars). Add `flex items-center` or a
matching line-height.

---

## What was checked and is fine

- **Date arithmetic** (`geometry.ts`) is careful and correct: UTC-midnight
  parsing, inclusive spans (`+1` day), exact day math, `xToDate`/`dateToX`
  inverse pair. Bar *placement* is not the problem; bar *framing* (T3/T7)
  is.
- **Corrupt-date handling** — DEMO-2's corrupt `due_date` renders as a
  distinct danger-styled `⚠ due_date is corrupt: 42` chip in the
  Unscheduled lane (`TimelineView.tsx:791-804`), visually distinct from a
  plain undated row. Verified live; well done.
- **Undated vs. partially-dated rows** land correctly in Unscheduled with
  an explanatory reason chip ("No start or due date" / "No start date —
  due 2026-08-30"). Correct and readable (modulo T6's spacing).
- **Empty / loading / filtered states** — the three distinct states
  (`loading` skeleton, `noRows` empty, `noBars` message) are all present
  and correctly chosen (`TimelineView.tsx:556-588`).
- **Zoom controls, grouping select, dependencies toggle, Today button**
  (`TimelineView.tsx:677-734`) are laid out cleanly with `gap-4`; the
  disabled-when-unavailable arrows toggle is correct (TML-15).
- **Sticky header** (`TimelineChart.tsx:171`) is correctly `sticky top-0`.
- **Anomaly / offscreen-dependency markers** and the arrow SVG
  (`TimelineChart.tsx:264-284,382-441`) are structurally sound in source —
  arrows drawn last, `pointer-events:none`, arrowhead marker defined — but
  **unverified live** because no seed pair is fully dated.
