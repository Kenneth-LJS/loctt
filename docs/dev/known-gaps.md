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

## `data-value` assertions are weaker than the `.value` reads they replaced

K106 step 1 migrated 18 native `<select>` call sites onto
`SelectCombobox`, which meant porting ~16 test assertions from
`getByTestId<HTMLSelectElement>(…).value` to a `data-value` attribute.

**The two are not equivalent, and the difference is silent.** A native
`<select>`'s `.value` could only ever report a value that had a matching
`<option>` — the DOM guaranteed it. `data-value` echoes the component's
draft state, so it reports the stored token whether or not that option is
actually offered to the user. Every ported assertion therefore still
passes while testing strictly less than it used to.

This was caught because three "escape hatch" branches — which keep a
stored-but-unknown value selectable — could each be DELETED with the
suite staying green: `TimelinePanel`'s dangling dependency (A31/TML-34),
`ViewFormDialog`'s removed custom field, and `QueryBuilder`'s
out-of-config field. Two of the three had never been covered at all; that
gap predates K106 and the migration merely exposed it.

All three now assert the option is **offered** (`comboOptions()`) and not
merely echoed (`comboValue()`), and are red-proven.

**The gap that remains:** nothing enforces this pairing. `data-value` is
now the standard assertion across the web client, so any future
`Select`→`Combobox` port — or any new `SelectCombobox` call site with an
escape-hatch branch — can reintroduce exactly this weakening without a
single test going red. **Rule of thumb: a `comboValue()` assertion about
a stored-but-possibly-unknown value is incomplete without a
`comboOptions()` assertion beside it.** A lint rule or a shared helper
that asserts both at once would close it properly; neither exists yet.

## Case coverage: 19 uncovered cases and 6 tags naming a case that does not exist

`npm run cases:coverage` reports, as of 2026-09-21:

```
coverage: 1038/1057 cases tagged by 2206 @verifies tag(s).
uncovered: 19
✗ 6 @verifies tag(s) name a case that does not exist → CONFIG-5
```

**The six bad tags are all `CONFIG-5`**, in `PreferencesPanel.test.tsx`,
`ProjectsPanel.test.tsx`, `Header.test.tsx` (×2) and
`ShortcutHelpDialog.test.tsx` (×2). They come from commit `ffa0a36c`
("Config discoverability… (CONFIG-5)"), which shipped the tests and the
behaviour but never added `CONFIG-5` to `tests/cases/`. The tests are
real and passing; only the case they point at is missing. Either write
the case or retag them — do not delete the tags, which would drop the
only record of what that work verified.

**The 19 uncovered cases** cluster in three pre-existing areas, none of
them this session's work:
- *Schema migration* (blocker): SET-15, SET-31, SET-37, XS-36, XS-48 —
  the migrate button, the in-progress sentinel, a partway failure, and
  writes during a migration.
- *Timeline M4* (major): TML-51…TML-59 — the unscheduled drawer, the
  sticky name gutter, the mounted filter bar, cross-view filter scope,
  the searchable group-by picker.
- *Assorted* : ERR-32 (audit: no routine failure hits the generic
  handler), ERR-23, VUE-12 (editing a built-in pre-populates its DSL),
  XS-3 (a discoverable manual refresh).

Recorded so the number is a known quantity rather than a surprise.

**Correction (2026-09-21):** an earlier version of this paragraph cited
VUE-42's "two tagged tests" as evidence the case is covered. Both tests
assert only that Save is DISABLED before the confirmation is ticked;
NEITHER ticks it and asserts the outcome. The case's live half — a
confirmed replace actually works — is untested, and had it been tested it
would have caught `K102-broken-repair` (a broken view cannot be repaired
or deleted by any surface) before it was recorded as BUILT. A tagged test
is not the same as a covering one, and a coverage tool counts tags.

**CLOSED (2026-09-22) by the `K102-broken-repair` build.** The live half
is now covered at every layer, and each test asserts the OUTCOME — the
bytes of `queries.yaml` — rather than a control's disabled state:
`packages/core/src/views/manage.test.ts`,
`apps/cli/src/commands/views.test.ts`,
`apps/mcp/src/tools/views.test.ts`,
`apps/web/src/server/server.view-broken-repair.test.ts`, and the amended
`Sidebar.test.tsx` case, which now asserts the PUT body carries
`replaceBroken: true`. The prediction above was exactly right: the
existing sidebar test ticked the box, asserted a body of
`{name, filters: []}`, and stayed green while the server rejected that
body with a 400.

## A failed workflow load silently REMOVES every custom-field filter from the toolbar

Found by a PM audit of the new surfaces (2026-09-21), confirmed by
attempting a fix and discovering the cause is a layer deeper than it
looks.

**Symptom.** If `/api/workflow` fails or has not resolved, every
custom-field enum filter vanishes from the filter bar. The user is told
nothing. This is the F4/ERR-1 conflation the codebase fixes carefully for
the BUILT-IN facets — `FilterBar.tsx` builds a `failedFacets` set and
passes `unavailable` so the facet renders with "options could not be
loaded" — reintroduced for the custom-field half.

**Why the obvious fix does not work.** The custom-field branch of
`renderFilterControl` does `customFields.find(...)` and `return null` when
the field is absent, so passing `unavailable` there looks like a
two-line change. It is not: `resolveVisibleFilters`
(`list/visibleFilters.ts:112-135`) **filters the visible set to the
catalog first**, and the catalog is derived from the workflow config. A
failed load means an empty catalog, so the filter id is dropped BEFORE
the render branch is ever reached. A fix attempted at the render layer
produced a test that could not pass, because nothing reaches it.

**What a real fix has to decide.** `resolveVisibleFilters` deliberately
drops ids that name a since-removed custom field — that is documented and
correct. Distinguishing "this field was deleted" from "the config could
not be read" means giving that function a load-state signal and a third
outcome, which changes a documented behaviour used by every filter-bar
consumer. That is a design call, not a patch.

**Severity: no data risk, user-facing confusion only.** Nothing is
written or lost; a filter silently disappears from the toolbar and reads
as "the field is gone". Left unfixed deliberately rather than
half-fixed — an attempted render-layer patch was reverted.

## `runDoctorStream`'s streaming test is load-sensitive and flakes under a busy machine

Observed 2026-09-22 while verifying `K102-broken-repair`. Not introduced
by that change, and not a product defect — a test-harness timing gap.

**Symptom.** `packages/core/src/diagnostics/diagnostics.test.ts` →
"resolves its first check before the whole run's I/O has finished" fails
with `expected [ 'timer', 'first-check' ] to deeply equal
[ 'first-check', 'timer' ]`. It failed on three consecutive full-suite
runs while the machine was busy, then passed on the next three, and
passes every time the file is run alone.

**Why.** The test asserts an ORDERING between a `setTimeout(..., 0)`
macrotask and the first `await it.next()`. That holds only while the
first pull resolves within the current tick. Under load the event loop
can service the timer first even though the producer is still correctly
streaming — so the failure says "this machine was busy", not "the
producer batched". The property under test (the first check arrives
before the whole run's I/O) is real and worth covering; the *clock* is
the wrong instrument for it.

**Ruled out as the cause:** the views change. With the new
`manage.test.ts` reverted but the new `manage.ts` in place, the suite is
green; with 13 filler tests standing in for the new ones, also green. The
failures did not correlate with the new code or with test count.

**What a real fix has to decide.** Either make the producer's streaming
observable without wall-clock ordering (e.g. a counter of checks
completed at the moment the first `next()` resolves), or drop the
ordering assertion and keep the `.loctt directory`-comes-first
assertion, which is deterministic. Both change what the test proves, so
it is a call about the assertion, not a patch.

**Severity: no product risk.** A false red in CI only.

## `diagnostics.test.ts` ordering assertion is load-sensitive (false red)

`packages/core/src/diagnostics/diagnostics.test.ts` → "resolves its first
check before the whole run's I/O has finished" failed on three
consecutive full-suite runs during K102-broken-repair, then passed on six
consecutive runs afterwards.

The agent that hit it ruled out its own change by bisection: the new
`manage.ts` with the ORIGINAL tests was green; 13 filler tests standing
in for the new ones were green; the real new tests were green on six
subsequent runs.

**Cause:** the test asserts an ordering between a `setTimeout(0)` and a
microtask, which is not guaranteed when the machine is busy — adding any
runtime anywhere in the suite can flip it. It is a pre-existing
false-red, not a product defect.

**What a real fix must decide:** whether the property under test ("the
first check resolves before the whole run's I/O completes") should be
asserted against a deterministic scheduler/fake timers, or whether the
guarantee itself is too weak to pin and the test should assert something
coarser. Left as-is rather than silently loosened.

Recorded rather than dismissed, because a test that fails under load and
passes when idle is indistinguishable from a real intermittent bug until
someone does the bisection.

## E2E-surfaced app defects (2026-09-22) — found while repairing the specs after K106

Repairing the e2e specs after the `<select>`→picker migration took the
suite from **155 failed** to **19**. The remaining failures were left RED
on purpose: they are app defects, not migration artifacts, and weakening
the tests to go green would have destroyed the only signal.

**VERIFIED BY ME directly against the running app or the source:**

- **MSL-25 — archived milestones are unreachable from the milestones
  view.** `api/hooks/useMilestoneProgress.ts:61` requests
  `/api/milestones?progress=true&limit=…` with **no `archived` param**,
  while every other K107 config hook passes `archived=all`. So
  `archivedCount` is always 0, `MilestonesView.tsx:212` never renders the
  reveal control, and there is no route to them. Confirmed by reading the
  hook. One-line fix.
- **TSK-59 — opening the block-type dropdown tears down the description
  editor. CAUSED BY THIS SESSION'S K106 WORK.** `BodyEditor`'s
  `onWrapperBlur` guard is
  `e.currentTarget.contains(e.relatedTarget)` (`BodyEditor.tsx:286-287`)
  — confirmed still present. K106 step 2 portals the dropdown panel to
  `document.body`, so focus moving into it is no longer "within the
  wrapper" and the editor collapses to the read view. **This is a
  regression we introduced**, and the portal migration's blast radius was
  wider than the dropdown call sites.

**SINCE VERIFIED AND FIXED:**
- **A11Y-31 / PRU-26 / PRU-33** — confirmed: `MenuItem` had no `disabled`
  prop at all, and `RowActions` faked it by dropping `onSelect` and
  dimming, leaving the button focusable with its reason on an inner
  `<span>`. Now a native `disabled` (so the IDL property and implicit
  `aria-disabled` come for free), excluded from roving focus by the
  existing `:not([disabled])` query, reason on the button itself.
- **SET-8** — confirmed structurally: `Modal`'s panel had no `max-h` and
  no scroll region, and the overlay centres an over-tall card so both
  ends leave the viewport with nothing to scroll. `Sheet` (the mobile
  branch) already had the right pattern, so `Modal` was converged on it
  rather than growing a second one.

**A SECOND CLAIM CHECKED AND FOUND WRONG — A11Y-16.** Reported as an
invisible focus ring on the header's New-task button (1.00:1 light,
1.07:1 dark), diagnosed as the `:focus-visible` rule falling back to
`currentColor`. It does not reproduce. Driving a real Chromium against
the built CSS with the button's actual classes, focused by keyboard so
`:focus-visible` genuinely matches: **16.14:1 in light, 19.67:1 in
dark.** The original reading of `rgb(255,255,255)` was taken in DARK
mode, where `--text-primary` IS `#F4F4F3` — so a near-white outline is
the rule working, not a fallback, and it only *looked* like `currentColor`
because the button's text is also white. Verified independently:
`tokens.css` sets `--text-primary: #0F172A` light / `#F4F4F3` dark.
Additionally the A11Y-16 e2e test scans `main`/`aside` only — the header
is not in its scope, so this button could not have been failing it. **No
CSS was changed.** If A11Y-16 is genuinely red, the cause is a control
inside `main`/`aside` and needs re-diagnosis.

**STILL UNVERIFIED** (being worked, or not yet checked): TSK-18
(rich→raw toggle swallowed after typing), A11Y-9 (back-navigation does
not restore row focus), LST-20 (400-char title overflows the table),
GIT-9 (ULID tiebreak not stated).

*Two of ten reported defects have now turned out not to reproduce
(VUE-22, A11Y-16). A confidently-reported defect with a file:line and a
measurement is still a claim, not a fact.*

**ONE CLAIM CHECKED AND FOUND WRONG.** The agent reported VUE-22 as
"dead code — `/api/views` returns a flat `{queries: […]}` so
`views.data?.broken` is always `undefined`, and a broken view renders as
a normal healthy link". **It does not.** `handleListViews` does
`json(res, { ...cfg, queries: … })`, which spreads `broken`; `ViewsConfig`
declares it; and a live probe against a tracker with a hand-broken entry
returned `broken: ["Busted"]` alongside `queries: ["recent-open"]`.
Recorded because it is a reminder that a confidently-reported defect is a
claim, not a fact — the other seven above are still unverified for
exactly this reason.

**Pre-existing flakes, pass on re-run:** SPR-6 (the spec's own helper
documents the race), BLK-24, BRD-4, GIT-12, NEW-10.

## The e2e suite is not trustworthy at its configured worker count

The same tree produced **56** failures at the configured 5 workers, **23**
at 3 workers, and passes the affected files clean at 1–2. Each worker
boots a real `loctt ui` server plus a browser, and whole files the spec
work never touched (`flow-git-*`, `flow-task-failure`) fail under that
contention.

`playwright.config.ts` sets `retries: 0` with the comment "a flaky gate
teaches the agent to re-run instead of fix" — the intent is right, but
**the gate is currently not trustworthy at its own default
concurrency**, which teaches the same lesson by a different route. Either
the worker count comes down or the per-worker cost does.
