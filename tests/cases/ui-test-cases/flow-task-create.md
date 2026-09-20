# Flow: Create task modal

The single create-task modal reached from the header `+`, from "+ Add
task" on a board column, and from the `n` keyboard shortcut — its
fields, the project resolution chain, "Create another", and the success
toast. What happens to the created task afterwards is
[flow-tasks.md](flow-tasks.md); where the new card lands on the board is
[flow-board.md](flow-board.md); label management beyond inline creation
is [flow-milestones-labels.md](flow-milestones-labels.md); the full body
editor (as opposed to the compact one here) is
[flow-tasks.md](flow-tasks.md) § body editor.

## A. Happy path

### NEW-1 · M3 · blocker · P8
**All three entry points open the same modal.** Open it from the header `+`, then from a board column's "+ Add task", then with `n`.

- The same component renders in all three cases — same field set, same layout, same heading.
- Only the pre-filled values differ (NEW-3, NEW-4); nothing is present in one entry point and absent in another.
- Opening from any entry point does not change the underlying route away from the current view; the URL either stays put or gains a modal-state param that back dismisses.

### NEW-2 · M3 · blocker · P8
**Creating a task with only a title succeeds.** Open the modal, type a title, submit.

- The submit control is enabled as soon as the title is non-empty.
- The task is created with the resolved project, and all other fields take their workflow defaults (first status, default priority/type per config) — not blank values that fail validation later.
- A `task.md` exists on disk with the typed title and a freshly allocated key using the project's `prefix`.
- The modal closes on success.

### NEW-3 · M3 · major · P8
**"+ Add task" on a board column pre-fills that column's status.** Click "+ Add task" on the `In review` column.

- The status field is pre-selected to `in_review` (the column's first status if the column collapses several — consistent with the drop behaviour in [flow-board.md](flow-board.md)).
- The pre-fill is editable: changing the status before submitting creates the task with the chosen status.
- On success, the new card appears in the column it was created from.

### NEW-4 · M3 · major · P8
**The `n` shortcut opens the modal from any view and focuses the title.** Press `n` on `/list`, `/board`, `/timeline`, and a task detail page.

- The modal opens in all four places.
- The title input has focus immediately; typing goes into the title, not into the page behind.
- `n` pressed while focus is inside a text input (search box, body editor, an inline edit) types the letter `n` and does **not** open the modal.
- `Esc` closes the modal and returns focus to the element that was focused before it opened.

### NEW-5 · M3 · blocker · P3
**Every enum field is populated from `workflow.yaml` with labels, storing keys.** Open the modal on a workspace with custom statuses, priorities, and types.

- Status, priority, and type dropdowns list exactly the configured entries, in configured order, showing `label`s.
- Nothing hardcoded appears — no "To Do / In Progress / Done" that isn't in the config, and no assumption of exactly three priorities.
- The created `task.md` stores the config `key`s (`in_progress`, `high`, `bug`), never the display labels.
- A workspace with seven priorities shows seven; a workspace with one task type shows one and does not hide the field.

### NEW-6 · M3 · major · P3
**Sprint, milestone, assignee, and reporter pickers list live config, excluding archived entries.** With one archived milestone, one archived sprint, and one archived user.

- Archived entries are not offered as new selections.
- Users are shown by display name; where two users share a name, a truncated id disambiguates.
- Reporter defaults to the current user; assignee defaults to empty (not to the current user), so the form doesn't silently assign work.
- Each picker has an explicit "None"/clear option so a pre-filled value can be removed.

### NEW-7 · M3 · major · P3 P8
**Labels support multi-select and inline creation.** Type a label name that does not exist yet.

- Existing labels filter as you type and are selectable with the keyboard.
- A "Create «name»" option appears for an unmatched string; choosing it writes a new entry to `labels.yaml` and selects it on the form.
- The new label is immediately visible to other surfaces — it appears in the list view's label filter and in `loctt` CLI output without a restart.
- Cancelling the modal after inline-creating a label leaves the label created (it was an explicit action) — or, if the implementation defers creation to submit, the label is *not* created and no orphan entry appears in `labels.yaml`. Whichever is chosen, the file and the UI agree.

### NEW-8 · M3 · major · P3
**Start and due date inputs respect the workspace calendar.** Open the date pickers.

- Non-working days per `calendar.yaml` are visually marked in the picker.
- The week starts on the configured `first_day_of_week`.
- Dates are stored as `YYYY-MM-DD` strings with no time component and no timezone conversion.
- Both fields are optional; submitting with neither set creates a task with neither date.

### NEW-9 · M3 · major · P8
**The compact body editor accepts markdown and stores it verbatim.** Type a paragraph, a bullet list, and a fenced code block.

- The created `task.md` body contains that markdown, matching what the full editor in task detail would have produced for the same input.
- The compact editor does not require expanding to a full page to be usable, and it does not steal the `Enter` key needed for submission-by-keyboard elsewhere in the form (submission is explicit).
- Leaving the body empty creates a task with an empty body, not a placeholder paragraph.

### NEW-10 · M3 · blocker · P3
**Custom fields declared in `workflow.yaml` appear with type-appropriate controls.** Config with a `string`, a `number`, a `date`, a `boolean`, and a `multi: true` `enum`.

- Five controls render: a text box, a number input, a date picker, a checkbox, and a multi-select limited to the declared `values`.
- The enum shows value `label`s and stores value `key`s.
- Submitted values land under `fields:` in frontmatter, not alongside built-in fields.
- A workspace with zero custom fields shows no empty "Custom fields" section header.

### NEW-11 · M3 · blocker · P8
**"Create another" preserves project and type, clears and refocuses the title.** Fill in project, type, title, priority, assignee, and labels; check "Create another"; submit.

- The task is created.
- The modal stays open.
- Project and type retain their values.
- **The cleared fields are absent from the second task's frontmatter** — priority, assignee and labels do not carry over. Checking only that the form looks empty misses a stale value still posted.
- The title is empty and has focus, so the next title can be typed without touching the mouse.
- Priority, assignee, labels, dates, and body are cleared — carrying an assignee or a due date silently into the next task is the specific failure this case guards against.
- Submitting again creates a second distinct task with the next key in sequence.

### NEW-12 · M3 · major · P4 P8
**A success toast names the task and links to it.** Create a task.

- The toast shows the allocated key and the title (truncated if long).
- It contains an "Open" action that navigates to `/tasks/<key>`.
- The toast dismisses on its own after a few seconds and is manually dismissible.
- With "Create another" checked, each creation produces its own toast (or a stacked/updated one) — creations are never silent.

### NEW-13 · M3 · blocker · P1 P10
**The created task appears in the underlying view without a manual reload.** Create from `/list` with a filter that the new task matches.

- The row appears in the list, and the total count increments to match.
- Creating from `/board` puts the card in the column matching the chosen status.
- Creating a task that does **not** match the active filter does not silently appear; the toast is the confirmation, and the count does not change. The user is not left thinking creation failed — the toast's "Open" link is the escape hatch.

## B. Edge cases

### B1. Project resolution

### NEW-14 · M3 · blocker · P3 P10
**Explicit project beats everything.** The user has a default project, the workspace has a different `projects.yaml#default`, and the modal's project field is set to a third project.

- The task is created in the explicitly chosen third project.
- Its key uses that project's `prefix` and increments that project's counter in `state.yaml`; the other two projects' counters are untouched.

### NEW-15 · M3 · blocker · P3
**With no explicit choice, the user's `default_project` wins over the workspace default.** `users/<id>/settings.yaml` has `default_project: web`; `projects.yaml#default` is `backend`.

- The project field opens pre-filled with `web`.
- The created key uses the `web` prefix.
- Switching to a different user whose settings name `backend` and reopening the modal pre-fills `backend` — the resolution is per-user, not global.

### NEW-16 · M3 · blocker · P3 P7
**A user default pointing at a deleted project is silently ignored and resolution falls through.** `default_project: archive_me`, a project that has since been hard-deleted; `projects.yaml#default` is `backend`.

- The modal pre-fills `backend`, not `archive_me`.
- **No error is shown for the stale preference** — this must not error, per the documented resolution semantics. "No error" is not "no trace": the dangling value is surfaced in Settings → My preferences and by `loctt doctor` (PRU-14), just not here, where it would interrupt a create.
- The dangling preference is not silently rewritten in `settings.yaml` by merely opening the modal; it stays on disk for `loctt doctor` to report.
- Creating succeeds and the task lands in `backend`.

### NEW-17 · M3 · major · P3 P7
**A user default pointing at an *archived* project falls through the same way.** `default_project` names a project with `archived: true`.

- The archived project is not pre-selected and is not offered in the picker.
- Resolution falls to the workspace default (or the next rung).
- Creating a task into an archived project is not possible from the modal at all.

### NEW-18 · M3 · major · P3
**With no user default and no workspace default, a single project is auto-selected.** `projects.yaml` has exactly one project and no `default` key.

- The project field is pre-filled with that project.
- The field may be shown read-only/disabled, but it must still be visible — the user should be able to see which project their task lands in.

### NEW-19 · M3 · blocker · P4 P6
**With multiple projects and no default at any level, the modal asks rather than guessing.** Three projects, no `projects.yaml#default`, no user default.

- The project field opens **empty** and is marked required for this session.
- The task is not created with an arbitrarily picked project — picking "the first one" here is the failure this case exists to catch.
- Submitting without choosing shows an inline message on the project field naming what's needed and why ("Pick a project — this workspace has no default"), not a generic form error.
- Once a project is chosen, submission succeeds.

### NEW-20 · M3 · major · P3 P7
**A workspace default naming a nonexistent project degrades to the ask state.** `projects.yaml#default: ghost` with no such project defined.

- Resolution falls through to the unique-single-project rung, and failing that, to the ask state of NEW-19.
- The modal does not pre-fill a project that doesn't exist and it does not show a blank pre-filled control that looks chosen.
- The config drift is surfaced somewhere actionable (banner or Settings), not only in the modal.

### NEW-21 · M3 · major · P1
**Changing the project mid-form re-derives project-scoped options.** Switch from `web` to `backend` after choosing a milestone that only exists conceptually for `web`.

- The key preview (if shown) updates to the new prefix.
- Any selections that are no longer valid are cleared with a visible indication rather than silently submitted and rejected by the server.
- Status/priority/type are workspace-level and are **not** cleared by a project change.

### B2. Field values and scale

### NEW-22 · M3 · major · P9
**A 500-character title is accepted or clamped, but never truncated silently.** Paste a very long title.

- Either the field enforces a documented maximum with a visible counter as the limit approaches, or the full title is stored intact.
- What lands in `task.md` matches what the user saw in the field at submit time — no server-side trim that the user wasn't shown.
- The success toast truncates for display only.

### NEW-23 · M3 · minor · P9
**Whitespace-only titles are rejected as empty.** Type three spaces.

- Submit stays disabled (or submitting shows the required-field message on the title).
- A task with a whitespace title is never created.
- A title with meaningful leading/trailing whitespace around real text is trimmed, and the trimmed form is what's stored.

### NEW-24 · M3 · minor · P9
**Selecting 25 labels does not break the form layout.** Add 25 labels to one task.

- Label chips wrap inside the field's container; the form's other fields do not shift off-screen and the submit button stays reachable.
- The field scrolls internally if needed rather than growing the modal past the viewport.
- All 25 land in the created task's `labels` array.

### NEW-25 · M3 · minor · P9
**A picker backed by 500 users or 200 labels is searchable, not a 500-row dropdown.** Seed a large user set.

- The picker filters as you type and shows a bounded number of results.
- Keyboard navigation works within the filtered list.
- The list is not fetched-and-rendered in full on every keystroke to the point of visible lag.

### NEW-26 · M3 · minor · P3
**A due date before the start date is caught in the form.** Set start 2026-04-10 and due 2026-04-02.

- An inline message on the date fields names the problem before submission.
- The task is not created with the inverted range (which would render as an anomaly on the timeline — see [flow-timeline.md](flow-timeline.md) TML-18).
- Correcting either date clears the message.

### B3. Modal lifecycle

### NEW-27 · M3 · major · P5 P8
**Dismissing a modal with entered content asks before discarding.** Type a title and a body, then press `Esc` or click the backdrop.

- A confirmation appears; the typed content is not destroyed on a single misclick.
- Cancelling the confirmation returns to the modal with all content intact, including the body editor's state.
- An untouched modal closes immediately with no confirmation — the prompt is proportionate.

### NEW-28 · M3 · major · P8
**Focus is trapped in the modal and restored on close.** Tab through the form repeatedly.

- Focus cycles within the modal and never reaches the page behind it.
- The background is inert to clicks and to keyboard interaction.
- On close, focus returns to the trigger (`+` button, the board column's "+ Add task", or the element focused when `n` was pressed).

### NEW-29 · M3 · minor · P8
**Double-submitting does not create two tasks.** Click submit twice rapidly, or press Enter twice.

- Exactly one task is created.
- The submit control disables (or otherwise guards) for the duration of the request, and the pending state is visible.
- If the first request is slow, the second click does not queue a second creation once the first resolves.

### NEW-30 · M3 · major · P1 P7
**Config changed underneath an open modal does not produce a stale submission.** With the modal open, delete a status from `workflow.yaml`, then select it and submit.

- The submission is rejected with a message naming the status key and explaining the config changed (see NEW-35), or the dropdown refreshes and clears the now-invalid selection with a visible notice.
- A task is never created with a status key that no longer exists.

### NEW-31 · M3 · minor · P8
**Opening the modal while another modal or panel is open behaves predictably.** Press `n` while a confirm dialog is open.

- Either `n` is ignored while a modal owns focus, or the create modal stacks with a coherent focus trap on top.
- Two competing focus traps do not leave the keyboard stuck between them.

## C. Error cases

### NEW-32 · M3 · blocker · P4 P6
**A create that fails on the server keeps the form and its content.** Server returns 500 on submit.

- The modal stays open with every entered value intact — a form that closes and loses a typed body on failure is the specific failure this case guards against.
- The message names what failed ("Couldn't create the task"), the reason as reported, and the next action (retry).
- No `task.md` directory exists on disk and no key counter in `state.yaml` was consumed.
- Retrying after the server recovers creates exactly one task.

### NEW-33 · M3 · blocker · P4
**A key-counter allocation failure is reported honestly.** Make `state.yaml` unwritable (or hold the state lock from another process past the timeout) and submit.

- The message names the operation and the reason (the tracker's state file could not be updated / another process is writing) and suggests retrying.
- No task directory is left behind without a valid key.
- After releasing the lock, retrying succeeds and the allocated key is the next in sequence with no gap-plus-orphan.

### NEW-34 · M3 · blocker · P4 P7
**Creating into a project deleted between modal-open and submit fails specifically.** Delete the selected project via CLI, then submit.

- The message names the project and says it no longer exists, and asks the user to pick another.
- The project picker refreshes to the current set.
- The form content is preserved so the user only has to re-pick the project.
- No task is created, and no orphan key from the deleted project's retired counter is consumed.

### NEW-35 · M3 · major · P4 P7
**A rejected archived-reference is explained in the reference's own terms.** Archive a milestone via CLI while the modal has it selected, then submit.

- The message names the milestone by its label and says it was archived, and points at the field.
- The offending field is highlighted; the rest of the form is untouched.
- Clearing the field and resubmitting succeeds.

### NEW-36 · M3 · major · P4
**Inline label creation that fails does not leave a phantom selected label.** Force the `labels.yaml` write to fail while creating a label inline.

- The label does not appear as selected on the form as if it existed.
- The message names the label and says it could not be created, with a retry.
- `labels.yaml` is unchanged — no partial or duplicate entry.
- The rest of the form is unaffected and the task can still be created without that label.

### NEW-37 · M3 · major · P4 P6
**A create submitted with no connection is honest about the outcome.** Kill the server, then submit.

- The message says the task was **not** created and names the connection as the reason.
- The modal stays open with content preserved.
- There is no toast claiming success, and no optimistic row/card appears in the view behind the modal.
- After the server returns, retrying creates exactly one task — the offline attempt did not queue a duplicate.

### NEW-38 · M3 · major · P4
**A response that succeeds but returns an unparseable body still tells the user what state their data is in.** Truncate the create response.

- Per P4's rare exception, the message may not know the cause — but it must state what was attempted (creating the task), that the task's state is uncertain, and what to do (reload the list to check before retrying).
- The modal does not close silently as if it succeeded, and it does not report a clean failure it can't actually vouch for.
- See [flow-error-handling.md](flow-error-handling.md) § F.

### NEW-39 · M3 · major · P4
**"Create another" that fails mid-sequence does not clear the form.** Create two tasks successfully with "Create another" on, then fail the third.

- The third attempt's title and any other entered values remain in the form.
- The message makes clear that the first two were created and the third was not, so the user doesn't re-enter work that already exists.
- The counter/keys reflect exactly two created tasks.

### NEW-40 · M3 · minor · P4 P7
**A custom-field value rejected by core's type validation is explained at the field.** Enter a non-numeric value into a `number` custom field in a way the input permits (paste).

- The inline message names the field label and the expected type.
- The error is attached to the field, not shown as a generic toast at the top.
- No task is created, and the rest of the form is preserved.

### NEW-41 · M3 · minor · P4 P6
**A modal opened while the tracker's schema is outdated does not offer a broken create.** With `.schema-version` behind `CURRENT_SCHEMA_VERSION`.

- The modal either does not open, or opens with the create action disabled and an explanation pointing at the migration (per the schema banner in [flow-app-shell.md](flow-app-shell.md)).
- No half-written task lands on disk under an old schema.

### NEW-42 · M3 · major · P4 P3
**The New-task modal shows the empty-title block as a visible cue and pre-fills configured defaults.**

- This case does NOT re-assert the disable — Create is already disabled on an empty title (`CreateTaskModal.tsx:181,265,665`) and NEW-2 (tagged, passing) already pins submit-enabled-only-when-title-non-empty; re-asserting it would fail step 1 as a duplicate of NEW-2.
- The residual, narrowed: the disabled Create is a **visible** cue (`disabled:opacity-60`, not a live-looking button).
- Status and Type **pre-fill** from the `workflow.yaml` defaults (`backlog` etc.) rather than showing "—". (UX-14.)
