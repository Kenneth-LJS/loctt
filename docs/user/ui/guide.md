# Web UI guide

The web UI is a local app for browsing and managing your tracker. Start it
with `loctt ui`; it serves on `http://localhost:<port>` and reads the same
`.loctt/` directory the CLI and MCP server use.

Screenshots below are marked with placeholders and captured against a
representative tracker.

## The shell

Every screen sits inside a fixed shell: a top header, a left sidebar, and
the main content area.

### Header

Left to right, the header holds:

- **Sidebar toggle** — collapse the sidebar to an icon rail or expand it.
- **Brand** — the LocTT mark and wordmark.
- **Search** — type to search tasks by key or title; a dropdown shows
  matches, Enter opens the List filtered by your query. Press `/` anywhere
  to jump to it.
- **Theme** — a Light / Dark / System switch. System follows your OS
  preference.
- **New task** — opens the create dialog from anywhere.
- **User menu** — the current user; switch users, and jump to your
  profile, preferences, sidebar customization, or Settings.

An integrity badge appears in the header only when the tracker has a
data-integrity problem to look at; a healthy tracker shows nothing there.

<!-- [screenshot: the header with the search dropdown open showing task hits] -->

### Sidebar

The sidebar is your navigation. Its groups render in the order you choose,
and any group you hide is omitted. On a narrow window it becomes a slide-in
drawer; on desktop you can drag its right edge to resize it.

Groups:

- **Views** — List, Board, Timeline. Switching between them carries your
  current filters across.
- **Projects** — "All projects" plus a row per project (the default is
  marked). A search box appears when you have many.
- **Saved filters** — built-in filters with live counts (Assigned to me,
  Reported by me, Mentions me, Due this week, Overdue, High priority), then
  your saved views, then any view whose query no longer parses (marked,
  still openable). "+ New filter" opens the view builder.
- **Milestones**, **Sprints**, **Labels** — rows that filter the List to
  one milestone, sprint, or label.
- **Recently viewed** — the tasks you opened most recently.

Each row's kebab (⋯) menu holds its actions — edit, pin, archive, and a
link to the Settings section that manages it.

The footer pins a **Settings** link so it never scrolls away.

<!-- [screenshot: the expanded sidebar showing all groups] -->
<!-- [screenshot: a saved-filter row with its kebab menu open] -->

## Views

List, Board, and Timeline show the same tasks through the same filters —
they differ only in how they present them.

### List

The default view: a sortable, paginated table.

- **Columns** — key, project, title, status, type, priority, assignee,
  reporter, labels, due date, estimate, and last-updated. Click a header to
  sort. Which columns show is a personal preference (Settings → Card
  layout does not apply here; column choice lives in your settings).
- **Rows** open the task; a label in a cell filters the List to that label.
- **Pagination** — "Load more" appends the next page.
- **Bulk actions** — select rows with the checkboxes to reveal a bar for
  setting a field, moving projects, archiving (with Undo), or deleting
  across the selection.

On a phone-width screen the table becomes stacked cards.

<!-- [screenshot: the List with active filter chips and the filter bar] -->
<!-- [screenshot: the bulk action bar with rows selected] -->

#### The filter bar

The filter bar sits above List, Board, and Timeline.

- **Filters** — a dropdown per facet: Project, Status, Priority, Type,
  Assignee, Reporter, Label, Milestone, Sprint, and any custom enum field.
  "+ Add filter" is a searchable picker; when a facet has many options its
  dropdown is searchable too.
- **Active filters** appear as chips below the bar, each removable, with
  "Clear all". A free-text query and an active saved view each show their
  own chip — click it to open the advanced editor.
- **View actions** — "Save as view", as a star button at the right of the
  toolbar. The board adds a "⋯" beside it for its column and card-layout
  settings.

  There is no CSV/JSON export in the web UI: an export is a report for a
  spreadsheet, and it lives on the CLI (`loctt export`) and the
  `export_tasks` MCP tool. Settings → Backup & restore is the web
  surface for taking a copy you can restore from.
- **Advanced query** — reached from the Add-filter menu, a visual builder
  with a raw query-language toggle for anything the facets don't cover.

On a narrow screen the filters collapse into a "Filters" button that opens
a bottom sheet.

### Board

A Kanban board with one column per status, driven by the same filters as
the List.

- Each column shows its count and any WIP limit, with an over-limit marker.
- The chips bar above the board toggles individual columns on and off.
- **Drag a card** between columns to change its status, or within a column
  to reorder it. You can also move a card with the keyboard.
- A column's kebab hides it, sets a WIP limit, or jumps to Board columns
  settings. If your statuses and columns drift apart, a banner links you to
  the fix.

<!-- [screenshot: the Board with columns, counts, and a WIP-over column] -->
<!-- [screenshot: a card mid-drag with the drop indicator] -->

### Timeline

A schedule view of dated tasks, again on the same filters.

- **Zoom** between Day, Week, and Month.
- **Group by** a field — status, assignee, priority, milestone, sprint, or
  a single-value custom field — to band the chart.
- **Dependencies** draws arrows between linked tasks (when a dependency
  relationship is configured).
- **Today** centers the chart on the current date; weekends and holidays
  are shaded.
- **Drag a bar** to move it, or its edges to change the start or due date.
- Tasks without dates collect in the **Unscheduled** drawer, which opens
  on its own when nothing is scheduled yet.

<!-- [screenshot: the Timeline with grouped bands, dependency arrows, and the today marker] -->
<!-- [screenshot: the unscheduled drawer expanded] -->

### Sprints and milestones

The **Sprints** and **Milestones** sidebar rows open their own overview
pages. The sprints overview lists your sprints; opening one shows its
tasks and a **burndown** chart. The milestones overview shows each
milestone's progress toward its target date. Both pages use the same
filter bar as the List, and their sidebar rows also filter the List to a
single sprint or milestone.

## Task detail

Opening a task shows everything about it on one page.

- **Header** — a breadcrumb, the task's key, its title (editable in place),
  and a More menu: copy the key or a link, duplicate, move to another
  project, archive, or delete.
- **Description** — a markdown editor with autosave and `@`-mentions of
  users.
- **Related** — the task's relationships (blocks, parent/child, and any you
  configure); add and remove links here.
- **Attachments** — files on the task; upload more.
- **Comments / Activity / All** — a tabbed lane. Comments has a composer
  and the discussion; Activity shows the change history.
- **Details panel** — every field as an inline editor: status, type,
  priority, project, assignee (with "Assign to me"), reporter, labels,
  milestone, sprint, start and due dates, estimate. Pickers search as you
  type.

<!-- [screenshot: a task detail page — header, description, and details panel] -->
<!-- [screenshot: the Comments / Activity / All tab strip with a comment] -->

## Creating a task

**New task** (in the header, on the board, or the `n` shortcut) opens one
dialog. It carries the workflow defaults for status, priority, and type,
defaults the reporter to you, and validates start/due dates against each
other and the working calendar. "Create another" keeps the dialog open with
your project and type, for entering several in a row.

<!-- [screenshot: the create-task dialog with fields populated] -->

## Settings

Settings is a grouped set of panels, reached from the sidebar footer or the
user menu. A bare `/settings` opens Projects. The groups:

- **Content** — the things you make: Projects, Saved views, Labels,
  Milestones, Sprints.
- **Workflow** — how tasks are shaped and shown: Statuses, Priorities,
  Task types, Custom fields, Relationships, Estimation, Board columns (and
  WIP limits), Timeline defaults, Calendar (timezone, working days,
  holidays).
- **Personal** — My preferences (theme, default project), Card layout,
  Pinned views, Sidebar groups, Keyboard.
- **System** — Users, Sync (git-backed mode), Archived, Backup & restore,
  Diagnostics.

Most concepts are also reachable from where you use them: a sidebar row's
kebab, a board column's menu, or an error banner will deep-link to the exact
Settings panel that owns it, so you rarely have to hunt.

### Archived

Archiving takes an item out of every list, board, timeline, picker and
settings panel. **Settings → Archived** is the one place you can still see
archived items. Pick a type (tasks, projects, saved views, labels,
milestones, sprints or users) to see its archived items, then restore or
delete one, a selection, or all of them. Restoring puts an item back where
it was. Deleting is permanent and asks you to confirm. Deleting several
items at once also removes them from any tasks that still use them.

An archived task is still reachable by a direct link to it, and its page
says it is archived.

### Diagnostics

Settings → Diagnostics checks this tracker's files, config and index for
problems and reports what it finds. It runs the same checks as
`loctt doctor` on the command line, so you can use whichever is closer to
hand — the results are the same.

**A note on filesystem safety.** LocTT's file locks are POSIX *advisory*
locks, which are not safe on network or sync-service filesystems. If the
tracker sits inside iCloud Drive, Dropbox, OneDrive, or on an NFS/SMB
mount, two machines writing at once can corrupt state.

LocTT warns you at startup when it detects one of these, and names the
directory that triggered it. **That detection is best-effort and can miss
cases** — so seeing no warning is not a guarantee that the filesystem is
safe. If you keep a tracker in a synced folder, avoid editing it from two
machines at the same time regardless of whether LocTT flagged it.

(Both notes used to sit in the Diagnostics panel itself. They moved here
so the panel shows results rather than caveats — the startup warning still
fires when detection does catch a risky location.)

<!-- [screenshot: the Settings shell — grouped nav and a panel such as Board columns] -->

### Backup and restore

Settings → Backup & restore writes a complete tracker backup and restores
one. A restore runs in one of three modes:

- **Bare** — writes only into an empty tracker; refuses one that already
  has tasks.
- **Merge** — adds only the tasks missing here; never edits a task that is
  already present.
- **Overwrite** — replaces any task the backup carries. This can lose
  work, so it is gated behind a typed **OVERWRITE** confirmation; any
  displaced body is kept beside the task and named in the result.

A **dry run** predicts the counts and writes nothing, in any mode, and the
restore reports per-outcome counts plus any key reallocations, renamed
entities, or skipped lines.

A backup taken in split parts is restored here too: select every part
together in the file picker. The panel reads each file's header and shows
which part it is and how many the set expects, so a missing one is visible
before you upload. An incomplete set, a part belonging to a different
backup, the same part twice, or a file that is not a backup is refused
with a message naming what is wrong — and nothing is written. (The CSV or
JSON task export is a report, not a backup — it cannot restore.)

## Keyboard shortcuts

Press `?` for the full list. The global shortcuts:

| Key | Action |
|---|---|
| `n` | New task |
| `/` | Focus search |
| `g` then `l` / `b` / `t` | Go to List / Board / Timeline |
| `[` | Toggle the sidebar |
| `t` | Cycle the theme |
| `?` | Show this list |

Within a board or a dialog, more keys apply — moving a card, closing a
dialog, reordering — and the help dialog lists those too.

## Theming

The Light / Dark / System switch in the header sets your theme; System
follows your operating system. Your choice is remembered across sessions.
