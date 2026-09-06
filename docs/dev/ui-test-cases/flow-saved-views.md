# Built-in filters and saved views

The six built-in saved filters in the sidebar, the "Save as view" basic
editor that writes back to `queries.yaml`, and the advanced raw-DSL
editor with parse-error markers. The filter-bar controls a built-in
click populates are [flow-list.md](flow-list.md); the sidebar chrome and
pinning behaviour is [flow-app-shell.md](flow-app-shell.md); the Saved
views settings panel (rename, archive, delete) is
[flow-settings.md](flow-settings.md).

Two facts drive most cases. First, a `SavedQuery` is
`{ id (ULID), name (mutable, referenced by id), query (DSL string),
sort?: [{field, direction}], display?, archived? }` — so views created
in the UI must be runnable as `loctt list --view <name>` and via MCP
(P10). Second, the core evaluator returns **false** for an unknown
field rather than throwing, so a typo'd field name naturally produces
zero rows; the UI must catch that *before* evaluation and distinguish
it from a query that legitimately matches nothing (P4).

## A. Happy path

### VUE-1 · M1 · blocker · P3 P9
**Five of the six built-in filters render with live count badges.** Sidebar shows Assigned to me, Reported by me, Mentions me, Due this week, Overdue, High priority.
- Assigned to me, Reported by me, Due this week, Overdue, and High priority each show a numeric badge.
- Each badge equals the number of rows actually returned when that filter is applied — click through and count; the two must match exactly.
- Badges reflect the current user; switching user changes Assigned to me and Reported by me.
- A badge of zero renders as `0` or is suppressed by a stated rule — never as a stale non-zero count.

### VUE-2 · M1 · blocker · P6 P4
**"Mentions me" renders without a count and is non-interactive until M2.4.**
- It shows no count badge — not `0`, which would be a false claim about the data.
- It is not clickable and is visibly de-emphasised or disabled rather than looking live and doing nothing.
- Hover/focus explains that mentions arrive with comments in a later milestone.
- After M2.4 it becomes interactive and gains a badge like the other five.

### VUE-3 · M1 · blocker · P2 P10
**Clicking a built-in sets equivalent URL filter state the user can see and modify.** Click "High priority".
- The list narrows to high-priority tasks and the URL carries the filter state.
- The filter bar shows the equivalent removable chip(s) — the user can see *why* rows matched.
- Removing the chip widens the result set; the built-in is not a black box the user cannot edit.
- Pasting the URL into a new tab reproduces the same rows and the same chips.

### VUE-4 · M1 · major · P2
**Back after clicking a built-in restores the previous view.**
- The prior filter state and result set return; the browser does not leave the app.
- Forward re-applies the built-in.

### VUE-5 · M1 · major · P10
**"Overdue" and "Due this week" agree with the CLI's interpretation of the same predicate.**
- Overdue matches tasks whose `due_date` is before today **and** which are not in a `completed`/`discarded` category status — a completed task past its due date is not listed as overdue.
- Due this week's window boundaries are stated in the UI (which day the week starts, whether the ends are inclusive) and match `calendar.yaml`'s first day of week.
- The equivalent `loctt list` query returns the same set.

### VUE-6 · M1 · blocker · P1 P10
**"Save as view" in basic mode writes to `queries.yaml` and is immediately usable elsewhere.** Build a filter in the bar, save it as `my-open-bugs`.
- A new entry appears in `.loctt/config/queries.yaml` with a generated ULID `id`, the given `name`, and a `query` string.
- **`queries.yaml` still parses as a whole after the write.** `config/queries.ts` rejects the entire file on one bad entry, so a malformed save silently destroys every other view — re-read the file, do not just check the new entry is present.
- `loctt list --view my-open-bugs` returns the same tasks the UI showed — same count, same keys.
- The MCP `list_tasks` tool with that view parameter returns the same set.
- The view appears in the sidebar's saved-view group without a restart.

### VUE-7 · M1 · major · P3
**The basic editor offers only fields and values from the live config.**
- Status, priority, and type options come from `workflow.yaml` and show **labels** while storing **keys**.
- The saved `query` string contains config keys (e.g. `status = in_progress`), never display labels.
- Custom fields declared in `workflow.yaml` are selectable as predicates.
- No hardcoded "To Do / In Progress / Done" appears for a tracker that does not define those keys.

### VUE-8 · M4 · blocker · P4 P10
**Advanced mode exposes a raw DSL textbox with live parse-error markers.**
- The textbox accepts the full documented grammar and runs on demand.
- A syntactically valid query executes and the row count matches what the same string returns from `loctt list --query`.
- While typing an incomplete query, the error marker updates live rather than only on submit.
- A valid query clears all markers.

### VUE-9 · M4 · major · P8
**A syntax-help popover documents the grammar without leaving the editor.**
- It covers operators (`=`, `!=`, `<`, `<=`, `>`, `>=`, `in`, `not in`, `~`), `and`/`or`/`not`, parentheses, and the `text`, `today`, `parent` aliases.
- It covers `has_link(...)` / `link_count(...)`, `fields.*` custom fields, and `status.category`.
- It is dismissible with `Esc` and does not discard the query in progress.

### VUE-10 · M4 · blocker · P10
**Basic → Advanced is lossless.** Build a multi-predicate filter in basic mode, then switch to Advanced.
- The generated DSL reproduces every predicate — none dropped, none added.
- Running the generated DSL returns exactly the same rows as the basic filter did.
- Switching back to Basic without editing restores the identical basic-mode controls.
- Sort entries survive the round trip.

### VUE-11 · M4 · blocker · P4 P10
**Advanced → Basic is disabled with an explanation when the query is not visually expressible.** Enter a nested `or` with parentheses that basic mode cannot represent.
- The Basic toggle is disabled, not silently lossy — the query is never rewritten or truncated to fit.
- The disabled control explains *why*: which construct (e.g. nested disjunction) basic mode cannot represent.
- A query that *is* expressible re-enables the toggle and round-trips per VUE-10.

### VUE-12 · M4 · major · P3 P10
**Editing a built-in opens the editor with the built-in's DSL pre-populated.**
- Choosing "edit" on "High priority" opens the editor showing the actual DSL behind it, not an empty box.
- The pre-populated DSL, run as-is, returns the same rows the built-in returned.
- Saving it creates a **new** user view rather than mutating the built-in, or, if built-ins are overridable, states clearly which is happening.

### VUE-13 · M1 · major · P1 P10
**Saved view sort entries persist as `field` + `direction` and apply in order.**
- Saving a view with sort `priority desc` then `updated_at desc` writes both entries in that order to `queries.yaml`.
- Applying the view sorts by priority first, using the priority `value` ordering from `workflow.yaml` (not alphabetical by key).
- Ties within a priority are broken by `updated_at` descending.
- `loctt list --view <name>` produces the same row order.

### VUE-14 · M1 · major · P1
**A view applied from the sidebar sets URL state matching its saved query.**
- Clicking a saved view narrows the list and the URL reflects the view.
- The URL carries the **specific params** the view implies, named explicitly — and a cold load of that URL returns the same rows as the click did.
- The filter bar shows the view's predicates as chips where expressible; where not expressible, it shows the raw query with an indication that it is a DSL view.
- Modifying a chip is presented as diverging from the saved view (e.g. a "modified" indicator), not as silently rewriting the saved view.

## B. Edge cases

### VUE-15 · M1 · major · P2
**Clicking a built-in while another filter is already active replaces rather than silently merging.**
- The resulting result set matches the built-in's definition exactly — leftover chips from the previous filter do not silently narrow it further.
- If the design merges instead, every contributing chip is visible in the bar and the count badge's meaning is stated, since badge and row count would otherwise disagree.
- Whichever rule applies, the URL fully describes the resulting state.

### VUE-16 · M1 · major · P9
**Count badges stay honest against a large tracker.** 5,000 tasks, 1,280 matching "Assigned to me".
- The badge shows the true total (1,280), not the first page size.
- The badge is not capped silently; if capped for display (`999+`), the true count is available on hover and the list header states the real total.
- Badge computation does not block the sidebar from rendering.

### VUE-17 · M4 · major · P9
**A saved view with five sort fields applies all five in order.**
- All five entries persist to `queries.yaml` in the authored order.
- The sort is stable and reproducible: reloading yields the identical row order.
- The editor allows reordering the five and the reorder is reflected in the written file.
- `loctt list --view` produces the identical order.

### VUE-18 · M4 · major · P10
**A DSL query using every operator and nested parentheses parses and runs.** e.g. `(status in (in_progress, blocked) or priority >= 3) and not (text ~ "spike") and due_date <= today and has_link("blocks") and parent = T-5`.
- It parses without error and returns a set matching the same string run through `loctt list --query`.
- Basic mode is correctly disabled for it (VUE-11).
- Saving and reloading the view preserves the query string **byte-for-byte** — no reformatting that changes semantics, no stripped parentheses.

### VUE-19 · M4 · major · P10 P4
**A `today` query behaves predictably across a timezone boundary.** Run `due_date <= today` shortly before and after local midnight in a non-UTC workspace timezone.
- The date `today` resolves to is discoverable by the user — the UI states the resolved date (and which timezone it used) rather than leaving an off-by-one-day result unexplained.
- The UI's result set matches what `loctt list` returns for the same query at the same moment; the two front-ends do not disagree about what day it is.
- If `today` resolves in UTC while the workspace `calendar.yaml` timezone differs, that divergence is either fixed or explicitly surfaced — a task due "today" locally silently missing from the result is the failure mode.

> **Core resolved (2026-08-14).** `today` now resolves in the workspace
> `calendar.yaml` timezone across CLI, MCP, and web; the web client takes
> the resolved date from `GET /api/info` rather than the browser clock, so
> the two front-ends can't disagree. Trackers with no `calendar.yaml` fall
> back to UTC, and `loctt init` writes the machine's zone so new trackers
> aren't in that state. The remaining UI-side criterion is the first
> bullet — *stating* the resolved date and zone in the UI.

### VUE-20 · M4 · major · P1 P7
**A saved view whose name collides with an existing one is handled explicitly.**
- Saving a second view named `overdue` warns before writing, since CLI `--view` resolution is by name.
- The user can rename or explicitly confirm; if confirmed, the UI states how `loctt list --view overdue` will resolve the ambiguity.
- The written entries retain distinct `id`s regardless.
- Collision with a **built-in** name is likewise flagged rather than shadowing it silently.

### VUE-21 · M4 · major · P7
**A saved view referencing a deleted custom field degrades visibly.** Delete a custom field from `workflow.yaml` that a saved view filters on.
- Applying the view surfaces that the query references an unknown field, naming the field.
- It does not return zero rows presented as a legitimate empty result.
- The sidebar entry is not silently removed; the view remains editable so the user can fix it.
- Other saved views continue to work.

### VUE-22 · M4 · major · P7
**A saved view whose query no longer parses after a hand edit is flagged, not hidden.**
- The sidebar still lists the view, marked as broken.
- Clicking it shows the parse error with the offending position rather than an empty list.
- The advanced editor opens pre-populated with the broken query so it can be repaired in place.
- Other views and the rest of the sidebar render normally.

### VUE-23 · M4 · minor · P9
**A very long DSL query stays editable.** A 2,000-character query.
- The textbox scrolls and does not truncate the stored query on save.
- Error markers still resolve to correct positions deep into the string.
- The saved file round-trips the full string.

### VUE-24 · M1 · major · P3
**A tracker with no `high` priority key does not break the "High priority" built-in.**
- The built-in resolves against the actual priority set (e.g. by `value` threshold or the top-ranked priority), not a hardcoded `high` key.
- Its label reflects the user's vocabulary, or the built-in is hidden when it cannot be expressed — it never shows a permanently-zero badge caused by a key that does not exist.

### VUE-25 · M4 · minor · P2
**An archived saved view is excluded from the sidebar but still runnable.**
- It does not appear in the default sidebar list.
- Its URL still resolves and returns the correct rows.
- Unarchiving restores it to the sidebar with the same `id`.

### VUE-26 · M4 · major · P1
**A view added to `queries.yaml` by the CLI appears in the UI.**
- Creating a view via CLI while the UI is open surfaces it on the next refresh of the views data.
- Its query, sort, and name match the file exactly.

### VUE-27 · M4 · major · P1
**Saving a view does not clobber concurrent edits to `queries.yaml`.** Add view A via CLI, then save view B in the UI.
- Both A and B are present in the file afterwards.
- Neither write drops the other's entry or reorders existing entries destructively.

### VUE-28 · M4 · minor · P10
**A query that legitimately matches nothing shows an empty state, not an error.** e.g. a valid `status = blocked` on a tracker with no blocked tasks.
- The result is an intentional empty state saying no tasks match, with the active filters shown.
- No error marker appears in the DSL box, because the query is well-formed.
- This state is visually distinct from every error case in § C.

### VUE-29 · M4 · minor · P8
**The advanced editor is keyboard-operable.**
- The DSL box is reachable by keyboard; the run action has a keyboard trigger.
- `Esc` closes the editor, warning first if there are unsaved changes.
- Focus lands somewhere sensible when an error marker appears, without stealing focus mid-keystroke.

### VUE-30 · M1 · minor · P2
**Built-in badges refresh after a mutation that changes their membership.**
- Reassigning a task to the current user increments "Assigned to me" without a full page reload.
- Completing an overdue task decrements "Overdue" — consistent with VUE-5's completed-exclusion rule.

## C. Error cases

### VUE-31 · M4 · blocker · P4
**A malformed DSL highlights the offending token at its position and never silently returns zero rows.** e.g. `status = = done`.
- The error names what was expected and what was found, and marks the position of the offending token in the textbox.
- The marker aligns with the actual character offset the parser reported — off-by-one marker placement is a failure.
- The result area shows an error state, **not** an empty result list; zero rows would read as "no matches" rather than "your query is broken".
- The previous valid result set is not silently replaced by an empty one.

### VUE-32 · M4 · blocker · P4
**An unknown field name is distinguished from a syntax error and suggests valid fields.** e.g. `assignne = alice`.
- The message says the *field* is unknown and names it — it does not report a generic syntax error, because the string parses fine.
- It suggests close matches from the real field set (built-ins plus `workflow.yaml` custom fields), e.g. "did you mean `assignee`?".
- It does **not** return zero rows as though the query were valid — the core evaluator's false-for-unknown-field behaviour must be caught before results are shown.
- Saving a view containing an unknown field is blocked or explicitly warned, so the broken query does not reach `queries.yaml` unnoticed.

> **Core resolved (2026-08-14).** `validateQuery` runs before evaluation
> and raises `QueryValidationError` with the offending token's `position`
> and near-miss `suggestions`, so the UI no longer has to catch this
> itself — it renders the error rather than deriving it. Note the
> deliberate asymmetry: an ad hoc query throws, but a *saved view* that
> references a since-deleted custom field warns and still runs (via the
> `onWarning` callback), because breaking a view that used to work would
> regress existing trackers. Passing an ad hoc query alongside `--view`
> makes it throw again — that query is the user's, not the view's.

### VUE-33 · M4 · blocker · P4 P3
**An unknown enum value is distinguished from a well-formed query that matches nothing.** e.g. `status = frobnik` where `frobnik` is not a configured status key.
- The UI reports that `frobnik` is not a valid value for `status` and lists the valid keys from `workflow.yaml`.
- This is visibly different from VUE-28's legitimate empty result, and different again from VUE-31's syntax error and VUE-32's unknown field — three distinct messages, not one shared "no results".
- If the user typed a status **label** ("In progress") where a key was required, the message says so and offers the corresponding key.

### VUE-34 · M4 · major · P4
**An unterminated string or unbalanced parenthesis is reported at the right place.** e.g. `text ~ "unclosed` and `(status = done and priority = high`.
- The error names the unterminated construct and marks its opening position, not the end of input, so the user can find it.
- Both cases produce distinct, specific messages rather than a shared generic parse failure.

### VUE-35 · M4 · blocker · P4 P1
**A failed write to `queries.yaml` does not leave a phantom view in the sidebar.** Make the config read-only, then save a view.
- The save reports failure, naming the file and the reason (permission denied).
- The view does not appear in the sidebar as though it had been created — a UI-only view that does not exist in `queries.yaml` is a direct P1 violation.
- The editor retains the user's query so the work is not lost, and offers a retry.

### VUE-36 · M4 · major · P4 P7
**A `queries.yaml` that fails schema validation is reported, not swallowed.** Introduce an entry missing `query`.
- The sidebar's saved-view group shows a load error naming the file and the offending entry.
- The group does not render as simply empty, which would read as "no saved views".
- Built-in filters continue to work, since they do not depend on the file.

### VUE-37 · M4 · major · P4
**An invalid sort field in a saved view is reported at apply time.** Sort on a field that does not exist.
- Applying the view names the invalid sort field and states that the rows are unsorted or fell back to a default order.
- The rows are still shown — a bad sort does not blank the result set.
- The editor flags the sort row so it can be corrected.

### VUE-38 · M4 · major · P4 P5
**Deleting a saved view that is pinned or referenced warns before removing it.**
- The confirmation names the view and states that pinned sidebar references will be dropped.
- After deletion, stale pins are swept rather than rendering as broken sidebar entries (P7).
- Deletion removes the entry from `queries.yaml`; `loctt list --view <name>` then reports an unknown view rather than silently returning all tasks.

### VUE-39 · M4 · minor · P4
**A query timing out or failing server-side is reported as a failure, not as zero results.**
- The result area states that the query could not be completed, what was attempted, and offers a retry.
- Per P4's rare exception, if the cause is genuinely unknown the message still says what was attempted, that no data was changed, and what to try next.
- The empty-state copy from VUE-28 is never reused for this case.

### VUE-40 · M4 · major · P2 P10
**A saved view can be created from the UI.**
- The sidebar "+ New filter" (disabled today, `Sidebar.tsx:715`) opens a create-view flow (name + query, reusing the advanced query editor).
- The created view is written to `queries.yaml`, appears in the sidebar, and is runnable via `loctt views` (P10 parity).
- The write cannot poison the file (cf. VUE-37).

### VUE-41 · M4 · major · P1 P2
**A saved view can be renamed and its query edited from the UI**, via an Edit dialog on the Saved views panel (`PUT /api/views/:id` / core `editView`).
- Reloading shows the new name/query.
- `loctt views` agrees.
