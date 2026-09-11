# Flow: settings shell and panels

Covers the `/settings/$section` shell and its grouped navigation, the
read-only workflow panels that mirror `workflow.yaml`, custom fields and
estimation, the calendar, personal preferences, sidebar pins, and the
Diagnostics panel including the schema migrate action (M4.1–M4.4). The
Projects and Users panels have their own doc,
[flow-projects-users.md](flow-projects-users.md); Git sync has
[flow-git-sync.md](flow-git-sync.md); the saved-view editor reached from
the Saved views panel is in [flow-saved-views.md](flow-saved-views.md).

## A. Happy path

### SET-1 · M4 · blocker · P2
**Every settings section is a real route.** Settings opened from the header menu.

- Landing on `/settings` redirects to a concrete section (e.g. `/settings/general`) rather than rendering an empty pane.
- Clicking each nav item changes the URL to `/settings/<section>` and the browser back button steps back through the sections visited, not out of the app.
- Pasting `/settings/calendar` into a fresh tab opens the Calendar panel directly, with the nav item highlighted.
- Leaving settings and returning via back restores the last section, not the default one.

### SET-2 · M4 · major · P8
**Navigation is grouped and the groups are meaningful.**

- The nav shows five groups — Workspace, Workflow, Data, Tracker, Personal — with each panel under exactly one.
- The group containing the active section is expanded and its item is visually marked active.
- Every group heading is non-interactive or collapses; neither behaviour navigates away by accident.
- Every panel reachable from the nav resolves — no nav item routes to a 404 or an unimplemented placeholder at M4 close.

### SET-3 · M4 · blocker · P1 P3
**Workflow panels render `workflow.yaml` faithfully and are editable.** Settings → Workflow → Statuses, on a tracker with six statuses.

This case previously asserted the panels were read-only. That was an early draft superseded and never removed: SET-5, SET-6, SET-8, SET-9, SET-16, SET-17, SET-19, SET-21 and SET-34 all assume editing, and `PUT /api/workflow` plus `config/workflow-write.ts` exist to support it.

- All six statuses render in file order, each showing its `label`, its `key`, and its `category` (`pending` / `active` / `completed` / `discarded`).
- Exactly one status is marked as the default, and the marker is visible — it decides where new tasks land.
- The panel shows the absolute path of the file it reflects (`.loctt/config/workflow.yaml`), so a user editing YAML directly knows where to look.
- Editing the file in a terminal and refreshing the panel shows the new set — the panel is a lens, not a cache.
- Edits made in the panel are written back through `PUT /api/workflow`; see SET-16/SET-19 for the remap flow when a key in use is removed.

### SET-4 · M4 · major · P3
**Priorities, task types, and relationships each mirror their config faithfully.**

- Priorities show `label`, `key`, and `value`, sorted by `value`; a tracker with two priorities renders two rows and a tracker with seven renders seven — nothing assumes a fixed count.
- Task types show `label` and `key` with no invented semantics attached (no "epic" special-casing).
- Relationships show forward `label`/`key`, `inverse`/`inverse_label`, `graph` (`none` / `acyclic` / `tree`) and `ranked` as explicit indicators rather than unlabelled icons. `graph` replaced the former `structural` boolean; `symmetric` is not among these — it is `kind: symmetric`, a separate discriminator (SET-5).
- A relationship configured with a custom key like `duplicates` appears with the user's own labels — nothing hardcodes `blocks` / `depends_on`.

### SET-5 · M4 · major · P3
**Symmetric relationships fold to one row.** A relationship declared `kind: symmetric` (e.g. `related_to`). The discriminator is the `kind` field, not an inferred same-key inverse and not a separate `symmetric` boolean — the schema rejects a symmetric relationship whose `inverse` differs from its `key`.

- It renders as a single row marked symmetric, not as two rows that look like a duplicate config entry.
- The inverse label fields are hidden or shown as "same as forward" rather than blank inputs, so the row does not read as misconfigured.
- Where the panel exposes a symmetric checkbox (editable relationship UX), ticking it hides the inverse key/label fields in the same interaction; unticking restores them with their previous values, not blanks. The checkbox is a control over `kind` (`symmetric` vs `directional`) — it does not write a separate `symmetric` boolean, which the schema has no field for.

### SET-6 · M4 · major · P1 P8
**Drag-reorder persists where the panel supports it.** Reordering statuses in a panel that allows it.

- Dragging a status to a new position shows a live drop indicator and lands where it was dropped.
- The new order is written to `workflow.yaml` in that order; `loctt config show` reflects it.
- The order survives a **cold reload** of the app, not just the next render — client state that outlives a refetch but not a refresh is the failure mode this guards.
- The board's column order and every status dropdown in the app follow the new order on next render.
- Reordering priorities recomputes `value` from position, so sorting by priority in the list matches the new order without a manual edit.

### SET-7 · M4 · major · P3
**Custom fields render with their declared types.** `workflow.yaml` declares a `string`, a `number`, a `date`, a `boolean`, and a single-select `enum`.

- Each field row shows label, key, type, `multi`, and `searchable`.
- The enum row expands to show its declared `values` with `key`, `label`, and `value`.
- The task detail panel renders one input control per type — a text box, a number box, a date picker, a checkbox, a select — and a `multi: true` enum renders a multi-select.
- The list view offers each field as a filterable column, matching the predicate names accepted by the query language (`fields.story_points`).

### SET-8 · M4 · major · P3
**A custom enum's weights sub-table is editable and used for sorting.**

- Each enum value has an optional numeric weight in a sub-table beneath the field.
- Setting weights XS=1, S=2, M=3, L=5 and sorting the list by that field orders rows by weight, not alphabetically.
- Clearing all weights makes the sort fall back to declared-value order (or alphabetical), and the panel says which fallback applies.

### SET-9 · M4 · major · P3
**Estimation config switches between numeric, enum, and disabled.**

- With `enabled: false`, no Estimate field appears on task detail, in the create modal, or as a list column.
- Switching to a numeric mode (`points`) makes Estimate a number input suffixed with the unit label everywhere it appears; sprint/milestone aggregates show a sum.
- Switching to `custom_enum` requires both `unit_label` and `preset_values` before it can be saved, and the panel says so on the field that is missing.
- In enum mode the Estimate control becomes a select over the preset values, and aggregates render as counts per category rather than a sum.

### SET-10 · M4 · major · P3 P10
**Calendar config drives date pickers.** Calendar set to `Europe/Berlin`, first day Monday, working days Mon–Fri, with 2026-05-01 as a holiday.

- Every date picker in the app starts its week on Monday.
- Saturdays, Sundays, and 2026-05-01 are visually marked non-working in the picker and faintly shaded on the timeline.
- "Due this week" and any "N working days" computation skips the marked days; the same query run via `loctt list` gives the same set.
- Changing first day of week to Sunday reflows every picker on next render without a reload.

### SET-11 · M4 · major · P1
**My preferences and the theme picker persist per user.**

- The theme picker offers light / dark / system; picking dark repaints immediately.
- The choice is written to the acting user's `settings.yaml` and survives a reload and a server restart.
- Switching to another user shows *their* theme (see [flow-projects-users.md](flow-projects-users.md) PRU-9); switching back restores dark.
- `system` follows the OS preference live — toggling the OS theme repaints without a reload.

### SET-12 · M4 · major · P1 P3
**Card layout drag editor changes the board.**

- The editor lists the available card fields with visible/hidden state and a drag handle for order.
- Dragging assignee above labels and hiding due date changes every board card on the next render, in that order, with no due date.
- The layout is saved per user; a second user's board is unaffected.
- **The write landed in `settings.yaml`**: re-read the file and confirm the new `card_layout` array, in order. SET-11 checks disk for its panel; this one asserted only the render.
- The editor shows a live card preview so the effect is visible before leaving the panel.

### SET-13 · M4 · major · P1 P7
**Sidebar pins are a drag list that sweeps stale entries.**

- The pins panel lists the currently pinned saved views in sidebar order with drag handles.
- Reordering the list reorders the sidebar group immediately and persists per user.
- A pin referencing a view since deleted from `queries.yaml` is dropped silently from both the panel and the sidebar — the sidebar does not render a broken entry or crash.
- The sweep does not remove pins whose views merely have zero matching tasks; those still render with a `0` badge.

### SET-14 · M4 · blocker · P4 P10
**Diagnostics runs the equivalent of `loctt doctor` inline.**

- Running Diagnostics lists every check by name with an explicit pass / fail / warn state — not a single aggregate "OK".
- The check set matches what `loctt doctor` reports for the same tracker; the UI has not invented or omitted checks.
- Each failing check names the affected file or entity (e.g. the task key with the dangling status reference), not just the check name.
- Each failing check states a specific remedy, and checks whose remedy is CLI-only say so and print the exact command — e.g. key-index drift says to run `loctt doctor --rebuild-index` and does not offer an in-app button that cannot work.
- Re-running after fixing something in a terminal flips that check to pass without a page reload.

### SET-15 · M4 · blocker · P1 P7
**The schema migrate button returns the schema to current.** `.schema-version` is one behind `CURRENT_SCHEMA_VERSION`, so the shell shows the `outdated` banner.

- The banner's "Migrate now" is present for the `outdated` kind only.
- Clicking it states what will happen before it runs: the from/to versions and that a backup snapshot of `.loctt/` is taken first.
- It POSTs to `/api/migrate`; on success the response reports the version moved from and to.
- `.schema-version` now equals `CURRENT_SCHEMA_VERSION`, a `.loctt.backup-v<from>-<ts>-<rand>/` directory exists as a sibling, and the banner clears without a page reload.
- The rest of the app becomes writable again in the same session — a status change on a task now succeeds.

## B. Edge cases

### B1. Workflow and custom fields

### SET-16 · M4 · blocker · P3 P7
**A custom field's type is locked after creation, inside the Edit dialog.** Field `story_points` exists as `number` with values on 40 tasks.

- Opening the field's **Edit dialog**, the type control is disabled (not merely validated on submit) and states why: existing task values were stored under this type.
- Label, `searchable`, and (where safe) `multi` remain editable in the same dialog, so the lock reads as targeted.
- No request that would change `type` is accepted server-side either — re-enabling the control in devtools and submitting is rejected.
- The dialog offers the honest alternative: create a new field and migrate, rather than pretending the change is possible.

> The existing SET-16 caveat that `number → string` is allowed when no task data is incompatible (`assertCustomFieldTypeChangesAreSafe`) still applies to the "where safe" wording. This case supersedes the earlier inline-field-row form; the guarantees are the same, the surface moves to the Edit dialog.

### SET-17 · M4 · major · P5 P7
**Deleting a status still referenced by tasks.** `in_review` is the status of 9 tasks.

- The panel shows the reference count before the delete is confirmed.
- The confirm requires either a remap target (another status) or the explicit choice to clear the status on those tasks — no silent orphaning.
- Choosing remap moves all 9 tasks and reports the count moved.
- Choosing to clear is allowed; the dialog states plainly that the status field will be cleared on those 9 tasks (they become status-less), and after confirming, the field is cleared on disk — no dangling reference is created and no drift marker or Diagnostics warning results. (BUG-2, decided 2026-09-06: the old copy promised a dangling reference + drift marker + Diagnostics check, but the server clears the field, so the copy is corrected to match the real behaviour.)

### SET-18 · M4 · major · P3 P7
**A task references a status that no longer exists in `workflow.yaml`.** Hand-deleted from the file while tasks still use it.

- The task's status renders as the raw key with an explicit drift marker ("not in workflow.yaml"), never blank and never silently coerced to the first status.
- The board puts such tasks in an "Unknown status" lane rather than dropping them from the board entirely.
- Diagnostics reports it as a failing check naming the task keys and the missing key.
- Editing the task's status to a valid one clears the marker for that task.

### SET-19 · M4 · major · P3
**Deleting an enum value that tasks still hold.** Custom enum value `sprint_1` is set on 12 tasks.

- The value row shows its own reference count.
- Deleting demands remap-or-clear the same way statuses do; the count is repeated in the confirm.
- Choosing clear removes the value from those 12 tasks' frontmatter (the field is emptied), stated plainly in the dialog; after confirming, the value is gone from disk with no dangling key and no drift marker. (BUG-2 sibling, decided 2026-09-06: the old copy said cleared tasks would render the raw key with a drift marker and be surfaced by Diagnostics, but the server clears the field, so the copy is corrected.)

### SET-20 · M4 · minor · P3 P9
**A workflow with 25 statuses does not break the panels or the board.**

- All 25 render in the Statuses panel; the panel scrolls rather than clipping.
- Every status dropdown in the app becomes searchable rather than a 25-item scroll.
- The board renders 25 columns with horizontal scrolling and no column collapsing to zero width; the status chips bar wraps or scrolls rather than overflowing the header.

### SET-21 · M4 · minor · P3
**Reordering priorities recomputes values without gaps causing a resort surprise.**

- Moving Critical from last to first sets its `value` such that priority sort in the list immediately puts Critical first.
- Existing tasks are untouched — only `workflow.yaml` changed; no task frontmatter was rewritten.
- Saved views that sort by priority reflect the new order on next run, and the same view via `loctt list --view` agrees.

### B2. Calendar

### SET-22 · M4 · major · P6 P7
**A calendar with every day marked non-working.**

- The panel accepts it but warns explicitly that no working days remain and that working-day computations will not resolve.
- Date pickers render every day marked non-working rather than rendering an all-blank month.
- Any "N working days from today" computation returns a designed state — an explanation naming the calendar as the cause — rather than hanging, looping, or returning today.
- Diagnostics flags the empty working-day set as a warning.

### SET-23 · M4 · minor · P9
**A holiday list of 500 entries.**

- The panel paginates or virtualises the list; it does not render 500 rows into a single unscrollable block.
- Adding a 501st holiday and saving stays responsive, and the date picker's month render is not visibly slowed.
- Duplicate dates in the list are shown as duplicates with a warning rather than silently deduplicated.

### SET-24 · M4 · major · P4 P7
**A timezone that no longer exists in the IANA database.** `calendar.yaml` has `timezone: America/Godthab` (renamed) or an outright invalid string.

- The panel shows the stored value, marks it unresolvable, and names the file it came from.
- Date rendering falls back to a stated fallback (UTC or the browser's zone) and says which — it does not silently render in local time as if nothing were wrong.
- The timezone picker offers valid replacements and the current invalid value is not offered as a choice.
- Diagnostics reports the invalid timezone as a failing check.

### SET-25 · M4 · minor · P3
**Changing the workspace timezone shifts nothing already stored.**

- Switching from `UTC` to `Asia/Singapore` does not rewrite any task's `due_date` in frontmatter.
- Dates displayed shift only where the app renders a datetime, and the panel states which fields are date-only (unaffected) and which are datetimes.
- Reverting the timezone restores the previous display exactly.

### B3. Personal, pins, diagnostics

### SET-26 · M4 · minor · P1 P7
**Hiding every field from the card layout.**

- The editor allows it but the preview shows what an empty card looks like, so the outcome is visible before saving.
- The board still renders identifiable cards — the task key remains as an un-hideable anchor, or the editor blocks hiding the last field with a stated reason.
- Whichever it does, cards never become unclickable blank rectangles.

### SET-27 · M4 · minor · P1 P7
**All pinned views are deleted from `queries.yaml` while the panel is open.**

- The stale sweep removes them on the next fetch and the sidebar group renders its designed empty state, not a bare heading with nothing under it.
- The pins panel says the pins were removed because their views no longer exist, rather than silently emptying.
- The user's `settings.yaml` is rewritten to drop the dead references, so the sweep does not have to re-run every load.

### SET-28 · M4 · major · P1 P7
**`workflow.yaml` is rewritten by hand while a settings panel is open, with edits gated behind a dialog.**

- The panel does not save a stale copy over the new file; it re-reads before writing or detects the change and says so.
- If an Edit dialog was open (or a drag-reorder in flight) when the file changed underneath, the save is refused with a message naming the file and offering to reload the panel — the dialog does not silently clobber the hand edit on Save.
- After reloading, the panel shows the hand-edited content, not a merged hybrid.

> Broadened from the earlier drag-reorder-only framing to the Edit-dialog save path, which is now the primary value-edit surface.

### SET-29 · M4 · major · P6
**Diagnostics on a large or slow tracker.** 5,000 tasks.

- Checks stream in individually as they complete rather than the whole panel sitting on one spinner.
- A check still running is visibly distinguishable from a check that passed.
- The panel offers a way to stop or leave without wedging; navigating away and back does not leave a permanently spinning check.

### SET-30 · M4 · major · P4 P7
**Migrate is offered for `outdated` only.** The banner also fires for `future` and `unknown`.

- For `future` (`.schema-version` is greater than the app's), there is no Migrate button — the banner says the tracker was written by a newer LocTT and the action is to upgrade LocTT.
- For `missing`, the banner says the tracker is unrecognized and points at `loctt migrate` (SHL-34). It does **not** offer `loctt init` or reinitialize — a `.loctt/` holding tasks but no version file is damaged, not empty.
- For `unknown` (a version present but unreadable, SHL-38), the banner reports the unreadable value rather than guessing a remedy.
- Offering Migrate on those kinds would risk a downgrade write; the button's absence is the assertion.

### SET-31 · M4 · blocker · P4 P7
**The migration-in-progress sentinel is present at load.** `.loctt/.schema-migration-in-progress` exists from a crashed run.

- The app refuses to boot into normal operation and shows a dedicated state, not the schema banner over a working UI.
- The state reports the from/to versions and the backup path recorded in the sentinel.
- It states explicitly that the user must investigate before continuing and gives the CLI recovery path; it does not offer a "Migrate now" button that would run over a half-migrated tracker.
- Removing the sentinel in a terminal and reloading lets the app boot.

### SET-32 · M4 · minor · P2
**An unknown settings section in the URL.** Pasting `/settings/nonexistent`.

- The shell renders with the nav intact and a not-found state inside the content pane naming the requested section.
- It lists or links the valid sections rather than dumping the user at the app root.
- The browser URL is left alone or redirected to a real section — but not left showing a blank pane under a valid-looking URL.

## C. Error cases

### SET-33 · M4 · major · P4 P7
**`workflow.yaml` fails Zod validation.** A status is missing its required `category`.

- Every workflow panel shows a validation error naming the file path, the offending entry, and the missing field — not an empty list and not a stack trace.
- The rest of the app degrades in a stated way: status dropdowns show the raw keys with a drift marker rather than being empty.
- A Reload action re-parses without a server restart; fixing the YAML and reloading clears the error everywhere at once.

### SET-34 · M4 · major · P4
**A drag-reorder write fails.** The `workflow.yaml` write returns a permission error.

- The list snaps back to the previous order rather than showing the new order that was not saved.
- The error names the file, says the reorder was not saved, and gives the next action (check file permissions).
- Re-dragging is possible immediately; the panel is not left in a disabled state.

### SET-35 · M4 · major · P4
**Saving estimation as `custom_enum` without `preset_values`.**

- Save is blocked with the error attached to the preset-values field, not as a generic toast.
- The message states that `custom_enum` requires preset values and that `unit_label` is required for any `custom_*` mode.
- Nothing is written; switching back to a numeric mode clears the error.

### SET-36 · M4 · major · P4
**Saving a calendar with an end-of-list holiday in an unparseable date format.** `2026-13-45` typed into the holiday field.

- The specific row is marked invalid with the expected format shown; the other 12 valid holidays are not discarded.
- Save is blocked until the row is fixed or removed — the panel does not save 12 of 13 and report success.
- The error text names the value that failed, not just "invalid date".

### SET-37 · M4 · blocker · P4 P5
**`POST /api/migrate` fails partway.** The migration errors on the second of three steps.

- The result names the step that failed and the version the tracker is now on (the intermediate version stamped by the last successful step).
- It reports where the backup snapshot lives, by absolute path.
- It states that the sentinel is present and that the app will refuse to boot until it is resolved, and gives the CLI recovery path.
- It does not report a partial success as success, and it does not clear the schema banner.

### SET-38 · M4 · major · P4 P7
**Migrate is attempted while the migration lock is held by the CLI.** `loctt migrate` is running in a terminal.

- The request fails fast rather than blocking the UI for the 5-minute stale timeout.
- The message says a migration is already running in another process and that the user should wait for it to finish, then reload.
- The banner remains; nothing is written by the UI's attempt.
- Once the CLI run completes, reloading shows the schema as current with no further action.

### SET-39 · M4 · major · P4 P7
**A settings write hits the state lock on a Dropbox-hosted tracker.**

- The failure names the lock, states that the write did not complete, and says POSIX advisory locks are documented as unsafe on NFS / SMB / Dropbox / iCloud Drive / OneDrive.
- The recommendation is to move the tracker to a local disk — a warning is offered rather than the write being retried into possible corruption.
- The panel reverts to the last known-good values rather than displaying the unsaved edit as saved.

### SET-40 · M4 · major · P4
**Diagnostics itself fails to run.** The `/api/doctor` route returns 500.

- The panel says the diagnostics run failed, distinguishing it clearly from "all checks passed".
- It reports what it managed to complete, if anything, and marks the rest as not run rather than as passed.
- Retry is offered and re-runs the whole check set from scratch.

### SET-41 · M4 · major · P4
**An avatar-sized settings payload is rejected as too large.** A card-layout config or holiday list that exceeds a request limit.

- The rejection names the limit and what exceeded it, rather than surfacing a raw 413.
- The prior config remains in effect and the panel says so.
- The user is told what to trim, with the current count against the limit.

### SET-42 · M4 · minor · P4 P6
**The settings shell loads while the API is unreachable.**

- The nav still renders so the user can see where they are; each panel's content pane shows an unreachable-server state naming the endpoint.
- No panel renders an empty list that would read as "you have no statuses configured".
- A retry action re-fetches, and recovering the server clears every panel's error without a reload.

### SET-43 · M4 · minor · P4
**A settings panel can read a config value back from the source of truth.** `GET /api/config/:key` for a routed key (e.g. `git.branch`, `git.auto_push`).

- The response reports the value the server would use — the same value core's own reader (`getConfigValue`) returns — so the panel *can* render from disk rather than only from its own optimistic state, and has a source of truth to reconcile against after an external edit. (Whether the panel re-reads on demand is SET-28's subject, not this one.)
- A key with nothing written yet reads back its default rather than erroring: `get` is never an error path for a valid key.
- An unknown key is a 404 whose message **lists the valid keys** (the same list core gives the CLI and MCP — cf. the cross-surface parent CFG-C3), so a typo is diagnosable rather than a bare not-found.
- This is the read counterpart of the existing `POST`/`DELETE /api/config/:key` write routes; it does not add a second source of truth.

### SET-45 · M4 · major · P3 P4 P6
**A filesystem failure writing workflow config is reported as a write/IO failure, not as an invalid config.** Make `.loctt/config/` read-only, then save a *valid* workflow edit.

- The response is a 5xx `io_failed`, not a 400 `config_invalid`: the user's configuration is valid; the machine could not persist it. Naming a permission/disk fault as invalid input is the fault-misattribution P4/P6 (and K78) guard against — errors name the real reason.
- The envelope states the write did not land (`data_state: "not_saved"`) so nothing is presented as saved.
- A genuinely invalid document (a duplicate key, a bad shape) is still `config_invalid`/4xx — this case is only about the IO fault, which previously masqueraded as the validation fault (both came back `config_invalid`/400 though the validation path was correct and only the IO path was mis-mapped).
- Complementary to ERR-11 (the user-facing "not writable" copy) and SET-34 (the drag-reorder client behavior): those assert the message and the UI recovery; SET-45 pins the API contract — the status/code/`data_state` distinction between an IO fault and a validation fault.

### SET-46 · M4 · major · P3 P4
**A status can be created from the panel.** Statuses panel, Create dialog.

- The Create dialog takes key + label + category + default; the key is validated for uniqueness and the "key is permanent" copy is shown.
- On Save the new status is written to `workflow.yaml` and renders in file order.
- Creating a duplicate key is rejected before `PUT` with a message naming the collision (cf. SET-44).

### SET-47 · M4 · major · P3 P4
**A priority / task-type can be created.** Priorities / task-types panels, Create dialog.

- The Create dialog takes key + label the same way a status does (priority additionally gets a computed `value`).
- On Save the new priority/task-type is written to `workflow.yaml` and renders in file order.
- Creating a duplicate key is rejected before `PUT` with a message naming the collision.

### SET-48 · M4 · major · P3 P4
**A relationship type can be created.** Relationship-types panel, Create dialog.

- The Create dialog takes key + label + symmetric/inverse + inverse_label + graph + ranked (`RelationshipDef`).
- On Save the new relationship type is written to `workflow.yaml` and is usable when linking tasks.
- Creating a duplicate key is rejected before `PUT` with a message naming the collision.

### SET-49 · M4 · major · P3 P4
**Custom fields have full CRUD in the UI.** Custom-fields panel — create, edit, delete — not YAML-only.

- Create takes key + label + type + multi + searchable + enum values with weights.
- `type` and `multi` lock after create, in the Edit dialog (the SET-16 shape).
- Delete goes through remap-or-clear (the SET-19 shape) when tasks still hold the field's values.

### SET-51 · M4 · major · P4
**A failed Edit-dialog Save stays open with an anchored error.** The Edit-dialog Save (the primary value-edit surface) hits a write error.

- The dialog **stays open with the value un-committed** — the field is not written and the panel is not left showing a value that did not persist.
- The error is shown **anchored in the dialog** (the `-edit-error` `Callout`), not as a bare toast, and names the next action.
- **Cancel still closes cleanly**, discarding the un-committed edit.

> Additive, not a reversal. SET-34's drag-reorder-failure behaviour is unchanged (reorder stays inline per open decision #3); this ID covers the Edit-dialog Save-failure path SET-34 never described.
