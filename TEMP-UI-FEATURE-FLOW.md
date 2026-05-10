# LocTT UI — Feature Flow (TEMP)

Scratch doc captured during UI design. **Delete this file once the UI
is fully implemented** — it is not permanent documentation.

Only contains decisions confirmed with the user. Open questions are
listed at the bottom — do not invent answers for them.

---

# Data model additions

These are confirmed concepts to add to loctt's data model. Each is a
real design+core+migration project — not pure UI.

## Schema versioning

- New file `.loctt/.schema-version` (committed, single integer).
- On every load (CLI startup, MCP request, web request), core reads
  the version. If lower than the current code's expected version,
  migrations run sequentially (`migrate_v1_to_v2`, ...). Each
  migration lives in `packages/core/src/migrations/` and is atomic
  and idempotent per step.
- Before migrating, core copies `.loctt/` to
  `.loctt.backup-v<old>-<timestamp>/`. User can roll back manually.
- If the version is **higher** than the code expects, all surfaces
  fail with: "This tracker was created by a newer LocTT. Update the
  CLI."
- Single global version — not per-file. Any schema change bumps it.
- `loctt init` writes version `1`. The migration framework is in
  place from day one but unused until the first post-release schema
  change.

## Projects (multiple prefixes within one tracker)

- Single `.loctt/` per repo, but the tracker contains **multiple
  projects** — each with its own key prefix and counter.
- New file `projects.yaml` (committed):
  ```
  projects:
    - { key: <slug>, label: <text>, prefix: <text> }
  ```
  Example: `{ key: backend, prefix: "BACKEND-" }` and
  `{ key: web, prefix: "WEB-" }` coexist.
- `state.yaml#keys` becomes per-project:
  ```
  keys:
    backend: { prefix: "BACKEND-", next_number: 42 }
    web:     { prefix: "WEB-",     next_number: 17 }
  ```
- Tasks gain a `project: <key>` field in frontmatter. Task `key`
  (e.g. `BACKEND-42`) embeds the prefix and remains globally unique
  across the tracker because prefixes differ.
- **Shared across projects:** workflow (statuses, priorities, types,
  relationships, custom fields, estimation, board columns,
  timeline.dependency_relationship), labels, milestones, sprints,
  users, calendar.
- **Cross-project relationships allowed.** `BACKEND-42 blocks WEB-17`
  is valid.
- Query DSL gains `project:<key>` filter. Sidebar gets a Projects
  section listing each project as a click-to-filter shortcut.
- `Settings → Projects`: CRUD panel for project list (key, label,
  prefix). Project `key` is immutable. Prefix is **immutable after
  creation** (changing it would require renaming all existing task
  keys in that project — out of scope).
- Project deletion follows the remap-on-delete pattern: forces
  picking a target project to migrate all affected tasks into (which
  rewrites their `project` field; their `key` stays the same).
- `loctt init` creates one starting project. More added later.
- New surface: `loctt project list/create/edit/delete`,
  matching MCP tools and HTTP endpoints.

### Default project resolution

`loctt create` resolves the target project in this order:

1. `--project <key>` flag, if passed.
2. Per-user default in the active user's `settings.yaml`, if set.
3. Workspace default (`projects.yaml#default: <key>`), if set.
4. Otherwise: fail (CLI/MCP) or force the user to pick (UI).

Settings → Projects shows a "⭐ workspace default" marker. Settings
→ My Preferences exposes an optional per-user override. The UI's
"+ New Task" modal pre-selects the resolved default and remembers
the user's last-used project per session via localStorage as a soft
hint (does not modify the persisted user default).

### Project field is immutable per task

Once created, a task stays in its project. Moving a task across
projects is not supported — recreate the task in the target project
and delete the old. Rationale: `key` embeds the project's prefix,
and re-keying breaks external references (commits, links from other
task bodies, agent context).

## Rank (per-relationship)

- **No global rank.** Ranks live on relationship links, not on tasks.
- Each task's `relationships` entry gains an optional `rank: <lexorank>`.
  When present, this orders the targets of that relationship for that
  source. E.g. parent T-100's children T-101, T-102, T-103 are ordered
  via the ranks stored on T-100's own `relationships` entries.
- workflow.yaml relationship definitions gain optional `ranked: boolean`.
  When true, UI shows drag handles for that relationship type. When
  false (default), no ordering — links display in insertion order.
- Flat list views and timeline do **not** use relationship rank
  (no parent context). They sort by user choice (created, updated,
  due, priority).
- Reorder API: `reorderRelationship({ sourceId, type, targetId,
  before?, after? })` — moves a target within a source's links of
  that type.
- New surface: `loctt rerank <source> <relationship-type> <target>
  [--before <task>] [--after <task>]`, matching MCP tool,
  `POST /api/tasks/:ref/relationships/:type/:target/rerank`.
- **Auto-rebalance:** lexorank strings grow as items are reordered
  between adjacent ranks. The reorder operation transparently
  rebalances the affected window when a computed rank would exceed
  a length threshold. No user-facing rebalance command. Not exposed
  in CLI/MCP.

### Board column rank (separate from relationship rank)

- New optional task field: `board_rank: <lexorank-string>`.
- Used for manual drag-reorder up/down within a board column.
- Independent from relationship rank — relationship rank orders
  targets within a source's links; board rank orders cards within a
  status (or column, if `boards.columns` groups statuses).
- New core function: `reorderBoardRank({ taskId, before?, after? })`.
- New surface: `loctt board-rerank <task> [--before <task>] [--after <task>]`,
  matching MCP tool, `POST /api/tasks/:ref/board-rerank`.
- Within a column, cards sort by `board_rank` ascending; tasks
  without a `board_rank` sort below ranked ones, fallback to created.
- Drag between columns = set status (and assigns a new board_rank
  at the drop position). Drag within column = update board_rank only.
- Auto-rebalance with the same threshold-triggered logic as
  relationship rank. No exposed rebalance command.

## Labels (first-class)

- New file `labels.yaml`: `[{ key, label, color }]`.
- Tasks reference labels by key: `labels: [<key>, ...]`.
- **Explicit creation required.** Setting an unknown label on a task
  fails with guidance to register it first:
  - CLI: `loctt set <task> labels foo` → error if `foo` isn't in
    `labels.yaml`. Message: "unknown label 'foo'. Run
    `loctt label create foo` to register it first."
  - MCP `update_task` with unknown label keys → returns an error
    with the same guidance.
- **UI smooths the friction.** The task detail / create-task /
  bulk-edit label picker shows registered labels with autocomplete.
  When the typed text doesn't match any, an inline "Create label
  '<text>'" option appears at the bottom of the dropdown — clicking
  it opens an inline mini-form (key, label, color), creates the
  label, and applies it to the task in one motion.
- Doctor check: tasks referencing unregistered label keys
  (shouldn't happen post-explicit-creation, but covers manual file
  edits).
- Full CRUD on every surface (CLI, MCP, HTTP).
- Delete-with-remap: same pattern as workflow keys (or just remove
  from tasks; remap is for cases where you want to merge labels).

## Milestones

- New file `milestones.yaml`: `[{ key, label, target_date?, archived? }]`.
- Milestone is a **named checkpoint with optional target date**
  (release marker). Not a time box.
- New optional task field: `milestone: <key> | null`.
- Full CRUD on every surface.
- Archived milestones hide from pickers.

## Sprints (watered-down)

- New file `sprints.yaml`:
  `[{ key, label, start_date, end_date, state: active|completed|future, goal? }]`.
- New optional task field: `sprint: <key> | null`.
- Tasks belong to zero or one sprint.
- **No** start/complete-sprint ceremony. `state` is just a field the
  user edits.
- **No** carryover. Tasks not done at sprint end stay assigned to the
  ended sprint.
- **No** capacity, velocity, or full sprint reports.
- Burndown chart in UI: x = days in sprint window, y = sum of estimates
  of incomplete tasks (or task-count remaining for non-numeric scales —
  see Estimation).
- Full CRUD on every surface.

## Estimation

- New optional task field: `estimate: <number | string>`.
- Workflow-level config block (in `workflow.yaml`):
  ```
  estimation:
    enabled: bool
    unit: "points" | "hours" | "days" | "custom_numeric" | "custom_enum"
    unit_label: "<text>"           # for custom_numeric and custom_enum
    scale: "free" | "linear" | "fibonacci"   # only for numeric units
    preset_values: [...]           # numeric: optional preset list
                                   # custom_enum: required list of categorical values
  ```
- Two estimation modes:
  - **Numeric** (points, hours, days, custom_numeric): values are
    numbers; summed across selected tasks; displayed with unit_label.
  - **Enum** (custom_enum): values are categorical (e.g. XS / S / M /
    L / XL, or small / medium / large); not summed; aggregated as
    counts per category (e.g. "3 S · 2 M · 1 XL"). Replaces the
    earlier separate "tshirt" scale — t-shirt sizing is just a
    custom_enum preset.
- **Burndown rendering:**
  - Numeric: estimate-burndown (sum of remaining estimates).
  - Enum: task-count-remaining.

## Date fields

- `start_date: <date> | null` — manual.
- `due_date: <date> | null` — already exists.
- `completed_date: <date> | null` — **purely auto.** Set when status
  moves into a `done`-category status. Cleared when moved out. Not
  editable from any surface; `setField` rejects writes to this field.
- Note: contracts today have `completed_at` declared but unused.
  Field is renamed to `completed_date` for naming consistency with
  `start_date` / `due_date`.

## User identity

### Storage layout

- One folder per user: `.loctt/users/<user-id>/` containing:
  - `profile.yaml` — committed.
    `{ id: <uuid>, name, email?, timezone: <IANA-name>, avatar?: <filename>, archived?: bool }`.
  - `avatar.<ext>` — committed (when present). `profile.yaml#avatar`
    is the filename relative to this folder.
  - `settings.yaml` — gitignored. Per-user UI prefs (theme, default
    view, default sort, date format, card layout, sidebar pins).
- `.loctt/.current-user` — gitignored, single line: active user's UUID.
- `.gitignore` (added by `loctt init`):
  ```
  .loctt/.current-user
  .loctt/users/*/settings.yaml
  ```
- Setup docs (getting-started, architecture) updated to mention these
  entries — users importing existing trackers must add them to their
  `.gitignore`.

### Timezones

- `profile.yaml#timezone` defaults to system timezone on user
  creation (`Intl.DateTimeFormat().resolvedOptions().timeZone`).
- Per-user timezone is used for **personal** date display: "due this
  week" filter boundaries, "due in N days" rendering, activity-log
  timestamps in the UI.
- **Workspace timezone** in `calendar.yaml` takes precedence for
  **shared** rendering: timeline today-marker, weekend shading,
  holiday shading. Ensures users in different timezones agree on
  which day is shaded.

### First-run

- Any surface invoked when no users exist silently creates a default
  user: `name = $USER` (env, fallback `you`), `timezone = system tz`,
  fresh UUID. Writes `profile.yaml` and `.current-user`. No prompts.

### CLI / MCP / HTTP surface

- `loctt user list` / `user_list` — lists users (excludes archived
  unless `--all`).
- `loctt user current` / `user_current` — prints active user.
- `loctt user switch <id-or-name>` / `user_switch` — writes
  `.current-user`.
- `loctt user create <name> [--email] [--avatar <path>] [--timezone] [--switch]`
  / `user_create` — creates user folder.
- `loctt user edit <id> [--name] [--email] [--avatar] [--timezone]`
  / `user_edit` — mutates `profile.yaml` (and replaces avatar file
  if `--avatar` given).
- `loctt user archive <id>` / `user_archive` — soft delete; sets
  `archived: true`. Hides from pickers but tasks still resolve their
  display name from the archived profile. Blocked when target is
  the active user.
- `loctt user unarchive <id>` / `user_unarchive` — clears the flag.
- `loctt user delete <id> [--remap-to <user-id> | --unassign]`
  / `user_delete` — hard delete. Blocked when target is the active
  user. If the user has any task references (assignee or reporter),
  exactly one of `--remap-to` or `--unassign` must be supplied;
  passing both is an error; passing neither fails fast with a count
  of affected tasks. `--remap-to <user-id>` rewrites affected tasks
  to point at that user. `--unassign` sets the affected fields to
  null. The MCP tool exposes the two as separate fields with the
  same mutual-exclusion rule. On confirm, atomically rewrites all
  affected tasks then removes the user folder.
- HTTP: `GET /api/users`, `POST /api/users`, `PUT /api/users/:id`,
  `POST /api/users/:id/archive`, `POST /api/users/:id/unarchive`,
  `DELETE /api/users/:id`, plus `GET /api/user/current` and
  `POST /api/user/switch`.
- `GET /api/users/:id/avatar` serves the avatar bytes.
- The web server reads `.current-user` on each request — CLI/MCP/UI
  all agree on the active user.

### Doctor checks

- Tasks referencing unknown user IDs (assignee/reporter).
- `.current-user` pointing at a missing user.
- Multiple users with the same name (informational; UUIDs disambiguate).

## Reporter

- New optional task field: `reporter: <user-uuid> | null`.
- Defaults to current user on task creation.

## Status icons / swatches

- workflow.yaml gains optional `icon` and `color` fields on statuses,
  priorities, task types, custom field enum values, labels, milestones.
- Surfaces (CLI/MCP) treat them as optional metadata — no behavior
  change. UI uses them for badges/dots.

## Visible fields per task type

- workflow.yaml task_types gain optional
  `visible_fields: [<field-key>, ...]`.
- If absent, all fields visible. If present, UI hides everything not
  in the list (custom fields included). Doesn't affect storage —
  hidden fields can still hold values.

## Custom field `multi`

- Already supported in workflow.yaml. Confirm UI treats it correctly:
  multi-select picker, value array in storage.

## Board columns (optional grouping)

- Default behavior: 1 status = 1 column. No config needed.
- Optional `boards.columns` block in workflow.yaml:
  ```
  boards:
    columns:
      - { key, label, statuses: [<status-key>, ...], wip?: <number> }
  ```
- If absent: columns = statuses 1:1.
- If present: columns can group multiple statuses, with optional WIP
  limits. Drag a card → set status to the column's first status (or
  prompt if multiple).

## Timeline / dependency relationship

- workflow.yaml gains optional `timeline.dependency_relationship: <key>`
  (default: `blocks` if such a relationship exists, else none).
- Used by the Timeline view only — renders dependency arrows between
  bars based on this relationship.

## Calendar (workspace)

- New file `calendar.yaml`:
  ```
  timezone: <IANA-name>
  first_day_of_week: 0..6
  working_days: [0..6]
  holidays: [{ date, label }]
  ```
- `timezone` is the workspace timezone used for shared rendering
  (timeline today-marker, weekend shading). Defaults to the system
  timezone of whoever runs `loctt init`.
- Used by Timeline view for shading. No business-day math.
- **Writes are UI-only.** CLI/MCP expose read-only access
  (`loctt calendar show`, MCP `get_calendar`) so agents and scripts
  can query working-day/holiday data. Editing requires the UI.

## Saved filters (three-tier)

1. **Workspace saved views** — `queries.yaml`, shared, full query
   definitions. Each view has a stable `id` (ulid). `name` is just
   a display label and can be renamed without breaking references.
   User-pinned filters reference views by `id`.
   Schema:
   ```
   queries:
     - id: <ulid>
       name: <text>
       query: <DSL string>
       sort: [{ field, direction }]
   ```
   CLI accepts name-lookup when unambiguous, ID always works.
2. **Built-in dynamic filters** — hardcoded into UI sidebar,
   parameterized by current user. Examples: "Assigned to me",
   "Reported by me", "Due this week", "Overdue", "No assignee". No
   storage.
3. **User-pinned filters** — list of references in user settings.
   Either references a saved view by name or a built-in filter by id.
   Drives sidebar customization.

## Parent/child treatment

- **No built-in parent/child concept.** workflow.yaml's relationships
  are the only mechanism.
- `loctt init` ships a default workflow.yaml that **does include** a
  `blocks`/`is_blocked_by` relationship and a `relates_to` self-inverse
  relationship, but **not** parent/child. Users add parent/child
  themselves if they want it.
- Task detail "Subtasks" panel from mockups becomes a **"Related"
  panel** that groups by relationship type with counts.
- List/board cards show a generic "N relations" badge.

---

# UI shell and views

## App shell

- **Sidebar:**
  - All Tasks
  - Projects (each project as a click-to-filter shortcut)
  - Built-in dynamic filters (Assigned to me, Due this week, etc.)
  - User-pinned filters
  - Workspace saved views
  - Labels (with color dots, click to filter)
  - Milestones
  - Sprints
  - Archived
  - Settings
  - Footer: tracker info (cwd, task count, default-project key
    prefix, next key)
- **Header:** "+ New Task", global search, view toggle (List / Board
  / Timeline), avatar menu (current user, switch user, sign out
  isn't a concept — it's just user switching).
- **Empty state (no `.loctt` directory):** init wizard — the only
  path that calls `init` from the UI.

## Task list

- Filter bar with field-specific dropdown filters (status, priority,
  type, assignee, label, milestone, sprint, project), archived toggle.
- Sortable columns. Default sort = created (no manual rank in flat
  views — relationship rank only applies in a parent context).
- Row click → opens task detail drawer.
- Bulk-select operations:
  - **Bulk-set** (replace value across selected): status, priority,
    type, assignee, reporter, milestone, sprint, due_date,
    start_date, estimate, project, single-value custom fields
    (enum/string/number).
  - **Bulk multi-value** (labels and multi-value custom fields):
    three modes — add, replace, remove.
  - **Bulk link** (separate action): link all selected tasks to one
    target via a chosen relationship type.
  - **Bulk archive / unarchive / delete.**
  - **Excluded from bulk-edit:** title, body, completed_date
    (auto-only), rank fields (relationship rank, board rank).

## Board

- Columns derived from workflow.yaml (default = statuses 1:1; optional
  `boards.columns` for grouped columns).
- Group-by selector: none / assignee / priority / type / milestone /
  sprint. Switches to swimlanes.
- Drag cards within and between columns. Drag = set status (and rank
  for within-column moves).
- WIP indicator on columns when `wip` set.
- Inline "Add task" per column.
- Card layout configurable per user (which fields show on the card).

## Timeline (Gantt)

- Bars for tasks with both start_date and due_date.
- Diamonds for tasks with only due_date (milestone-style points).
- Dependency arrows derived from
  `workflow.yaml#timeline.dependency_relationship`.
- Drag bar = move both dates (preserve duration). Drag edge = move
  one date.
- Group-by: none / milestone / assignee / status / sprint.
- Zoom: day / week / month.
- Weekend + holiday shading from `calendar.yaml`.
- Today marker.

## Task detail

- Two presentations sharing one component:
  - **Drawer:** opens as a right-side panel over the current view
    (list/board/timeline preserved underneath). Default presentation
    when clicking a row/card.
  - **Full page** at `/tasks/:key`: bookmarkable, shareable. Drawer
    has an "Open in new tab" button that links here.
- Inline-edit title.
- Sidebar (right rail in full-page; embedded in drawer) with: status,
  priority, type, assignee, reporter, start date, due date, completed
  date (read-only), estimate, milestone, sprint, labels, project,
  custom fields.
- Body: WYSIWYG editor (TipTap) with a toggle to switch to markdown
  source mode (CodeMirror). See Body editor section below.
- **Related panel** (replaces mockup's "Subtasks"): groups by
  relationship type, shows counts in section headers, add/remove
  links via picker.
- Attachments: drag-drop upload, list with download/delete.
- Activity: reverse-chronological history feed.
- Archive/unarchive toggle, delete (typed-confirm).

## Body editor

- **Default mode:** WYSIWYG (TipTap / ProseMirror).
- **Toggle:** switch to markdown source mode (CodeMirror). User
  preference per-session.
- **Plugin set** (TipTap + matching markdown parser/serializer):
  GitHub-flavored markdown (tables, task lists, strikethrough,
  autolinks), code blocks with syntax highlighting, footnotes,
  subscript/superscript, math (KaTeX), allowlisted embedded HTML.
- **Lossy-content guardrail:** when opening a task, if the markdown
  source contains constructs the WYSIWYG editor cannot represent
  cleanly (arbitrary HTML outside the allowlist, unknown directives),
  the editor refuses to enter WYSIWYG mode and shows a banner:
  *"This task body contains markdown features that can't be edited
  visually. Edit in source mode."* User stays in source mode for that
  task.
- Save = replace body. There's no separate "append" UX in the editor
  — append is CLI/MCP only.

## Create task

- Modal from "+ New Task". Title required; defaults: project =
  workspace default project (or required selector if multiple
  projects exist and no default is set), status = workflow's first
  status, priority = first priority, type = first type, reporter =
  current user, **assignee = unassigned**.
- On create → navigate to detail page.

## Settings

Sections (final IA):

- **Projects** (CRUD on `projects.yaml`; key immutable, prefix
  immutable after creation).
- **Workflow:** statuses, priorities, task types, relationships,
  custom fields, estimation config, board columns,
  timeline.dependency_relationship.
- **Labels** (CRUD).
- **Milestones** (CRUD).
- **Sprints** (CRUD).
- **Saved Views** (CRUD on queries.yaml).
- **Calendar** (working days, holidays, first day of week).
- **Users** — see User panel UI flows below.
- **Sync** (git config + status + publish/sync buttons).
- **Doctor.**
- **General** (workspace identity, default view).
- **My Preferences** (user-level: theme, keyboard shortcut help, date
  format, default sort, card layout, sidebar pins).

## User panel UI flows (`Settings → Users`)

### List

- Table of users: avatar, name, email, timezone, active marker,
  archived marker.
- Filter toggle: show archived / hide archived.
- Row actions: Edit, Switch to, Archive (or Unarchive), Delete.
- "+ Add user" button at top.

### Create

- Modal with fields:
  - **Name** (required, free text — uniqueness not enforced)
  - **Email** (optional)
  - **Avatar** (optional file upload — saved as
    `.loctt/users/<id>/avatar.<ext>`)
  - **Timezone** (defaults to system tz; dropdown of IANA zones with
    autocomplete)
  - **Switch to this user after creating** (checkbox)
- On submit: generate UUID, write `profile.yaml`, save avatar file
  if provided, optionally write `.current-user`.

### Edit

- Same form as Create, prefilled. Avatar upload replaces the existing
  avatar file (and removes the old one).

### Switch

- Inline action on each row. Writes `.current-user`. Header avatar
  menu refreshes.

### Archive / Unarchive

- Inline action. Confirm dialog. Sets `archived: true` or clears it.
- **Blocked when target is the active user.** UI shows the action
  disabled with a tooltip: "Switch to another user first."
- Archived users hide from assignee/reporter pickers but tasks
  already assigned to them continue to display the name.

### Delete (hard)

- Confirm dialog with the user's reference counts:
  - "X tasks assigned to this user"
  - "Y tasks reported by this user"
- If references exist:
  - Form requires picking a target user from the remaining users
    (or **Unassigned** which sets the field to null).
  - Separate selectors for assignee remap and reporter remap (or
    one shared "remap to" if user picks the same).
- If no references: just confirm.
- **Blocked when target is the active user.**
- On submit: atomic operation — rewrites all affected tasks, then
  removes the user folder (`.loctt/users/<id>/`).

## Tracker info / init

- If no `.loctt`: empty-state init wizard (only UI path calling
  `init`).
- If exists: cwd, task count, default-project prefix, next key in
  sidebar footer.

## Init wizard

Crucial-only configuration; everything else lives in Settings and
can be changed later.

Fields:

- **Starting project** — `key` (slug, immutable) and `prefix`
  (immutable after creation). Defaults: `key: tasks`, `prefix: T-`.
  Additional projects added later via Settings → Projects.
- **Skip starter docs** (checkbox; defaults to off; equivalent to
  the existing `--no-docs` flag).
- **Workflow preset** (dropdown: Default / Minimal / Agile-style)
  — picks a starter `workflow.yaml`. Defaults to Default.

Skipped from the wizard (set automatically, editable later):

- User identity — auto-creates default user from `$USER` and system
  timezone.
- Calendar — defaults to system timezone, Mon–Fri working days.
- Git-backed mode — disabled by default; opt-in via Settings → Sync.

---

# Configuration model

## Workspace-level (shared, in `.loctt/`, committed unless noted)

- `workflow.yaml` — statuses, priorities, types, relationships, custom
  fields, estimation, board columns, timeline.dependency_relationship,
  visible-fields-per-type, optional icons/colors.
- `projects.yaml` — project list (key, label, prefix).
- `queries.yaml` — saved views (each with stable `id`).
- `labels.yaml` — label registry.
- `milestones.yaml` — milestone registry.
- `sprints.yaml` — sprint registry.
- `calendar.yaml` — working days, holidays, first day of week.
- `users/<id>/profile.yaml` + optional `avatar.<ext>` — user registry
  (folder per user).
- `state.yaml` — auto-managed counters.
- `sync.yaml` — git config (existing).

## User-level (per-user, in `.loctt/users/<id>/settings.yaml`, gitignored)

- Theme.
- Default view (list / board / timeline).
- Default sort.
- Date format preference.
- Card layout (which fields render on board cards).
- Sidebar pinned filters.
- Per-user default project (overrides `projects.yaml#default`).

## User-level (browser-local, in localStorage)

- Sidebar collapsed state.
- Last-open view per route.
- Anything else purely UI ephemeral.

## Active user (per-checkout, gitignored)

- `.loctt/.current-user` — single line: active user UUID.

---

# Backend gaps required

## New core writers

- `saveProjectsConfig` — atomic write of projects.yaml. Project
  `key` immutable; prefix immutable after creation; delete requires
  remap of affected tasks' `project` field.
- `saveQueriesConfig` — atomic write of queries.yaml.
- `saveWorkflowConfig` — atomic write of workflow.yaml. Enforces
  immutable keys. Supports remap-on-delete.
- `saveLabelsConfig` / `saveMilestonesConfig` / `saveSprintsConfig` /
  `saveCalendarConfig` / `saveUsersConfig` — same shape, atomic, with
  remap-on-delete where applicable (labels, milestones, sprints, users).
- `reorderRelationship` — lexorank reorder of a target within a
  source's links of a given type. Auto-rebalances the affected
  window when computed ranks exceed a length threshold. Hidden;
  not exposed in CLI/MCP.
- `reorderBoardRank` — lexorank reorder for board column ordering.
  Same auto-rebalance behavior.
- User identity helpers: `loadUsers`, `getCurrentUser`,
  `setCurrentUser`, `createUser`, `updateUser`, `archiveUser`,
  `unarchiveUser`, `deleteUser` (with remap support).
- `setField` extension: auto-set/clear `completed_date` on status
  changes into/out of done-category statuses.

## New HTTP endpoints

- `POST   /api/tasks/:ref/body`         — replace body
- `POST   /api/tasks/:ref/body/append`  — append body
- `POST   /api/tasks/:ref/relationships/:type/:target/rerank` — reorder a relationship link
- `GET    /api/views`                   — list saved views
- `POST   /api/views`                   — create
- `PUT    /api/views/:name`             — update
- `DELETE /api/views/:name`             — delete
- `GET    /api/workflow`                — full workflow config
- `PUT    /api/workflow`                — replace, with remap-on-delete
- `GET    /api/projects`, `POST/PUT/DELETE` — projects CRUD (delete
  with remap)
- `GET    /api/labels`, `POST/PUT/DELETE` — labels CRUD
- `GET    /api/milestones`, `POST/PUT/DELETE` — milestones CRUD
- `GET    /api/sprints`, `POST/PUT/DELETE` — sprints CRUD
- `GET    /api/calendar`, `PUT` — calendar config
- `GET    /api/users`, `POST /api/users`, `PUT /api/users/:id`,
  `DELETE /api/users/:id` (with `?remap_assignee=&remap_reporter=`),
  `POST /api/users/:id/archive`, `POST /api/users/:id/unarchive`
- `GET    /api/users/:id/avatar` — avatar bytes
- `GET    /api/user/current`, `POST /api/user/switch` — active user
- `GET    /api/user-settings`, `PUT /api/user-settings` — current user's UI prefs
- `POST   /api/init`
- `POST   /api/config/:key`, `DELETE /api/config/:key`
- `GET    /api/git/status`, `POST /api/git/publish`, `POST /api/git/sync`

## CLI/MCP additions

- `loctt rerank <source> <relationship-type> <target> [--before|--after]`
  and matching `reorder_relationship` MCP tool.
- `loctt project …`, `loctt label …`, `loctt milestone …`,
  `loctt sprint …`, `loctt user …` command groups, with matching MCP
  tools (see User identity section for the user subcommands).
- `loctt create --project <key>` — defaults to the workspace default
  project.
- `loctt board-rerank` and matching MCP tool.
- `loctt calendar get/set` (or just edit `calendar.yaml` and re-load).

---

# Implementation slices (revised order)

The order below front-loads architectural changes so the UI can be
built against a stable model.

0. **Phase 0 — Pre-work hygiene.** Schema versioning
   (`.loctt/.schema-version`, migration framework scaffolding,
   `loctt init` writes version 1). Generic atomic-yaml writer.
   `loadConfigBundle` helper.
1. **Projects** (projects.yaml, per-project counters in state.yaml,
   `project` field on tasks, CLI/MCP/HTTP, query DSL `project:` filter).
2. **User identity** (folder-per-user layout, `.current-user`,
   gitignore handling, CLI/MCP/HTTP commands, getting-started doc
   updates).
3. **Date fields + completed_date auto-management** (start_date,
   completed_date).
4. **Relationship rank + board rank** (lexorank, reorder APIs,
   auto-rebalance — both hidden in CLI/MCP except the relationship
   rerank command).
5. **Labels registry** (labels.yaml + CRUD).
6. **Milestones registry** (milestones.yaml + CRUD).
7. **Sprints registry** (sprints.yaml + CRUD).
8. **Estimation config** (workflow.yaml addition).
9. **Calendar config** (calendar.yaml).
10. **Workflow editor backend** (immutable keys, remap-on-delete
    writers for all yaml configs).
11. **Saved views CRUD with stable IDs** (queries.yaml writer +
    endpoints).
12. **Other backend gaps** (body endpoints, init endpoint, git
    endpoints, config set/unset, user settings storage).
13. **Frontend scaffold** (Vite/React/Tailwind, shadcn copy-paste,
    routing, app shell).
14. **Body editor** (TipTap + CodeMirror toggle, plugin set,
    lossy-content guardrail).
15. **Task list + board + detail** (daily-use loop, drawer +
    full-page presentations, bulk-edit).
16. **Timeline view.**
17. **Settings panels** (Projects, Workflow, Labels, Milestones,
    Sprints, Calendar, Users, Saved Views, Sync, Doctor, General,
    My Preferences).
18. **Init wizard.**
19. **User-level UI prefs wiring.**

---

# Sync `git.enabled` toggle

- Toggling `git.enabled` requires a confirm step given the side
  effects (sparse worktree creation/teardown, file rewrites). Confirm
  dialog explains what will happen before proceeding.

---

# Open questions (do not invent answers)

_None at this time._
