# LocTT UI v1 — Locked Plan

Single source of truth for the LocTT v1 web UI build. Consolidates the
mockup audit, all decision passes, and the resulting scope. Supersedes
the earlier exploratory drafts.

**How to read this doc:**
- **Part A** — context: how we got here, philosophy, what's open vs closed
- **Part B** — Core work: every backend / `packages/core` change v1 needs, with rationale and sizing
- **Part C** — UI work: every screen, panel, dialog, and interaction; what each looks like and depends on
- **Part D** — Decision register: every locked design call, keyed for reference

We ship Part B (core) before Part C (UI). Reasoning: most UI screens depend
on backend additions, so building UI on stale core means rework. Core
items are small and bounded — see sizing column.

---

# Part A — Context

## A.1 Philosophy

- **Features enabled by default don't get in the way.** Estimation,
  sprints, hierarchy, custom fields, six relationship types — all shipped
  in the canonical workflow. Users who don't need them just don't use them.
- **Local-first, no infrastructure.** No notifications, no roles, no
  websockets, no real-time. Cross-tab sync via TanStack Query
  `staleTime` + window-focus refresh.
- **Core is the source of truth.** CLI / MCP / HTTP are wrappers. If a
  feature needs core work, core changes first; wrappers follow.
- **No backwards-compat hacks.** LocTT is pre-release. Where the cleanest
  schema requires a one-time migration of zero existing trackers, take it.

## A.2 Stack

- **Frontend**: Vite + React + TypeScript + Tailwind + shadcn (copy-paste)
- **Routing**: React Router (clean paths — `/tasks/:key`, `/board`, `/timeline`, `/sprints/:key`, `/settings/<section>`)
- **Data layer**: TanStack Query (per-query `staleTime`, focus refetch, mutation-driven invalidation)
- **Body editor**: TipTap for WYSIWYG (ProseMirror under the hood); CodeMirror 6 for markdown source mode
- **Workflow icons**: Lucide (per Part 1 §1.1 of original plan); emoji fallback
- **Persistence layer for UI prefs**: backend `UserSettings` passthrough YAML, gitignored

## A.3 Responsive design

Three breakpoints from day one:
- **Desktop** (≥1024px) — full layout
- **Tablet** (640-1024px) — collapsed sidebar; task detail meta panel collapses to top
- **Phone** (<640px) — drawer sidebar, list-as-cards, board single-column scroll, timeline scrollable

Tailwind utilities for variants. Mockups remain desktop-only (faster iteration); React adds responsive variants.

## A.4 Out of scope for v1

- Notifications (email/push)
- Roles / permissions
- Comments / mentions across orgs — *wait, comments are in v1; see CW-14*
- Time tracking (estimate vs. actual log)
- Print stylesheets
- Multi-language / i18n
- Mobile-native app

Each of these is a deliberate skip with reasoning in Part D.

---

# Part B — Core work

All changes below land in `packages/core` (and `packages/contracts` where
schemas are involved). CLI/MCP/HTTP wrappers follow per surface. Sizes:
**XS** <100 LOC, **S** 100-300, **M** 300-1000.

## B.1 Schema extensions

### CW-1 · `workflow.timeline.*` extension
Add three optional fields to `workflow.yaml#timeline`:
- `default_zoom: day | week | month` (default `week`)
- `show_arrows: boolean` (default `true`)
- `default_grouping: none | milestone | assignee | status | sprint`

Workspace-level fallback. Per-view overrides via CW-2. Size: **XS**.

### CW-2 · `SavedView.display` block
New optional block on each saved view:
```yaml
display:
  mode: list | board | timeline
  zoom: day | week | month         # timeline only
  grouping: ...                     # board/timeline only
  show_arrows: boolean              # timeline only
  columns: [key, title, ...]        # list only
  group_by: ...                     # board only
```
Resolution order on view open: view.display → workspace defaults → built-ins. Size: **S**.

### CW-12 · Projects: ULID + name + prefix
**Breaking schema change**, justified because LocTT is pre-release.
- `ProjectDef: { id: ULID, name: string, prefix: string, archived? }` — no `key` field
- Tasks' `project` field stores **ULID**, not slug
- `state.keys[<ULID>]` map keyed by ULID
- Journal entries reference ULID
- CLI/MCP accept project **name** (with ambiguity error on duplicates) or ULID
- UI shows **name** everywhere; ULID is never displayed
- New helper: `resolveProjectByName(name): ProjectDef | { ambiguous, matches[] }`
- `editProject` allows name changes; **prefix is immutable**

Touches contracts, projects/manage, state/keys, task/create, journal, query/list, doctor. Size: **M**.

### CW-15 · `symmetric` flag on RelationshipDef
Cleaner expression of self-inverse relationships:
```yaml
relationships:
  - { key: relates_to, label: "Relates to", symmetric: true }
```
When `symmetric: true`: `inverse` / `inverse_label` not required (auto = self). Existing `inverse: <self>` rows auto-migrate. UI groups both directions under one heading. Size: **XS**.

### CW-17 · `UserSettings.card_layout` as ordered array
Was `boolean` per field. Now `[{ key, visible }, ...]` — preserves order. UI-managed passthrough; core treats opaquely. Size: **XS**.

## B.2 New core operations

### CW-3 · `duplicateTask(srcId, overrides?)`
Copies fields, body, custom fields. **Does NOT copy**: id, key, relationships, history, attachments. Generates fresh ULID + key. Stamps `created` history entry. CLI/MCP wrappers. Size: **S**.

### CW-4 · Bulk ops
- `bulkSetField(taskIds, field, value)`
- `bulkUnsetField(taskIds, field)`
- `bulkArchive(taskIds)` / `bulkUnarchive(taskIds)`
- `bulkDelete(taskIds, { confirm: true })`
- `bulkLink(srcIds, type, targetId)`

All wrapped in a single `withStateLock` per call. Validate all upfront, commit-or-abort-all. Each task's history entry carries a shared `bulk_op_id` so UI can collapse "Ken bulk-changed status on 50 tasks" into one expandable row. CLI: `loctt set T-1,T-2 status doing`. MCP: `bulk_update_tasks` tool. Size: **M**.

### CW-5 · `setFields(taskId, fields)` atomic multi-field write
Single core op replacing N consecutive `setField` calls. One task.md rewrite, one history entry per field (or one combined entry — decided per-call). Eliminates partial-failure rollback in UI for drag interactions (board move = status + board_rank; timeline drag = start + due). Size: **XS**.

### CW-13 · `moveTaskToProject(taskId, targetProjectId)`
- Allocate new key in target project
- Append old key to `key_history`
- Update `project` field on task (lift from `USER_IMMUTABLE_FIELDS` for this specific path)
- Emit one combined `project_changed` history entry with `{ from, to, key_before, key_after }`
- All inside `withStateLock`, journaled for crash recovery
- Bulk variant `bulkMoveTasksToProject(taskIds, targetProjectId)` uses the bulk-op machinery from CW-4

Relationships stay intact (target IDs are stable). External references to the old key resolve via existing `key_history` machinery. Size: **S**.

### CW-14 · Comments module
New per-task file `.loctt/tasks/<id>/_comments.yaml` (matches `_history.yaml` naming convention):
```yaml
comments:
  - id: <ULID>
    author: <user_id>
    body: "<markdown>"
    at: <ISO timestamp>
    edited_at: null
    parent_id: null     # 1-level threading; replies to top-level only
    mentions: [<user_id>, ...]
```

Core ops:
- `addComment(taskId, body, parentId?) → Comment`
- `editComment(commentId, body)` — only by author
- `deleteComment(commentId)` — only by author
- `listComments(taskId) → Comment[]`
- `extractMentions(body)` — parses `@user:<id>` syntax, returns user IDs

Mentions:
- Markdown extension: `@user:<id>` (per `docs/dev/markdown-extensions.md`)
- Renderer resolves to display name
- On save, extracted user IDs stored on the comment row
- New built-in sidebar filter "Mentions me" → tasks where current user appears in any comment's `mentions`

History kinds added: `comment_added`, `comment_edited`, `comment_deleted` (taxonomy now 15 kinds, see B.4).

Size: **M**.

### CW-16 · History coalescing for `body_edited`
`appendHistory` gains a `coalesceWithin: { kind: "body_edited", windowMs: 900_000 }` option (or a wrapper helper).

When appending a `body_edited` entry:
- If the most recent entry on the same task is also `body_edited`
- Same `actor`
- `at` within 15 minutes

→ Update the existing entry's `at` instead of appending a new row. Supports auto-save without history spam. Size: **XS**.

### CW-19 · Recents tracking
New gitignored file `.loctt/users/<id>/recents.yaml`:
```yaml
recent_tasks: [<task_id>, ...]    # rolling, last 20
recent_searches: [{ query, at }, ...]   # rolling, last 20
```

Core ops:
- `recordTaskView(userId, taskId)` — append + dedupe + trim
- `recordSearch(userId, query)` — same pattern
- `getRecents(userId) → { tasks, searches }`

UI surfaces:
- "Recently viewed" entry in sidebar built-ins
- "Recent searches" dropdown when search bar is empty

Size: **S**.

## B.3 Query & evaluation extensions

### CW-6 · `listTasks` returns `total`
Pagination needs an unsliced count. Response becomes `{ items, total, offset, limit }`. Size: **XS**.

### CW-7 · `readHistory({ limit, offset }) → { entries, total }`
Server-side activity pagination. UI shows N at a time with Load more. Size: **XS**.

### CW-8 · `countTasksByReference(kind) → Record<key, number>`
Backend-computed reference counts for settings panels (labels/sprints/milestones/projects/custom fields). One scan, one map per kind. Wrappers: `GET /api/labels/counts`, etc. CLI/MCP equivalents. Size: **S**.

### CW-9 · DSL nested field access
Extend query DSL parser + evaluator to accept `field.subfield` syntax.
- `status.category` (resolves via workflow config lookup)
- Future-proofs `priority.value`, etc.

Saved views can express "show me anything not done" as `status.category not in (completed, discarded)`. Size: **S**.

### CW-21 · CSV / JSON export
Single endpoint `GET /api/export?format=csv|json&query=...&view=...`:
- Applies the same filter/sort as `listTasks`
- Returns all built-in fields + all custom fields
- CSV: standard, quoted, UTF-8 BOM
- JSON: array of task frontmatter objects

CLI: `loctt list --format csv > tasks.csv`. Size: **S**.

## B.4 Defaults & init

### CW-10 · Default workflow fixture
Replace hardcoded init workflow with the canonical fixture below. Init seeds this for every new tracker. **No preset selector** (B7 from the original audit, dropped).

```yaml
statuses:
  - { key: backlog,     label: "Backlog",     category: pending,   icon: archive,       color: "#94a3b8" }
  - { key: in_progress, label: "In progress", category: active,    icon: circle-dashed, color: "#3b82f6" }
  - { key: done,        label: "Done",        category: completed, icon: check-circle,  color: "#10b981" }
  - { key: wont_do,     label: "Won't do",    category: discarded, icon: x-circle,      color: "#64748b" }

priorities:
  # Order top→bottom = highest→lowest. `value` auto-computed on save by Settings drag-reorder.
  - { key: critical, label: "Critical", icon: chevrons-up,  color: "#ef4444" }
  - { key: high,     label: "High",     icon: chevron-up,   color: "#f97316" }
  - { key: medium,   label: "Medium",   icon: equal,        color: "#3b82f6" }
  - { key: low,      label: "Low",      icon: chevron-down, color: "#94a3b8" }

task_types:
  - { key: story,   label: "Story",   icon: bookmark,   color: "#8b5cf6" }
  - { key: bug,     label: "Bug",     icon: bug,        color: "#ef4444" }
  - { key: task,    label: "Task",    icon: circle-dot, color: "#64748b" }
  - { key: spike,   label: "Spike",   icon: zap,        color: "#f59e0b" }
  - { key: feature, label: "Feature", icon: sparkles,   color: "#a855f7" }

relationships:
  - { key: blocks,     label: "Blocks",     inverse: is_blocked_by,    inverse_label: "Is blocked by",    structural: true, ranked: true }
  - { key: parent,     label: "Parent",     inverse: child,            inverse_label: "Child",            structural: true, ranked: true }
  - { key: clones,     label: "Clones",     inverse: is_cloned_by,     inverse_label: "Is cloned by" }
  - { key: duplicates, label: "Duplicates", inverse: is_duplicated_by, inverse_label: "Is duplicated by" }
  - { key: causes,     label: "Causes",     inverse: is_caused_by,     inverse_label: "Is caused by" }
  - { key: relates_to, label: "Relates to", symmetric: true }

custom_fields: []

estimation:
  enabled: true
  unit: points
  unit_label: "pts"
  scale: free

timeline:
  dependency_relationship: blocks
  default_zoom: week
  show_arrows: true
  default_grouping: sprint
```

The first project created on init is auto-set as the workspace default. Init wizard collects: project name + prefix + skip-docs (no preset selector, no workspace name field). Size: **XS**.

### CW-18 · Schema-mismatch banner support
`getTrackerInfo` exposes a new `schema_status: "current" | "outdated"` field. UI surfaces a read-only banner blocking writes when `outdated`, instructing user to run `loctt migrate` from the CLI. (Migrate itself stays CLI-only per the C1 lock.) Size: **XS**.

## B.5 Cosmetic / supportive

### CW-11 · Bulk-op history `bulk_op_id`
History schema gains an optional `bulk_op_id` field. Set by CW-4 bulk ops. UI collapses entries sharing the same `bulk_op_id` into one expandable row. Size: **XS**.

### CW-20 · Attachment upload compression (UI-only)
Frontend converts uploaded images to JPG **or** WebP (whichever is smaller) before sending to the backend. No per-file size cap. Backend takes whatever bytes it gets and stores. No core change; entirely a UI concern. Listed here for visibility.

## B.6 History kind taxonomy (taxonomy)

Activity feed maps each kind → icon + sentence template. 15 kinds total after this pass:

| kind | meaning | icon |
|---|---|---|
| `created` | task created | ＋ |
| `field_change` | built-in field changed | → |
| `custom_field_change` | custom field changed | → |
| `label_added` | label added | # |
| `label_removed` | label removed | # (struck) |
| `archived` | archived | ▢ |
| `unarchived` | unarchived | ▣ |
| `link_added` | relationship added | ⇢ |
| `link_removed` | relationship removed | ⇢ (struck) |
| `body_edited` | body markdown changed (coalesced) | ✎ |
| `attachment_added` | file attached | 📎 |
| `attachment_removed` | file detached | 📎 (struck) |
| `comment_added` | comment posted | 💬 |
| `comment_edited` | comment edited | 💬 (✎) |
| `comment_deleted` | comment removed | 💬 (struck) |

Bulk ops collapse adjacent entries sharing `bulk_op_id` into one row.

## B.7 Core work — sizing summary

| ID | Item | Size |
|---|---|---|
| CW-1  | `workflow.timeline.*` schema extension | XS |
| CW-2  | `SavedView.display` block | S |
| CW-3  | `duplicateTask` | S |
| CW-4  | Bulk ops (set/unset/archive/delete/link) | M |
| CW-5  | `setFields` atomic multi-write | XS |
| CW-6  | `listTasks` returns `total` | XS |
| CW-7  | `readHistory` pagination | XS |
| CW-8  | `countTasksByReference` + endpoints | S |
| CW-9  | DSL nested field access (`status.category`, etc.) | S |
| CW-10 | Default workflow fixture (replaces preset machinery) | XS |
| CW-11 | Bulk-op `bulk_op_id` on history | XS |
| CW-12 | Project schema → ULID + name + prefix | M |
| CW-13 | `moveTaskToProject` + bulk variant | S |
| CW-14 | Comments + mentions module | M |
| CW-15 | `symmetric` flag on RelationshipDef | XS |
| CW-16 | History coalescing for `body_edited` | XS |
| CW-17 | `UserSettings.card_layout` as ordered array | XS (UI-only) |
| CW-18 | `schema_status` exposure for UI banner | XS |
| CW-19 | Recents tracking (`recents.yaml`, gitignored) | S |
| CW-20 | Frontend image compression on upload | UI-only |
| CW-21 | CSV / JSON export endpoint | S |

Total: **3 M + 8 S + 10 XS** = roughly 2-3 weeks of core work depending on tests and review cadence.

---

# Part C — UI work

All UI work depends on Part B landing first. Each subsection references
the CW items it consumes.

## C.1 App shell

**Header** (all routes):
- Brand + workspace mark (falls back to directory basename — no workspace.yaml)
- Global search input (uses `text ~ q` DSL, no FTS for v1)
- Theme toggle (light/dark/system)
- "+ New task" primary button → opens create-task modal
- User avatar → opens user menu (current user + switch user + Manage users… + My preferences…)

**Sidebar** (all routes except init):
- **View links**: List / Board / Timeline (active route highlighted)
- **Projects**: live list, badge with task count, ★ on default project
- **Saved filters**: 5 hardcoded built-ins (Assigned to me / Reported by me / Due this week / Overdue / High priority) + user's saved views, **identical visual treatment**. "+ New filter" entry opens saved-view editor. Edit pencil per row. Mention-built-in **"Mentions me"** added (CW-14).
- **Recently viewed** (CW-19): rolling list of last-viewed tasks
- **Milestones**, **Sprints**, **Labels**: live lists with counts
- **Archived** entry → opens archived list
- **Footer**: cwd, task count, default prefix, next key, Settings link

Sidebar collapse (icon-only mode) via header button or `[` key.

**Cross-tab sync**: TanStack Query with per-query `staleTime` + window-focus refetch. No websockets.

**Schema-mismatch banner** (CW-18): when `schema_status === "outdated"`, top-of-page red banner blocks writes and instructs user to run `loctt migrate` via CLI.

## C.2 List view (`/list` or `/`)

**Header row**:
- Page title + total count
- View-mode toggle (List / Board / Timeline)
- Saved-view selector dropdown (apply a saved view to the current list)

**Filter bar**:
- Multi-select dropdowns for Project / Status / Priority / Type / Assignee / Reporter / Label / Milestone / Sprint
- **"+ Field"** opens a picker for custom-field filter chips (from `list-view.yaml` allowlist + user override)
- "Show archived" checkbox
- "Save as view" button (pre-fills the saved-view editor with current chips)

**Filter pills**: dismissible chips for active filters; "Clear all" button.

**Bulk-edit toolbar** (sticky bottom, appears when ≥1 row selected) — uses CW-4:
- Set status / priority / assignee / milestone / sprint / labels
- Link to (target task picker)
- **Move to project** (uses CW-13 bulk variant)
- Archive (single confirm) / Delete (typed confirmation — "type DELETE")

**Table**:
- Sortable columns: key, project, title, status, priority, type, assignee, due, updated
- Per-user **column visibility + order** via `UserSettings.list_columns` (passthrough); Columns button opens a draggable list of columns (CW-17 pattern)
- Row click → task detail
- Inbound-relation hints under title ("blocked by WEB-127")
- Overdue due-date in red
- Archived rows grayed
- Assignee shown as avatar + name; archived users show grayed "(archived)" suffix

**Pagination**: limit + offset using `total` from CW-6. "Showing 1-50 of 128 · Load more".

## C.3 Board view (`/board`)

**Filter chips above board**: per-status visibility (replaces the dropped "Hide discarded" toggle). User toggles which status columns are visible. Persists in `UserSettings`.

**Columns**:
- From `workflow.statuses` (or `workflow.boards.columns` if defined)
- Column header: name, icon, count badge, **WIP indicator** (e.g. "5/3", red when over)
- Collapse button per column
- Cards sorted by `board_rank`

**Card layout** (`UserSettings.card_layout` ordered + visible per field, CW-17):
- Key + Title always shown
- User chooses which of Project / Priority / Assignee / Labels / Type / Due / Estimate / Milestone / Sprint / Relations appear, in what order
- Top-to-bottom in user-selected order
- Settings → Card layout panel: draggable list with visible checkbox per row, plus live preview card alongside

**Drag-drop**:
- Drag card between columns → uses **CW-5 `setFields`** to atomically update status + board_rank
- Drag within column → `reorderBoardRank`

**Per-status filter chips** (D13): no "Hide discarded" — users individually toggle each status's visibility.

**Inline "Add task" per column**: creates with status pre-set.

**Group-by selector**: none / assignee / priority / type / project / milestone / sprint / label. Adds swim lanes.

## C.4 Timeline view (`/timeline`)

**Header controls**:
- Zoom: day / week / month (default from CW-1 or per-view from CW-2)
- Group by: none / milestone / assignee / status / sprint (default from CW-1 / CW-2)
- Show arrows toggle (CW-1)
- Jump to today

**Chart**:
- Date axis with weekend shading (from `calendar.yaml`) and holiday shading
- Today vertical marker (workspace timezone)
- Bars for tasks with both start + due, colored by status category
- Diamonds for tasks with only `due_date`
- Dependency arrows from `workflow.timeline.dependency_relationship` (default `blocks`)

**Interactions** (all use **CW-5 `setFields`** for atomicity):
- Drag bar → move both dates, preserve duration
- Drag left/right handle → single date
- Drag diamond → move due_date
- All operations snap to day grid

## C.5 Task detail (`/tasks/:key`)

**Title row**:
- Task key (immutable display)
- Inline-edit title (TipTap minimal — single line, blur or Enter to save)
- **More menu** kebab: Copy key · Copy link · Duplicate (CW-3) · Move to project… (CW-13) · Delete (hard, typed confirm)
- Archive / Unarchive button

**Two-column layout** (desktop; stacks on tablet/phone):

### Left column

**Description editor**:
- Two-mode toggle: WYSIWYG (TipTap) / Markdown source (CodeMirror 6)
- Mode preference persisted per-user (`UserSettings.editor_mode`)
- **Auto-save with coalesced history** (CW-16): saves on 1.5s idle + on blur. `body_edited` entries within 15 min by same actor merge to a single entry, so the activity feed isn't spammed during a writing burst.
- "Unsaved" indicator while typing; "saved · just now" after auto-save
- Ctrl/Cmd+S still works (forces save now)
- **Lossy-content guardrail**: if markdown contains unrepresentable constructs, force source mode with a banner

**Comments** (new for v1, CW-14):
- New section below description
- List of comments, sorted oldest-first
- 1-level threading (replies to top-level only; nested replies show indented)
- Each comment shows author avatar + name + relative time + body (rendered markdown)
- Edit / delete actions on own comments
- Reply button on top-level comments
- New comment editor at bottom (TipTap; supports `@mention` autocomplete)
- Mentions become clickable; clicking opens that user's task list

**Related** (relationship panel):
- Grouped by relationship type (forward + inverse if not `symmetric`; combined under one heading if `symmetric: true` per CW-15)
- Each linked task: grip handle (for ranked rels), key, title, status badge of *that* task (resolved via core), remove button
- Drag-reorder for ranked rels uses `reorderRelationship`
- "+ Add link" → relationship picker + task picker

**Attachments grid**:
- MIME-aware thumbnails (image/video/audio inline; others as file chip)
- Hover-X to remove (uses `detachFile`)
- Drag-drop upload zone
- Frontend converts images to JPG/WebP before upload (CW-20)

**Activity feed**:
- Reverse chronological, grouped by day (user TZ)
- Each entry: kind→icon (from B.6 taxonomy), actor name, templated sentence, relative timestamp
- Bulk-op entries (CW-11): one collapsed row "Ken bulk-changed status on 50 tasks" with expand
- Pagination via CW-7 "Load more"

### Right column (meta panel)

All fields render as inline-editable rows:
- **Project** with "(immutable)" note — but with a "Move to project…" affordance opening CW-13 picker
- **Status** (dropdown)
- **Priority** (dropdown)
- **Type** (dropdown)
- **Assignee** (user picker; archived users grayed with "(archived)")
- **Reporter** (same)
- **Start date** / **Due date** (date pickers)
- **Completed date** (read-only, auto-set on status → completed)
- **Estimate** (free numeric input; `pts` suffix per workflow)
- **Milestone** (dropdown)
- **Sprint** (dropdown)
- **Labels** (multi-tag input, inline label creation)
- **Custom fields**: rendered per workflow.custom_fields (enum/number/date/boolean/string/multi)

Footer meta:
- Created / Updated relative time
- Key history if any: "WEB-128 → BACKEND-127" (e.g. after a move)

## C.6 Create task modal (launched from anywhere)

- Project picker (defaults to user default → workspace default → first project)
- "Next key" hint
- Title (autofocus, required)
- Status / Priority / Type / Sprint / Milestone / Assignee / Reporter dropdowns
- Labels multi-tag with **inline label creation** (prompts to register on new label)
- Start / Due date pickers
- Body editor (compact TipTap, no mode toggle in create flow)
- **"Create another"** checkbox at bottom-left — preserves project, type, etc.; clears title
- Cancel / Create
- On create → toast with "Open" link

## C.7 Init wizard (`/init` when `.loctt/` missing)

- Logo + heading + subtitle
- **Starting project** form: name + prefix (no `key`/slug; per CW-12)
- **Workflow note**: paragraph explaining what gets seeded (no preset selector — per CW-10)
- "Skip starter docs" checkbox
- Footer: auto-user note ("Default user: ken from $USER"), Cancel, Create tracker
- cwd display (monospace)

## C.8 Sprint detail (`/sprints/:key`)

- Sprint metadata header (label, dates, state, goal — all editable)
- **Burndown chart** from existing `computeBurndown` core
- Task list filtered to sprint, with full filter bar overlay

## C.9 Saved-view editor (modal, reachable from many places)

Two-mode editor (matches Jira's Basic/Advanced):

**Basic mode**:
- Filter rows: field dropdown + operator + value (typed per field — enum picker, user picker, date picker, etc.)
- "+ Add filter" appends a row
- AND between rows; visible labels
- Inline sort rows below filters: field + direction; drag-reorder for sort priority
- "+ Add sort"

**Advanced mode**:
- Raw DSL textbox with live parse-error markers
- Syntax-help popover: `text ~ q`, `today`, `parent`, `relationship.<type>`, `fields.<key>`, `status.category` (CW-9), AND/OR/NOT
- Switching Basic → Advanced is lossless (Basic generates DSL)
- Advanced → Basic only if expressible visually (otherwise toggle is disabled with tooltip)

**Footer**:
- Name input (warns on duplicate, doesn't block — per SV-6)
- Cancel / Delete (existing only) / Save

Reachable from:
- List/board/timeline filter bar ("Save as view…")
- Sidebar "Saved filters" group ("+ New filter" + edit pencil per saved view)
- View picker dropdowns ("+ New filter")
- Settings → Saved views (canonical CRUD list)
- "Edit" on a built-in filter opens a **Create** dialog with that built-in's DSL pre-populated (user names + saves a copy; built-ins themselves aren't editable, per SV-7)

## C.10 Settings (`/settings/<section>`)

Left nav grouped:
- **Workspace**: Projects · Users · General · Calendar
- **Workflow**: Statuses · Priorities · Task types · Relationships · Custom fields · Estimation · Board columns · Timeline
- **Data**: Labels · Milestones · Sprints · Saved views
- **Tracker**: Sync · Doctor
- **Personal**: My preferences · Card layout · Sidebar pins · Keyboard

Each panel below details what's different from a standard CRUD list.

### C.10.1 Projects
- CRUD on `ProjectDef` (CW-12 schema: id + name + prefix)
- Name editable; prefix immutable
- Set default (★)
- Archive / Unarchive
- Delete with remap target (uses existing `deleteProject(remapTo)`)
- Show-archived toggle
- Reference count badge per project (CW-8)

### C.10.2 Users
- List with avatar + name + email + timezone
- Archive (blocked on active user) / Unarchive
- Switch to (inline action)
- Delete with remap/unassign options
- Edit modal: name, email, **timezone editable here AND in My Preferences** (both write to same field; last write wins, per Q19)

### C.10.3 Statuses
- Drag-reorder (changes display order in pickers; category-based behavior preserved)
- Inline color swatch + icon picker per row
- Edit modal: key (immutable), label, category, icon, color
- Add: category dropdown (pending/active/completed/discarded)
- Reference count badge

### C.10.4 Priorities
- Drag-reorder. **Top = highest priority. `value` not displayed.** Values auto-computed on save based on position (top = highest N).
- Edit modal: label, icon, color (no value field per D20)

### C.10.5 Task types
- Standard CRUD + reorder. Edit modal: label, icon, color.

### C.10.6 Relationships
- CRUD with `structural`, `ranked`, **`symmetric`** flags (CW-15)
- Edit modal:
  - Symmetric checkbox: when on, inverse fields hidden
  - When off: forward label/key + inverse label/key
  - Structural checkbox: cycle-protected
  - Ranked checkbox: drag-reorderable
- One relationship designated as timeline dependency arrow source (configured in Timeline defaults panel)
- Row shows pill badges for each enabled flag

### C.10.7 Custom fields
- CRUD; type locked after creation
- Edit modal: label (mutable), `multi` flag, `searchable` flag, type-specific config (enum values for enum type)
- Reference count badge (CW-8)

### C.10.8 Estimation
- Toggle (enabled/disabled)
- Unit dropdown
- Unit label
- Scale: free / linear / fibonacci
- Preset values
- **Weights sub-table** (shown only when `unit: custom_enum`): one row per preset value with numeric input

### C.10.9 Calendar
- Timezone (string, IANA tz)
- First day of week
- Working days (7-day toggle bar)
- Holidays list with date + label, add/remove

### C.10.10 Labels
- CRUD + reorder + icon + color
- Reference count badge (CW-8)
- Archive / Unarchive + show-archived toggle
- Hard delete with remap target

### C.10.11 Milestones
- CRUD with target_date
- Archive / Unarchive
- Reference count badge

### C.10.12 Sprints
- CRUD with start/end/state/goal
- **Multiple `active` allowed** (Q10)
- Edit modal for state transitions; re-open completed uses `force: true` flag
- Reference count badge
- Link to per-sprint burndown page

### C.10.13 Saved views
- CRUD via the saved-view editor (C.9)
- Archive / Unarchive (CW per C5 in old plan; now standard)
- Show-archived toggle

### C.10.14 General
- **Default project** dropdown:
  - Specific project (workspace default)
  - **"No default — force picker"** (every create-task modal requires explicit pick)
  - On init, first-created project becomes default
- Schema version read-only pill
- *No workspace name field* (dropped per Q on Q8)

### C.10.15 Board columns
- CRUD on `workflow.boards.columns`
- Per column: name, statuses list (multi-pick from workflow.statuses), optional WIP int
- Empty state when no override: "Board shows 1 status = 1 column"

### C.10.16 Timeline defaults
- Dependency relationship (dropdown, sourced from workflow.relationships)
- Default zoom (day/week/month — CW-1)
- Show arrows toggle (CW-1)
- Default grouping (CW-1)
- Note: "Per-view overrides available via SavedView.display" (CW-2)

### C.10.17 Sync (Git)
- Enable / disable (with confirm dialog explaining sparse worktree teardown)
- Branch (read-only)
- Remote
- Auto-push / auto-fetch checkboxes
- Last synced commit + relative time
- Publish / Sync buttons

### C.10.18 Doctor
- "Re-run checks" button
- List of checks with status icons (ok / warn / error) and messages
- **No "Migrate now" button** (CLI-only per C1)
- **No "Rebuild key index" button** (CLI-only per C2)

### C.10.19 My preferences
- Theme: light / dark / system
- Date format
- Default view (list / board / timeline)
- Default sort
- Default project (overrides workspace default for own task creation)
- Timezone (editable; same field as Settings → Users edit for self)

### C.10.20 Card layout
- **Draggable list** of all available card fields (CW-17)
- Each row: grip handle + visibility checkbox + field name
- Drag to reorder
- Live preview card on the right

### C.10.21 Sidebar pins
- Draggable list of pinned items
- "+ Add pin" with picker (built-in name or saved view id)
- Drop silently if referenced view is deleted (Q7) — also remove the stale entry from config on next render

### C.10.22 Keyboard
- Static reference table of shortcuts (c / / / g l / g b / g t / [ / t / Esc / ?)

---

# Part D — Decision register

Numerically keyed for cross-reference from elsewhere.

## D-series (from main walkthrough)

| # | Topic | Locked decision |
|---|---|---|
| D1  | Built-in dynamic filters | 5 hardcoded: Assigned to me, Reported by me, Due this week, Overdue, High priority. UI-defined DSL strings. |
| D2  | Global search semantics | `text ~ q` DSL. No FTS for v1. |
| D3  | Bulk operations | Build bulk core ops (CW-4). One state-lock per call. Shared `bulk_op_id` in history. CLI + MCP wrappers + tests. |
| D4  | Body editor modes | WYSIWYG (TipTap) + Markdown source (CodeMirror 6). Auto-save on idle+blur (per Q18). |
| D5  | Task detail More menu | Copy key, Copy link, Duplicate, Move to project, Delete (hard, typed confirm). |
| D6  | Task duplication core op | Build `duplicateTask` (CW-3). |
| D9  | Timeline defaults storage | Both layers: workspace fallback (CW-1) + per-view override (CW-2). |
| D10 | Inline label creation in create-task modal | Allow. UI does `createLabel` then `createTask`. |
| D11 | Aggregate counts in settings | Backend-computed via `countTasksByReference` (CW-8). |
| D12 | Per-user column visibility on list | UserSettings passthrough. Combined with column order (CW-17 pattern). |
| D13 | Status-category access | Extend DSL with nested fields (CW-9). Drop "Hide discarded" toggle in favor of per-status filter chips. |
| D14 | `listTasks` pagination total | Add `total` to response (CW-6). |
| D15 | Activity pagination | Backend (CW-7). |
| D16 | Multi-field atomic write | Build `setFields` (CW-5). |
| D17 | Editor mode persistence | Per-user via UserSettings. |
| D19 | Timezone source-of-truth | Both forms editable; last write wins. |
| D20 | Priority value field | Drag-reorder recomputes values 1..N. `value` not displayed; only used for DSL sort. |

## SV-series (saved-view editor)

| # | Decision |
|---|---|
| SV-1 | Two-mode editor: Basic (chip builder) + Advanced (DSL textbox). |
| SV-2 | Editor reachable from list/board/timeline filter bars, sidebar Saved Filters, view picker dropdowns, Settings → Saved views. |
| SV-3 | Basic mode covers all DSL fields including custom fields and `relationship.<type>`. |
| SV-4 | Sort inline below filter rows. Drag-reorder for sort priority. |
| SV-5 | "Save as view" pre-fills editor from current filter chips. |
| SV-6 | Duplicate view names: warn, don't block. |
| SV-7 | Edit on built-in opens a Create dialog pre-populated; built-ins not editable in place. |

## C-series (capabilities surfaced/hidden)

| # | Capability | Decision |
|---|---|---|
| C1 | "Migrate now" in UI | **Drop** — CLI-only. Schema-mismatch banner (CW-18) directs to CLI. |
| C2 | "Rebuild key index" in UI | **Drop** — CLI-only. |
| C5 | Saved-view archive action | **Surface** in Settings → Saved views. |
| C7 | Relationship `structural` flag | **Surface** in Settings → Relationships edit modal. |
| C8 | Custom field `searchable` flag | **Surface** in Settings → Custom fields edit modal. |
| C9 | Custom field `multi` flag | **Surface** in Settings → Custom fields edit modal. |
| C10 | Estimation `weights` | **Surface** as sub-table when `unit: custom_enum`. |
| C15 | DSL `relationship.<type>` | **Surface** in saved-view editor syntax help. |
| C16 | DSL `parent` alias | **Surface** in syntax help. |

## B-series (mockup features)

| # | Feature | Outcome |
|---|---|---|
| B1  | Built-in dynamic filters | Locked under D1. UI-hardcoded. |
| B2  | Global search header | Locked under D2. |
| B3  | Per-user column visibility | UserSettings (CW-17). |
| B4  | Body editor modes | Locked under D4. |
| B5  | Lossy-content guardrail | UI-only. |
| B6  | Task detail More menu | Locked under D5. |
| B7  | Workflow preset selector | **Dropped.** Canonical workflow in CW-10. |
| B8  | Workspace name field | **Dropped.** Directory basename for display. |
| B9  | Timeline defaults persistence | CW-1 + CW-2. |
| B10 | Bulk operations | Locked under D3. |
| B11 | Inline label creation | Locked under D10. |
| B12 | Activity icons | UI-only, taxonomy in B.6 (15 kinds). |
| B13 | Task duplication | CW-3. |
| B14 | Link rows show target status | UI fetches each target. |
| B15-17 | Aggregate counts in settings | CW-8. |
| B18 | "Hide discarded" board toggle | **Dropped** in favor of per-status filter chips (D13). |
| B19 | Sort by every visible list column | Extend backend to sort all visible fields. |
| B20 | Atomic drag ops | CW-5. |
| B21 | `listTasks` returns total | CW-6. |
| B22 | Activity pagination | CW-7. |

## Q-series (extended pass)

| # | Topic | Decision |
|---|---|---|
| Q1  | Workspace default project | Configurable in General; "No default — force picker" allowed; on init, first project auto-becomes default. |
| Q2  | Body editor library | TipTap (WYSIWYG) + CodeMirror 6 (markdown source). |
| Q3  | Mockup DSL evaluator | Skip in mockup; leave TODO comment at DSL boundary in views.js. |
| Q4  | Cross-tab sync | TanStack Query `staleTime` + focus refetch. No websockets, no manual refresh button. |
| Q5  | Schema-mismatch banner | Build (CW-18). |
| Q6  | Card layout | Visibility + **ordering** via drag (CW-17). No positioning. |
| Q7  | Broken sidebar pins | Silently drop AND remove from config on next render. |
| Q8  | Archived user display | Grayed name + "(archived)" suffix. |
| Q9  | Activity feed grouping | User TZ. |
| Q10 | Sprint state | Multiple active allowed. |
| Q11 | Attachment limits | No per-file cap. Frontend converts images to JPG/WebP first (CW-20). |
| Q12 | Empty avatar | Initials in colored circle (hash-derived bg). |
| Q13 | Bulk-op confirmation | Bulk archive: simple confirm. Bulk delete: typed confirmation ("type DELETE"). |
| Q14 | List sort coverage | Extend backend to sort all visible fields. |
| Q15 | Sort-only saved views | Allowed. |
| Q16 | Empty states | Text-only. |
| Q17 | React routes | Clean paths (`/tasks/:key`, etc.). |
| Q18 | Body editor save | Auto-save on idle + blur. History coalesced within 15-min same-actor (CW-16). |
| Q19 | Relationship symmetry | `symmetric: true` flag on RelationshipDef (CW-15). |
| Q20 | Archived projects | Tasks still editable. |
| Q21 | Notifications | None v1. |
| Q22 | Recents | Local, gitignored, `.loctt/users/<id>/recents.yaml` (CW-19). |
| Q23 | i18n | English-only v1. |
| Q24 | Responsive | Three breakpoints (desktop/tablet/phone) from day one. |
| Q25 | Roles / permissions | None v1. |
| Q26 | Comments / mentions | Build full (CW-14): `_comments.yaml`, 1-level threads, `@mentions`, "Mentions me" filter. |
| Q27 | Time tracking | Skip v1. |
| Q28 | CSV / JSON export | Build (CW-21). |
| Q29 | Print stylesheets | Skip. |
| Q30 | Accessibility audit | Formal audit at React stage. |

## Project schema & task migration

| # | Decision |
|---|---|
| P-1 | Project schema: ULID id + name + prefix. No slug (CW-12). |
| P-2 | Tasks reference project by ULID. |
| P-3 | CLI/MCP accept project name (with ambiguity error) or ULID. |
| P-4 | UI displays name everywhere; ULID never shown. |
| P-5 | Prefix immutable after creation. |
| P-6 | Move task across projects: `moveTaskToProject` + bulk variant (CW-13). |
| P-7 | Move reallocates the task key in the destination project; old key preserved in `key_history`. |
| P-8 | Move UI: task detail More menu + bulk-bar action. |
| P-9 | Move atomicity: single `withStateLock` + journal entry + combined `project_changed` history entry. |

---

# Part E — Build phasing

Phases are linear; each phase completes (and passes tests) before the
next begins.

## Phase B-1 — Core schema breaking changes (highest risk first)
- CW-12 (project schema → ULID + name + prefix)
- CW-15 (`symmetric` flag on relationships)
- CW-10 (default workflow fixture)
- CW-17 (`card_layout` schema; UI-managed)
- CW-1 (timeline.* schema)
- CW-2 (SavedView.display)
- CW-18 (schema_status exposure)

These changes touch contracts and many call sites. Get them in early so subsequent work builds on stable types.

## Phase B-2 — Core new operations
- CW-3 (duplicateTask)
- CW-4 (bulk ops)
- CW-5 (setFields)
- CW-13 (moveTaskToProject + bulk variant)
- CW-14 (comments module + mentions)
- CW-19 (recents)

## Phase B-3 — Query / supportive
- CW-6 (listTasks.total)
- CW-7 (readHistory pagination)
- CW-8 (countTasksByReference)
- CW-9 (DSL nested fields)
- CW-11 (bulk_op_id in history)
- CW-16 (body_edited coalescing)
- CW-21 (CSV/JSON export)

## Phase C-1 — UI scaffolding
- Vite + React + TS + Tailwind + shadcn setup in `apps/web/`
- TanStack Query setup with `staleTime` per query type
- React Router with clean route map
- Typed API client (regenerated from contracts)
- Shell components: Header, Sidebar, UserMenu
- Theme + responsive breakpoint variables

## Phase C-2 — Read-only views
- List view (without bulk-bar yet)
- Board view (without drag yet)
- Timeline view (without drag yet)
- Task detail (without editing yet)
- Settings panels (read-only, listing only)

## Phase C-3 — Write paths
- Create task modal
- Task detail inline editing
- All settings CRUD
- Saved-view editor

## Phase C-4 — Interactive features
- Board drag-drop (uses CW-5)
- Timeline bar drag (uses CW-5)
- Bulk-edit toolbar (uses CW-4)
- Move to project (uses CW-13)
- Comments + mentions (uses CW-14)

## Phase C-5 — Polish
- Empty states
- Loading states
- Error boundaries
- Schema-mismatch banner (CW-18 surface)
- Accessibility audit (Q30)
- Frontend image compression (CW-20)
- CSV export button (CW-21 surface)
- Responsive tuning per breakpoint (Q24)
