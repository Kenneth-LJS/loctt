# UI review — form controls (checkboxes, radios, toggles, selects, inputs)

Read-only design review. No code was changed. Establishes a design
intent for form controls (there are **no mockups** in the repo, so this
is not matching an existing spec).

Scope: the web client (`apps/web/src/client`). The trigger was Ken
flagging that the native checkboxes look bad.

## TL;DR

- **~46 native form controls** across 24 files: 15 checkboxes, 7 radios,
  14 selects, ~21 text/number/search/date inputs (search inputs and text
  inputs already carry a repeated token class string).
- **A shared primitive is warranted** for `Checkbox`, `Radio`, and
  `Toggle` (switch), plus a thin `Select` and `TextField` to stop the
  copy-pasted class string. Checkboxes and radios are the worst
  offenders: **all 22 are raw, unstyled native controls** — no border
  token, no accent, no focus ring beyond the global `:focus-visible`, no
  consistent hit target. Only the two ListView checkboxes even set
  `accent-accent`.
- Behaviour is locked by several UI test cases (BLK-1/2/3/4, A11Y-21,
  A11Y-40, LST-10). A restyle must keep: keyboard reachability, Space to
  toggle, the header checkbox's checked-vs-indeterminate distinction,
  click-does-not-navigate on row checkboxes, and 3:1 boundary contrast in
  both themes. Appearance may change; behaviour may not.

---

## 1. Inventory

Token vocabulary (from `styles/tokens.css` + `styles/index.css`): colors
are Tailwind semantic utilities backed by CSS vars — `bg-bg-surface`,
`bg-bg-muted`, `border-border-subtle/default/strong`,
`text-text-primary/secondary/tertiary/disabled`,
`accent`/`accent-hover`/`accent-muted`/`accent-contrast`, radii
`rounded-sm/md/lg` (4/6/8px). Theme flips via `.dark` on `<html>`. Global
`:focus-visible { outline: 2px solid var(--text-primary); outline-offset:
2px }` already applies to every control.

There is **no shared form primitive**. `ui/` has `Modal`, `Menu`,
`Toast`, `UserAvatar`, `Announcer`, `ErrorState`, `useFocusTrap` — but no
`Button`, `Checkbox`, `Radio`, `Toggle`, `Select`, or `TextField`.

### 1a. Checkboxes (15) — all raw native

| File:line | Renders | Styling on the `<input>` |
|---|---|---|
| `list/ListView.tsx:586` | header "select all", **needs indeterminate** | *(none on input)* — indeterminate set via `ref` |
| `list/ListView.tsx:731` | per-row select | `cursor-pointer align-middle accent-accent` |
| `list/FilterBar.tsx:225` | "Show archived" toggle | *(none)* |
| `milestones/MilestonesView.tsx:109` | "Show archived (N)" toggle | *(none)* |
| `timeline/TimelineView.tsx:717` | "Dependencies" arrows toggle (disabled-able) | *(none)* |
| `init/InitWizard.tsx:236` | "Skip the starter docs" | `mt-0.5` |
| `settings/EstimationPanel.tsx:62` | "Enabled" | *(none)* |
| `settings/RelationshipsSettingsPanel.tsx:211` | "symmetric" | *(none)* |
| `settings/RelationshipsSettingsPanel.tsx:238` | "ranked" | *(none)* |
| `settings/CustomFieldsPanel.tsx:216` | "multi" (always disabled) | *(none)* |
| `settings/CustomFieldsPanel.tsx:227` | "searchable" | *(none)* |
| `task/editors/CustomFields.tsx:139` | boolean custom field editor | *(none)* |
| `create/CreateTaskModal.tsx:643` | "Create another" | *(none)* |
| `create/CreateTaskModal.tsx:1103` | boolean custom field in create | *(none)* |

Every checkbox is wrapped in a `<label className="flex items-center gap-1
… text-text-secondary">` (or `items-start` + `mt-0.5` where the label
wraps). Label association is fine — the input is a child of the `<label>`
everywhere except `InitWizard` which uses `htmlFor`/`id`.

### 1b. Radios (7) — all raw native

| File:line | Renders | Styling |
|---|---|---|
| `settings/BackupPanel.tsx:155` | restore mode (bare/merge/overwrite) | `mt-0.5` |
| `settings/RemapDeleteDialog.tsx:84` | remap vs delete choice | *(none)* |
| `settings/RemapDeleteDialog.tsx:99` | second choice | *(none)* |
| `settings/EnumCollectionPanel.tsx:317` | "default status" per row | *(none)* |
| `settings/UserDeleteDialog.tsx:126` | reassign vs unassign | *(none)* |
| `settings/UserDeleteDialog.tsx:139` | second choice | *(none)* |
| `editor/BodyConflictDialog.tsx:175` | mine/theirs/both | `mt-1` |

### 1c. Selects (14) — styled but inconsistent

These carry a border+surface class but the string drifts. Two variants
seen:

- `rounded-md border border-border-default bg-bg-surface px-1 text-[12px]`
  with an explicit `h-7` (e.g. `RelationshipsSettingsPanel.tsx:222`).
- `rounded border border-border-subtle bg-bg-surface px-2 py-1 text-[13px]`
  (e.g. `ReconcilePanel.tsx:418`).

Files: `RelationshipsSettingsPanel:222`, `EstimationPanel:78`,
`PreferencesPanel:162`, `ReconcilePanel:418`, `CalendarPanel:125,156`,
`EnumCollectionPanel:287`, `DeleteProjectDialog:79`,
`CustomFieldsPanel:202`, `TimelineView:700`, `SprintMetaHeader:196`,
`LinkPicker:116`, `MoveTaskDialog:67`. (`OptionPicker.tsx` deliberately
does **not** use a `<select>` — it is a custom listbox; leave it alone.)

Border token varies (`border-default` vs `border-subtle`), radius
varies (`rounded` vs `rounded-md`), text size varies (`12` vs `13`), and
none sets an explicit focus style beyond the global ring. No custom
chevron — the native OS arrow shows, which does not pick up the dark
theme cleanly.

### 1d. Text / number / search / date inputs (~21) — a copy-pasted class

The dominant string, repeated verbatim in `CreateTaskModal` (4×),
`TextField`, and the confirm dialogs:

```
rounded border border-border-default bg-bg-surface px-2 py-1.5 text-[13px] text-text-primary
```

Search inputs (`Sidebar:477`, `Header:120`, `FilterDropdown:96`) use a
richer, better variant that is worth promoting to the primitive:

```
h-7 rounded-md border border-border-default bg-bg-surface px-2 text-[12px]
text-text-primary placeholder:text-text-tertiary
focus:border-accent focus:outline-2 focus:outline-accent
```

Confirm-to-type inputs (`DeleteConfirmDialog:102`,
`DeleteTaskDialog:103`, `UserDeleteDialog:171`, `BackupPanel:188`) and
`ReconcilePanel:436`, `LabelsField:193`, `CustomFieldsPanel:272`
(`type="number"`) round out the set.

---

## 2. Concrete visual problems

1. **Native checkboxes/radios ignore the design system entirely.** 13 of
   15 checkboxes and all 7 radios have zero styling. On the dark theme
   (`bg-canvas #0B0B0C`, `bg-surface #141416`) the OS default control is
   a light-grey box with the OS-blue check — it does not read as part of
   a near-black surface and does not use the app accent
   (`#818CF8` dark / `#4F46E5` light). This is the specific thing Ken
   flagged. Files: every entry in 1a/1b except `ListView:731`.

2. **Accent is applied in exactly one place.** Only
   `ListView.tsx:600,740` set `accent-accent` (the Tailwind
   `accent-color` utility). The header select-all checkbox at
   `ListView:586` does **not**, so within the same table the checked
   fill color of the header differs from the rows. This is a visible
   inconsistency in the most-used view.

3. **Alignment is patched ad hoc.** Vertical alignment is fixed with
   `mt-0.5` (InitWizard, BackupPanel), `mt-1` (BodyConflictDialog),
   `align-middle` (ListView), or nothing at all. Native control height is
   UA-dependent, so labels sit differently across panels.

4. **Focus ring is inconsistent.** Most controls rely only on the global
   `:focus-visible` outline (`2px solid text-primary`). Selects/inputs in
   the sidebar/header additionally set `focus:border-accent
   focus:outline-2 focus:outline-accent`, so the same conceptual "field
   focused" state looks different in different views.

5. **Hit target is the raw ~13-16px native box.** Rows in ListView, the
   settings toggles, and the dense settings rows give a small pointer
   target and no padded hover affordance. (A11Y does not mandate 44px
   here, but the target is smaller than everything else in those rows.)

6. **Selects show the native OS chevron** and inherit UA select
   rendering, which does not match the app's rounded/token language and
   looks off in dark mode.

7. **Class-string drift.** The text-input class is copy-pasted ~7×; the
   select class exists in two token variants. Any future token change
   (e.g. default border) has to be hunted across files.

---

## 3. Proposed shared primitives

Put these in `apps/web/src/client/ui/`. Keep them thin, controlled,
prop-forwarding wrappers over the native element (native = free
keyboard/AT behaviour, which the locked cases depend on — see §4).
Restyle appearance only; do not reimplement semantics.

### 3.1 `Checkbox`

Two viable approaches. **Recommended: styled native input via
`appearance-none`** — keeps the real `<input type="checkbox">` (so
Space, focus, `indeterminate`, form semantics, and the BLK cases all keep
working) and paints the box with utilities.

```
// <input type="checkbox"> base classes
appearance-none shrink-0 h-4 w-4 rounded-sm
border border-border-strong bg-bg-surface
cursor-pointer transition-colors
// checked
checked:bg-accent checked:border-accent
// the tick: a background SVG (accent-contrast stroke) shown only when checked/indeterminate
// disabled
disabled:cursor-not-allowed disabled:border-border-default disabled:bg-bg-muted
// focus — rely on global :focus-visible OR make it explicit & consistent:
focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text-primary
```

States and the exact look:

| State | Box | Border | Mark |
|---|---|---|---|
| default (unchecked) | `bg-bg-surface` | `border-border-strong` (needs 3:1 — see A11Y-40) | none |
| hover | `bg-bg-muted-hover` | `border-strong` | none |
| checked | `bg-accent` | `border-accent` | ✓ in `accent-contrast` |
| indeterminate | `bg-accent` | `border-accent` | — dash in `accent-contrast` |
| disabled | `bg-bg-muted` | `border-border-default` | dimmed mark if checked |
| focus (keyboard) | ring: `outline 2px text-primary, offset 2px` | — | — |

Props: `checked: boolean`, `indeterminate?: boolean` (set on the DOM node
via `ref` in a `useEffect`/callback ref — the pattern already at
`ListView:586`), `onChange`, `disabled`, `aria-label` / labelled by a
wrapping `<label>`, plus `data-testid` passthrough (tests rely on these).
`id` for `htmlFor` association when not wrapped.

**Indeterminate is required** for the ListView header ("select all")
checkbox. Expose it as a prop and set `el.indeterminate` internally so
callers stop hand-rolling the ref.

*Alternative* (SVG-overlay: a visually-hidden native input + a painted
box) is more flexible for the tick but adds markup; not needed given
`appearance-none` + background-SVG covers indeterminate too.

### 3.2 `Radio`

Same approach as `Checkbox` but `rounded-full` and a dot instead of a
tick. Native `<input type="radio">` with `name` grouping preserved (the
7 radios all rely on `name` for group behaviour — keep it a prop).

```
appearance-none shrink-0 h-4 w-4 rounded-full
border border-border-strong bg-bg-surface cursor-pointer
checked:border-accent checked:border-[5px]   // inner dot via thick accent border, or a ::after dot in accent
disabled:cursor-not-allowed disabled:bg-bg-muted disabled:border-border-default
```

### 3.3 `Toggle` (switch) — optional but recommended

The "Show archived" / "Dependencies" / "Enabled" controls are
conceptually switches, not checkboxes. **But** A11Y-21 and BLK behaviour
assume the checkbox role/announcement. Two options:

- **Keep them as `Checkbox`** (simplest; A11Y-21 explicitly allows "a
  toggle rendered as a checkbox announces checked"). Safe default.
- **Introduce a `Toggle`** styled as a switch but still using
  `<input type="checkbox" role="switch">` so it announces
  checked/on-off. Only adopt for the "Show archived"-style view toggles,
  not for form-field booleans (Estimation "Enabled", custom-field
  booleans) which should stay checkboxes.

Recommendation: ship `Checkbox` first; add `Toggle` as a follow-up for
the ~3 view toggles (`FilterBar` archived, `MilestonesView` archived,
`TimelineView` dependencies) if Ken wants the switch look. A11Y-21 is
satisfied either way as long as `role="switch"` is set when it looks like
a switch.

Switch spec (if built): track `h-4 w-7 rounded-full bg-border-strong`,
`checked:bg-accent`; thumb `h-3 w-3 rounded-full bg-accent-contrast`
translating on check; same focus ring.

### 3.4 `Select`

Thin wrapper standardising the drifting class + a themed chevron.

```
appearance-none h-8 rounded-md border border-border-default bg-bg-surface
px-2 pr-7 text-[13px] text-text-primary cursor-pointer
focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text-primary
// chevron: background-image SVG in text-tertiary, positioned right
disabled:cursor-not-allowed disabled:bg-bg-muted disabled:text-text-disabled
```

Passes through `value`, `onChange`, `disabled`, `aria-label` /
`aria-labelledby`, `data-testid`, and children (`<option>`s). Pick one
border token (`border-default`), one radius (`rounded-md`), one size —
and let dense callers opt into a `size="sm"` (`h-7 text-[12px]`).

### 3.5 `TextField`

Standardise the copy-pasted string. Promote the *search-input* focus
treatment (`focus:border-accent`) into the default so all inputs focus
alike.

```
w-full rounded-md border border-border-default bg-bg-surface
px-2.5 py-1.5 text-[13px] text-text-primary placeholder:text-text-tertiary
focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text-primary
disabled:bg-bg-muted disabled:text-text-disabled
```

Support `type` (text/number/search/date), an optional leading icon slot
(for the search boxes), and error state (`aria-invalid` →
`border-danger-fg`). Passthrough `data-testid`, `aria-*`, `ref`.

### Contrast note (from A11Y-40)

The unchecked box **border** and the switch **track** are the "checkbox
and toggle boundaries" A11Y-40 requires to meet 3:1 against their
background. `border-border-strong` (`#A7B1C2` light / `#43434A` dark) is
the right token for the resting border — verify 3:1 vs `bg-surface`
before shipping; `border-default`/`border-subtle` are too faint for the
control outline and would fail. Checked state uses `accent` fill with an
`accent-contrast` mark (already high-contrast by design).

---

## 4. Behaviour cases the restyle must NOT break

Appearance changes are free; these lock **behaviour/semantics**. Keep the
native `<input>` element and its keyboard/AT behaviour.

| Case | File | Locked behaviour |
|---|---|---|
| **BLK-1** (`flow-bulk.md:22`) | row checkbox | Keyboard-reachable (Tab), Space toggles, click selects one row and **does not navigate** to detail. The `onClick={e => e.stopPropagation()}` at `ListView:735` is load-bearing — keep it. |
| **BLK-2** (`flow-bulk.md:36`) | selection | Selection state survives; checkbox reflects it. |
| **BLK-3** (`flow-bulk.md:48`) | header checkbox | Selects the 50 rendered rows; when all visible are selected the header is **checked, not indeterminate**; `indeterminate` only while partial. The `ref` at `ListView:586` sets this — the `Checkbox` primitive must expose an `indeterminate` prop and keep this distinction. |
| **BLK-4** (`flow-bulk.md:60`) | "select all N matching" | Is a **separate control**, never a side effect of the header checkbox. Do not merge them when refactoring. |
| **A11Y-21** (`flow-accessibility.md:173`) | all toggles | Each announces pressed/expanded/**checked** and updates on toggle. A checkbox-rendered toggle must announce `checked`; a switch-rendered one needs `role="switch"`. Do not drop the native input for a `<div>`. |
| **A11Y-40** (`flow-accessibility.md:317`) | contrast | Checkbox/toggle **boundaries meet 3:1** in both themes; disabled controls distinguishable by more than opacity (A11Y-31). Drives the border-token choice in §3. |
| **LST-10** (`flow-list.md:144`, see `:154`) | filter dropdown checkboxes | The chip row and dropdown checkboxes stay in sync — behaviour, not styling; a restyle of `FilterDropdown` checkboxes must not touch the sync logic. |

Also preserve every `data-testid` (integration/e2e tests select by them:
`estimation-enabled`, `create-another`, `milestones-show-archived`,
`timeline-arrows`, `backup-mode-*`, `statuses-default-*`,
`custom-field-searchable-*`, `relationship-symmetric-*`, `meta-input-*`,
etc.) — the primitives must pass `data-testid` through to the underlying
`<input>`.

---

## 5. Migration list (files that adopt the primitives)

**Checkbox** (15 controls, 14 files): `list/ListView.tsx` (×2, incl.
indeterminate header), `list/FilterBar.tsx`, `milestones/MilestonesView.tsx`,
`timeline/TimelineView.tsx`, `init/InitWizard.tsx`,
`settings/EstimationPanel.tsx`, `settings/RelationshipsSettingsPanel.tsx` (×2),
`settings/CustomFieldsPanel.tsx` (×2), `task/editors/CustomFields.tsx`,
`create/CreateTaskModal.tsx` (×2).

**Radio** (7): `settings/BackupPanel.tsx`,
`settings/RemapDeleteDialog.tsx` (×2), `settings/EnumCollectionPanel.tsx`,
`settings/UserDeleteDialog.tsx` (×2), `editor/BodyConflictDialog.tsx`.

**Select** (13): `RelationshipsSettingsPanel`, `EstimationPanel`,
`PreferencesPanel`, `ReconcilePanel`, `CalendarPanel` (×2),
`EnumCollectionPanel`, `DeleteProjectDialog`, `CustomFieldsPanel`,
`TimelineView`, `SprintMetaHeader`, `LinkPicker`, `MoveTaskDialog`.
(Skip `task/editors/OptionPicker.tsx` — deliberately not a `<select>`.)

**TextField** (~21): `create/CreateTaskModal.tsx` (×4), `task/editors/TextField.tsx`,
`settings/ReconcilePanel.tsx`, `settings/BackupPanel.tsx`,
`settings/UserDeleteDialog.tsx`, `settings/CustomFieldsPanel.tsx` (number),
`task/editors/LabelsField.tsx`, `list/DeleteConfirmDialog.tsx`,
`task/DeleteTaskDialog.tsx`, plus the search variant in
`shell/Sidebar.tsx`, `shell/Header.tsx`, `list/FilterDropdown.tsx`.

**Suggested order:** `Checkbox` first (highest visual payoff, addresses
Ken's flag, and the ListView indeterminate case forces the API to be
right) → `Radio` (same technique) → `Select` (kills the two-variant
drift) → `TextField` (kills the copy-paste) → optional `Toggle` for the 3
view toggles.

Per CLAUDE.md: adding a `ui/` primitive is a client-only change (no core
capability), so no CLI/MCP mirror is required — but any behaviour case
touched during migration must be re-verified against §4, and a green test
edited during migration is suspect (see the testing rules).
