# Board (Kanban) — visual / layout review

Focused visual-quality pass. Live app at `http://localhost:7755/board`,
seeded demo (16 tasks, 4 columns: Backlog 8 / In progress 5 / Done 1 /
Won't do 0). Reviewed at 1600×1000 desktop width. Measurements below are
computed styles from the running app; the **root font-size is 14px**, so
every Tailwind spacing step is `step × 0.875` (`p-2` = 7px, `gap-2` = 7px,
`space-y-1.5` = 5px, `gap-3` = 10.5px, etc.). Read that as the reason the
numbers look "off" — the whole grid is on a 14px rem, so nothing lands on
a clean 4/8 pixel rhythm.

Files: `apps/web/src/client/board/BoardView.tsx`,
`apps/web/src/client/board/BoardCard.tsx`,
`apps/web/src/client/board/cardLayout.ts`.

There is **no spacing-scale token** in the design system yet
(`apps/web/src/client/styles/tokens.css` defines colors, radii, and
shadows only — no `--space-*`). S-7's "consistent padding/gap scale" is
referenced by the tickets but has never been materialized, so every gap
on the board is a one-off Tailwind literal. That is the root cause behind
most of what follows: there is nothing to be consistent *with*.

---

## Severity summary

| Sev | Count | Findings |
|-----|-------|----------|
| P1 (broken layout) | 0 | — |
| P2 (clearly bad) | 5 | B1 redundant chip-bar vs header counts, B2 project-chip duplicates the key prefix, B3 14px rem breaks the spacing rhythm, B4 no gap between title and meta block reads as two stacked halves, B5 card meta is a flat ragged stack (no key/value structure) |
| P3 (polish) | 4 | B6 column min/max width fixed at 280px, B7 chip-bar gap 5.25px too tight, B8 empty-column placeholder oversized, B9 count-badge padding inconsistent with chip padding |

**Worst issue: B1 + B2 together** — the board shows the same count in two
stacked rows (chip bar then column header) and shows the project prefix
twice on every card (`DEMO` chip + `DEMO-1` key). The board reads as
"ugly" largely because of this doubled, redundant information, not because
any single element is malformed.

---

## Findings

### B1 — Chip bar duplicates the column-header counts (P2)
`BoardView.tsx:361-386` (ChipsBar) sits directly above the columns, and
`BoardView.tsx:721-736` renders the identical count in each column header.
Measured: chip bar at y=62 reads "Backlog 8 · In progress 5 · Done 1 ·
Won't do 0"; the column header 30px below reads "Backlog … 8" again. The
user sees every count twice, one row apart.

- The chip bar's real job is *toggling column visibility* (BRD-3), not
  reporting counts. The count on the chip is redundant with the header
  and adds a whole 26px-tall band of repeated numbers above the board.
- **Fix direction:** keep the chip as a visibility toggle but drop the
  count from it (or, if the count must stay, remove it from the column
  header — one or the other, not both). The screenshot reads far calmer
  with a single count source.

### B2 — Project chip repeats the key's own prefix on every card (P2)
`BoardCard.tsx:205-216`. On the "All projects" board every card renders a
`ProjectChip` ("DE"/"DEMO") immediately followed by the key `DEMO-1`. The
key *already* carries the project prefix, so the card shows "DEMO" then
"DEMO-1" — the same token twice, side by side. Visible in every card in
the board screenshot.

- BRD-23 wants a project indicator so `WEB-3` and `BACKEND-3` are
  distinguishable — but the prefix is *in the key*, so the separate chip
  is pure duplication when keys are prefixed.
- **Fix direction:** show the project chip only when the key prefix does
  **not** already encode the project, or drop the chip and rely on the
  key prefix (color the prefix if disambiguation matters). Either removes
  the doubled token.

### B3 — 14px root breaks the spacing rhythm (P2, systemic)
Root `font-size: 14px`, so card padding `p-2` = **7px**, card gap
`space-y-2` = **7px**, meta rows `space-y-1.5` = **5px**, column gutter
`gap-3` = **10.5px**, header padding `py-2 px-3` = **7px / 10.5px**.
Nothing lands on an integer 4/8 grid; the 10.5px and 5.25px half-pixels
get sub-pixel-rounded differently per element, which is why edges look
subtly ragged even though the classes are "consistent".

- **Fix direction:** introduce the S-7 spacing scale as CSS custom
  properties on `:root` (`--space-1: 4px … --space-4: 16px`) driven off an
  integer base, and map the board's paddings/gaps to it. The cheap
  interim fix is to stop the board inheriting 14px (set the board's own
  `text-[13px]` locally rather than shrinking the rem) so `p-2` = 8px
  again. This one change re-aligns every measurement below.

### B4 — Title and meta block have zero separation (P2)
`BoardCard.tsx:113-171`. The title lives in a `<button>` with `p-2`
(7px all round); the meta block is a *sibling* `<div class="space-y-1.5
px-2 pb-2">` with **`pt` = 0**. Measured gap between the title text
baseline area and the first meta row is only the button's own 7px bottom
padding — there is no deliberate title→meta separation, so the two halves
touch. On a card with a 3-line clamped title the title crowds straight
into the priority dot.

- **Fix direction:** make the card one padded container with an explicit
  title→meta gap (e.g. wrap both in `p-3` with `space-y-2`), instead of a
  padded button abutting an unpadded meta div. Right now the card is
  visually two stacked boxes, not one card.

### B5 — Card meta is a flat, structureless stack (P2)
`BoardCard.tsx:152-171` renders each layout field as its own full-width
`<div class="text-[12px]">` inside `space-y-1.5`. So priority, assignee,
labels, and due date each get their own line, left-aligned, with no
key/value columns and no grouping. The result (visible in the screenshot)
is a ragged vertical list: "● High", "AL Ada", "frontend", "Sep 12" — four
unrelated rows stacked with 5px gaps. It reads as loose and
undifferentiated, the "spacings are really bad" Ken described.

- **Fix direction:** group the meta into a deliberate two-tier layout: a
  top meta row (priority + assignee + due date inline via `flex gap-2`,
  right-aligning the date), and labels on their own row beneath. That
  gives the card a scannable rhythm instead of a flat stack. Ties to the
  Chip primitive (K-15): priority/type/status should be uniform-height
  chips so the inline row aligns.

### B6 — Column width is a hard 280px with no min/max (P3)
`BoardView.tsx:671` — `w-[280px] shrink-0`. Fixed, so on a 1600px screen
four columns use 1140px and leave ~450px of dead space soaked up by the
`flex-1` spacer (`BoardView.tsx:448`). Not broken, but the board looks
under-filled on wide screens and cramped on narrow ones.

- **Fix direction:** `min-w-[260px] max-w-[320px]` with a flex-basis, or a
  small responsive step, so columns breathe on wide screens without
  becoming full-width slabs (BRD-16's concern). Low priority.

### B7 — Chip-bar gap is 5.25px, tighter than everything else (P3)
`BoardView.tsx:550` — `gap-1.5` = 5.25px between visibility chips, while
the board gutter is 10.5px and card gaps 7px. The chips crowd together
relative to the rest of the board. Fold into the S-7 scale.

### B8 — Empty-column placeholder is oversized (P3)
`BoardView.tsx:769-774` — the "No tasks in Won't do" placeholder uses
`px-3 py-6` (21px vertical padding) inside a full-height column, so it
sits as a tall dashed box near the top of an otherwise empty column. It's
fine but heavier than needed; `py-4` reads better. Verified against the
empty "Won't do" column.

### B9 — Count badge padding inconsistent with the chip (P3)
`BoardView.tsx:721-736` — header count uses `px-1.5 py-0.5` (5.25px /
1.75px); the visibility chip uses `px-2.5 py-1`. Two count-like pills, two
paddings. Unify via the Chip primitive (K-15).

---

## What was checked and is fine

- **Column structure & scroll** — fixed-width columns, horizontal board
  scroll, per-column vertical scroll (`BoardView.tsx:423,758`) all behave
  correctly; columns stay uniform. This is solid.
- **WIP / over-cap treatment** — the count badge's at-cap (`warn`) /
  over-cap (`danger`) coloring plus the `⚠` glyph sibling
  (`BoardView.tsx:711-736`) is well done and accessible (A11Y-30).
- **Empty-board state** (`total === 0`) and skeleton cards
  (`BoardView.tsx:844-852`) are appropriate; no per-column error noise.
- **Column drift / orphan / uncovered banners** render as designed, not
  as white panes.
- **Card border/radius/surface tokens** (`rounded border
  border-border-subtle bg-bg-canvas`) are consistent and theme-aware.
- **Label overflow** (`+N`) and title 3-line clamp are correct — long
  titles do not blow out the card.

*Note: this seed has no many-label card and no visible epic/subtask
indentation on the board (the board is flat by status; parent/child is not
expressed visually here — that is by design, not a defect).*
