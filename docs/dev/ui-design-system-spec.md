# Web UI — Design-System Component Library SPEC

Status: **PLAN awaiting Ken's approval.** Nothing here is built. This is
the buildable spec for the "proper design component library" Ken asked
for. It turns the four UI reviews into a concrete component set, a token
scale, a migration order, and an effort estimate so Ken can pick scope
(all-at-once vs primitive-by-primitive).

**Evidence — already found, not re-derived here:**
- `docs/dev/ui-review-consistency.md` — ~25 button styles for one
  concept; 51 static button classNames; `text-white` bypassing
  `--accent-contrast` (7 places); `rounded` vs `rounded-md` ~50/50;
  9 ad-hoc `text-[Npx]` sizes; chip re-implemented 11×; glyph drift.
- `docs/dev/ui-review-form-controls.md` — ~46 native controls; 22 raw
  checkboxes/radios; drifting Select/TextField class strings; the
  behaviour cases a restyle must not break (BLK-1..4, A11Y-21, A11Y-40,
  LST-10).
- `docs/dev/ui-review-toolbar.md` — the ToolbarButton spec and the
  Advanced/Export height mismatch.
- `docs/dev/ui-review-responsive-theme.md` — `text-tertiary`,
  `status-discarded`, `priority-low`, `border-subtle` fail WCAG AA in
  both themes; interaction-state gaps.

**Scope boundary (CLAUDE.md).** Every primitive below lives in
`apps/web/src/client/ui/`. This is a **client-only** change — a `ui/`
primitive is not a core capability, so there is **no CLI/MCP mirror**
and no core/contracts edit. The one exception that *is* cross-cutting is
the token-value change in §2.4 (edits `styles/tokens.css`), which is
still client-only but affects every surface at once — call it out in its
own commit.

**The model to follow (already in the repo).** `board/BoardCard.tsx`
imports `StatusBadge`/`PriorityCell`/`TypeBadge` from `list/cells.tsx`,
so a status chip renders identically in List and Board. That
import-the-renderer pattern is the target end-state for every primitive
here: one component, many call sites, zero re-spelling. `list/cells.tsx`
is also the reference for how this repo writes a themed, degradation-
aware component (token classes via `[...].join(" ")`, `data-testid`
passthrough, graceful fallback).

**Repo conventions the primitives must match (verified in source):**
- **No `clsx`/`classnames`/`cva`/`tailwind-merge` dependency exists.**
  Components compose classes with `[...].filter(Boolean).join(" ")`
  (see `Menu.tsx`, `cells.tsx`). Do **not** add a class-variance
  dependency. Either keep the array-join idiom, or add one ~8-line local
  helper `ui/cn.ts` (`export const cn = (...xs) => xs.filter(Boolean).join(" ")`)
  and use it everywhere. Recommend the local `cn` — variant lookup
  tables read badly as nested array joins. This is the only new
  "infra" and it is trivial.
- **`data-testid` is declared, not spread.** `MenuItem` documents why:
  a caller writing `data-testid=` on a component that renders its own
  element type-checks but silently never reaches the DOM. Every
  primitive that wraps a real element must **declare a `testId?: string`
  prop (or forward `data-testid` explicitly) and apply it to the inner
  element**, because integration/e2e/vitest tests select by it. This is
  load-bearing — see §3 migration.
- **Focus ring already exists globally.** `styles/index.css` sets
  `:focus-visible { outline: 2px solid var(--text-primary); outline-offset: 2px }`
  on every control, chosen to clear 3:1 on accent surfaces (A11Y-16).
  Primitives should **rely on the global ring** and not re-declare it,
  *except* where a control paints `appearance-none` (checkbox/radio/
  select) and needs `focus-visible:outline-*` to reattach it. Do not
  invent a second focus style — the sidebar's ad-hoc
  `focus:border-accent focus:outline-accent` is drift the reviews flag,
  not a pattern to copy.
- **Reduced motion is global.** `@media (prefers-reduced-motion)` already
  neutralises all transitions; primitives may use `transition-colors`
  freely.

---

## 1. Component set — leverage-ranked build order

Ranked by (visible drift removed) × (call sites unblocked) ÷ (build
cost). Each entry gives **props / variants**, the **state matrix**, and
the **exact token classes** so an implementer copies rather than
invents. Class strings assume the §2 scale and the local `cn`.

| # | Primitive | Kills | Call sites |
|---|---|---|---|
| 1 | `Button` | §1 (~25 button styles), §3a (`text-white`) | ~51 static + more |
| 2 | `IconButton` | icon-button size/radius drift (§1c) | ~15 |
| 3 | `ToolbarButton` | the toolbar 4-recipe spread (Ken's flag) | 6 in the list toolbar |
| 4 | `Chip` | pill re-implemented 11× | ~11 |
| 5 | `Checkbox` + `Radio` | 22 raw native controls (Ken's flag) | 22 |
| 6 | `Select` | two-variant select drift | 13 |
| 7 | `TextField` | 9-way input drift | ~21 |
| 8 | `Callout` / `Banner` | repeated error/warn block (~5×) | ~5 |
| 9 | `Toggle` (switch) | optional — 3 view toggles | 3 |
| 10 | `icons.ts` glyph map | star/close/caret drift | many |

`icons.ts` is #10 by cost but should land **first** in practice (it is
five minutes and every other component references it). Treat it as a
prerequisite, not a phase.

---

### 1.0 `icons.ts` — canonical glyph map (prerequisite)

Not a component — a lookup that ends the "two stars, two closes" drift
(§4 of the consistency review). One canonical glyph per named
affordance.

```ts
// apps/web/src/client/ui/icons.ts
export const ICON = {
  star: "⭑",       // was ★ vs ⭑  (Sidebar default project vs Save-as-view)
  close: "✕",      // was × vs ✕
  caretDown: "▾",  // disclosure open  (was ▾ vs ▼)
  caretRight: "▸", // disclosure collapsed
  more: "⋯",       // overflow/more
  check: "✓",      // used by Checkbox background SVG (or inline)
  warning: "⚠",    // already the app-wide convention in cells.tsx
} as const;
```

Callers import `ICON.close` instead of typing a glyph. **Migration is
mechanical** and can be done lazily (each primitive adopts it as it is
built; the two one-off drift sites — `ListView` sort `▼`, the `★`/`⭑`
split — fixed in place). Do **not** build an `<Icon>` React component;
glyphs are text and a string map is enough (matches the app's
"literal Unicode, no icon font" decision — see decisions.md before
changing that).

---

### 1.1 `Button` — the top item (P0)

The single highest-leverage primitive. Resolves the ~25 spellings, bakes
in `--accent-contrast` (kills the `text-white` defect, §3a), and gives
every button the hover/active/focus/disabled states Ken flagged as
missing.

**Props**

```ts
interface ButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "className"> {
  variant?: "primary" | "secondary" | "ghost" | "danger"; // default "secondary"
  size?: "sm" | "md";        // default "md"
  fullWidth?: boolean;
  // type defaults to "button" (never accidental submit); caller can override.
  // data-testid, aria-*, onClick, disabled, ref all pass through to <button>.
}
```

Renders a real `<button type="button">`. Forward `ref`
(`React.forwardRef`) — some call sites (menus, focus management) need
it. `className` is intentionally **not** in the public props: the point
is to stop per-site class drift. Provide a rare escape hatch only if a
migration proves it necessary (prefer adding a variant instead).

**Size tokens (one height per size — the thing that makes them align)**

| size | height | padding-x | text | icon gap |
|---|---|---|---|---|
| `sm` | `h-7` | `px-2.5` | `text-label` (12px) | `gap-1` |
| `md` | `h-8` | `px-3` | `text-body` (13px) | `gap-1.5` |

Base (all variants): `inline-flex items-center justify-center rounded-md font-medium transition-colors cursor-pointer disabled:cursor-not-allowed`.
Radius is **always `rounded-md`** (§2.3). **`cursor-pointer` in the base
(K-16):** a native `<button>` has no pointer cursor, and only 5 of ~80
button sites set it today; baking it into the base — here and in
`IconButton`/`ToolbarButton`/interactive `Chip`/`MenuItem` — is the
component-level fix. `disabled:cursor-not-allowed` still wins for disabled.

**State matrix × variant** (token classes, exact)

| variant | rest | hover | active | disabled |
|---|---|---|---|---|
| `primary` | `bg-accent text-accent-contrast` | `hover:bg-accent-hover` | `active:bg-accent-hover` | `disabled:opacity-50` |
| `secondary` | `border border-border-default bg-bg-surface text-text-secondary` | `hover:bg-bg-muted hover:text-text-primary` | `active:bg-bg-muted-hover` | `disabled:opacity-50` |
| `ghost` | `text-text-secondary` | `hover:bg-bg-muted hover:text-text-primary` | `active:bg-bg-muted-hover` | `disabled:opacity-50` |
| `danger` | `bg-danger-fg text-accent-contrast` | `hover:opacity-90` | `active:opacity-90` | `disabled:opacity-50` |

Notes:
- **`text-accent-contrast`, never `text-white`** — for both `primary`
  and `danger`. `--accent-contrast` is `#FFFFFF` in light and `#0B0B0C`
  in dark; on a light-accent theme white would fail, which is the §3a
  bug. Danger deliberately reuses `accent-contrast`: it is the paired
  legible-on-fill token, and `--feedback-danger-fg` is dark-enough-on-
  light / light-enough-on-dark that its contrast token is the same
  role. (If a dedicated `--danger-contrast` is wanted later it is a
  one-line token add; not required for AA today — verify the pair when
  building.)
- Focus: **rely on the global `:focus-visible` ring.** Do not add
  `focus:` classes.
- One disabled treatment everywhere: `disabled:opacity-50` +
  `disabled:cursor-not-allowed`. (A11Y-31 wants disabled distinguishable
  by more than opacity for *form controls*; for buttons opacity is the
  established pattern and the reviews accept it. Keep the pointer-cursor
  change as the second cue.)

**Composition example** (implementer copies this shape):

```tsx
const SIZE = {
  sm: "h-7 px-2.5 text-label gap-1",
  md: "h-8 px-3 text-body gap-1.5",
} as const;
const VARIANT = {
  primary:   "bg-accent text-accent-contrast hover:bg-accent-hover active:bg-accent-hover",
  secondary: "border border-border-default bg-bg-surface text-text-secondary hover:bg-bg-muted hover:text-text-primary active:bg-bg-muted-hover",
  ghost:     "text-text-secondary hover:bg-bg-muted hover:text-text-primary active:bg-bg-muted-hover",
  danger:    "bg-danger-fg text-accent-contrast hover:opacity-90 active:opacity-90",
} as const;
// class = cn("inline-flex items-center justify-center rounded-md font-medium transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50", SIZE[size], VARIANT[variant], fullWidth && "w-full")
```

---

### 1.2 `IconButton` — square icon-only button

Kills the `h-8 w-8 rounded-md` vs `h-7 w-7 rounded` split (§1c). A
sibling of `Button`, not a `Button` prop, because it is square, requires
an `aria-label`, and centres a single glyph.

**Props**

```ts
interface IconButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "className"> {
  "aria-label": string;      // REQUIRED — icon has no text
  variant?: "ghost" | "secondary" | "danger"; // default "ghost"
  size?: "sm" | "md";        // default "md"
  children: React.ReactNode; // the glyph (from ICON.*)
}
```

| size | box | radius |
|---|---|---|
| `sm` | `h-7 w-7` | `rounded-md` |
| `md` | `h-8 w-8` | `rounded-md` |

Base: `grid place-items-center rounded-md transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50` (K-16).
Variants reuse the `Button` VARIANT map (same hover/active tokens). The
`aria-label` being a required prop is the fix for silent unlabelled icon
buttons.

---

### 1.3 `ToolbarButton` — the list toolbar pill (Ken's flag)

The reviewed root cause of "no rhyme or reason" in the `/list` toolbar.
Encodes the one pill spec every toolbar control should share, plus the
active/selected state facets use.

Two viable shapes — **recommend making it a thin preset over `Button`,
not a separate component**, so there is one button implementation:
`ToolbarButton = <Button variant="secondary" size="md" …>` with one
extra `active` prop for the selected-facet look. If a separate file is
clearer for the toolbar team, keep it a wrapper, not a re-spelling.

**Props**

```ts
interface ToolbarButtonProps extends ButtonProps {
  active?: boolean;   // facet is applied / mode is on
  // aria-pressed should be set by caller for mode toggles (Advanced)
}
```

**State**

| state | classes |
|---|---|
| rest | `h-8 rounded-md border border-border-default bg-bg-surface px-2.5 text-body text-text-secondary cursor-pointer hover:bg-bg-muted` (K-16; inherited when it is the recommended `Button` preset) |
| active/selected | `border-accent bg-accent-muted text-accent` (verbatim the facet's existing active look, `FilterDropdown.tsx:80`) |
| disabled | `disabled:opacity-50 disabled:cursor-not-allowed` |

Adopt in all six toolbar controls the review lists: FilterDropdown
trigger, Advanced toggle, Refresh, Export, Save-as-view, and the
Show-archived shell. **Preserve** these locators exactly (toolbar review
§4a): `advanced-query-toggle` testid, accessible names `Filter <Label>` /
`Filter by <Label>`, `Refresh` / `Export` aria-labels, Export's
`aria-haspopup="menu"`/`aria-expanded`, and `getByRole button /Save as view/`.
Note: this spec covers the *button primitive* only; the toolbar
**re-grouping / IA** proposal (moving Advanced out of the facet row) is a
separate ticket in the toolbar review and is **not** in scope here.

---

### 1.4 `Chip` — the pill/count/label object

Kills the ~11 re-implementations (Sidebar, Sprints ×2, Milestones ×2,
Labels, Board count, SprintMetaHeader). Note the status/priority/label
cell renderers in `list/cells.tsx` are a **separate, richer** concern
(they carry degradation/orphan logic) — **leave `cells.tsx` alone**; it
is the reuse model, not a migration target. `Chip` is for the *plain*
count/label pills that have no def-resolution logic.

**Props**

```ts
interface ChipProps {
  variant?: "neutral" | "accent" | "count"; // default "neutral"
  children: React.ReactNode;
  title?: string;
  testId?: string;
}
```

Base: `inline-flex items-center rounded-md px-1.5 py-0.5 text-meta font-medium`.
(Radius `rounded-md`, resolving the cells.tsx internal `rounded` vs
`rounded-md` split noted in consistency §5. Size `text-meta`=11px, the
de-facto pill size.)

| variant | classes | use |
|---|---|---|
| `neutral` | `bg-bg-muted text-text-secondary` | Sidebar counts, meta pills |
| `accent` | `bg-accent-muted text-accent` | active/emphasis pills |
| `count` | `bg-bg-muted text-text-secondary tabular-nums` | numeric badges |

A `rounded-full` count badge (Sidebar) is a shape variant, not a new
component — add `shape?: "square" | "pill"` (default `square`
`rounded-md`) if a call site needs the fully-round look; otherwise
standardise on `rounded-md`. Recommend `rounded-md` for all and
retiring the `rounded-full` pills unless Ken wants the round count
badge kept — **flag for Ken**: the round count badge in the Sidebar is
the one place `rounded-full` reads intentionally.

---

### 1.5 `Checkbox` + `Radio` — 22 raw native controls (Ken's flag)

The specific thing Ken flagged ("native checkboxes look bad"). **Keep
the real native `<input>`** and paint it with `appearance-none` — this
preserves Space-to-toggle, `indeterminate`, `name` grouping, form
semantics, and every behaviour case (BLK-1..4, A11Y-21, LST-10) for
free. Do **not** replace with a `<div role="checkbox">`.

**`Checkbox` props**

```ts
interface CheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "className"> {
  indeterminate?: boolean;   // set on the DOM node via ref useEffect
  // checked, onChange, disabled, id, aria-*, data-testid pass through.
}
```

`indeterminate` is **required by the API** even though it is optional per
call — the ListView header ("select all") needs it (BLK-3). Set it
internally via a callback ref / `useEffect` so callers stop hand-rolling
the ref (`ListView.tsx:586` today). This forces the API to be right,
which is why Checkbox is built before the simpler controls.

Base (on the `<input type="checkbox">`):
```
appearance-none shrink-0 h-4 w-4 rounded-sm border border-border-strong
bg-bg-surface cursor-pointer transition-colors
checked:bg-accent checked:border-accent
disabled:cursor-not-allowed disabled:border-border-default disabled:bg-bg-muted
focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--text-primary)]
```

The tick/dash: a background-SVG stroked in `--accent-contrast`, shown
only when `:checked` or `[data-indeterminate]`. (Inline SVG data-URI in
the class via `checked:bg-[url(...)]`, or a small `::after`; either is
fine — the tick must be `accent-contrast` so it reads on the accent
fill.) This is the one control that **re-declares a focus ring** because
`appearance-none` removes the UA outline the global rule relied on.

| state | box | border | mark |
|---|---|---|---|
| unchecked | `bg-bg-surface` | `border-border-strong` | none |
| hover | `bg-bg-muted-hover` | `border-border-strong` | none |
| checked | `bg-accent` | `border-accent` | ✓ in `accent-contrast` |
| indeterminate | `bg-accent` | `border-accent` | – dash in `accent-contrast` |
| disabled | `bg-bg-muted` | `border-border-default` | dimmed if checked |
| focus (kbd) | +ring `outline 2px text-primary offset 2px` | — | — |

**Contrast (A11Y-40):** the resting border is the control boundary that
must clear **3:1** vs `bg-surface`. `border-border-strong`
(`#A7B1C2` light / `#43434A` dark) is the correct token; `border-default`/
`border-subtle` are too faint and would fail. Verify 3:1 on build.

**`Radio` props**: same shape minus `indeterminate`, plus `name`
(grouping — all 7 radios rely on it, keep it a real forwarded attr).

Base: `appearance-none shrink-0 h-4 w-4 rounded-full border border-border-strong bg-bg-surface cursor-pointer` +
`checked:border-[5px] checked:border-accent` (inner dot via thick accent
border) + same disabled/focus rules as Checkbox.

**Behaviour lock (form-controls review §4) — do not break:**
- BLK-1: row checkbox keyboard-reachable, Space toggles, click selects
  the row and **does not navigate** — the `onClick stopPropagation` at
  `ListView.tsx:735` is load-bearing; keep it at the call site.
- BLK-3: header checkbox **checked (not indeterminate)** when all visible
  selected; `indeterminate` only while partial.
- BLK-4: "select all N matching" is a **separate control**; do not merge.
- A11Y-21: announces `checked`; a switch look needs `role="switch"`.
- Every `data-testid` passes through to the `<input>`
  (`estimation-enabled`, `create-another`, `milestones-show-archived`,
  `timeline-arrows`, `backup-mode-*`, `statuses-default-*`,
  `custom-field-searchable-*`, `relationship-symmetric-*`, `meta-input-*`,
  …). This is why passthrough is mandatory, not optional.

---

### 1.6 `Select` — themed native select

Standardises the two drifting variants and adds a themed chevron (the
native OS arrow does not pick up dark mode).

**Props**

```ts
interface SelectProps
  extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "className"> {
  size?: "sm" | "md";   // default "md"
  // value, onChange, disabled, children (<option>s), aria-*, data-testid pass through.
}
```

Base:
```
appearance-none rounded-md border border-border-default bg-bg-surface
px-2 pr-7 text-text-primary cursor-pointer transition-colors
focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--text-primary)]
disabled:cursor-not-allowed disabled:bg-bg-muted disabled:text-text-disabled
```
Chevron: a background-image SVG in `text-tertiary`, positioned right
(`bg-[url(...)] bg-no-repeat bg-[position:right_0.5rem_center]`), which
is what `pr-7` leaves room for.

| size | height | text |
|---|---|---|
| `sm` | `h-7` | `text-label` (12px) |
| `md` | `h-8` | `text-body` (13px) |

Pick **one** border token (`border-default`) and **one** radius
(`rounded-md`) — that alone ends the drift. Skip
`task/editors/OptionPicker.tsx` (deliberately a custom listbox, not a
`<select>` — leave it).

---

### 1.7 `TextField` — one text-input shape

Standardises the ~9 spellings and promotes the good search-input focus
treatment into the default so all inputs focus alike.

**Props**

```ts
interface TextFieldProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "className"> {
  invalid?: boolean;         // → aria-invalid + border-danger-fg
  leadingIcon?: React.ReactNode; // search box glyph slot
  // type (text/number/search/date), value, onChange, disabled, placeholder,
  // aria-*, data-testid, ref pass through.
}
```

Base:
```
w-full rounded-md border border-border-default bg-bg-surface
px-2.5 py-1.5 text-body text-text-primary placeholder:text-text-tertiary
transition-colors
disabled:bg-bg-muted disabled:text-text-disabled
aria-invalid:border-danger-fg
```
Relies on the global focus ring. When `leadingIcon` is set, wrap in a
`relative` span and pad-left for the icon (the search boxes in Sidebar/
Header/FilterDropdown). Height comes from `py-1.5` + `text-body` ≈ the
`h-8` controls; if exact `h-8` alignment matters next to buttons, offer a
`size="sm"` (`h-7 py-1 text-label`).

**Placeholder token:** `text-tertiary` currently fails AA (§2.4) — the
token fix lifts it; no per-field change needed once §2.4 lands.

---

### 1.8 `Callout` / `Banner` — the error/warn/info block

Kills the repeated `rounded-md border border-danger-fg/30 bg-danger-fg/5
px-3 py-2 text-[12px] text-danger-fg` block (~5× in TimelineView,
CustomFields, EnumCollection). Distinct from `Toast` (transient,
success-only, floating) — this is an **anchored, persistent** message,
which is the app's default failure surface (see Toast.tsx's own note on
why most errors anchor).

**Props**

```ts
interface CalloutProps {
  tone: "danger" | "warn" | "success" | "info"; // no default — tone is the point
  children: React.ReactNode;
  role?: "status" | "alert";  // caller decides urgency; default "status"
  testId?: string;
}
```

Base: `flex items-start gap-2 rounded-md border px-3 py-2 text-label`.

| tone | classes |
|---|---|
| `danger` | `border-danger-fg/30 bg-danger-bg text-danger-fg` |
| `warn` | `border-warn-fg/30 bg-warn-bg text-warn-fg` |
| `success` | `border-success-fg/30 bg-success-bg text-success-fg` |
| `info` | `border-border-default bg-bg-muted text-text-secondary` |

The feedback tokens are already dual-theme and verified legible
(responsive-theme review T3 — the corrupt-field pill uses this exact
pairing and passes both themes). Leading `ICON.warning` for danger/warn
is conventional; keep it optional so callers with their own layout
(cells.tsx) are unaffected.

---

### 1.9 `Toggle` (switch) — optional, follow-up

The "Show archived" / "Dependencies" / "Enabled" controls read as
switches. **Recommend shipping `Checkbox` first and treating Toggle as a
follow-up** for only the ~3 *view* toggles (FilterBar archived,
MilestonesView archived, TimelineView dependencies) — **not** form-field
booleans (Estimation "Enabled", custom-field booleans stay `Checkbox`).

If built: `<input type="checkbox" role="switch">` (keeps AT
announcement, A11Y-21). Track `h-4 w-7 rounded-full bg-border-strong
checked:bg-accent`; thumb `h-3 w-3 rounded-full bg-accent-contrast`
translating on check; same focus ring as Checkbox. **Flag for Ken**:
switch vs checkbox for view toggles is a look decision, not a
correctness one — A11Y-21 is satisfied either way. Default to
**not** building Toggle unless Ken wants the switch look.

---

## 2. Token scale doc

The reviews found the tokens themselves are good; the drift is that
values are written as **arbitrary Tailwind** (`text-[13px]`, `px-2.5`,
bare `rounded`) with no named scale pulling them together. This section
names the scale so the primitives above reference names, and adds the
Tailwind theme entries needed. Ban list at the end.

### 2.1 Type scale (replaces the 9 ad-hoc `text-[Npx]`)

Three names cover the de-facto ramp (13/12/11 are 829 of the 875 uses);
the outliers (`9/10/14/15/16/20px`) are one-offs to normalise onto the
nearest name or, where genuinely a heading, name explicitly.

| name | px | Tailwind | role |
|---|---|---|---|
| `text-body` | 13 | add `--text-body: 13px` → `text-body` | default body/control text |
| `text-label` | 12 | `--text-label: 12px` | dense labels, sm controls, callouts |
| `text-meta` | 11 | `--text-meta: 11px` | chips, counts, timestamps |
| `text-heading` | 15 | `--text-heading: 15px` | the ~15 section headings on 15px today |

Add under `@theme` in `styles/index.css`:
```css
--text-body: 13px; --text-label: 12px; --text-meta: 11px; --text-heading: 15px;
```
(Tailwind v4 emits `text-body` etc. from `--text-*`.) `text-[10px]`
(19×, mostly uppercase micro-labels) — decide with Ken whether to add a
`text-micro:10px` name or fold into `text-meta`; **flag for Ken**, low
stakes. `text-[9px]`/`[14px]`/`[16px]`/`[20px]` are typos/one-offs — fix
in place to the nearest name.

### 2.2 Spacing scale

No new tokens needed — Tailwind's built-in steps are the scale; the fix
is to **stop mixing adjacent steps for the same role**. The primitives
enforce this by owning padding (a button's `px` lives in `Button`, not
the call site). Documented conventions:
- Control padding-x: `px-2.5` (sm) / `px-3` (md) — owned by `Button`.
- Icon+label gap: `gap-1.5` (md) / `gap-1` (sm) — owned by primitives.
- Chip padding: `px-1.5 py-0.5` — owned by `Chip`.
- Section/stack gaps at call sites: prefer `gap-2` / `gap-3`; avoid
  `gap-0.5`/`gap-2.5` unless deliberate.

### 2.3 Radius rule

**Standardise on `rounded-md` (6px, = `--radius-md`). Ban bare
`rounded`.** Bare `rounded` is Tailwind's default 4px — it is **not** a
token (it coincidentally equals `--radius-sm`), which is why 216
elements sit off-token at 4px while 200 use the 6px token for identical
controls.

- Buttons, chips, inputs, selects, callouts, cards → `rounded-md`.
- `rounded-sm` (4px) allowed **only** for the tiny checkbox box (§1.5).
- `rounded-full` allowed only for avatars, dots, and (if Ken keeps it)
  the Sidebar count badge.
- **Banned:** bare `rounded`. Every current `rounded` becomes
  `rounded-md`.

### 2.4 Contrast fixes (WCAG AA) — the one cross-cutting token edit

Four tokens fail AA in both themes (responsive-theme T1/T2/T5). New
values below target **≥4.5:1 for normal text** (`text-tertiary`) and
**≥3:1 for the control boundary / non-text** (`border-subtle`,
disabled). These edit `styles/tokens.css` in **both** scopes — one
commit, its own commit, because it moves every surface at once.

| token | scope | current | target | target ratio |
|---|---|---|---|---|
| `--text-tertiary` | light | `#7B8699` | `~#5F6B7E` | ≥4.5 vs bg-surface/canvas |
| `--text-tertiary` | dark | `#6E6E75` | `~#8A8A92` | ≥4.5 vs bg-surface/canvas |
| `--status-discarded-fg` | light | `#7B8699` | deepen a notch | ≥4.5 vs its `-bg` |
| `--status-discarded-fg` | dark | `#6E6E75` | lighten a notch | ≥4.5 vs its `-bg` |
| `--priority-low` | light | `#7B8699` | `~#5F6B7E` | ≥4.5 vs bg-canvas |
| `--priority-low` | dark | `#6E6E75` | `~#8A8A92` | ≥4.5 vs bg-canvas |
| `--border-subtle` | light | `#E8ECF2` | toward `--border-default` | ≥3:1 only if used as a *visible* divider |

Notes / decisions to put to Ken:
- `text-tertiary`, `status-discarded-fg`, `priority-low` share the same
  two hexes today; fixing `text-tertiary` fixes the placeholder in
  `TextField` for free.
- `status-discarded` and `priority-low` are *deliberately* muted — the
  responsive review calls this a judgement call. **Flag for Ken**:
  raise to AA, or accept sub-AA as intentional "muted" and document it
  in `known-gaps.md`. Do not silently change semantics.
- `border-subtle` is used two ways: as a decorative hairline (fine at
  1.2:1) and as a real divider (fails). Either strengthen it (breaks the
  decorative use) or document it as decorative-only and switch the
  real-divider call sites to `border-default`. **Flag for Ken** — this
  is a semantics split, not a value tweak.
- **All new values must be re-measured** with the WCAG formula on build
  (the responsive review computed live ratios; match its method). Values
  above are starting points, not final.

### 2.5 Optional guardrail

A `tools/` grep check (or ESLint rule) in CI flagging, inside
`apps/web/src/client`: raw `<button className=`, bare `rounded` (word
boundary, not `rounded-*`), `text-white`, and `text-[` sizes. Steers new
code to the primitives so drift can't recur. **Recommend building this
alongside `Button`** — it is what keeps the migration from silently
regressing. Cheap (~1–2h as a grep script matching the existing
`tools/` pattern).

---

## 3. Migration plan

Ordered so each primitive lands, its call sites migrate, and the suite
stays green before the next starts. **Client-only** throughout (no CLI/
MCP mirror). The governing constraint: **behaviour and every
`data-testid` / accessible name are locked** by vitest component tests
and flow cases — appearance may change, behaviour and locators may not.

**Per-primitive migration recipe** (same every time):
1. Build the primitive in `ui/` with `testId`/`data-testid` + `aria-*`
   passthrough. Write its component test (render each variant/state;
   assert the state matrix — and per CLAUDE.md, **show the test fails**
   by breaking the behaviour before committing).
2. Migrate call sites **one file at a time**, replacing the hand-rolled
   element with the primitive, carrying the **exact** existing
   `data-testid` and accessible name across.
3. Run that file's existing test after each swap. **If a green test
   needs editing to pass, stop** — per CLAUDE.md that test was likely
   asserting the old classes/behaviour; a restyle should not require
   editing a *behaviour* test. Editing a test that asserted a specific
   *class string* is legitimate (appearance changed) — say so in the
   commit; editing one that asserts *behaviour* is a red flag.
4. Commit per primitive (or per small file-group), update
   `TEMP-BUILD-PLAN.md` status.

**The `cells.tsx` model:** `board/BoardCard.tsx` imports List's
renderers so both surfaces render identically. Apply the same discipline
— import the one primitive everywhere; never re-spell it — and **do not
migrate `cells.tsx` itself** (its chips carry degradation logic and are
the reuse model, not a target).

### Order and surface

| step | primitive | files that adopt it (from the reviews) |
|---|---|---|
| 0 | `icons.ts` + `cn.ts` | prerequisite; adopted lazily by each primitive |
| 1 | `Button` | the ~51 static button sites — highest concentration in `settings/*` (ReconcilePanel, GitSyncPanel, DeleteViewDialog), `create/CreateTaskModal`, `comments/CommentComposer`, `list/DeleteConfirmDialog`, `task/DeleteTaskDialog` (the 7 `text-white` sites land here) |
| 2 | `IconButton` | close buttons (Modal, dialogs), Toast dismiss, BulkBar clear, overflow triggers |
| 3 | `ToolbarButton` | `list/FilterDropdown`, `list/FilterBar` (Advanced, Show-archived shell, Save-as-view), `list/RefreshButton`, `list/ExportMenu` — preserve toolbar §4a locators |
| 4 | `Chip` | `shell/Sidebar`, `sprints/SprintsView` + `SprintMetaHeader`, `milestones/MilestonesView` + `MilestoneDetail`, `board/BoardView` count, `task/editors/LabelsField` (NOT `cells.tsx`) |
| 5 | `Checkbox` + `Radio` | 14 checkbox files + 6 radio files (form-controls §5 list) — ListView header indeterminate first (forces the API) |
| 6 | `Select` | 13 select sites (form-controls §5) — skip `OptionPicker` |
| 7 | `TextField` | ~21 input sites incl. the 3 search boxes (form-controls §5) |
| 8 | `Callout` | `timeline/TimelineView` (×3), `settings/CustomFieldsPanel`, `settings/EnumCollectionPanel` |
| 9 | `Toggle` | optional — 3 view toggles, only if Ken approves the switch look |
| — | contrast tokens (§2.4) | `styles/tokens.css` — **its own commit**, independent of the primitives; can land first or last |

**Locators that must survive verbatim** (consolidated from the reviews;
carry these across every swap): `advanced-query-toggle`; `"Show archived"`
label; `/Save as view/` button name; facet names `Filter <Label>` /
`Filter by <Label>`; `Refresh` / `Export` aria-labels + Export menu
semantics; `dsl-*`, `switch-to-basic*`, `query-warnings`, `broken-view*`;
and all form-control testids listed in §1.5. Modal/dialog close buttons
keep their existing aria-labels when routed through `IconButton`.

**Sequencing note:** §2.4 (contrast) and step 0 are independent of
everything and can land at any time. Steps 1–3 (buttons) are the biggest
visible win and unblock the toolbar fix Ken flagged. Steps 5 (form
controls) is the second thing Ken flagged. Do 0→1→2→3, then 5, then
fill in 4/6/7/8 as capacity allows; 9 last and only if approved.

---

## 4. Effort sizing

Rough, for scoping only. "Build" = component + its test (fail-shown) +
docs note. "Migrate" = swap all call sites + keep tests green. Ranges
assume familiarity with the repo conventions above.

| primitive | build | migrate (sites) | notes |
|---|---|---|---|
| `icons.ts` + `cn.ts` | 0.5h | 1h (lazy) | trivial |
| `Button` | 3–4h | 5–7h (~51+) | biggest migration; the 7 `text-white` fixes are free once swapped |
| `IconButton` | 1.5h | 2h (~15) | shares `Button` variant map |
| `ToolbarButton` | 1h | 2–3h (6, locator-sensitive) | thin preset over Button; carry §4a locators |
| `Chip` | 1.5h | 3h (~11) | watch the `rounded-full` count-badge decision |
| `Checkbox`+`Radio` | 4–5h | 4–5h (22) | appearance-none SVG tick + indeterminate ref is the fiddly part; behaviour cases must be re-verified |
| `Select` | 2h | 2h (13) | themed chevron SVG |
| `TextField` | 2h | 3h (~21) | leadingIcon slot for search boxes |
| `Callout` | 1h | 1.5h (~5) | tokens already verified |
| `Toggle` (optional) | 2h | 1h (3) | only if approved |
| contrast tokens (§2.4) | 2h | 0 (token edit) | must re-measure ratios; independent commit |
| CI guardrail (optional) | 1–2h | — | recommended with Button |

**Totals (build + migrate):**
- **Core (steps 0–8, no Toggle):** ~**48–58h** (~6–7 working days).
- **+ Toggle:** +3h. **+ CI guardrail:** +1–2h. **+ contrast tokens:**
  +2h (included above if counted).
- **Minimum viable (what Ken flagged directly):** `icons`+`cn` +
  `Button`+`IconButton`+`ToolbarButton` + `Checkbox`+`Radio` +
  contrast tokens ≈ **28–36h** — resolves the toolbar "no rhyme or
  reason", the native-checkbox complaint, the missing button states,
  the `text-white` bug, and the AA failures.

**Scope options for Ken:**
- **A — All-at-once (~6–7 days):** one focused pass, everything above.
  Best if the UI build (Phase 5) hasn't started re-touching these files.
- **B — Incremental, primitive-by-primitive:** land in the §3 order,
  each self-contained and shippable. Recommended — matches the run
  workflow (one primitive = one subsection), keeps the suite green
  throughout, and lets Ken stop after the "minimum viable" set if the
  visible complaints are resolved.
- **C — Minimum viable only (~4 days):** the flagged items, defer
  Chip/Select/TextField/Callout to when their surfaces are next touched.

---

## Open decisions to put to Ken (do not pre-decide)

1. **Toggle switch vs checkbox** for the 3 view toggles (§1.9) — look
   only; default to checkbox unless he wants switches.
2. **`rounded-full` count badge** in the Sidebar (§1.4) — keep the round
   look or fold into `rounded-md`.
3. **`text-micro` (10px) name** (§2.1) — add a fourth type name or fold
   10px into `text-meta`.
4. **`status-discarded` / `priority-low` to AA** (§2.4) — raise, or
   accept as intentional "muted" and record in `known-gaps.md`.
5. **`border-subtle` divider vs decorative** (§2.4) — strengthen the
   token, or keep it decorative and move real dividers to
   `border-default`.
6. **`className` escape hatch** on `Button` (§1.1) — omit for
   discipline, or allow for the rare one-off. Recommend omit.
7. **Scope A / B / C** above.
