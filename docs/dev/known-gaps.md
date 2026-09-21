# Known gaps

Defects and documentation holes that are real, understood, and not yet
fixed. Each says what is wrong, where the fix belongs, and how to
reproduce it, so it can be picked up without rediscovering it.

This file is not a feature backlog, and not a place for things that
merely might be wrong. **Check here before reporting a defect as new**,
and delete an entry the moment it is fixed.

## Code defects

### `@verifies CONFIG-5` tags a case that does not exist — coverage gate red

Four test files — `PreferencesPanel.test.tsx`, `ProjectsPanel.test.tsx`,
`Header.test.tsx`, `ShortcutHelpDialog.test.tsx` — carry `@verifies
CONFIG-5` tags, but no `CONFIG-5` case exists in `tests/cases/`, so
`npm run cases:coverage` fails ("tag names a case not in the index").
Pre-existing (CONFIG-5 was absent from the index before the docs move
too). Fix: either author the CONFIG-5 acceptance case (the config-
discoverability work these tests cover) in the right flow doc and
regenerate the index, or drop the tags if the behaviour is covered by an
existing case ID. Reproduce: `npm run cases:coverage`.

### A211 · Value pickers over growable sets still on native `Select`/radio/pill controls

A211 standardised the searchable picker (`ui/Combobox`) and migrated the
task meta fields, the labels editor and the query builder's value
controls. Subsequent waves (A218, A241, and A211/A242 on 2026-09-20)
converted the rest of the roster. **The value-picker roster is now
complete** — every growable-set picker is a `Combobox`; the one
remaining item (`list/FilterDropdown.tsx`) is a *different model*
(`Menu`/`menuitemcheckbox`), searchable already, and is tracked as a
model-parity nicety rather than an unsearchable-set defect:

- `list/FilterDropdown.tsx` — searchable already (≥12), but on the
  `Menu`/`menuitemcheckbox` model rather than `Combobox`; its option
  lists are the 1000-capped sidebar fetches, not `?q=`.

**To fix:** swap for `Combobox` (`ComboboxButton` trigger, keep the
testid on the trigger) and update the named specs from `selectOption` to
click-trigger → click-option.

## Editor / description surface (2026-09-19 review)

The `.prose-body` typography root cause is fixed (it is now defined in
`styles/index.css`). The following data-loss and correctness bugs in the
body editor are **not** fixed and were verified from source + Node
round-trips:

- **Escape while the conflict dialog or mention menu is open discards
  unsaved text.** `BodyEditor.tsx`'s window-level Escape listener cancels
  the whole edit; the dialog/menu do not `stopPropagation`. TSK-48 /
  XS-12 are meant to protect exactly this.
- ~~**Failed save + in-app navigation loses text.** The unmount flush only
  fires with a pending idle timer, and `hasUnsavedWork` has no consumer
  (`useBodyAutosave.ts`).~~ **FIXED (A246, 2026-09-20).** Unmount flush now
  fires on dirty-or-failed (not just a pending timer); a router blocker
  (`useUnsavedGuard`, wrapping TanStack `useBlocker`) flushes on in-app nav
  and keeps the editor mounted with its failed/conflict UI on a refused
  write. Extends K96 to the in-app-nav exit.
- ~~**Rendered description is `role="button"` wrapping links** — invalid
  nested interactives, content invisible to a screen reader (an a11y
  regression against the AA posture).~~ **FIXED (A247, 2026-09-20).** The
  read view is now a plain content region (links/images reachable) plus an
  explicit keyboard-accessible "Edit" button; the empty placeholder is a
  real button. TSK-69 click-anywhere-to-edit superseded.

The exit-gesture ruling has landed: Ken chose (A) — keep autosave;
Escape / Cmd+Enter / "Done" all exit-keeping, "cancel" dropped (K96) —
and the a11y restructure (content region + explicit Edit button) is
recorded as A247.

## Mobile / responsive (2026-09-19 live-UI review)

A responsive pass (GROUPS A/B/C) landed, and a subsequent full live-UI
review at 1440 + 390 found the desktop close to publish-ready but mobile
still blocked. Open items:

- **Mobile blockers:** the task-detail metadata panel renders at the
  **bottom** (below comments), so Status/Assignee are unreachable on a
  phone (`TaskDetail.tsx` grid order — a cheap `order-first
  lg:order-none`); the List Export button is clipped off-screen and the
  DSL panel wraps one word per line (needs `min-width:0` + overflow on
  the advanced surface); ~~the sidebar collapses to a rail of emoji/dots with no tooltips~~
  **(#9 dot-rail resolved, A251: narrow viewports now render no persistent
  rail — drawer-only nav; the tooltip/label part was already fixed)**;
  the mobile drawer covers its own toggle with no scrim/focus-trap/close
  and is not a `dialog`.
- **Desktop major:** the bulk-actions bar renders inline
  below a 25-row table (off-screen) rather than sticky; the query
  builder/DSL shows a parser error before any input and is unstyled.
- **Icon migration missed surfaces (A208 was incomplete):** the header
  theme switcher (`☀ ☾ ◑` ASCII), sidebar saved-filter icons, board
  visibility chips and the `⛔ Blocked` badge (red clashes with
  Critical-priority red), the `+ text` prefixes, and the query-builder
  `×`. Keep ★ (ruled) and ⚠.
- **Consistency debt:** ~~several control heights in one viewport~~
  **(meta-panel editors normalized to `min-h-7`, A250)**; Settings
  has four create patterns and two row-action patterns across sibling
  sections; ~~tap targets below the WCAG 2.5.8 24px minimum (and 44px
  touch) on checkboxes, ×-removes, chips and metadata editors~~
  **(#15 resolved, A250: `Checkbox` primitive + label/custom ×-removes now
  meet the 24px minimum; the 44px touch-ideal and any remaining Settings
  chips are not yet swept)**.

The app-shell navigation drawer ("mobile drawer covers its own toggle"
above) is distinct from the timeline's phone drawer, which is the shared
`Sheet` (`role="dialog" aria-modal`, focus-trap, inert background,
Escape / backdrop close) and has no outstanding mobile blocker.

## K107 web tri-state: SprintsView board still uses a boolean toggle

K107 made `archived` a tri-state scope and the web surface adopted a
shared `ArchivedScopeControl` on the task FilterBar, all six settings
panels, and the Milestones **view**. The Sprints **view**
(`apps/web/src/client/sprints/SprintsView.tsx`) was deliberately left on
its boolean `showArchived` toggle: it is a board of sprint columns, and
`deriveSprintColumns` (`sprints/columns.ts`) takes a boolean
`showArchived` — a tri-state "archived-only" state has no sensible board
rendering (it would hide every active column). Converting it would mean
either changing `columns.ts`' contract and its tests or faking a
scope→boolean mapping that drops the third state. Left as a known
inconsistency; the sprint board still defaults to hiding archived
(active), which honours K107's default. If a genuine "archived-only"
sprint board is ever wanted, `deriveSprintColumns` needs an
`ArchivedScope` option and the view needs the shared control.
