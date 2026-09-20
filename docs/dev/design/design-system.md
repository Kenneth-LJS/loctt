# LocTT design system

How the LocTT web UI (`apps/web/src/client`) looks and is built: the tokens,
type scale, iconography, primitives, and the accessibility and
responsiveness baseline. This is the single reference to build and review
UI against.

The exact values live in code — `styles/tokens.css` (colour, spacing),
`styles/index.css` (`@theme` type scale, `.prose-body`), `ui/` (primitives).
This doc names them and states the rules for using them.

Building or reviewing UI: check the change against the rules here. Adding a
token or primitive: document it here in the same change.

---

## 1. Typography

### Type scale (B1)

Four named sizes, defined in `styles/index.css` `@theme` as `--text-*` and
emitted by Tailwind as `text-*` utilities. Sizes are in **rem** anchored to
a 14px base (`html { font-size: 87.5% }`), so browser text-only zoom scales
everything (A11Y-39 / WCAG 1.4.4). Never re-pin an absolute `px` size — it
cancels text-zoom.

| Utility | Token | Size | Use |
|---|---|---|---|
| `text-meta` | `--text-meta` | 11px | timestamps, secondary meta |
| `text-label` | `--text-label` | 12px | control labels, chips, dense rows |
| `text-body` | `--text-body` | 13px | body text, table cells (the default) |
| `text-heading` | `--text-heading` | 15px | section headings |

The base body is 14px (the browser root × 87.5%); the scale above is the
in-app content scale. Use a named `text-*` utility, not an inline
`text-[…rem]`.

### Monospace — code and CLI ONLY (K98)

`font-mono` is for exactly two things:

- **Code / DSL** — inline and fenced code in task/comment bodies
  (`.prose-body code`/`pre`), the query DSL editor, the query builder's
  live query preview, saved-view query strings.
- **CLI commands** shown literally in prose — `loctt doctor`,
  `loctt restore`, `git worktree remove …`.

**Do NOT** use `font-mono` as a "make this look different" device. It was
stripped from file/config paths, config keys/values quoted in prose, task
keys / IDs / slugs / prefixes / ULIDs shown as data, confirm-word inputs,
and hex-colour fields. A `<code>` element may stay for semantics/quoting but
without the `font-mono` class unless it holds code or a CLI command. The
`--font-mono` token backs the two allowed uses.

### `.prose-body` — the one markdown typography

Rendered markdown (task descriptions, comment bodies) is styled by a single
class, `.prose-body`, defined once in `styles/index.css`. It styles **bare
element tags** (`h1`–`h6`, `ul`/`ol`/`li`, `pre`/`code`, `blockquote`,
`table`, `hr`, `p`) so the three body surfaces render identically:

- the read view (`editor/BodyRenderedView.tsx`),
- the rich (TipTap) editor surface (`editor/RichEditor.tsx`),
- the comment renderer (`comments/renderMarkdown.tsx`).

It is deliberately **not** `!important` and lives outside `@layer`, so
Tailwind utilities still win — a surface can override a specific element
inline, but the baseline typography is shared. Colours come from the design
tokens (dark mode is free); sizes are `rem`/`em` (text-zoom flows through).
When adding a markdown node type, style its bare tag here, not per-surface.

---

## 2. Colour tokens

Defined in `styles/tokens.css` for light (`:root`) and dark (`.dark`), wired
into Tailwind `@theme` as `--color-*` so utilities like `bg-bg-canvas`,
`text-text-primary`, `border-border-subtle` resolve per active theme. **Use
a token utility; never a raw hex.** Dark mode is toggled by the `.dark`
class on `<html>` (`@custom-variant dark`), so `useTheme` can force a mode
regardless of OS preference.

Families (names, not values — values live in `tokens.css`):

- **Backgrounds:** `bg-canvas`, `bg-surface`, `bg-surface-raised`,
  `bg-muted`, `bg-muted-hover`, `bg-row-hover`.
- **Borders:** `border-subtle`, `border-default`, `border-strong`,
  `border-control`, `border-divider`.
- **Text:** `text-primary`, `text-secondary`, `text-tertiary`,
  `text-disabled`.
- **Accent:** `accent`, `accent-hover`, `accent-muted`, `accent-contrast`.
- **Status categories** (paired fg/bg): `status-pending-*`,
  `status-active-*`, `status-completed-*`, `status-discarded-*`. A task's
  status colour comes from its workflow **category**, so a renamed status
  keeps a consistent colour and the four categories read the same across
  list/board/detail.
- **Semantic (paired fg/bg):** `danger-*`, `success-*` (utilities backed
  by `--feedback-danger-*` / `--feedback-success-*` in `tokens.css`).
  There is no `warning-*` colour token — the ⚠ marker is a text glyph
  (`ICON.warning`), and status uses the four category tokens above.

Contrast is worked to WCAG AA in both themes (A11Y-39/40); when adding a
token, check it against the surfaces it lands on.

---

## 3. Spacing

`--space-*` (0/px/1–6/8/10/12 = 0…48px on a 4px grid) exist in `tokens.css`,
but numeric Tailwind spacing utilities (`p-2`, `gap-3`, `m-4`, `h-8`) are
the day-to-day tool and are already `rem` (so they scale with text-zoom).
Use the numeric utilities; the `--space-*` scale is the documented grid they
follow. A 16px side gutter is the mobile minimum; no horizontal page scroll.

**Desktop page padding (K-layout).** Every list-like main view (List,
Board, Timeline, Sprints, Milestones, and the detail views) uses the same
shell so switching views does not shift the content in or out:

- **Outer wrapper:** `p-4` (16px on every edge) — never a page-level
  `max-w`/`mx-auto` (views are full-bleed) and never `p-6`.
- **Header→body gap:** `gap-3` on the wrapper's `flex-col`.
- **Scroll:** a view that pins a header owns its own scroll
  (`overflow-auto` on the wrapper), so the header stays put while the body
  scrolls.
- **The title row** is the shared `ui/PageHeader` primitive
  (`flex flex-wrap items-center justify-between gap-3`, title
  `text-[1.0714rem] font-semibold`). It covers the *plain* title case
  only; bordered/card headers (TaskDetail, MilestoneDetail) and toolbars
  (Timeline) are not PageHeaders. A view whose top row carries no title
  (Board's chips row, Sprints' manage-link) keeps its own row.
- **An `ErrorState` mounts bare** — it self-centers and self-pads
  (`mx-auto max-w-lg px-4 py-10`), so no view wraps it in a padding div.

**Settings panels** carry no outer page padding of their own. The
`settings-pane` in `SettingsShell` owns the `p-8` — one source of truth —
so switching sections cannot shift the panel. `WorkflowPanelFrame` (shared
by the workflow panels) and every standalone panel render with no outer
padding; a nested sub-panel (e.g. `ReconcilePanel` inside `GitSyncPanel`)
adds none for the same reason.

---

## 4. Iconography (A208)

Interactive/decorative affordances are drawn as **inline SVG** via
`ui/Icon.tsx` — `<Icon name="…" size={16} />`, `currentColor`, tree-shaken,
no icon font. Use it for carets, close, kebab (`more`), reorder arrows,
link/copy/edit/trash/archive/plus/download/refresh/check/search/settings/
drag, etc. **Do not** use ASCII/emoji as affordances (`▾ ✕ ⋯ ↑ ↓`, `👁`,
`⛔`).

Kept as literal text (`ui/icons.ts` `ICON`, not SVG): the **⭑** saved/
favourite marker (Ken: intentional) and the **⚠** status marker. Keyboard-
key labels and prose arrows also stay literal.

Accessibility: icons are decorative (`aria-hidden`) by default; when an icon
is the only content of a control, the **control** carries the `aria-label`
so it is not read twice. `IconButton` requires an `aria-label`.

---

## 5. Primitives (`ui/`)

Use these rather than hand-rolled markup.

- **`Button`** — variants `primary` / `secondary` / `ghost` /
  `ghost-danger` / `danger` / `danger-outline` / `warn-outline`, sizes
  `sm`/`md`. The default control; bakes in cursor/hover/active/focus. The
  `*-outline` variants are a tone-tinted **outline** (tone border + tone
  text over a transparent surface, subtle tone wash on hover) — for the
  alert-banner retry/dismiss buttons, where `secondary` (neutral border)
  and `danger` (solid fill) both read wrong. Modelled as named variants,
  not a `tone` prop, so they stay one lookup in the shared `BUTTON_VARIANT`
  map. Tokens only: `border-danger-fg/40 text-danger-fg hover:bg-danger-fg/10`
  (and the `warn-fg` equivalents). **`ghost-danger`** is the ghost look
  (transparent surface, `text-text-secondary` at rest) whose hover reddens
  to the danger tone rather than neutral — the row-action Delete pattern
  (e.g. `CommentItem`'s Copy link / Edit / Delete trio) that `ghost`
  (hovers to `text-primary`) and `danger`/`danger-outline` (filled/bordered)
  do not cover. Tokens only: `hover:bg-danger-fg/10 hover:text-danger-fg`
  (plus the `active:` equivalents). Lives on `Button` only —
  `IconButton`'s narrower variant union does not include it (its row-action
  callers are icon+label text buttons, not icon-only).
- **`IconButton`** — icon-only button; **requires `aria-label`**. Sizes
  `xs` (24px, tiny inline remove buttons e.g. a query-builder condition
  ✕) / `sm` (28px) / `md` (32px, default) / `touch` (44px, the WCAG 2.5.5
  tap-target minimum — use for standalone controls like the settings
  RowActions kebab instead of hand-rolling `h-11 w-11`). The glyph stays
  visually centred at its normal size in every footprint; `touch`'s extra
  area is invisible hit-slop.
- **`ToolbarButton`** — the toolbar pill height/spacing.
- **`Menu` / `MenuItem`** — overflow/kebab menus. The trigger receives
  `toggle`/`open` (not `onClick`).
- **`ResponsiveDialog`** — **the default overlay for a modal surface that
  carries editable content** (any multi-field editor or create form). A
  centered titled `Dialog` at ≥640px, a bottom `Sheet` below it, from ONE
  content slot — the same children render in both modes (no forked state).
  Shares Modal's a11y machinery by construction (its two branches ARE
  `Dialog`→`Modal` and `Sheet`). Reach for this first; drop to a plain
  `Modal`/`Dialog` only when a surface is intentionally centered at all
  widths (see below).
- **`Modal`** — base overlay; use `useFocusTrap` + `useInertBackground`.
  **`Dialog`** layers a titled panel on Modal. Use these directly only for
  a surface that should stay centered at every width — a short
  confirm/`ConfirmDialog`, a single-field prompt (e.g. Save-as-view) — not
  for a multi-field editor, which should be a `ResponsiveDialog`.
  **`ConfirmDialog`** is the shared destructive-confirm (don't write a
  bespoke delete dialog); it stays a centered dialog at all widths.
- **`Sheet`** — bottom/full drawer, used directly only for the specific
  list-filter facets and the advanced-query editor (and the settings
  section switcher). For an editor that wants dialog-on-desktop /
  drawer-on-mobile, use `ResponsiveDialog` (which wraps Sheet), not a bare
  Sheet. Same focus-trap/inert/Esc/backdrop as Modal.
- **`Combobox`** (A211) — THE searchable value picker: single or multi
  select, a listbox popover with a search box, `aria-combobox` +
  `aria-activedescendant` keyboard model (type to filter, ArrowUp/Down,
  Home/End, Enter, Escape returns focus to the trigger), present-but-
  disabled options with a reason, colour dot / suffix / hint per option,
  and the current value kept in the list when a query does not return it.
  Two search modes: `search={{ onQuery }}` for **server-side** (K90:
  labels, users, projects, milestones, sprints) — the box is always shown;
  no `search` for **client-side**, where the box appears once the static
  list reaches `COMBOBOX_SEARCH_THRESHOLD` (12) or `filterable` forces it.
  The trigger is a render prop; `ComboboxButton` is the select-shaped
  default (same height/border/chevron as `Select`). `OptionPicker`
  (task meta fields) and `LabelsField` are triggers over it; the query
  builder's value pickers use `ComboboxButton`.
  **The rule:** a set the *user can grow* (labels, users, projects,
  milestones, sprints, custom-enum values, timezones) → `Combobox`. A
  small *fixed* set (status/priority/type, operators, sprint state, unit,
  true/false) → plain `Select` or `Radio`. `FilterDropdown` (the list
  facets) keeps its `Menu`/`menuitemcheckbox` model (A11Y-10) but shares
  the Combobox threshold and match rule.
- **`Select`, `TextField`, `Checkbox`, `Radio`, `Toggle`, `Chip`,
  `Callout`, `Toast`, `UserAvatar`, `ErrorState`, `LoadingState`,
  `Announcer`** — use rather than re-implement. No raw `<select>`,
  `<input type="checkbox">` or `<input type="radio">` outside `ui/`
  (Ken: "I don't want to see native checkboxes or dropdowns"); the
  `editor/` package and `OptionPicker` (a custom listbox) are the
  exceptions. Native `type="date"` / `type="color"` are OS pickers and
  stay. `TextField` is **full-width by default**; pass `fullWidth={false}`
  for a fixed-width input (query-builder value inputs, the `w-32` estimate
  field) so the caller's own width class in `className` wins — needed
  because `cn` is a plain join, not `tailwind-merge`, so `w-full` cannot
  otherwise be overridden. `fullWidth={false}` also releases the
  `leadingIcon` wrapper's width.
- **`brand/LogoMark`** — the mark as two token-filled paths ("L" =
  `--accent`, "o" = `--text-primary`), so it follows the theme. Decorative
  (`aria-hidden`) beside the wordmark; pass `label` when it stands alone.
  The favicon in `index.html` is the same mark with the token *values*
  baked in — update it if those tokens change.

---

## 6. Accessibility baseline

The apparatus exists and is the standard, not optional (A11Y series /
WCAG AA):

- **Focus ring:** a global `:focus-visible { outline: 2px solid
  var(--text-primary); outline-offset: 2px }` — visible on coloured
  surfaces too. Don't remove outlines without an equivalent.
- **Focus management:** dialogs use `useFocusTrap` + `useInertBackground`
  + focus restore. A skip link exists.
- **Semantics:** real `<table>`/`<dl>`/`tablist`/`dialog`; landmark nav for
  breadcrumbs; `role="meter"` for progress bars with `aria-valuenow`.
- **Labels:** every icon-only control has an `aria-label`; empty editable
  fields keep a "not set" accessible name.
- **Reduced motion:** a global `prefers-reduced-motion` rule zeroes
  animations/transitions (SHL-28) — don't rely on animation to convey
  state.
- **Text zoom:** everything sized in `rem`/`em` (see §1) so 200% text-only
  zoom reflows without clipping.
- **Tap targets:** aim for ≥24px (desktop, WCAG 2.5.8) and 44px on touch;
  pad hit areas without growing the glyph.

---

## 7. Responsiveness

The mobile breakpoint is **640px** (the `useIsNarrow` default, Tailwind
`sm`). Below it, use a mobile-native pattern, not naive wrapping:

- Modal surfaces with editable content → a **`ResponsiveDialog`**: a
  centered dialog at ≥640px, a bottom drawer below it. This is the default
  for any multi-field editor or create form — do NOT ship a fixed centered
  card that crams on a phone, and do NOT ship a bare `Sheet` that is a
  drawer even on desktop. The switch is at 640px. (The Sidebar's own
  `NARROW_PX=900` is a different axis — in-grid column vs. floating shell
  drawer — and is not the overlay breakpoint.)
- Filters → a bottom **`Sheet`**, not a cramped wrapping row.
- Row/section overflow actions → a kebab **`Menu`**.
- Tables → card layout (conditionally rendered via `useIsNarrow`, not a CSS
  toggle that renders both DOMs).
- Settings section nav → a picker button + `Sheet`.

Everything must work at phone width (≈375px) with a 16px side gutter and no
horizontal page scroll.

---

## 8. Where the rules live

- **Values:** `apps/web/src/client/styles/tokens.css` (colour, spacing),
  `styles/index.css` (`@theme` type scale, `.prose-body`, base rules).
- **Primitives:** `apps/web/src/client/ui/`.
- **Rationale / decisions:** `decisions.md` (K98 monospace, A208 icons,
  B1 type scale, A11Y-39/40 zoom+contrast, and others cited above).
- **Adoption gaps:** `design-review.md` (the audit of what's built but not
  yet wired up).
