# UI issues

Running log of UI/UX defects found by using the app, as opposed to the
one-off audits in [design-review.md](design-review.md). An entry stays
here until it is either fixed (with the commit that fixed it) or
promoted to `known-gaps.md` as an understood-but-unfixed defect.

Each entry records: what you see, what causes it (grepped or measured
against source — not guessed), and what fixing it would touch. An entry
whose cause is still a guess says so.

Status values: **open** · **fixed** · **wontfix** · **promoted**

---

## UI-1 — Page title sits 1.5px lower on Board than on List/Timeline

**Status:** fixed 2026-09-22 (uncommitted; Ken integrates)
**Fix:** `ui/PageHeader.tsx` — `items-center` → `items-start` on the
wrapper, plus `min-h-7` on the actions container so a short actions slot
cannot shrink the row either. Option (2) from the list below, per Ken's
UI-2 ruling ("`items-start`, not a magic min-height"), NOT the
recommended option (1). No caller changes. Re-measured live at
1440×900: Board's title top is now **62.00px**, identical to List and
Timeline (was 63.52px).
**Note:** `ui/PageHeader.test.tsx:78` asserted `items-center` and was
green. It was encoding the defect, and was updated as part of the fix.
**Found:** 2026-09-22 (Ken, by eye, switching between views)
**Severity:** cosmetic, but cross-view — the title is the anchor element
the K-title rule put above the toolbar on every task view, so it is
exactly the element a user tracks while switching tabs.

### What you see

Switch List → Board → Timeline. The page title shifts down slightly on
Board and back up on Timeline, while the surrounding chrome stays put.

### Measured

Live, at 1440×900, against the built client:

| View | Header box height | Title top | Container |
|---|---|---|---|
| List | 21.45px | 62.00px | `flex flex-col gap-3 p-4` |
| Timeline | 21.45px | 62.00px | `flex h-full flex-col gap-3 p-4` |
| **Board** | **24.50px** | **63.52px** | `flex h-full flex-col gap-3 p-4` |

Padding (14px), gap (10.5px), header top (62px) and title font size
(14.9996px) are identical across all three. The title *text block* is
21.45px tall in all three. Only Board's header **box** is taller.

### Cause

Not the container, and not `PageHeader` itself — both are already
consistent (`PageHeader` was built precisely to converge these; see its
docstring).

`PageHeader` lays its two children out as
`flex flex-wrap items-center justify-between gap-3`:

- `apps/web/src/client/ui/PageHeader.tsx:61` — the wrapper
- `apps/web/src/client/ui/PageHeader.tsx:65` — title block, 21.45px
- `apps/web/src/client/ui/PageHeader.tsx:76` — actions slot

Board is the only one of the three that passes `actions`
(`apps/web/src/client/board/BoardView.tsx:311` — "+ Add task" plus the
K100 overflow menu). Those buttons make the actions slot 24.5px, the row
takes the taller child's height, and `items-center` then centres the
21.45px title against it — moving the title down by
`(24.5 - 21.45) / 2 ≈ 1.52px`.

So this is not Board-specific code being wrong. **Any** view that passes
`actions` taller than the title will drift the same way; Board is simply
the first one that does.

### Options (not yet decided — this is a design call)

1. **Reserve a min-height on the title block** so the row height no
   longer depends on whether `actions` is present. Most robust; makes
   every current and future caller consistent by construction.
2. **`items-start` + compensating padding on the actions slot.** Pins
   the title to the top but re-introduces per-caller tuning, which is
   the thing `PageHeader` was built to remove.
3. **Wontfix.** 1.5px is genuinely small and only visible when switching
   views.

Recommend (1): it fixes the class rather than the instance, which is the
altitude the rest of this component was built at.

### Cost to fix

One file (`ui/PageHeader.tsx`) plus a red-proven test asserting equal
header height with and without `actions`. No caller changes. Board,
Milestones and any other `actions` caller all move together.

### Related

UI-3 is the upstream cause: the actions slot is 24.5px because the
`IconButton` inside it is `size="sm"`. Fixing UI-3 alone would change
this drift's magnitude but not remove it — the two are independent.

---

## UI-2 — The "View options" overflow menu is a grab-bag of mismatched controls

**Status:** fixed 2026-09-22 (uncommitted; Ken integrates)
**Fix:** Export is two flat `role="menuitem"` anchors (`Export CSV` /
`Export JSON`) — the nested popover is gone — and its outcomes go to
`ui/Toast` (see UI-5). Archived moved OUT to the left filter band, after
the facets and before "+ Add filter". Menu order is now Save as view →
Export → Configure, sectioned by `border-t border-border-subtle` + a
`text-label text-text-tertiary` heading. Export gained the mobile entry
point Ken asked for, in the filters Sheet as full-width rows.
Item 2 of the "Decided" list (the segmented Archived control at all 11
call sites) was a separate concurrent lane, not this one.
**Found:** 2026-09-22 (Ken, screenshot)
**Severity:** real UX, not cosmetic. This is the primary entry point for
three separate view actions.

### What you see

One "⋯" menu containing three controls that share no visual language:

1. **Archived** — a native `<select>` with a native chevron
2. **Export** — a bordered `Button` that opens a *second*, nested popover
3. **Save as view** — a plain `MenuItem`

Three different control shapes, three different heights, three different
affordances, in one 200px-wide panel. A menu is supposed to be a list of
actions; this one has a form control and a nested menu inside it.

Source: `apps/web/src/client/list/FilterBar.tsx:686-739`.

### Ken's specific calls (2026-09-22)

- **"Save as view" belongs on top.** It is the action most likely to be
  wanted, and it is currently last.
- **Archived should not be a native select.** Suggested a joined /
  segmented button instead.
- **Export as a nested dropdown-in-a-dropdown is wrong.** Open question:
  what shape does it actually want?
- **Native UI is bad** — the native `<select>` does not match any other
  control in the app.

### Cause

Not an accident of layout — each piece was added on its own terms and
the composition was never designed:

- `ArchivedScopeControl` is deliberately a native `<select>`
  (`ui/ArchivedScopeControl.tsx:19-20`: *"a labelled native `<select>`
  rather than a segmented radiogroup: the set is a fixed three, a
  `<select>` is natively accessible"*). That reasoning is sound in
  isolation and wrong in this context — it is the only native control
  in a panel of custom ones.
- `ExportMenu`'s trigger is a full `Button` (`list/ExportMenu.tsx:120`)
  because it was built to sit inline in a toolbar, not inside a menu.
  *(Moot since K30-web, 2026-09-23: `ExportMenu` was deleted with the
  web export.)*
- Only `Save as view` is an actual `MenuItem`. *(Since K30-web it is the
  only thing left, and is now a direct star `IconButton` outside the
  menu — see A297.)*

So all three are individually defensible and collectively incoherent —
the same "built is not adopted" shape `design-review.md` records, one
level up.

### Decided (2026-09-22)

A UI-designer review plus Ken's rulings settled all of it. Full rationale
belongs in `decisions.md`; the shape is:

1. **Export** → two flat `MenuItem`s, `Export CSV` / `Export JSON`.
   Outcomes (pending / failure + retry / skipped rows) report through the
   existing `ui/Toast`, **not** inline in the panel. A submenu was
   explicitly rejected: it is the one shape that cannot absorb a later
   columns/scope option. Export is also **added to the mobile Sheet**
   (Ken, 2026-09-22) — it does not exist there today.
2. **Archived** → a segmented/joined control replacing the native
   `<select>`, at **all 11 call sites** (Ken: *"Everywhere — replace the
   primitive"*). See UI-4 for why the native element loses.
3. **Two ⋯ menus** → merged; per-column kebab becomes a *vertical* glyph
   so "this surface" and "this item" read differently.
4. **Order** → Save as view first. Rule: **create → act → configure**,
   navigation (ellipsis deep-links) last.
5. **PageHeader** → `items-start`, not a magic min-height (UI-1).

Menu ownership after the merge (FilterBar absorbs the board's links vs.
PageHeader owning a menu on every view) was delegated to the implementing
agent (Ken: *"ui/engineering agent can figure it out"*).

### Correction worth keeping

The design review initially claimed K106 locked the native `<select>`,
citing Ken: *"Do the churn; keep ArchivedScopeControl's native select."*
The quote is real (`decisions.md:17805`) but it answered a **migration-
scope** question — how far the K106 `Select`→`Dropdown` sweep reaches and
whether `ui/Select` gets deleted — not a question about what control the
UI should use. Ken, on being told he had ruled for the native select:
*"?! who said i wanted to keep the native select?!?! i dont want it."*

This is CLAUDE.md's *"an answer to 'what scope?' is not an answer to
'what shape?'"* failing in practice, and it was repeated to Ken as his
own ruling before anyone read the surrounding paragraph. Check what
question a quoted ruling was answering before citing it as a constraint.

---

## UI-3 — Two "⋯" buttons on Board, at two different sizes

**Status:** fixed 2026-09-22 (uncommitted; Ken integrates)
**Fix:** both defects, together. `BoardOptionsMenu` is deleted; its two
deep links are now a "Configure" section inside the filter bar's single
⋯, passed via the new `FilterBar.extraMenuSections` prop (ownership call
recorded in `decisions.md` § 8). The page-level ⋯ is `size="sm"`,
matching "+ Add task" beside it. The per-column kebab is a new VERTICAL
glyph (`Icon name="moreVertical"`) so "this surface" and "this item" no
longer read as the same button. Re-measured live: one ⋯ on Board, at
24.50×24.50px, same as "+ Add task".
**Found:** 2026-09-22 (Ken)
**Severity:** cosmetic + structural. The size mismatch is the visible
symptom; the duplicate entry point is the deeper problem.

### What you see

The Board view's top-right corner has **two** overflow menus a few
pixels apart — "Board options" and "View options" — and they are
different sizes.

### Measured

Live, at 1440×900:

| Button | testId | Size |
|---|---|---|
| View options (FilterBar) | `view-actions-menu` | **28 × 28px** |
| Board options (BoardView) | `board-options-menu` | **24.5 × 24.5px** |
| Column options (×4) | `board-column-menu-*` | 24.5 × 24.5px |

All three render the same 16px `more` glyph; only the button box differs.

### Cause

`size` prop disagreement between two call sites, both using the same
`IconButton` primitive:

- `apps/web/src/client/list/FilterBar.tsx:693` — `size="md"` → 28px
- `apps/web/src/client/board/BoardView.tsx:710` — `size="sm"` → 24.5px
- `apps/web/src/client/board/BoardView.tsx:644` — `size="sm"` → 24.5px

Neither is "wrong" on its own; they were written by different work and
never compared, because they only ever appear side by side on Board.

### Two separate defects

1. **Sizes disagree** — a one-line fix once a target size is agreed.
2. **Two overflow menus at all** — "Board options" and "View options"
   are both "⋯" in the same corner, so the user cannot predict which
   holds what. Merging them is a design call, not a cleanup; it is the
   same consolidation UI-2 needs and probably wants deciding together.

Fixing (1) without (2) leaves two identical-looking buttons side by
side, which may read as *more* broken, not less.

---

## UI-4 — Archived scope: why the native `<select>` loses

**Status:** fixed 2026-09-22 (uncommitted; Ken integrates)
**Decision:** replace with a segmented (joined-button) control at **all
11 call sites**, on desktop and mobile alike.
**Built:** `ui/ArchivedScopeControl.tsx` is now a `role="radiogroup"`
with three `role="radio"` children; zero `<Select>` references remain.
The a11y contract below is implemented — verified in the failure
snapshot of an unrelated spec, which shows `radiogroup "Archived"` with
`radio "Active" [checked]`, `radio "Archived"`, `radio "All"`.
Its testid was later renamed `view-actions-archived-scope` →
`list-archived-scope`, since the control no longer lives in the
view-actions menu.

### Call sites

8 settings panels (`ProjectsPanel`, `UsersPanel`, `LabelsPanel`,
`MilestonesPanel`, `SprintsPanel`, `SavedViewsPanel`, `ViewFormDialog`)
plus `list/FilterBar.tsx` (×2, desktop menu + mobile Sheet) and
`milestones/MilestonesView.tsx`.

### The argument for keeping it native, and why it fails

`ui/ArchivedScopeControl.tsx:19-25` defends the native element on
accessibility grounds — real label association, keyboard-operable,
natively announced, and an OS wheel picker on phones. The first three are
true and are simply requirements the replacement must meet. The fourth
was the only real advantage, and Ken's two objections kill it:

1. **The mobile branch is viewport-width only.** `useIsNarrow`
   (`shell/useIsNarrow.ts:19-26`) is `matchMedia("(max-width: 639px)")`
   with an `innerWidth` fallback — **no touch or pointer detection**. A
   desktop window dragged narrow is classified "mobile", so a mouse user
   would get an OS wheel picker. Ken: *"on native, if you're using window
   size, then you might have a desktop with a mobile-sized window showing
   the select."* Confirmed in source.
2. **It cannot generalise to the controls beside it.** `FilterFacet` —
   the status/priority/assignee filters in the same row — is already a
   custom multi-select with `menuitemcheckbox` semantics
   (`ui/Dropdown.tsx:220`, `:281`). A native `<select multiple>` cannot
   produce that, so those can never be native. Keeping Archived native
   on mobile yields a filter row that is half OS-chrome and half
   app-chrome *on phones specifically*. Ken: *"what happens for complex
   selects we build, e.g. checkboxes/multi select? half native half
   custom will look bad too."*

The native picker's genuine strength is scrolling a long option list on a
phone. Archived has **three fixed options**, all of which a segmented
control shows at once with nothing to open — better on a phone, not a
concession.

### What the replacement must preserve

Paid once, in the primitive, since all 11 sites move together:

- `role="radiogroup"` with an accessible group name (today's visible
  `<label htmlFor>` becomes the group label)
- three `role="radio"` children with `aria-checked`
- arrow-key **selection-follows-focus**, Home/End, single tab stop
- the existing `data-testid` contract, so spec churn stays mechanical

Test churn: ~20 assertions currently read `HTMLSelectElement.value` and
move to `data-value` / `aria-checked`. That churn is the known cost, and
was accepted.

---

## UI-5 — Export's failure and skipped-row status render into a closed panel

**Status:** fixed 2026-09-22 (uncommitted; Ken integrates) — **REPRODUCED
first, then fixed**
**Found:** 2026-09-22 (UI-designer review, while assessing UI-2)

### The defect

`ExportMenu` is mounted *inside* the view-options `Menu` panel
(`list/FilterBar.tsx:724-726`). `ExportMenu.tsx:69` calls `setOpen(false)`
at the top of `run`. The failure text (`ExportMenu.tsx:185-198`) and the
skipped-row status (`:200-211`) render into a `<div className="relative">`
that is a child of that panel — and `Menu` unmounts its whole portal on
outside click (`ui/Menu.tsx:56-66`).

So when an export fails, the error and its **retry button** render into a
surface the user has very likely already dismissed. A status whose
lifetime is bounded by an unrelated popover is not a status.

### Why it matters independently of UI-2

The UI-2 redesign fixes this incidentally by routing outcomes to
`ui/Toast`. But the defect is real *today*, so it is recorded here rather
than left implicit in a redesign that may be sequenced later. If UI-2
slips, this still needs fixing.

**Superseded 2026-09-23 (K30-web).** The web export was removed
altogether, taking `ExportMenu` and this defect's whole surface with it.
The fix below was real and shipped first; it is now moot rather than
reverted. The durable lesson survives the deletion and is worth keeping:
**a status whose lifetime is bounded by an unrelated popover is not a
status** — outcomes of an action launched from a menu belong in the
global toast, because the launching surface is gone by the time the
outcome arrives.

### Verified — it reproduces

Driven in a browser at 1440×900 against the built client, with `fetch`
stubbed to return a 500 for `/api/tasks/export` only.

Immediately after the failed export: **1** `role="status"` carrying
"The CSV export could not be created: …", **1** Retry button, **1** open
menu panel. After a single click on empty page area: **0**, **0**, **0**
— and `document.body.innerText` no longer contained "could not be
created". The error and the only control that could act on it are
destroyed by a click anywhere else, with no way back short of re-running
the export. The panel does NOT survive; the speculation above is wrong.

### The fix

All three outcomes (pending, failure + retry, skipped rows) go through
`ui/Toast`, which is mounted by `AppShell` outside the menu's portal.
Re-running the identical gesture against the fix leaves the message and
its Retry in place. Note this makes Toast carry error content, which its
own docstring disclaims — recorded and flagged in `decisions.md` § 8.

---

## UI-6 — Board has no Export; List does

**Status:** **moot / closed 2026-09-23 (K30-web).** Ken removed the
CSV/JSON export from the web UI entirely — it now lives only on the CLI
(`loctt export`) and the MCP `export_tasks` tool. The parity gap this
entry describes is closed by the List side going away, not by the Board
side being built. The analysis below is left as the record of why a
board export *would* have been coherent, had the feature stayed; nothing
in it needs acting on. The "that comment is not a ruling" point stands
resolved: there is now a real `decisions.md` citation (K30-web), and the
comment it criticised is gone with `ExportMenu`.

**Original status:** backlog (Ken, 2026-09-22: *"add to our backlog"*)
**Severity:** small capability gap. A workaround exists (switch to List
with the same filters), so nothing is stranded.

### What you see

The Board view's "⋯" menu has `Save as view` and `Configure`, but no
`Export` section. List's has all three. **Pre-existing** — not caused by
the 2026-09-22 menu rework.

### Cause

`BoardView.tsx`'s `FilterBar` mount passes no `exportTotal` /
`exportQueryString`, so `FilterBar` renders no export section. An inline
comment there asserts *"export is omitted (the board has no export
surface)"*.

**That comment is not a ruling.** There is no `decisions.md` entry behind
it. It was read as settled precedent during the 2026-09-22 review; it is
one agent's comment, and it should be deleted or replaced with a real
citation whichever way UI-6 lands.

### What the code actually supports

The PM review (2026-09-22) checked the premise and it does not hold:

- Board reads the **same URL filter vocabulary** as List
  (`BoardView.tsx:47-48`, BRD-1/BRD-14) and mounts the **same
  `FilterBar`** that already owns `ExportMenu` (`BoardView.tsx:344`).
- Board grouping (columns/swimlanes) is **presentation only**. No
  board-specific filter dimension exists, so a board export would mean
  exactly what a list export means — same filter, same rows.
- Board already computes both values List passes: `search`
  (`BoardView.tsx:51`) and its feed's total (`:558`).

So this is **prop-threading, not a new capability**. The framing "should
Board gain export?" overstates it.

### Also found while checking parity

**MCP has no export tool at all** — no `export`-named handler under
`apps/mcp/src/tools/`. CLI has `task-export.ts` with
`--query`/`--view`/`--project`. So CLAUDE.md's *"a capability in core is
not done until CLI and MCP have it"* is **already unmet for export on
every surface**, independent of Board. That is the larger gap and wants
its own entry; recorded here so it is not lost.

### When picked up

Deleting or rewriting the `BoardView.tsx:339-341` comment is required
either way — it is false as written, since it states a rationale no
decision records.

---

## UI-7 — Task-detail meta rows are 74% taller when the value is two words

**Status:** fixed 2026-09-22 (uncommitted)
**Fix:** `task/MetaPanel.tsx` — `Row`'s grid is now
`grid-cols-1 sm:grid-cols-[72px_minmax(0,1fr)]` (mobile: label above
value, own row, per Ken's ruling; desktop: the label column trimmed from
80px to 72px, the measured max label width + a small margin). The
row-height doubling itself was **not** a column-width problem — see
"Correction to the original sweep finding" below, added during the fix —
it was `ui/Dropdown`'s trigger root (`relative inline-flex`) never
stretching to fill its container regardless of that container's width.
Fixed with a child-selector on `dd` (and, for Assignee/Reporter, the
avatar-row wrapper): `[&>.relative.inline-flex]:flex
[&>.relative.inline-flex]:w-full`, applied from `MetaPanel.tsx` since
`ui/Dropdown.tsx` is a shared primitive out of this change's scope.
Re-measured live: `In progress`/`v1.0 Launch`/`Sprint 1` all now
**24.50px** at 1440×900 (was 42.67px), matching `Bug`/`High`. At
375×812 every row is a uniform **46.59px** (label line + gap + value
line, stacked), regardless of word count. No truncation, no new
primitive. Full detail in `decisions.md` § 8, A286.
**Found:** 2026-09-22 (sweep)
**Severity:** real-UX. Five of seven meta fields are affected, so the
right-hand panel's vertical rhythm is visibly uneven on most tasks.

### What you see

On a task detail panel, `Status`, `Assignee`, `Reporter`, `Milestone`
and `Sprint` rows are noticeably taller than `Type` and `Priority`.

### Measured (verified independently, 1440×900)

| Value | Row height |
|---|---|
| `In progress` | **42.67px** |
| `v1.0 Launch` | **42.67px** |
| `Sprint 1` | **42.67px** |
| `Bug` | 24.50px |
| `High` | 24.50px |

Same button, byte-identical class string. The inner
`<span class="min-w-0 flex-1">` measures 37.17px vs 18.59px.

### Cause — the value wraps, because its container is ~61px wide

The value span is **60.9px** wide. `Range.getClientRects()` on the tall
row returns **two line boxes** — `In` (10.9px) then `progress` (53.4px)
— at `line-height: 18.59px`, giving 37.17px. Forcing
`white-space: nowrap` collapses the row to **24.50px**.

`apps/web/src/client/task/editors/OptionPicker.tsx:150` — the
`min-w-0 flex-1` value span. Affects the five fields that route through
it (`task/MetaPanel.tsx:257,266,277,311,355`).

### Correction to the original sweep finding

The sweep reported the cause as `inline-flex` + `break-words`
"reserving a second line-box at the first space", evidenced by a text
swap (`In progress` → `Inprogress` → 24.5px).

**That does not reproduce.** Re-running the swap here, `Inprogress`
(no space) and `Supercalifragilistic` (longer, no space) both stayed at
**42.67px**. The space is not the trigger, and the wrapper is not the
mechanism — the tall row's span contains a **bare text node**, not the
`inline-flex` element the sweep named, so its proposed fix would have
edited an element that is not in that row's render path at all.

The mechanism is simply that the column is too narrow for two words.
Recorded because the two diagnoses lead to different fixes.

### Second correction, found while fixing: the column was not too narrow either

The above diagnosis ("the column is too narrow for two words") was
itself incomplete, discovered live while implementing the fix. Forcing
`ui/Dropdown`'s trigger wrapper (`relative inline-flex`, the `dd`'s
direct child) to `display: flex; width: 100%` collapsed the row to
24.50px **at the existing, un-widened 163px column** — no column change
needed. Separately, widening the grid column from 80/163px up to
200px+ with the wrapper left alone had **no effect** on the wrap.
So the actual mechanism was that the wrapper is shrink-to-fit and never
stretches to its container, independent of how wide that container is —
the column width was never the binding constraint. Both diagnoses (the
sweep's `inline-flex`/`break-words` claim, and this file's own
"the column is too narrow" claim) missed the same kind of thing: neither
was checked by resizing the actual constraining element and observing
the effect before writing down a cause.

### Decided and built

Ken's ruling (2026-09-22): *"allow responsiveness to kick in: allow it
to take up its own row on mobile perhaps? if on desktop, we could
consider making columns wider."* Built as: mobile (<640px) stacks label
above value (`grid-cols-1`), desktop keeps two columns with the label
column trimmed 80px→72px (freeing width for the value column, per
"wider columns" — though the wrap itself is fixed by the stretch fix
below, not by the width change). The stretch fix — forcing `Dropdown`'s
trigger wrapper to fill its column via a child-selector on `dd` — is
the fix that actually removes the two-line wrap; see `decisions.md` § 8,
A286 for the full mechanism and both diagnoses' correction. No
truncation, no new primitive, per the ticket's constraints.

---

## UI-8 — Board card vertical gaps are exactly double the horizontal gutter

**Status:** fixed 2026-09-22 (uncommitted)
**Fix:** option (1) below, as recommended and as Ken ruled ("space-y-0 +
gap on the card"). `board/BoardView.tsx`'s column scroll container is
now `space-y-0`; each card is wrapped in its own `<div className="mb-2">`
(the file's `.map` over `rest`) since `BoardCard` itself takes no
`className` and its file is out of this change's scope. `SkeletonCard`
gained a `className` prop (default `mb-2`) so the loading state's own
spacing matches, with the last of the three skeletons passed `mb-0`.
Re-measured live at 1440×900: card-to-card gap is now **7px**, matching
the horizontal gutter (was 14px). Drag animation verified with real
`PointerEvent`s: the active indicator grew from 0 to its `h-10` steady
state under the `transition-all duration-150` class, not a teleport, and
cleanly deactivated on `pointerup`. Full detail in `decisions.md` § 8,
A285.
**Found:** 2026-09-22 (Ken, by eye: *"the x margins look good, but the
vertical margins are bad: taller than the x-margins are wide"*)
**Severity:** cosmetic, but it is the dominant rhythm of the board's
main surface, so it reads as "loose" on every column.

### What you see

Board cards sit 7px from the column's left and right edges, but 14px
apart from each other. The column reads vertically airier than it does
horizontally.

### Measured (1440×900, Backlog column)

| | |
|---|---|
| Horizontal gutter (card → column edge) | **7px** |
| Card-to-card vertical gap | **14px** |

Consistent across all 8 card-to-card gaps in the column — no variance.

### Cause — a collapsed drop indicator still takes a margin

`board/BoardView.tsx:1021` — the scroll container is `space-y-2 p-2`.
At the 87.5% root, `p-2` = 7px (the horizontal gutter) and `space-y-2`
= 7px (the intended vertical gap).

But the list does **not** contain only cards. `DropIndicator`
(`board/BoardView.tsx:1094-1104`) is rendered **between every pair of
cards** and is deliberately always present — its docstring explains
why: height is animated 0 ↔ open "so moving the pointer between two
positions slides the gap instead of removing one element and inserting
another", which a case rules out.

At rest it is `h-0`, so it is invisible — but it is still a flow
sibling, so `space-y-2` gives it a 7px top margin of its own. Measured
DOM: the Backlog column holds **9 `<article>` cards and 10 indicator
divs**, 19 children total. Every card-to-card distance is therefore
card margin 7px + indicator margin 7px = **14px**.

### Is it deliberate?

**No.** The always-rendered indicator is deliberate and well-reasoned;
its interaction with `space-y-*` is not mentioned anywhere, and the
doubling serves no purpose at rest. Ken's read — *"if 2 cards stack
then the y margins add up"* — is the right mechanism; the second
margin just belongs to a hidden element rather than to the other card.

### Options

1. **`space-y-0` on the list, own the gap on the card** (e.g. `mb-2`),
   so a zero-height sibling contributes nothing. Keeps the animation.
2. **Negative margin on the collapsed indicator** (`-mt-2` when
   inactive) to cancel the inherited one. Works, but encodes the
   spacing constant in two places.
3. **Flex column with `gap-2`** — `gap` applies between *rendered*
   boxes, but a 0-height child still counts as a box, so this alone
   does **not** fix it. Noted to save the next person the experiment.

Recommend (1). Untested — do not apply without measuring, and check a
live drag still animates.

---

## UI-9 — A saved view with unparseable DSL 500s the task list

**Status:** fixed 2026-09-22 (uncommitted; Ken integrates)
**Fix:** `FilterError` (`packages/core/src/query/filters.ts:24`) is a
plain `Error`, like `ViewError`, so — per Ken's ruling ("go with most
robust way -> see what we do for other errors and standardise") — it is
now listed explicitly at all three surface registries: web's
`isQueryError` (`apps/web/src/server/server.ts`), CLI's
`KNOWN_DOMAIN_ERRORS` (`apps/cli/src/runtime/errors.ts`), and MCP's
`isKnownDomainError` (`apps/mcp/src/runtime/errors.ts`). This is the
same treatment `ViewError` already has at all three, and requires no
change to the read/write path split in `list.ts`/`manage.ts` — see
`decisions.md` § 8 A284 for why rethrowing as `ViewError` on the read
path was considered and rejected (it would require `query/` to import
from `views/`, a dependency direction that does not exist anywhere in
the codebase and would very likely cycle, since `views` already imports
FROM `query`). `GET /api/tasks?view=<broken>` now returns
`{"code":"validation_failed","message":"advanced filter does not parse:
…","field":"query","recovery":{"kind":"none"}}` — the real message, no
Retry control. Verified manually against the seeded playground tracker's
"Broken view" (`01M33FP00000000000000000A6`) and with three new
red-proven tests (`server.view-unparseable-dsl.test.ts`,
`filter-error.test.ts`, `list-tasks-broken-view.test.ts`).
**Related gap, since closed (2026-09-23):** `GET /api/views` used to
report this class of view as healthy — see "Related: the broken-view
apparatus never fires" below. `packages/core/src/config/queries.ts`
`resolveFilters` now also runs `filtersToNode` on each entry's
shape-validated filters, so a DSL parse failure degrades to
`BrokenSavedQuery` the same way a shape failure does; see
`known-gaps.md`'s "RESOLVED" update to that entry and `decisions.md`
§ 8 for the record.
**Found:** 2026-09-22 (sweep); independently reproduced

### What you see

Click a saved view whose advanced filter does not parse (the seeded
"Broken view"). The task list is replaced by:

> The server failed while handling GET /api/tasks.  **[Retry]**

The Retry button can never succeed — the view will not parse on the
next attempt either.

### Reproduced

```
GET /api/tasks?view=<broken view id>
{"code":"unknown",
 "message":"The server failed while handling GET /api/tasks.",
 "recovery":{"kind":"retry"},
 "detail":"advanced filter does not parse: expected value but got \"=\" at position 9"}
```

The server **knows the exact fault** and puts it in `detail` — which the
client does not render. It is classified `unknown` with a `retry`
recovery, both wrong: it is a known, user-actionable config error, and
retrying is futile.

### Surface parity — the CLI is better

```
$ loctt list --view "Broken view"
Error: advanced filter does not parse: expected value but got "=" at position 9
```

The CLI gives the actionable sentence. The web UI gives "the server
failed". Same tracker, same view, same core.

### Cause — asymmetric handling of `FilterError`

`filtersToNode` throws `FilterError`
(`packages/core/src/query/filters.ts:133`).

- **Write path wraps it**: `packages/core/src/views/manage.ts:145-150`
  catches and rethrows as `ViewError`, which the surfaces do map.
- **Read path does not**: `packages/core/src/query/list.ts:285` calls
  `filtersToNode(view.filters)` bare, so `FilterError` escapes as an
  unhandled error and the web layer's catch-all classifies it
  `unknown`.

### The deeper finding

**`FilterError` is consumed by no surface at all.** It is exported
(`packages/core/src/index.ts:362`) and referenced nowhere in
`apps/web/src`, `apps/cli/src` or `apps/mcp/src`. The CLI's good message
is incidental — a generic handler printing `err.message`, not
recognition of the error type. MCP's `isKnownDomainError`
(`apps/mcp/src/runtime/errors.ts`) does not list it either, so an agent
hitting a broken view gets an opaque server fault.

This is CLAUDE.md's *"a capability in core is not done until CLI and MCP
have it — a core export no surface calls is unfinished, not done"*,
happening verbatim.

### Related: the broken-view apparatus never fires (was N-2) — RESOLVED 2026-09-23

`GET /api/views` used to return "Broken view" as an ordinary healthy
view, with no `broken` array. Classification was a Zod **shape** check
(`packages/core/src/config/queries.ts` `resolveFilters`) that accepted
any string as an advanced query; the DSL was never parsed at load.

So `SavedViewsPanel`'s whole broken-row apparatus — the marker, the raw
YAML disclosure, Replace, the inert-Save gate — was **unreachable for
this defect class**. That machinery was built and tested against
*shape*-invalid entries only.

**Fixed:** `resolveFilters` now additionally runs `filtersToNode` on the
shape-validated filters; a `FilterError` (unparseable DSL, or an
uncombinable simple filter) degrades the entry to `BrokenSavedQuery`
exactly like a shape failure, carrying the parser's message and
`position` when available. Verified against the seeded playground
tracker's "Broken view" (`01M33FP00000000000000000A6`): `GET /api/views`
now returns it under `broken`, not `queries`. See `known-gaps.md` and
`decisions.md` § 8 for the full record, including the two run-path tests
(`server.view-unparseable-dsl.test.ts`,
`list-tasks-broken-view.test.ts`) that asserted the old (broken)
classification and now need updating to match — flagged for Ken/next
session since they sit outside this change's file scope.

### Note on an earlier session claim

This is the same distinction recorded for VUE-22: a shape-VALID advanced
filter with malformed DSL "loads healthy". That was recorded as correct
behaviour for the *loader*. It is now clear the consequence — a 500 on
read with no path to recovery — was never followed through to the read
path.

## UI-10 — Six settings-panel headers built six different ways (N-4)

**Status:** fixed 2026-09-22 (uncommitted; Ken integrates)
**Fix:** new `settings/SettingsPanelHeader.tsx`, a thin wrapper over
`ui/PageHeader.tsx`, applied to `ProjectsPanel`, `UsersPanel`,
`LabelsPanel`, `MilestonesPanel`, `SprintsPanel`, `SavedViewsPanel`. See
`decisions.md` § 8 for the (a)-vs-(b) reasoning and the five converged
axes.
**Found:** 2026-09-22 (audit, cross-referenced against Ken's "converge on
one, consider making a shared component" ruling, 2026-09-22)
**Severity:** cosmetic but structural — six near-identical panels that
should read as one family instead read as five different ones, and two
were missing the `data-testid` several specs rely on.

### What you saw

The six settings config-list panels (Projects, Users, Labels, Milestones,
Sprints, Saved views) shared an identical title string position
(464, 76 at 1440×900) but diverged on everything else:

| Panel | Title testid | Title colour token | Title margin | Create placement | Create variant | Control height |
|---|---|---|---|---|---|---|
| Projects | missing | missing | `mb-1` | below list | primary | 28px |
| Users | missing | missing | none | below list | primary | 28px |
| Labels | present | present | `mb-1`/`mb-2` (2 sites) | own row below title | secondary | 28px |
| Milestones | present | present | `mb-1`/`mb-2` (2 sites) | own row below title | secondary | 28px |
| Sprints | present | present | `mb-1`/`mb-2` (2 sites) | own row below title | secondary | 28px |
| Saved views | present | present | `mb-2`/none (2 sites) | title row | primary | **24.5px** |

Root font is 87.5%, so `h-7` (24.5px) and `h-8` (28px) look identical in
markup review and only differ when measured live — Saved views was the
one outlier at `size="sm"`.

### Measured, before → after (live, 1440×900, rebuilt client)

Title position was already uniform at (464, 76) on all six — the drift
was in the create action, not the title:

| Panel | Create button y (before) | Create button y (after) | Height (before) | Height (after) |
|---|---|---|---|---|
| Projects | 373 (below table) | **76** | 28px | 28px |
| Users | 471 (below list) | **76** | 28px | 28px |
| Labels | 193 (own row) | **76** | 28px | 28px |
| Milestones | 212 (own row) | **76** | 28px | 28px |
| Sprints | 212 (own row) | **76** | 28px | 28px |
| Saved views | 76 (title row) | **76** | 24.5px | **28px** |

### The five converged axes

1. **Title markup** — `<h1 data-testid="settings-panel-title"
   className="mb-1 text-lg font-semibold text-text-primary">`. This is
   NOT `PageHeader`'s own `text-[1.0714rem]` main-view size — see the
   (a)-vs-(b) note below — it is the size the wider settings family
   (`WorkflowPanelFrame`, `BackupPanel`, `DiagnosticsPanel`,
   `GitSyncPanel`, `SidebarGroupsPanel`) already used. Projects and Users
   were missing the testid and colour token entirely; both gained them.
2. **Spacing below the title** — `mb-1` (~3.5px at 87.5% root), the
   majority convention. The two-header-site panels' error-state `mb-2`
   was dropped to `mb-1` to match.
3. **Create-action placement** — the title row (`PageHeader`'s `actions`
   slot), matching Saved views' pre-existing shape. Projects/Users moved
   up from below-list; Labels/Milestones/Sprints moved up from their own
   row under the description.
4. **Button variant** — `primary`. No design-system rule distinguished
   these; picked because in every panel the create action is the page's
   only persistent call-to-action. Labels/Milestones/Sprints moved from
   `secondary`.
5. **Control height** — 28px (`Button`'s `md` default, `h-8`). Saved
   views dropped its explicit `size="sm"` (`h-7`, 24.5px).

### Why a wrapper (`SettingsPanelHeader`), not `PageHeader` directly

`PageHeader`'s title class is `text-[1.0714rem]` (measured 15.0px at
87.5% root) — the size List/Board/Timeline already shared. The settings
family outside this ticket's scope already converged on a DIFFERENT,
also-consistent size: `text-lg` (measured 15.75px), on five sibling
panels (`WorkflowPanelFrame`, `BackupPanel`, `DiagnosticsPanel`,
`GitSyncPanel`, `SidebarGroupsPanel`). Pointing the six ticketed panels
at `PageHeader` verbatim would have fixed the six-panel drift by opening
a NEW eight-panel split — six panels at 15.0px, five at 15.75px — inside
Settings. `SettingsPanelHeader` reuses `PageHeader` for the actual shared
mechanics (`items-start` row, actions slot, `min-h-7`) while keeping the
title at the size the *rest of Settings* already uses, and puts
`data-testid="settings-panel-title"` on the `<h1>` itself (matching
every existing consumer of that testid), not on `PageHeader`'s wrapping
`<header>`.

### Out of scope, left alone

`Backup`, `BoardColumns`, `Calendar`, `CardLayout`, `CustomFields`,
`Diagnostics`, `EnumCollection`, `Estimation`, `GitSync`, `Keyboard` —
not in N-4's file set. `WorkflowPanelFrame`'s five sub-panels already
converge on their own `text-lg` header (with no create-in-header need),
which is the convention `SettingsPanelHeader` matched onto rather than
replaced.

---

## UI-11 — Focus ring clipped on the last control in a dialog body

**Status:** fixed 2026-09-22 (uncommitted; Ken integrates) — see
`decisions.md` § A292
**Found:** 2026-09-22 (Ken, screenshot of Edit milestone)
**Severity:** real-UX (a11y) — the focus ring is the app's only keyboard
affordance, and this cuts it on the control most likely to be tabbed to
last.

### What you see

Open Edit milestone and focus the Target date field. Its focus ring is
visibly cut off — flush against the dialog's left edge and sliced along
the bottom where the body meets the footer divider.

### Cause — the horizontal fix exists; the vertical one does not

`ui/Modal.tsx:121` wraps the dialog body in
`-mx-4 min-h-0 flex-1 overflow-y-auto px-4`.

The comment above it (`:117-119`) names this exact bug class:

> `-mx-4 px-4` so the scroller spans the panel's full width:
> `overflow-y-auto` also clips horizontally, which would slice the focus
> ring off a control at the body's edge.

So the **horizontal** axis was already found and fixed, by pulling the
scroller out with a negative margin and restoring the inset with
padding. There is **no vertical equivalent** — the scroller has `px-4`
and no `py`, so `overflow-y-auto` clips the ring of a control at the
**bottom** of the body exactly as it would have at the sides.

The global ring is `outline: 2px` at `outline-offset: 2px`
(`styles/index.css:177-180`), so it needs **4px** of clearance beyond
the control's border box. The last control in the body has none.

### Why the date field specifically

Nothing about `<input type="date">` is special — it is simply the last
control in this dialog's body, so it is the one sitting against the clip
boundary. **Any** dialog whose final body control can take focus has
this, which makes it a `Modal` defect rather than a milestone one.

### Fixed 2026-09-22 — see `decisions.md` § A292

`Modal`'s scroller gained `-my-2 py-2`, the vertical half of its own
`-mx-4 px-4` idiom. Measured on Edit sprint's Goal textarea: bottom
clearance **0px → 7px**.

The concern below was real and was measured rather than reasoned
about. Two things had to be checked, and both held:

- **Does padding inside a scroller survive scrolling?** Yes —
  `scrollHeight` includes both paddings, so it bounds the scroll range
  and is never scrolled past. Measured in an isolated harness: a
  scroller with 16px padding, scrolled fully to the end, kept 15.98px
  below its last child. This is why the fix is padding *inside* the
  scroller and not a gap outside it.
- **Does it re-strand the footer?** No. With a 900px spacer forcing
  overflow on the live Edit sprint dialog: panel height 872px against
  its `max-h` cap of 872px (at cap, not past it), scroller scrolling,
  Save inside the panel and within the viewport, last control retaining
  7.21px at full scroll.

`py-2` rather than `py-1`, because this app sets a **14px root font
size** and Tailwind's spacing is in `rem`: `py-1` resolves to 3.5px —
*under* the ring's 4px — and would have looked like a fix while still
clipping. `py-2` is 7px.

### Confirmed across three primitives (2026-09-22)

Ken reported it a second time, on **Edit sprint**'s Goal textarea — a
different control in a different dialog, with the clipping unmistakable:
the ring's left and bottom edges are cut flat while its top and right
stay rounded.

That second report settles the diagnosis: it is **not** specific to
`<input type="date">`. It is whichever focusable control sits last in
the body.

Scope, verified:

| Primitive | Scroller | Ring clipping |
|---|---|---|
| `ui/Modal.tsx:121` | `-mx-4 … overflow-y-auto px-4` | Horizontal fixed; **vertical still clips** |
| `ui/Sheet.tsx:112` | `… overflow-y-auto p-4` | ~~No compensation on any edge~~ — **WRONG, see correction** |
| `ui/ResponsiveDialog.tsx` | delegates → `Dialog`/`Modal` desktop, `Sheet` mobile | Inherits both |

`SprintEditDialog.tsx:130` uses `ResponsiveDialog`, which is why Ken hit
it there.

**Correction (2026-09-22): the `Sheet` row above was wrong.**

I wrote "No compensation on any edge" from reading the class name. `p-4`
is padding on **all four sides** — which is exactly the compensation
`Modal` was missing on its vertical axis. Measured on the live
list-filter sheet: **14px clearance on all four edges**, for the first
and last control, and **14.1px** with the body scrolled fully to the
bottom. `Sheet` was never clipping, and the "`Sheet` is the worse case"
conclusion that followed from my row is also wrong.

Also measured: Ken's "cut flat on the left and bottom" was **bottom
only**. Left/right had 14px — `Modal`'s `-mx-4 px-4` working. The left
edge reads flat because of the corner radius against the panel edge, not
a clip.

Both errors came from inferring behaviour from class names instead of
measuring. That is the same mistake as the scroll-restoration retraction
in UI-12, twice in one ticket.

Fix at the primitives, not the call sites. `Modal`'s own comment already
states the principle; it was simply applied to one axis in one of the
three.

> **Correction (2026-09-22, measured):** the `Sheet` row above is
> **wrong**, and the sentence that followed it — "`Sheet` is the worse
> case — it never got even the horizontal fix" — was wrong with it. The
> claim was made from reading class names; measuring the live
> list-filter sheet shows `p-4` giving **14px on all four edges** for
> both the first and last control, and **14.1px** retained when scrolled
> fully to the bottom of an overflowing body. `p-4` is `padding` on
> every side, so `Sheet` had the clearance `Modal` lacked — it was never
> clipping. `Sheet`'s className was therefore **not changed**; it gained
> only a comment recording that its `p-4` is load-bearing, since
> narrowing it to `px-4` would be a plausible tidy-up that opens UI-11
> on the mobile branch. Left above as written, because the row is what
> the fix had to disprove.

---

## UI-12 — No way back from a task to the view you came from

**Status:** fixed 2026-09-22 (uncommitted; Ken integrates)
**Built & verified live:** cold load of `/tasks/WEB-1` renders **no**
back control (Ken's ruling); entering from `/list?status=in_progress`
renders `← Back to list` whose href is `/list?status=in_progress` —
the filter preserved. Whole-row click landed too, via a guarded
`onClick` rather than a stretched-link (a stretched link also swallows
drag-to-select). Scroll restoration needed NO change — see the
retraction below.
**Found:** Ken, 2026-09-22

### What you see

> "if i go from a project/view to a task, there's no back button to go
> back to where i came from. and going back needs to maintain the
> 'state' e.g. what filters, what scroll, etc? so it feels like im
> jumping back to where i came from"

### Three separate problems, verified

1. **No back affordance on task detail.** `task/TaskDetail.tsx` has
   none. The pattern exists elsewhere — `milestones/MilestoneDetail.tsx:180`
   renders `← All milestones` — so detail views do this; task detail
   never got it.
2. **That precedent does not solve Ken's ask either.** `← All
   milestones` is a **hardcoded destination**. Reach a milestone from
   the timeline and it still returns you to `/milestones`.
3. ~~**No scroll restoration anywhere.**~~ **WRONG — retracted.**

   I wrote: *"`router/index.tsx:360` sets `defaultPreload` and nothing
   else; `scrollRestoration` is never configured… an unset flag, not a
   hand-rolled feature."* Every clause of that is false.

   `shell/useMainScrollRestoration.ts` already implements it, wired into
   `AppShell`'s `<main>` pane. And `router/index.tsx:363-370` — the
   lines immediately after the one I cited — explain why the router
   option is deliberately NOT set:

   > "The option resolves the saved element by selector at restore time,
   > and the main pane's rows mount after the route change, so the
   > element it finds has no height yet and the assignment is discarded.
   > Enabling it as well would install a second mechanism that silently
   > loses to the first."

   Verified working: scrolled the list to 1000px, opened a task, browser
   Back, `scrollTop` restored to exactly 1000.

   **How I got it wrong:** I grepped for `scrollRestoration`, found no
   assignment, and concluded "unset flag" without reading the comment
   sitting three lines below the match. Had the implementing agent
   followed the ticket, it would have enabled the option and installed
   the exact competing mechanism that comment warns against.

   The lesson is the one this session keeps re-teaching: **absence of a
   symbol is not absence of the feature.** Read the surrounding lines
   before concluding something was never built.

**Filter state is already fine.** The URL is the single source of truth
(`list/FilterBar.tsx` docstring: every control reads typed search params
and writes back through `navigate`), so `/list?status=in_progress`
round-trips today and filters already survive browser Back. Only scroll
position and the in-app affordance are missing.

### Ken's rulings (2026-09-22)

**Back target:** *"fall back to the route i came from. if cold load then
no back button"*.

So: track the origin route including its search params and return there
exactly. On a cold load — direct link, refresh, a shared URL — there is
no origin, and the affordance is **not rendered at all**. No fallback
destination, no disabled button. A back control that goes somewhere you
have never been is worse than no control.

**Row click:** *"Whole row clickable"* — the whole task row navigates,
not just the key.

### Notes for the build

- Whole-row click must not break: text selection inside a cell,
  modifier-click / middle-click to open in a new tab, and the row's own
  interactive children (kebab, checkbox, inline editors) which must stop
  propagation.
- The same row-click question applies to `MilestoneDetail`'s task table
  (`MilestoneDetail.tsx:348`, currently key-only), which is where Ken
  first raised it.
- Scroll restoration and the back affordance are independent; either can
  land without the other.

---

## UI-13 — Two create-task buttons, two labels, two styles

**Status:** fixed 2026-09-22 (uncommitted; Ken integrates)
**Built:** the board's duplicate "+ Add task" is gone (zero
`board-add-task` references). The empty-state button was kept and
relabelled "+ New task". NEW-3 retired and scrubbed; NEW-1 and two other
case references amended; `cases:check` green at 1056 cases.
**Found:** Ken, 2026-09-22 (screenshots of the board header)

### What you see

On `/board`, two create affordances sit ~200px apart:

- Header: **"+ New task"**, primary (bright green)
- Board header: **"+ Add task"**, secondary (muted)

Different wording, different weight, same action.

### They are the same action

`board/BoardView.tsx:327-333` calls `createTask.open()` — **the identical
function** the header button calls (`shell/Header.tsx:139`). Same modal,
same fields, same result.

### The context-prefill Ken proposed already exists

Ken asked whether the header button could "use the currently-navigated
project as the pre-filled project, OR just fallback to the default".

**That is already the behaviour (PRU-4).** `create/CreateTaskModal.tsx:110-130`
reads the route via `useRouterState` and pre-selects the scoped project
when the route scopes to exactly one, falling back otherwise. It is
deliberately route-agnostic so it works from list, board and timeline
alike. So the board button adds nothing the header lacks.

### Ken's rulings (2026-09-22)

1. **Remove the board's "+ Add task"**, and amend the case (below).
2. **"New" is the house term** — "+ New task" everywhere. The sidebar
   already says "+ New project", "+ New view", "+ New milestone";
   "Add task" was the outlier.
3. **Button style:** delegated to a UI designer.

### This contradicts a BLOCKER case — amend, do not silently delete

`tests/cases/ui-test-cases/flow-task-create.md:15-20`, **NEW-1
(blocker)**, reads: *"All three entry points open the same modal. Open
it from the header `+`, then from a board column's '+ Add task', then
with `n`."*

Removing the button drops one of three named entry points. NEW-1 must be
amended to two (header `+`, and `n`), and its spec updated with it. Per
CLAUDE.md this is a recorded scope change, not a cleanup.

Note the case says *"a board column's"* — per-column create controls were
built and removed in M3.1 (they broke BRD-42 when a column rendered for a
status `workflow.yaml` no longer declared). The case text is already
stale on that point.

---

## UI-14 — Icons could carry a colour; emoji cannot (and the code already knows)

**Status:** open — Ken's rule confirmed already implemented; the feature
it implies is not built
**Found:** Ken, 2026-09-22: *"perhaps icons can also have colours as part
of it, but emojis, just use the emoji itself (because we can't add
colour)"*

### The rule is already in the code, verbatim

`ui/IconEmojiPicker.tsx:149-154` — `IconGlyph`'s `color` prop:

> "The resolved colour, when the host has one. Applies ONLY to a Lucide
> glyph — an emoji carries its own colour and is never tinted, which is
> the rule the colour control's disabled state mirrors."

A Lucide icon is a stroked SVG inheriting `currentColor`, so it takes a
tint; an emoji is a pre-coloured glyph that cannot. Ken's distinction and
the implementation agree.

### But nothing passes it

`IconGlyph` has **zero consumers outside its own file**. The `color` prop
is built and unused — the "built is not adopted" pattern
`design-review.md` records.

The reason: saved views have an `icon` (K104) but **no colour field**.
There is nothing to pass.

### So this is a feature, not a fix

Giving saved views (and any other icon-bearing entity) a colour means:
contracts + core + CLI/MCP parity + a corruption-handling pass, per
`corruption-handling-guide.md`. K103's colour model already supports all
three shapes, so the model exists — the field does not.

Related: UI-6 records that projects show a *fake* uniform dot with no
colour field, and sprints/milestones have neither. Whether icon-bearing
and dot-bearing entities should gain real colours is one question, not
four. Worth deciding together rather than per-entity.

---

## UI-15 — The colour picker stacked four blocks at equal weight

**Status:** fixed 2026-09-22 (uncommitted; Ken integrates)
**Found:** 2026-09-22 (Ken, screenshot of the Labels colour picker) —
*"this is messy? i feel like there's a better way to edit colours. and i
want more than just those. maybe 16-20 colours, and they must be
distinct (the last 2 colours here look like each other)"*
**Severity:** real-UX — the picker is the only way to set an entity
colour in the web app, and it is reached from four dialogs.

### What you saw

The panel gave **four sibling blocks equal visual weight**:

1. a one-row "Palette" strip of 7 swatches,
2. a "Custom" row holding two tiny native colour wells (Light / Dark),
3. a full-width "Use custom colour" button,
4. a "No colour" text row hanging off the bottom.

Nothing in that stack said which one was the point. At 7 swatches it was
merely busy. The palette expansion to 18 (A288) would have made it worse,
not better: the strip would wrap into a ragged block while three
non-palette affordances kept equal billing beneath it.

Ken's second complaint was a separate, verified defect — `slate` and
`gray` were **4.10 ΔE apart in light and 2.31 in dark**, at or below the
just-noticeable difference. See A288 and the palette section of
`known-gaps.md`.

### The fix — decide what the panel is FOR

It is for picking a palette colour; that is the common case by a wide
margin. So the palette gets the space and everything else steps back:

- **A real grid, six across.** 18 entries land as an even 3×6 block.
  Six columns keep the panel at its existing 248px, which is what makes
  it fit a 375px phone — verified live at x=14→262 in a 375px viewport,
  no overflow, no document horizontal scroll.
- **"No colour" became the FIRST CELL of that grid**, a slashed swatch
  with `role="radio"` — one of the choices, shown as one. As a trailing
  text row it read as an afterthought, which is a fair share of what
  "messy" was pointing at.
- **Custom moved behind progressive disclosure** — one `aria-expanded`
  row that unfolds the wells and the apply button on demand. It opens
  up-front only when the stored value already IS custom, because hiding
  a user's own current value is worse than the clutter it saves.

### The native colour wells were kept, deliberately — see A289

This is the one part that runs against UI-4's direction, so the argument
is recorded in full in decision A289 rather than summarised here. Short
version: both of UI-4's objections were specific to `<select>` (a
viewport-width branch, and `<select multiple>` being unable to match the
custom controls beside it) and neither reaches `<input type="color">`,
which has no width branch and no sibling primitive to clash with.
Building a hue/saturation canvas for one call site is the
"invent a new primitive" that `design-review.md`'s "built is not
adopted" finding warns against. The well was **demoted, not defended**
— it is no longer prominent, which was the actual complaint.

**Open for Ken:** if the native well should go on principle regardless
of the above, that is a separate and considerably larger build.

### A11y contract the fix establishes

- `role="radiogroup"` over `role="radio"` cells with `aria-checked`
  (these are mutually exclusive choices over one value).
- **Two-dimensional roving focus**, one tab stop: Left/Right by one,
  Up/Down by a full row, Home/End to the ends, clamped not wrapped.
  Tabbing through 18 swatches is a penalty, not navigation.
- **Movement does not select.** A pick closes the panel, so
  selection-follows-focus would make it impossible to arrow past a
  colour without committing to it — the opposite of
  `ArchivedScopeControl`, where selecting is free and follows focus.
- **Selection is not signalled by colour alone**: the selected cell
  carries a check glyph whose black/white is computed per-swatch from
  WCAG relative luminance, since a fixed glyph colour fails at one end
  or the other of an 18-colour range.

This is the two-dimensional grid navigation the icon-picker gap in
`known-gaps.md` said did not yet exist in the codebase. It does now, and
that entry has been updated to point at it.

---

## UI-16 — Sidebar: stray dot, unhighlighted views, misaligned trailing slots

**Status:** 16a/16b/16c **fixed** 2026-09-22 (uncommitted); 16d (counts for saved views) remains an undecided design question in one component
**Found:** Ken, 2026-09-22 (three screenshots)

### 16a — A second, meaningless dot on the default project

`shell/Sidebar.tsx:1095` renders `<Icon name="dot" size={12} />` as the
"Default project" marker, **beside a `ColorDot` every project row
already carries** (`:1090`). So the default project shows two dots and
the marker is indistinguishable from decoration.

**This one is mine, introduced today.** Ken asked (2026-09-22) for the
default marker to be "a dot from lucide icons, not a unicode char" —
replacing a `⭑` glyph. I swapped the glyph for a dot without noticing
every row already had one. The *glyph* removal was right; the *shape*
was not.

Note this compounds UI-6: the existing `ColorDot` is itself a fake,
hardcoded `var(--status-active-fg)` for every project because
`ProjectDef` has no colour field. So the row now carries two dots,
neither of which encodes anything.

**Fix:** pick a mark that is not a dot (a filled star was the original
intent, now available as `<Icon name="star">`), or move the default
signal into the existing `ColorDot` rather than adding a sibling.

### 16b — Nothing in the Views section highlights when selected

Selecting a saved view leaves it visually unmarked.

`ItemShell` (`:640`) fully supports it — `data-active`, `aria-current="page"`,
and an `bg-accent-muted text-accent` treatment whose comment cites
A11Y-30's "the active route must be marked by more than a colour
change". Project rows (`:1085`) and nav rows (`:772`) pass `active`.

**The three Views rows do not** — `:1420`, `:1437`, and the saved-view
row all call `<ItemShell collapsed title>` with no `active` prop.

**Not a regression from this session** — `git diff HEAD` shows the
`active` wiring untouched by today's edits. A pre-existing gap.

### 16c — Trailing slots do not align

Built-in filter rows end in a count badge; saved-view rows end in a
`⋯`. They sit at different x positions, so the column's right edge
zig-zags down the list.

### 16d — Saved views have no counts (answering Ken's "why?")

By design, not oversight: counts come from
`useBuiltinCounts(BUILTIN_FILTERS, ctx)` (`:1260`), which is scoped to
built-ins. A saved view's count would need running each view's stored
filters on every sidebar render.

**Worth deciding rather than assuming**, since the asymmetry is exactly
what makes 16c look broken: either give saved views counts too (a real
cost — N extra queries per render), or accept that the two row kinds
have different trailing slots and align them deliberately.

---

## UI-17 — "Manage all X" deep links still on entity surfaces (K105 violation)

**Status:** **fixed** 2026-09-22 (uncommitted). All six items removed; K105's status line corrected from BUILT to PARTIALLY BUILT, naming what was missed (menu items, not just prose). Original text: **this is a recorded ruling that was not carried out**
**Found:** Ken, 2026-09-22, on a milestone detail's ⋯ menu:
*"what did i say about a general edit/manage button on a specific
element? if im on a task, i dont want to see a link to manage all
tasks. same for milestones/sprints/labels/etc."*

He is right that he already said it. **K105** (`decisions.md`, Ken's
ruling 2026-09-21) states *"scattered '…in Settings → &lt;noun&gt;' prose
links are removed everywhere"* and is marked **"Status: BUILT"**.

### Still present — grepped 2026-09-22

| Site | Item |
|---|---|
| `shell/Sidebar.tsx:1238` | "Manage projects…" |
| `shell/Sidebar.tsx:1800` | "Manage milestones…" |
| `shell/Sidebar.tsx:1953` | "Manage sprints…" |
| `shell/Sidebar.tsx:2076` | "Manage labels…" |
| `milestones/MilestoneDetail.tsx:284` | "Manage milestones" (Ken's screenshot) |
| `sprints/SprintsView.tsx:365-366` | "Manage sprints in Settings" |

The earlier copy review had already found K105's "BUILT" status to be
false for two prose strings. This is the same ruling unbuilt for six
**menu items**, which is the part Ken actually objected to.

### The principle

An item-scoped surface offers actions on THAT item. A link to administer
every item of its type is a different scope and belongs where that
administration lives — Settings, reachable from the persistent gear.

A prior audit confirmed the destination is already reachable: the
Settings gear (`Sidebar.tsx:2182`) is always visible and its nav lists
Projects/Milestones/Labels/Sprints directly. **Removing these links
strands nothing.**

---

## UI-18 — Main content does not fill the width

**Status:** **fixed** 2026-09-22 (uncommitted). Reproduced at a settled 800px load: `<main>` measured 494.89/800px. Cause: it carried no explicit grid column, so with the sidebar hidden below 900px CSS auto-placement dropped it into the `auto` column instead of the `1fr` one. Fixed with `col-start-2` in `shell/AppShell.tsx`. My earlier 155px measurement WAS a mid-reflow artifact, as flagged.
**Found:** Ken, 2026-09-22: *"in mobile view, why doesnt the content fit
width?"* (screenshot: milestone detail, content occupying roughly the
left 60% with a large empty right region)

**First measurement, at an 800px viewport:** `<main>` measured
**155.4px wide** against a 800px viewport — far narrower than the
screenshot suggests and narrower than any sane layout. `<main>`'s
classes are `row-start-2 overflow-auto bg-bg-canvas outline-none`, i.e.
a grid row whose width comes from the parent grid's column definition.

**Treat that number as unconfirmed** — it was taken during a viewport
resize and may have caught a mid-reflow frame, the failure mode that has
produced two false reports already this session. Re-measure after a
settled load before acting.

Likely area: `AppShell`'s grid template columns and how the sidebar's
collapsed/expanded width interacts with the content column. Not
diagnosed.

---

## UI-19 — Sidebar entity marks are inconsistent (icons question)

**Status:** **decided and partly built** 2026-09-22 (uncommitted).
Ken ruled: *"im ok with no icons"* for milestones/sprints/labels, and
*"views keep icons: sure."* The counter-proposal's first half is BUILT —
the saved-view `icon` field now renders via `IconGlyph` instead of a
hardcoded star. Still open from the counter-proposal: deleting the marks
that encode nothing (see UI-6's fake project dot) and the per-type glyph
question (UI-20).
**Found:** Ken, 2026-09-22: *"do we want icons for
milestone/sprints/labels? ... icons as in, the same with views."*

Saved views carry a **user-assigned** icon (K104). Milestones, sprints
and labels do not. What the sidebar draws instead, per Ken's screenshot:

- Milestones — a flag glyph (also on "All milestones")
- Sprints — a coloured dot **plus** a state chip (`active`/`future`)
- Projects — a hardcoded blue dot encoding nothing (UI-6)
- Labels — a colour dot (the one mark backed by a real field, K103)

So four entity types, four different marking schemes, two of which are
decorative. ### The review's answer (2026-09-22): no to all three, and the premise is wrong

**"The same with views" describes something that does not happen.**
The saved-view `icon` is a fully plumbed field — contracts
(`query.ts`), core (`config/queries.ts`), a CLI flag
(`apps/cli/src/commands/views.ts`, 10 references), MCP params
(`apps/mcp/src/tools/views.ts`, 12 references incl. `icon: null`), and
both reference docs — **and it renders nowhere.**
`shell/Sidebar.tsx:1465` hardcodes `<Icon name="star" size={12} />` for
every saved view. Verified: 11 seeded views, 11 identical stars.
`IconGlyph` still has zero consumers outside its own file (UI-14).

So copying that pattern to three more entity types would triple a
feature that currently produces no visible change.

**Per type:**

- **Milestones — no.** 2–8 per tracker, already discriminated by name +
  date. An icon stands for a *category*; a milestone is a one-off. The
  row is missing a date or progress, not a glyph.
- **Sprints — no, emphatically.** Ordinally named and time-ordered, and
  the row already **double-encodes state** — a colour dot
  (`Sidebar.tsx:1853`) *and* a state chip (`:1861`). A third,
  user-chosen mark would compete with the only fact that drives
  behaviour. The sprint fix is subtraction.
- **Labels — no, but closest.** They already carry the one per-item
  mark in the sidebar that actually varies (`EntityColorDot`, `:1990`).
  Colour does the same job; and UI-14's rule means picking an emoji
  would silently render a stored colour inert — a bad state to hand a
  user for a type they may have 30 of.

**Counter-proposal:** (a) render the view icon that already exists —
one component swap; (b) delete the marks that encode nothing (the
second default-project dot from UI-16a, the fake project dot from UI-6,
the redundant sprint dot); (c) give each type one distinct glyph.
**Milestones and sprints currently share the same `flag`**
(`:1832` vs `:1686`), which is its own bug.

The rule it proposes: *a type glyph is fine; a per-item mark is fine if
it varies; a per-item-shaped mark with a constant value is not.*

**Flagged for Ken:** the type that would most benefit from a
user-assigned mark is **projects** — many per tracker, no date, no
state, no order, top-level — and it is the one not asked about. Its dot
slot is already drawn and currently lying.

---

## UI-20 — Is the milestone/sprint flag doing anything?

**Status:** open, needs Ken's call
**Found:** Ken, 2026-09-22: *"if milestones dont need a logo then does
it make sense to keep the flag icon, or is it just for alignment?"*

### Measured

- `shell/Sidebar.tsx:1686` (milestone row) — `<Icon name="flag" size={14} />`
- `shell/Sidebar.tsx:1832` (sprint row) — `<Icon name="flag" size={14} />`

**Identical glyph, identical size**, on two different entity types. So
it cannot be signalling type.

### Alignment is NOT why it is there

The mark sits inside a fixed slot the row owns, not the glyph:

```
<span className="w-4 shrink-0 text-center">…</span>   // Sidebar.tsx:1465
```

`ItemShell` does not reserve this width — each row does. **Removing the
glyph and keeping the empty `w-4` span leaves every label aligned.** So
"it is just for alignment" is answerable: no, alignment survives
without it.

It therefore fails UI-19's proposed rule twice — a per-item-shaped mark
with a constant value, and not even constant per *type*.

### Options

1. **Empty slot.** Keep `w-4`, draw nothing. Names stay aligned, the
   sidebar gets quieter, nothing meaningless is drawn.
2. **Distinct type glyph per type.** Flag for milestones, something
   time-shaped for sprints. The mark then genuinely means "this is a
   milestone" — which is information **only when the section heading
   has scrolled out of view.**
3. **Per-item mark where a real one exists.** Labels already do this
   (`EntityColorDot`, `:1990`). Sprints could use their state dot alone
   instead of today's dot + chip + flag.

### The deciding question

A type glyph earns its place only if a section's items can be scrolled
apart from its heading. With MILESTONES visible two rows up, the glyph
says nothing the heading does not. With a long list scrolled, it does.

Worth settling once for the whole sidebar rather than per entity type —
it is the same question UI-19 raises for projects and labels.

---

## UI-21 — Empty description reserves ~112px of blank space

**Status:** **fixed** 2026-09-22 (uncommitted). NOTE: this entry originally named the wrong file. There are TWO independent `min-h-[8rem]` declarations; `RichEditor.tsx:124` is never mounted read-only, so the gap came from `BodyRenderedView.tsx:120` (the read component). Now collapses when empty, keeps its height when there is a body.
**Found:** Ken, 2026-09-22: *"why is this description section so big"*
(screenshot: task detail, DESCRIPTION heading, a one-line placeholder,
then a large empty gap before RELATED)

### Cause

`editor/RichEditor.tsx:124` — the editor's ProseMirror node carries:

```
class: "prose-body min-h-[8rem] outline-none"
```

`8rem` at this app's 87.5% root = **112px**, reserved unconditionally,
even when the body is empty and the task is in read mode.

The screenshot shows the cost: a placeholder line, then roughly 200px of
nothing, then RELATED — pushing Attachments and everything below off the
first screen on a task with no description, which is the common case for
a newly created task.

### Why a min-height exists at all

A drop target and click target need to be big enough to hit — an editor
collapsed to one line is hard to click into, and a drag-to-upload region
needs area. So the answer is probably not `min-h-0`.

### Worth separating

The min-height may be right for **edit** mode and wrong for **read**
mode. The screenshot is read mode (an "Edit" button is visible), where
there is no typing target to keep hittable — only a placeholder inviting
a click. That suggests: collapse to the placeholder's own height when
read-only and empty; keep the roomy target once editing.

Not yet measured against the edit-mode path; confirm which mode the
`min-h` actually serves before changing it.

---

## UI-22 — "Upload" is styled as a button AND a link at once

**Status:** **fixed** 2026-09-22 (uncommitted). Box treatment dropped; still a `<button>`, now inline underlined text matching the sibling pattern in `Sidebar.tsx`'s GroupError retry.
**Found:** Ken, 2026-09-22: *"why is upload in a button, does this make
sense if its a text link already?"*

### What you see

Inside the attachments drop zone: *"Drag files here, or [Upload]. Up to
50 MB per file."* — a bordered, padded box sitting mid-sentence, with
underlined text inside it.

### Cause — it carries both treatments

`attachments/AttachmentsPanel.tsx:235-240`:

```
className="rounded border border-border-subtle px-1.5 py-0.5
           text-[0.8571rem] text-text-secondary underline hover:bg-bg-muted"
```

`rounded border … px … py … hover:bg-bg-muted` is button styling.
`underline` is link styling. Applied together, so the control reads as
neither — a bordered chip interrupting a sentence, with an underline
that then looks redundant.

Ken's read is right: if it is already an underlined text affordance
inside prose, the border and padding add nothing and break the line.

### Note on the element

It is a real `<button type="button">` that proxies a click to a hidden
`<input type="file">` (`:238`). **That is correct** — it must be a
button, not an anchor, because it triggers an action rather than
navigating, and a file input needs a programmatic click. So this is
purely a styling question, not a semantics one. Do not "fix" it by
turning it into an `<a>`.

### Likely fix

Drop the box treatment (`rounded border px-1.5 py-0.5 hover:bg-bg-muted`)
and keep it as inline underlined text that matches the sentence it sits
in — i.e. a button that *looks* like a link, which is the standard
pattern for an action embedded in prose. Check whether the app already
has such a variant before adding one (`ui/Button.tsx` variants, or an
existing inline-action class) — this repo's failure mode is building a
primitive and not adopting it.

---

## UI-23 — Rich-text toolbar: five defects

**Status:** 23a and 23b **fixed** (A295, 2026-09-22); 23c/23d/23e open
**Found:** Ken, 2026-09-22, on the comment composer. *"ui looks bad."*

### 23a — Underline is missing entirely — **FIXED (A295)**

Ken ruled that underline ships. It is stored as **`<ins>text</ins>`**,
never `<u>`: GitHub's sanitiser allowlist omits `u` and strips it
silently (verified live against `api.github.com/markdown`), so an
underline stored as `<u>` vanishes with no warning on the tool most
likely to read the file. `ins` is on that allowlist and is underlined
by every browser's UA stylesheet.

**No new dependency.** The note below was right that
`@tiptap/extension-underline` was absent, but it was not needed: the
stock extension parses and renders `<u>`, so retargeting it at `<ins>`
means overriding both `parseHTML` and `renderHTML` — the entire
extension. A custom `Mark.create` in `editor/extensions.ts` matches the
file's existing house style (`Superscript`/`Subscript`) in a few lines.

**Highlight (`==text==`) shipped alongside it**, as the cheaper answer
to "emphasise beyond bold": it collides with nothing, needs no HTML
allowlist entry, and is the Obsidian/pandoc convention.

See A295 for the full reasoning, the GitHub test output, and the
StarterKit `<u>` trap that `underline: false` now guards against.

<details>
<summary>Original finding (kept for context)</summary>

Grepped: **zero** occurrences of `underline`/`Underline` in
`editor/Toolbar.tsx`. Bold, italic and strikethrough are present; the
third member of the set is not.

**Not just unwired — not installed.** `@tiptap/extension-underline` is
absent from `apps/web/package.json`. Adding underline means a new
dependency, a schema mark, and a serialisation decision: **markdown has
no underline**, which is very likely *why* it was omitted. The task body
is markdown on disk (`task.md`), so an underline mark has nowhere to
round-trip to.

**This needs deciding, not just building.** Either underline is
genuinely unavailable (and the toolbar should not imply a gap), or the
body format needs to carry it. Ken should rule.

</details>

### 23b — The quote glyph does not read as a quote — **FIXED (A295)**

The old path drew two open hooks that read as `ᴊᴊ`:

```
quote: <><path d="M4 4.5h3.5v3.5A3 3 0 014 11" /><path d="M9 4.5h3.5v3.5A3 3 0 019 11" /></>
```

The icon *name* and wiring were correct (`Toolbar.tsx`); only the
**drawing** was wrong. Replaced with a mirrored pair of comma-shaped
marks — a bowl plus a tail per mark, which is how a quotation glyph
actually reads at 16px. Fixed in the same `Icon.tsx` pass that added
the `underline` and `highlight` glyphs.

### 23c — Undo/redo not vertically centred

Visible in the screenshot: the two trailing buttons sit slightly high
relative to the rest of the row. Cause not yet diagnosed — measure the
row's `align-items` and each button's box before changing anything.

### 23d — Toolbar wraps to two lines

At the composer's width the buttons overflow onto a second row, which
is what makes the whole control look unfinished.

**Ken's proposal, verbatim:** *"if it can fit in one line, we leave as
is. if it goes into 2 lines, then why not have those 'formatting
buttons' where some are combined, e.g. bold/italic/underline/
strikethrough are put together into a 'T' button, and some others can
combine too"*

That is a progressive-collapse pattern: keep the flat row while it
fits, fold related actions into grouped menus when it does not. Note the
app already has a responsive-collapse precedent — the timeline toolbar
folds its zoom/group/Today cluster into a "More" menu at phone width
(noted in `timeline/TimelineView.tsx`). Check that before inventing a
mechanism.

### 23e — Hover tooltips are slow

Native `title` attributes have a browser-controlled delay (~1s) that
cannot be tuned. Ken asks whether to build custom tooltips.

**Weigh before building:** a custom tooltip must handle keyboard focus,
touch (no hover), screen-reader duplication, and portalling out of
`overflow` — the same class of problem `Menu`/`Dropdown` already solved
here (MENU-PORTAL). Native `title` is currently also carrying the
accessible description in places (`ui/Menu.tsx:210-218` relies on it),
so replacing it is not purely cosmetic.

**New consumer, 2026-09-23 (A297).** "Save as view" is now an icon-only
`IconButton` on the list, board and timeline toolbars, with its name on
both `aria-label` and `title`. It is the clearest case yet for this
entry: a user who does not recognise the star glyph waits out the ~1s
native delay to learn what the button does. A297 deliberately did NOT
build a tooltip primitive — that call is still Ken's, here.

**Status: BUILT, 2026-09-23 (A298).** `ui/Tooltip.tsx` now exists,
portalled on the shared `usePortalPlacement` substrate, showing on
`:focus-visible` as well as hover (150ms enter, 0ms on focus, 0ms
between adjacent targets), dismissing on Escape, inert on touch, and
with no entrance animation under `prefers-reduced-motion`. The bubble is
always `aria-hidden` so it is never announced twice.

The concern this entry raised — that `title` was *also* carrying the
accessible description in places, so replacing it is not purely
cosmetic — was the load-bearing part, and it was handled separately: the
disabled-reason sites (`ui/Menu`, `ui/Dropdown`, `shell/Header`) moved
to `aria-describedby` → `sr-only`, NOT to the tooltip and NOT to
`aria-label`. See `decisions.md` § A298 for the full audit of which
`title` sites were tooltips, which were descriptions, and which
(truncated text, timestamps) were deliberately left as native `title`.

### Scope note

23a and 23e are decisions, not fixes. 23b, 23c and 23d are buildable
once 23a is settled — underline's presence changes what 23d has to
collapse.

---

## UI-24 — A broken view's rows are unfiltered (NOT the regression I first logged)

**Status:** open — minor; **my first diagnosis below was WRONG and is
retracted inline**
**Found:** 2026-09-23, verifying A296's classification fix

### What changed, and why it is worse

A296 made `parseQueriesConfig` parse each view's DSL at load, so a view
with unparseable DSL is classified `broken` and excluded from `queries`.
That part works — `GET /api/views` now reports it with `error` and
`position: 9`.

**But the run path regressed.** Measured live:

| Request | Before A296 | After A296 |
|---|---|---|
| `GET /api/tasks?view=<broken>` | **400**, `"advanced filter does not parse: … at position 9"` | **200, all 14 tasks** |

Because the view no longer exists in `queries`, `?view=<id>` resolves to
nothing and the parameter is **silently ignored**.

**RETRACTION.** I wrote that this was silent and therefore worse than
the 400. **It is not silent.** I checked the response body only after
writing that, and it carries a full `broken_view` field:

```json
"broken_view": { "id": "…A6", "name": "Broken view",
  "summary": "(unreadable filters)",
  "error": "advanced filter does not parse: … at position 9",
  "position": 9 }
```

`server.ts:4066-4091` has carried this mechanism all along — a
deliberate non-fatal diagnostic beside the rows, carrying the raw query
so the advanced editor can open pre-populated to repair it. The client
renders it (`list/ListView.tsx:303`, `list/cells.tsx:126`: a ⚠ glyph in
`danger-fg` with the validator's message).

So A296 did not regress this. It **activated a path that was dead code
for this defect class** — the `broken_view` lookup reads
`queriesConfig.broken`, which this defect never reached before A296.

I diagnosed from an HTTP status and a row count without reading the body.
Same mistake as the scroll-restoration retraction in UI-12: concluding
from an absence I had not actually looked for.

### The underlying cause is older than A296

An unknown view id has always been ignored rather than refused —
verified: `GET /api/tasks?view=nonexistent` also returns all 14 tasks.
A296 did not create that behaviour; it **routed the broken view into
it**, converting a loud failure into a silent one.

### MCP regressed, and this one is real

The web has the `broken_view` path. **MCP does not.** Measured after
A296:

```
executeTool("list_tasks", { view: <broken id> })
  →  Error: unknown view "01UNPARSE0000000000000000B"
```

Before A296 it was the actionable sentence: *"advanced filter does not
parse: expected value but got "=" at position 9"*.

**"unknown view" is wrong and actively misleading.** The view exists; it
is in `queries.yaml` and in `config.broken` with its parse message. An
agent told "unknown view" will conclude the id is bad and go looking for
the right one, instead of being told the DSL needs repair. That breaks
CLAUDE.md's CLI/MCP parity rule: core knows why, and this surface throws
the knowledge away.

Fix: `list_tasks` should consult `queriesConfig.broken` before
concluding "unknown", and return the parse message the way the web's
`broken_view` does. `apps/mcp/src/tools/views.ts` already reads
`config.broken` for `list_views`, so the surface has the shape already —
this is `task-crud.ts` not using it.

**Do not resolve this by rewriting the test to expect "unknown view".**
That would encode the regression.

### What actually remains

**The rows are unfiltered.** `total: 14` — every task — sits beside the
`broken_view` warning. The case that mechanism was built for says the
list should show *"an empty list"* rather than "an ordinary unfiltered
result" (`server.ts:4064-4066`), so returning all rows may contradict
its own stated intent. Worth checking against the case text before
changing: a warning plus every row could read as "here is everything"
to someone who does not notice the banner.

**Separately, `?view=<unknown>` IS silent** — verified:
`GET /api/tasks?view=nonexistent` returns all 14 with no diagnostic at
all. That is pre-existing, unrelated to A296, and is the sharper of the
two: a deleted-view URL held in a tab shows an unfiltered list with no
indication. XS-28 deliberately chose to fall back rather than error, so
this may be intended — check the case before treating it as a bug.

### Note for whoever fixes it

A296's own report flagged that two test files assert the old run-path
shape and need rewriting. They should assert the new shape — `GET /api/views` reports it
`broken`, and `GET /api/tasks?view=<id>` returns rows plus a
`broken_view` diagnostic. One of the three (`"is reported healthy by GET
/api/views (the classification gap, tracked separately)"`) asserted the
gap by name and is a green test encoding a defect, which CLAUDE.md
requires calling out in the commit message.

---

## UI-25 — Sidebar labels start at eight different x positions

**Status:** open — previously unrecorded
**Found:** 2026-09-23, by the UI-20 designer review; re-measured and
found worse than reported.

### Measured, live at 1440×900

Label left edges down the sidebar:

```
32, 39, 51, 53, 55, 57, 58, 59   →  eight distinct positions, 27px spread
```

The designer reported a 7px ragged edge between glyph rows (39) and dot
rows (32). That is the top of the sidebar only. Measuring every row
gives **eight** positions across a **27px** span — so the left edge is
not merely ragged between two groups, it steps repeatedly down the
column.

Examples: `All projects` / `Tasks` / `Web Client` at **32**; `Assigned
to me` / `Overdue` / `recent-open` at **39**; deeper rows at 51–59.

### Why it matters here

UI-20 asks what the `w-4` mark slot should hold. Whatever it holds, the
slot is **not currently uniform** — so "keep the glyph" and "empty the
slot" both leave the edge ragged unless the slot itself is unified
across all five sections.

Any fix to UI-20 should unify the mark slot, not just change what sits
inside it.

### Not diagnosed

The 51–59 positions are likely nested/indented rows (sub-items under a
section) rather than the mark slot. **Confirm which rows those are
before treating all eight as one defect** — part of this may be
intentional hierarchy, and only the 32-vs-39 split is the mark-slot
inconsistency.
