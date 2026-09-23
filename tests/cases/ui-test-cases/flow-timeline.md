# Flow: Timeline (Gantt) view

The timeline at `/timeline` — zoom levels, row grouping, bar geometry
from `start_date`/`due_date`, the Unscheduled lane, drag-to-resize and
drag-to-shift, day-grid snapping, weekend/holiday shading from
`calendar.yaml`, and dependency arrows for the single relationship
configured in `workflow.timeline.dependency_relationship`. Creating and
editing relationships themselves is
[flow-relationships.md](flow-relationships.md); editing dates from the
task detail panel is [flow-tasks.md](flow-tasks.md); calendar
*configuration* is [flow-settings.md](flow-settings.md). This doc covers
only the timeline reading and writing that data.

## A. Happy path

### TML-1 · M3 · blocker · P2 P3
**`/timeline` loads with the zoom from `workflow.timeline.default_zoom`.** `workflow.yaml` sets `timeline.default_zoom: month`.

- The view opens at month zoom, not the built-in `week` default.
- The zoom control shows `Month` as the active option.
- Removing `default_zoom` from `workflow.yaml` and reloading opens at `week` (the documented built-in fallback), not at `day`.
- The URL reflects the effective zoom so the view is shareable, and pasting that URL opens the same zoom regardless of the workspace default.

### TML-2 · M3 · major · P2 P3
**A saved view's `display.zoom` beats the workspace default.** Open a saved view whose `display` has `mode: timeline, zoom: day` while `workflow.timeline.default_zoom` is `month`.

- The timeline opens at day zoom.
- Changing the zoom control afterwards updates the URL but does not rewrite `queries.yaml` — the saved view is unchanged on disk until the user explicitly saves.
- Reopening the saved view returns to `day`.

### TML-3 · M3 · blocker · P3
**Switching zoom between day / week / month rescales the header and every bar consistently.** Start at week, switch to day, then to month.

- The column header re-labels appropriately at each level (individual dates at day; week-starting dates at week; month names at month).
- A task spanning 2026-03-02 → 2026-03-06 spans 5 day-columns at day zoom, roughly one column at week zoom, and a fraction of one column at month zoom.
- Bar left edges stay aligned with their `start_date` gridline at every zoom.
- The zoom change is reflected in the URL and survives back/forward.

### TML-4 · M3 · blocker · P3 P9
**Bars are drawn from `start_date` to `due_date` inclusive.** A task with `start_date: 2026-03-02`, `due_date: 2026-03-02`.

- A single-day task renders a bar exactly one day-column wide at day zoom, not zero-width and not two days.
- A task 2026-03-02 → 2026-03-06 covers 5 columns, with its right edge at the *end* of 2026-03-06, not at its start.
- Bar labels show the task title (truncated with an ellipsis if the bar is narrow) and the bar has a tooltip with key, title, and both dates.

### TML-5 · M3 · blocker · P3 P6
**Tasks missing either date land in an Unscheduled lane.** Mix of tasks with both dates, neither date, only start, only due.

- Tasks with neither date appear in an explicit "Unscheduled" lane, listed by key and title, with no bar drawn in the chart area.
- The lane shows an honest count of how many tasks are in it.
- The lane is visually distinct from the grouped rows and is not silently collapsed to nothing when empty (it is hidden with no tasks, or shown as an empty labelled lane — but never rendered as an unlabelled blank row).
- Clicking an unscheduled row opens the task detail.

### TML-6 · M3 · major · P3
**Grouping by milestone splits rows into labelled milestone bands.** Set grouping to `milestone`.

- One band per milestone that has tasks in scope, using the milestone's display label from `milestones.yaml`, not its slug key.
- Tasks with no milestone collect in a single explicit "No milestone" band, not scattered or dropped.
- Bands are collapsible and the collapsed state does not change the URL's task scope.
- The band header shows a task count that matches the number of rows inside it.

### TML-7 · M3 · major · P3
**Grouping by assignee, status, and sprint each produce correct bands.** Cycle the grouping control through all four grouped modes.

- Assignee bands show user display names (with `(archived)` on archived users), and unassigned tasks band together explicitly.
- Status bands use status `label`s from `workflow.yaml` in declaration order, never keys.
- Sprint bands use sprint labels and order sprints by start date; tasks with no sprint band separately.
- Switching grouping does not change which tasks are shown — only how they are grouped. The total row count is identical across all groupings.

### TML-8 · M3 · major · P2 P3
**Grouping defaults to `workflow.timeline.default_grouping` and is URL-addressable.** Config sets `default_grouping: assignee`.

- Opening `/timeline` with no params groups by assignee.
- Changing to `none` puts every task in one flat lane and updates the URL.
- Pasting the `none` URL opens ungrouped even though the workspace default is assignee.
- With `default_grouping` absent, the view opens at `none`.

### TML-9 · M3 · blocker · P1 P8
**Dragging a bar's right edge changes `due_date` only.** Grab the right edge of a bar and extend it three days.

- Exactly one field is written: `due_date`. `start_date` is not included in the payload.
- The new value is the snapped date under the release point, in `YYYY-MM-DD` form.
- The bar stays at its new width after the write settles; it does not snap back and re-extend.
- Reading the file confirms the new `due_date` and an unchanged `start_date`.

### TML-10 · M3 · blocker · P1 P8
**Dragging a bar's left edge changes `start_date` only.** Grab the left edge and pull it two days earlier.

- Only `start_date` is written; `due_date` is untouched.
- The bar's right edge does not move by even one pixel-column during the drag.
- **Re-read the task file**: `start_date` holds the new value and `due_date` is byte-identical to before. TML-9 and TML-11 both read the file; this case did not.

### TML-11 · M3 · blocker · P1 P8
**Dragging a bar's body shifts both dates by the same delta in one write.** Drag a 5-day bar four days later.

- Both `start_date` and `due_date` are sent in a **single** atomic multi-field write, not two sequential calls.
- The duration is preserved exactly: a 5-day bar is still 5 days after the shift.
- The delta applied to both dates is identical — no off-by-one where the start moves 4 days and the due moves 3.

### TML-12 · M3 · major · P8
**All bar drags snap to the day grid at every zoom.** Drag a bar by an arbitrary sub-column amount at week and at month zoom.

- The resulting dates are whole days; no time component and no half-day landing.
- At month zoom, where one day is a few pixels wide, the snap target is the day under the cursor and the tooltip/label shows the candidate date live during the drag so the user can aim.
- Releasing without moving past a snap boundary is a no-op and issues no request.

### TML-13 · M3 · major · P3
**Weekends and holidays are shaded from `calendar.yaml`.** `working_days: [1,2,3,4,5]` and a holiday on 2026-12-25.

- Saturday and Sunday columns are faintly shaded at day and week zoom.
- 2026-12-25 is shaded as a non-working day and exposes its holiday `label` on hover.
- Changing `working_days` to `[0,1,2,3,4]` and reloading moves the shading to Friday/Saturday — the shading is not hardcoded to Sat/Sun.
- Shading is decorative only: bars still render across shaded columns and durations are not adjusted for non-working days.

### TML-14 · M3 · major · P3
**Dependency arrows are drawn only for the configured relationship.** `workflow.timeline.dependency_relationship: blocks`; the tracker also has `depends_on` and `parent` links between visible tasks.

- Arrows appear between the endpoints of `blocks` links.
- **No** arrows appear for `depends_on` or `parent` links, even though those relationships exist on the same tasks.
- Arrow direction follows the forward edge (source `blocks` target), not the inverse.
- With `dependency_relationship` absent or null, no arrows are drawn at all and the arrows toggle reflects that state.

### TML-15 · M3 · major · P2 P3
**The arrows toggle turns arrows off and on, defaulting from `workflow.timeline.show_arrows`.** Config sets `show_arrows: false`.

- The view opens with arrows hidden and the toggle in the off position.
- Turning it on draws arrows immediately with no refetch of task data.
- The toggle state is reflected in the URL (or the saved view's `display.show_arrows`) so the state is shareable.
- Toggling arrows never changes which rows or bars are displayed.

### TML-16 · M3 · minor · P8
**Today is marked and the view scrolls to a useful default position.** Open `/timeline` on a tracker with work spanning last month and next month.

- A "today" marker line is drawn at the correct column for the workspace timezone from `calendar.yaml`.
- The initial horizontal scroll puts today in view rather than starting at the earliest task in the tracker.
- A "Today" control re-centres the view after scrolling away.

### TML-17 · M3 · minor · P2 P8
**Clicking a bar or a row label opens the task detail, and back returns to the same timeline position.** Click a bar, then browser-back.

- Navigation goes to `/tasks/<key>`.
- Back returns to `/timeline` with the same zoom, grouping, arrows state, filters, and horizontal scroll position.
- A click that was actually the tail of a drag does not navigate.

## B. Edge cases

### B1. Date data

### TML-18 · M3 · blocker · P4 P7
**A task whose `due_date` precedes its `start_date` is shown as an anomaly, not as a negative-width bar.** Hand-edit a task to `start_date: 2026-03-10`, `due_date: 2026-03-04`.

- No bar is drawn backwards or with negative/zero width, and no bar is silently swapped to run 03-04 → 03-10 as if the data were fine.
- The task is visibly flagged — an error-styled marker at the row with a tooltip naming the problem ("Due date is before start date") — or it is moved to the Unscheduled lane with that reason attached.
- The row is still clickable through to detail so the user can fix it.
- The rest of the timeline renders normally.

### TML-19 · M3 · major · P3 P6
**A task with `start_date` but no `due_date` is handled explicitly.** One task with only a start.

- It is not drawn as a bar running to an arbitrary "today" or "forever" edge without indication.
- Whatever is chosen — a milestone-style diamond at the start date, or a one-day bar with open-ended styling, or an Unscheduled placement — is visually distinguishable from a normal bar with two real dates.
- Hovering explains the missing date.
- Dragging on such a marker either resizes into a real two-date bar (writing `due_date`) or is disabled with an explanation; it must not silently invent a `due_date` on a body-drag that the user thought was a move.

### TML-20 · M3 · major · P3
**A task with `due_date` but no `start_date` mirrors TML-19.** One task with only a due date.

- Same explicit treatment, distinguishable from a two-date bar.
- Dragging it does not silently backfill `start_date` without an obvious signal that a new date was created.

### TML-21 · M3 · major · P9
**A 129-year span at day zoom does not lock the browser.** One task spanning 1970-01-01 → 2099-12-31, at day zoom.

- The view remains responsive; interaction is possible within a couple of seconds.
- Roughly 47,000 day columns are not all rendered at once — the header and grid virtualize, and scrolling shows correct dates at the far ends of the range.
- The bar renders as spanning beyond the viewport in both directions with edge indicators, rather than as a zero-width artefact from a numeric overflow.
- Scrolling to the year 2099 shows correct date labels, not drifted-by-one dates from accumulated floating-point stepping.

### TML-22 · M3 · minor · P3
**A leap day is a real column and a bar can end on it.** Zoom to day around 2028-02-29.

- 2028-02-29 appears between 02-28 and 03-01.
- A bar dragged to end on 02-29 writes `due_date: 2028-02-29`, not 2028-03-01.
- The same range at month zoom shows February as 29 days wide relative to its neighbours (or at least does not misplace 03-01).

### TML-23 · M3 · major · P3
**A DST transition does not shift bars by a day.** Workspace timezone `America/New_York`, tasks spanning the March spring-forward and the November fall-back.

- A bar starting the day after the transition still begins on the correct calendar column — not one column early or late.
- Bar widths in days are unchanged across the transition: a 7-day task is 7 columns whether or not it spans the transition.
- The today-marker sits on the correct day on the transition day itself.
- Repeating with a southern-hemisphere zone (`Australia/Sydney`) and with a no-DST zone (`Asia/Singapore`) gives the same correctness.

### TML-24 · M3 · major · P3
**The workspace calendar timezone, not the browser's, drives rendering.** `calendar.yaml` sets `timezone: Asia/Tokyo`; run the browser with the OS set to `America/Los_Angeles` (a 16–17 hour offset that straddles a date boundary).

- Weekend shading and the today-marker follow the workspace timezone.
- Two machines in different timezones viewing the same tracker see the today-marker on the same column.
- Bars do not shift by a day depending on where the viewer sits; `start_date`/`due_date` are date strings and are never converted through a timezone.

### TML-25 · M3 · minor · P3
**`first_day_of_week` from `calendar.yaml` drives the week-zoom column boundaries.** Set `first_day_of_week: 1` (Monday), then `0` (Sunday).

- At week zoom the column headers start on Monday in the first configuration and Sunday in the second.
- Bar geometry re-derives accordingly; a bar starting on a Sunday sits at the start of its column in one configuration and at the end of the previous in the other.

### B2. Grouping and scale

### TML-26 · M3 · major · P9
**A tracker with 3,000 dated tasks stays interactive at month zoom.** Seed 3,000 tasks with dates spanning three years.

- Rows virtualize vertically; scrolling to the 2,900th row shows the right task, and its bar is at the right horizontal offset.
- Counts in group headers are the true totals, not the number of rendered rows.
- Dragging a bar in a virtualized row far down the list works and writes to the correct task.

### TML-27 · M3 · major · P9 P3
**Grouping by assignee with 40 users produces 40 bands without breaking layout.** 40 users, most with a handful of tasks.

- Band headers stay readable and sticky (or otherwise identifiable) while scrolling within a long band.
- Collapsing all bands leaves a compact list of 40 headers, and expanding one does not reset the others.
- An assignee whose user was archived still gets a band with the name and an `(archived)` marker rather than a raw ULID.

### TML-28 · M3 · minor · P7
**A task assigned to a user id that no longer exists gets a labelled band, not a blank one.** Delete a user's folder while tasks still reference the id.

- The band header shows something meaningful — the truncated id with an "unknown user" marker — never an empty header.
- The tasks are still visible and clickable.
- The condition is surfaced as config drift somewhere the user can act on it.

### TML-29 · M3 · minor · P7
**A task referencing a deleted milestone or sprint bands under an explicit "unknown" heading.** Remove a milestone from `milestones.yaml` while tasks still reference its key.

- The band is labelled with the dangling key verbatim and marked as missing.
- Tasks do not silently merge into "No milestone", which would hide the drift.

### TML-30 · M3 · minor · P9
**Many overlapping bars in one lane are laid out without becoming unreadable.** Ungrouped mode with 60 tasks whose dates all overlap.

- Each task gets its own row — bars are not stacked on top of each other in a single row where only the topmost is clickable.
- The vertical extent scrolls; the header and the date grid stay aligned with the rows while scrolling.

### B3. Dependency arrows

### TML-31 · M3 · major · P3 P7
**Arrows to a task that is not currently rendered are handled explicitly.** A `blocks` target that is filtered out, unscheduled, or in a collapsed band.

- No arrow is drawn to nowhere and no arrow terminates in empty space or off-canvas.
- The source bar carries an indicator that it has an off-screen dependency (a stub arrow or a badge), rather than the link simply vanishing.
- Expanding the collapsed band or clearing the filter restores the full arrow.

### TML-32 · M3 · minor · P9
**A task with 50 outgoing arrows does not render an unreadable fan.** One task blocking 50 others.

- Arrows are drawn without hiding the bar labels underneath.
- Hovering the source bar highlights its arrows so an individual dependency can be traced.
- Turning arrows off removes all 50 with no residual artefacts.

### TML-33 · M3 · minor · P3
**A dependency cycle draws arrows without looping forever.** A `blocks` B, B `blocks` C, C `blocks` A.

- All three arrows render.
- The view does not hang, and no infinite layout loop occurs.
- The cycle is not silently pruned in a way that hides one of the three edges.

### TML-34 · M3 · minor · P3
**Changing `dependency_relationship` in `workflow.yaml` changes which arrows are drawn on the next load.** Switch from `blocks` to `depends_on`.

- After reload, arrows follow `depends_on` links and no longer follow `blocks`.
- The arrows toggle still works with the new relationship.
- Setting `dependency_relationship` to a key that does not exist in `relationships` results in no arrows plus a visible configuration notice naming the missing key — not a silent no-op and not a crash.

### TML-35 · M3 · minor · P3
**A self-referential or same-day dependency renders sanely.** Two `blocks`-linked tasks that start and end on the same day.

- The arrow between two co-located bars is still visible (routed around, not hidden behind the bars).
- No zero-length arrow artefact is drawn.

### B4. Drag interaction

### TML-36 · M3 · major · P8
**Edge-drag and body-drag hit targets are distinguishable on a narrow bar.** A one-day bar at month zoom (a few pixels wide).

- Either the edge handles remain grabbable (a minimum hit area is enforced), or edge-resize is disabled at that scale with an explanation on hover.
- A user attempting to shift a narrow bar does not accidentally resize it to zero.
- A bar can never be dragged to a zero-day or negative duration; the resize stops at one day.

### TML-37 · M3 · major · P1
**A background refetch landing mid-drag does not move the bar out from under the cursor.** Start a bar drag and let a poll resolve.

- The bar under the cursor stays under the cursor and keeps its drag geometry.
- Rows do not resort mid-drag; new data applies after release.
- The write uses the dates the user saw at release.

### TML-38 · M3 · major · P8
**`Esc` cancels a drag with no write.** Begin a resize, move several days, press `Esc`.

- The bar returns to its original geometry.
- No request is issued and no history entry is written.
- A subsequent drag on the same bar works normally.

### TML-39 · M3 · minor · P1
**Dragging a bar back to its original dates is a no-op.** Move a bar three days out and back before releasing.

- No request is issued.
- `updated_at` is not bumped.

### TML-40 · M3 · minor · P8
**Bar dates can be changed without a mouse.** Focus a bar via keyboard.

- The bar is focusable, and documented keys shift and resize it in day increments with the same single-write semantics as the mouse drags (TML-9 through TML-11).
- The current dates are announced as they change, per [flow-accessibility.md](flow-accessibility.md).

### TML-41 · M3 · minor · P6
**Loading and empty states are designed.** Throttle the network; then filter to a set with no dated tasks.

- A skeleton grid appears while loading; the user does not briefly see a fully drawn empty timeline that then repopulates.
- A filter matching nothing shows an explicit empty state naming the active filter, not a bare date grid with no rows.
- A tracker where every task lacks dates shows a populated Unscheduled lane and an explanation of why the chart area is empty.

## C. Error cases

### TML-42 · M3 · blocker · P1 P4
**A failed resize write reverts the bar geometry and names the failure.** Server returns 500 on the `due_date` write.

- The bar returns to its original width — it is not left rendered at the new width while the file still holds the old date.
- The message names the task by key, states that the due date was not changed, shows the value that was attempted, and offers retry.
- Reading the file confirms the original `due_date`.

### TML-43 · M3 · blocker · P1 P4
**A failed body-drag does not leave one date saved and the other not.** Force the atomic two-field write to fail.

- Neither `start_date` nor `due_date` is changed on disk — a half-applied shift that silently changes the task's duration is the specific failure this case exists to catch.
- The bar reverts to its original position and width.
- The error states that the move was not saved and that both dates are unchanged.

### TML-44 · M3 · blocker · P4 P6
**Connection loss mid-drop is honest about what was saved.** Kill the server between release and response.

- The bar either reverts or is marked as pending/unsaved with clearly tentative styling — it is never rendered as a settled new position while the server holds the old one.
- **A reload shows server truth**: the pending state does not survive it (P1).
- The message states what was attempted, that it was not saved, and to retry when the connection returns.
- After reconnect and refetch, the rendered geometry matches the dates on disk exactly.

### TML-45 · M3 · major · P4 P7
**A drag that would write an invalid date is rejected with the reason.** Resize a bar's left edge past its `due_date` in an implementation that permits the gesture to reach that state.

- The write is rejected (or the drag is clamped at one day), and the reason names the constraint: start cannot be after due.
- The bar does not land in a state that renders backwards.
- Nothing is written to disk.

### TML-46 · M3 · major · P4 P7
**A malformed `calendar.yaml` degrades to an unshaded grid with an explanation.** Set `working_days: [9]` (out of the 0–6 range) or corrupt the YAML.

- The timeline still renders bars and dates.
- A visible notice names `calendar.yaml`, the invalid value, and tells the user to fix it; shading is skipped rather than applied wrongly.
- The today-marker falls back to a documented timezone (and says so) rather than disappearing.

### TML-47 · M3 · major · P4 P6
**One corrupt `task.md` does not blank the timeline.** Corrupt one task's frontmatter.

- Every other task's row and bar renders.
- The failure is surfaced once, naming the task id and the parse problem, with a "check the file" next action.
- Row and group counts are honest about the unreadable task.

### TML-48 · M3 · major · P4 P7
**A `start_date` that is not a valid date string does not crash the view.** Hand-edit a task to `start_date: "next tuesday"`.

- The task appears in Unscheduled (or flagged in place) with the invalid value shown verbatim.
- No `Invalid Date` string leaks into a header, a tooltip, or a bar label.
- The message names the task and the offending field value.

### TML-49 · M3 · major · P4
**A drag targeting a task deleted by another surface fails specifically.** Delete the task via CLI, then release a drag on its bar.

- The error names the task and says it no longer exists.
- The timeline refetches so the row disappears.
- No orphan bar is left rendered.

### TML-50 · M3 · minor · P4
**A failed zoom or grouping preference write does not lose the user's current view.** Fail the settings/URL persistence path while changing zoom.

- The timeline stays at the zoom the user selected for this session.
- If the preference could not be persisted, that is stated ("this zoom won't be remembered") rather than the view silently snapping back to the workspace default.

## D. Redesign: filterable, grouped, and the unscheduled drawer

These cases cover the timeline redesign: the chart owns the viewport, the
unscheduled tasks live in a collapsible footer drawer, the shared list
filter bar is mounted on the view, the filter scope carries across the
List / Board / Timeline switch, and the full group-by set is reachable
through a searchable picker. They extend — they do not replace — the
Unscheduled and grouping cases in sections A and B (TML-5, TML-6, TML-7,
TML-8, TML-29, TML-41).

### TML-51 · M3 · major · P6 P9
**The Unscheduled surface is a collapsible footer drawer, collapsed by default, whose header shows an honest count and a breakdown by problem kind.** A tracker with one fully-dated task and several unscheduled ones: some undated, one with a due date only, one whose date field is corrupt.

- On load the drawer's header strip is visible below the chart, showing "Unscheduled" and a parenthesised total count that matches the number of unscheduled tasks.
- The header also shows a breakdown by the reason each task is unscheduled — e.g. "N undated", "N due-only", "N corrupt" — and the corrupt/invalid piece is rendered in the danger colour, distinct from the merely-undated pieces.
- The drawer is collapsed by default: the header toggle reports `aria-expanded="false"` and none of the unscheduled task rows are in the DOM.
- The dated task still gets a normal bar in the chart — the drawer does not swallow scheduled work.
- The header strip is hidden entirely (no unlabelled blank row) when there are no unscheduled tasks at all.

### TML-52 · M3 · major · P8
**Expanding the drawer reveals the unscheduled rows and their reason chips; each row opens the task.** From TML-51's collapsed drawer.

- Clicking the header toggle flips it to `aria-expanded="true"` and mounts one row per unscheduled task, each listing the task key and title.
- Each row carries a reason chip naming why it is unscheduled ("No start date …", corrupt, etc.); no bar is drawn in the chart for an unscheduled task.
- Clicking an unscheduled row navigates to `/tasks/<key>`.
- The collapsed/expanded state is a local display affordance — toggling it does not change the URL or the view's task scope.

### TML-53 · M3 · major · P6 P9
**The chart owns the viewport: many unscheduled tasks can no longer squeeze the chart to a strip.** A tracker with one dated task and 20+ unscheduled tasks.

- The scrolling chart keeps a minimum height floor and remains the dominant region of the panel; it is not pushed down to a thin strip by the number of unscheduled tasks.
- When the drawer is expanded, its body scrolls within a capped height (roughly 40% of the panel on desktop) rather than growing unbounded, so an expanded drawer with 200 rows still cannot crowd out the chart.
- On a phone the expanded drawer opens as its own sheet rather than competing with the chart for the short viewport.

### TML-54 · M3 · major · P6
**When no task has both dates, the chart shows an explicit empty state inside its frame and the drawer auto-expands once.** A tracker where every task is missing a start date, a due date, or both.

- The chart frame (date header and grid) still draws, with a centred notice explaining that none of these tasks has both dates so there is nothing to chart and that they are listed under Unscheduled.
- The Unscheduled drawer opens automatically on first load so the tasks are visible without a click; the user may still collapse it afterwards and it stays collapsed.
- This is distinct from the filter-matched-nothing empty state (TML-41), which names the active filter instead.

### TML-55 · M3 · major · P8 P9
**A sticky task-name gutter pins each row's key and title on the left while the chart scrolls horizontally.** A grouped or flat timeline with several dated rows.

- A left gutter column renders one cell per laid-out row (key · title) plus a cell per band header, aligned with the rows in the chart body.
- The gutter stays pinned over the chart's left edge during horizontal scroll, so the row a bar belongs to stays identifiable even when the bar's own in-bar title has scrolled out of view.
- A gutter row is clickable through to the task detail, the same as the bar and the band label.

### TML-56 · M3 · major · P2 P10
**The shared list filter bar is mounted on the timeline, and filtering narrows which bars are charted.** Two dated tasks in different statuses (or with different assignees), opened at `/timeline`.

- The same filter bar the list uses is present on the timeline (`from="/timeline"`), including saved-view selection.
- Applying a filter that matches only one of the tasks leaves only that task's bar (and the total) — the filter narrows the charted set, it does not merely add a chip.
- The filter is reflected in the URL so the filtered timeline is shareable, and the server is what narrowed the result (the API returns the filtered set), not the client hiding rows from a full response.

### TML-57 · M3 · major · P2 P10
**Switching between List, Board and Timeline carries the filter scope and drops each view's private display params.** From a filtered, project-scoped list.

- The view switcher links to Board and Timeline keep the scope params (`q`, `project`, `status`, `assignee`, `milestone`, `sprint`, `priority`, `task_type`, `label`, `vf`, `field.*`). An `archived` param is not scope and is not carried (K121 #1: no URL parameter shows archived tasks).
- The same switch drops the view-private display params, so each view opens at its own default: the list's `page`/`sort`/`dir` and the timeline's `zoom`/`grouping`/`arrows` do not ride across.
- A project (or saved-filter) click made while on the Board or Timeline stays on that view rather than jumping to the list.

> **Amended (K121 #1, Ken 2026-09-23).** Ken: *"i think i want to not allow viewing archived stuff. thats the point of archiving."* … *"remove everywhere. i dont even want a debug switch."* `archived` was in the carried list; the list no longer reads it, so the switcher drops it.

### TML-58 · M3 · major · P3 P10
**The full group-by set is reachable through a searchable picker, including a single-value enum custom field.** A workspace with enough single-value enum custom fields that the picker's list crosses the search threshold; two dated tasks carry different values of one such field ("Area").

- The group-by picker offers the eight builtins — none/project/milestone/sprint/assignee/status/priority/type — plus every single-value enum custom field as `field.<key>`, labelled by the field's display label.
- Once the list is long enough the picker shows a search box; typing the field's label surfaces it, and selecting it sets `grouping=field.area` in the URL and on the trigger.
- Bands read by the value labels from `workflow.yaml`, never the stored keys, and the total task count is unchanged from any other grouping (TML-7's invariant holds — a custom-field grouping is single-value so no task lands in two bands).
- Labels and multi-value enum custom fields are not offered (they would place one task in many bands); a search for "custom" surfaces the custom fields and not the builtins.

### TML-59 · M3 · major · P3 P7
**A grouping that names a custom field no longer eligible degrades to flat (or the next resolvable layer) with a notice naming the dropped key.** A saved view or URL sets `grouping=field.area` while `area` has been deleted, or changed to multi-value / non-enum.

- The timeline does not crash and does not draw a single mislabelled band for the dangling key; it falls back to the next resolvable grouping in the chain (URL → view → workspace default → flat), reaching flat only when every layer is unresolvable.
- A visible notice names the dropped grouping key verbatim and states that it is no longer a single-value enum field and what is being shown instead.
- The picker still names the currently-set value rather than showing empty, marking a dangling one as no longer available.
