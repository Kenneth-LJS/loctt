# LocTT — Implementation Plan (TEMP)

Scratch doc tracking the remaining work to build the LocTT UI on top of
the existing core. **Delete this file once the UI is fully implemented.**

Only contains decisions confirmed with the user. Items already implemented
in the codebase have been removed to keep this lean — see git history for
the original `TEMP-CORE-CHANGES-FROM-MOCKUPS.md` and
`TEMP-UI-FEATURE-FLOW.md` for the full design rationale.

Companion files:
- `temp-ui-mockups/` — HTML mockups reflecting these decisions
- `~/.claude/plans/tranquil-tinkering-mochi.md` — original audit

Structure:
- **Part 1** — Core / shared changes (contracts, core, CLI, MCP, HTTP)
- **Part 2** — Frontend (UI shells, views, settings panels)
- **Part 3** — Open questions

---

# Part 1 — Core / shared

These are backend additions that affect the data model, CLI, MCP server,
and HTTP API. All UI features eventually rest on this layer, so this part
ships first.

## 1.1 Workflow icons + colors

Optional `icon` and `color` fields on workflow entities. Both are opaque
strings — `icon` is either a Lucide icon name or an emoji, `color` is a hex.

### Contract additions

In `packages/contracts/src/workflow.ts`, add to `StatusDef`, `PriorityDef`,
`TaskTypeDef`, `RelationshipDef`, and `CustomFieldValueDef`:

```ts
icon?: string;   // Lucide icon name ("circle") or emoji ("🚀")
color?: string;  // Hex string, e.g. "#1E6FCB"
```

No validation beyond "is string". UI discriminates at render time: if the
value matches a known Lucide name, render the icon; otherwise render as
text (emoji fallback works because emoji are strings).

For labels: `color` already exists. Add `icon` for symmetry.

### Library choice (frontend)

**Lucide** (MIT, ~1.5k icons, shadcn ecosystem standard). Bundle a curated
subset of icon names the picker exposes as a const list — no runtime
catalog scrape.

### Migration

None. All additive optional fields.

### CLI/MCP

No new commands. `saveWorkflowConfig` already passes through these keys.

## 1.2 Board columns with optional WIP limits

### Behavior

Passive indicator only. No enforcement, no modals.
- Column header: `In Progress · 2/3` (neutral) or `In Progress · 5/3` (red)
  when over limit.
- Hover tooltip on red badge: "WIP limit is 3 — currently 5 cards."
- Drag-drop into a grouped-status column: first status in the list wins
  silently. To land on a non-first status, edit the card.

### Contract addition

`packages/contracts/src/workflow.ts` gains an optional `boards` block:

```yaml
boards:
  columns:
    - { key: doing, label: "In Progress", statuses: [doing, in_review], wip: 3 }
```

- If absent: 1 status = 1 column (today's behavior).
- If present: a column may group multiple statuses, optional `wip` int.
- Backend only reads this — no enforcement.

### CLI/MCP

No new commands. Configured via `workflow.yaml` edits or future Settings
panel calling `PUT /api/workflow`.

## 1.3 Timeline dependency relationship

### Behavior

On the Timeline (Gantt) view, when task A is linked to task B via the
configured relationship type, a thin SVG arrow draws from A's right edge
to B's left edge. Renders nothing if the config is absent or null.

### Contract addition

`packages/contracts/src/workflow.ts` gains:

```yaml
timeline:
  dependency_relationship: blocks   # or null/absent for no arrows
```

- If absent and the workflow has a `blocks` relationship, default to that.
- If neither: timeline shows no arrows.

### Relationship key immutability

Relationship `key` is immutable after creation, matching status / priority
/ type / project / sprint keys. To "rename" a relationship, delete and
recreate (existing remap-on-delete flow handles task rewrites). Verify
the workflow writer enforces this; tighten if not.

### Auto-clear on delete

When the relationship referenced by `timeline.dependency_relationship` is
deleted, `saveWorkflowConfig` clears the field in the same atomic write.
No doctor warning, no error — timeline renders zero arrows until the user
picks a new relationship in Settings.

The same auto-clear pattern applies to filter-chip references (§1.5) when
a custom field is deleted.

## 1.4 Estimation weights for enum units

For burndown to work on `custom_enum` estimation (e.g. T-shirt sizes), add
an optional `weights` map.

```yaml
estimation:
  unit: custom_enum
  unit_label: "size"
  preset_values: [XS, S, M, L, XL]
  weights:
    XS: 1
    S:  2
    M:  3
    L:  5
    XL: 8
```

Behavior:
- `weights` absent → burndown Y axis = count of incomplete tasks.
- `weights` present → burndown Y axis = sum of weights of incomplete tasks.
- List-view aggregations stay categorical when weights absent
  ("3 S · 2 M · 1 XL"); show both categorical + total when weights present
  ("3 S · 2 M · 1 XL · total 13").
- Weights are optional, never forced. Numeric units ignore the field.

### Contract change

`packages/contracts/src/workflow.ts` — add
`weights?: Record<string, number>` to `EstimationConfigSchema`. Validation:
when present, every key must appear in `preset_values`; every value must
be a finite non-negative number. Only meaningful for `unit: custom_enum`.

## 1.5 List-view config (workspace + user layered)

Custom-field filter chips on the list view are configurable workspace-wide
with per-user overrides.

### Two surfaces

1. **Settings → List View panel** (workspace-level). Checkboxes for every
   built-in field + every declared custom field. Toggles write to
   `.loctt/config/list-view.yaml`.
2. **Per-user override on the list page**. The "+ Filter" chip-bar popover
   shows the same list with the workspace default as baseline; user
   toggles write to `users/<id>/settings.yaml#list_view.filter_chips`.

### New file: `list-view.yaml`

```yaml
filters:
  visible: [status, priority, assignee, labels, milestone, severity]
  hidden:  []
```

If `visible` is absent → show everything by default. `hidden` always takes
precedence over `visible`.

### User-level shape (in `users/<id>/settings.yaml`)

```yaml
list_view:
  filter_chips:
    show: [reporter, custom_field_team]
    hide: [type]
```

### Resolution order (highest precedence first)

1. User `hide` → hidden
2. User `show` → shown
3. Workspace `hidden` → hidden
4. Workspace `visible` (if set) → shown if listed, else hidden
5. Default → all built-ins + all custom fields shown

### Cleanup on delete

When a custom field is deleted, the workflow writer also prunes any
matching entries in `list-view.yaml#filters.visible/hidden` (atomic, same
write). User settings are NOT touched server-side — stale refs are
harmless and pruned lazily by the UI on next load.

### Contract / core additions

- `packages/contracts/src/list-view.ts` (new) — `ListViewConfigSchema`.
- `packages/core/src/config/list-view.ts` (new) — atomic read/write.
- `packages/core/src/config/workflow-write.ts` — extend to prune
  `list-view.yaml` on custom-field delete.

### HTTP

- `GET /api/list-view` — read workspace config
- `PUT /api/list-view` — replace workspace config

## 1.6 Typed UserSettings

`packages/core/src/users/settings.ts` currently stores settings as
`Readonly<Record<string, unknown>>`. Replace with a typed shape.

### Contract addition

In `packages/contracts/src/users.ts`, add `UserSettingsSchema`:

```ts
theme?: "light" | "dark" | "system";
date_format?: "iso" | "us" | "eu";          // YYYY-MM-DD / MM-DD-YYYY / DD-MM-YYYY
default_view?: "list" | "board" | "timeline";
default_sort?: { field: string; direction: "asc" | "desc" };
card_layout?: {
  show_priority?: boolean;
  show_assignee?: boolean;
  show_labels?: boolean;
  show_type?: boolean;
  show_due_date?: boolean;
  show_estimate?: boolean;
  show_milestone?: boolean;
  show_relationship_count?: boolean;
};
sidebar_pins?: string[];   // ordered list of saved-view IDs / built-in filter IDs
default_project?: string;  // per-user default project key
list_view?: {
  filter_chips?: {
    show?: string[];
    hide?: string[];
  };
};
```

All optional. Backend round-trips as a typed bag.

### Migration

None — `loadUserSettings` continues to return an empty object when absent;
existing files validate (all fields optional).

### CLI/MCP

Not exposed via CLI — these are UI prefs. Already accessible via
`GET/PUT /api/user-settings`.

## 1.7 Attachment MIME

Return MIME type with attachments so the UI can dispatch renderers.

### Contract change

`packages/contracts/src/service.ts`:

```ts
// Before
interface AttachmentResponse { name: string; size: number }
// After
interface AttachmentResponse { name: string; size: number; mime?: string }
```

### Backend change

- `packages/core/src/task/attachments.ts` — when listing attachments,
  detect MIME via filename extension (small built-in table; no file
  sniffing). Add `mime` to the returned shape.
- `GET /api/tasks/:ref/attachments/:name` already sets `Content-Type`;
  ensure derivation matches.
- Surface `mime` on `get_task` MCP tool's `attachments[]` array.

### Migration

None. New optional field.

## 1.8 board-rerank CLI + MCP

Core (`reorderBoardRank`) and HTTP (`POST /api/tasks/:ref/board-rerank`)
already exist. CLI and MCP surfaces are still missing.

### CLI

```
loctt board-rerank <task> [--before <task> | --after <task>]
```

Mutually exclusive flags. Without either, the task moves to the end of its
column. Add to `apps/cli/src/index.ts` as a new case mirroring `rerank`.

### MCP

New tool `reorder_board`:

```ts
{
  ref: z.string().describe("Task key or ID"),
  before: z.string().optional().describe("Task to position before"),
  after: z.string().optional().describe("Task to position after"),
}
```

Same mutual-exclusion rule. Returns new column ordering as JSON.

Add to `apps/mcp/src/index.ts` — registration + handler that calls
`reorderBoardRank`.

### Docs

- `docs/user/cli/reference.md` — new section under Relationships and Ranks
- `docs/user/mcp/reference.md` — same

## 1.9 Sprint burndown reader

Dedicated page at `/sprints/:key` (UI in Part 2). Backend supplies the
series.

### Rendering rules

- X axis: days in sprint window (`start_date` → `end_date`).
- Y axis depends on `workflow.yaml#estimation`:
  - Numeric unit → sum of `estimate` of incomplete tasks.
  - Enum unit with `weights` → sum of weights of incomplete tasks (§1.4).
  - Enum unit without `weights`, or estimation disabled → count of
    incomplete tasks.
- "Incomplete" = status `category` is not `completed` or `discarded`.
- Ideal line: straight diagonal from start total → 0 at end.
- Today marker uses workspace timezone from `calendar.yaml`.
- Weekend / holiday shading from `calendar.yaml`.

### Data source — reconstruct from history

No daily snapshots. Walk each task's `history` entries (status changes,
estimate changes, sprint join/leave) and replay to compute remaining
total at end-of-day for each day in the sprint window. Cache the series
keyed by sprint id; invalidate on any task write within the window.

### Scope changes shown as steps

When a task is added to or removed from the sprint mid-run, the total
line shows a visible step. Don't smooth — hiding scope creep defeats the
chart.

### Backend additions

- `packages/core/src/sprints/burndown.ts` (new) — reconstruct-from-history
  reader. Pure function over (sprint, tasks, history) → series.
- `GET /api/sprints/:key/burndown` (new) — returns the series.
- No CLI/MCP surface for the chart; agents can query the underlying data
  via existing `get_sprint` + task history.

## 1.10 Markdown extensions doc

New file `docs/dev/markdown-extensions.md` documenting:

### Source representation table

| Feature | Source representation |
|---|---|
| Superscript | `^text^` (Pandoc-style) |
| Subscript | `~text~` (Pandoc-style; single-tilde for sub) |
| Strikethrough | `~~text~~` (GFM, double-tilde) |
| KaTeX inline | `$expr$` |
| KaTeX block | `$$\nexpr\n$$` |
| GFM task list | `- [ ] todo` / `- [x] done` |
| Footnotes | `[^1]` references + `[^1]: text` definitions |
| Tables | GFM pipe tables |
| Code blocks with language | ` ```ts ` fences |
| Code block w/ line highlight | ` ```ts {3,5-7} ` info-string convention |
| Mention | `@user:<uuid>` (LocTT extension; renders display name) |
| Task reference | `T-123` autolinked at render time (no on-disk syntax) |
| Image / video / audio | `![alt](attachments/<name>)` (renderer dispatches by MIME) |
| Non-image file embed | `![[attachments/<name>]]` (Obsidian-style) |

### Attachment embedding flow (Jira-style)

On disk, all embeds reference `attachments/<name>` in the task's folder.
The renderer dispatches by MIME (§1.7):
- `image/*` → inline `<img>`
- `video/*` → inline `<video>`
- `audio/*` → inline `<audio>`
- everything else → inline file chip (icon + filename + size + download)

Authoring flows:
- **Drag-drop / paste into the editor:** upload via existing
  `POST /api/tasks/:ref/attachments`, wait for response, insert
  appropriate markdown at cursor. Upload failure → no insert + toast.
- **Insert existing attachment:** editor toolbar button opens a picker
  of the task's existing attachments → pick → inserts markdown.
- **Attach without embedding:** existing Attachments panel on task detail
  still accepts uploads independently.

### Editor features dropped (not representable)

- Text color, font size, font family.
- Arbitrary HTML — outside the allowlist triggers the lossy-content
  guardrail (forces source mode).

---

# Part 2 — Frontend

Frontend stack: Vite + React + Tailwind + shadcn copy-paste. Routing via
React Router (TBD or alternative). All data via the existing HTTP API.

## 2.1 App shell

- **Sidebar:**
  - All Tasks
  - Projects (each project = click-to-filter shortcut)
  - Built-in dynamic filters (Assigned to me, Due this week, Overdue, etc.)
  - User-pinned filters
  - Workspace saved views
  - Labels (with color dots, click to filter)
  - Milestones
  - Sprints
  - Archived
  - Settings
  - Footer: cwd, task count, default-project key prefix, next key
- **Header:** "+ New Task", global search, view toggle (List / Board /
  Timeline), avatar menu (current user, switch user, link to Settings →
  Users).
- **Empty state** (no `.loctt`): init wizard — only UI path calling `init`.

## 2.2 Task list

- Filter chip bar (built-ins + workspace + user-overrides per §1.5).
- Sortable columns. Default sort = created (no manual rank in flat views).
- Row click → task detail drawer.
- Bulk-edit ops (drives the UI; backend already supports all of these):
  - **Bulk-set**: status, priority, type, assignee, reporter, milestone,
    sprint, due_date, start_date, estimate, project, single-value custom
    fields.
  - **Bulk multi-value** (labels + multi-value custom fields): three
    modes — add, replace, remove (computed client-side; sends `set` with
    full value).
  - **Bulk link**: link all selected to one target via a chosen
    relationship type.
  - **Bulk archive / unarchive / delete.**
  - **Excluded from bulk-edit:** title, body, completed_date (auto-only),
    rank fields.

### Selection model

- Checkboxes per row + "select all on page" in header.
- Sticky bottom action bar when ≥1 row selected.
- Per-action confirm dialog with progress (e.g. "Updating 12 of 47…").
- Partial-failure UX: list which keys failed and why; offer "retry failed".

## 2.3 Board

- Columns from `workflow.yaml` (default = statuses 1:1; optional
  `boards.columns` per §1.2).
- Group-by selector: none / assignee / priority / type / milestone /
  sprint. Switches to swimlanes.
- Drag cards within/between columns. Between = set status (and assign new
  `board_rank` at drop position). Within = update `board_rank` only.
- WIP indicator on columns when `wip` set (red badge over limit).
- Inline "Add task" per column.
- Card layout configurable per user (which fields render on the card —
  see UserSettings `card_layout` in §1.6).

## 2.4 Timeline (Gantt)

- Bars for tasks with both `start_date` and `due_date`.
- Diamonds for tasks with only `due_date` (milestone-style points).
- Dependency arrows from
  `workflow.yaml#timeline.dependency_relationship` (§1.3).
- Drag bar = move both dates (preserve duration). Drag edge = move one.
- Group-by: none / milestone / assignee / status / sprint.
- Zoom: day / week / month.
- Weekend + holiday shading from `calendar.yaml`.
- Today marker.

## 2.5 Task detail

Two presentations sharing one component:
- **Drawer**: right-side panel over current view (default for row/card
  click).
- **Full page** at `/tasks/:key`: bookmarkable. Drawer has "Open in new
  tab" linking here.

Features:
- Inline-edit title.
- Sidebar: status, priority, type, assignee, reporter, start_date,
  due_date, completed_date (read-only), estimate, milestone, sprint,
  labels, project, custom fields.
- Body editor (§2.6).
- **Related panel** (groups by relationship type, shows counts in section
  headers, add/remove links via picker).
- Attachments: drag-drop upload, list with download/delete, MIME-aware
  thumbs (§1.7).
- Activity: reverse-chronological history feed.
- Archive/unarchive toggle, delete (typed-confirm).

## 2.6 Body editor

- **Default mode:** WYSIWYG (TipTap / ProseMirror).
- **Toggle:** markdown source mode (CodeMirror). Per-session preference.
- **Save model:** explicit Save button. No autosave. One click → one
  `POST /api/tasks/:ref/body` → one `body_edited` history entry.
  - "Unsaved changes" indicator while typing.
  - Warn-on-navigate-away when unsaved.
  - Ctrl/Cmd+S keyboard shortcut.
- **Plugin set:** GFM (tables, task lists, strikethrough, autolinks),
  code blocks with syntax highlighting, footnotes, sub/superscript,
  KaTeX, allowlisted embedded HTML.
- **Lossy-content guardrail:** if markdown source contains constructs
  WYSIWYG can't represent (arbitrary HTML outside allowlist, unknown
  directives), editor refuses to enter WYSIWYG mode, banner shown:
  *"This task body contains markdown features that can't be edited
  visually. Edit in source mode."* User stays in source mode for that task.
- **Attachment embedding:** drag-drop, paste, or toolbar picker — see
  §1.10 for the full flow.
- Save = replace body. No separate "append" UX — append is CLI/MCP only.

## 2.7 Create task modal

From "+ New Task". Title required.

Defaults:
- project = workspace default (or required selector when multiple
  projects exist and no default set)
- status = workflow's first
- priority = first
- type = first
- reporter = current user
- assignee = unassigned

On create → navigate to detail page.

## 2.8 Settings panels

Final IA:

- **Projects** — CRUD on `projects.yaml`; `key` immutable, `prefix`
  immutable after creation.
- **Workflow** — statuses, priorities, task types, relationships,
  custom fields, estimation config, board columns, timeline dependency
  relationship. Icon/color pickers per §1.1.
- **Labels** — CRUD.
- **Milestones** — CRUD.
- **Sprints** — CRUD.
- **Saved Views** — CRUD on `queries.yaml`. Query DSL editor + sort.
- **List View** — workspace-level filter-chip visibility (§1.5).
- **Calendar** — working days, holidays, first day of week.
- **Users** — list, create, edit, archive/unarchive, delete with remap.
  Avatar cropper (§2.11).
- **Sync** — git enable/disable, branch + remote, auto_push/auto_fetch,
  last synced commit, Publish/Sync buttons, status line.
- **Doctor** — fetches `GET /api/doctor`, renders checks, "Re-run" button.
- **General** — workspace identity, default view.
- **My Preferences** — per-user: theme, date format, default sort,
  card layout, sidebar pins, default project, filter-chip overrides.

### User panel UI flows

- **List**: table (avatar, name, email, timezone, active marker,
  archived marker). Show-archived toggle. Row actions: Edit, Switch to,
  Archive/Unarchive, Delete.
- **Create**: modal — name (required), email (optional), avatar upload
  (§2.11), timezone (defaults to system tz, IANA autocomplete dropdown),
  "Switch to this user after creating" checkbox.
- **Edit**: same form, prefilled. Avatar upload replaces existing.
- **Switch**: inline row action. Writes `.current-user`. Header avatar
  menu refreshes.
- **Archive/Unarchive**: confirm dialog. Blocked when target is active
  user — disabled with tooltip "Switch to another user first."
- **Delete** (hard): confirm dialog with reference counts. If references
  exist: form requires picking a target user (or "Unassigned") for
  assignee remap and reporter remap separately. Blocked when target is
  active user.

## 2.9 Init wizard

Empty-state at `init.html`. Crucial-only configuration; everything else
goes in Settings.

Fields:
- **Starting project** — `key` (slug, immutable) and `prefix` (immutable
  after creation). Defaults: `key: tasks`, `prefix: T-`.
- **Skip starter docs** (checkbox; equivalent to `--no-docs` flag).

Skipped (auto-set, editable later):
- User identity — auto-creates default user from `$USER` and system tz.
- Calendar — defaults to system tz, Mon–Fri working days.
- Git-backed mode — disabled by default; opt-in via Settings → Sync.

Submit → `POST /api/init` → reload into list view.

## 2.10 Sprint page

Dedicated page at `/sprints/:key`.

- Sprint metadata header (label, start/end dates, state, goal).
- Burndown chart (§1.9): X = days, Y = sum/count per estimation config,
  ideal line, today marker, weekend/holiday shading, step changes for
  scope edits.
- Task list filtered to sprint members.
- Edit sprint button → opens form (works the same on Settings → Sprints).

## 2.11 Avatar cropper

Backend already complete (chunk 10): `POST /api/users/:id/avatar` accepts
multipart upload (any sharp-decodable raster), rejects SVG by content
sniff, caps source at 10 MB, resizes longest side to 500px, re-encodes as
JPG (quality 85, mozjpeg), writes atomically to `<userDir>/avatar.jpg`.
`GET` returns `image/jpeg` with `X-Content-Type-Options: nosniff`.

UI work remaining:
- **Image cropper modal.** On file pick:
  1. Read client-side into object URL (no upload yet).
  2. Open modal with circular crop overlay. Default crop = largest
     centred square in image. Drag to reposition, pinch/scroll to zoom
     (clamped to image bounds).
  3. On confirm, render cropped square to offscreen canvas, `toBlob()`
     as JPEG/PNG, upload via existing endpoint.
- **Library suggestion.** `react-easy-crop` (MIT). Alternative
  `react-image-crop`. Roll own only if gesture/a11y constraints force it.
- **Pre-upload size feedback.** Show resulting JPG size before upload so
  user knows when the 10 MB cap is in play.
- **Server-side fallback.** If `canvas.toBlob` unsupported, upload raw —
  backend resizes anyway; only lose the chosen crop.

## 2.12 Sync git.enabled toggle

Toggling `git.enabled` requires a confirm step given side effects (sparse
worktree creation/teardown, file rewrites). Confirm dialog explains what
will happen before proceeding.

## 2.13 User-level UI prefs wiring

Wire each `UserSettings` field (§1.6) to its UI surface:
- `theme` → root `<html>` class toggle.
- `date_format` → centralized date renderer.
- `default_view` → router's index redirect target.
- `default_sort` → list view's initial sort.
- `card_layout` → board card field visibility.
- `sidebar_pins` → sidebar order.
- `default_project` → create-task modal default.
- `list_view.filter_chips` → list view chip resolution per §1.5.

---

# Part 3 — Open questions

_None at this time._
