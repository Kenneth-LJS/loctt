# Flow: bulk operations and export

Selection in the list view, the sticky bulk bar, every bulk mutation it
offers, and CSV/JSON export of the current filter state. Lands in
**M1.4**. Filtering, sorting, pagination, and URL state are
[flow-list.md](flow-list.md); single-task archive/delete/move are
[flow-tasks.md](flow-tasks.md); the generic error quality bar is
[flow-error-handling.md](flow-error-handling.md). The cross-surface
races that bulk exposes (another process mutating a selected task
mid-operation) are shared with [flow-cross-surface.md](flow-cross-surface.md);
cases here assert what the *bulk bar* does about them.

Bulk mutations go through core's `bulkSetFields` / `bulkArchive` /
`bulkMoveTasksToProject`, which return a `BulkResult`
(`{ bulk_op_id, succeeded[], failed[{ taskId, error }] }`). That shape
is the contract the UI must honour: partial success is the normal
outcome, not an exception, and the `failed[]` array carries a distinct
reason per task.

## A. Happy path

### BLK-1 · M1 · blocker · P8 P9
**A row checkbox selects exactly one task and nothing else.** Start on
`/list` with no selection.
- Each row renders a checkbox that is reachable by keyboard (Tab to it,
  Space toggles).
- Clicking one checkbox marks that row selected and leaves every other
  row unselected.
- The row gains a visible selected treatment (not colour alone — a
  border, background, and the checked box together).
- Clicking the checkbox again deselects; no navigation to the task
  detail occurs from a checkbox click.
- Clicking anywhere else in the row still navigates to `/tasks/$key` —
  the checkbox is the only non-navigating hit area.

### BLK-2 · M1 · blocker · P5 P9
**The bulk bar appears on the first selection and states the count.**
- With zero rows selected, no bulk bar is present in the DOM (not merely
  hidden by opacity).
- Selecting one row shows the bar with the text "1 task selected"
  (singular).
- Selecting a second shows "2 tasks selected" (plural).
- The count is the number of *selected* rows, not the number of rows on
  the page and not the filter's total.
- The bar is sticky: scrolling the list to row 50 keeps the bar visible
  and its count unchanged.

### BLK-3 · M1 · blocker · P5 P9
**Select-all in the header selects the visible page and says so.** Load
a filter matching 1,280 tasks with page size 50.
- The header checkbox selects the 50 rows currently rendered.
- The bar reads "50 tasks selected" — it must NOT read "1,280 tasks
  selected" and must not imply the whole match set.
- Adjacent to the count the bar states the scope explicitly, e.g.
  "50 on this page selected".
- Every visible row's checkbox is checked; the header checkbox is in the
  checked (not indeterminate) state.
- Unchecking the header checkbox clears all 50 and hides the bar.

### BLK-4 · M1 · major · P5 P9
**"Select all N matching" is a separate, explicit action.** With the
visible page selected on a 1,280-match filter.
- If the affordance exists, it renders as its own control ("Select all
  1,280 matching") — never as a side effect of the header checkbox.
- Activating it changes the bar text to name the larger scope
  ("All 1,280 matching tasks selected") and offers "Select only this
  page" to step back down.
- The stated N equals the filter's `total` from `/api/tasks`, the same
  number shown by the pagination summary.
- If the affordance does not exist, no control anywhere in the bar
  claims a scope larger than the visible page.

### BLK-5 · M1 · blocker · P3 P9
**Bulk Set status applies the chosen status to every selected task.**
Select 5 tasks, open Set status.
- The dropdown lists the statuses from `workflow.yaml` by their `label`,
  in configured order — not a hardcoded To Do / In Progress / Done set.
- Choosing one issues a single bulk call, not five sequential ones.
- On success the bar reports "5 tasks updated" and the list rows show
  the new status label without a full page reload.
- The stored value in each `task.md` is the status `key`, not the label.
- Tasks whose status was already the chosen value are still counted as
  succeeded (core treats a no-op as success), and the result does not
  claim a change that didn't happen in the file's `updated_at`.

### BLK-6 · M1 · major · P3 P9
**Bulk Set priority uses configured priorities.** Select 3 tasks.
- The priority picker lists the workflow's priorities by label, ordered
  by their `value` when present, alphabetically when not.
- A workspace configured with seven priorities shows all seven; a
  workspace with two shows two.
- Applying writes the priority `key` to each task.
- A "Clear priority" option is offered and unsets the field rather than
  writing an empty string.

### BLK-7 · M1 · major · P3 P7
**Bulk Set assignee excludes archived users from the picker.**
- The assignee picker lists active users by display name.
- Archived users do not appear as selectable options for a *new*
  assignment (the archived-reference guard would reject them anyway).
- Selecting a user assigns them to every selected task; the stored value
  is the user's ULID, not their display name.
- An "Unassign" option is offered and clears the field.

### BLK-8 · M1 · major · P3 P7
**Bulk Set milestone and Set sprint behave like Set assignee.**
- Both pickers list only non-archived milestones/sprints from
  `milestones.yaml` / `sprints.yaml`, by label.
- Both offer a clear/none option.
- Both write the config `key`.
- Sprint options indicate state (active / future / completed) so the
  user isn't silently assigning work to a completed sprint.

### BLK-9 · M1 · major · P9 P10
**Move to project relocates every selected task and rekeys them.**
Select 4 tasks in project `WEB`, move to project `BACKEND`.
- The project picker lists non-archived projects by label.
- After the move each task's `project` is `backend` and its `key` has
  the `BACKEND-` prefix.
- Each moved task's previous key is preserved in `key_history`, so
  pasting the old key into the list search still resolves.
- The result names the new keys (or offers a link to the moved set), not
  just a count.
- The list refreshes; if the current filter is scoped to `WEB`, the
  moved rows leave the view and the total drops by 4.

### BLK-10 · M1 · blocker · P5 P10
**Bulk Archive is immediate, undoable, and not gated behind a typed
confirm.** Select 6 tasks and choose Archive.
- No typed-confirmation dialog appears — archive is reversible, so
  demanding one is itself a violation.
- At most a lightweight confirm ("Archive 6 tasks?") with the cancel
  button focused by default.
- On success the rows disappear from the default (non-archived) view and
  the pagination total drops by 6.
- An Undo affordance is offered in the success message and restores all
  6 when used.
- Toggling "Show archived" reveals the 6 with an archived badge.

### BLK-11 · M1 · blocker · P5
**Bulk Delete demands a typed confirmation scaled to the blast radius.**
Select 12 tasks and choose Delete.
- A modal opens naming the count and the irreversibility in plain words
  ("Permanently delete 12 tasks. This cannot be undone.").
- The modal requires typing an exact confirmation string; the delete
  button stays disabled until it matches.
- Initial focus is on the text input or Cancel — never on the delete
  button.
- `Esc` and Cancel both close the modal with nothing deleted.
- The modal states that delete is distinct from archive and offers
  archive as the reversible alternative.

### BLK-12 · M1 · blocker · P5 P9
**Confirmed bulk delete removes the tasks and reports honestly.**
- After confirming, the 12 task directories under `.loctt/tasks/<ulid>/`
  are gone, along with their `_history.yaml`, comments, and attachments.
- The result states "12 tasks deleted" only when `failed[]` is empty.
- The selection is cleared and the bulk bar disappears.
- The pagination total decreases by exactly 12.
- No Undo is offered — offering one for an irreversible action is a
  violation.

### BLK-13 · M1 · minor · P8
**Clear selection (×) empties the selection without side effects.**
- Clicking × deselects every row, hides the bulk bar, and mutates
  nothing.
- `Esc` while focus is inside the bulk bar performs the same clear.
- After clearing, the header checkbox returns to unchecked.

### BLK-14 · M1 · blocker · P2 P9
**Export CSV applies the current filter state.** Filter to
`priority = high`, 37 matches, then Export → CSV.
- The request goes to `/api/tasks/export` carrying the same filter
  parameters as the `/api/tasks` request behind the current view.
- The downloaded file contains exactly 37 data rows plus one header row.
- The response carries `Content-Type: text/csv` and a
  `Content-Disposition: attachment` filename.
- The header row lists the export columns in a stable order.
- The export reflects the *filter*, not the *selection* — with 3 rows
  checked, the CSV still has 37 rows unless a distinct "Export selected"
  action was chosen.

### BLK-15 · M1 · major · P10
**Export JSON produces native-typed values.** Same filter, Export →
JSON.
- The response is a JSON array of objects, one per matching task.
- `labels` is a JSON array, not a comma-joined string; numeric custom
  fields are numbers, not quoted strings.
- Stored `key`s appear for status/priority/type — the JSON is data, not
  a rendering, so it must match what the CLI's export emits for the same
  query.
- `Content-Type: application/json` and an attachment filename are set.

### BLK-16 · M1 · minor · P8
**The export menu states what will be exported before committing.**
- The menu shows the row count that will be exported ("Export 37
  tasks").
- Both CSV and JSON are offered from the same menu.
- The count matches the filter total, not the page size.

### BLK-17 · M1 · minor · P9
**Bulk actions the current workspace can't satisfy are hidden, not
broken.**
- With no milestones defined in `milestones.yaml`, Set milestone is
  either absent or disabled with a reason ("No milestones defined —
  add one in Settings → Milestones").
- The same holds for sprints and for a single-project tracker's Move to
  project.

## B. Edge cases

### B.1 Selection lifecycle

### BLK-18 · M1 · blocker · P2 P9
**A filter change invalidates a selection rather than silently carrying
it.** Select 20 rows, then change the status filter.
- The selection is cleared when the result set changes, OR the bar
  states that some selected tasks are no longer visible with an exact
  count ("20 selected · 6 not in current filter").
- What must not happen: the bar silently keeps saying "20 tasks
  selected" while operating on rows the user can no longer see.
- If the selection survives, applying a bulk action still targets the
  original 20 and the result names all 20 — not just the 14 visible.
- Back-navigating to the previous filter does not resurrect a cleared
  selection out of thin air.

### BLK-19 · M1 · major · P2 P9
**Paginating past the selected page keeps the count honest.** Select 50
on page 1, then Load more / page 2.
- If selection persists across pages, the bar still reads "50 tasks
  selected" and page 2's rows are unchecked.
- The header checkbox on page 2 reflects page 2's state (unchecked),
  not page 1's.
- Selecting all on page 2 gives "100 tasks selected", and the scope text
  no longer says "on this page".

### BLK-20 · M1 · major · P9
**Sorting re-orders rows without dropping or corrupting the
selection.** Select 5 scattered rows, then sort by due date.
- The same 5 tasks remain selected, now at different row positions.
- The count is unchanged at 5.
- Selection is tracked by task id, not by row index — a task that moves
  from row 2 to row 40 stays checked and the task now at row 2 does not
  become checked.

### BLK-21 · M1 · minor · P8
**Shift-click selects a contiguous range.**
- Click row 3's checkbox, shift-click row 9's: rows 3–9 inclusive are
  selected (7 tasks).
- The anchor for the next shift-click is row 9.
- Shift-clicking upward from the anchor works symmetrically.
- If range selection isn't implemented, plain clicks still work and
  shift-click behaves as a plain click — never as a select-all.

### BLK-22 · M1 · major · P1 P9
**A selected task deleted by another process is reported, not silently
skipped.** Select 8 tasks; delete one via `loctt task delete` in a
terminal; then bulk Set status.
- The result reports 7 succeeded and 1 failed.
- The failure names the missing task by its key (or by the ref the UI
  sent) and gives the reason core returned — "task not found".
- The result does not say "8 tasks updated".
- The vanished row is removed from the list on refresh rather than
  lingering as a ghost row.

### BLK-23 · M1 · major · P1
**A selected task edited by the CLI mid-selection reflects the new
values after the bulk op.** Select 4 tasks; change one's priority in the
CLI; then bulk Set status.
- The bulk status change succeeds on all 4.
- The CLI's priority change is preserved — the bulk write must not
  clobber fields it wasn't asked to change.
- The refreshed row shows the CLI's priority, not the pre-selection one.

### BLK-24 · M1 · minor · P9
**Selecting every row of a 5,000-task filter via page selection stays
responsive.** Page size 50, "select all matching" not used.
- Header select-all on a 50-row page completes without a visible freeze.
- Repeatedly loading more and selecting all does not degrade to
  multi-second checkbox toggles at 500 selected.
- The bar's count updates immediately on each toggle, not after a
  debounce long enough to look broken.

### B.2 Bulk mutation semantics

### BLK-25 · M1 · major · P9 P10
**A bulk op spanning multiple projects works and states the spread.**
With the project switcher on "All projects", select tasks from `WEB`
and `BACKEND` and bulk Set status.
- The operation succeeds across both projects — bulk is not silently
  scoped to the active project.
- The success message reflects the total ("12 tasks updated") and, where
  useful, the per-project breakdown.
- Each task keeps its own project and key prefix; nothing is rekeyed by
  a field change.

### BLK-26 · M1 · major · P3 P9
**Bulk Move to project across mixed source projects rekeys each task
from the destination counter.** Select 3 `WEB` and 2 `BACKEND` tasks,
move all to `OPS`.
- All 5 come out with `OPS-` keys, numbered from `state.yaml`'s
  `keys.ops` counter without gaps or reuse.
- Each of the 5 has its former key appended to `key_history`.
- Tasks already in `OPS` (if any were selected) are a no-op success, not
  a rekey — moving a task to its current project must not burn a key
  number.

### BLK-27 · M1 · major · P9
**Bulk archive of tasks that are already archived is a no-op, reported
as such.** With "Show archived" on, select 3 archived and 3 active
tasks, choose Archive.
- The 3 active tasks are archived.
- The 3 already-archived tasks are reported as unchanged, not as errors
  and not as newly archived.
- The message distinguishes the two groups ("3 archived · 3 already
  archived").

### BLK-28 · M1 · major · P7
**Bulk assigning an archived user is refused before the write.** Reach
an archived user (e.g. via a stale URL or by archiving a user in another
tab after opening the picker), then apply.
- The archived-reference guard rejects the assignment.
- The bar reports zero succeeded and names the reason: the user is
  archived and cannot receive new assignments.
- The message says what to do — unarchive the user, or pick another.
- No task is partially updated: the other selected fields in the same
  call are not written either, since the whole change set was invalid.

### BLK-29 · M1 · major · P3 P7
**A status deleted from `workflow.yaml` between page load and apply is
handled.** Select 5 tasks with the Set status menu open; remove that
status from the config; apply.
- The apply fails per task with a reason naming the unknown status key.
- The bar suggests reloading to pick up the current workflow.
- Rows whose stored status is now orphaned render with a drift
  indicator rather than a blank cell.

### BLK-30 · M1 · major · P5 P9
**The delete confirmation names the actual scope, including a
"select all matching" scope.** With "All 1,280 matching" selected,
choose Delete.
- The modal says 1,280, not the visible page size.
- The confirmation string required is proportionate — deleting 1,280
  tasks must not require the same keystroke as deleting 2.
- If the app refuses to bulk-delete beyond a threshold, it says so and
  states the threshold rather than silently truncating the batch.

### BLK-31 · M1 · minor · P9
**Bulk actions are disabled while one is in flight.**
- After confirming a bulk op, the bar's controls are disabled and show
  in-progress state.
- Double-clicking Apply does not issue a second bulk call — no duplicate
  `bulk_op_id` runs.
- The list is not refetched into a partially-mutated intermediate state
  that flickers rows in and out.

### BLK-32 · M1 · minor · P9
**One bulk op produces one collapsible activity group per task.** After
bulk Set status on 5 tasks, open one task's Activity tab.
- The status change entry carries the shared `bulk_op_id`.
- The activity feed collapses it as a bulk row rather than as an
  ordinary single edit (see
  [flow-comments-activity.md](flow-comments-activity.md)).

### B.3 Export

### BLK-33 · M1 · blocker · P9 P10
**CSV escapes commas, quotes, and newlines per RFC 4180.** Export a task
whose title is `Fix "quoted", comma` and whose body/description field
contains a newline.
- The title cell is emitted as `"Fix ""quoted"", comma"`.
- A field containing CRLF or LF is wrapped in quotes and the newline is
  preserved inside the quotes — the row is not split into two rows.
- Opening the file in a spreadsheet yields one row per task with the
  column count intact.
- A `labels` array of `["a,b", "c"]` does not silently collapse into an
  ambiguous `a,b,c` cell that reimports as three labels.

### BLK-34 · M1 · major · P9
**Exporting 5,000 rows completes and does not lock the UI.**
- The export runs without a browser out-of-memory failure.
- The UI shows progress or at least a pending state on the export menu
  while the response streams.
- The downloaded CSV has 5,001 lines (header plus 5,000) allowing for
  quoted embedded newlines.
- The user can keep browsing the list while the download completes, or
  the UI clearly blocks and says why.

### BLK-35 · M1 · minor · P9
**Export with zero matches produces a valid empty file, not an error.**
- Filter to something matching 0 tasks and export.
- CSV contains the header row and no data rows.
- JSON contains `[]`.
- The UI does not offer a misleading "0 tasks exported" success next to
  a file the user didn't get — either it downloads the empty file and
  says so, or it disables export and explains that nothing matches.

### BLK-36 · M1 · minor · P3
**Custom fields are excluded by default and named explicitly when
included.**
- The default CSV columns match core's `DEFAULT_EXPORT_COLUMNS` — no
  sparse per-project custom-field columns appear unasked.
- If a column picker exists, custom fields appear as `fields.<key>` and
  the header uses a name the user can map back to `workflow.yaml`.

### BLK-37 · M1 · minor · P2
**An export URL is reproducible.**
- The `/api/tasks/export` request's query string encodes the filter such
  that pasting it produces the identical file.
- No filter state that affects the export lives only in React state.

## C. Error cases

### BLK-38 · M1 · blocker · P4 P9
**Partial failure names every failure individually with its own
reason.** Bulk delete 40 tasks where 3 fail (one missing, one locked,
one with an unreadable frontmatter).
- The result must NOT read "40 tasks deleted".
- It reads "37 of 40 tasks deleted · 3 failed".
- Each of the 3 is listed by key with its own reason text, not a shared
  generic message — "task not found", "could not acquire lock", "failed
  to parse frontmatter" are three distinct lines.
- Each failed row offers a next action (open the task, retry just the
  failures).
- The 37 successes are not rolled back — the operation is not
  transactional, and the UI must not imply it was.

### BLK-39 · M1 · blocker · P4 P9
**Total failure is distinguished from partial failure.** Bulk archive
where every task fails.
- The message reads "0 of 6 tasks archived" and lists all 6 reasons.
- It does not render as a success with a count of zero.
- A retry action re-issues the operation for the same 6.

### BLK-40 · M1 · blocker · P4
**A refused bulk op names the field, the value, and the fix.** Attempt a
bulk Set field that core rejects wholesale (e.g. an immutable or
auto-managed field reaching the API).
- The error names the field, says it cannot be set, and says why
  (immutable / auto-managed).
- The selection is preserved so the user can pick a different action.
- No task in the batch was modified.

### BLK-41 · M1 · major · P4 P6
**A bulk request that never returns is bounded and honest about
state.** Simulate the server hanging on a bulk call.
- After a bounded wait the UI stops the spinner and states that the
  result is unknown.
- Per P4's rare exception, the message covers all three: what was
  attempted ("archiving 8 tasks"), what state the data is in
  ("some may have been archived"), and what to do ("reload to see the
  current state, then retry the remainder").
- It does not claim success, and it does not claim failure.
- Reloading shows the real outcome from disk.

### BLK-42 · M1 · major · P4
**A bulk op blocked by the state lock says which lock and what to do.**
Hold the state lock (a long-running `loctt` command or an in-progress
migration), then bulk Set status.
- The error names the contention — another LocTT process is writing, or
  a schema migration is running.
- It advises waiting or finishing the other operation.
- It does not surface `proper-lockfile` internals or a stack trace.
- Retrying after the lock clears succeeds.

### BLK-43 · M1 · major · P4 P6
**Export failure is not a silent no-download.** Force
`/api/tasks/export` to 500.
- An error appears in the UI naming the export as the failed action and
  its reason.
- The absence of a downloaded file is not the only signal.
- A retry action is offered, and retrying with a working server
  produces the file.

### BLK-44 · M1 · major · P4 P6
**A malformed task in the filtered set doesn't kill the whole export.**
Hand-corrupt one `task.md`'s frontmatter, then export the filter that
includes it.
- Either the export succeeds and names the skipped task, or it fails
  and names the offending file path.
- What must not happen: a truncated file that silently omits the bad row
  with no mention.
- The same task renders in the list with a broken-task indicator rather
  than blanking the list (see [flow-list.md](flow-list.md)).

### BLK-45 · M1 · major · P4 P5
**A failed delete leaves no half-deleted task.** Force a delete to fail
partway (e.g. attachments directory not removable).
- The failure names the task and the reason.
- The task still resolves by key and still appears in the list — there
  is no directory left behind that reads as an unloadable ghost.
- If the task is genuinely in an inconsistent state, the message says so
  and points at the file path.

### BLK-46 · M1 · major · P4 P7
**A bulk move to a project that was archived mid-flight is refused with
a reason.**
- The archived-reference guard rejects the move.
- The message names the destination project and says it is archived, and
  offers unarchiving or picking another destination.
- The source tasks are unchanged and keep their original keys — no key
  number was consumed from the destination counter.

### BLK-47 · M1 · minor · P4 P9
**Selecting more tasks than the API accepts in one request is handled
before the request.**
- If a batch cap exists, the UI states it at selection time or at apply
  time ("Bulk actions apply to at most N tasks at once").
- Either the UI chunks the request and reports the aggregate honestly
  (summing succeeded and failed across chunks), or it refuses and says
  why.
- It never truncates silently to the first N and reports success for the
  full selection.

### BLK-48 · M1 · minor · P4
**A network drop mid-bulk is reported with unknown-state honesty.**
- The message names the operation, states that the outcome is unknown,
  and tells the user to reload.
- On reload the list reflects whatever actually committed.
- The stale selection is not silently reapplied to a changed data set.
