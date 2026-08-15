# Milestones and labels

Two config-backed entities that share a shape: a ULID `id` users never
see, a mutable non-unique `name`, an `archived` flag, and reference
counts that gate deletion. Covers the Milestones view and its progress
bars, milestone drill-in, label pills and click-to-filter, and the
Settings → Labels / Milestones management panels. The generic settings
shell is [flow-settings.md](flow-settings.md); assigning a label or
milestone from a task is [flow-tasks.md](flow-tasks.md); the filter
mechanics a label click drives are [flow-list.md](flow-list.md).

The load-bearing nuance throughout: **progress is computed from status
`category`, never from a status key**. Categories are `pending`,
`active`, `completed`, `discarded`; a tracker may have several
`completed`-category statuses, may rename `done` to anything, and may
delete the key `done` entirely. Any test that hardcodes `status = done`
is testing the wrong thing.

## A. Happy path

### MSL-1 · M4 · blocker · P3 P9
**The Milestones view lists every non-archived milestone with its target date and progress bar.**
- One row/card per non-archived milestone in `milestones.yaml`, none omitted or duplicated.
- Each shows the milestone `name` as configured — never the ULID `id`.
- Each shows `target_date` formatted per the workspace locale/calendar, or an explicit "No target date" when absent.
- Each shows a progress bar plus a numeric `done / total` readout; the bar's fill proportion matches the numbers shown.
- Ordering is stable across reloads (by target date, with undated entries in a defined position).

### MSL-2 · M4 · blocker · P3 P10
**Progress counts by status category, not by a `done` key.** Workflow has two `completed`-category statuses (`done`, `shipped`) and a renamed label.
- A task in `shipped` counts toward the numerator exactly as one in `done` does.
- Renaming the `done` status's **label** changes nothing about the count.
- Renaming the `done` status's **key** (with tasks migrated) changes nothing about the count.
- The same milestone queried via `loctt list` with a `status.category = completed` predicate returns the same numerator.

### MSL-3 · M4 · blocker · P3 P4
**Discarded-category tasks are handled by an explicit, stated rule.** Milestone with 10 tasks: 4 completed, 2 discarded, 4 active.
- The readout is not ambiguous: whichever rule applies, the UI states it where the number is shown (tooltip, caption, or legend).
- If discarded tasks are excluded from the denominator, the display reads `4 / 8` and explains that 2 discarded tasks are excluded.
- If they are included, it reads `4 / 10` and explains that discarded tasks count as not-done.
- The chosen rule is applied identically on the Milestones view, the milestone detail, and any sidebar count — the same milestone never shows two different denominators on two surfaces.

> **Rule decided (2026-08-14): discarded tasks are excluded from the
> denominator.** The worked example above therefore reads `4 / 8`, with
> the 2 discarded tasks named where the number is shown. A milestone
> whose remaining work is all discarded reads `4 / 4` — done — rather
> than stalling below 100% forever.
>
> Not yet implemented; milestone progress is M4.3 work. Two things it
> needs when built: the exclusion should live in a shared core helper
> rather than each surface filtering for itself (this test case fails on
> cross-surface inconsistency), and the UI must state the rule — silently
> shrinking the denominator fails the first bullet just as ambiguity does.

### MSL-4 · M4 · major · P2
**Clicking a milestone opens its task list.**
- Navigation lands on a task list scoped to that milestone; the row count equals the milestone's `total` from the progress readout (under the same discarded rule).
- The URL encodes the milestone scope and reproduces the list when pasted into a new tab.
- Back returns to the Milestones view with scroll position and any expansion state intact.

### MSL-5 · M1 · blocker · P3 P9
**Labels render as coloured pills on both cards and rows.**
- The pill shows the label `name`; the pill's background is the configured `color`.
- The same label renders with the same colour on the list row, the board card, and the task detail — one colour source, no per-surface palette.
- Text on the pill remains legible against its own background (contrast is computed from the colour, not fixed to black or white).

### MSL-6 · M1 · blocker · P2 P10
**Clicking a label pill filters the current view to that label.**
- The active view gains a label filter for the clicked label and the row set narrows accordingly.
- The filter appears as a removable chip in the filter bar — the user can see *why* rows matched and remove it.
- The URL updates to include the label filter; back removes it and restores the prior result set.
- The filter serializes to the same label predicate the CLI accepts, so the equivalent `loctt list` query returns the same tasks.
- The CLI returns **the same tasks**, compared by key — not merely that it accepts the predicate without error.

### MSL-7 · M1 · major · P2
**Clicking a second label adds to the filter rather than replacing it.**
- After clicking label A then label B, both chips are present and the result set reflects both predicates.
- The combining semantics (AND vs OR) are visible in the chip UI, not left to guesswork.
- Removing one chip leaves the other applied.

### MSL-8 · M4 · blocker · P1 P10
**Creating a label in Settings → Labels writes to `labels.yaml`.**
- The new label gets a generated ULID `id`; the user is never asked to supply one.
- The entry appears in `.loctt/config/labels.yaml` with `name` and `color`.
- **`labels.yaml` still parses as a whole** after the write. One malformed entry can make the loader reject the entire file, silently taking every other label with it.
- The label is immediately offered in task label pickers and in the list filter bar.
- `loctt label list` shows it without a restart.

### MSL-9 · M4 · major · P1 P3
**Recolouring a label updates every surface that renders it.**
- Changing the colour in settings and returning to the list shows pills in the new colour.
- The label's `id` and every task reference are unchanged — no task loses its label.
- The written `color` is a valid hex string matching what the picker displayed.

### MSL-10 · M4 · major · P7 P5
**Archiving a label preserves existing references but blocks new ones.**
- Tasks already carrying the archived label still display it, marked "(archived)" or equivalently de-emphasised.
- The label no longer appears in the label picker when adding a label to a task.
- The label no longer appears in the default filter-bar label list.
- Unarchiving restores it to pickers, with all references intact.

### MSL-11 · M4 · blocker · P5 P9
**Label and milestone management shows an accurate reference count.**
- Each entry shows the number of tasks referencing it; the count matches the number of rows returned when filtering the list by that entry.
- The count includes archived tasks or excludes them per a stated rule, consistently with the progress rule in MSL-3.
- An entry with zero references shows `0`, not a blank.

### MSL-12 · M4 · blocker · P5 P1
**Deleting a referenced label requires a remap choice and applies it.**
- Deleting a label with 12 references prompts for remap-to-another-label or clear-the-reference; it cannot be confirmed without choosing.
- The confirmation names the label and states the exact number of tasks that will be modified.
- On confirm, all 12 tasks are updated on disk and the entry is removed from `labels.yaml`.
- The same delete via CLI produces the same end state — the UI invents no extra remap mode.

### MSL-13 · M4 · major · P5
**Deleting an unreferenced milestone is a lighter-weight confirmation than deleting a referenced one.**
- A zero-reference milestone confirms with a simple confirm — no remap picker is shown, since there is nothing to remap.
- A referenced milestone demands the remap choice per MSL-12.
- In neither dialog is the destructive button the default-focused control.

### MSL-14 · M4 · major · P1 P3
**Editing a milestone's target date persists and re-sorts the view.**
- Setting a `target_date` on a previously undated milestone writes an ISO `YYYY-MM-DD` to `milestones.yaml`.
- The Milestones view re-sorts to reflect the new date on refresh.
- Clearing the date returns the milestone to the undated presentation from MSL-16, not to a `1970-01-01` sentinel.

## B. Edge cases

### MSL-15 · M4 · blocker · P6
**A milestone with zero tasks shows a sane progress readout.** Denominator is zero.
- The readout never shows `NaN`, `NaN%`, `0/0`, `Infinity`, or a blank where the numbers should be.
- It shows an explicit "No tasks" state (or `0 tasks`), and the bar renders empty rather than full.
- Percent, if shown at all, is suppressed rather than computed from a zero denominator.

### MSL-16 · M4 · major · P6
**A milestone with no `target_date` renders without implying a date.**
- The date slot reads "No target date" rather than being blank, showing `—` ambiguously, or showing today's date.
- The milestone still shows a working progress bar.
- It sorts into a defined position (e.g. after all dated milestones) rather than randomly among them.

### MSL-17 · M4 · major · P6 P3
**A milestone whose target date has passed with tasks incomplete is flagged.**
- The row carries an overdue indication that does not rely on colour alone.
- The indication is driven by incomplete tasks existing (category not `completed`/`discarded`), not by the date alone — a fully-completed past milestone is not flagged as overdue.
- The progress numbers are unchanged by the overdue state; the flag is additive information.

### MSL-18 · M4 · minor · P6
**A milestone at 100% shows a full bar and a completion state.**
- The bar reads full and the readout shows `n / n`.
- A past target date on a 100% milestone is presented as completed, not overdue (see MSL-17).

### MSL-19 · M1 · major · P9
**A tracker with 40 labels keeps the label picker and filter usable.**
- The filter-bar label control is searchable/typeahead rather than a 40-item unfiltered dropdown.
- The settings list paginates or scrolls within a bounded region; the page itself does not grow unbounded.
- Selecting a label from a 40-item list applies in one interaction.

### MSL-20 · M1 · major · P9
**A task carrying 20 labels does not break row or card layout.**
- Pills wrap or overflow into a "+N" affordance; the due date and other trailing columns stay on screen.
- The "+N" affordance reveals the remaining labels on click/hover and each remains individually clickable to filter.
- Row height stays bounded — one task does not consume the viewport.

### MSL-21 · M1 · major · P3 P9
**Two labels with the same `name` but different ids stay distinguishable.** `name` is explicitly not unique.
- Both pills render; clicking one filters to that label's `id` only, not to both.
- The result set contains only tasks carrying the clicked label.
- In the settings list and in pickers, the duplicate pair is disambiguated (by colour swatch, truncated id, or reference count) rather than shown as two identical rows.

### MSL-22 · M1 · major · P7 P6
**A label with a missing or invalid hex colour still renders.** Hand-edit `labels.yaml` to omit `color`, and separately to set `color: "notahex"`.
- A missing `color` renders with a defined neutral default pill; the label remains clickable and filterable.
- An invalid `color` does not produce an unstyled pill, an unreadable pill, or a thrown render error.
- The invalid value is surfaced in Settings → Labels as a fixable config problem naming the label and the bad value — schema validation rejects non-hex, so this is config drift and must be visible (P7).

### MSL-23 · M1 · major · P6
**A label colour with poor contrast stays legible in both light and dark themes.** e.g. a very dark navy and a very pale yellow.
- Pill text contrast is computed against the pill's own background, so a dark label uses light text and a pale one uses dark text.
- Both labels remain legible after toggling the theme — the pill does not become invisible in one theme.
- The pill has a visible boundary against the surface behind it, so a near-background-coloured label is still perceivable as a pill.

### MSL-24 · M4 · major · P7
**A task referencing a milestone id absent from `milestones.yaml` degrades visibly.** Hand-delete an entry while tasks still point at it.
- The task detail shows the reference as unresolved, naming the dangling id, rather than rendering blank.
- The Milestones view does not crash; the dangling reference does not appear as a phantom milestone row.
- If such tasks are excluded from every milestone's counts, that exclusion is visible somewhere — silently vanishing tasks are the failure mode.

### MSL-25 · M4 · major · P7
**An archived milestone still resolves on tasks and by URL.**
- Its detail route remains reachable and its task list still renders.
- It is excluded from the default Milestones view and from pickers.
- A "show archived" affordance reveals it in the view without unarchiving it.

### MSL-26 · M1 · minor · P9 P3
**A very long label name does not break the pill.**
- A 100-character name truncates within the pill with the full text available on hover/focus.
- The truncated pill remains clickable and filters correctly on the full label.

### MSL-27 · M4 · major · P1
**A label created in the CLI appears in the UI without a restart.**
- Running `loctt label create` while the UI is open surfaces the label on the next refresh of the labels data.
- The UI does not need a full page reload to offer it in the picker, and does not show a cached stale list indefinitely.

### MSL-28 · M4 · major · P1
**Concurrent label edits do not clobber each other.** Rename label A in the CLI while renaming label B in the UI.
- Saving B's rename does not revert A's rename in `labels.yaml`.
- Both renames are present after the write.

### MSL-29 · M4 · minor · P3
**Progress reflects the current workflow after a status is recategorised.** Change a status from `active` to `completed` category in `workflow.yaml`.
- On refresh, milestones containing tasks in that status show an increased numerator.
- No cached progress figure survives the config change.

### MSL-30 · M1 · minor · P2
**Clicking a label while a milestone filter is already active preserves both.**
- The label chip is added alongside the existing milestone chip; neither is dropped.
- The result set satisfies both predicates and the URL carries both.

## C. Error cases

### MSL-31 · M4 · blocker · P4 P7
**A malformed `labels.yaml` explains itself rather than dropping all labels.** Introduce a duplicate `id`.
- An error names the file and the specific violation (`duplicate label id: <id>`).
- The UI does not render as though the tracker simply has no labels — an empty label list and a failed label load are visually distinct.
- The message says to fix the file and reload.

### MSL-32 · M4 · blocker · P4
**A delete that would orphan references is refused with a specific message.** Attempt to delete a referenced label without choosing a remap.
- The confirm action stays disabled, or the attempt is rejected with a message naming the label and its reference count.
- The message states the required next action (choose a remap target or explicit clear).
- Nothing is written to `labels.yaml` on the refused attempt.

### MSL-33 · M4 · major · P4 P9
**A partially-failed remap reports honestly.** Remap 12 references where 3 task writes fail.
- The result states how many tasks were updated and how many failed, and identifies the failures by key.
- It does not report blanket success.
- It states whether the label entry itself was removed, so the user knows the resulting on-disk state.
- A retry path is offered that targets only the failed tasks.

### MSL-34 · M4 · major · P4
**A duplicate-name warning on label creation is a warning, not a false error.**
- Creating a label whose `name` matches an existing one is permitted (names are not unique) but surfaces a "a label with this name already exists" caution before confirming.
- If the user proceeds, creation succeeds and MSL-21's disambiguation applies.
- The message never claims the name is invalid.

### MSL-35 · M4 · major · P4 P6
**A failed milestone-progress computation is distinguishable from zero progress.**
- If the task query backing the progress bar fails, the row shows an error affordance in place of the numbers, not `0 / 0`.
- The error names the milestone and offers a retry.
- Other milestones' rows continue to render their own progress.

### MSL-36 · M1 · major · P4
**A label filter referencing a deleted label reports the dangling reference.** Open a URL containing a label filter whose label was hard-deleted.
- The view states that the filter references a label that no longer exists, naming the id from the URL.
- It does not silently return zero rows, which would read as "no tasks have this label".
- The user is offered a way to clear the stale filter chip in one action.

### MSL-37 · M4 · minor · P4
**An invalid colour entered in the label editor is rejected at the input.**
- Typing a non-hex value shows an inline validation message naming the expected format.
- Save stays blocked while the value is invalid; nothing partially-written reaches `labels.yaml`.

### MSL-38 · M4 · minor · P4
**An unknown milestone key in the detail URL shows a not-found state.**
- The route says no milestone matches, and links back to the Milestones view.
- It is visually distinct from a milestone that exists but has zero tasks (MSL-15).
