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
> 2026-08-15: **TipTap** (`@tiptap/*` 3.30.1), **CodeMirror 6**, and
> **Playwright** are all installed.
>
> Two commands, two meanings: `npm run test:e2e` runs **vitest** against
> CLI-driven journeys (`tests/e2e/`), while `npm run test:ui` runs
> **Playwright** against a real browser and a real `loctt ui` server
> (`tests/ui/`). The `**E2E**` bullets below mean the latter.

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
Cases: SHL-1, SHL-2, SHL-3, SHL-4, SHL-5, SHL-6, SHL-7, SHL-8, SHL-9, SHL-10, SHL-11, SHL-12, SHL-13, SHL-14, SHL-15, SHL-16, SHL-17, SHL-18, SHL-19, SHL-20, SHL-21, SHL-22, SHL-23, SHL-24, SHL-25, SHL-26, SHL-27, SHL-28, SHL-29, SHL-30, SHL-31, SHL-32, SHL-33, SHL-34, SHL-35, SHL-36, SHL-37, SHL-38, SHL-39, SHL-40, SHL-41, SHL-42, SHL-43, SHL-44, VUE-1, VUE-2, VUE-16, VUE-24, ONB-9, ONB-10, ONB-13, ONB-14, ONB-23, ONB-34, ERR-28, ERR-29, ERR-34, ERR-35, ERR-36, ERR-37, XS-2, XS-3, XS-28, XS-33, XS-34, XS-35, XS-37, XS-61, XS-62, XS-32, PRU-2
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
Cases: LST-1, LST-2, LST-3, LST-4, LST-5, LST-6, LST-7, LST-8, LST-19, LST-20, LST-21, LST-22, LST-23, LST-24, LST-25, LST-26, LST-27, LST-28, LST-36, LST-37, LST-39, LST-47, LST-51, ONB-8, ONB-12, ONB-26, ONB-24, ONB-33, ERR-1, ERR-2, ERR-5, ERR-6, ERR-9, ERR-10, ERR-14, ERR-15, ERR-16, ERR-17, ERR-18, ERR-19, ERR-20, ERR-21, ERR-22, ERR-30, ERR-31, ERR-39, ERR-40, ERR-41, ERR-42, XS-1, XS-5, XS-22, XS-24, XS-39, XS-40, XS-56, MSL-21, MSL-22, MSL-23, MSL-26, PRU-3
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
Cases: LST-9, LST-10, LST-11, LST-12, LST-14, LST-15, LST-16, LST-17, LST-29, LST-31, LST-32, LST-33, LST-34, LST-40, LST-41, LST-42, LST-44, LST-45, LST-46, LST-50, LST-52, VUE-3, VUE-4, VUE-5, VUE-6, VUE-7, VUE-13, VUE-14, VUE-15, XS-15, XS-16, XS-17, XS-18, XS-20, XS-21, XS-23, XS-29, XS-30, XS-59, XS-60, MSL-6, MSL-7, MSL-30, MSL-36, MSL-19
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

### M1.4 · List view — pagination + bulk-bar + export 🔵
Cases: LST-13, LST-30, LST-35, LST-38, LST-43, LST-49, BLK-1, BLK-2, BLK-3, BLK-4, BLK-5, BLK-6, BLK-7, BLK-8, BLK-9, BLK-10, BLK-11, BLK-12, BLK-13, BLK-14, BLK-15, BLK-16, BLK-17, BLK-18, BLK-19, BLK-20, BLK-21, BLK-22, BLK-23, BLK-24, BLK-25, BLK-26, BLK-27, BLK-28, BLK-29, BLK-30, BLK-31, BLK-32, BLK-33, BLK-34, BLK-35, BLK-36, BLK-37, BLK-38, BLK-39, BLK-40, BLK-41, BLK-42, BLK-43, BLK-44, BLK-45, BLK-46, BLK-47, BLK-48, ERR-13, ERR-25, ERR-26, XS-6, XS-19, LST-18, LST-48, ONB-25
- ✅ Pagination using `total` from `/api/tasks`; "Showing 1–50 of 128 ·
  Load more" pattern. Covers LST-13, LST-17, LST-30, LST-35, LST-43,
  LST-49 — Playwright specs in `tests/ui/flow-list.spec.ts`
- ✅ Row checkboxes; select-all in header. Covers BLK-1, BLK-2, BLK-3,
  BLK-4, BLK-18. Bar shows count + scope + Clear; actions below are
  still unbuilt, so it carries no action buttons yet
- 🔵 Sticky bulk-bar: Set status / priority, Archive, Delete (typed
  confirm), Clear (×) — covers BLK-5, 10, 11, 12, 13, 38, 39, 40.
  **Not built**: Set assignee / milestone / sprint (BLK-7, 8), Move to
  project (BLK-9, 26), Undo after archive (BLK-10's undo bullet)
- ✅ Export menu (CW-21): CSV + JSON via `/api/tasks/export` with the
  current filter state applied. Covers BLK-14, 15, 16, 33, 35, 37
- **Tests**: bulk endpoints against a real tracker (not mocked);
  selection state + bar visibility; export route content-type + filename

**All 13 BLK blockers are covered. 29 major/minor BLK cases are not** —
chiefly the remaining Set-field pickers, Move to project, undo, and the
concurrency/scale cases (BLK-22, 23, 24, 34, 41, 42). M1.4 is not done.
- **E2E**: open /list → filter by High priority → export CSV → verify
  download. Playwright is now installed (`npm run test:ui`); the
  bulk/export specs still need writing.

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
Cases: TSK-1, TSK-2, TSK-3, TSK-19, TSK-20, TSK-21, TSK-22, TSK-23, TSK-24, TSK-43, TSK-44, TSK-45, TSK-50, TSK-51, TSK-52, TSK-53, TSK-54, XS-51, XS-58, ERR-8, ERR-7
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
Cases: TSK-4, TSK-5, TSK-6, TSK-7, TSK-8, TSK-9, TSK-10, TSK-11, TSK-12, TSK-13, TSK-14, TSK-26, TSK-28, TSK-29, TSK-30, TSK-31, TSK-32, TSK-33, TSK-34, TSK-36, TSK-37, TSK-39, TSK-41, TSK-42, TSK-46, TSK-47, TSK-49, TSK-55, TSK-56, ERR-43, XS-4, XS-7, XS-8, XS-10, XS-26, XS-27, XS-42, XS-46, XS-54, XS-57, ERR-3, ERR-4, VUE-30
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
Cases: TSK-15, TSK-16, TSK-17, TSK-18, TSK-27, TSK-35, TSK-38, TSK-48, ERR-12, ERR-27, XS-11, XS-12, XS-13, XS-14, XS-65, TSK-40, TSK-25
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
Cases: CMT-1, CMT-2, CMT-3, CMT-4, CMT-5, CMT-6, CMT-7, CMT-8, CMT-9, CMT-10, CMT-11, CMT-12, CMT-13, CMT-14, CMT-15, CMT-16, CMT-17, CMT-18, CMT-19, CMT-20, CMT-21, CMT-22, CMT-23, CMT-24, CMT-25, CMT-26, CMT-27, CMT-28, CMT-29, CMT-30, CMT-31, CMT-32, CMT-33, CMT-34, CMT-35, CMT-36, CMT-37, CMT-38, XS-53
- Comments section per CW-14: list (oldest-first), composer (TipTap),
  edit/delete on own comments, @mention autocomplete, mentions as
  chips
- Activity feed: reverse-chronological grouped by day; consecutive
  bulk_op_id entries collapse to one expandable row (CW-11); "Load
  more" using `readHistory` pagination (CW-7); kind icons
- **Tests**: comments routes; mention extraction round-trip; activity
  collapse + load-more

### M2.5 · Task detail — relationships + attachments ⬜
Cases: REL-1, REL-2, REL-3, REL-4, REL-5, REL-6, REL-7, REL-8, REL-9, REL-10, REL-11, REL-12, REL-13, REL-14, REL-15, REL-16, REL-17, REL-18, REL-19, REL-20, REL-21, REL-22, REL-23, REL-24, REL-25, REL-26, REL-27, REL-28, REL-29, REL-30, REL-31, REL-32, REL-33, REL-34, REL-35, REL-36, REL-37, REL-38, REL-39, REL-40, REL-41, REL-42, REL-43, REL-44, REL-45, REL-46, REL-47, REL-48, REL-49, REL-50, XS-25
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
Cases: BRD-1, BRD-2, BRD-3, BRD-4, BRD-5, BRD-6, BRD-7, BRD-8, BRD-14, BRD-15, BRD-16, BRD-17, BRD-18, BRD-19, BRD-20, BRD-21, BRD-22, BRD-23, BRD-24, BRD-33, BRD-39, BRD-40, BRD-45, BRD-46, BRD-47, BRD-48, ONB-11, MSL-5, MSL-20
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
Cases: BRD-9, BRD-10, BRD-11, BRD-12, BRD-13, BRD-25, BRD-26, BRD-27, BRD-28, BRD-29, BRD-30, BRD-31, BRD-32, BRD-34, BRD-35, BRD-36, BRD-37, BRD-38, BRD-41, BRD-42, BRD-43, BRD-44, BRD-49, XS-9
- Drag card between columns → `setFields` atomic status + board_rank
  (CW-5)
- Drag within column → board_rank only
- Visual drop targets + animated reflow
- **Tests**: drop into different column posts status + new
  board_rank in one call; intra-column posts board_rank only

### M3.3 · Timeline view ⬜
Cases: TML-1, TML-2, TML-3, TML-4, TML-5, TML-6, TML-7, TML-8, TML-9, TML-10, TML-11, TML-12, TML-13, TML-14, TML-15, TML-16, TML-17, TML-18, TML-19, TML-20, TML-21, TML-22, TML-23, TML-24, TML-25, TML-26, TML-27, TML-28, TML-29, TML-30, TML-31, TML-32, TML-33, TML-34, TML-35, TML-36, TML-37, TML-38, TML-39, TML-40, TML-41, TML-42, TML-43, TML-44, TML-45, TML-46, TML-47, TML-48, TML-49, TML-50, PRU-1
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
Cases: NEW-1, NEW-2, NEW-3, NEW-4, NEW-5, NEW-6, NEW-7, NEW-8, NEW-9, NEW-10, NEW-11, NEW-12, NEW-13, NEW-14, NEW-15, NEW-16, NEW-17, NEW-18, NEW-19, NEW-20, NEW-21, NEW-22, NEW-23, NEW-24, NEW-25, NEW-26, NEW-27, NEW-28, NEW-29, NEW-30, NEW-31, NEW-32, NEW-33, NEW-34, NEW-35, NEW-36, NEW-37, NEW-38, NEW-39, NEW-40, NEW-41
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
Cases: SET-32, SET-42, PRU-5, PRU-6, PRU-7, PRU-8, PRU-9, PRU-10, PRU-11, PRU-12, PRU-13, PRU-15, PRU-16, PRU-17, PRU-18, PRU-19, PRU-20, PRU-21, PRU-22, PRU-23, PRU-24, PRU-25, PRU-26, PRU-27, PRU-28, PRU-29, PRU-30, PRU-31, PRU-32, PRU-33, PRU-34, PRU-35, PRU-36, PRU-37, PRU-38, PRU-39, PRU-40, PRU-41, PRU-42, PRU-43, PRU-44, PRU-45, PRU-46, XS-55, XS-63
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
Cases: SET-3, SET-4, SET-5, SET-6, SET-7, SET-8, SET-9, SET-10, SET-16, SET-17, SET-18, SET-19, SET-20, SET-21, SET-22, SET-23, SET-24, SET-25, SET-28, SET-33, SET-34, SET-35, SET-36, SET-41, XS-31, SET-1
- Statuses + Priorities + Task types + Relationships (C.10.3–C.10.6);
  drag-reorder; symmetric flag UX per CW-15
- Custom fields + Estimation + Calendar (C.10.7–C.10.9); type locked
  after creation; weights sub-table for custom enum
- **Tests**: reorder routes; symmetric checkbox hides inverse fields;
  priority value auto-computed from position

### M4.3 · Settings — data panels ⬜
Cases: SET-14, SET-15, SET-29, SET-30, SET-31, SET-37, SET-38, SET-40, MSL-8, MSL-9, MSL-10, MSL-11, MSL-12, MSL-13, MSL-14, MSL-27, MSL-28, MSL-31, MSL-32, MSL-33, MSL-34, MSL-37, GIT-1, GIT-2, GIT-3, GIT-4, GIT-5, GIT-6, GIT-7, GIT-8, GIT-9, GIT-10, GIT-11, GIT-12, GIT-13, GIT-14, GIT-15, GIT-16, GIT-17, GIT-18, GIT-19, GIT-20, GIT-21, GIT-22, GIT-23, GIT-24, GIT-25, GIT-26, GIT-27, GIT-28, GIT-29, GIT-30, GIT-31, GIT-32, GIT-33, GIT-34, GIT-35, GIT-36, GIT-37, GIT-38, VUE-25, VUE-26, VUE-27, VUE-36, XS-36, XS-38, XS-41, XS-43, XS-44, XS-45, XS-48, XS-50, XS-66
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
Cases: SET-11, SET-12, SET-13, SET-26, SET-27, PRU-14, SET-2, VUE-38
- My preferences + Card layout + Sidebar pins + Keyboard reference
  (C.10.19–C.10.22); theme picker; card layout drag editor (CW-17);
  sidebar pins drag list with stale-entry sweep
- **Tests**: card layout reorder persists per user; sidebar pins
  **surface** deleted-view references rather than dropping them
  silently — P7 admits no carve-out for per-user preference drift
  (resolved in 0k), so a pinned view deleted from `queries.yaml` tells
  the user it was removed.

### M4.5 · Saved-view editor — advanced DSL mode ⬜
Cases: VUE-8, VUE-9, VUE-10, VUE-11, VUE-12, VUE-17, VUE-18, VUE-19, VUE-20, VUE-21, VUE-22, VUE-23, VUE-28, VUE-29, VUE-31, VUE-32, VUE-33, VUE-34, VUE-35, VUE-37, VUE-39, A11Y-53
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
Cases: ONB-1, ONB-2, ONB-3, ONB-4, ONB-5, ONB-6, ONB-7, ONB-15, ONB-16, ONB-17, ONB-18, ONB-19, ONB-20, ONB-21, ONB-22, ONB-27, ONB-28, ONB-29, ONB-30, ONB-31, ONB-32, ONB-35, A11Y-48
- Route `/init` shown when `/api/info` reports uninitialized
- Form per C.7: project (name + prefix), skip-starter-docs
- Auto-user note (default user from $USER), cwd display
- On submit → `POST /api/init` → redirect to `/list`
- **Tests**: `/api/init` route; app routes to `/init` when
  uninitialized

### M4.7 · Sprint detail ⬜
Cases: SPR-7, SPR-8, SPR-9, SPR-10, SPR-11, SPR-12, SPR-13, SPR-14, SPR-16, SPR-18, SPR-21, SPR-22, SPR-23, SPR-25, SPR-26, SPR-28, SPR-29, SPR-30, SPR-33, SPR-34, SPR-35, SPR-37, SPR-38
- Route `/sprints/$key`
- Editable metadata header (name, dates, state, goal)
- Burndown chart (existing `computeBurndown` core)
- Task list filtered to sprint with the shared filter bar
- **Tests**: burndown route shape; metadata edits persist

### M4.8 · Polish + v1 cut ⬜
Cases: A11Y-1, A11Y-2, A11Y-3, A11Y-4, A11Y-5, A11Y-6, A11Y-7, A11Y-8, A11Y-9, A11Y-10, A11Y-11, A11Y-12, A11Y-13, A11Y-14, A11Y-15, A11Y-16, A11Y-17, A11Y-18, A11Y-19, A11Y-20, A11Y-21, A11Y-22, A11Y-23, A11Y-24, A11Y-25, A11Y-26, A11Y-27, A11Y-28, A11Y-29, A11Y-30, A11Y-31, A11Y-32, A11Y-33, A11Y-34, A11Y-35, A11Y-36, A11Y-37, A11Y-38, A11Y-39, A11Y-40, A11Y-41, A11Y-42, A11Y-43, A11Y-44, A11Y-45, A11Y-46, A11Y-47, A11Y-49, A11Y-50, A11Y-51, A11Y-52, A11Y-54, ERR-11, ERR-24, ERR-32, ERR-33, ERR-38, ERR-44, ERR-45, SET-39, XS-47, XS-49, XS-52, XS-64
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

## Unplaceable cases

Cases the Phase 1 partition could not assign to any ticket. Each names
why. These are **not** deferred work items — they are cases the current
ticket set does not make verifiable, which is a gap in the tickets, not
in the cases. Listing them explicitly is what stops them being silently
dropped; `npm run cases:partition` fails if one is neither placed nor
listed here.

- ERR-23 — its scenario is a create-task submit that half-applies; no M2 ticket builds the create modal (M3), so nothing in M2 makes this verifiable
- SPR-1 — the sprints overview route is not built by any M3 ticket; M3.1 builds `/board` from `workflow.boards`, not a sprint-column view.
- SPR-2 — same: sprint-column highlight/collapse belongs to a sprints view no M3 ticket creates.
- SPR-3 — expand/collapse persistence on a sprints view that no M3 ticket builds.
- SPR-4 — sprint-to-sprint card drag writes the `sprint` field; M3.2 builds status/board_rank drag on `/board` only.
- SPR-5 — failure revert for a sprint-reassignment drag that no M3 ticket builds.
- SPR-6 — "no sprint" drop target on the sprints view.
- SPR-15 — empty sprint column on the sprints view.
- SPR-17 — 400-task sprint column scale on the sprints view.
- SPR-19 — overlapping-sprint column rendering on the sprints view.
- SPR-20 — active-state sprint column presentation on the sprints view.
- SPR-24 — duplicate sprint names distinguished as columns on the sprints view.
- SPR-27 — dangling sprint reference surfaced on sprint surfaces, none built in M3.
- SPR-31 — malformed `sprints.yaml` error state for the sprints view.
- SPR-32 — empty-vs-failed load states for the sprints view.
- SPR-36 — deleted-sprint drop rejection on the sprints view.
- MSL-1 — asserts a Milestones **view** (one row per milestone with target date + progress bar, stable ordering); no M4 ticket builds a `/milestones` route. M4.3 builds only the Settings → Milestones management panel.
- MSL-2 — progress counted by status category on that same Milestones view; the surface that renders the numerator does not exist in any M4 ticket.
- MSL-3 — the discarded-category denominator rule must be stated "where the number is shown" on the Milestones view, milestone detail, and sidebar counts; none of those progress surfaces is an M4 deliverable.
- MSL-4 — clicking a milestone opens its scoped task list from the Milestones view; the originating view is unbuilt.
- MSL-15 — zero-task progress readout (no `NaN`/`0/0`) on the Milestones view row; no M4 ticket renders that readout.
- MSL-16 — "No target date" presentation and undated sort position on the Milestones view.
- MSL-17 — overdue flag on a Milestones view row.
- MSL-18 — 100%-complete bar and completion state on a Milestones view row.
- MSL-24 — dangling milestone id must not appear as a phantom row on the Milestones view; that view is unbuilt.
- MSL-25 — archived milestone's **detail route** must stay reachable with a "show archived" affordance on the Milestones view; no M4 ticket builds a milestone detail route.
- MSL-29 — progress numerator changes after a status recategorisation; asserted on the Milestones view's progress figures.
- MSL-35 — a failed progress computation must show an error affordance in place of the numbers on a Milestones view row.
- MSL-38 — unknown milestone key in the **detail URL** shows a not-found state; the milestone detail route is not in any M4 ticket.
- PRU-4 — every assertion is about the create modal (pre-select, key preview, submit); M1.1 ships the + button as a stub and the modal is M3.4

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
