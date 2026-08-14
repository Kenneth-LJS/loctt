# Flow: accessibility and keyboard

Cross-cutting keyboard reachability, focus management, and screen-reader
semantics. The shortcut set and the a11y sweep land in M4.8, but these
cases are assertable against every milestone's surface as it ships — a
modal built in M2 with no focus trap is a defect in M2, not a chore
deferred to M4. Shell-specific behaviour (routing, theme, sidebar state)
is [flow-app-shell.md](flow-app-shell.md); the error-message quality bar
these cases assume is [flow-error-handling.md](flow-error-handling.md).
Per-view semantics are asserted in the view's own flow; this doc holds
the rules that apply everywhere.

Verification assumes a real screen reader (VoiceOver on macOS, NVDA on
Windows) and keyboard-only operation with the pointer physically
unavailable — not an automated audit tool. Automated checks catch a
minority of these.

## A. Core reachability and semantics that must hold

### A.1 Shortcuts

### A11Y-1 · M4 · major · P8
**`c` and `n` both open the create-task modal.** From `/list` with no field focused, press `c`; close it; press `n`.

- Both keys open the same create-task modal.
- The modal opens with focus in the title field, so typing begins immediately.
- Neither key fires while a text input, textarea, or rich-text editor has focus — typing the letter `c` into a task title must insert `c`.

### A11Y-2 · M4 · major · P8
**`/` focuses the search box.** From any view, press `/`.

- Focus moves to the filter/search input and the input is scrolled into view.
- The `/` character is **not** inserted into the field.
- Pressing `/` while already inside a text field inserts a literal `/`.

### A11Y-3 · M4 · major · P8 P2
**`g` then `l` / `b` / `t` navigates to List, Board, Timeline.** Press `g`, then each of the three keys in turn.

- Each chord changes the URL to the corresponding route.
- The chord times out after a short window — pressing `g`, waiting several seconds, then `l` does not navigate.
- A chord in progress does not swallow unrelated keystrokes indefinitely; `g` followed by an unmapped key is a no-op, not a stuck state.

### A11Y-4 · M4 · major · P8
**`?` opens the keyboard shortcut reference.** Press `?` from any view.

- A dialog lists every registered shortcut with its key and description, including the chords.
- The list matches the shortcuts actually bound — a shortcut that exists but isn't listed, or listed but not bound, is a defect.
- The dialog is itself keyboard-operable and closes on `Esc`.

### A11Y-5 · M4 · blocker · P8
**`Esc` closes the topmost dismissible layer, one at a time.** Open the create modal, then open a dropdown inside it, then press `Esc` twice.

- The first `Esc` closes the dropdown and leaves the modal open, with focus back on the dropdown trigger.
- The second `Esc` closes the modal and returns focus to whatever opened it.
- `Esc` does not close a modal containing unsaved edits without a confirmation (see A11Y-33).

### A11Y-6 · M4 · minor · P8
**`[` collapses and expands the sidebar.** Press `[` from any view.

- The sidebar toggles, matching the click behaviour and persisting the same way (SHL-12).
- Focus does not jump into the sidebar when it expands, nor get destroyed when it collapses — if focus was inside the collapsing sidebar, it moves to a sensible visible ancestor, never to `document.body`.

### A11Y-7 · M4 · minor · P8
**`t` cycles the theme.** Press `t` from any view.

- The theme advances through light → dark → system (or the documented order) and the change is announced (A11Y-24).
- `t` does not fire while a text field has focus.

### A11Y-8 · M4 · major · P8
**Shortcuts are suppressed while a modal or menu owns the keyboard.** With the create modal open, press `g` then `b`.

- No navigation occurs; the modal stays open.
- Global shortcuts resume once the modal closes.
- `Esc` remains available at all times as the escape hatch.

### A.2 Keyboard reachability of the primary flows

### A11Y-9 · M4 · blocker · P8
**The full list → open → edit → save → close cycle works with no mouse.** Physically remove or disable the pointer. From `/list`, reach a task, open it, change its status, save, and return to the list.

- Every step is reachable by `Tab`, arrow keys, `Enter`, and `Esc` alone.
- Table rows are reachable and activatable — a row that only responds to a click is a blocker.
- The status dropdown opens on `Enter` or `Space`, options are traversable with arrow keys, and `Enter` commits.
- The save outcome is announced (A11Y-24), so a non-sighted user knows the edit landed.
- Returning to the list restores focus at or near the row that was opened, not at the top of the document.

### A11Y-10 · M4 · blocker · P8
**Filtering is fully keyboard-operable.** From `/list`, add a status filter and a label filter, then remove one, using only the keyboard.

- Each filter dropdown is reachable, opens on `Enter`/`Space`, and its options are arrow-navigable with type-ahead.
- Applied filter chips are focusable and their remove control is activatable by keyboard, with an accessible name that names the filter being removed ("Remove filter: Status is In progress").
- The result count change is announced (A11Y-25).

### A11Y-11 · M4 · blocker · P8
**Creating a task is fully keyboard-operable end to end.** Press `c`, fill every field, submit, all without a pointer.

- Every field including the label multi-select, the date pickers, and the body editor is reachable and editable by keyboard.
- The date picker allows typed date entry — a calendar grid that can only be clicked is a blocker.
- The body editor is escapable: `Tab` inside it either moves to the next control or a documented key (`Esc` then `Tab`) does, so the user is never trapped in the editor.
- Submit is reachable and the created task's key is announced.

### A11Y-12 · M4 · major · P8
**The sidebar is fully keyboard-navigable.** `Tab` into the sidebar and traverse it.

- Every group header and entry is reachable in a predictable order.
- Collapsible groups expose their expanded/collapsed state to assistive tech and toggle on `Enter`/`Space`.
- The non-interactive "Mentions me" entry (SHL-8) is either skipped by the tab order or focusable-but-announced-as-unavailable — it never presents as an actionable control that does nothing.

### A11Y-13 · M4 · major · P8
**The header avatar menu is keyboard-operable per menu conventions.** `Tab` to the avatar and press `Enter`.

- The menu opens with focus on the first item; arrow keys move between items; `Home`/`End` jump to the ends.
- `Esc` closes it and returns focus to the avatar trigger.
- `Tab` from within the menu either closes it and moves on or cycles inside it — it does not leave an open menu orphaned behind the focus ring.

### A.3 Focus management

### A11Y-14 · M4 · blocker · P8
**Modals trap focus.** Open the create-task modal and press `Tab` repeatedly past the last control.

- Focus wraps to the first control inside the modal; it never reaches the header, sidebar, or the browser's own chrome content behind the overlay.
- `Shift+Tab` from the first control wraps to the last.
- Content behind the modal is inert to assistive tech, not merely visually dimmed — a screen reader's virtual cursor cannot browse the list underneath.

### A11Y-15 · M4 · blocker · P8
**Focus returns to the trigger when a dialog closes.** Open the delete-confirmation dialog from a task's ⋯ menu, then cancel it.

- Focus lands on the control that opened the dialog (or its nearest surviving equivalent when the trigger is gone, e.g. after a successful delete focus moves to the list, announced).
- This holds for closing via the close button, via `Esc`, and via the cancel action.
- Focus never lands on `document.body` — verify by checking that pressing `Tab` immediately after close moves to the *next* control after the trigger, not to the first control on the page.

### A11Y-16 · M4 · blocker · P8
**A visible focus indicator is present on every focusable element, in both themes.** Tab through every control on `/list`, `/board`, a task detail, and the settings shell, in light and dark.

- Every stop shows an unambiguous focus indicator.
- The indicator is visible against the element's own background in both themes, including on coloured elements (status chips, label pills, primary buttons).
- The indicator is not removed on click-then-keyboard interaction; a control focused by keyboard after being clicked still shows it.
- No control relies solely on the browser default outline being suppressed with no replacement.

### A11Y-17 · M4 · major · P8
**Focus survives async content replacement.** Focus a table row, then trigger a refetch that re-renders the table (change a filter, or let a background poll land).

- Focus stays on the equivalent row, or moves to a deliberate, announced location.
- Focus is not silently dropped to `document.body`, which would send the next `Tab` back to the top of the page.
- The same holds when the board reflows after a drag and when the sidebar counts resolve.

### A11Y-18 · M4 · major · P8
**Focus moves into newly revealed content.** Open the task detail panel and open an inline editor on a field.

- Focus moves into the newly rendered input rather than staying behind it.
- Closing the inline editor returns focus to the field's trigger row.
- Opening a disclosure (Relationships, Activity) does not move focus unexpectedly, but the revealed content is immediately reachable by the next `Tab`.

### A.4 Semantics

### A11Y-19 · M4 · major · P8
**Tab order follows visual order.** On `/list` and on a task detail, tab from the top and compare against the visual reading order.

- The order is header → sidebar → main pane (or the documented order), matching what a sighted user reads.
- Within the filter bar, tab order runs left to right as rendered, not in DOM-insertion order that differs from the CSS layout.
- No positive `tabindex` values are used to force an order that fights the DOM.

### A11Y-20 · M4 · blocker · P8
**Icon-only buttons expose accessible names.** Inspect every icon-only control with a screen reader: sidebar collapse, header `+`, theme toggle, task ⋯ menu, archive, attachment remove, filter chip remove, body-editor mode toggle.

- Each announces a specific action, not "button" and not the icon's file name. The archive control announces "Archive task", not "button" or "archive-icon".
- The accessible name matches the tooltip text where a tooltip exists, so keyboard and pointer users learn the same word.
- A control whose meaning depends on context includes that context ("Remove attachment: design.png").

### A11Y-21 · M4 · blocker · P8
**Toggle controls expose their state, not just their label.** Inspect the sidebar collapse, the "Show archived" toggle, the skip-starter-docs toggle, and the board status chips.

- Each announces pressed/expanded/checked state and updates the announcement when toggled.
- "Show archived" announces its current state, so a user cannot be unknowingly filtered.
- A toggle rendered as a button announces its pressed state; a toggle rendered as a checkbox announces checked.

### A11Y-22 · M4 · blocker · P8
**Every form field has a programmatically associated label.** Inspect the init wizard, the create-task modal, the task meta panel's inline editors, and every settings form.

- Each input is associated with a visible label; placeholder text is never the only label.
- Grouped controls (radio sets, a date range's start/end) are wrapped in a group with an accessible group name.
- Required fields are marked programmatically, not only with a visual asterisk.

### A11Y-23 · M4 · blocker · P4 P8
**Field errors are programmatically associated with their field.** Submit the init wizard with an invalid prefix (ONB-19) and any settings form with a bad value.

- The error text is associated with the input, so a screen reader reads the error when focus enters the field.
- The input is marked invalid programmatically, not styled red only.
- On a blocked submit, focus moves to the first invalid field and the error is announced.
- The error text itself meets the P4 bar — it names the rule, not "invalid".

### A11Y-24 · M4 · blocker · P4 P8
**Async outcomes are announced in a live region.** Save a field edit successfully, then force a save to fail.

- The success is announced ("Status saved") without moving focus.
- The failure is announced with the same message the toast shows, and the announcement is assertive enough to interrupt — a silent failure is the worst case in P4 terms.
- Announcements are not duplicated (once per event, not once per re-render) and are not queued up into a backlog that reads out stale results.
- A non-sighted user can tell a failed save from a successful one without inspecting the field.

### A11Y-25 · M4 · major · P8 P9
**Filter result counts are announced when they change.** Apply a filter that narrows a 300-task list to 4.

- The new count is announced ("4 tasks") in a polite live region after the results settle.
- The announcement fires once for the settled result, not once per intermediate loading state.
- Filtering to zero announces the empty result explicitly, so it is distinguishable from an unresponsive UI.

### A11Y-26 · M4 · blocker · P8 P9
**The task table uses real header semantics.** Inspect `/list` with a screen reader's table navigation.

- Column headers are marked as headers and are associated with their cells, so navigating cell-to-cell announces the column name.
- The key column (or title column) is marked as the row header, so navigating rows announces which task the row is.
- The table has an accessible name describing what it lists.
- Row count and column count are exposed correctly, including under pagination — a paginated table does not claim to be the whole set.

### A11Y-27 · M4 · blocker · P8
**Sort state is exposed and announced.** Click a sortable column header, then click again to reverse.

- The sorted column exposes its sort direction programmatically; unsorted columns expose that they are sortable.
- Activating a header announces the new sort ("Sorted by Due date, ascending").
- Sort direction is not conveyed by an arrow glyph alone with no accessible equivalent.

### A11Y-28 · M4 · blocker · P8
**Board drag-and-drop has a keyboard alternative.** With no pointer, move a card from one column to another and reorder it within a column.

- A card is focusable, and a documented key enters a move mode (or a menu offers "Move to column…" / "Move up" / "Move down").
- The available targets are announced as the user moves through them.
- Committing announces the result ("Moved WEB-12 to In progress, position 2"), and cancelling restores the original position.
- The resulting write is the same one the drag produces — an atomic status + `board_rank` update, not a status-only change.

### A11Y-29 · M4 · blocker · P8
**Relationship reorder and timeline resize have keyboard alternatives.** On a task with several ranked relationships, and on a timeline bar.

- Ranked relationship rows can be reordered by keyboard, with the new position announced.
- A timeline bar's start and due dates are adjustable by keyboard — either via a move/resize mode with arrow keys, or by editing the dates directly from a keyboard-reachable control on the bar.
- Neither feature is pointer-only. A drag-only affordance with no alternative is a blocker, not a polish item.

### A11Y-30 · M4 · blocker · P3 P8
**Colour is never the sole carrier of meaning.** Inspect status chips, priority indicators, WIP-over-cap columns, archived rows, and the sidebar's active-route highlight in greyscale.

- Status and priority carry a text label or a distinct shape/icon in addition to colour; a greyscale screenshot remains readable.
- A WIP-over-cap column is identifiable without colour (a count like "6 / 4" and a warning glyph with an accessible name), not by a red header alone.
- Archived tasks are marked with an "Archived" badge, not only by being dimmed.
- The active sidebar route is marked by more than a colour change — a persistent indicator bar, bolder weight, or the current-page state exposed to assistive tech.
- Label pills, whose colour is user-chosen and arbitrary, always render their text name.

### A11Y-31 · M4 · major · P4 P8
**Unavailable controls are announced as unavailable, with a reason.** Inspect the M1 "Mentions me" filter and any control disabled by state (archive on an already-archived task, migrate on a `future` schema).

- Each exposes a disabled state to assistive tech rather than being merely greyed and unresponsive.
- A reason is available to keyboard users — via accessible description or an adjacent explanation — not only in a pointer-hover tooltip.
- A control that is inert but announces as actionable is a defect.

### A11Y-32 · M4 · blocker · P4 P6
**The schema banner is announced as a page-level status, not skipped.** Load a tracker in each of the `outdated`, `future`, `missing`, and `unknown` states (SHL-34 to SHL-38).

- The banner is exposed as a page-level alert/status region so a screen reader encounters it early, before the main content.
- Its full text — including version numbers and the command to run — is readable by the screen reader; the command is real text, not an image.
- A banner that appears after load (on a background refetch) is announced without stealing focus.
- The four kinds read as four different messages; a user relying on audio can tell "upgrade LocTT" from "run `loctt migrate`".

## B. Edge cases

### A11Y-33 · M4 · major · P5 P8
**`Esc` on a dirty modal confirms before discarding.** Type into the create-task modal, then press `Esc`.

- A confirmation appears rather than discarding the typed content silently.
- The confirmation itself traps focus, defaults focus to the non-destructive choice, and is `Esc`-dismissible back to the modal.
- Choosing to keep editing returns focus to the field the user was in.

### A11Y-34 · M4 · major · P8
**Nested layers unwind in the right order.** Open a task detail, open the ⋯ menu, open the delete confirmation from it, then close everything with `Esc`.

- Each `Esc` closes exactly one layer, innermost first.
- Focus returns correctly at each step: confirmation → ⋯ menu trigger → detail.
- No layer is left rendered but unreachable behind a closed parent.

### A11Y-35 · M4 · major · P8
**A toast appearing does not steal focus.** Trigger a save that produces a success toast while typing in another field.

- Focus stays in the field; the typed characters are not lost.
- The toast is announced via a live region (A11Y-24).
- A toast with an action (e.g. "Open" after create, "Undo" after archive) is reachable by keyboard without hunting — a documented key or a tab stop that appears in the natural order — and its timeout does not expire before a keyboard user can reach it.

### A11Y-36 · M4 · major · P8 P5
**Undo is reachable by keyboard before the toast disappears.** Archive a task, then reach Undo without a pointer.

- The undo affordance is keyboard-reachable within its lifetime, or its timeout is paused while the toast has focus.
- If the toast expires, the same undo is still available somewhere non-transient (the task's own state, the activity log), so a keyboard user is not worse off than a mouse user for a reversible action.

### A11Y-37 · M4 · major · P8
**`prefers-reduced-motion` suppresses the board's animated reflow.** Enable reduced motion, then move a card between columns (by drag and by keyboard).

- The card appears in its new position without an animated transit; the column reflow is instant.
- The same holds for sidebar collapse, modal entry/exit, toast entry, and timeline scroll.
- Suppressing motion does not suppress the *outcome* — the state change and its announcement still happen.
- No animation loops indefinitely under reduced motion (loading skeletons use a static or minimal-motion treatment).

### A11Y-38 · M4 · major · P9
**Browser zoom to 200% keeps every primary flow usable.** Set browser zoom to 200% at a 1280px-wide window and run the list → open → edit → save cycle.

- No content is clipped or overlapped; the page body does not scroll horizontally (the wide table may scroll within its own container).
- The header, sidebar toggle, and create button remain reachable.
- Modals fit within the viewport or scroll internally while keeping their action buttons reachable.
- Nothing becomes a two-pixel-tall sliver or overlaps the focus ring.

### A11Y-39 · M4 · minor · P9
**Text-only zoom to 200% does not break layout.** Increase text size only (without page zoom) to 200%.

- Text reflows and containers grow; text is not clipped to a fixed-height box.
- Sidebar entries, buttons, and table cells accommodate larger text or truncate gracefully with the full value still available.
- No text becomes invisible because its container has a fixed height with `overflow: hidden`.

### A11Y-40 · M4 · major · P8
**Contrast holds in both light and dark themes.** Sample text and UI-component contrast across both themes on the header, sidebar (active and inactive entries), table rows (including zebra striping and hover), status chips, label pills, disabled controls, placeholder text, and the schema banner.

- Body text meets 4.5:1 and large text 3:1 against its actual background in both themes.
- Non-text indicators that carry meaning — focus rings, chip borders, the WIP-over-cap marker, checkbox and toggle boundaries — meet 3:1.
- Disabled controls, while permitted lower contrast, are still distinguishable from enabled ones by more than opacity (A11Y-31).
- A user-chosen label colour that would be unreadable against the pill background is handled (the text colour flips) rather than rendering unreadable text.

### A11Y-41 · M4 · minor · P9
**A very long task title does not break table row semantics.** Render a task with a 300-character title.

- The row header cell still announces the task identifiably; the title truncates visually but the full title is available (accessible name, or expandable).
- Row height does not grow to fill the viewport, and the remaining cells stay in their columns.

### A11Y-42 · M4 · minor · P9
**A task with 20 labels stays keyboard-navigable.** Open a task with twenty labels in the list and in the detail panel.

- Labels wrap or collapse behind a "+14 more" affordance that is itself focusable and announced with the count.
- Tabbing through the row does not require twenty stops to reach the next row's controls; the label group is a single stop or is skippable.

### A11Y-43 · M4 · minor · P8
**Keyboard shortcuts do not collide with browser or screen-reader shortcuts.** With a screen reader running in browse mode, exercise the shortcut set.

- App shortcuts do not shadow the screen reader's own single-key browse commands in a way that makes the page unnavigable, or the app documents the required mode switch.
- No shortcut overrides a browser-reserved combination.
- Single-key shortcuts can be turned off or remapped, or are documented in the `?` reference as suppressible.

### A11Y-44 · M4 · minor · P8
**A skip link reaches the main content.** Press `Tab` as the very first interaction after load.

- The first stop is a skip-to-main-content link, visible when focused.
- Activating it moves focus into the main pane, past the header and sidebar.
- Without it, verify the header + sidebar are few enough stops that reaching the table doesn't take dozens of `Tab` presses on a tracker with 30 projects (SHL-21).

### A11Y-45 · M4 · minor · P2 P8
**Route changes are announced.** Navigate from `/list` to `/board` by keyboard.

- The new view is announced (page title change, or a live-region announcement naming the view).
- Focus moves to the start of the new main content or to a documented landing point — not left on the sidebar link, and not dropped to `document.body`.
- The document title reflects the current view, so a user with many tabs can tell them apart.

## C. Error and failure communication accessibility

### A11Y-46 · M4 · blocker · P4 P8
**A failed save is announced, not just coloured.** Force a field edit to fail on the server.

- The failure is announced assertively, naming the field and the reason.
- The field is marked invalid programmatically and the error is associated with it (A11Y-23).
- The optimistic value's rollback is perceivable to a non-sighted user — they are told the value reverted, not left believing the edit stuck.
- Nothing about the failure is communicated only by a red border.

### A11Y-47 · M4 · blocker · P4 P8
**An empty result and a failed load are audibly different.** Filter to zero results, then force `/api/tasks` to fail.

- The empty state announces that the filter matched no tasks and suggests clearing filters.
- The error state announces that loading failed, with the reason and a retry action.
- A screen-reader user can tell the two apart from the announcement alone — this mirrors the visual requirement in ONB-33 and is equally load-bearing.

### A11Y-48 · M4 · blocker · P4 P6 P8
**The uninitialized-tracker screen is announced correctly.** Load the app with no `.loctt/` using a screen reader.

- The heading announces that no tracker exists in this directory.
- The workspace path is read out as text so the user can confirm the directory.
- Nothing announces a task count or an empty list — the audio experience must not imply data loss any more than the visual one.

### A11Y-49 · M4 · blocker · P4 P8
**The crashed-migration screen is fully readable by screen reader.** Load with the `.schema-migration-in-progress` sentinel present (SHL-37).

- The blocking screen is announced immediately as an alert.
- The from/to versions and the **backup path** are readable text, selectable and copyable — a path rendered as an image or truncated with no accessible full value is a blocker, because it is the user's route to their data.
- The recovery steps are structured (a list, not a wall of prose) so they can be navigated heading-by-heading or item-by-item.

### A11Y-50 · M4 · major · P4 P8
**A destructive confirmation defaults focus to the safe choice and states the blast radius.** Open the bulk-delete confirmation for 40 selected tasks.

- Initial focus is on Cancel (or the typed-confirmation input), never on the destructive button — a stray `Enter` cannot delete 40 tasks.
- The dialog's accessible name and description state the count and the irreversibility.
- The typed-confirmation requirement is announced, including exactly what string must be typed.
- The result — how many deleted, how many failed — is announced afterward (A11Y-51).

### A11Y-51 · M4 · major · P4 P9 P8
**Partial bulk-operation results are announced accurately.** Run a bulk archive of 40 tasks where 3 fail.

- The announcement states the real numbers ("37 archived, 3 failed"), never a bare "Done".
- The failed items are reachable by keyboard from the result, so the user can act on them.
- The announcement is not truncated to the first sentence by a live region that cuts off long text.

### A11Y-52 · M4 · major · P4 P8
**The server-unreachable state is announced and persistent.** Stop the server mid-session (SHL-41).

- The state is announced when it appears and remains discoverable afterwards — a user who was away when it fired can find it by navigating the page, because it is a persistent region, not a transient toast.
- Its recovery instruction is readable text.
- When connectivity returns, the recovery is announced too, so the user knows they can resume.

### A11Y-53 · M4 · major · P4 P8
**A query-syntax error is conveyed without relying on the highlight.** Type an invalid query with an unknown field into the search box.

- The error message names the offending token and what was expected, as text associated with the input.
- The visual token highlight has a non-colour equivalent in the message, so a user who cannot see the highlight still knows which token is wrong.
- The error is announced on settle, not on every keystroke.

### A11Y-54 · M4 · minor · P4 P8
**The error boundary's fallback is keyboard-operable.** Force a main-pane component to throw (SHL-42).

- The fallback's heading is announced and its recovery actions (reload, back to list) are focusable and activatable by keyboard.
- Focus is moved into the fallback rather than being lost with the unmounted subtree.
- A raw stack trace, if shown at all, is behind a collapsed disclosure that is not the first thing announced.
