# Web app tickets (Part C of TEMP-UI-DISCREPANCIES.md)

Source of truth for building the LocTT web app. Tickets are grouped
into **four review milestones** (🚦). Each milestone is a working
slice you can use and review end-to-end. Sub-tickets inside a
milestone run sequentially with a code-review agent between each.

## Stack

- **Framework**: React + Vite
- **Routing**: TanStack Router (typed routes + search params)
- **Data**: TanStack Query against the REST API at `apps/web/src/server/`.
  The API is the web app's implementation detail — there are no other
  consumers — so endpoints are rewritten freely to match the UI's data
  needs as we go (clean break, not incremental).
- **Styling**: Tailwind CSS v4 + design tokens carried over from
  `temp-ui-mockups/tokens.css`
- **Body editor**: TipTap (rich) + CodeMirror 6 (raw markdown mode);
  both modes are first-class in v1
- **Theme**: light / dark / system

> **Stack drift — check before relying on this list.** As of
> 2026-08-15: **TipTap is installed** (`@tiptap/*` 3.30.1, including the
> table extensions). **CodeMirror 6 and Playwright are not.**
>
> Playwright matters beyond the editor: several milestone gates below
> carry an `**E2E**` bullet, and `npm run test:e2e` runs **vitest**
> against CLI-driven journeys (`tests/e2e/`), not a browser. Those
> bullets therefore describe tooling that is neither installed nor
> wired. Either install and wire Playwright, or reword the gates to
> match what actually runs — do not read them as satisfied by the
> current `test:e2e`.

## Layout

The web app and its API live in one workspace at `apps/web/`:

- `apps/web/src/server/` — Node HTTP server, REST routes, API tests
- `apps/web/src/client/` — React app, components, hooks, client tests
- `apps/web/vite.config.ts` — dev server, proxies `/api` to the Node
  server

## Testing

Per ticket, tests land alongside the implementation:

- **Backend**: API route tests with the core layer mocked. Asserts
  routes exist, validate input, call core with the right args, map
  errors to HTTP codes, and serialize the response shape. Core's
  business logic already has its own tests in `packages/core/` —
  don't retest it here
- **Frontend**:
  - Unit (Vitest + React Testing Library): hooks with mocked fetch,
    pure utilities (URL serialization, DSL helpers), reducer-like
    logic
  - Component: only for components with non-obvious logic. No
    "renders-without-crashing" tests
  - E2E (Playwright): one golden-path script per milestone, run at
    the milestone's review gate
  - No snapshot tests

## Workflow per ticket

1. Implement on the working branch (no PR; solo repo)
2. Spawn a code-review Agent on the changes → fix raised issues
3. Squash to one commit per ticket
4. Move to the next ticket
5. At each **review milestone (🚦)**: hand off to user. The handoff
   names the feature, integration points, what works, and what's
   explicitly out of scope (coming in a later milestone)
6. User approval → next milestone

`/ultrareview` stays reserved for user-triggered audits at milestone
boundaries.

## Status legend

- ⬜ not started
- 🔵 in progress
- ⚠️ built but defective — the code exists and does not work
- ✅ done **and working**
- 🚦 review milestone (user review gate)

`⚠️` exists because the ✅/⬜ binary is what let "built but broken"
hide: three tickets were ticked or untracked while their code shipped a
defect. With `⚠️` available, `✅` can mean what a reader assumes it
means.

---

# Phase 0 — Foundation ✅

Pure scaffolding, all done. No standalone review.

- T0.1 ✅ Workspace bootstrap (Vite + React + parallel dev script)
- T0.2 ✅ Tailwind v4 + design tokens + `useTheme` hook
- T0.3 ✅ TanStack Router skeleton + typed list search params (zod)
- T0.4 ✅ TanStack Query + typed API client + `useInfo` hook

---

# Milestone 1 — App shell + read-only list view 🚦

Goal: a working list view inside the real chrome. By the end you can
load the app, see your tasks, sort/filter/paginate them by URL state,
and click into any task (which routes to a stub for now).

### M1.1 · App shell layout ✅
- Two-column shell: collapsible left sidebar + main pane
- Header: logo, current-user avatar + menu (Switch user, Settings,
  Theme toggle), `+` create-task button (stub)
- Sidebar groups per `temp-ui-mockups`:
  - Views (List / Board / Timeline) with active route highlight
  - Projects (list, default highlighted)
  - Saved filters (built-ins: Assigned to me / Reported by me /
    Mentions me / Due this week / Overdue / High priority) + user
    saved views + "+ New filter" (opens stub editor)
    - **5 built-ins are fully live** (click-through to URL filter
      state + live count badges via `/api/tasks` total). **"Mentions
      me" defers to M2.4** — it needs a comment-scan route that lands
      with comments; until then it renders without a count and is
      non-interactive.
  - Milestones · Sprints · Labels · Recently viewed
    - **Recently viewed**: read route (`GET /api/recents`) pulled
      forward to M1.1 so the group is live. The *write* (`pushRecent`
      on task-detail mount) inherently belongs to M2.1 — a fresh
      tracker shows an empty group until a task has been opened.
  - Footer: cwd + Settings link
- Sidebar collapse state persists to `localStorage`
- Schema-mismatch banner (CW-18) — surfaces above the shell when
  `schema_status` is `outdated` / `future` / `unknown`. The banner is
  read-only in M1.1; the **"Migrate now" button + `POST /api/migrate`
  endpoint move to M4** (see M4.x). Until then `outdated` tells the
  user to run `loctt migrate` in the CLI.
- `useCurrentUser`, sidebar data hooks (projects, saved views,
  labels, milestones, sprints, recents)
- New server route: `GET /api/recents` (read-only; lists current
  user's recent tasks resolved to frontmatter).
- **Tests**: sidebar groups render from query data, collapse state
  persists, active route highlighted; schema banner renders for each
  non-current kind; `GET /api/recents` route (mock core)

> **Was ⚠️ (built but broken).** All five built-in resolvers embedded
> `status.category not in [completed, discarded]`, and the tokenizer has
> no `[` token — so every count badge and click-through errored at
> runtime. Fixed in `36c8872`. Re-verified against a running app: the
> built-in DSL and `?priority=high,critical` both return 200 with
> results, so the mark is now ✅.

### M1.2 · List view — table + columns ✅
- Route `/list` (and `/` redirects)
- Table: key, project, title, status, priority, type, assignee,
  labels, due, updated
- Sort by column header (single sort, dir indicator)
- Click row → `/tasks/$key` (target route still a stub until M2)
- Per-user column visibility + order via `UserSettings.list_columns`
  (read; editor lives in settings, M4)
- Empty state + loading skeleton
- **Tests**: `GET /api/tasks` route (mock core); useTasks hook; sort
  header click toggles direction

> **Was ⚠️ (built but broken).** Its own data path carried the same
> bracket-list defect (`server.ts` `buildStructuredQuery`), so
> `GET /api/tasks?status=a,b` returned 500. Only the single-value path
> was tested. Fixed in `36c8872`, re-verified against a running app.
> LST-1 and LST-2 are now covered by Playwright specs in `tests/ui/`.

### M1.3 · List view — filter bar + URL state ✅
- Filter dropdowns: Project, Status, Priority, Type, Assignee, Label,
  Milestone, Sprint, + custom-field picker
- Active filters render as removable chips
- Filters serialize to typed URL search params (the zod schema from
  T0.3); URL is the source of truth, back/forward works
- "Show archived" toggle
- Built-in dynamic filter click-through (Assigned to me, etc.) sets
  the right URL state
- "Save as view" opens **basic-mode saved-view editor** (advanced DSL
  mode defers to a later milestone; basic is enough to validate)
- **Tests**: filter URL serializer; chip remove updates URL; API
  request reflects active filters; built-in click sets expected state

> **⚠️ Was ⬜ while built.** All six bullets were implemented and
> untracked (`FilterBar.tsx`, `buildDsl.ts`, `SaveViewDialog.tsx`,
> `FilterDropdown.tsx`, `useCreateView.ts`, `ui/Modal.tsx`), so the
> ticket understated the work — but `buildDsl.ts` emitted the same
> unparseable bracket list, and `buildDsl.test.ts` asserted the broken
> output, keeping the suite green. Bracket defect fixed in `36c8872`;
> query validation on `POST /api/views` fixed in `6536462` (core's
> `createView` rejects a bad query, and the route surfaces it as a
> field-level error on `query`). Both re-verified, so the mark is ✅.

### M1.4 · List view — pagination + bulk-bar + export ⬜
- Pagination using `total` from `/api/tasks`; "Showing 1–50 of 128 ·
  Load more" pattern
- Row checkboxes; select-all in header
- Sticky bulk-bar on ≥1 selection: Set status / priority / assignee /
  milestone / sprint, Move to project (CW-13 bulk), Archive,
  Delete (typed confirm), Clear (×)
- Export menu (CW-21): CSV + JSON via `/api/tasks/export` with the
  current filter state applied
- **Tests**: bulk endpoints (mocked core); selection state + bar
  visibility; export route content-type + filename
- **E2E**: open /list → filter by High priority → export CSV → verify
  download. *(Needs Playwright, which is not installed — see the stack
  note. `npm run test:e2e` will not cover this.)*

### 🚦 Milestone 1 review
- App shell matches the mockup; list view fully functional —
  filter / sort / paginate / bulk / export
- Out of scope: task detail (M2), board (M3), timeline (M3), settings
  (M4), advanced DSL editor (M4), init wizard (M4), comments / mentions
  / activity (M2)

---

# Milestone 2 — Task detail (read + write) 🚦

Goal: clicking a task opens the full detail view. You can edit every
field inline, write the description body, post comments, see history.

### M2.1 · Task detail — read shell ⬜
- Route `/tasks/$key` (real component, replacing the stub)
- Breadcrumb (All tasks › Project) + title + chips (key, archived
  badge)
- Two-column layout: left (description, related, attachments,
  activity, comments), right (meta panel — read-only first pass)
- `pushRecent` on mount (CW-19) — updates the "Recently viewed"
  sidebar group from M1
- "More" menu: Copy key, Copy link, Duplicate (CW-3), Move to
  project (CW-13), Delete (typed confirm)
- **Tests**: route resolves task by key; 404 on unknown; pushRecent
  fires once per mount

### M2.2 · Task detail — meta panel edits ⬜
- All meta rows inline-editable via `setField` / `setFields`:
  - Status, Priority, Type (dropdowns)
  - Assignee, Reporter (user picker; archived users greyed +
    "(archived)" suffix)
  - Start / Due date (date inputs)
  - Estimate (workflow.estimation suffix)
  - Milestone, Sprint (dropdowns)
  - Labels (multi-tag with inline label creation)
  - Custom fields (per workflow.custom_fields type)
- Completed date is read-only (auto)
- Footer: created/updated relative time + key_history if any
- Optimistic updates via TanStack Query
- **Tests**: API setField/setFields routes (mock core, incl.
  archived-reference rejection); UI test that inline edit posts the
  right payload and rolls back on error

### M2.3 · Task detail — body editor (TipTap + CodeMirror) ⬜
- TipTap rich editor (default mode), mode toggle to CodeMirror 6
  raw markdown
- Auto-save on 1.5s idle + on blur; coalesced `body_edited` history
  (CW-16)
- Toolbar: bold, italic, code, code-block, link, list, heading,
  blockquote
- @mention autocomplete (users)
- **Tests**: idle-debounce auto-save fires once after typing burst;
  mode toggle preserves content; mention picker filters by query

### M2.4 · Task detail — comments + activity ⬜
- Comments section per CW-14: list (oldest-first), composer (TipTap),
  edit/delete on own comments, @mention autocomplete, mentions as
  chips
- Activity feed: reverse-chronological grouped by day; consecutive
  bulk_op_id entries collapse to one expandable row (CW-11); "Load
  more" using `readHistory` pagination (CW-7); kind icons
- **Tests**: comments routes; mention extraction round-trip; activity
  collapse + load-more

### M2.5 · Task detail — relationships + attachments ⬜
- Relationships panel: grouped by type (symmetric folds forward +
  inverse under one heading per CW-15); drag-reorder for ranked rels;
  "+ Add link" picker (rel type + task search)
- Attachments grid: MIME-aware thumbs (image previews inline);
  drag-drop upload; hover-X to remove. Files upload raw, no
  compression — image compression is profile-pictures-only and lands
  in M4
- **Tests**: relationships API; attachments API; drag-reorder updates
  rank
- **E2E**: open task → edit field → comment with @mention → archive

### 🚦 Milestone 2 review
- Task detail end-to-end. All edits, body editor, comments,
  attachments, activity
- Out of scope: board (M3), timeline (M3), settings (M4),
  create-task modal (M3), saved-view advanced DSL (M4)

---

# Milestone 3 — Board, Timeline, Create modal 🚦

Goal: alternative views work, and the universal "+ Add task" creates
tasks from anywhere.

### M3.1 · Board view ⬜
- Route `/board`
- Status chips bar (toggle visibility), persists in user settings
- Columns from `workflow.boards.columns` if set, else 1-status-per-col
- Card layout from `UserSettings.card_layout` (CW-17 ordered +
  visible)
- WIP indicator per column; empty-column placeholder; card click →
  detail
- **Tests**: column derivation; WIP over-cap class; card layout
  respects user settings

### M3.2 · Board view — drag-drop ⬜
- Drag card between columns → `setFields` atomic status + board_rank
  (CW-5)
- Drag within column → board_rank only
- Visual drop targets + animated reflow
- **Tests**: drop into different column posts status + new
  board_rank in one call; intra-column posts board_rank only

### M3.3 · Timeline view ⬜
- Route `/timeline`
- Zoom day/week/month (default from workflow.timeline CW-1 or
  saved-view CW-2)
- Group by none/milestone/assignee/status/sprint
- Bars from start_date → due_date; tasks without dates in an
  "Unscheduled" lane
- Edge-drag bar to resize; body-drag to shift; snap to day grid;
  weekends/holidays faintly drawn from calendar config
- Dependency arrows for the configured timeline relationship (CW-1);
  toggle on/off
- **Tests**: bar geometry math; pixel-to-date snapping; arrows only
  drawn for the configured relationship

### M3.4 · Create task modal ⬜
- Launched from `+` in header, "+ Add task" on board columns, `n`
  shortcut
- Fields per C.6: project, title, status, priority, type, sprint,
  milestone, assignee, reporter, labels (inline create), start/due,
  body (compact TipTap)
- "Create another" preserves project/type, clears title
- Toast on create with "Open" link
- **Tests**: project resolver chain (explicit > user default >
  workspace default > first); "create another" preserves the right
  fields
- **E2E**: open /board → drag card → open /timeline → edge-drag bar →
  hit `n` → create task

### 🚦 Milestone 3 review
- Board, Timeline, Create modal all functional. Filter bar is shared
  across List + Board + Timeline
- Out of scope: settings (M4), init wizard (M4), sprint detail (M4),
  saved-view advanced DSL (M4)

---

# Milestone 4 — Settings, init, polish, v1 cut 🚦

Goal: settings panels work end-to-end, the init wizard handles
first-run, and the v1 polish (keyboard, errors, a11y) is done.

### M4.1 · Settings shell + Projects + Users (with profile pics, CW-20) ⬜
- Route `/settings/$section`; nav grouped (Workspace/Workflow/Data/
  Tracker/Personal)
- Projects panel: CRUD with reference-count badge (CW-8), delete with
  remap
- Users panel: CRUD; archive blocked on active user; switch/edit/
  delete; **avatar upload with frontend image compression (CW-20)** —
  resize/recompress to JPG/WebP in browser before POST (max 256×256
  for avatar bucket)
- **Tests**: CRUD routes; reference-count endpoint; CW-20
  compressor (jpeg in → smaller jpeg/webp, dimensions clamped)

### M4.2 · Settings — workflow panels ⬜
- Statuses + Priorities + Task types + Relationships (C.10.3–C.10.6);
  drag-reorder; symmetric flag UX per CW-15
- Custom fields + Estimation + Calendar (C.10.7–C.10.9); type locked
  after creation; weights sub-table for custom enum
- **Tests**: reorder routes; symmetric checkbox hides inverse fields;
  priority value auto-computed from position

### M4.3 · Settings — data panels ⬜
- Labels + Milestones + Sprints (C.10.10–C.10.12); reference counts;
  sprint → burndown link
- Saved views + General + Board columns + Timeline defaults
  (C.10.13–C.10.16)
- Sync + Doctor (C.10.17–C.10.18); doctor list of checks; rebuild
  stays CLI-only
- **Schema migrate (moved from M1.1)**: rebuild `POST /api/migrate`
  (core `migrateToCurrent`) + `MigrateResponse` contract +
  `useMigrate` hook, and wire the schema banner's "Migrate now" button
  for the `outdated` kind. Update the stale "migration is CLI-only"
  comment in `packages/contracts/src/service.ts`.
- **Tests**: doctor route shape; auto-push/fetch toggles persist;
  migrate happy-path returns schema to `current` + banner clears

### M4.4 · Settings — personal + keyboard ⬜
- My preferences + Card layout + Sidebar pins + Keyboard reference
  (C.10.19–C.10.22); theme picker; card layout drag editor (CW-17);
  sidebar pins drag list with stale-entry sweep
- **Tests**: card layout reorder persists per user; sidebar pins
  **surface** deleted-view references rather than dropping them
  silently — P7 admits no carve-out for per-user preference drift
  (resolved in 0k), so a pinned view deleted from `queries.yaml` tells
  the user it was removed.

### M4.5 · Saved-view editor — advanced DSL mode ⬜
- Raw DSL textbox with live parse-error markers
- Syntax-help popover (text, today, parent, `has_link(...)`,
  `link_count(...)`, fields.*, status.category per CW-9). The
  `relationship.*` grammar this originally named was removed in
  `1a2b77d`; the editor must not offer it.
- Basic → Advanced is lossless; Advanced → Basic disabled when not
  expressible visually
- Editing a built-in opens with the built-in's DSL pre-populated
- **Tests**: round-trip parse; toggle disabled correctly

### M4.6 · Init wizard ⬜
- Route `/init` shown when `/api/info` reports uninitialized
- Form per C.7: project (name + prefix), skip-starter-docs
- Auto-user note (default user from $USER), cwd display
- On submit → `POST /api/init` → redirect to `/list`
- **Tests**: `/api/init` route; app routes to `/init` when
  uninitialized

### M4.7 · Sprint detail ⬜
- Route `/sprints/$key`
- Editable metadata header (name, dates, state, goal)
- Burndown chart (existing `computeBurndown` core)
- Task list filtered to sprint with the shared filter bar
- **Tests**: burndown route shape; metadata edits persist

### M4.8 · Polish + v1 cut ⬜
- Keyboard shortcuts (n, /, g l/b/t, ?, Esc, [, t per C.10.22)
- Toast provider + top-level error boundary + API error toasts
- Loading + empty + error states swept across every view
- a11y: focus traps in modals, aria-labels on icon buttons
- Lighthouse pass on main views
- README update. **Keep `temp-ui-mockups/`** — it is a design reference,
  not scaffolding, and `tokens.css` is the upstream source of the app's
  design tokens. See `temp-ui-mockups/README.md`.
- **E2E**: full v1 happy-path

### 🚦 Milestone 4 review (v1 cut)
- All settings panels, init, sprint detail, polish. Ready to ship v1

---

# Out of scope for v1 (explicit)

- 1-level reply threading on comments
- Realtime collaboration / live cursors
- Mobile-first layouts (responsive enough on tablet+; phone deferred)
- Org/multi-workspace switching
- Login / auth (local app)
- Notification center
- AI features / MCP UI surfaces

Flag if any should move back in.
