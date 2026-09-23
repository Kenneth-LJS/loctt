# Known gaps

Defects and documentation holes that are real, understood, and not yet
fixed. Each says what is wrong, where the fix belongs, and how to
reproduce it, so it can be picked up without rediscovering it.

This file is not a feature backlog, and not a place for things that
merely might be wrong. **Check here before reporting a defect as new**,
and delete an entry the moment it is fixed.

## Code defects

### `GET /api/views` reports a DSL-broken advanced filter as a healthy view — RESOLVED 2026-09-23

UI-9's root defect (a broken saved view 500-ing the task list with a
Retry that can never succeed) is fixed — see `docs/dev/decisions.md`
§ 8 A284 and `docs/dev/design/ui-issues.md` UI-9. **This entry's
classification gap is now also fixed** (PM ruling, 2026-09-23) — the
two objections below, which this entry previously used to argue for
leaving it unfixed, did not survive scrutiny.

`packages/core/src/config/queries.ts` `resolveFilters` used to validate
a saved view's stored `filters` against `FilterSchema` — a **shape**
check only. For an advanced filter, `FilterSchema` accepts `{kind:
"advanced", query: <any string>}`; the DSL text itself was never
tokenized/parsed at load time, only when the view actually ran
(`filtersToNode` → `advancedToNode`, `packages/core/src/query/filters.ts`).
So a view whose query was e.g. `status = = = done AND` loaded as an
ordinary healthy `SavedQuery` and was absent from
`queriesConfig.broken` — the `BrokenSavedQuery` marker only ever fired
for a shape-invalid entry (e.g. `filters: "not a list"`, covered by
`apps/web/src/server/server.view-broken-repair.test.ts`).

Consequence (now closed): `SavedViewsPanel`'s entire broken-row
apparatus — the marker, the raw-YAML disclosure, "Replace…", the
inert-Save gate — was unreachable for this defect class. A user had no
way to discover, from `GET /api/views` or the settings panel, that a
saved view would fail when clicked; they found out only by clicking it
(where they got an actionable error, per A284, but no advance warning).

**The fix:** `resolveFilters` now additionally runs `filtersToNode` on
the entry's shape-validated filters (after the existing `FilterSchema`
check, before returning ok). A thrown `FilterError` — unparseable
advanced DSL, or a shape-valid-but-uncombinable simple filter (e.g.
several values under `<`) — degrades the entry to `BrokenSavedQuery`
exactly like a shape failure, carrying `error: err.message` and
`position` (best-effort, extracted from the message text — see
`extractPosition` in `queries.ts`, since `FilterError` itself has no
`position` field) when available. Object-fatal problems (duplicate id,
missing array, missing id/name, bad sort/display) are untouched — they
still throw before `resolveFilters` is reached or inside the tolerant
schema.

**Why the two objections in the earlier version of this entry do not
hold, on inspection:**

1. *"Every view would pay a DSL-parse cost at every config load."* True
   but not a real cost at this scale: `queries.yaml` holds a handful to
   low hundreds of saved views in realistic use, `filtersToNode` is a
   single tokenize+parse pass per filter (the same work `loctt list`
   and every view-running call already do per invocation), and this
   only runs once per config **load**, not per task in the list. No
   measurement showed this mattering, and none was produced before this
   entry recommended weighing it — it was a plausible-sounding but
   unquantified objection.
2. *"`resolveFilters`'s contract is deliberately shape-only per its
   docstring."* The **file's own top-of-function docstring for
   `parseQueriesConfig`** (right above `resolveFilters`'s call site)
   already states the opposite: *"one entry whose filters no longer
   validate (a hand edit, most often) must not blank the whole catalog
   ... a bad one becomes a `BrokenSavedQuery` marker carrying its raw
   text and the validation message"* — unparseable DSL is exactly
   "filters no longer validate." The "shape-only" framing was a
   narrower reading of one function's docstring that the surrounding
   contract never actually promised; `resolveFilters` was updated to
   match the file's own already-stated contract, not extended past it.

**Verification:** on the seeded playground tracker's "Broken view"
(`01M33FP00000000000000000A6`, `.loctt/config/queries.yaml`),
`GET /api/views` now returns it under `broken` (with
`error: "advanced filter does not parse: expected value but got \"=\" at
position 9"`, `position: 9`) instead of `queries`. New tests in
`packages/core/src/config/queries.test.ts` cover: a DSL-broken view
classified broken with the parser's message; a healthy view loading
fine beside it; object-fatal problems still throwing; an uncombinable
simple filter also degrading (same path, different `FilterError`
cause). All four were red-proven (reverted the fix, watched them fail,
restored byte-exact) before being counted as passing.

**Fallout needing attention (outside this change's file scope):** two
pre-existing tests asserted the *old* classification as the expected
contract and now fail —
`apps/web/src/server/server.view-unparseable-dsl.test.ts` (its first
test is literally titled "is reported healthy by GET /api/views (the
classification gap, tracked separately)", and its other two assert a
run-time 400 that no longer fires because the view is now `unknown`
to the run path, not merely "resolves to a filter that fails") and
`apps/mcp/src/tools/list-tasks-broken-view.test.ts` (asserts a
run-time `errorResult`, same cause). Both are in the CLAUDE.md category
"a fix requires editing a green test because that test was asserting
the bug" — they need rewriting to assert the new load-time
classification instead of the old run-time failure shape, by whoever
owns `apps/web/src/server` and `apps/mcp/src/tools`.

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

**ALL of these were subsequently fixed.** Kept only as a record of what
the e2e repair surfaced; none is an open gap. MSL-25 (archived milestones
unreachable — `useMilestoneProgress` omitted `archived=all`) and TSK-59
(the block-type dropdown tearing down the description editor, caused by
K106's portal migration) are both closed.

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

**A11Y-16 — RESOLVED. It was a TEST defect; the app's CSS was correct
the whole time.**

Three wrong diagnoses preceded the right one, which is the useful part of
this entry:

1. An agent reported an invisible ring (1.00:1) and blamed a Tailwind
   layer-precedence override.
2. A second agent measured **16.14:1** on a hand-built copy of the button
   and called it a non-reproduction. **I recorded that as fact.**
3. The gate then failed on exactly that button, so I reversed and
   recorded it as a real, unfixed defect — and tried two CSS fixes
   (moving `:focus-visible` outside `@layer base`, then splitting the
   shorthand into longhands). **Neither worked, because there was nothing
   wrong with the CSS.** Both were reverted.

**The actual cause**, found by probing the live page instead of the
stylesheet: every control carries `transition-colors`, whose property
list includes `outline-color`. The spec read `getComputedStyle` in the
same tick as `.focus()`, sampling the transition MID-FLIGHT — so it got
the colour being transitioned *from* (the button's own white text) rather
than the settled value. Measured directly:

```
immediate = rgb(255, 255, 255)     <- what the test saw
settled   = rgb(15, 23, 42)        <- #0f172a, the intended --text-primary
```

**Fix:** the spec disables transitions before scanning, so it measures
the resting ring — which is what a 3:1 contrast requirement is about. All
four A11Y-16 tests pass.

**The lesson, and why all three earlier readings failed:** two of them
measured a *reconstruction* of the button rather than the button, and the
third (mine) trusted the gate's number without asking what the number was
measuring. A red gate proves something is wrong; it does not prove the
PRODUCT is wrong. The cheapest check was a six-line probe of the live
page, and it should have come first.

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

Measured repeatedly across this session, on the same tree:

| workers | result |
|---|---|
| 5 (the configured default) | 56 failures |
| 3 | 23, then later 5 |
| **2** | **846 passed, 0 failed — the whole suite, clean** |
| 1 (single file) | clean |

The final 5 failures at 3 workers were **all in one file**
(`flow-list.spec.ts`) and none of them had failed in any earlier run. The
causes name the problem outright: `Protocol error
(Runtime.callFunctionOn): Internal server error, session closed` —
browser sessions dying mid-call — and `loctt create Gamma exited 1`, a
CLI that could not spawn. Re-running that file alone: **184/184 pass**.

Each worker boots a real `loctt ui` server AND a browser, so the
per-worker cost is high enough that the configured concurrency exhausts
the machine rather than the tests finding bugs.

`playwright.config.ts` sets `retries: 0` with the comment *"a flaky gate
teaches the agent to re-run instead of fix"*. The intent is right and
this session proved its value twice — both tests dismissed as "known
flakes" (NEW-10, SPR-6) turned out to be **real bugs** once someone
looked. But the gate currently produces failures that are neither flakes
nor bugs, which teaches re-running by a different route: an agent that
sees five unfamiliar failures in one file learns to re-run, and is right
to.

**What a fix has to decide:** lower the worker count in the config
(simplest, costs wall-clock), or reduce the per-worker cost (share a
server across workers, or stub it where a spec does not need a real
one). Left unfixed rather than silently lowering the default, since
wall-clock on the gate is a real cost someone should choose knowingly.

## The three product decisions have been ruled on and closed

All three e2e tests that were red on a product call are now resolved.
Recorded here only so the decisions are not re-derived later.

- **SHL-31 / SHL-11 — the workspace label.** Ken rejected restoring the
  file path (*"is 'ugly file path' really the way to do it? i dont want
  that"*). Ruled: use the existing PROJECT entity — *"the user can rename
  the projects themselves if they want to differentiate"* — surfaced in
  the document title as `LocTT — <project> — <view>`, and **nothing added
  to the page** (*"Title only"*). No new tracker-level config, CLI
  command or MCP tool was needed. Both cases were amended in place.
- **The footer task-count test.** Retired entirely, per Ken's strict
  rule: the spec and its documentation removed, no commented-out code and
  no "retired" label. Its subject (the count) was gone, and the ERR-1
  hazard it guarded — a `0` that lies during an outage — cannot occur
  without a count.
- **TSK-69.** Ken ruled re-title rather than retire. The case now asserts
  the explicit edit affordance. Re-pointing the spec surfaced a real
  regression A247 had left behind (nothing focused the rich editor once
  click-to-edit was removed, so "ready to type" had silently stopped
  being true) — fixed rather than papered over.

---

### One test WAS rewritten, and is flagged for review

**TSK-71** asserted "Escape discards the edit and writes nothing". K96
(Ken, 2026-09-19) deliberately REVERSED that: Escape / Cmd-Enter / Cmd-S
all exit *keeping* the text, because revert-to-last-autosave was itself
a data-loss bug. Verified on disk that Escape now writes. The test was
rewritten to the current contract — exits, text kept, **exactly one**
write (preserving the original stray-second-write guard) — renamed, and
left with a `SUPERSEDED PREMISE` note.

This is the one place a test's ASSERTION was changed rather than how it
drives the UI. Flagged because "the test disagreed with the code" is
exactly the situation where the test is sometimes right. Here the code
matches a recorded Ken ruling, so the test was the stale party — but that
judgement is worth a second pair of eyes.


## E2E final state (2026-09-22): 10 failed / 837 passed at 3 workers

Down from **155** at the start of the spec repair, and **19** after it.
The six fixes in `A282` closed nine. What remains:

| # | Test | Category |
|---|---|---|
| 1,2 | A11Y-16 (light + dark) | **REAL, unfixed** — see the entry above; I twice recorded it as non-reproducing and the gate disagreed |
| 3 | A11Y-9 back-nav focus restore | **REAL, unfixed** — `focusedTaskKey` lives in a component instance destroyed on navigation, so the restore built for A11Y-17 (refetch within a mount) does not apply across it |
| 6 | VUE-22 sidebar broken-view flag | **REAL, unfixed** — note the API half of the original diagnosis was checked and found WRONG; the server does return `broken`, so the remaining fault is in the sidebar's rendering, not the data |
| 7 | PRU-26 | **click timeout on the kebab trigger** — same class as TSK-18 (an element moving or covered mid-click), not the `disabled` fix; needs the same instrumented diagnosis |
| 8,9 | SPR-6, NEW-10 | **known flakes**, pass on re-run |
| 10 | TSK-69 | **PRODUCT DECISION** — A247 deliberately removed the gesture the case asserts |

So: **3 real defects, 3 product decisions, 2 flakes, 2 counted twice**
(A11Y-16 runs per theme).


## VUE-22 — the spec was testing a view that was never broken

Found while closing the last three e2e failures (2026-09-22). Three
layers of wrongness, each masking the next:

**1. The test's fixture was not broken.** The spec hand-edited a view to
`{kind: "advanced", query: "status = = done"}` and expected it to load as
`broken`. It does not: `parseQueriesConfig` populates `broken` from
**`FilterSchema` SHAPE validation**, and never parses the DSL. A
shape-valid advanced filter holding malformed DSL loads as HEALTHY — the
bad query only fails at RUN time. The fixture now uses a bad `op` on a
simple filter, which the schema does reject.

*This also corrects a claim I made earlier in this file:* I probed
`/api/views` against a hand-broken tracker, saw `broken: ["Busted"]`, and
concluded "the data reaches the client, so the fault is in the sidebar's
rendering". My probe used a genuinely shape-invalid entry; the SPEC's did
not. Both observations were right about their own fixture — I generalised
mine onto the spec's without checking they were the same thing.

**2. A client type was lying.** `broken_view.query` was declared
`readonly query: string` — REQUIRED — in the hand-written client type,
and the server **has never sent it** (it sends `id`, `name`, `summary`,
`error`; verified at `server.ts:4248-4251`). So it typechecked as a
`string` and read `undefined` at runtime: the banner rendered an empty
paragraph, and its "Fix this view in the editor" button handed
`q: undefined` to the advanced editor, opening it blank. A hand-written
mirror of a server payload is exactly the hand-rolled-copy hazard that
has now bitten four times this session, in a new disguise — the copy was
of a SHAPE rather than a rule.

**3. The banner never implemented the case's third bullet** (show the
stored `rawText`), though `SavedViewsPanel` does it correctly.

All three fixed client-side. The banner now renders `rawText` from the
already-cached `["views"]` query and links to Saved views' guarded
`Replace…` flow — which is functional, since `K102-broken-repair`
Option A landed in `c2318872` and `editView`/`deleteView` resolve through
`findViewOrBroken`. (The agent that did this work flagged that path as
still broken; it was reading the decision entry's pre-build text rather
than the code. Verified working on a real tracker.)

## A11Y-9 and PRU-26 — both were the guard, not the feature

**A11Y-9 (app bug, but not the reported one).** The reported cause — a
`focusedTaskKey` ref dying on unmount, needing a sessionStorage bridge —
was wrong: **that bridge already exists and works**, and a probe showed
the key correctly stashed and consumed. The real fault was the restore
effect's own guard, `if (activeElement !== null && activeElement !==
body) return`. `useRouteAnnouncement` (A11Y-45) parks focus on
`#main-content` after every route change, including this one, so
`activeElement` was the landmark and never `body` — the guard read that
as "the user placed focus" and stood down, having already consumed the
key. A11Y-45 and A11Y-9 are general-vs-specific rather than in conflict;
the landmark now counts as unclaimed.

**PRU-26 (test bug, two of them).** Not the `disabled` fix. A trace showed
one user's open menu sitting directly over the next user's kebab —
`elementFromPoint` returned the wrong item. The `rowMenuItem` helper's
docstring claimed "the next call reopens from scratch", true before K106
portalled the panel to `document.body` and false after; it now dismisses
an open menu first. That exposed a second: the spec asserted
`data-archived="true"` on the row, but the panel's scope defaults to
`active`, so an archived user LEAVES the list — it only ever passed by
racing the refetch.

## A red-proof can produce a FALSE GREEN over a stale bundle

While red-proving A11Y-9, the agent's first attempt showed the test still
passing with the fix removed. Cause: `npm run build` had failed on an
unused-import error, so the spec ran the PREVIOUS bundle. The proof was
meaningless.

**Rule:** an e2e red-proof must check the BUILD's exit status, not just
the test result. A green test over a stale bundle proves nothing, and
looks exactly like a test that does not work.

## NEW-10 was not a flake — Escape reached past the dropdown to the modal

Listed above as a "pre-existing flake, passes on re-run". It does not: it
fails consistently in isolation. Diagnosed 2026-09-22 by probing the live
page.

**Symptom:** a 30s click timeout on `create-submit` — the same signature
as PRU-26 and TSK-18, and the third time this shape appeared.

**Cause.** The spec picks a tag, presses Escape to close the multi-select
panel, then clicks Submit. One Escape did TWO things:

```
PROBE panelsBeforeEscape=1
PROBE afterEscape={"panels":0,"discard":1}
```

It closed the panel AND opened the create modal's "Discard this task?"
prompt, whose `z-[55]` overlay then covered Submit. `elementFromPoint` at
the button's centre returned the overlay, so the click never landed.

`Dropdown` already tried to prevent this — its handler calls
`stopPropagation()` with a comment saying "the picker's Escape must not
also close a dialog it sits inside". **That was insufficient, and the
comment hid it.** Both `Dropdown` and `CreateTaskModal` register a
CAPTURE listener on `document`; capture listeners on the SAME node fire
in registration order, the modal mounts first, so the modal's handler had
already run. `stopPropagation` only stops the walk to the next NODE — it
cannot stop a sibling listener on the node you are already on.
`stopImmediatePropagation` is the one that does, and is now used.

**Why K106 surfaced it:** before the portal migration the panel lived
inside the modal's subtree, so the modal's own handler could tell "this
Escape belongs to something inside me". Portalling the panel to
`document.body` removed that relationship. This is the second such
fallout after TSK-59 (`BodyEditor`'s `contains(relatedTarget)` guard) —
**both were components reasoning about containment that the portal
silently broke.**

*Process note:* this fix's red-proof was run with the build's exit status
checked, after an earlier false green in this same batch came from a
spec running against a stale bundle.


## SPR-6 was not a flake either — the drop aimed at stale coordinates

Listed in two earlier entries as a "pre-existing flake, passes on
re-run", on the strength of a note in the spec's own helper recording it
failing 2 of 12 under load in September. **It is a real bug**, and it
failed 2 of 3 runs in ISOLATION on an idle machine.

**How it was found.** Instrumenting the page's `fetch` showed that on a
failing run `posts=[]` — **no write request was made at all**. That ruled
out the render race everyone (including me, twice) assumed: the helper's
existing wait logic was never the problem, because there was nothing to
wait for.

Probing `elementFromPoint` at the drop coordinates then showed:

```
pass:  dropHit={"col":"__no_sprint__"}            target x=684.5
fail:  dropHit={"col":"01M32WJWT8R59KC8HV1P9AG90Z"} target x=394
```

The drop was landing on the SPRINT column instead of "No sprint".
`columnPoint` measures the target column BEFORE `dragCard` runs, and
lifting the card out of the flow reflows the board — so by the time the
pointer arrives, the column that was at those coordinates has moved.
`useBoardDrag.slotAt` decides the drop by `elementFromPoint`, so it
faithfully dropped where the test actually pointed.

**Fix:** `dragCard` takes the target column id and RE-MEASURES it
mid-drag, just before `mouse.up()`. 5 of 5 runs pass; the whole
`flow-sprints` file passes 50/50.

**Two wrong turns on the way, both mine, both from treating the symptom:**
adding two animation frames before the assertion (3 of 4), then a
settle-loop that waited for two equal count reads (2 of 5 — *worse*,
because it could sample twice before the refetch even started and
"settle" on the stale value). Neither could work, because the request was
never sent. Tuning a wait is what you reach for when you have assumed a
race; the cheap instrumentation that disproved the race should have come
first.

**Both "known flakes" in this suite have now turned out to be real
bugs** (NEW-10, SPR-6). A test labelled flaky is a hypothesis about the
test, and this file recorded that hypothesis as fact twice.

## Pre-merge code review of PR #5 — three findings, all fixed

A review of the whole branch before squash-merge, aimed at the two places
it is genuinely risky: the on-disk format changes, and K106's portal
migration.

**1. A THIRD portal regression, in `RichEditor`.** `onFocusOut` used
`e.currentTarget.contains(e.relatedTarget)` to mean "focus is still
mine", exactly as `BodyEditor` did before TSK-59 — and never got the
`[data-dropdown-panel]` escape hatch that fix added. Opening the
toolbar's block-type picker unmounted the toolbar mid-click, so the
transform never applied.

It survived the first sweep because `MarkdownField` always passes
`hideToolbar`, making the vulnerable branch dead there; `CreateTaskModal`
is the only caller that omits it. **Three instances now** — the portal
migration's blast radius reached every component that used DOM
containment to mean ownership, and a grep for `contains(relatedTarget)`
should be standard whenever a panel is portalled.

**2. The FIFTH hand-rolled copy of a schema rule, in `doctor`.**
`invalidLabelColors` (`core/src/diagnostics/integrity.ts`) matched
colours with a line-oriented hex regex. That was sound when every colour
was a single-line string; K103 made two of three shapes nested blocks, so

```yaml
color:
  light: "#CC6600"
  dark: "not-a-hex"
```

was dropped on load by `dropInvalidColor` **and reported by nobody** —
the one mechanism meant to tell the user was blind to it. Now parses the
YAML and asks `EntityColorSchema`. Verified both ways on a real tracker:
the invalid block is reported, and all three valid shapes produce no
false positive. The message named only hex; it now names all three
shapes.

*This is the fifth instance of the same pattern on this branch*
(`dropInvalidColor`, `cells.tsx`, `LabelEditDialog`, a client type
declaring a field the server never sends, and now this). **The rule: a
hand-rolled copy of a validation rule is a data-loss bug the moment the
schema widens. Ask the contract.**

**3. Dead `ui/ColorInput.tsx` deleted.** Zero callers, but its docstring
still advertised it as the control for entity colour, and its
`isValidHexColor(value: string)` would silently reject both object
shapes — precisely the API a new dialog would reach for.

**One reviewer claim did not hold:** that K102 carries no `Status:` line.
It does. Checked rather than actioned — the session's rate of
confidently-reported-but-wrong findings is why.

---

## Tap targets are 21px, not the 24px the code claims (WCAG 2.5.8 AA)

**Resolved 2026-09-23 for `Checkbox` (K31, Ken's ruling).** The visible
box now grows to `h-7 w-7` (24.5px, measured live) instead of hiding an
oversized hit area behind a smaller drawn box — Ken rejected the
overlay approach ("sounds like a bad hack. make the checkbox bigger
instead?!?!") in favour of the honest fix. Row height cost, measured:
desktop list-view rows went from 41.16px to 43px (+1.84px, ~4.5%); the
narrow card view is unaffected since its row height is text-driven. See
`decisions.md` § K31 for the full record and revert path. **The header
user-menu button (22px) and skip link (16px) are judged separately below
and left as-is** — not part of this resolution.

**Found:** 2026-09-22, measuring the app at 375×812 — the breakpoint the
session's two UI audits both left unreached.

**Measured, live, on the built client:**

| Control | Rendered | Claimed |
|---|---|---|
| `Checkbox` (input AND wrapper) | **21 × 21px** | 24px |
| User menu button (header) | **22 × 22px** | — |
| Label chip (a real `<button>`) | 63.6 × **21.2px** | — |
| "Skip to main content" link | 23 × **16px** | — |

`ui/Checkbox.tsx:31-60` cites "WCAG 2.5.8 AA — #15" and states the 24px
target **three times** (`:33`, `:35`, `:43`, `:52-53`, `:60`).

**The mechanism it describes is correct and works**: the real `<input>`
is `absolute inset-0`, transparent, filling its wrapper, so the whole
wrapper is clickable — measured input and wrapper are identical. The
defect is purely the number. `h-6`/`w-6` is `1.5rem`, and
`styles/index.css:142` sets `html { font-size: 87.5% }`, so 1.5rem
renders **21px**, not 24px.

So the component does exactly what its docstring says while missing the
standard it cites. A reader checking the claim against the class name
would agree with it; only a measurement disagrees.

**Why this is more than one component.** The same 0.875× applies to
every rem-sized control. `design-system.md:184-186` documented
`IconButton` as 28/32px when it actually renders 24.5/28px — corrected
during this session. This entry is the same root cause reaching the
a11y claims. Any size assertion in this codebase derived from a Tailwind
utility name rather than a measurement should be assumed wrong by 12.5%.

**Not fixed here** because the fix is a judgement call, not a
correction: bumping `Checkbox` to `h-7` (24.5px) fixes the claim but
changes the visual rhythm of every list row and the bulk-select column,
which is a design change. The alternatives — raising the root font size,
or expanding hit areas without changing visual size — have wider blast
radii still.

**To reproduce:** load any list at 375×812 and measure
`document.querySelector('input[type=checkbox]').getBoundingClientRect()`.

**Related but separate:** the header's user-menu button (22px) and the
skip link (16px) are below 24px for their own reasons, not the root-font
one. They want their own look.

**Judged 2026-09-23, left as-is.** Header user-menu button: measured
live at 22×22px, a fixed size shared with other 22px avatar-sized
controls in the header row; growing it alone would misalign it against
its siblings and was outside this ticket's file set (`shell/Header.tsx`
is in-scope, but the ticket asked for a judgment call here, not a
mandated fix — see `decisions.md` § K31). Skip link: measured live at
23×16px, but it is `sr-only`/off-screen until focused and has no
neighbour to misalign with, so a keyboard-only, briefly-visible control
sized under 24px was judged acceptable — the WCAG 2.5.8 target-size
success criterion's own intent (avoid mis-taps on a control users aim
for with a finger or imprecise pointer) doesn't apply to a link that is
invisible except during keyboard focus. Neither was changed.

---

## `ui/Menu` never restores focus on close (every consumer affected)

**Resolved 2026-09-23.** `Menu.tsx` now records the trigger
(`document.activeElement` at open time) and restores focus to it on
Escape and outside-click, guarded by `el.isConnected` so a trigger that
unmounted before close (A11Y-15) is skipped rather than throwing or
focusing a detached node. Selecting an item does NOT restore focus,
deliberately — see `decisions.md` § A298 for the reasoning and the
options considered. `IconEmojiPicker`, built on `Menu`, needed no
changes; the fix is at the render-prop/portal level all 11 consumers
share.

**Found:** 2026-09-22 sweep; reproduced live before recording.

**Measured**, driving the list view's ⋯ menu in a real browser:

| Step | `document.activeElement` |
|---|---|
| Focus the trigger | `view-actions-menu` |
| Open the menu | `BUTTON` with `role="menuitem"` — correct |
| Press Escape | **`BODY`** |

A keyboard user who opens the ⋯ menu and dismisses it is dumped to the
top of the document and has to Tab back through the whole page.

**Cause.** `apps/web/src/client/ui/Menu.tsx` has **no focus-restore
logic at all** — its only `document.activeElement` reference is
`Menu.tsx:124`, which drives roving focus *within* the open panel.
Nothing records the trigger before opening or returns focus to it after.

**Distinct from the already-recorded dialog gap.** `ViewFormDialog` /
`LabelEditDialog` drop focus because they never pass `returnFocusTo`
into `useFocusTrap` — the mechanism exists and they don't use it. `Menu`
does not use `useFocusTrap` at all, so there is no hatch to pass. Same
symptom, different fix.

**Blast radius is every `Menu` consumer**, not one component: the list
and board ⋯ menus, the per-column board menus, `IconEmojiPicker` (built
on `Menu`), and any future caller. That makes it a primitive-level fix
rather than a per-call-site one — and therefore worth doing once,
properly, rather than patching a symptom.

**To reproduce:** focus `[data-testid="view-actions-menu"]`, click it,
press Escape, read `document.activeElement`.

---

## Icon picker grid has no arrow-key navigation

**Found:** 2026-09-22 sweep; verified against source.

The icon grid renders up to **225 cells**. The only keyboard route
through it is Tab, one cell at a time — up to 225 presses to reach the
last icon.

**Cause.** `apps/web/src/client/ui/IconEmojiPicker.tsx` contains exactly
one `onKeyDown` (`:330`), and it handles **Enter on the free-text emoji
input** only. There is no Arrow/Home/End handling for the grid.

**Why it is worth fixing rather than accepting.** The app already
implements roving grid/list focus twice — `ui/Dropdown.tsx` (A11Y-10,
`menuitemcheckbox` rows with real roving DOM focus) and the segmented
`ArchivedScopeControl` built this session. The pattern is in the
codebase; this component just never adopted it. That is
`design-review.md`'s "built is not adopted" finding recurring.

**Note:** a grid wants two-dimensional navigation (Left/Right within a
row, Up/Down between rows), which is a step beyond the one-dimensional
roving focus the existing two implement. Not a copy-paste.

## Palette `orange` light value is 3.84:1 on white — below WCAG AA

**Found:** 2026-09-22, during the 7 → 18 palette expansion (A288), by
computing contrast for every entry rather than by eye. **Pre-existing:
this expansion did not introduce it and does not fix it.**

`BUILTIN_PALETTE`'s `orange` light value is `#CC6600`. Against
`--bg-surface` in light mode (`#FFFFFF`) that is **3.84:1** — below the
4.5:1 WCAG AA needs for normal text. Against light `--bg-canvas`
(`#F6F8FC`) it is worse still, 3.61:1. The dark value (`#F0A868` on
`#141416`, 9.20:1) is fine, as is every other one of the 36 values in
the palette.

**Reproduce.**

```bash
node -e '
const c=h=>{h=h.slice(1);const f=i=>{const v=parseInt(h.slice(i,i+2),16)/255;
return v<=0.04045?v/12.92:Math.pow((v+0.055)/1.055,2.4)};
return 0.2126*f(0)+0.7152*f(2)+0.0722*f(4)};
const r=(a,b)=>{const x=c(a),y=c(b);return ((Math.max(x,y)+0.05)/(Math.min(x,y)+0.05)).toFixed(2)};
console.log("orange on white:", r("#CC6600","#FFFFFF"));'
# → orange on white: 3.84
```

**Why it was not fixed here.** `#CC6600` is a literal copy of the
`--feedback-warn-fg` / `--priority-high` design token, so the palette is
faithfully mirroring the token file — the defect is in the token, and
changing it only in the palette would make the two disagree, which is
the exact drift `color.ts` exists to prevent. Changing it in both would
alter the rendered colour of live data (the seeded tracker has `orange`
in use) for a defect this work did not create and was not scoped to.

**It is fenced, not forgotten.** `color.test.ts`'s contrast sweep
exempts `orange` **by name** rather than lowering the 4.5:1 bar, so
every other entry is still held to AA. A companion test,
*"still reports the known orange shortfall, so it cannot be forgotten"*,
asserts the failure still exists — so whoever fixes the token is forced
to remove the exemption and this entry at the same time.

**Fixing it properly** means moving `--feedback-warn-fg` (and the
palette entry with it) to something like `#B35900` (4.72:1) and
re-checking every surface that paints warn/high-priority, plus
re-running the ΔE sweep, since moving `orange` changes its distance to
`amber` and `red`.

## Two-dimensional roving grid focus now HAS a reference implementation

**Updates the "Icon picker grid has no arrow-key navigation" entry
above**, which notes that a grid wants two-dimensional navigation and
that this is "a step beyond the one-dimensional roving focus the
existing two implement. Not a copy-paste."

As of 2026-09-22 (A289) it is a copy-paste. `ui/ColorPicker.tsx`'s
`onGridKeyDown` implements exactly that pattern over a `role="radiogroup"`
of `role="radio"` cells: single tab stop via `tabIndex` 0/-1 on the
selected cell, Left/Right by one, Up/Down by `GRID_COLUMNS`, Home/End to
the ends, clamped rather than wrapped, and **focus movement that does
not select**.

The icon picker's grid is the same shape (a wrapped grid of
equally-sized cells in a portalled panel), so adopting it is mechanical
— the only value to change is the column count, which for the icon grid
is 8 (`grid-cols-8`) against the colour grid's 6. Note the
does-not-select rule transfers too: the icon picker also commits and
closes on pick.

This does not fix the icon picker. It removes the stated reason the fix
was non-trivial.

---

## ~~The 18-colour palette passes ΔE but reads as a generated ramp~~ — FIXED (A290)

**Fixed 2026-09-22 (A290).** The twelve non-token entries were re-picked
by *character* (deep / vivid / muted) instead of by hue slot, and a
variety test now enforces the property the ΔE floor could not.

| | A288 (was) | A290 (now) |
|---|---|---|
| min ΔE light / dark | 15.02 / 15.03 | **18.15 / 19.43** |
| largest same-saturation cluster, light | 9 | **4** |
| largest same-saturation cluster, dark | 10 | **5** |
| HSV saturation sd, light / dark | 0.179 / 0.131 | **0.219 / 0.173** |

Both guarantees improved together: separation went *up* while the
clustering that made it look uniform went down.

**The A288 premise that turned out to be false.** That pass recorded
"~18 is roughly the arithmetic ceiling for 18 entries under the
contrast clamp", and this file repeated it. It is wrong. Re-measured by
farthest-point search over every AA-passing sRGB colour, the true
ceiling at 18 entries is **ΔE ≈ 33 in both modes**. A288 hit ~18
because it searched a fixed-chroma hue ramp, not because the space was
full. **18 entries was never the problem**, so no reduction in count
was needed — the recommendation to consider a smaller set is withdrawn.

**Two structural facts worth not re-deriving**, both now in `color.ts`:

1. **AA is a hard L\* clamp**, not a preference: light mode admits
   nothing above L\* ≈ 51, dark nothing below L\* ≈ 55. "Some deep,
   some bright" has to happen *inside* those windows.
2. **`slate` cannot be a neutral grey-blue.** Every desaturated value
   tried re-collided with `gray` (ΔE 9.6–12.8 dark) — the original
   A288 defect returning. It must carry real chroma.

**The test that now guards it** is *"spreads saturation instead of
clustering it"* in `color.test.ts`: it buckets HSV saturation 0.05-wide
and caps any bucket at 5 entries. Cluster size was chosen over a
standard-deviation floor because sd separates the old palette from the
new by only 1.32× (0.131 → 0.173) — too thin to set a threshold in —
while cluster size separates them by 4× and names the defect directly.
The cap cannot go below 5: the crowded dark bucket holds `blue`,
`orange` and `red`, three byte-frozen token originals.

*Original entry, for the record:*

**Found:** 2026-09-22, eyeballing the rebuilt picker in dark mode after
the palette expansion (A288).

**The metric is satisfied.** Independently re-measured from source:
18 entries, minimum pairwise ΔE **15.02 light / 15.03 dark** — up from
slate/gray's **4.10 / 2.31**, where the dark pair was effectively one
colour twice. That defect is genuinely fixed, and a test now enforces
the floor.

**But ΔE measures distance, not variety.** Of the 11 new entries, **9
sit at exactly saturation 0.50** (range 0.34–0.52), while the 6
surviving originals span 0.05–0.66. The new colours are one saturation
with the hue rotated — arithmetically far apart, visually a single
family. In dark mode the grid's rows 2–3 read as tints of each other.

| Set | Dark saturation |
|---|---|
| Originals (teal, blue, green, orange, red, gray) | 0.05 – 0.66 |
| The 11 new | **0.34 – 0.52, nine at 0.50** |

**Why the test did not catch it.** The floor test asks "is every pair at
least ΔE 15 apart?" — a pairwise-minimum question. A hue ramp at fixed
saturation answers yes while still looking uniform, because ΔE is
dominated by hue difference at constant chroma. Distinctness and
variety are different properties; only the first is enforced.

**Not fixed** because the remedy is a design pass, not a threshold
change: vary chroma and luminance across the set so colours differ in
more than hue, the way the six originals do. Re-running the ΔE sweep
after any such pass is mandatory — the two constraints pull against
each other, and the agent's own search found ~18 to be the arithmetic
ceiling for a ΔE floor at 18 entries under the contrast clamp.

Worth considering alongside it: whether 18 is the right count at all. A
smaller, genuinely varied set may serve labelling better than a larger
uniform one.

## `<ins>` underline is a raw tag to `loctt show` and to MCP agents (accepted)

**Status: accepted by Ken, knowingly.** Not a defect to fix — the cost
was weighed against the alternatives before the mark shipped (A295).

`loctt show` prints the body verbatim
(`apps/cli/src/commands/task-crud.ts`) and MCP `get_task` returns raw
body text. Neither applies markdown processing. So a body containing
underline shows the literal tags:

```
This is an <ins>underlined</ins> word.
```

That is 11 characters of noise per use in the terminal and in an
agent's context. It is the unavoidable cost of underline having no
markdown spelling: the alternatives were `<u>` (which GitHub strips
silently, so the formatting is *lost* rather than noisy) and a custom
delimiter (noise in *every* tool, including GitHub, rather than just
the plain-text ones). Underline is rare in issue-tracker prose, so the
frequency is low even though the per-occurrence cost is visible.

`==highlight==` has the same property but is cheaper (2 characters per
side) and is a convention readers of Obsidian/pandoc markdown already
recognise.

**Agents must not "clean this up".** `docs/dev/reference/markdown-extensions.md`
§ For agents says so explicitly; rewriting `<ins>` to `<u>` would
silently destroy the user's formatting on GitHub.

## Two *adjacent* underlined spans merge into one on a rich edit

A mark spanning several text runs is serialized per run, so an
underline covering `under ` plus a bold `bold` emitted
`<ins>under </ins><ins>**bold**</ins>` — visible noise that grew by two
tags on every save-reopen-save cycle. `inlineText`
(`apps/web/src/client/editor/markdown.ts`) now collapses `</ins><ins>`.

**The cost:** a user who *deliberately* writes two adjacent underlined
spans with nothing between them gets them merged into a single span on
the next rich-mode edit. Rendered output is identical (`<ins>a</ins><ins>b</ins>`
and `<ins>ab</ins>` look the same), so this is invisible in every
renderer; it is only observable by diffing the stored bytes.

**To reproduce:** store a body containing `<ins>a</ins><ins>b</ins>`,
edit anything in rich mode, save, and read the file — it is now
`<ins>ab</ins>`.

**Not fixed** because the general remedy (merge adjacent runs sharing a
mark, before wrapping) would also change the spelling of `**`/`*`/`~~`
output, rewriting bodies this feature never touched — precisely the
normalization `markdown.ts` exists to avoid. The scoped fix trades an
invisible, idempotent merge for a visible, unbounded growth; that is
the better trade, but it is a trade.

---

## The label pill's colour styling had NO test — found by mutation, now partly closed

Found while extracting the pill's visual rule into
`apps/web/src/client/ui/labelPillStyle.ts` (A300). Per CLAUDE.md's
"extending code someone else tested" rule, the pill's existing coverage
was mutated to check it still covered its subject.

**It did not.** Replacing the pill's entire inline style with `{}` in
`apps/web/src/client/list/cells.tsx` left **all 352 `list/` tests
green**. The three derived values the pill is built from — the
`${color}22` background wash, the `${color}66` border and the
`readableOn(color)` text colour — were asserted nowhere. A regression
that rendered every label pill unstyled would have shipped green.

`list/LabelOverflow.test.tsx` covers the `+N` overflow behaviour
thoroughly (reveal, filter-on-click, Escape, outside-click) and passes
colours in its fixtures, but never asserts anything about how they are
painted. Nobody wrote a bad test; the test was written for overflow and
the colour rule grew beside it.

**Partly closed.** `ui/ThemePreview.test.tsx` now contains
"paints a list pill with exactly labelPillStyle's derived values",
which renders a real `LabelsCell` and compares its computed style
against a reference element styled with `labelPillStyle` directly
(a literal comparison would assert jsdom's `rgba()` re-serialisation
rather than the wiring). It is red-proven: reverting
`style={labelPillStyle(color)}` to `style={{}}` fails it.

**Still open:** that test lives in the `ui/` preview suite because that
is where the shared function is. The `list/` suite still has no colour
assertion of its own, so a future change to `LabelsCell` that stops
rendering pills through `LabelPill` altogether would not be caught
there. The other cells (`StatusBadge`, priority, task-type) were not
audited and may have the same gap.
