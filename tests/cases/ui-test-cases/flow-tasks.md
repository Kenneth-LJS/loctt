# Task detail flow

The task detail route at `/tasks/$key` — the read shell, inline meta
panel editing for every field, the markdown body editor, and the
destructive/lifecycle actions in the "More" menu (duplicate, move,
delete, archive). Comments and the activity feed live in
[flow-comments-activity.md](flow-comments-activity.md); relationships
and attachments in [flow-relationships.md](flow-relationships.md); the
create modal in [flow-task-create.md](flow-task-create.md). Getting
here from the table is [flow-list.md](flow-list.md).

## A. Happy path

### TSK-1 · M2 · blocker · P2 P3
**The route resolves a task by its user-facing key and renders the read
shell.** Navigate to `/tasks/WEB-7`.

- The header shows the breadcrumb (All tasks › the task's project
  label), the task title, and a chip carrying the key `WEB-7`.
- The project in the breadcrumb is the project's `label`, not its slug
  `key` or `prefix`; clicking it returns to the list filtered to that
  project.
- The ULID `id` is not displayed anywhere in the header.
- Layout is two columns: description/related/attachments/activity/
  comments on the left, the meta panel on the right.
- Pasting the URL cold in a new tab produces the identical view — no
  state carried from the list is required to render.

### TSK-2 · M2 · major · P2 P10
**A task reached by a retired key still resolves.** Task whose
`key_history` contains `WEB-3` after a sync rekey to `WEB-41`.

- `/tasks/WEB-3` resolves to the same task, so old links keep working.
- The header chip shows the *current* key `WEB-41`, not the one used to
  navigate — the UI never implies the retired key is current.
- The URL is normalized to the current key, or the page indicates the
  key was retired; either way the user can tell which key is live.

### TSK-3 · M2 · major · P1 P8
**Opening a task records it in "Recently viewed".** Open a task not
previously visited.

- The sidebar's Recently viewed group gains this task without a page
  reload.
- The recent is pushed **once per mount** — navigating within the same
  task (switching to the activity tab, editing a field) does not push
  duplicate entries.
- Navigating away and back pushes again and re-orders the entry to the
  top rather than creating a second row for the same task.
- The entry is stored per-user; switching users shows that user's own
  recents.

### TSK-4 · M2 · blocker · P3 P8
**Status can be changed inline from the meta panel.** Click the status
row.

- The dropdown lists every status from `workflow.yaml` by `label`, in
  configured order — not a hardcoded To Do / In Progress / Done.
- Picking one updates the displayed value immediately (optimistic),
  before the request settles.
- After the request settles the value persists across a page reload,
  confirming it reached `task.md` on disk.
- The stored value is the config `key` (`in_progress`), verifiable by
  reading the file — the display label is never what lands in
  frontmatter.
- No full page load or modal is required.

### TSK-5 · M2 · blocker · P3
**Moving into a completed-category status sets the read-only completed
date.** Set status to one whose `category` is `completed`.

- A completed date appears, populated automatically.
- The completed date row has no edit affordance — clicking it does not
  open an input.
- Moving the status back out of the completed category clears the
  completed date.
- The behaviour keys off the status's `category`, not off a hardcoded
  status named "done": a custom status in the `completed` category
  triggers it too.

### TSK-6 · M2 · blocker · P3
**Priority and type edit inline against the configured vocabulary.**

- Both dropdowns render config `label`s in config order and store
  `key`s.
- A workflow with seven priorities renders all seven; the panel does
  not assume three or clip the list.
- Changes survive reload.

### TSK-7 · M2 · blocker · P3
**Assignee and reporter use a user picker that marks archived users.**

- The picker lists active users by display name from `profile.yaml`.
- Archived users appear greyed with an "(archived)" suffix and cannot
  be selected as a *new* value.
- A task already assigned to an archived user keeps displaying that
  user's name with the marker — historical attribution is preserved.
- Where two users share a display name, the picker disambiguates (e.g.
  with a truncated id), since names are not unique.
- The stored value is the user's ULID, not their name.

### TSK-8 · M2 · blocker · P1
**Start and due dates edit inline and respect the workspace calendar.**

- Each opens a date input; non-working days per `calendar.yaml` are
  visually marked.
- The stored value is a plain date string; reloading shows the same
  calendar date regardless of the browser's timezone.
- Clearing a date removes the field rather than storing an empty string
  or today's date.
- Setting a start date later than the due date is either prevented or
  flagged — it does not save silently as though valid.

### TSK-9 · M2 · major · P3
**Estimate renders with the configured estimation mode.**

- With numeric estimation, the input accepts a number and displays the
  `unit_label` suffix (e.g. "5 points").
- With `custom_enum` estimation, the control is a picker constrained to
  `preset_values`, not a free-text box.
- With `estimation.enabled: false`, the estimate row is absent from the
  panel entirely rather than shown empty.

### TSK-10 · M2 · blocker · P3
**Milestone and sprint edit inline from their config lists.**

- Dropdowns list entries from `milestones.yaml` / `sprints.yaml` by
  label, excluding archived ones from new selection.
- Selecting writes the entry's key; clearing removes the field.
- A task already referencing an archived milestone keeps showing it
  with a marker rather than rendering blank.

### TSK-11 · M2 · blocker · P8
**Labels edit as multi-tag with inline creation.**

- Existing labels appear as coloured pills matching `labels.yaml`
  colours.
- Typing a name not yet defined offers "Create label"; accepting it
  writes the new label to `labels.yaml` and attaches it in one flow,
  without leaving the task.
- Removing a pill detaches the label from the task but does **not**
  delete it from `labels.yaml` — verified by the label still being
  offered on another task.
- The new label is immediately available in the list view's Label
  filter.

### TSK-12 · M2 · blocker · P3
**Custom fields render the control implied by their declared type.**
Workflow declaring a string, number, date, boolean, and enum field.

- `string` → text input; `number` → numeric input rejecting
  non-numeric text; `date` → date picker; `boolean` → a two-state
  control; `enum` → picker constrained to declared `values`.
- A field declared `multi: true` accepts multiple values; one declared
  `multi: false` replaces rather than appends.
- Values are written under `fields:` in frontmatter, not as top-level
  keys.
- Fields scoped to a task type appear only for tasks of that type, and
  changing the type updates the visible field set without a reload.

### TSK-13 · M2 · major · P8
**Optimistic updates apply instantly and settle silently.** Change
several fields in succession.

- Each change is reflected in the panel before the network settles.
- On success there is no visible flicker back to the old value and then
  forward again.
- The footer's updated timestamp refreshes to reflect the write.

### TSK-14 · M2 · major · P1
**The footer shows created/updated times and any key history.**

- Created and updated render as relative times with the absolute
  timestamp available on hover.
- A task with `key_history` shows the prior keys, labelled as previous
  keys so they are not mistaken for the current one.
- A task with no `key_history` shows no such row at all — not an empty
  "Previous keys:" label.

### TSK-15 · M2 · blocker · P8
**The body editor saves after 1.5s idle and on blur.** Type a paragraph
into the rich editor and stop.

- Approximately 1.5s after the last keystroke, one save fires — not one
  per keystroke.
- Clicking outside the editor before the idle timer elapses saves
  immediately rather than waiting.
- A save indicator communicates saved / saving / unsaved so the user
  is never guessing.
- Reloading the page shows the typed content, confirming it reached
  `task.md`.

### TSK-16 · M2 · major · P1
**Rapid edits coalesce into one history entry.** Type continuously for
30 seconds with several idle-save flushes.

- The activity feed shows a single coalesced `body_edited` entry for
  the burst, not one per auto-save.
- The final stored body matches exactly what is on screen.

### TSK-17 · M2 · blocker · P10
**The mode toggle preserves content between rich and raw markdown.**
Write formatted content in TipTap, toggle to CodeMirror.

- The raw view shows the markdown source for exactly what was rendered
  (headings as `#`, bold as `**`).
- Editing the raw source and toggling back renders the change.
- Round-tripping rich → raw → rich without edits leaves the stored body
  byte-identical — the toggle must not silently reformat or reorder
  markdown.
- What is stored is what was typed in raw mode; the editor does not
  normalize the user's markdown against their will.

### TSK-18 · M2 · major · P8
**The toolbar applies formatting to the selection.**

- Bold, italic, code, code-block, link, list, heading, and blockquote
  each apply to the current selection and are reflected in the raw
  markdown after toggling modes.
- Toolbar buttons show active state when the caret is inside that
  formatting.
- Applying a link prompts for a URL rather than inserting an empty
  anchor.

### TSK-19 · M2 · major · P8
**"Copy key" and "Copy link" put the right things on the clipboard.**

- Copy key yields the bare current key (`WEB-7`), with no URL, prefix
  noise, or surrounding whitespace.
- Copy link yields an absolute URL that, pasted into a new tab, opens
  this task.
- Both give visible confirmation that the copy happened.

### TSK-20 · M2 · blocker · P5
**Duplicate creates a new task and navigates to it.**

- A new task is created with a newly allocated key from the project's
  counter — never a reused or duplicate key.
- Title, body, and metadata are copied; `created_at`/`updated_at` are
  fresh; `key_history` is empty on the copy.
- The app navigates to the new task, and the header key differs from
  the original.
- The original is unmodified — verified by returning to it.

### TSK-21 · M2 · blocker · P5 P10
**Move to project reassigns the task and its key.**

- The picker lists non-archived projects, excluding the current one.
- After moving, the task's project shows the new project and the key
  reflects the new project's prefix.
- The previous key is appended to `key_history`, and the old key still
  resolves via `/tasks/<old-key>` (per TSK-2).
- The new key is allocated from the destination project's counter and
  does not collide with any existing task.

### TSK-22 · M2 · blocker · P5
**Delete requires typing the key and is permanent.**

- The dialog states the task key and that deletion is permanent and
  cannot be undone, and distinguishes itself from archive.
- The confirm button stays disabled until the exact key is typed;
  a near-miss (wrong case, trailing space, the title instead of the
  key) does not enable it.
- Default focus is on the text input or cancel — never on the
  destructive button, so Enter alone cannot delete.
- `Esc` cancels with nothing deleted.
- On confirm the task is removed from disk and the app navigates away
  to the list; the task is gone from the list, not merely hidden.

### TSK-23 · M2 · blocker · P5 P10
**Archive is immediate, reversible, and distinct from delete.**

- Archive requires no typed confirmation — it is reversible.
- The task gains a visible archived badge in the header immediately.
- The task disappears from the default list view but appears with
  "Show archived" on (see [LST-12](flow-list.md)).
- Unarchive from the same menu restores it in place, with the badge
  removed and the task back in default list results.
- Archiving sets the archived flag; it never removes the task
  directory from disk.

## B. Edge cases

### B.1 — Content shape and scale

### TSK-24 · M2 · major · P9
**A 400-character title with no spaces renders without breaking the
header.** Hand-edited long title.

- The title wraps or truncates within the header; the meta panel and
  two-column layout retain their widths.
- No horizontal scrollbar appears on the page body.
- The full title is recoverable (hover, or the title edit control).

### TSK-25 · M2 · minor · P9
**RTL, CJK, and emoji clusters render correctly in title and body.**

- An RTL title renders right-to-left without flipping the surrounding
  layout or the meta panel to the other side.
- A family-emoji ZWJ sequence in the body survives a rich → raw → rich
  round trip intact, not split into component codepoints.
- Backspace over such a cluster in the editor removes the whole
  grapheme, not one codepoint leaving a mangled remnant.

### TSK-26 · M2 · major · P9
**25 labels on one task do not break the meta panel.**

- The label row wraps within the panel width rather than overflowing or
  pushing later rows off-screen.
- All 25 remain individually removable.
- The panel remains scrollable and every field below labels is still
  reachable.

### TSK-27 · M2 · minor · P9
**A very large body loads and edits without freezing.** A body of
several thousand lines.

- The editor becomes interactive without a multi-second freeze.
- Typing at the bottom does not lag noticeably or scroll-jump to the
  top.
- Auto-save still fires once per idle window rather than repeatedly
  re-sending the whole document per keystroke.

### TSK-28 · M2 · minor · P9
**Dates in 1970 and 2099 are accepted and displayed.**

- A due date of `1970-01-01` displays as that date, not as an epoch
  zero or "no date".
- `2099-12-31` is accepted by the date input rather than clamped to a
  nearer year.
- Both round-trip through a reload unchanged.

### B.2 — Config drift

### TSK-29 · M2 · blocker · P7 P3
**A status deleted from `workflow.yaml` while this task references it
is shown, not blanked.** Remove the task's status from config.

- The meta panel shows the raw stored key marked as unrecognized, with
  an explanation pointing at `workflow.yaml`.
- Opening the status dropdown offers the currently valid statuses, and
  choosing one repairs the task.
- The unknown value is not silently rewritten to the first valid status
  on load — the file is not modified until the user acts.
- Editing an unrelated field (e.g. priority) does not clobber the
  unknown status as a side effect.

### TSK-30 · M2 · major · P7
**An enum custom field whose stored value is no longer declared
degrades visibly.** `fields.team: platform` where `platform` was
removed from `values`.

- The value renders flagged as unrecognized rather than blank or
  silently dropped.
- The picker offers the currently declared values; the file retains the
  old value until the user changes it.

### TSK-31 · M2 · major · P7
**A custom field whose declared type changed under a stored value is
handled.** A field declared `number` now holding a string from an
earlier `string` declaration.

- The panel surfaces the mismatch rather than rendering `NaN` or an
  empty numeric input that would silently overwrite on next save.
- The user is told which field and what is expected.

### TSK-32 · M2 · minor · P1
**Unknown top-level frontmatter keys survive an edit.** Task carrying
an experimental key.

- The key does not get a normal editable field row (it is not treated as
  a known task field); it is surfaced instead in DEG-7's read-only "Not
  recognised" group, with a remove control. *(Revised: the original bullet
  "the panel ignores the key and does not invent a row for it" predates
  the degradation framework and contradicts DEG-7, which — major, and
  reflecting Ken's P7/K26/K27 "surface preserved-but-unknown fields, never
  silently hide them" direction — requires the key be shown. DEG-7
  supersedes it; see decisions.md A179.)*
- After editing status from the UI, re-reading `task.md` shows the
  experimental key still present with its original value (the P1/P7
  data-loss guard — unchanged and the point of this case).

### TSK-33 · M2 · major · P7
**A reference to an archived entity is preserved on unrelated edits.**
Task assigned to an archived user and pointing at an archived
milestone.

- Both render with archived markers.
- Editing priority does not strip or reset either reference.
- Attempting to set a *new* archived reference is rejected by the
  archived-reference guard with a message naming the entity and that it
  is archived (see also [TSK-46](#tsk-46--m2--blocker--p4-p7)).

### B.3 — Concurrency and races

### TSK-34 · M2 · blocker · P1
**A field changed in the CLI while the detail view is open does not get
clobbered.** Change the status via CLI, then change priority in the UI.

- After refetch the panel shows the CLI's status.
- Saving priority from the UI writes priority only — the CLI's status
  change survives, verified on disk.
- The UI never sends a whole-frontmatter overwrite built from its stale
  snapshot.

### TSK-35 · M2 · blocker · P1
**A body edited elsewhere is not silently overwritten.** Append a
paragraph to the body via CLI while the UI editor has unsaved changes.

- On save the UI does not blindly replace the file with its own buffer.
- Either the two are merged append-friendly, or a conflict is presented
  showing both versions and asking which to keep.
- Whichever path is taken, no version of the text is lost without the
  user being shown it and choosing.
- Choosing "keep mine" or "keep theirs" produces exactly that content
  on disk.

### TSK-36 · M2 · major · P1
**Two tabs on the same task converge rather than fight.** Open the task
twice; change status in tab A.

- Tab B reflects the change after refetch rather than continuing to
  show and act on the old value.
- Changing a different field in tab B afterwards does not revert tab A's
  status change.

### TSK-37 · M2 · major · P8
**Rapid successive changes to the same field settle on the last one.**
Click through three statuses quickly.

- The panel ends on the third status, and the file ends on the third
  status — an earlier response arriving late must not repaint the panel
  with a superseded value.
- The activity feed does not misreport the final state.
- No request is left in flight that would later overwrite the settled
  value.

### TSK-38 · M2 · major · P1
**An in-flight body save followed by a newer edit does not resurrect
old text.** Type, let a save start, then type more before it settles.

- The final stored body includes the later keystrokes.
- The editor does not snap back to the earlier saved text when the
  first response lands.
- The save indicator does not read "saved" while newer unsaved
  keystrokes exist.

### TSK-39 · M2 · major · P1 P5
**A task deleted underneath an open detail view is reported.**
Hard-delete the open task from the CLI.

- On the next refetch or the next attempted edit, the view states that
  the task no longer exists, naming the key.
- The user is not left editing a phantom; further edits are prevented
  rather than failing one-by-one.
- A route back to the list is offered.

### TSK-40 · M2 · minor · P1
**Navigating between two tasks does not leak state.** Open task A, edit
its body, navigate to task B.

- Task A's pending body edit is flushed or the user is warned before
  leaving — it is not silently discarded.
- Task B's editor shows task B's body, never A's buffered content.
- The meta panel fully re-renders for B; no field retains A's value.

### B.4 — Editing affordances

### TSK-41 · M2 · minor · P8
**Escape cancels an inline edit without saving.** Open the status
dropdown, then press `Esc`.

- The dropdown closes and the original value remains.
- No request is sent.
- Focus returns to the field's trigger so keyboard navigation
  continues.

### TSK-42 · M2 · minor · P8
**Clearing an optional field removes it rather than storing an empty
value.** Clear assignee, milestone, and a string custom field.

- Each row returns to its unset presentation.
- The key is absent from frontmatter afterwards, not present with an
  empty string or `null`.
- The list view's corresponding column shows an empty cell for this
  task.

### TSK-43 · M2 · minor · P10
**Key and key history are not editable from the UI.**

- Neither the key chip nor the key-history footer offers an edit
  affordance.
- No path through the panel or the More menu allows changing `key` or
  `key_history` directly — they are immutable across all surfaces, and
  only Move-to-project (TSK-21) changes a key.

### TSK-44 · M2 · minor · P5
**Cancelling a destructive dialog leaves nothing changed.** Open Delete
and Move dialogs, then dismiss each.

- The task is unchanged after each dismissal.
- Dismissal works by both Cancel and `Esc`.
- Reopening the dialog starts fresh — a previously typed confirmation
  string is not retained.

## C. Error cases

### TSK-45 · M2 · blocker · P4 P6
**An unknown key renders a "not found" state, not a blank pane.**
Navigate to `/tasks/WEB-99999` where no such key or retired key exists.

- The page names the key that was not found and states that no task
  (or retired key) matches it.
- It offers a way back to the list.
- It is distinguishable from a loading state and from a server error —
  a 404 must not be presented the same way as an unreachable backend.
- The breadcrumb and meta panel are not rendered empty as though a task
  had loaded.

### TSK-46 · M2 · blocker · P4 P7
**Assigning an archived user is rejected with a specific reason.** Try
to set an archived user as assignee via a stale picker or a race with
an archive happening elsewhere.

- The save is rejected and the panel reverts to the previous value —
  the optimistic update does not stay on screen implying success.
- The message names the user, says they are archived, and states that
  archived entities cannot be newly referenced.
- The task's existing values are untouched.

### TSK-47 · M2 · blocker · P4
**A failed field save rolls back visibly and explains itself.** Fail
the status write.

- The panel reverts to the prior status rather than keeping the
  optimistic value — a failed save must never look like it succeeded.
- An error names the field, the reason, and offers retry.
- The footer's updated timestamp does not advance.
- Reloading confirms the file still holds the old status.

### TSK-48 · M2 · blocker · P4
**A failed body auto-save never shows "saved".** Fail the body write
after an idle flush.

- The indicator moves to an explicit unsaved/failed state, not "saved"
  and not back to idle.
- The message states the body was not saved and what to do (retry, or
  copy the text out).
- The typed content stays in the editor — it is not reverted to the
  last-saved version, which would destroy the user's writing.
- Leaving the page warns that unsaved changes exist.

### TSK-49 · M2 · major · P4
**A validation failure on a custom field names the field and the
constraint.** Enter text into a `number` custom field, or a value
outside a declared enum.

- The error appears at the field, not as a detached toast.
- It states the field's label and what is acceptable ("Story points
  must be a number").
- The invalid value is not written to disk, and the field retains the
  user's input so it can be corrected rather than being wiped.

### TSK-50 · M2 · blocker · P4 P5
**A failed delete leaves the task intact and says so.** Fail the delete
request after confirmation.

- The message states that the task was **not** deleted and why.
- The user is not navigated away as though deletion had succeeded.
- The task is still present in the list afterwards.
- The dialog either stays open for retry or can be reopened without the
  typed confirmation being pre-filled.

### TSK-51 · M2 · major · P4 P5
**A failed move to project does not leave a half-moved task.** Fail the
move.

- The task retains its original project and its original key.
- `key_history` does not gain an entry for a key that was never
  allocated.
- The message names the destination project and the reason the move
  failed.

### TSK-52 · M2 · major · P4 P5
**A failed archive does not show the archived badge.** Fail the archive
write.

- The badge does not appear, and the More menu still offers Archive
  (not Unarchive).
- The message names the failure and offers retry.
- The task still appears in the default list view.

### TSK-53 · M2 · major · P4 P6
**An unreachable server on the detail route is distinct from a missing
task.** Stop the server and load `/tasks/WEB-7`.

- The state names that the task could not be loaded because the LocTT
  server is unreachable, and suggests checking the `loctt ui` process.
- It does not read "Task not found", which would falsely imply the task
  was deleted.
- Retry re-issues the request and renders the task on success without a
  manual reload.

### TSK-54 · M2 · major · P4 P6
**A corrupt `task.md` is reported with its location.** Hand-edit the
open task's frontmatter to be unparseable.

- The detail view states that the task file could not be parsed and
  gives the path under `.loctt/tasks/<id>/`.
- The parse error is described in terms the user can act on (which line
  or which field), not as a raw stack trace.
- The body is not offered for editing over a file that cannot be
  parsed, which would risk overwriting the broken-but-recoverable
  frontmatter.

### TSK-55 · M2 · minor · P4
**Inline label creation failing does not attach a phantom label.** Fail
the label-create write.

- No pill is left attached to the task.
- The message states the label was not created and why.
- The label does not appear in other pickers or in the list view's
  Label filter afterwards.

### TSK-56 · M2 · minor · P4
**A save blocked by an in-progress schema migration is explained.**
Attempt a field edit while the migration lock is held.

- The failure states that the tracker is being migrated and that the
  change was not saved.
- The optimistic value is rolled back.
- The user is told to wait for the migration to finish rather than
  being shown a generic error.

### TSK-58 · M2 · minor · P8
**Duplicate and Move are reachable from the task-detail UI, not CLI/MCP-only.** Open a task's "More" menu on `/tasks/<key>`.

- The menu offers both **Duplicate** and **Move to project…**, so a mouse/keyboard user can reach the core Duplicate (TSK-20) and Move (TSK-44) capabilities without dropping to the CLI. A capability that exists in core/CLI/MCP but has no UI entry point is the reachability gap this case exists to close.
- Duplicate takes archive-level friction (no typed confirmation — it destroys nothing), and Move opens the destination picker; the detailed behavior of each is TSK-20 and TSK-44 respectively, which this case does not restate.
- Scope note: these are the *only* two core task verbs that were UI-unreachable; everything else (create, edit, archive, delete, link, attach) already has an affordance.

### TSK-59 · M2 · major · P3 P8
**The heading control offers every level, not just H2.** The
description/comment toolbar exposes a level picker (Paragraph, H1…H6).

- Selecting a level applies it (`setHeading({level})` / `setParagraph()`).
- The control shows the current block's level.
- Each level round-trips through save+reload (`#`×level serialised,
  `#{1,6}` parsed).

### TSK-60 · M2 · major · P8
**Applying a block type to a whole-paragraph selection leaves the caret
in the transformed block.** The control reflects the new state
immediately.

- Repeated toggles do not accumulate trailing empty blocks.

### TSK-61 · M2 · major · P3
**An ordered-list button exists and round-trips.** The toolbar can
create an ordered list (`1.` items); `fromMarkdown`/`toMarkdown` already
support it.

### TSK-62 · M2 · minor · P8
**The rich editor shows a placeholder when empty.** It matches the raw
CodeMirror editor's "Describe this task…", so an empty rich editor does
not read as broken/blank.

### TSK-63 · M2 · major · P1 P8
**Pasting markdown into the rich editor parses it, not inserts it as
literal text.** Pasting `# Heading\n\n- item\n- item` yields a heading +
list, not three literal paragraphs.

### TSK-64 · M2 · minor · P8
**The description toolbar is collapsed in view mode** and appears only
when the field is focused/edited. **(Superseded by TSK-68 (K33).)**

- No format button renders in an active state while merely viewing.

> **Superseded by TSK-68 (K33, Ken 2026-09-09.)** K33's read-then-edit
> model makes the whole description surface read-only until entered, so
> the toolbar no longer merely collapses — it is absent in the rendered
> view entirely. Kept here for the case history; TSK-68 is the governing
> case.

### TSK-65 · M2 · minor · P8
**Strikethrough / superscript / subscript / math / mention have toolbar
buttons in rich mode, or the flow doc scopes them out.** *(scope-call,
ED-1)* These marks/nodes round-trip already; only the toolbar affordance
is missing.

### TSK-66 · M2 · minor · P7
**A GFM pipe-table in the body is either parsed to a table or forces raw
mode via lossy-content detection — never shown as literal paragraph
text.** *(ED-2)*

### TSK-67 · M2 · minor · P8
**The description and comment editors carry distinct test-ids so the DOM
is unambiguous.** *(ED-3, test-hygiene)* Both are `rich-editor` today.

### C.1 — K33 description read-then-edit (Ken, 2026-09-09)

K33 is the Jira-style read-then-edit model for the task description — a
scope addition, not a fix. TSK-68 supersedes TSK-64's toolbar-collapse.

### TSK-68 · M2 · major · P1 P8
**The description renders read-only by default, not as a live editor.**
On opening a task with a body.

- The description shows as formatted output (headings/lists/links/images
  rendered) with **no toolbar and no editable field** — the same
  read-only renderer comments use.
- An empty body shows the placeholder in the same read state.
- Supersedes TSK-64 (toolbar no longer merely collapses — the whole
  surface is read-only until entered).

### TSK-69 · M2 · major · P1 P8
**An explicit edit affordance on the description enters edit mode.**

- Activating the description's edit control swaps the rendered view for
  the editor (rich editor + toolbar, the existing `BodyEditor`), ready to
  type.
- The raw/rich toggle is available here, inside edit mode, and only here.

> **Re-titled (A247, 2026-09-22).** This case read "clicking anywhere on
> the rendered description text enters edit mode". A247 removed that
> gesture deliberately: a click target wrapping the rendered body also
> wraps its links and images, which is a nested-interactive violation
> (WCAG 4.1.2) and made TSK-70's "a link opens, and does not enter edit"
> a contradiction to resolve at runtime. The edit route is now an
> explicit control, so the case asserts that instead — the coverage
> (edit mode is reachable, and the raw/rich toggle lives inside it) is
> unchanged.

### TSK-70 · M2 · major · P4 P8
**In the rendered view, a link opens and an image opens — neither enters
edit mode.**

- Clicking a link in the rendered description opens its URL in a new tab
  (`target=_blank rel=noreferrer noopener`, unsafe schemes refused as in
  comments).
- Clicking an image opens it in a lightbox.
- Neither switches to edit mode. (In edit mode these are ordinary
  editable content.)

### TSK-71 · M2 · minor · P8
**Leaving edit mode returns to the rendered view; the body is saved, not
lost.**

- Clicking away (blur) flushes the existing idle autosave (TSK-15/K2) and
  returns to the rendered view showing the saved content.
- Pressing Escape cancels the edit and returns to the rendered view
  showing the last-saved content.
- Nothing is silently lost, and a failed save keeps the editor open in
  its unsaved state (TSK-48), not dropped back to a stale render.
