# UI review — responsive layout + light/dark theme parity

Live-app review of the LocTT web app (seeded demo, `http://localhost:7755`),
read-only on code. Viewports tested: mobile 380×820, tablet ~768, wide
1280×720. Both themes toggled via the header Light/Dark/System control
(theme is driven by a `.dark` class on `<html>`, **not**
`prefers-color-scheme` — so OS/browser dark emulation does not switch it;
the in-app toggle is the only way).

Contrast ratios below were computed live from the rendered CSS custom
properties (WCAG relative-luminance formula), captured in each theme.

Scope note: does **not** re-file **A95** (hardcoded `text-[Npx]` sizes /
`body{font-size:14px}` defeating text-zoom) — that stands. Findings here
build on it.

## Summary by severity

- **P1 (broken):** 0
- **P2 (clearly wrong):** 3
- **P3 (polish):** 6

Worst break: **Settings at narrow width** — the `w-56` section-nav and the
content panel sit side-by-side with no responsive stacking, so on a 380px
screen the content panel is squeezed to ~100px and its text clips; the
panel is only reachable by horizontal-scrolling inside `<main>`
(`SettingsShell.tsx:43`).

No finding causes the **page body** to scroll horizontally — every wide
surface (list table, board, settings) keeps its overflow inside its own
container. That invariant holds.

---

## Responsive findings

### R1 — Settings: nav + panel never stack; content panel clips at mobile — **P2**
- **View / viewport:** Settings (any section), 380px. Also cramped at ~600px.
- **What breaks:** `SettingsShell` renders `<SectionNav>` (`w-56 shrink-0`,
  224px) and the content pane (`flex-1`) side-by-side in a `flex h-full`
  row with no breakpoint. Inside the ~331px content area left after the
  sidebar rail, the 224px nav leaves the panel ~100px wide. The "General"
  panel text runs off the right edge (`.loctt/config/…` clipped) and the
  pane gains an internal horizontal scrollbar. Confirmed: `<main>`
  `overflow-x:auto`, `scrollWidth > clientWidth`; document body does **not**
  overflow.
- **Screenshot ref:** settings-mobile-380 (nav fills the width, panel
  pushed off-screen right).
- **Fix direction:** below a breakpoint, stack the two — either nav as a
  full-width top strip / horizontally-scrolling tab row, or a collapsible
  drawer. Replace the flat `flex` row at `SettingsShell.tsx:164` with a
  responsive layout (`flex-col` under `md`, `flex-row` at/above).
- **Trace:** `apps/web/src/client/settings/SettingsShell.tsx:43` (nav
  `w-56 shrink-0`), `:164` (side-by-side flex), `:166` (pane).

### R2 — Sidebar becomes a label-less icon rail on mobile and cannot be hidden — **P2/P3**
- **View / viewport:** all views, < 900px (auto-collapse breakpoint
  `NARROW_PX` in `useSidebarCollapse.ts`).
- **What breaks:** below 900px the sidebar force-collapses to a 56px
  (`w-14`) icon-only rail and the header toggle is disabled (`canToggle`
  = `!narrow`, `useSidebarCollapse.ts:80`), so on a 380px phone the rail
  permanently consumes ~15% of width showing icons with no labels and no
  way to reclaim the space or read what each icon is. Saved-filter and
  project rows collapse to bare dots (the hardcoded ColorDots, see T4),
  which are unidentifiable without labels.
- **Screenshot ref:** list-mobile-380, board-mobile-380 (left icon rail).
- **Fix direction:** on true-mobile widths, make the sidebar an
  off-canvas drawer that the header toggle opens/closes (toggle should be
  *enabled* on mobile, opening an overlay), rather than a permanent
  label-less rail. At minimum, re-enable `canToggle` on mobile so the rail
  can be dismissed.
- **Trace:** `apps/web/src/client/shell/useSidebarCollapse.ts:22`
  (`NARROW_PX = 900`), `:40`, `:80`; `apps/web/src/client/shell/Sidebar.tsx:49`
  (`w-14 px-2` collapsed); `apps/web/src/client/shell/Header.tsx:93`
  ("The sidebar stays collapsed at this width").
- Severity note: P2 for the "cannot dismiss" + unlabeled-icons usability
  loss on phones; the collapse itself is intentional (P3).

### R3 — `DeleteViewDialog` fixed at `w-[26rem]` (416px) overflows a 380px screen — **P2**
- **View / viewport:** the delete-saved-view confirm dialog, ≤ 416px.
- **What breaks:** the dialog card is a hard `w-[26rem]` (416px) with no
  `max-w`, so on a 380px viewport it is wider than the screen. (Could not
  reach the live trigger — saved-view editing is gated to a later
  milestone per `Sidebar.tsx:22` "Saved-view editor arrives in a later
  milestone" — so this is a source-confirmed finding, not screenshot-
  confirmed. The overlay container centers it, so it would clip both
  edges rather than scroll the body.)
- **Fix direction:** `w-[min(26rem,calc(100vw-2rem))]` (the pattern
  `Toast.tsx:100` already uses for exactly this).
- **Trace:** `apps/web/src/client/settings/DeleteViewDialog.tsx:49`
  (`w-[26rem]`). Compare the correct pattern at
  `apps/web/src/client/ui/Toast.tsx:100`
  (`w-[min(360px,calc(100vw-2rem))]`).

### R4 — Board columns fixed `w-[280px]`; one column barely fits on mobile — **P3**
- **View / viewport:** Board, 380px.
- **What breaks:** each column is `w-[280px] shrink-0` and the row
  scrolls horizontally. At 380px (content ~331px after the rail) exactly
  one column shows; every other column needs horizontal scroll. Kanban is
  inherently wide so this is expected, but on a phone it is close to
  single-column-only. Contained correctly (no body overflow).
- **Screenshot ref:** board-mobile-380.
- **Fix direction:** optional — allow columns to shrink to
  `min(280px, 85vw)` on mobile so the next column peeks, signalling
  scrollability; or offer a single-column stacked board under a
  breakpoint.
- **Trace:** `apps/web/src/client/board/BoardView.tsx:671` (`w-[280px]`);
  same pattern `apps/web/src/client/sprints/SprintsView.tsx:597`.

### R5 — Filter toolbar wraps to near-one-chip-per-row at mobile — **P3**
- **View / viewport:** List, 380px.
- **What breaks:** the FilterBar is `flex flex-wrap` (correct — it does
  not stack rigidly), but with ~331px of width each pill (Advanced,
  Project, Status …) is wide enough that only 1–2 fit per row, producing a
  tall stack that pushes the table far down the page. Functional, just
  space-hungry.
- **Screenshot ref:** list-mobile-380.
- **Fix direction:** consider collapsing the filter pills into a single
  "Filters" disclosure on mobile, or tightening pill padding under a
  breakpoint.
- **Trace:** `apps/web/src/client/list/FilterBar.tsx:189`
  (`flex flex-wrap items-center gap-2`).

### R6 — List table (PASSES) — table scrolls inside its own container
- **View / viewport:** List, 380px. Recorded as a **pass**, not a defect.
- **Detail:** the `<table>` (scrollWidth 1011px) is wrapped in an
  `overflow-x-auto` div (clientWidth 287px) that is the scroll boundary;
  the document body stays at 380px with no horizontal overflow. This is
  the desired behaviour. Titles truncate/clip inside the scroll region as
  intended.
- **Trace:** the wrapping `overflow-x-auto overflow-y-hidden` div around
  the list table in `apps/web/src/client/list/ListView.tsx`.

### R7 — Task detail (PASSES, minor) — single-column stack at mobile
- **View / viewport:** Task detail (e.g. `/tasks/DEMO-5`), 380px.
- **Detail:** the desktop right-hand metadata sidebar reflows to a
  single-column stack; Description editor, Related, Attachments render
  full-width and legibly. No horizontal overflow. Recorded as a pass.

---

## Theme-parity findings

Tokens are dual-scoped in `apps/web/src/client/styles/tokens.css`
(`:root` = light, `.dark` = dark), so most surfaces have proper
per-theme values and there are **no "defined only for one theme"**
invisible-surface bugs among the token-driven colours. The findings below
are (a) contrast weaknesses present in *both* themes, and (b) a handful of
hardcoded hex values that bypass the theme system.

### T1 — `text-tertiary` fails WCAG AA (normal text) in BOTH themes — **P2**
- **What breaks:** `--text-tertiary` is used for timestamps ("3m ago"),
  metadata field labels, counts, and helper text at 11–13px normal weight.
  Measured contrast:

  | pairing | light | dark | AA (4.5) |
  |---|---|---|---|
  | text-tertiary / bg-surface | 3.68 | 3.64 | fail |
  | text-tertiary / bg-canvas | 3.46 | 3.89 | fail |
  | text-tertiary / bg-muted | 3.27 | 3.25 | fail |

  All below 4.5 for normal text in both themes (they clear the 3.0
  large-text bar, but this text is small). This is the reviewer-flagged
  "text-tertiary on bg-muted" concern, confirmed and generalised.
- **Theme:** both (symmetric — not a parity gap, a shared weakness).
- **Fix direction:** darken `--text-tertiary` in light
  (`#7B8699` → ~`#5F6B7E`) and lighten in dark (`#6E6E75` → ~`#8A8A92`) to
  reach ~4.5 on `bg-surface`/`bg-canvas`; accept the slightly lower ratio
  on `bg-muted` chips or lift those too.
- **Trace:** `apps/web/src/client/styles/tokens.css:23` (light
  `--text-tertiary`), `:72` (dark).

### T2 — `status-discarded` and `priority-low` chips low-contrast in BOTH themes — **P3**
- **What breaks:**

  | pairing | light | dark | AA (4.5) |
  |---|---|---|---|
  | status-discarded-fg / status-discarded-bg | 3.04 | 3.25 | fail |
  | priority-low / bg-canvas | 3.46 | 3.89 | fail |

  The "Discarded" status pill and the low-priority dot/label read faintly
  in both themes.
- **Fix direction:** these deliberately read as "muted", so this is a
  judgement call; if AA is required for pill text, deepen
  `--status-discarded-fg` and `--priority-low` a notch in each theme.
- **Trace:** `apps/web/src/client/styles/tokens.css:37-38,47` (light),
  `:86-87,96` (dark).

### T3 — Corrupt-field ⚠ affordance (DEMO-2) — reads in BOTH themes (PASS)
- **What was checked:** DEMO-2 has a corrupt `due_date` (value `42`). On
  the Timeline (Unscheduled list) it surfaces as a danger pill
  "⚠ due_date is corrupt: 42" using `--feedback-danger-fg/-bg`. Verified
  legible in **light** (dark-red text on pale-pink) and **dark**
  (salmon `#FF8A73` on dark maroon `#3A1410`). Danger, warn, and success
  feedback tokens all have proper dual-theme values. Recorded as a pass.
- **Screenshot ref:** timeline-light-corrupt, timeline-dark-corrupt.
- Adjacent observation (out of theme/responsive scope, flagged only):
  the corrupt `due_date` is surfaced on the **Timeline** but on the
  **List** Due column and the **Task-detail** Due field DEMO-2 shows a
  plain "—" with no ⚠ — a cross-surface affordance-parity gap worth a
  separate look against `known-gaps.md`; not filed here.

### T4 — Hardcoded hex ColorDots bypass the theme system — **P3**
- **What breaks:** sidebar project/all-projects/sprint dots use literal
  hex rather than tokens, so they render identically regardless of theme
  (no invisibility, but a maintainability/parity smell — a theme change
  won't touch them, and they were not contrast-tuned per theme):
  - `#8A94A6` (All projects) — contrast vs light surface **3.06**, vs
    dark surface 6.02
  - `#1E6FCB` (each project) — vs light 5.01, vs dark 3.67
  - `#1F8A4C` (active sprint) — vs dark 4.20
  These are small decorative dots so the low ratios are tolerable, but the
  values should be tokens. (`Sidebar.tsx:815` already correctly falls back
  to `var(--text-tertiary)` for the inactive sprint dot — inconsistent
  with its sibling.)
- **Fix direction:** replace with theme tokens (e.g. a
  `--dot-project` / reuse `--priority-*` or `--accent`), defined in both
  scopes.
- **Trace:** `apps/web/src/client/shell/Sidebar.tsx:469` (`#8A94A6`),
  `:517` (`#1E6FCB`), `:815` (`#1F8A4C`).

### T5 — `border-subtle` dividers near-invisible in BOTH themes — **P3**
- **What breaks:** `--border-subtle` vs `bg-surface` measures **1.19**
  (light) / **1.16** (dark) — effectively no visible edge. Used for row
  dividers and section separators (e.g. sticky footers
  `ListView.tsx:778`, `BulkBar.tsx:110`). On dense surfaces the row
  separation relies almost entirely on spacing, not the divider. Likely
  intentional ("subtle"), but at these ratios the divider does essentially
  nothing; if a hairline is wanted it needs to be a step stronger.
- **Fix direction:** if visible separation is intended, nudge
  `--border-subtle` toward `--border-default`; otherwise document that
  subtle dividers are decorative-only.
- **Trace:** `apps/web/src/client/styles/tokens.css:18` (light),
  `:67` (dark).

### T6 — accent-on-accent-muted chips (PASS)
- **What was checked:** the reviewer-flagged "accent on accent-muted"
  chip pairing (filter-facet chips, label field). Measured **5.55**
  (light) / **5.36** (dark) — clears AA in both themes. Recorded as a pass.
- **Trace:** `apps/web/src/client/list/FilterBar.tsx:252`
  (`bg-accent-muted … text-accent`); tokens
  `apps/web/src/client/styles/tokens.css:26,28` / `:75,77`.

---

## Screenshot index (session references)

Screenshots were taken live during review; they are referenced by name
above (not committed). To reproduce: toggle theme via header
Light/Dark/System, set viewport via dev-tools device mode (the app reads
`.dark` on `<html>`, so use the in-app toggle, not OS dark mode):

- list-light-1280, list-dark-1280 — list, both themes, wide
- list-mobile-380 — list at 380px (sidebar rail, wrapped toolbar,
  contained table scroll)
- board-mobile-380 — board at 380px (single 280px column visible)
- timeline-light-corrupt / timeline-dark-corrupt — DEMO-2 corrupt
  due_date pill, both themes
- settings-mobile-380 — settings nav+panel side-by-side, panel clipped
- taskdetail-mobile-380 — task detail single-column stack
