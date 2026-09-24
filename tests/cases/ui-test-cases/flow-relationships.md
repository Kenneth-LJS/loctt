# Flow: relationships and attachments

The task detail panel's Relationships section — grouping, symmetric
folding, the add-link picker, inverse-edge bookkeeping, ranked
drag-reorder, and structural parent/child trees — plus the Attachments
grid. Lands in **M2.5**. Task detail read/edit and archive/delete are
[flow-tasks.md](flow-tasks.md); the activity entries these actions emit
(`link_added`, `link_removed`, `attachment_added`,
`attachment_removed`) are rendered per
[flow-comments-activity.md](flow-comments-activity.md); relationship
*configuration* (adding a kind, flipping `symmetric`/`structural`/
`ranked`) is [flow-settings.md](flow-settings.md).

Grounding: an edge is `{ type, target, rank? }` in task frontmatter,
where `target` is a task **ULID** and `type` is a relationship `key` or
`inverse` key from `workflow.yaml`. Links are bilateral — core's
`linkTask` writes the forward edge on the source and the inverse edge on
the target. Ranks are lexorank strings rebalanced past a 24-character
threshold. Attachments are raw files under
`tasks/<id>/attachments/`, size-capped at 50 MB by default, served with
`Content-Disposition: attachment` and `nosniff`.

## A. Happy path

### A.1 Reading the panel

### REL-1 · M2 · blocker · P3
**Relationships are grouped by kind, under the configured labels.** Open
a task with `blocks`, `depends_on`, and `parent` edges.
- Each group's heading is the relationship's `label` from
  `workflow.yaml` (e.g. "Blocks", "Depends on"), never the raw `key`.
- Groups appear in the order the kinds are declared in `workflow.yaml`.
- A kind with no edges on this task renders no heading — empty groups
  are not padding.
- Each row shows the target's key and title, and is a link to
  `/tasks/$key`.

### REL-2 · M2 · blocker · P3
**A directional pair renders the correct side's label on each task.**
Config: `blocks` / inverse `is_blocked_by` ("Is blocked by"). Link
T-1 blocks T-2.
- On T-1 the group heading is "Blocks" and lists T-2.
- On T-2 the group heading is "Is blocked by" and lists T-1.
- Neither task shows both headings for this single edge.

### REL-3 · M2 · blocker · P3
**A symmetric pair folds under ONE heading.** Config declares
`related_to` with `kind: symmetric`. Link T-1 related_to T-2.
- T-1 shows exactly one "Related to" group containing T-2.
- T-2 shows exactly one "Related to" group containing T-1.
- Neither task shows the same target twice, and no second heading
  (forward + inverse) appears for the same kind.
- Each side's frontmatter carries exactly one edge for the pair.

### REL-4 · M2 · major · P3
**Each group shows its own count.**
- A group heading with 6 targets shows "6" (or "Blocks · 6").
- The count is the number of edges in that group, not the task's total
  edge count.
- Counts update immediately after add or remove without a reload.

### REL-5 · M2 · major · P3
**Structural relationships render as a tree, not a flat list.** A task
with two children, one of which has three children of its own.
- The `parent`/`child` group (marked `structural: true`) renders nested
  rows with visible depth.
- Non-structural kinds in the same panel render flat.
- Each tree node shows its key, title, and status so the subtree is
  scannable.
- Collapsing a node hides its descendants; the collapsed state does not
  leak into other tasks' panels.

### REL-6 · M2 · minor · P3
**Ranked and unranked groups are visually distinguishable.**
- A group whose kind is `ranked: true` shows drag handles on its rows.
- A group whose kind is not ranked shows no drag handle and cannot be
  reordered.
- Within a ranked group, edges carrying a `rank` sort by rank; edges
  without one sort below the ranked ones (matching core's ordering).

### A.2 Adding and removing links

### REL-7 · M2 · blocker · P3 P8
**"+ Add link" asks for the kind first, from config.**
- The picker's kind list contains every side of every configured
  relationship — both `blocks` and `is_blocked_by` are offerable, since
  the user may want either direction.
- Symmetric kinds appear once, not twice.
- Each option shows the `label` / `inverse_label`, not the key.
- A workspace with one configured relationship shows one option; a
  workspace with eight shows eight.

### REL-8 · M2 · blocker · P8
**The target search matches by key AND by title.**
- Typing `WEB-42` surfaces that task by exact key.
- Typing a word from a task's title surfaces it.
- Typing a former key from a task's `key_history` resolves to the task
  it now belongs to.
- Results show key + title + status so two similarly-titled tasks are
  distinguishable.
- The current task never appears in its own results.

### REL-9 · M2 · blocker · P1 P10
**Adding a link writes the inverse edge on the other task
automatically.** From T-1, add `blocks` → T-2.
- T-1's frontmatter gains `{ type: blocks, target: <T-2 ULID> }`.
- T-2's frontmatter gains `{ type: is_blocked_by, target: <T-1 ULID> }`
  without the user touching T-2.
- Opening T-2 (or refreshing an already-open tab per
  [flow-cross-surface.md](flow-cross-surface.md)) shows the inverse edge
  under "Is blocked by".
- Both tasks' `updated_at` advance.
- Both tasks get a `link_added` history entry.

### REL-10 · M2 · blocker · P1 P10
**Removing a link removes both edges.** Remove the `blocks` edge from
T-1.
- T-1's `blocks` edge to T-2 is gone.
- T-2's `is_blocked_by` edge to T-1 is gone — removing one side never
  leaves a dangling half-edge.
- Both tasks get a `link_removed` history entry.
- Removing the edge from T-2's side (the inverse side) has the identical
  bilateral effect.

### REL-11 · M2 · major · P3
**Adding a link from the inverse side stores the right direction.** From
T-2, add `is_blocked_by` → T-1.
- The resulting stored edges are identical to REL-9's: T-1 gets
  `blocks`, T-2 gets `is_blocked_by`.
- The panel on each task shows the same headings as REL-9 — direction is
  a property of the data, not of which page you were on.

### REL-12 · M2 · major · P5 P8
**Removing a link is a deliberate, aligned action: a kebab menu with a
confirm.**
- Each relationship row exposes a **persistent kebab (⋯) control in a
  fixed slot** — not a hover-only affordance — so the row's label/status
  pill align correctly and the control is reachable by mouse and by
  keyboard focus.
- Opening the kebab offers **Remove** (with room for future per-link
  actions).
- Removal asks for a brief confirm ("Remove this link?" Remove /
  Cancel) — a single deliberate step, not a typed confirmation. This
  guards against the accidental one-click removal the old hover-`✕`
  allowed.
- The confirm/kebab is the only remove path; there is no stray
  hover-`✕`.

### A.3 Ranked reorder

### REL-13 · M2 · blocker · P1
**Drag-reorder within a ranked group persists a new rank.** A `subtask`
group (ranked) with 4 targets; drag the 4th to position 2.
- The row lands between the old 1st and 2nd and stays there after a
  reload.
- Only the dragged edge's `rank` is rewritten; the other three edges'
  ranks are untouched.
- Compare the other three edges' `rank` values **before and after**, byte for byte. Asserting only the rendered order would pass if every rank were rewritten.
- The new rank sorts strictly between its neighbours and does not end in
  `0`.
- The reorder writes to the source task only — the targets' inverse
  edges are not re-ranked by this action.

### REL-14 · M2 · major · P9
**Reordering into first and last position works.**
- Dropping a row above the current first produces a rank below every
  existing rank.
- Dropping below the current last produces a rank above every existing
  rank.
- Neither operation renumbers the other rows.

### REL-15 · M2 · minor · P8
**Drag-reorder is keyboard-reachable.**
- A ranked row can be picked up from the keyboard and moved up/down.
- The move is announced (position N of M) rather than being a silent
  visual change.
- Escape during a keyboard move restores the original position.

### A.4 Attachments

### REL-16 · M2 · blocker · P3
**The attachments grid renders MIME-aware tiles.** A task with a PNG, a
PDF, an MP4, and a `.xyz` file.
- The PNG shows an inline image thumbnail.
- The PDF, MP4, and `.xyz` show a type icon, not a broken image.
- Every tile shows the filename and a human-readable size ("1.4 MB").
- The MIME shown/dispatched on matches core's extension table; an
  unknown extension is treated as `application/octet-stream`.

### REL-17 · M2 · blocker · P8
**Drag-drop upload attaches the file.** Drag a 2 MB JPEG onto the
attachments area.
- A drop target is indicated while dragging over the panel.
- On drop, the file appears in the grid with its original filename and
  size.
- The file lands at `.loctt/tasks/<id>/attachments/<name>` and an
  `attachment_added` history entry is written with the name and size.
- The click-to-browse Upload control produces the identical result.

### REL-18 · M2 · blocker · P1 P10
**Task attachments upload RAW — no recompression.** Upload a 4.2 MB JPEG
at 4000×3000.
- The stored file's byte size equals the source file's byte size
  exactly.
- The stored image's pixel dimensions are unchanged at 4000×3000.
- A byte-for-byte comparison (checksum) of source and stored file
  matches.
- This holds for PNG, GIF, WebP, and HEIC too — image compression is a
  profile-picture-only path (M4) and must not touch this one.
- A non-image (e.g. a `.zip`) is likewise stored byte-identical.

### REL-19 · M2 · major · P5 P8
**Hover-X removes an attachment.**
- A remove control appears on tile hover and on keyboard focus.
- Removing deletes the file from the attachments directory and writes an
  `attachment_removed` history entry.
- The tile disappears from the grid without a reload.
- Because the file is gone from disk permanently, the removal asks for a
  simple confirmation naming the filename — but not a typed confirm.

### REL-20 · M2 · major · P8
**Clicking a tile downloads the file.**
- The download serves the original bytes under the original filename.
- The response uses `Content-Disposition: attachment` and
  `X-Content-Type-Options: nosniff` — an uploaded `.svg` or `.html`
  downloads rather than rendering in the origin.
- Clicking an image tile downloads it; it does not navigate away from
  the task.

## B. Edge cases

### B.1 Graph shape

### REL-21 · M2 · blocker · P6 P9
**A hand-edited relationship cycle is detected, not hung on.** By direct
file editing, make A `parent` B and B `parent` A, then open A.
- The panel renders and names the cycle rather than recursing forever or
  spinning.
- The tree display stops at the repeat and marks it ("cycle detected —
  B already appears above").
- The page does not lock the browser tab; there is no unbounded loop.
- A next action is offered: which two edges form the cycle, and where to
  fix them.

### REL-22 · M2 · blocker · P4 P6
**Creating a cycle through the UI is refused before the write.** With A
parent B parent C, try to add C parent A.
- The add is rejected before either edge is written.
- The message names the path that would form the cycle, using task keys.
- Neither C nor A gains an edge — the forward write must not land while
  the inverse fails.
- The picker stays open so the user can pick a different target.

### REL-23 · M2 · major · P4 P6 P9
**A structural graph too large to verify refuses the link rather than
guessing.** Construct a parent chain exceeding core's cycle-walk cap.
- The add is refused with a message saying the graph is too large to
  verify safely.
- The message states the practical next step (split the hierarchy, or
  verify manually).
- It does not silently add the link, and it does not claim a cycle
  exists when it hasn't proven one.

### REL-24 · M2 · blocker · P6 P7
**A dangling target renders as a broken edge, not as a blank row.** Edge
points at a ULID with no task directory (deleted out of band).
- The row appears with an explicit broken-reference treatment naming the
  missing target id.
- The rest of the group and the rest of the panel render normally.
- The row offers "Remove this link" so the user can clean it up.
- The list view and the task's other sections are unaffected.

### REL-25 · M2 · major · P6 P7
**An edge whose `type` is not in `workflow.yaml` is surfaced, not
dropped.** Hand-edit an edge to `type: blockz`.
- The edge renders under an "Unknown relationship type" group naming
  `blockz`.
- The panel does not silently omit it — a hidden edge is worse than a
  labelled unknown.
- The message points at `workflow.yaml` as the place to add or correct
  the kind.
- Removing the edge is still possible from the UI.

### REL-26 · M2 · major · P3 P7
**An explicit forward+inverse duplicate on a symmetric kind collapses in
display.** Hand-edit both tasks so each has the symmetric edge, plus add
a redundant second edge of the same type/target on one side.
- The panel lists the target once, not twice.
- A drift indicator flags the duplicate rather than hiding it silently.
- Removing the link cleans up all copies of the edge on both sides.

### REL-27 · M2 · major · P3 P7
**A one-sided legacy edge is tolerated and repaired, not doubled.** T-1
has `blocks` → T-2 but T-2 has no inverse.
- T-1's panel shows the edge under "Blocks".
- T-2's panel either shows the inverse (if repaired on read) or shows
  nothing, but never shows an edge pointing at itself.
- Re-adding the same link from T-1 fills in the missing inverse on T-2
  instead of erroring or creating a duplicate forward edge.

### REL-28 · M2 · major · P9
**A task with 50 relationships across 6 kinds stays usable.**
- All 6 groups render with correct counts summing to 50.
- Groups are individually collapsible so the panel doesn't push the
  attachments and activity sections off screen.
- Long target titles truncate with an accessible full title, and do not
  push the remove control out of the panel.
- Scrolling and reordering stay responsive; the panel does not refetch
  every target on every hover.

### REL-29 · M2 · minor · P5
**Self-links are refused.** Try to add a link whose target is the task
you're on.
- The current task is not offered in search results.
- If reached anyway (pasted key), the add is refused with a message
  naming the task and saying a task can't link to itself.

### REL-30 · M2 · major · P7
**Linking to an archived task is refused with a route out.**
- The target search excludes archived tasks by default.
- If an archived task is selected anyway, the add is refused naming the
  target's key and its archived state.
- The message offers unarchiving as the next step.
- An *existing* link to a task that was archived later still renders,
  with an archived badge on the row — historical links keep resolving.

### B.2 Rank mechanics

### REL-31 · M2 · blocker · P1 P9
**Repeated reordering past the 24-char threshold rebalances the
window.** In a 50-item ranked group, repeatedly drop the same row
between the same two neighbours until a generated rank would exceed 24
characters.
- The group's ranks are rebalanced to evenly spaced short strings.
- The visible order before and after the rebalance is identical — a
  rebalance must never reshuffle the user's ordering.
- The rebalance is persisted for the whole affected window, not just the
  dragged row.
- No rank ends in `0` after the rebalance.
- No user-visible error or flash accompanies the rebalance; it is an
  implementation detail.

### REL-32 · M2 · major · P1
**Two tabs reordering the same ranked group converge, and neither
silently loses.** Open the same task in two tabs; reorder in tab A, then
reorder a different row in tab B against tab B's stale list.
- Tab B's write is either applied against the current state or rejected
  with a stale-state message — it must not write a rank computed from
  neighbours that have since moved and produce an order neither user
  chose.
- After both operations, reloading both tabs shows the same order.
- The losing tab is told what happened and offered a refresh.

### REL-33 · M2 · minor · P1
**Reordering a group whose kind was just switched to `ranked: false` is
refused cleanly.** Change the config in another process mid-session.
- Drag handles disappear on the next refresh.
- A drag attempt against a stale page is refused with a message that the
  kind is no longer ranked.
- Existing `rank` values on the edges are not stripped by the refusal.

### REL-34 · M2 · minor · P9
**A ranked group where no edge has a rank still orders
deterministically.**
- Rows sort by a documented fallback (creation order in the array), not
  randomly.
- Dragging one row assigns it a rank and it moves to the front of the
  ranked segment; unranked rows remain below.

### B.3 Attachments

### REL-35 · M2 · major · P4 P9
**A 200 MB file is rejected before any bytes are written.** Drag a
200 MB video onto the panel.
- The rejection happens at the size check, not after a long upload.
- The message names the file, its size, and the cap ("video.mp4 is
  200 MB; the limit is 50 MB").
- Nothing is written under `attachments/` — no partial or `.tmp` file
  remains.
- The rest of a multi-file drop still uploads; only the oversized file
  fails, and it is named individually.

### REL-36 · M2 · major · P4
**A filename containing a path separator is refused or sanitized to a
basename — never traversed.** Attempt to upload a file named
`../../etc/passwd` or `a/b.txt`.
- The stored name is a plain basename with no separators, or the upload
  is refused naming the reason.
- Nothing is written outside `tasks/<id>/attachments/`.
- Names starting with a dot, containing `..`, or containing a null byte
  are refused with a stated reason.

### REL-37 · M2 · minor · P9
**A 255-character filename renders without breaking the grid.**
- The tile shows a truncated name with the full name available on hover
  and to assistive tech.
- The tile keeps its grid dimensions; neighbouring tiles do not reflow.
- Download still serves the full original name.
- If the filesystem rejects the length, the error names the file and the
  limit rather than failing silently.

### REL-38 · M2 · minor · P3
**A file with no extension gets a generic icon and no MIME
guess.**
- The tile shows a generic file icon.
- No image thumbnail is attempted.
- The download serves it as `application/octet-stream`.
- The filename displays exactly as uploaded.

### REL-39 · M2 · major · P5
**Uploading a file whose name collides with an existing attachment asks
first.**
- The user is told a file with that name already exists on this task.
- The choices offered are explicit: replace, or cancel.
- Choosing replace overwrites and records the change in history;
  cancelling leaves the original untouched.
- Nothing overwrites silently.

### REL-40 · M2 · minor · P9
**Dropping 20 files at once reports per-file outcome.**
- Each file gets its own tile or its own failure line.
- The summary counts succeeded and failed separately.
- One failure does not abort the remaining uploads.

### REL-41 · M2 · minor · P6
**A task with no attachments shows a designed empty state.**
- The section says there are none and states how to add (drag files
  here, or Upload).
- It is not a blank rectangle and not an empty grid with no affordance.

## C. Error cases

### REL-42 · M2 · blocker · P4
**A failed inverse write is reported, and the panel reflects the actual
disk state.** Force the inverse-edge write to fail after the forward
write succeeds.
- The message names both tasks, says the forward link was created and
  the inverse was not, and says how to repair (re-run the link, or
  edit the target).
- The panel shows the actual state — the forward edge present — rather
  than an optimistic UI showing a link that only half exists.
- It does not report plain success.

### REL-43 · M2 · blocker · P4
**Linking to a nonexistent key says nothing matched.** Type a key that
doesn't resolve and force the add.
- The message is "No matches found."
- The picker keeps the typed text so the user can correct it.

> **Amended (K123, Ken 2026-09-24).** This case required the message to
> name the key and explain that former keys resolve via `key_history`.
> Ken: *"yea this is a bad message. should just be 'No matches found.'.
> dont editorialise."*

### REL-44 · M2 · major · P4
**Removing an already-removed link is idempotent and honest.** Remove
the same edge in two tabs.
- The second removal reports that the link was already gone rather than
  erroring with an opaque failure.
- The panel converges to the correct state in both tabs after refresh.

### REL-45 · M2 · major · P4 P6
**A relationships write blocked by the state lock names the
contention.**
- The message says another LocTT process is writing and suggests
  retrying.
- The panel does not show the link as added.
- Retrying after the lock releases succeeds.

### REL-46 · M2 · major · P4
**A failed reorder rolls the row back to its original position.**
- If the rank write fails, the row visually returns to where it started.
- The message names the reorder as the failed action and gives a reason.
- Reloading confirms the original order — the UI never leaves a
  position on screen that isn't on disk.

### REL-47 · M2 · major · P4
**A failed upload leaves no partial file and says so.** Kill the
connection mid-upload of a 30 MB file.
- No partial file appears in the grid.
- No stray file remains under `attachments/`.
- The message names the file, says the upload did not complete, and
  offers retry.
- If completion is genuinely unknown, the message says the state is
  unknown and tells the user to reload and check — per P4's rare
  exception, it still names what was attempted and what to do.

### REL-48 · M2 · major · P4
**A failed attachment delete does not remove the tile.**
- The tile stays in the grid.
- The message names the file and the reason (permission, in use,
  missing).
- If the file was already gone, the message says so and the tile is
  removed on refresh.

### REL-49 · M2 · major · P4 P6
**An unreadable attachments directory degrades the section only.**
- The Attachments section shows an error naming the directory and the
  reason.
- Relationships, comments, activity, and the meta panel still render.
- A retry action is offered.

### REL-50 · M2 · minor · P4
**A download of a since-deleted attachment fails with a named
reason.** Delete the file from disk, then click the tile.
- The user is told the file is no longer on disk, by name.
- The browser does not silently download a zero-byte file.
- Refreshing removes the stale tile.

### REL-51 · M2 · major · P8
**Each relationship group header uses the side's own directional label —
the label of the edges shown under it, not its inverse.**
- On an epic, the group of its children is headed by the **child-side**
  label ("Child" / "Children"); on a child, the group holding its parent
  is headed by the **parent-side** label ("Parent") — the header names
  what the listed tasks ARE to the current task.
- This holds for a structural pair (`parent`/`child`, distinct `label` /
  `inverse_label` in `workflow.yaml`) exactly as it already does for a
  non-structural directional pair like `blocks` ("Is blocked by" reads
  correctly today).
- The bug being fixed: the structural group picks the label from the
  wrong side, so children show under "Parent" and the parent under
  "Child" (UX-8, ux §4.2).
- A connective form ("Blocked by…", "Parent of…") is permitted but not
  required; the required property is that the side is correct and
  consistent across all relationship types.
