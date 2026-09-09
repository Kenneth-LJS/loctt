# Flow: Board view

The board at `/board` — column derivation from `workflow.boards`, the
status chips bar, card rendering from the current user's `card_layout`,
WIP indicators, and drag-and-drop reordering backed by `board_rank`
lexoranks. Filtering is the shared filter bar and lives in
[flow-list.md](flow-list.md); what happens *after* a card click is
[flow-tasks.md](flow-tasks.md); the "+ Add task" button on a column
header opens the modal specified in
[flow-task-create.md](flow-task-create.md). Column *configuration*
(editing `workflow.boards.columns` in Settings) is
[flow-settings.md](flow-settings.md); this doc only covers the board
*consuming* that config.

## A. Happy path

### BRD-1 · M3 · blocker · P2 P3
**`/board` loads and renders one column per status when `workflow.boards` is absent.** Default workspace with six statuses and no `boards` block in `workflow.yaml`.

- Six columns appear, left to right, in the order the statuses are declared in `workflow.yaml` — not alphabetical, not by category.
- Each column header shows the status **`label`** (`Not started`, `In progress`, `Won't do`), never the stored `key` (`not_started`, `in_progress`, `wont_do`).
- Every non-archived task in scope appears in exactly one column, matched on its stored `status` key.
- The URL is `/board` with the same search-param vocabulary the list view uses; reloading the page reproduces the same board.

### BRD-2 · M3 · blocker · P3
**Columns come from `workflow.boards.columns` when configured, collapsing multiple statuses into one column.** `boards.columns` declares `{key: doing, label: "In flight", statuses: [in_progress, in_review, blocked]}` plus two single-status columns.

- Three columns render, not six.
- The `In flight` column header shows the column's `label`, not any status label.
- A task with `status: blocked` and a task with `status: in_progress` both appear in the `In flight` column.
- Statuses declared in `workflow.yaml` but not listed in any `columns[].statuses` do not get their own column (see BRD-24 for where those tasks go).
- Column order follows the `columns` array order, independent of status declaration order.

### BRD-3 · M3 · major · P3 P8
**The status chips bar lists every visible column's statuses and toggles column visibility.** Board with default 1:1 columns.

- A chip row above the board shows one chip per column, labelled with the column label and its current card count.
- Clicking a chip toggles its column off: the column is removed from the board and the remaining columns re-flow to fill the width.
- The chip stays visible in the bar in an "off" state (dimmed / unfilled), so the column can be turned back on.
- Toggling a column off does not change any task's `status` — the hidden cards reappear unchanged when the column is toggled back on.

### BRD-4 · M3 · major · P1 P8
**Chip visibility persists per user across reloads.** Toggle two columns off, then hard-reload.

- The same two columns are still hidden after reload.
- The state is written to `users/<id>/settings.yaml`, not `localStorage` — verify by reading the file.
- Switching to a different user and opening `/board` shows that user's own chip state (all columns visible for a user who has never toggled), not the first user's.
- The board is not blocked on the settings write: the column disappears immediately on click, before the PATCH resolves.

### BRD-5 · M3 · major · P3 P9
**Cards render exactly the fields `UserSettings.card_layout` marks visible, in the stored order.** `card_layout` has assignee and due date on, priority and labels off.

- Each card shows the title, the key, the assignee, and the due date.
- No priority pill and no label pills appear on any card.
- Reordering `card_layout` so due date precedes assignee reorders the corresponding rows on every card without a reload beyond the settings round-trip.
- A user with no `card_layout` in settings gets the built-in default layout, and the board does not error on the missing key.

### BRD-6 · M3 · major · P3 P9
**A column with a `wip` limit shows a count against the cap and flags going over.** Column `In flight` has `wip: 3`.

- The header shows both numbers — e.g. `3 / 3` — not just the card count.
- At 3 cards the indicator is at-cap styling; dragging a fourth card in changes it to over-cap styling (distinct colour/weight) showing `4 / 3`.
- The drop is still **allowed** — `wip` is a passive indicator, core does not enforce it — and the card lands in the column.
- A column with no `wip` key shows a plain count with no `/ n` and never renders an over-cap state.

### BRD-7 · M3 · minor · P6
**An empty column shows a designed placeholder, not a blank strip.** Filter down so one column has no cards.

- The column keeps its header, its count (`0`), and its full width.
- The body shows an explicit placeholder (e.g. "No tasks in In review") rather than empty whitespace.
- The placeholder area is still a valid drop target — a card dragged over it highlights, and dropping there works.

### BRD-8 · M3 · blocker · P8
**Clicking a card opens that task's detail.** Click anywhere on a card body.

- Navigation goes to `/tasks/<key>` for the clicked card's key.
- Browser back returns to `/board` with the same filters, chip visibility, and scroll position.
- A click that begins a drag (mouse-down, move past threshold, mouse-up) does **not** navigate — the drag and the click are mutually exclusive.

### BRD-9 · M3 · blocker · P1 P10
**Dragging a card to a different column writes status and `board_rank` in one atomic call.** Drag a `not_started` card into `In progress`, dropping between two existing cards.

- Exactly **one** request is issued (a `setFields`-style multi-field update), carrying both the new `status` key and the new `board_rank`. Two sequential single-field calls is a failure of this case.
- The posted `status` is the config **key** (`in_progress`), not the label.
- The posted `board_rank` is strictly between the ranks of the cards immediately above and below the drop position.
- After the response, the on-disk `task.md` frontmatter shows both fields updated, and the task's history records the change.

### BRD-10 · M3 · blocker · P1
**Dragging a card within its own column writes `board_rank` only.** Drag the bottom card of a column to the top.

- The request payload contains `board_rank` and no `status` key at all — not `status` set to its existing value.
- The card renders in its new position immediately and stays there after the refetch settles.
- **Re-read `task.md` from disk**: `board_rank` holds the new value and `status` is unchanged. BRD-9 checks disk for the cross-column case; this one checked only the payload plus a client re-render, so a request that was accepted and dropped would pass.
- Reordering does not touch `updated_at` semantics differently from any other field edit — the task shows as updated, consistent with the CLI's behaviour for the same operation.

### BRD-11 · M3 · major · P8
**Drop targets are visible during a drag and the reflow is animated.** Pick up a card and hover over three different positions without releasing.

- The source position collapses or shows a placeholder gap so the board doesn't jump when the card is finally removed.
- The target gap opens at the insertion point, and moving between positions animates the gap rather than teleporting it.
- The hovered column is visually distinguished from the non-hovered ones.
- Releasing outside any column cancels: the card animates back to its original slot and **no** request is issued.

### BRD-12 · M3 · major · P3
**A column collapsing several statuses does not rewrite a card's status on an intra-column reorder.** Column `In flight` contains `in_progress` and `blocked` cards; drag a `blocked` card above an `in_progress` card inside the same column.

- Only `board_rank` is written; the card's status stays `blocked`.
- The card's status pill (if `card_layout` shows it) still reads `Blocked` after the drop.
- Moving the same card *out* to another column does write the new column's status.

### BRD-13 · M3 · major · P3
**A card dropped into a multi-status column adopts the column's first status.** Drag a `not_started` card into `In flight` (`statuses: [in_progress, in_review, blocked]`).

- The written `status` is `in_progress` — the first entry of that column's `statuses` array — deterministically, not the last-declared or an arbitrary pick.
- Reordering `statuses` in `workflow.yaml` to `[blocked, in_progress, in_review]` and repeating the drag writes `blocked`.

### BRD-14 · M3 · minor · P2 P9
**The board respects the shared filter bar and reflects filters in the URL.** Apply an assignee filter.

- Every column's card set and count shrinks to the filtered set.
- The URL gains the filter params; pasting that URL in a new tab reproduces the same filtered board.
- Column headers count *filtered* cards, and a WIP indicator counts filtered cards too — the number under the cap must match the number of cards actually rendered.

## B. Edge cases

### B1. Configuration shape

### BRD-15 · M3 · major · P3 P9
**Twenty statuses produce twenty columns that scroll horizontally rather than squashing.** `workflow.yaml` declares 20 statuses, no `boards` block.

- Each column keeps a readable minimum width; titles are not truncated to two characters.
- The board region scrolls horizontally with a visible scrollbar or affordance; the app shell (header, sidebar) does not scroll with it.
- Card content does not wrap into unusable slivers.
- The chips bar itself wraps or scrolls; 20 chips do not push the board below the fold.

### BRD-16 · M3 · minor · P3 P6
**One status produces one column, and it does not stretch to a full-width slab of cards.** `workflow.yaml` declares exactly one status.

- A single column renders at a sane maximum width, left-aligned, with the remaining board area empty rather than the column stretched edge-to-edge.
- Drag within the column still reorders; there is no cross-column drop target, and dragging to the empty area cancels cleanly.

### BRD-17 · M3 · major · P3 P7
**A `boards.columns` entry naming a status that no longer exists in `workflow.yaml` renders the column and explains the gap.** `columns` references `in_review` after `in_review` was deleted from `statuses`.

- The column still renders (it may hold other, valid statuses).
- No card is silently misfiled into it.
- The stale status reference is surfaced — a per-column notice or the schema/config-drift banner — naming the column and the missing status key, not a console warning only.
- The board does not throw; other columns behave normally.

### BRD-18 · M3 · blocker · P7
**A task whose `status` was deleted from `workflow.yaml` is visible, not vanished.** Delete `blocked` from `statuses` while 12 tasks still carry `status: blocked`.

- The 12 tasks are not silently dropped from the board — a board that shows 88 of 100 tasks with no explanation is a P7 violation.
- They surface in a designated place (an "Unknown status" column or an explicit banner with a count and a link to the affected tasks) that names the orphan key `blocked` verbatim.
- Cards for those tasks are still clickable through to detail.
- Dragging such a card into a valid column repairs it: the drop writes a real status key and the card leaves the orphan grouping.

### BRD-19 · M3 · minor · P3 P7
**Two statuses whose labels are identical still resolve to distinct columns.** Two statuses with different `key`s and the same `label` string.

- Two separate columns render (keys are the identity).
- Cards route to the column matching their stored key, not the first label match.
- The UI disambiguates the two headers enough that a user can tell which is which (e.g. showing the key as a subtitle).

### BRD-20 · M3 · minor · P3
**A status with an empty-string-ish or emoji label renders without breaking column layout.** Labels containing emoji, RTL text, or a 60-character phrase.

- The header truncates with an ellipsis and exposes the full label on hover/title, rather than wrapping to five lines or pushing the count off-screen.
- Column widths stay uniform regardless of label length.

### B2. Scale

### BRD-21 · M3 · major · P9
**A column holding 900 cards stays usable.** Seed 900 tasks into one status.

- The column header count reads the true total (`900`), not a page size.
- The column scrolls independently of the board; scrolling it does not scroll neighbouring columns.
- Scrolling is smooth — if virtualization is used, cards render correctly at the top, middle, and bottom of the range, and the scrollbar length is honest.
- Dragging a card from the 900-card column to another column works, including when the drag starts from a virtualized row far down the list.
- Auto-scroll: dragging a card to the top or bottom edge of a tall column scrolls it, and releasing drops at the position under the cursor, not at the position where the scroll started.

### BRD-22 · M3 · major · P9
**A card with 20 labels and a 300-character title does not break the column.** One task with a long title and 20 labels, `card_layout` showing both.

- The title clamps to a fixed number of lines with an ellipsis; the card does not grow to fill the column.
- Labels wrap inside the card or collapse to `+14` overflow; they never widen the card past the column or push the due date out of view.
- Neighbouring cards keep their normal height.

### BRD-23 · M3 · minor · P9
**A board scoped to "All projects" shows the project on each card and does not mix key prefixes confusingly.** Two projects, `WEB-` and `BACKEND-`.

- Every card shows a project indicator (badge or prefix in the key) when the project switcher is on All projects.
- Reordering across projects is permitted and writes `board_rank` per task; ranks from different projects interleave in the same column without collision (`board_rank` is per-column ordering, not per-project).

### BRD-24 · M3 · major · P3 P7
**A status not listed in any configured column has its tasks accounted for.** `boards.columns` covers 5 of 6 statuses; 30 tasks sit in the uncovered `wont_do`.

- The 30 tasks are either shown in an explicit catch-all column or excluded with a visible, counted notice ("30 tasks in statuses not on this board"). Silent omission fails this case.
- Whichever behaviour is chosen is consistent with the list view's total for the same filter — the two views must not disagree about how many tasks exist.

### B3. Rank generation and rebalancing

### BRD-25 · M3 · blocker · P1
**Dropping at the top of a column generates a rank strictly below the current first card.** Column's first card has `board_rank: "u"`.

- The new rank compares lexicographically less than `"u"` and greater than `MIN` (`"0"`).
- It does not equal `"0"` and does not end in `'0'`.
- Both cards are still in the intended order after a refetch from disk.

### BRD-26 · M3 · blocker · P1
**Dropping at the bottom of a column generates a rank strictly above the current last card.** Last card has `board_rank: "z0"`-ish high value.

- The new rank sorts after the previous last card and strictly before `MAX` (`"z"`), never equal to `"z"`.
- Repeating the append ten times produces ten strictly increasing ranks with no duplicates.

### BRD-27 · M3 · major · P1
**Cards with no `board_rank` sort below ranked cards and can be dragged to acquire one.** A column with three ranked cards and four never-reordered cards.

- The four unranked cards appear after all ranked cards, ordered by creation, matching the documented fallback.
- Dragging one unranked card above a ranked card assigns it a `board_rank` and it stays above after reload.
- The other three unranked cards keep their relative order and are not silently backfilled with ranks by the single drag.

### BRD-28 · M3 · major · P1 P9
**A rank that grows past the 24-character threshold triggers a window rebalance without visually reordering anything.** Repeatedly drop a card into the same tight gap until a generated rank exceeds `REBALANCE_LENGTH_THRESHOLD`.

- The visible card order before and after the rebalance is **identical** — a rebalance must not shuffle cards.
- After the rebalance, the affected cards' `board_rank` values on disk are short (a few characters), evenly spaced.
- No card loses its position, and no card ends up with a rank equal to another card's in the same column.
- The rebalance is not announced as an error; at most it is invisible to the user.

### BRD-29 · M3 · major · P1
**Two cards that somehow carry identical `board_rank` values render in a stable, deterministic order and are separable by a drag.** Hand-edit two `task.md` files to share `board_rank: "u"`.

- The board picks a deterministic tiebreak (e.g. created time, then id) so two reloads produce the same order — not a random swap on each render.
- Dragging one of the two above the other produces distinct ranks; after the drop no two cards in the column share a rank.

### BRD-30 · M3 · minor · P1 P7
**A `board_rank` that is not a valid lexorank string is tolerated.** Hand-edit a task to `board_rank: "ABC!"` (uppercase and punctuation are outside the base-36 lowercase alphabet).

- The card still renders on the board; it is not dropped from the column.
- Sorting does not throw; the invalid rank is treated as unranked or sorted deterministically at one end.
- Dragging that card writes a valid rank, repairing it, and the drop succeeds.

### BRD-31 · M3 · major · P1
**Dropping a card into the exact position it already occupies is a no-op.** Pick up a card and release it back between the same two neighbours.

- No request is issued.
- The card's `board_rank` on disk is unchanged, and no history entry is written.
- `updated_at` is not bumped.

### B4. Concurrency

### BRD-32 · M3 · blocker · P1
**A background refetch that lands mid-drag does not yank the dragged card.** Start a drag, hold it, and let a poll/refetch resolve.

- The card under the cursor stays under the cursor.
- The board does not re-sort or re-render columns out from under the drag; if new data arrived, it is applied after the drop completes.
- The drop still writes the rank computed against the neighbours the user actually saw at release time, and the resulting order matches what was on screen at that moment.

### BRD-33 · M3 · major · P1 P10
**A CLI `setField` on a visible task lands on the board without a manual reload.** With `/board` open, run `loctt set <key> status in_review` in a terminal.

- Within one refetch interval the card moves to the `In review` column on its own.
- The card is not duplicated in both columns during the transition.
- Column counts and WIP indicators update to match.

### BRD-34 · M3 · major · P1
**Two browser tabs reordering the same column converge on one order, not a phantom one.** Tab A drags card 1 to the top; Tab B (stale) drags card 2 to the top a moment later.

- Both writes succeed — they touch different tasks, so neither clobbers the other.
- After both settle and both tabs refetch, **both tabs show the same order**, and that order matches what the files on disk say.
- Neither tab is left showing a card in a position no rank justifies.

### BRD-35 · M3 · major · P1
**A card moved to another column by another surface while being dragged in this tab resolves without inventing a state.** Drag a card in the UI while the CLI moves that same task to a third status; release the drag after the CLI write.

- The drop is applied against the task as it now exists, or it is rejected with an explanation (BRD-42) — it must not write a `board_rank` for a column the task is no longer in and leave the card floating.
- After the dust settles, the card's rendered column matches its stored `status` on disk.

### BRD-36 · M3 · minor · P1
**Toggling a column off while a card in that column is mid-drag cancels cleanly.** Use the chips bar (via keyboard) while holding a drag over that column.

- The drag is cancelled rather than dropping into a column that is no longer rendered.
- No request is issued and the task's fields are unchanged.

### B5. Interaction and presentation

### BRD-37 · M3 · major · P8
**Drag is initiated by an intentional gesture, not by a stray mouse-down.** Press on a card and move 2px, then release.

- No drag starts and no reorder happens; a click-through to detail fires instead (or nothing, if the implementation requires a clean click).
- Moving past the drag threshold and releasing does not also navigate to the task.
- Pressing `Esc` mid-drag cancels the drag, returns the card to its origin, and issues no request.

### BRD-38 · M3 · major · P8
**A card can be moved between columns without a mouse.** Focus a card by keyboard.

- The card is reachable with `Tab`/arrow keys and shows a visible focus ring.
- A documented key sequence moves the card between columns and positions within a column, producing the same single atomic write as a mouse drag (BRD-9).
- The move is announced to assistive tech (target column and position), per [flow-accessibility.md](flow-accessibility.md).

### BRD-39 · M3 · minor · P6
**The board has a designed loading state, not a flash of empty columns.** Throttle the network and load `/board`.

- Column skeletons (or a single board-level skeleton) appear; the user never sees "0" counts and "No tasks" placeholders on columns that in fact have cards.
- If the request is still pending after the skeleton's designed window, the state escalates to a message with a retry, per [flow-error-handling.md](flow-error-handling.md).

### BRD-40 · M3 · minor · P6 P9
**A tracker with zero tasks shows a board-level empty state, not six identical placeholders.** Fresh tracker.

- One board-level empty state explains there are no tasks yet and offers "+ Add task".
- Columns still render (so the user can see the workflow shape) but the six per-column placeholders do not read as six separate errors.

## C. Error cases

### BRD-41 · M3 · blocker · P1 P4
**A cross-column drop that fails on the server snaps the card back and says why.** Server returns 500 on the `setFields` write.

- The card returns to its **original column and original position**, not a halfway state.
- An error names the task by key, states that the status change to `In progress` was not saved, and offers a retry.
- Re-reading the task from disk shows the original `status` and original `board_rank` — no partial write of one field without the other.
- The column counts and WIP indicators return to their pre-drag values.

### BRD-42 · M3 · blocker · P4 P7
**A drop into a column whose status was deleted from `workflow.yaml` since page load is rejected legibly.** Delete a status via YAML, then drop a card into its (still-rendered) column.

- The write is rejected and the card returns to its origin.
- The message names the status key that no longer exists and tells the user the board is showing stale configuration and to reload.
- The board offers a reload action; after reload the deleted column is gone.
- Nothing is written to disk — the task keeps its old status.

### BRD-43 · M3 · blocker · P4 P6
**Losing the connection mid-drop does not leave the card visually moved.** Kill the server between mouse-up and the response.

- The card is not left rendered in the destination column while the file still says otherwise — either it reverts, or it is clearly marked as unsaved/pending with the destination shown as tentative.
- **A reload shows server truth**: the pending state does not survive it. Optimistic rendering that outlives a refresh is the browser presenting its own state as fact (P1).
- The message says the move was not saved, names the task, and says what to do (retry when the server is back).
- On reconnect, the board's rendered state matches disk exactly — no stale optimistic position survives the recovery.

### BRD-44 · M3 · major · P4
**A drop onto a task that no longer exists fails with a specific message.** Delete the target task via CLI, then drop a card next to where it was.

- The error names the operation ("Couldn't reorder WEB-12") and the reason (the neighbouring task no longer exists / the board is out of date).
- The board refetches so the deleted card disappears.
- The dragged card ends in a real, persisted position — either its origin or a rank computed against the surviving neighbours — never in a position that exists only in the browser.

### BRD-45 · M3 · major · P4 P7
**A malformed `workflow.boards` block does not blank the board.** Hand-edit `workflow.yaml` so two columns claim the same status (a schema violation).

- The board shows an explicit configuration-error state naming the file, the offending column keys, and the duplicated status key.
- It tells the user how to fix it (edit `workflow.yaml`, or remove the `boards` block to fall back to 1:1 columns).
- It does not render a white pane, and it does not silently fall back to 1:1 columns without saying so.

### BRD-46 · M3 · major · P4 P6
**One corrupt `task.md` does not take down the board.** Corrupt the frontmatter of a single task file.

- Every other card renders normally in its correct column.
- The failure is surfaced once, naming the task directory/id and the parse problem, with a "check the file" next action.
- Column counts are honest about what could and could not be read — a count of 99 with a note about 1 unreadable task, not a silent 99.

### BRD-47 · M3 · major · P4
**A card-layout settings write that fails leaves the board rendering the last-known-good layout.** Return 500 from the settings PATCH after a `card_layout` change made elsewhere.

- The board does not render with an empty or default layout as if the user's saved preference were gone.
- The error states that the layout preference was not saved and what the board is currently showing.

### BRD-48 · M3 · minor · P1 P4
**A chip-visibility write that fails is reported, and the discrepancy is visible.** Toggle a column off while the settings endpoint is failing.

- The column hides optimistically, then either reverts with an explanation or stays hidden with a clear "not saved — will reset on reload" note.
- Silently hiding it and losing the preference on reload with no message is a failure of this case.

### BRD-49 · M3 · major · P4
**A rebalance that fails partway leaves a consistent order, not a scrambled column.** Force a failure during the multi-task rank rewrite of BRD-28.

- The column order after the failure is still a valid total order — no two cards claiming the same position, no card jumping several slots.
- The error states that the reorder could not be completed, names the column, and says whether the user's move was saved.
- A subsequent successful drag in the same column works without first requiring a manual file fix.

### BRD-50 · M3 · major · P3 P8
**Board cards surface "blocked" and "epic".**

- A blocked card shows a blocked marker/pill.
- An epic card shows a child-count badge (e.g. "◇ 3").
- A subtask shows a "belongs to epic" hint. (UX-5.)

### BRD-51 · M3 · minor · P8
**The board header status pills read as visibility toggles.**

- Each pill has a tooltip/label ("Hide/show column") or an explicit eye/checkbox affordance, so a dimmed pill next to a missing column is not misread as "no tasks".
- Extends BRD-3 (which pins that the pills *are* toggles); this adds the discoverability affordance. (UX-6.)
