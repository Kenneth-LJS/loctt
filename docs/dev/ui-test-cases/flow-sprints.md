# Sprints

Sprint surfaces: the sprints overview (each sprint a column of its
tasks), the sprint detail route `/sprints/$key` with an editable
metadata header, the burndown chart, and the sprint-scoped task list.
Sprint *definitions* are edited in **Settings → Sprints**, whose CRUD
and reference-count behaviour lives in
[flow-settings.md](flow-settings.md); this doc covers only what the
sprint views themselves must do. Assigning a sprint from the task meta
panel is [flow-tasks.md](flow-tasks.md); the shared filter bar reused on
sprint detail is specified in [flow-list.md](flow-list.md).

Data model notes that drive most of these cases: a `SprintDef` is
`{ id (ULID, never shown), name (mutable, NOT unique), start_date,
end_date, state ∈ {active, completed, future}, goal?, archived? }`.
Tasks reference sprints **by id**. `state` is a plain user-edited label
— LocTT performs **no automatic transitions and no carryover**, so a
sprint's state and its dates can freely disagree. The burndown Y axis
comes from `workflow.yaml#estimation` and resolves to one of
`tasks | points | hours | days | custom_numeric | weighted_enum`.

## A. Happy path

### SPR-1 · M3 · blocker · P3 P9
**The sprints view renders one column per non-archived sprint, ordered by start date.** Tracker has sprints across all three states.
- Every non-archived sprint in `sprints.yaml` gets exactly one column; no sprint is omitted and none is duplicated.
- Columns are ordered by `start_date` ascending; ties broken stably (same order on reload, no shuffling).
- Each column header shows the sprint `name` as written in config — never the ULID `id`, never a derived slug.
- Each header shows the date window and a task count; the count equals the number of task cards actually rendered in that column.
- Archived sprints do not appear unless an explicit "show archived" affordance is enabled.

### SPR-2 · M3 · major · P3
**Active sprints are visually highlighted; future and completed sprints are collapsed by default.** Tracker has one `active`, two `future`, one `completed`.
- The `active` column is expanded on load and carries a visible highlight distinguishable without relying on colour alone.
- `future` and `completed` columns render collapsed, showing header plus task count only.
- Highlighting keys off `state`, not off whether today falls inside `start_date`..`end_date` — the two can disagree (see SPR-20).
- Clicking a collapsed header expands it in place without navigating away or reordering columns.

### SPR-3 · M3 · major · P8 P2
**Expand/collapse state survives a reload of the sprints view.**
- Expanding a `completed` sprint, reloading the page, and returning shows that sprint still expanded.
- Collapsing the `active` sprint persists likewise — the default is a default, not an override applied on every render.
- Persistence is per-user UI state; it does not write to `sprints.yaml`.

### SPR-4 · M3 · blocker · P1 P10
**Dragging a task card from one sprint column to another reassigns the task's sprint.**
- The card moves to the target column and the source and target counts both update.
- **The overview's column counts change after a refetch**, not only the optimistic in-place update — a write accepted and dropped leaves the counts right until the next load.
- The task's frontmatter `sprint` field is written with the target sprint's **`id`**, not its `name`.
- `loctt show <key>` in the CLI reports the new sprint immediately — the change is on disk, not just in the browser.
- Exactly one write is issued per drop; dropping a card back where it started issues no write at all.

### SPR-5 · M3 · major · P1 P6
**A failed sprint reassignment returns the card to its original column.** Simulate the write failing (read-only `.loctt/`, or the server refusing).
- The card visually returns to its source column rather than remaining in the target.
- Both column counts revert to their pre-drag values.
- An error names the task, the target sprint, and that the assignment was not saved (P4 bar; see § C).

### SPR-6 · M3 · minor · P8
**A card can be dragged out of every sprint into an unassigned state.**
- The view offers a "No sprint" / backlog target, or an explicit "Remove from sprint" affordance on the card.
- Dropping there clears the task's `sprint` field (absent/null), not writing an empty string or the literal `"none"`.
- The task subsequently matches `sprint` being unset in the query language, consistently with what the CLI reports.

### SPR-7 · M4 · blocker · P2 P3
**`/sprints/$key` opens the sprint detail with its metadata header populated.**
- Navigating from a column header opens the detail route; the URL is pasteable and reopens the same sprint.
- Header shows `name`, `start_date`, `end_date`, `state`, and `goal`, each populated from `sprints.yaml`.
- An absent `goal` renders as an empty/placeholder affordance, not the string `undefined` and not a collapsed row that hides the ability to add one.
- The `state` control offers exactly `active`, `completed`, `future` — no invented fourth state.

### SPR-8 · M4 · blocker · P1
**Editing sprint metadata in the detail header persists to `sprints.yaml`.**
- Changing `name` and blurring writes the new name; reloading shows the new name.
- The sprint's `id` is unchanged by any edit — tasks referencing it stay attached, and their cards still appear.
- `loctt sprint list` (or the equivalent CLI read) shows the edited values.
- Changing `state` from `active` to `completed` re-collapses that column on the overview per SPR-2's rules.

### SPR-9 · M4 · major · P3
**The burndown renders with numeric estimation, summing estimates.** `estimation: { enabled: true, unit: points }`, tasks carry numeric `estimate` values.
- The Y axis is labelled with the unit (points), not a hardcoded "Story points" or "Tasks".
- `series` has exactly one sample per calendar day from `start_date` to `end_date` inclusive — no days skipped for weekends.
- The plotted starting value equals `initialTotal`, which equals the first sample's `remaining`.
- The ideal line runs straight from `initialTotal` at start to 0 at end and is visually distinct from the actual line.
- A task with no `estimate` contributes 0 to the summed remaining but is still counted in that day's `incompleteTaskCount`.

### SPR-10 · M4 · major · P3
**The burndown renders with estimation disabled, counting tasks.** `estimation.enabled: false`.
- The unit resolves to `tasks` and the axis is labelled as a task count.
- Each day's plotted value equals that day's count of incomplete tasks in the sprint.
- No estimate input appears anywhere on the sprint detail — the field is hidden entirely, not shown empty.

### SPR-11 · M4 · major · P3 P7
**The burndown handles `custom_enum` estimation, which cannot be summed.** `unit: custom_enum` with `preset_values: [XS, S, M, L]` and **no** `weights` map.
- The chart does not attempt to sum categorical values and shows no NaN, no `0`, and no silently-empty plot.
- The unit falls back to `tasks` (a count of incomplete tasks) and the axis label says so, so the reader is not misled into thinking they are seeing summed effort.
- The UI states, near the chart, that the configured enum estimation has no weights and the chart is therefore counting tasks — with a pointer to adding `weights` in `workflow.yaml`.
- Per-category counts (how many XS / S / M / L remain) are available somewhere on the detail page, since that is the meaningful aggregate for enum mode.

### SPR-12 · M4 · major · P3
**The burndown uses `weights` when `custom_enum` declares them.** Same config as SPR-11 plus `weights: { XS: 1, S: 2, M: 3, L: 5 }`.
- The unit resolves to `weighted_enum` and remaining sums `weights[estimate]` per task.
- The axis label uses the configured `unit_label`, not the raw string `weighted_enum`.
- A task whose `estimate` is a preset value with a declared weight contributes exactly that weight; completing it drops the line by exactly that amount.

### SPR-13 · M4 · major · P2 P10
**The sprint detail task list uses the shared filter bar, scoped to the sprint.**
- The list initially shows exactly the tasks assigned to this sprint — same set as the overview column, same count.
- Applying a status filter narrows within the sprint; the sprint scope is never dropped by adding a filter.
- Filter state serializes into the URL, and pasting that URL reproduces the filtered, sprint-scoped list.
- The filters offered and the query semantics match [flow-list.md](flow-list.md) — no sprint-only filter dialect.

### SPR-14 · M4 · minor · P1 P8
**Reassigning a task away from the sprint on the detail page removes it from that page's list.**
- Setting a task's sprint to a different sprint drops it from the detail list and the count decrements.
- Returning to the overview shows the card in its new column without a manual refresh.

## B. Edge cases

### SPR-15 · M3 · major · P6
**A sprint with zero tasks renders a designed empty column.**
- The column shows an intentional empty state, not a zero-height column that collapses into its neighbour.
- The count reads `0` explicitly.
- The empty column is still a valid drop target — a card can be dragged into it.

### SPR-16 · M4 · major · P6
**Burndown for a sprint with zero tasks does not render a broken chart.**
- `initialTotal` is 0; the chart shows an explicit "nothing to burn down" state rather than empty axes or a NaN-scaled Y axis.
- No division-by-zero artifact appears in the ideal line.

### SPR-17 · M3 · major · P9
**A sprint holding 400 tasks stays usable.**
- The column virtualizes or paginates; the page remains scrollable and interactive.
- The header count reads the true total (400), not the number of rendered cards.
- Dragging a card out of a 400-card column completes without the column re-rendering every card visibly.

### SPR-18 · M4 · major · P9
**A burndown over a 400-task sprint and a long window renders without axis mangling.** Sprint spanning ~90 days.
- The X axis thins its tick labels rather than overprinting them into an unreadable smear.
- The series still contains one data point per day even when not every day is labelled.

### SPR-19 · M3 · major · P3 P6
**Overlapping sprints both render, with no implied exclusivity.** Two sprints whose date windows overlap, both `active`.
- Both columns appear and both are highlighted as active.
- A task appears in exactly one column (its assigned sprint), never duplicated into both because their windows overlap.
- No warning implies overlap is invalid — the schema permits it.

### SPR-20 · M3 · major · P3 P7
**A sprint whose `end_date` has passed but whose `state` is still `active` renders as active.**
- The column is highlighted and expanded, because `state` drives presentation and LocTT performs no automatic transitions.
- The UI surfaces the discrepancy — the window is in the past while the state says active — as an informational hint, not an error and not a silent auto-correction.
- Nothing in the UI rewrites `state` on the user's behalf.

### SPR-21 · M4 · major · P6
**Burndown for a sprint whose window is entirely in the future.**
- The chart renders the full window with the ideal line drawn, and the actual series flat at `initialTotal` for days that have not happened.
- Future days are visually distinguished from elapsed days, so a flat line is not misread as "no progress".

### SPR-22 · M4 · minor · P6
**A single-day sprint (`start_date == end_date`) produces a valid chart.**
- The series contains exactly one point; the chart renders it visibly rather than as a zero-width plot.
- The ideal line degenerates gracefully without producing NaN or an infinite slope.

### SPR-23 · M4 · major · P1
**Scope changes mid-sprint show as steps, not smoothed away.** Add a task to a running sprint partway through the window.
- The remaining total steps **up** on the day the task joined.
- Removing a task from the sprint steps the total **down** on its departure day.
- The chart does not retroactively rewrite earlier days to hide the scope change.

### SPR-24 · M3 · minor · P3 P9
**Two sprints sharing the same `name` are distinguishable.** `name` is explicitly not unique.
- Both columns render; the user can tell them apart by their date windows (or another shown discriminator).
- Dragging into one of them assigns that sprint's `id`, and the card lands in the column that was actually targeted.

### SPR-25 · M4 · minor · P9
**A very long sprint name and a very long goal do not break the header layout.**
- A 200-character name truncates with an ellipsis and exposes the full text on hover/focus; it does not push the `state` control off-screen.
- A multi-paragraph `goal` either wraps within a bounded region or is clamped with an expand affordance.

### SPR-26 · M4 · major · P7
**A task assigned to an archived sprint still resolves on the task and in history.**
- The task's meta panel shows the archived sprint's `name` with an "(archived)" affordance rather than a blank or a raw ULID.
- The archived sprint's detail route remains reachable by URL.
- The archived sprint is **not** offered as a target in the sprint picker or as a drop column — the archived-reference guard forbids *new* uses.

### SPR-27 · M3 · major · P7
**A task referencing a sprint id absent from `sprints.yaml` degrades visibly.** Hand-delete a sprint entry while tasks still point at it.
- The task is not silently hidden from every sprint surface; it appears in an "unknown sprint" grouping or is flagged on the task itself.
- The UI states that the referenced sprint is missing and names the dangling id.
- The rest of the sprints view continues to render — one dangling reference does not blank the page.

### SPR-28 · M4 · major · P1
**A sprint edited in the CLI while its detail page is open does not get clobbered.** Change `goal` via CLI, then edit `name` in the open UI.
- Saving `name` does not revert the CLI's `goal` change.
- After the save, the page reflects both the new name and the CLI-set goal.

### SPR-29 · M4 · minor · P3
**Changing `estimation.unit` in `workflow.yaml` re-renders the burndown against the new unit on refresh.**
- Switching `points` → `hours` changes the axis label and the summed values without a server restart being required.
- No stale "points" label survives anywhere on the chart.

### SPR-30 · M4 · minor · P6
**A task completed and then reopened inside the sprint window shows both transitions.**
- Remaining drops on the completion day and rises again on the reopen day.
- The chart uses status **category** (`completed` / `discarded`) to decide what has burned down, not a hardcoded `done` key — renaming the status key does not flatten the chart.

## C. Error cases

### SPR-31 · M3 · blocker · P4 P7
**A malformed `sprints.yaml` explains itself instead of blanking the view.** Introduce a sprint whose `end_date` precedes `start_date`.
- The sprints view shows an error naming the file, the offending sprint, and the specific rule broken (`end_date must not be before start_date`).
- The message tells the user to fix the file and reload — the UI does not offer to "repair" it silently.
- Other, valid sprints still render if the loader can partially recover; if it cannot, the page says the whole file failed to parse rather than showing an empty state that reads as "no sprints".

### SPR-32 · M3 · blocker · P4 P6
**An empty sprints view is distinguishable from a failed load.**
- A tracker with zero sprints shows an empty state that says there are no sprints and points at Settings → Sprints.
- A tracker whose sprint fetch failed shows an error with a retry — never the same empty state.

### SPR-33 · M4 · blocker · P4
**A rejected metadata edit reports the field and the reason inline.** Set `end_date` earlier than `start_date` in the detail header.
- The error appears next to the `end_date` control, not only as a toast.
- The message names the constraint and both offending values.
- The previous valid value is retained on disk; the header does not persist the invalid state.
- The user can correct the field directly from the error state without reloading.

### SPR-34 · M4 · major · P4
**A burndown that fails to compute says so instead of drawing an empty chart.** Force `readBurndownSeries` to throw (unknown sprint id, unreadable history).
- The chart region shows an error naming the sprint and stating that the burndown could not be computed.
- Empty axes with no line are never shown for a failure — that reads as "no work", which is a different fact.
- The rest of the sprint detail (metadata header, task list) still renders and stays editable.

### SPR-35 · M4 · major · P4 P7
**An invalid `weights` map is reported, not silently ignored.** `weights` referencing a value absent from `preset_values`.
- The config error is surfaced where the chart would be, naming the offending weight key and that it is not in `preset_values`.
- The chart either falls back to a task count with that fallback stated, or refuses to draw — but never plots a partially-weighted line that looks authoritative.

### SPR-36 · M3 · major · P4 P5
**Dropping a card onto a column whose sprint was deleted underneath the session fails loudly.** Delete a sprint via CLI, then drag onto its now-stale column.
- The write is rejected and the card returns to its source column.
- The error states that the target sprint no longer exists and asks the user to refresh.
- The stale column is removed on refresh rather than persisting as a phantom drop target.

### SPR-37 · M4 · major · P4 P1
**A metadata save that fails mid-flight states the resulting data state.**
- The error says what was attempted (which field, which sprint), whether it was saved, and what to do next — per P4's rare-exception bar in [flow-error-handling.md](flow-error-handling.md) § F.
- The header does not show the attempted value as though it were saved.

### SPR-38 · M4 · minor · P4
**An unparseable `/sprints/$key` (unknown key) shows a not-found state, not a blank shell.**
- The route reports that no sprint matches the key and offers a link back to the sprints overview.
- The response is distinguishable from a sprint that exists but has no tasks.
