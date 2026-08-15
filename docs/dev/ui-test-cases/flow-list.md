# List view flow

The sortable, filterable task table at `/list` — columns, sort, the
filter bar, URL state, the archived toggle, pagination, and the
free-text DSL search box. Row selection, the bulk bar, and export live
in [flow-bulk.md](flow-bulk.md); saving and applying named views lives
in [flow-saved-views.md](flow-saved-views.md); the board and timeline
renderings of the same task set are in [flow-board.md](flow-board.md)
and [flow-timeline.md](flow-timeline.md). Shell chrome (sidebar,
header, schema banner) is [flow-app-shell.md](flow-app-shell.md).

## A. Happy path

### LST-1 · M1 · blocker · P2
**`/` redirects to `/list` and lands on a populated table.** Fresh
session, no stored state, tracker has tasks.

- Navigating to `/` results in the address bar reading `/list`, not `/`.
- The redirect is a *replace*, not a push: pressing Back once from
  `/list` leaves the app (or returns to the previous site), it does not
  bounce between `/` and `/list`.
- The table renders rows without any filter chips active.
- No search params are appended on the redirect — the landing URL is
  bare `/list`, so a user who bookmarks it gets the default view, not
  one session's filters frozen in.

### LST-2 · M1 · blocker · P3 P9
**The table renders all ten columns with the user's configured
vocabulary.** Default `UserSettings.list_columns` (unset).

- Columns present, left to right: key, project, title, status,
  priority, type, assignee, labels, due, updated.
- Status, priority, and type cells show the `label` from
  `workflow.yaml` ("In progress"), never the stored `key`
  (`in_progress`).
- The key column shows the user-facing `key` (`WEB-7`), never the ULID
  `id`. The ULID appears nowhere in the row.
- Project shows the project `label`, not its slug `key` or `prefix`.
- Assignee shows the user's display name from `profile.yaml`, not the
  ULID stored in frontmatter.
- `updated` reflects `updated_at`; `due` reflects `due_date`. A task
  with no `due_date` renders an empty cell, not "Invalid Date", "—"
  ambiguity aside, and not today's date.

### LST-3 · M1 · blocker · P2
**Clicking a column header sorts by it and writes the sort to the
URL.** Click the "priority" header.

- The URL gains `?sort=priority&dir=asc` (or the configured default
  direction for a first click).
- A direction indicator appears on the priority header **only** —
  no other header shows an indicator simultaneously (sort is single-key).
- Clicking the same header again flips to `dir=desc` and the indicator
  reverses.
- **The request carried the sort** — the API call includes `sort` and
  `dir`. Asserting only the rendered order lets a client-side sort of
  the current page pass, which is a different feature and wrong past
  page one.
- Reloading the page with that URL reproduces the same order and the
  same indicator position.
- Priority ordering follows the `value` field from `workflow.yaml`
  (critical=4 above high=3), not the alphabetical order of the keys.

### LST-4 · M1 · blocker · P3
**Sorting by a priority set with no `value` falls back to
alphabetical.** `workflow.yaml` priorities declared without `value`.

- Sorting by priority produces a stable alphabetical-by-key order.
- The app does not silently treat missing `value` as `0` for all rows
  and thereby render an arbitrary/unstable order across reloads.
- Two successive reloads of the same URL produce the identical row
  sequence.

### LST-5 · M1 · blocker · P2 P8
**Clicking a row opens that task's detail route.** Click anywhere in a
row's title cell.

- Navigation lands on `/tasks/<key>` using the task's user-facing key.
- Back returns to `/list` with every filter, sort, and page still
  applied — not a reset default list.
- Clicking a label pill inside the row does **not** navigate to the
  task; it applies that label as a filter (per
  [flow-milestones-labels.md](flow-milestones-labels.md)).

### LST-6 · M1 · major · P1 P3
**Per-user column visibility and order come from
`UserSettings.list_columns`.** A user whose `settings.yaml` lists a
subset in a non-default order.

- Only the listed columns render, in the listed order.
- The setting is read from `users/<id>/settings.yaml` for the *current*
  user; switching users re-renders the table with the other user's
  column set without a full page reload.
- Because `settings.yaml` is gitignored and per-checkout, a column
  layout never travels with a shared URL — pasting the URL to another
  user shows their own column config with the same filters.

### LST-7 · M1 · blocker · P6
**A loading skeleton occupies the table while the first request is in
flight.** Throttle the API response.

- A skeleton with the correct column count is shown — not a blank pane
  and not a bare centered spinner over empty chrome.
- The skeleton is replaced by rows in one transition; headers do not
  reflow or change width when real data arrives.
- The empty state is **not** flashed before data arrives — a slow
  request must never momentarily read "No tasks match these filters".

### LST-8 · M1 · blocker · P6
**A filter matching nothing shows a distinct empty state, not the
fresh-tracker one.** Apply a status filter no task uses.

- The message names the situation ("No tasks match these filters") and
  offers a concrete next action ("Clear filters").
- The filter chips remain visible and removable so the user can see
  *why* nothing matched.
- The action clears filters and restores rows without a page reload.
- This is visually and textually distinct from the empty-tracker state
  covered in [flow-onboarding.md](flow-onboarding.md), which invites
  the user to create a first task instead.

### LST-9 · M1 · blocker · P2 P3
**Each filter dropdown offers the configured options and writes a
typed search param.** Open Status, tick two statuses.

- The dropdown lists every status from `workflow.yaml` by `label`, in
  config order — not alphabetized, not a hardcoded three.
- The URL becomes `?status=in_progress,blocked` — stored keys, comma
  separated, in the typed search-param schema's CSV form.
- The table shows only tasks with those statuses; the row count and
  the pagination total both drop to match.
- The same holds for Project, Priority, Type, Assignee, Label,
  Milestone, and Sprint, each writing its own param
  (`project`, `priority`, `type`, `assignee`, `labels`, `milestone`,
  `sprint`) **and each narrowing the result set** — the row-count check
  above applies to all nine facets, not only `status`. A param that
  reaches the URL and is then dropped server-side passes a
  param-only assertion.
- Domain entities (project, assignee, label, milestone, sprint) are
  filtered by their stored identifier while displaying labels, so
  renaming a label in settings does not break an existing bookmarked
  URL.

### LST-10 · M1 · blocker · P2
**Active filters render as removable chips that stay in sync with the
URL.** Two statuses and one assignee applied.

- One chip per active filter facet, showing the human label
  ("Status: In progress, Blocked"), never the raw key.
- Clicking a chip's × removes exactly that facet from the URL and
  leaves the others intact.
- Removing the last chip leaves a URL with no filter params at all —
  not `?status=` with an empty value.
- The chip row and the dropdown checkboxes never disagree: unticking in
  the dropdown removes the chip and vice versa.

### LST-11 · M1 · blocker · P2
**Back and forward replay filter history step by step.** Apply status,
then assignee, then a sort.

- Back once undoes the sort, returning to the two-filter state with the
  table re-rendered accordingly.
- Back twice more peels off assignee then status.
- Forward re-applies them in order.
- At no point does Back exit the app while filter history remains.
- The table content after each Back matches what that URL renders on a
  cold load.

### LST-12 · M1 · major · P10
**The "Show archived" toggle includes archived tasks and marks them.**
Tracker has archived and unarchived tasks.

- Default (toggle off) shows no archived tasks; the URL has no
  `archived` param.
- Toggling on sets `archived=true` in the URL and archived rows appear
  with a visible archived badge distinguishing them from live rows.
- Archived tasks are *present and restorable*, matching the CLI's
  archive semantics — the toggle never surfaces deleted tasks, which
  are gone from disk entirely.
- Toggling off removes the param entirely rather than writing
  `archived=false`.

### LST-13 · M1 · blocker · P9
**Pagination reports an honest count and loads more in place.** 128
tasks match, page size 50.

- The footer reads "Showing 1–50 of 128" where 128 is the total
  matching the *active filters*, not the tracker's total task count.
- "Load more" appends rows 51–100; the label updates to "Showing 1–100
  of 128" and scroll position is preserved (the page does not jump to
  the top).
- After the third load the control disappears and the label reads
  "Showing 1–128 of 128".
- Applying a filter resets pagination — the label recomputes against
  the new total rather than continuing to claim 128.

### LST-14 · M1 · blocker · P10
**A DSL query in the search box runs the same language as the CLI.**
Type `status = in_progress and priority = high` and press Enter.

- The results equal what `loctt list -q 'status = in_progress and
  priority = high'` returns for the same tracker.
- The query is written to the URL as `q=...`, so the filtered view is
  bookmarkable and shareable.
- Reloading re-runs the query and the search box is repopulated with
  the original text verbatim, including whitespace and quoting.
- Any syntax the CLI accepts — `in`, `not in`, `~`, `today`, parens,
  `not` — is accepted here too, with no UI-only operators invented.

### LST-15 · M1 · major · P10
**Query aliases and dotted fields resolve as documented.** Run
`text ~ "login" and parent = WEB-3`.

- `text` searches title plus searchable built-in and custom fields, and
  does **not** match on attachment filenames or contents.
- `parent = WEB-3` accepts the user-facing key and matches children of
  that task.
- `has_link("blocks")` and `has_link("blocks", "T-10")` both parse and
  filter on edges, and the two-argument form matches only a task whose
  *same* edge satisfies both — not one edge of that kind plus a
  different edge to that target.
- `fields.story_points > 3` filters on a declared custom field.
- A custom field declared `searchable: false` is excluded from `text`
  matches but is still directly queryable by `fields.<key>`.

### LST-16 · M1 · major · P2
**The custom-field picker adds a filter for a declared field.**
`workflow.yaml` declares an enum custom field `team`.

- The "+ Filter" picker offers `team` alongside the built-in facets,
  labelled with the field's `label`.
- Selecting a value writes `field.team=platform` to the URL.
- **The result set narrows to tasks whose `team` is `platform`** — not merely that the param and the chip appear. `useTasks` stripped every `field.*` key, so this case passed while the filter did nothing.
- The resulting chip is removable like any built-in chip.
- The picker only offers fields permitted by `list-view.yaml`
  `filters.visible` / `hidden` when that config is present.

### LST-17 · M1 · major · P2 P8
**Filters, sort, and pagination compose into one shareable URL.** Apply
two filters, a sort, and load a second page.

- Copying the URL into a new tab reproduces the identical view:
  same chips, same sort indicator, same number of rows loaded.
- The reproduced view shows the **same rows**, compared by key — not
  merely the same row *count*, which two different filters can share.
- The recipient's own column layout applies (per LST-6) while the
  filter/sort state is exactly the sender's.
- Changing one facet leaves the others untouched in the URL.

## B. Edge cases

### B.1 — Data shape and scale

### LST-18 · M1 · major · P9
**5,000 tasks with no filter stay responsive.** Large tracker.

- The first page renders within a comparable time to a 50-task
  tracker — the client does not block on materializing all 5,000 rows.
- The footer total reads the true count ("Showing 1–50 of 5000"), not a
  capped or estimated number.
- Sorting by a column re-sorts across the whole result set, not just
  the loaded page: the first row after sorting by due date ascending is
  the earliest due task in the tracker, not the earliest of the loaded 50.
- Scrolling to the bottom and back does not lose loaded rows or reset
  the selection of the sort column.

### LST-19 · M1 · major · P9
**A task with 25 labels does not break the row.** One task carries 25
labels.

- The labels cell clamps to the row height — it does not push due,
  updated, or any later column out of the viewport or off the table.
- Overflow is indicated (e.g. "+18") rather than silently truncated, so
  the user can tell labels are hidden.
- Neighbouring rows keep their normal height; the table does not
  develop one giant row.

### LST-20 · M1 · major · P9
**A 400-character title with no spaces does not blow out the layout.**
Hand-edited task with an unbroken 400-char title.

- The title cell truncates with an ellipsis at the column boundary;
  the table does not scroll horizontally as a result.
- The full title is available on hover or via the detail view — the
  truncation is visual only and the stored value is unmodified.
- Adjacent columns retain their widths.

### LST-21 · M1 · minor · P9
**CJK, RTL, and emoji grapheme clusters render and sort sanely.**
Tasks titled in Arabic, Japanese, and one with a family emoji ZWJ
sequence.

- RTL titles render right-to-left within the cell without flipping the
  table's column order or the surrounding chrome.
- A multi-codepoint emoji cluster is not split mid-grapheme by
  truncation (no lone surrogate or orphaned skin-tone modifier).
- Sorting by title is deterministic and identical across reloads.
- These titles are searchable via `text ~` with the same characters.

### LST-22 · M1 · minor · P9
**Dates at the far ends of the range render correctly.** Tasks with
`due_date` of `1970-01-01` and `2099-12-31`.

- Both render as real dates, not "Invalid Date", not epoch `0`, and not
  a relative string like "56 years ago" where an absolute date belongs.
- Sorting by due date puts 1970 first ascending and 2099 last; neither
  is treated as "no date" and sorted into the empty-value group.
- A task with no due date sorts into a consistent group (all-empty
  together), not interleaved arbitrarily.

### LST-23 · M1 · major · P1
**Relative timestamps respect the workspace calendar timezone, not the
browser's.** Workspace timezone in `calendar.yaml` differs from the
browser's by enough to cross a day boundary.

- A task updated at 23:30 workspace time does not display as "tomorrow"
  or a date one day off because the browser is in a later timezone.
- The `due` column's date matches the date string stored in
  frontmatter — a `due_date` of `2026-05-01` reads as May 1 regardless
  of browser timezone, since it is a date, not an instant.
- The `updated` column, which is a true instant, is rendered in the
  workspace timezone consistently across all rows.

### B.2 — Config drift

### LST-24 · M1 · blocker · P7
**A status deleted from `workflow.yaml` while tasks still reference it
degrades visibly.** Remove `in_review` from config; tasks still store
`status: in_review`.

- Affected rows render the raw stored key with a clear "unknown"
  affordance (e.g. `in_review` marked as unrecognized), not a blank
  cell and not a crash.
- The rows remain visible and clickable — one config gap does not
  remove tasks from the list.
- The Status dropdown does not offer the deleted status as a filter
  option, but a URL still carrying `status=in_review` continues to
  match those tasks rather than erroring.
- The condition is explained somewhere the user can act on (a warning
  pointing at the config), not left as a silent visual oddity.

### LST-25 · M1 · major · P7
**An assignee referencing an archived user still resolves.** Task
assigned to a user later archived.

- The assignee cell shows the user's name with an "(archived)" suffix
  or equivalent marker — attribution on old work does not break.
- The Assignee filter dropdown does not offer archived users as new
  filter choices by default, but filtering by one via URL still matches.
- The name is not replaced by the raw ULID.

### LST-26 · M1 · major · P7
**A task with no `project` in frontmatter is listed, not hidden.**
Hand-edited task with the `project` key removed.

- The row appears with an empty/unknown project cell rather than being
  excluded from the unfiltered list.
- Filtering by any specific project excludes it (it belongs to none),
  which is correct and distinguishable from "the row vanished".
- The list does not crash on the missing field, and the row is still
  clickable through to its detail view.

### LST-27 · M1 · major · P7 P3
**Unknown priority and type keys are handled the same way as unknown
statuses.** Hand-edited frontmatter with `priority: urgent` where no
such key is declared.

- The cell shows the raw value flagged as unrecognized.
- Sorting by priority places unknown-value rows in a deterministic
  position rather than throwing or dropping them from the sorted set.
- The total count still includes these rows.

### LST-28 · M1 · minor · P1
**Unknown top-level frontmatter keys are ignored by the list without
being lost.** A task carrying an experimental `foo: bar` key.

- The list renders the task normally, ignoring `foo`.
- No column is auto-invented for `foo`, and it is not surfaced in the
  custom-field picker (it is not declared in `workflow.yaml`).
- Editing any field from the UI later does not strip `foo` from the
  file — verified by re-reading `task.md` on disk.

### B.3 — URL and state

### LST-29 · M1 · major · P2 P6
**An unknown sort key in the URL falls back visibly.** Paste
`/list?sort=nonexistent_field&dir=asc`.

- The list renders with the default sort rather than an empty table or
  an error page.
- No sort indicator is shown on a column that isn't actually sorting,
  which would misreport the order.
- The unrecognized key is either dropped from the URL or flagged; it
  does not silently persist as though it were applied.

### LST-30 · M1 · major · P2
**Out-of-range and malformed pagination params are clamped, not
obeyed.** Paste `?page=0`, `?page=-3`, `?limit=99999`, `?limit=abc`.

- `page=0` and `page=-3` resolve to the first page.
- `limit=99999` is clamped to the schema maximum (200) rather than
  requesting every task at once.
- `limit=abc` falls back to the default page size instead of producing
  `NaN` rows or an empty table.
- In each case the footer count is consistent with what is actually
  displayed.

> **Schema resolved (2026-08-14).** `listSearch.ts` previously used
> `z.coerce.number().int().positive()`, which *threw* on all four inputs
> above. Because the schema is the route's `validateSearch` and the
> client has no `errorComponent`, that took down the whole `/list` route
> rather than just pagination — the opposite of this case. Replaced with
> a clamping `urlInt`: garbage (`abc`, empty, `NaN`, `Infinity`) falls
> back to `undefined` so the consumer applies its default, and
> out-of-range clamps into `[min, max]`. The bound is still enforced,
> it just no longer breaks the route. The footer-count bullet remains a
> UI-side criterion.

### LST-31 · M1 · major · P2
**A truthy-looking `archived` param does not accidentally enable the
toggle.** Paste `?archived=false` and `?archived=0`.

- `archived=false` shows only non-archived tasks and leaves the toggle
  off — a coerced-boolean parse that turns the string `"false"` into
  `true` is a defect this case exists to catch.
- The toggle's visual state and the actual result set always agree: the
  user is never shown archived rows while the toggle reads off.

### LST-32 · M1 · minor · P2
**Unknown search params are preserved, not stripped.** Paste
`/list?status=done&debug=1`.

- The status filter applies normally.
- `debug=1` survives subsequent filter changes rather than being
  dropped on the next navigation, since the schema passes unknown keys
  through.
- No parse error is shown for the unrecognized key.

### LST-33 · M1 · major · P2
**A filter value referencing a deleted entity is honest about it.**
URL carries `milestone=<ulid>` for a milestone since deleted.

- The table shows zero rows *and* the chip indicates the referenced
  milestone no longer exists, rather than rendering a chip with a blank
  label that reads as a normal empty result.
- The user can remove the chip to recover.
- This is distinguishable from a valid milestone that simply has no
  tasks.

### LST-34 · M1 · minor · P2
**Duplicate values in a CSV param are de-duplicated.** Paste
`?status=done,done,in_progress`.

- The chip shows two statuses, not three.
- The result set is not duplicated (each matching task appears once).
- The normalized URL does not keep re-appending duplicates as the user
  interacts with the dropdown.

### LST-35 · M1 · major · P2 P9
**Filtering while a page-2 load is in flight does not mix result
sets.** Click "Load more", then immediately apply a status filter.

- The final table contains only tasks matching the new filter — rows
  from the superseded page-2 response never appear appended.
- The footer total reflects the filtered count, not the pre-filter one.
- No duplicate rows appear from the two overlapping responses.

### B.4 — Concurrency

### LST-36 · M1 · major · P1
**A task edited in the CLI while the list is open does not stay stale
indefinitely.** Change a task's status via `loctt` with the list
visible.

- The row reflects the new status after a refetch (window refocus,
  explicit refresh, or the app's polling interval) — not only after a
  full page reload.
- The stale row is never presented as authoritative in a way that
  causes a wrong write: acting on it must not push the old status back
  to disk.
- If the task no longer matches the active filter after the change, it
  leaves the list and the total count decrements accordingly.

### LST-37 · M1 · major · P1
**A task deleted underneath the list disappears cleanly.** Hard-delete
a listed task from the CLI.

- After refetch the row is gone and the total decrements.
- Clicking the row in the window between deletion and refetch leads to
  a "task not found" state that names the key, rather than a blank
  detail pane (see [flow-tasks.md](flow-tasks.md)).

### LST-38 · M1 · minor · P1 P2
**Two tabs hold independent list state.** Open `/list` twice with
different filters.

- Changing filters in tab A does not alter tab B's URL or visible
  chips — list state lives in the URL, not in shared storage.
- Both tabs reflect the same underlying task data after a refetch.
- Neither tab overwrites the other's column settings.

### LST-39 · M1 · minor · P1
**A task created in the CLI appears in a matching filtered view.**
Create a task via CLI matching the current filter.

- After refetch the new row is present and the total increments.
- It obeys the active sort — it is inserted at the correct position,
  not appended to the bottom regardless of sort.

### B.5 — Query box behaviour

### LST-40 · M1 · major · P2 P10
**A DSL query and structured filter chips compose predictably.** Type a
`q` query, then also pick a status from the dropdown.

- Both constraints apply — the result is the intersection, not the
  query replacing the chips or vice versa.
- Both are represented in the URL simultaneously (`q=...&status=...`).
- Removing the status chip leaves the query intact in the search box.
- The user can tell from the UI that two constraint sources are active.

### LST-41 · M1 · minor · P8
**An empty search box clears the query without clearing the chips.**
Clear the text and press Enter.

- The `q` param is removed from the URL entirely.
- Structured filter chips remain applied.
- The result set widens to the chips-only result.

### LST-42 · M1 · minor · P10
**A query string containing quotes and escapes round-trips.** Run
`text ~ "say \"hi\""`.

- The query executes rather than being mangled by URL encoding.
- After reload the search box shows the original text with quoting
  intact.
- The matched rows are those whose searchable text contains the literal
  `say "hi"`.

### LST-43 · M1 · minor · P9
**A query matching every task still paginates.** Run a query true for
all 5,000 tasks.

- The footer reads the full total and pagination behaves as in LST-13.
- The browser does not attempt to render all matches at once.

## C. Error cases

### LST-44 · M1 · blocker · P4
**A malformed query reports the error instead of returning zero
results.** Type `status = = in_progress` and press Enter.

- An inline error appears at the search box naming the problem
  ("Unexpected `=`") and indicating the offending token's position.
- The table does **not** render an empty result set with "No tasks match
  these filters" — a parse failure must never be presentable as a
  legitimate zero-match result.
- The previous result set either remains visible or the table clearly
  shows it is not displaying results; it does not appear that the
  query ran successfully and found nothing.
- The bad query is not written to the URL as though it were a valid
  applied state, or if it is, reloading reproduces the same visible
  error rather than a silent empty list.

### LST-45 · M1 · blocker · P4 P10
**An unknown field in a query names the field and what is valid.** Type
`assignedto = alice`.

- The error identifies `assignedto` as the unrecognized field, not a
  generic "invalid query".
- It points toward the valid alternative (`assignee`) or to the query
  help popover listing valid fields.
- The same query rejected by `loctt list` produces a comparably
  specific message — the UI does not accept syntax the CLI rejects, nor
  reject syntax the CLI accepts.

### LST-46 · M1 · major · P4
**A query referencing an undeclared custom field is distinguished from
a typo'd built-in.** Type `fields.velocity > 3` where `velocity` is not
declared.

- The message states that no custom field `velocity` is declared in
  `workflow.yaml` and where to declare it.
- It does not report a generic parse error, since the syntax is valid —
  the problem is a config reference.
- Zero rows are not shown as a plain empty result.

### LST-47 · M1 · blocker · P4 P6
**The API being unreachable is reported as such, distinctly from an
empty tracker.** Stop the server, then reload `/list`.

- The table area shows a failure state naming what failed (loading
  tasks), the reason (the LocTT server could not be reached), and a
  next action (retry / check the `loctt ui` process).
- It is never rendered as "No tasks yet" or "No tasks match these
  filters" — an unreachable backend must not read as an empty tracker.
- A retry control re-issues the request and, on success, renders rows
  without requiring a manual page reload.

### LST-48 · M1 · blocker · P4 P6
**One corrupt task file does not take down the list.** Hand-edit a
`task.md` to have unparseable YAML frontmatter.

- Every other task still lists.
- The failure is surfaced with the offending task's id/path so the user
  can go fix the file — it is neither silently skipped nor allowed to
  blank the whole table.
- The footer total is honest about what it counted, so the user is not
  told "of 128" while 127 rendered with no explanation.

### LST-49 · M1 · major · P4 P9
**A failed "Load more" does not look like the end of the list.** Fail
the second-page request.

- The footer still reads "Showing 1–50 of 128" — it must not update to
  imply all rows loaded.
- An error appears near the control naming the failure and offering
  retry.
- The "Load more" control remains available; it does not disappear as
  it does on genuine exhaustion (LST-13), which would falsely signal
  completion.
- Already-loaded rows are not discarded.

### LST-50 · M1 · major · P4
**A server error while applying a filter does not leave a lying
view.** Fail the request triggered by ticking a status.

- The error names the failed operation and offers retry.
- The chips do not show a filter as applied while the table still shows
  the unfiltered rows underneath — either the previous state is clearly
  retained, or the table is put into an explicit error state.
- The URL and the visible result never disagree silently.

### LST-51 · M1 · major · P4 P7
**A workflow config that fails schema validation is explained, not
crashed on.** Introduce a status with no `category` into
`workflow.yaml`.

- The list surfaces a config error identifying the file and the
  offending entry.
- The message tells the user to fix the YAML (or run `loctt doctor`),
  rather than showing a stack trace or a blank page.
- Filter dropdowns that depend on the broken config degrade to an
  explained disabled state rather than rendering empty and appearing
  to offer no statuses.

### LST-52 · M1 · minor · P4
**A request that times out is reported as a timeout, not as empty.**
Hold the tasks response open past the client timeout.

- The state names what was attempted (loading tasks), that no data was
  received, and offers retry.
- The loading skeleton does not spin indefinitely with no terminal
  state.
- On retry succeeding, the normal table replaces the error without a
  reload.
