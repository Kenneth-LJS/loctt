# Web app tickets (Part C of TEMP-UI-DISCREPANCIES.md)

Source of truth for building the LocTT web app. Tickets are ordered for
execution. Each ticket is sized roughly half-day to one-day, vertical
slice unless explicitly scaffolding.

## Stack

- **Framework**: React + Vite
- **Routing**: TanStack Router (typed routes + search params)
- **Data**: TanStack Query against the REST API at `apps/web/src/server/`.
  The API is the web app's implementation detail — there are no other
  consumers — so endpoints are rewritten freely to match the UI's data
  needs as we go (clean break, not incremental)
- **Styling**: Tailwind CSS + design tokens carried over from
  `temp-ui-mockups/tokens.css`
- **Body editor**: TipTap (rich) + CodeMirror 6 (raw markdown mode);
  both modes are first-class in v1
- **Theme**: light / dark / system

## Layout

The web app and its API live in one workspace at `apps/web/`:

- `apps/web/src/server/` — Node HTTP server, REST routes, API tests
- `apps/web/src/client/` — React app, components, hooks, client tests
- `apps/web/vite.config.ts` — dev server, proxies `/api` to the Node
  server

One `package.json`, one `npm run dev` runs both. If the API ever needs
to ship to external consumers, we split then.

## Testing

Per ticket, tests land alongside the implementation:

- **Backend**: API route tests with the core layer mocked. Asserts
  routes exist, validate input, call core with the right args, map
  errors to HTTP codes, and serialize the response shape. Core's
  business logic already has its own tests in `packages/core/` — don't
  retest it here
- **Frontend**:
  - Unit (Vitest + React Testing Library): hooks with mocked fetch,
    pure utilities (URL serialization, DSL helpers), reducer-like logic
  - Component: only for components with non-obvious logic (saved-view
    basic↔advanced sync, bulk-bar selection state). No
    "renders-without-crashing" tests
  - E2E (Playwright): one golden-path script per phase, run at the
    phase's milestone. Skipped for non-UI scaffolding phases
  - No snapshot tests

## Workflow per ticket

1. Implement on a working branch (no PR; this is a solo repo)
2. Spawn a code-review Agent on the changes → fix raised issues
3. Squash to one commit per ticket, message describes the feature
4. At **feature-complete milestones** (marked 🚦 below): hand off to user
   for a UI review. Out-of-scope items called out in the handoff
5. After user approval, any change requests go in a follow-up commit;
   then start the next ticket

`/ultrareview` is reserved for user-triggered milestone audits, not
between-ticket reviews.

## Status legend

- ⬜ not started
- 🔵 in progress
- ✅ done
- 🚦 feature-complete milestone (user review gate)

---

# Phase 0 — Foundation

Pure scaffolding. No UI to review; just code review.

### T0.1 · Workspace bootstrap ✅
- Move the existing Node API into `apps/web/src/server/` (so existing
  `server.ts` and friends sit under `server/`)
- Create the React app at `apps/web/src/client/`
- `vite.config.ts` with React plugin, alias to `@loctt/contracts` and
  `@loctt/core`, proxy `/api` to the Node server during dev
- TypeScript strict; ESLint + Prettier inheriting workspace config
- `apps/web/package.json` adds `react`, `react-dom`, vite, ts plugin
- Dev script: `npm run dev` runs API + Vite in parallel (concurrently)
- Smoke: `<App />` renders "LocTT" on `/`
- **Tests**: existing API tests keep passing after the move
- **Not in scope**: routing, data layer, theming, components

### T0.2 · Tailwind + design tokens ⬜
- `tailwind.config.ts` with theme extended from `tokens.css` values
  (colors, radii, shadows, spacing)
- `index.css` imports Tailwind + token CSS variables (light + dark
  scopes via `.dark` class on `<html>`)
- Token bridge: tokens stay in CSS variables; Tailwind references them
  via `var(--...)` so a theme switch flips everything
- Theme hook `useTheme()` (light / dark / system) writing to
  `localStorage.tt-theme` and toggling `<html class="dark">`
- Demo page showing primary/secondary/danger buttons + a card to
  verify tokens
- **Tests**: `useTheme` unit test (toggles class, persists, follows
  system preference)
- **Not in scope**: theme picker UI (lands in My Preferences ticket)

### T0.3 · TanStack Router skeleton ⬜
- Install `@tanstack/react-router`
- Code-based route tree (not file-based — explicit > magic for this app)
- Root layout `<AppShell />` with `<Outlet />`
- Routes registered as stubs returning a placeholder:
  `/`, `/list`, `/board`, `/timeline`, `/tasks/$key`, `/sprints/$key`,
  `/settings/$section`, `/init`
- Typed search params on `/list` (filters, sort, page) — schema with
  zod; URL is the source of truth
- 404 route
- **Tests**: search-param schema round-trip (parse → serialize → parse)
- **Not in scope**: actual view implementations

### T0.4 · TanStack Query + API client ⬜
- Install `@tanstack/react-query` + devtools
- `QueryClient` mounted in root with sane defaults (staleTime 30s,
  refetchOnWindowFocus false for now)
- `src/client/api/client.ts` — thin typed fetch wrapper that:
  - Sends `X-Loctt-Client` (existing CSRF header)
  - Throws typed `ApiError` on non-2xx with parsed body
  - Returns parsed JSON typed via a per-route response shape
- One query implemented end-to-end: `useInfo()` against `/api/info` to
  prove the pipe works
- Devtools toggle in dev only
- **Tests**: `apiClient` unit tests — CSRF header sent, ApiError shape
  on 4xx/5xx, JSON parsing. `useInfo` test with mocked fetch
- **Not in scope**: per-resource hooks (each lands with its view)

### T0.5 · Current-user + schema banner + migrate API ⬜ 🚦
- `useCurrentUser()` query + `<UserContext>` provider above all routes
- `useSchemaStatus()` query against `/api/info` exposing `schema_status`
- Red banner above `<AppShell />` when `schema_status === "outdated"`,
  blocking writes (read-only mode flag in context); copy from CW-18
- "Migrate now" button on the banner → `POST /api/migrate` →
  invalidates the schema-status query on success; toast on completion
- `POST /api/migrate` route in `apps/web/src/server/` that calls the
  core migration helper (whichever path the CLI uses today); returns
  the new schema status
- One-off test fixture for review: a temporary path (e.g. a
  `vite-env.d.ts`-controlled feature flag or a checked-in script) that
  forces `schema_status: "outdated"` from `/api/info` so the banner +
  migrate flow can be exercised end-to-end during review, then
  removed before the ticket commits
- Loading + error states for the bootstrap fetches (full-screen
  spinner; error page with retry)
- **Tests**: schema banner renders on `outdated`, hides on `ok`;
  read-only mode flag exposed correctly via context;
  `POST /api/migrate` route test (mocked core) asserts the right
  migration helper is called and the response shape
- **Review handoff (🚦)**: app boots, banner shows on stale schema
  via the test fixture, "Migrate now" calls the backend, banner
  clears on success

---

# Phase 1 — App shell + List view (first user-facing milestone)

### T1.1 · App shell layout ⬜
- Two-column shell: collapsible sidebar + main
- Header with logo, current-user avatar + menu (Switch user, Settings
  link, Theme toggle, Sign out is N/A — local app)
- Sidebar groups (per C.1):
  - Views: List / Board / Timeline (active state from router)
  - Projects
  - Saved filters: 5 built-ins + user saved views + "+ New filter"
  - Milestones
  - Sprints
  - Labels
  - **Recently viewed** (CW-19 — per-user)
  - Footer: cwd display + settings link
- Sidebar collapse persists to `localStorage`
- Empty states for each group ("No labels yet")
- **Tests**: sidebar groups render from store data, collapse state
  persists, active route highlighted
- **Not in scope**: saved-view editor (T7), recents pushing on detail
  view (T3), settings panels (Phase 8)

### T1.2 · List view — table + columns ⬜
- Route `/list` (and `/` redirects)
- Table renders: key, project, title, status, priority, type,
  assignee, labels, due, updated
- Sort by column header (single sort, dir indicator)
- Click row → navigate to task detail
- Per-user column visibility + order via `UserSettings.list_columns`
  (read for now; editor in T1.6)
- Empty state when no tasks
- Loading skeleton
- **Tests**: `GET /api/tasks` route test (mock core, assert pagination
  + sort args); useTasks hook test; sort header click toggles direction
- **Not in scope**: filters, bulk-bar, pagination

### T1.3 · List view — filter bar + URL state ⬜
- Filter dropdowns per C.2: Project, Status, Priority, Type, Assignee,
  Label, Milestone, Sprint, + custom field picker
- Active filters render as removable chips below the bar
- Filters serialize to typed URL search params via TanStack Router so
  the URL is shareable + back/forward works
- "Show archived" toggle
- "Save as view" button → opens saved-view editor (placeholder until T7)
- **Tests**: filter URL serializer (multi-value, escaping); chip
  remove updates URL; api request reflects active filters
- **Not in scope**: advanced DSL mode (T7); built-in dynamic filter
  click-through (T1.5)

### T1.4 · List view — pagination + bulk-bar ⬜
- Pagination using `total` from `/api/tasks` response (CW-6); "Showing
  1–50 of 128 · Load more" pattern
- Row checkboxes; select all on header
- Sticky bulk-bar appears on ≥1 selection (per C.2):
  - Set status / priority / assignee / milestone / sprint (CW-4)
  - Move to project (CW-13 bulk)
  - Archive / Unarchive
  - Delete (typed confirm)
  - Clear selection (×)
- All bulk calls use the existing core helpers' shared `bulk_op_id`
- **Tests**: API route tests for bulk endpoints (mocked core); UI test
  for selection state + bulk-bar visibility; pagination control test
- **Not in scope**: export (lands in T1.5)

### T1.5 · List view — built-in filters + export ⬜ 🚦
- Sidebar built-in filters wire to list view: Assigned to me, Reported
  by me, Mentions me (CW-14), Due this week, Overdue, High priority
- Clicking a built-in sets the URL filters and highlights the active row
- Export menu (CW-21): CSV + JSON download via `/api/tasks/export`
  with the current filter state applied
- **Tests**: export route returns correct content-type + filename;
  built-in filter click sets expected URL state. Playwright golden
  path: open `/list`, filter to High priority, export CSV, verify
  download
- **Review handoff (🚦)**: list view is fully functional —
  filter / sort / paginate / bulk / export / built-ins.
  Out of scope until later: saved-view editor (T7), task detail (T3)

---

# Phase 2 — Task detail

### T2.1 · Task detail — read shell ⬜
- Route `/tasks/$key`
- Breadcrumb (All tasks › Project) + title + chips (key, archived
  badge if applicable)
- Two-column layout: left (description, related, attachments,
  activity, comments), right (meta panel)
- `pushRecent` fires once per mount (CW-19)
- "More" menu: Copy key, Copy link, Duplicate (CW-3), Move to project
  (CW-13), Delete (hard, typed confirm)
- **Tests**: route resolves task by key; 404 page on unknown key;
  pushRecent fires once per mount, not on re-render
- **Not in scope**: any editing (T2.2+); attachments rendering (T2.5);
  comments (T2.4)

### T2.2 · Task detail — meta panel edits ⬜
- All meta rows inline-editable using `setField` / `setFields`:
  - Status, Priority, Type (dropdowns)
  - Assignee, Reporter (user pickers; archived users shown
    with "(archived)" suffix, not selectable for new picks)
  - Start / Due date (date inputs)
  - Estimate (free input; suffix from workflow.estimation)
  - Milestone, Sprint (dropdowns)
  - Labels (multi-tag with inline creation)
  - Custom fields (per workflow.custom_fields type)
- Completed date is read-only (auto)
- Footer: created/updated relative time + key_history if any (CW-13)
- Optimistic updates via TanStack Query
- **Tests**: API route tests for setField + setFields (mocked core,
  including archived-reference rejection); UI test that an inline
  field change posts the right payload and rolls back on error
- **Not in scope**: relationships, attachments, body, comments, activity

### T2.3 · Task detail — body editor ⬜
- TipTap rich editor (default mode)
- Mode toggle to CodeMirror 6 raw markdown
- Auto-save on 1.5s idle + on blur
- Coalesced `body_edited` history per CW-16
- Toolbar: bold, italic, code, code-block, link, list (ordered/
  unordered), heading levels, blockquote
- @mention autocomplete (users) wired here too so the description body
  supports mentions, not just comments
- **Tests**: idle-debounce auto-save fires once after a typing burst;
  mode toggle preserves content; mention picker filters by query
- **Not in scope**: image paste/upload (lands with attachments T2.5)

### T2.4 · Task detail — comments + activity ⬜
- Comments section per CW-14:
  - List sorted oldest-first
  - Each comment: avatar, name, relative time, rendered markdown body,
    mentions as chips, edit/delete on own comments
  - Composer at bottom (TipTap, simpler toolbar than body editor)
  - @mention autocomplete
- Activity feed:
  - Reverse-chronological, grouped by day
  - Consecutive `bulk_op_id` entries collapse to one expandable row
    (CW-11)
  - "Load more" using `readHistory` pagination (CW-7)
  - Kind icons per the B.6 taxonomy
- **Tests**: comments API routes (post/edit/delete) with mocked core;
  mention extraction round-trip; activity collapse groups consecutive
  bulk_op_id rows; load-more increments offset
- **Not in scope**: 1-level reply threading on comments (defer to v1.1
  unless trivial)

### T2.5 · Task detail — relationships + attachments ⬜ 🚦
- Relationships panel per C.5:
  - Grouped by relationship type (symmetric collapses forward + inverse
    under one heading per CW-15)
  - Drag-reorder for ranked relationships
  - "+ Add link" picker (relationship type + task search)
- Attachments grid:
  - MIME-aware thumbnails; image preview inline
  - Drag-drop upload zone
  - Hover-X to remove
  - Files upload raw (no compression — file attachments preserve the
    original bytes; CW-20 image compression applies only to profile
    pictures in T8.2)
- **Tests**: relationships API tests (link/unlink, ranked reorder);
  attachments API tests; UI test for drag-reorder updates board_rank
  equivalent; e2e Playwright golden path: open task → edit field →
  comment with mention → archive
- **Review handoff (🚦)**: task detail is fully functional end-to-end

---

# Phase 3 — Board view

### T3.1 · Board view — columns + cards ⬜
- Route `/board`
- Status chips bar (toggle visibility); persists in user settings
- Columns from `workflow.boards.columns` if set, else one column per
  status
- Card layout from `UserSettings.card_layout` (CW-17 — ordered + visible)
- WIP indicator per column
- Empty column placeholder
- Card click → task detail
- **Tests**: column derivation from workflow.boards.columns vs
  fallback (1 status = 1 column); WIP over-cap class applied; card
  layout respects UserSettings.card_layout
- **Not in scope**: drag-drop (T3.2), inline add (T3.3)

### T3.2 · Board view — drag + drop ⬜
- Drag card between columns → calls `setFields` (atomic status +
  board_rank) per CW-5
- Drag within a column to reorder → updates board_rank only
- Visual drop targets + animated reflow
- **Tests**: drop into a different column posts both status + new
  board_rank in one setFields call; intra-column reorder posts only
  board_rank
- **Not in scope**: keyboard drag

### T3.3 · Board view — inline add + filters ⬜ 🚦
- "+ Add task" button per column → opens create-task modal (T5)
  prefilled with that column's first status
- Share the list view's filter bar (filters apply to board too)
- **Tests**: e2e Playwright golden path: open `/board`, drag a card
  to a new column, verify URL state survives reload
- **Review handoff (🚦)**

---

# Phase 4 — Timeline view

### T4.1 · Timeline view — bars + grid ⬜
- Route `/timeline`
- Zoom: day / week / month (default from workflow.timeline CW-1 or
  per-view CW-2)
- Group by: none / milestone / assignee / status / sprint
- Bars rendered from start_date → due_date (or single-day if just one)
- Tasks without dates land in an "Unscheduled" lane
- **Tests**: bar geometry math (start/due → pixel offset/width at each
  zoom); grouping reducer collects tasks correctly per group key
- **Not in scope**: edge-drag (T4.2), dependency arrows (T4.3)

### T4.2 · Timeline view — drag interactions ⬜
- Drag bar body to shift dates (uses setFields per CW-5)
- Drag bar edges to resize start / due
- Tooltip during drag showing the new dates
- Snap to day grid; weekends/holidays shown faintly (calendar config)
- **Tests**: pixel-to-date snapping is symmetric (drag right by N
  days = start_date + N); edge drag preserves duration only on body
  drag, not edge drag
- **Not in scope**: arrows

### T4.3 · Timeline view — arrows + filters ⬜ 🚦
- Dependency arrows between tasks linked by the configured timeline
  relationship (workflow.timeline CW-1)
- Toggle arrows on/off
- Shared filter bar
- **Tests**: arrows only drawn for the configured timeline
  relationship; e2e Playwright golden path: open `/timeline`,
  edge-drag a bar, verify dates persisted
- **Review handoff (🚦)**

---

# Phase 5 — Create task modal

### T5.1 · Create task modal ⬜ 🚦
- Launched from "+" in header, "+ Add task" on board, "n" shortcut, etc.
- Fields per C.6: project, title, status, priority, type, sprint,
  milestone, assignee, reporter, labels (inline create), start/due,
  body (compact TipTap)
- "Create another" checkbox preserves project/type, clears title
- Cancel / Create
- Toast on create with "Open" link
- **Tests**: project resolver chain (explicit > user default > workspace
  default > first); "create another" preserves the correct fields
- **Review handoff (🚦)**

---

# Phase 6 — Init wizard

### T6.1 · Init wizard ⬜ 🚦
- Route `/init` shown when `/api/info` reports no `.loctt/`
- Form per C.7: starting project (name + prefix), skip-starter-docs
  checkbox
- Auto-user note (default user from $USER)
- cwd display
- On submit → POST /api/init → redirect to /list
- **Tests**: `/api/init` route (mocked core) validates prefix shape;
  app routes to `/init` when info says uninitialized
- **Review handoff (🚦)**

---

# Phase 7 — Saved-view editor

### T7.1 · Saved-view editor — basic mode ⬜
- Modal launched from list/board/timeline ("Save as view…"),
  sidebar ("+ New filter"), settings (Saved views CRUD)
- Filter rows: field + operator + value (typed widgets per field)
- AND between rows
- Sort rows below filters (field + direction, drag-reorder)
- Name input (warn on duplicate, don't block per SV-6)
- Save / Cancel / Delete (existing only)
- **Tests**: basic-mode form → DSL serializer round-trip; duplicate
  name warning behavior
- **Not in scope**: advanced DSL mode (T7.2)

### T7.2 · Saved-view editor — advanced DSL mode ⬜ 🚦
- Raw DSL textbox with live parse-error markers (zod / parser hook)
- Syntax-help popover listing aliases (text, today, parent,
  relationship.*, fields.*, status.category per CW-9)
- Basic → Advanced is lossless (Basic generates DSL)
- Advanced → Basic only when expressible visually (otherwise disabled
  toggle with tooltip)
- Editing a built-in opens this dialog with the built-in's DSL
  pre-populated for "save a copy" per SV-7
- **Tests**: basic↔advanced toggle: DSL generated from basic is
  re-parseable into basic; toggle disabled when advanced DSL is not
  expressible in basic
- **Review handoff (🚦)**

---

# Phase 8 — Settings

Each panel below is a ticket. They share a settings shell with the
nav from C.10.

### T8.0 · Settings shell ⬜
- Route `/settings/$section`
- Left nav grouped per C.10 (Workspace / Workflow / Data / Tracker /
  Personal)
- Section content slot
- Show-archived toggles where applicable
- **Tests**: nav active state from route param; unknown section 404s
- **Not in scope**: any actual panel

### T8.1 · Projects panel ⬜ 🚦
- CRUD per C.10.1; reference-count badge (CW-8); delete with remap
- **Tests**: projects CRUD API routes; reference-count endpoint; UI
  test for delete-with-remap flow
- **Review handoff (🚦)**: first settings panel — establishes the
  visual/interaction pattern for all subsequent panels. Reviewing
  this catches form layout, CRUD ergonomics, and remap UX issues
  before they propagate

### T8.2 · Users panel + profile pictures ⬜
- C.10.2; archive blocked on active user; switch / edit / delete
- **Profile picture upload (CW-20)**: avatar upload field on user edit
  modal. Frontend resizes/recompresses to JPG or WebP in the browser
  before POSTing (max 256×256 for the avatar bucket, configurable
  cap). Server stores the compressed bytes; no server-side resize
- **Tests**: users CRUD API routes; archive-blocked-when-active rule
  surfaces a 400; CW-20 image compressor unit test (jpeg in → smaller
  jpeg/webp out, dimensions clamped)

### T8.3 · Statuses + Priorities + Task types + Relationships ⬜
- C.10.3–C.10.6; drag-reorder; symmetric flag UX per CW-15
- **Tests**: reorder API routes; symmetric checkbox hides inverse
  fields; priority value auto-computed from position on save

### T8.4 · Custom fields + Estimation + Calendar ⬜
- C.10.7–C.10.9; type locked after creation; weights sub-table for
  custom enum
- **Tests**: type-immutable rule rejects type changes server-side;
  weights sub-table renders only when `unit: custom_enum`

### T8.5 · Labels + Milestones + Sprints ⬜ 🚦
- C.10.10–C.10.12; reference counts; sprint → burndown link
- **Tests**: CRUD routes + reference-count integration
- **Review handoff (🚦)**: data-section panels are complete (T8.2–T8.5
  covering Users, the four workflow panels, custom-fields cluster,
  and Labels/Milestones/Sprints)

### T8.6 · Saved views + General + Board columns + Timeline defaults ⬜
- C.10.13–C.10.16
- **Tests**: default-project picker writes to user settings (own) vs
  workspace config (admin) correctly

### T8.7 · Sync + Doctor ⬜
- C.10.17–C.10.18; doctor list of checks, no migrate/rebuild buttons
- **Tests**: doctor route shape; auto-push/fetch toggles persist

### T8.8 · Personal (My preferences + Card layout + Sidebar pins + Keyboard) ⬜ 🚦
- C.10.19–C.10.22; theme picker, card layout drag editor (CW-17),
  sidebar pins drag list with stale-entry sweep
- **Tests**: card layout reorder persists per user; sidebar pins
  silently drop references to deleted views on next read
- **Review handoff (🚦)**: settings are complete

---

# Phase 9 — Sprint detail

### T9.1 · Sprint detail page ⬜ 🚦
- Route `/sprints/$key`
- Editable metadata header (name, dates, state, goal)
- Burndown chart (uses existing `computeBurndown` core)
- Task list filtered to this sprint with the shared filter bar
- **Tests**: burndown route returns correct series shape; sprint
  metadata edits persist via setFields
- **Review handoff (🚦)**

---

# Phase 10 — Polish + v1 cut

### T10.1 · Keyboard shortcuts ⬜
- Global: `c` create, `/` focus search, `g l` / `g b` / `g t` view nav,
  `?` shortcuts overlay, `Esc` close
- Task detail: `[` archive, `t` toggle title edit
- Per C.10.22 reference table
- **Tests**: shortcut handler ignores keypresses while typing in
  inputs/textareas; sequence shortcuts (g l, g b) respect timeout

### T10.2 · Toasts + error boundaries ⬜
- Toast provider (queue, auto-dismiss, action link)
- Top-level error boundary with reload
- API error toasts for mutations
- **Tests**: toast queue dedupes by key; error boundary catches a
  thrown component and shows the reload prompt

### T10.3 · Loading + empty states sweep ⬜
- Audit every view for: loading skeleton, empty state, error state
- Consistent copy + iconography
- **Tests**: snapshot-free visual checks via Playwright on each
  view's three states (loading, empty, error)

### T10.4 · Final v1 review ⬜ 🚦
- Lighthouse pass on the main views
- a11y pass (focus traps in modals, aria-labels on icon buttons)
- README update
- Delete `temp-ui-mockups/` (the React app supersedes it)
- **Review handoff (🚦)**: ready to cut v1

---

# Out of scope for v1 (explicit)

- 1-level reply threading on comments (above flat thread); defer
- Realtime collaboration / live cursors
- Mobile-first layouts (responsive enough on tablet+; phone deferred)
- Org/multi-workspace switching
- Login / auth (local app)
- Notification center
- AI features / MCP UI surfaces

These exist to make scope rejections explicit; flag if any should
move back in.
