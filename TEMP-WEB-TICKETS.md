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
Cases: LST-1, LST-2, LST-3, LST-4, LST-5, LST-6, LST-7, LST-8, LST-19, LST-20, LST-21, LST-22, LST-23, LST-24, LST-25, LST-26, LST-27, LST-28, LST-36, LST-37, LST-39, LST-47, LST-51, ONB-8, ONB-12, ONB-26, ONB-24, ONB-33, ERR-1, ERR-2, ERR-5, ERR-6, ERR-9, ERR-10, ERR-14, ERR-15, ERR-16, ERR-17, ERR-18, ERR-19, ERR-20, ERR-21, ERR-22, ERR-30, ERR-31, ERR-39, ERR-40, ERR-41, ERR-42, XS-1, XS-5, XS-22, XS-24, XS-39, XS-40, XS-56, MSL-21, MSL-22, MSL-23, MSL-26
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
  confirm), Clear (×) — covers BLK-5, 11, 12, 13, 38, 39, 40.
  **Not built**: Set assignee / milestone / sprint (BLK-7, 8), Move to
  project (BLK-9, 26), Undo after archive (BLK-10)
- ⚠️ **BLK-10 is a removal as well as an addition.** Archive currently
  ships behind a typed confirm; the case says demanding one is itself a
  violation, because archive is reversible. It wants a lightweight
  "Archive 6 tasks?" with **cancel focused by default**, plus an Undo in
  the success message. Delete keeps its typed confirm — that one is not
  reversible. Undo is **in-memory only (V11)**: it dies on reload, and
  there is no expiry to configure.
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
> **Also closes SHL-44** (M1.1's, blocked here). A deep link to a key
> that was never allocated must 404 *in the main pane*, naming the key
> and distinguishing "no such key" from "not loaded". M1.1 cannot do
> that: `/tasks/$key` is a stub with no fetch, so nothing discovers
> that the key is missing. The state arrives with the real route.

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
> **Split into two subsections at step 1** (2026-08-29). 43 cases, 18
> of them blockers, is more than one review diff can carry — and the
> seam is real rather than arbitrary:
>
> - **M2.2a · the pickers** — one control per field type. P3
>   throughout: render the `workflow.yaml` label, store the key.
> - **M2.2b · failure and concurrency** — optimistic rollback,
>   archived-reference rejection, a status deleted from config while a
>   task references it, and the CLI writing underneath an open page
>   (TSK-29/34/46/47, ERR-3/4/43, XS-4/7/8/57).
>
> **Probed before building** (`m22-probe.md`): `POST /api/tasks/:ref/set`
> already answers 200, and an invalid enum already returns 400
> `validation_failed` naming the field, the bad value **and the valid
> options**, with `data_state: "not_saved"`. So P-4 and ERR-3/4 are
> satisfied *server-side*; what M2.2b owes is the client rendering
> that at the field which failed rather than as a toast.
>
> **XS-8 does not need K2's precondition**, though it reads as if it
> might. Its own text: "This holds even though the UI's cached copy of
> the task predated the CLI write — **because the request carried only
> `priority`**." Field-level writes are the mechanism and the server
> already does them. K2's `If-Match` work stays in M2.3, where the
> whole body is replaced and a stale copy genuinely can clobber.
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
- **Probed 2026-08-29: `apps/web/src/client/editor/` already exists —
  484 lines, tested, with no consumer.** `MarkdownEditor.tsx` is the
  CodeMirror 6 raw surface, complete and solving the hard part (the
  EditorView lives outside React's render cycle, so a re-render never
  costs the user their selection or undo history). `extensions.ts` is
  the TipTap node/mark schema for LocTT's own markdown extensions —
  which is TSK-17's round-trip requirement pre-solved, since TipTap
  silently drops nodes it does not recognise.

  So this ticket does not build two editors. It owes the TipTap
  *surface*, the mode toggle, autosave, and two wire-ups.
- TipTap rich editor (default mode), mode toggle to CodeMirror 6
  raw markdown
- Auto-save on 1.5s idle + on blur; coalesced `body_edited` history
  (CW-16)
- **Optimistic concurrency, and it ships WITH the editor** — Ken's
  ruling K2, `decisions.md` § 9. This is scope this ticket did not
  previously carry.

  `markdown-extensions.md` mandated explicit-Save and TSK-15 mandates
  1.5s autosave; the contradiction was settled in favour of autosave,
  **conditional on the precondition landing at the same time.** There
  is no concurrency control anywhere today — no `If-Match`, no `412`,
  no version on any write path, verified by grep — and LocTT has three
  writers against one `.loctt/`. Autosave without a precondition
  silently overwrites a concurrent CLI or MCP edit every 1.5 idle
  seconds, unattended, which is exactly what **P1** forbids: "never
  silently overwrite a change it didn't make".

  Explicit-Save made the window small and the user present. Autosave
  makes it continuous and the user absent, so the guard is not
  optional here.

  **Probed 2026-08-29: core already has all of this, and nothing calls
  it.** `packages/core/src/task/io.ts` exports `bodyToken()`,
  `BodyWriteOptions.expectedToken`, and `StaleBodyWriteError` — with a
  message that already states the text was *not* saved. Measured: a
  write carrying a stale token is refused. `grep -rln bodyToken`
  outside `dist/` finds the export barrel, its own module, and its own
  test. **No caller.** Third orphaned core capability found that day,
  after `unarchiveView` and `validateQuery`.

  So this is a **wire-up across three surfaces**, not a build — which
  makes it smaller than the entry below implies, and makes Ken's layer
  rule the whole point of it.

  (Note `expectedToken`, not `expectToken`. A probe using the wrong key
  had the option silently ignored and the stale write accepted, which
  reads exactly like the precondition not working.)

  Owed:
  - the editor sends the token it read (core's `bodyToken`, not a
    hand-rolled `If-Match` — the shape is already decided)
  - the server refuses a stale write with **412**, not a silent
    overwrite and not a generic 500
  - the UI reports it as "this task changed underneath you", with the
    user's text preserved — a lost draft is a worse outcome than the
    conflict
  - **CLI and MCP get the same guard**, per the layer rule: a
    precondition only the web app honours protects nothing, because
    the other two writers are the ones it is protecting against

  Note `PROPOSED-UI-CASES.md` attributes this gap to "B5". That is the
  wrong ID — B5 is the lossy-content guardrail. The concurrency gap has
  no B-number.
- Toolbar: bold, italic, code, code-block, link, list, heading,
  blockquote
- @mention autocomplete (users)
- **Tests**: idle-debounce auto-save fires once after typing burst;
  mode toggle preserves content; mention picker filters by query

### M2.4 · Task detail — comments + activity ⬜
> **Split into two subsections at step 1** (2026-08-29). 39 cases, 18
> of them blockers — the same size as M2.2, and the seam is two
> independent surfaces rather than an arbitrary cut:
>
> - **M2.4a · comments** (CMT-1..12) — list, composer, edit/delete,
>   @mention autocomplete and chips.
> - **M2.4b · activity** (CMT-13..38, XS-53) — history rendering,
>   bulk collapse, pagination, and the degradation cases.
>
> **Probed before building.** The comments route already degrades
> correctly: a corrupt `_comments.yaml` gives 400 naming the full path
> and the parse problem, with the task and activity unaffected — three
> of CMT-36's four bullets satisfied server-side. **CMT-37 does not**:
> a corrupt `_history.yaml` returns a generic 500 `"unknown"`, failing
> its "names the file" bullet. Same shape as the TSK-54 defect, and
> the fix pattern is one endpoint away in the same file.
>
> **Mentions are stored as raw text and that is correct** — do not
> "fix" it. CMT-10 requires mentions to survive a rename, which only
> works if they resolve at render time; CMT-8 requires an unresolvable
> mention to stay plain text and still post, which it does (measured:
> `@NoSuchUser` posts 201).
Cases: CMT-1, CMT-2, CMT-3, CMT-4, CMT-5, CMT-6, CMT-7, CMT-8, CMT-9, CMT-10, CMT-11, CMT-12, CMT-13, CMT-14, CMT-15, CMT-16, CMT-17, CMT-18, CMT-19, CMT-20, CMT-21, CMT-22, CMT-23, CMT-24, CMT-25, CMT-26, CMT-27, CMT-28, CMT-29, CMT-30, CMT-31, CMT-32, CMT-33, CMT-34, CMT-35, CMT-36, CMT-37, CMT-38, XS-53
- Comments section per CW-14: list (oldest-first), composer (TipTap),
  edit/delete on own comments, @mention autocomplete, mentions as
  chips
- Activity feed: reverse-chronological grouped by day; consecutive
  bulk_op_id entries collapse to one expandable row (CW-11); "Load
  more" using `readHistory` pagination (CW-7); kind icons
- **Tests**: comments routes; mention extraction round-trip; activity
  collapse + load-more

### M2.6 · Task detail — Duplicate ✅
> **Added 2026-08-30 by Ken's ruling K7**, after the M2 gate found
> TSK-20 declared as an M2.1 blocker and never built. Its own ticket
> rather than a retroactive M2.1 fix, so the M2 gate's verdict keeps
> meaning what it says — a milestone does not pass with a declared
> blocker open.

Cases: TSK-20

**Core is ready.** `duplicateTask` is exported and both the CLI
(`apps/cli/src/commands/task-crud.ts`) and MCP already call it — the
web layer is the only surface that does not. Read the CLI's call for
the shape: it takes `sourceRef`, `state`, `archivedGuard` and an
`overrides` object, inside `withStateLock`.

- `POST /api/tasks/:ref/duplicate` — a wrapper, following
  `handleArchive`'s pattern
- A "Duplicate" item in the task detail's More menu
- **Navigate to the new task** on success — TSK-20's third bullet, and
  the reason this is not a one-line route

TSK-20's four bullets, each of which the test must reach:
- a newly allocated key from the project's counter, never reused
- title, body and metadata copied; `created_at`/`updated_at` fresh;
  `key_history` **empty** on the copy
- the app navigates, and the header key differs from the original
- **the original is unmodified** — verify by returning to it, off disk

**The trap.** A test asserting "a new task appeared" passes whether or
not the copy is correct, and whether or not the original survived.
Assert the far end: read both files.

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

### M3.4 · Create task modal ✅
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

### M3.5 · Sprints overview ⬜
Cases: SPR-1, SPR-2, SPR-3, SPR-4, SPR-5, SPR-6, SPR-15, SPR-17, SPR-19, SPR-20, SPR-24, SPR-27, SPR-31, SPR-32, SPR-36
- Route `/sprints` — the column view. Distinct from `/sprints/$key`
  (M4.7), which is one sprint's detail and burndown.
- **Depends on M3.2**: reuses its drag primitives and drop-target
  visuals rather than building a second, divergent implementation.
- **No server work.** Verified 2026-08-24: `GET/POST /api/sprints`,
  `PUT`/`DELETE` by id, `?counts=true`, `?progress=true` and
  `/api/sprints/<id>/burndown` all exist, and SPR-4's "write the id,
  not the name" was fixed in `5c81d96`. **Client-side only.**
- **SPR-3's expand/collapse state: `localStorage` (V12).** Per-browser,
  not per-user — accepted; no store existed and the state is one column
  being open.

**Columns (SPR-1, SPR-19, SPR-20, SPR-24)**
- One column per non-archived sprint, ordered by `start_date` ascending
  with a stable tie-break; header shows `name` (never the ULID), the
  date window, and a task count
- The header count equals the number of cards actually rendered. These
  come from two independent paths — `?counts=true` on `/api/sprints`
  and the per-column task fetch — so the equality is asserted, not
  assumed
- Archived sprints are hidden behind a "show archived" affordance. The
  API returns `archived` on the def and filters nothing, so this is
  client-side (same affordance as M4.9's)
- Presentation keys off `state`, never off whether today falls inside
  the window; a passed `end_date` on an `active` sprint stays active and
  the discrepancy shows as an informational hint, never an
  auto-correction and never a rewrite of `state`
- Overlapping windows are legal: both columns render, both highlight as
  active, a task appears in exactly one column, and **no warning implies
  overlap is invalid** — in particular the SPR-20 hint must not fire on
  overlap
- Two sprints sharing a `name` are distinguishable by their date windows
  (or another shown discriminator); dragging into one assigns that
  sprint's id and the card lands in the column actually targeted

**Expansion (SPR-2, SPR-3)**
- `active` expanded and highlighted without relying on colour alone;
  `future` and `completed` collapsed to header + count
- Clicking a collapsed header expands it **in place** — no navigation,
  no column reordering
- Expansion persists per-user across reload in **both** directions: an
  expanded `completed` sprint stays expanded and a collapsed `active`
  one stays collapsed. The default is a default, not an override
  re-applied every render. Never written to `sprints.yaml`
- **Needs a `UserSettings` field for column expansion.** No earlier
  ticket adds one; M4.4 owns `UserSettings` and lands later, so this
  ticket adds the field

**Drag (SPR-4, SPR-5, SPR-6, SPR-36)**
- Drop writes `sprint` with the target's **`id`**; dropping where it
  started issues no write; exactly one write per drop
- A "No sprint" target clears the field (absent, not `""` or `"none"`),
  and the task then matches an unset `sprint` in the query language
  consistently with what the CLI reports. *(SPR-6 permits a card-level
  "Remove from sprint" affordance instead; the drop target is the
  choice made here.)*
- Counts refetch after a drop rather than only updating optimistically
- **The write is verified on disk**: `loctt show <key>` reports the new
  sprint immediately, not just the browser
- A failed write returns the card to its source column, reverts both
  counts, and errors naming the task, the target sprint, and that the
  assignment was not saved

**Degradations (SPR-15, SPR-17, SPR-27, SPR-31, SPR-32, SPR-36)**
- Empty column is a designed state reading `0`, and remains a valid
  drop target
- A 400-task column virtualizes while the header shows the true total;
  dragging a card out completes without visibly re-rendering every card.
  `MAX_PAGE_LIMIT` is 1000 so one fetch covers it, but
  `DEFAULT_PAGE_LIMIT` is **100** — the per-column fetch must pass an
  explicit `?limit`. Relying on the default gives 100 cards under a
  header reading 400, which is precisely the SPR-17 failure
- A dangling `sprint` id gets an "unknown sprint" grouping naming the
  id, and the rest of the view still renders — one bad reference does
  not blank the page
- Zero sprints shows an empty state that **points at Settings →
  Sprints**; a failed fetch shows an error **with a retry**. Never the
  same state
- Dropping onto a column whose sprint was deleted underneath the session
  is rejected, the card returns, the error says the target no longer
  exists and asks for a refresh, and the stale column is gone on refresh

**Server work (this ticket is NOT frontend-only)**
- ~~`handleListSprints` does not catch `SprintsConfigError`, so a
  malformed `sprints.yaml` returns a generic 500 with `code: io_failed`
  + retry~~ **FALSE — measured 2026-08-31, see A50.** The missing catch
  is real; the consequence is not. Against the unmodified handler a
  malformed `sprints.yaml` returns **HTTP 400** `config_invalid`, naming
  the file, the offending sprint and the broken rule — SPR-31's three
  requirements, already met. `SprintsConfigError` sets `config_invalid`
  in its own constructor, and the dispatcher maps any uncaught
  `LocttError` through `toEnvelope()` + `statusForCode()`. A per-route
  catch would re-derive what core already states. **No server work
  here.** Two regression tests now pin this.
- `parseSprintsConfig` is all-or-nothing. SPR-31 asks for valid sprints
  to still render *if the loader can partially recover* — decide
  explicitly: either add a lenient parse, or state that it cannot
  recover and always show the whole-file error. Do not leave it implied
- ~~SPR-36 needs an existence check on the drop write... a write naming
  a deleted sprint id likely succeeds silently today~~ **FALSE —
  measured 2026-08-31, see A49.** It already refuses: assigning a
  deleted sprint id exits 1 with `unknown sprint: <id>` and writes no
  `sprint` key (positive control: assigning a live sprint exits 0 and
  `loctt show` reports it). The guard is `resolveSprintIdFromInput`
  (`sprints/manage.ts:86-103`) via `setField`, throwing
  `SprintError extends LocttError` → 400. **Client half only.**
- `GET /api/sprints` counts are opt-in via `?counts=true` (progress is
  not needed here; that is M4.7's burndown)

**Tests**
- Column ordering by `start_date` with a stable tie-break across reloads
- Header count equals the cards rendered, with the two paths
  (`?counts=true` and the per-column fetch) deliberately disagreeing in
  the fixture if the implementation lets them
- Drop writes the target's id, exactly one write, and the value is on
  disk (assert through core, not the browser)
- Drop-to-unassigned clears rather than empty-strings
- `state` drives highlight on a sprint whose `end_date` has **passed
  while `state` is still `active`** — a fixture where state and window
  agree passes without asserting anything — and the discrepancy hint is
  present
- Two overlapping `active` sprints trigger no warning, and the SPR-20
  hint does not fire on them
- Malformed `sprints.yaml` is distinguishable from a failed fetch
- Failed write reverts card and both counts

---

### 🚦 Milestone 3 review
- Board, Timeline, Create modal, Sprints overview all functional. Filter
  bar is shared across List + Board + Timeline
- Out of scope: settings (M4), init wizard (M4), sprint **detail** (M4 —
  the overview at `/sprints` ships here), saved-view advanced DSL (M4)

---

# Milestone 4 — Settings, init, polish, v1 cut 🚦

Goal: settings panels work end-to-end, the init wizard handles
first-run, and the v1 polish (keyboard, errors, a11y) is done.

### M4.1 · Settings shell + Projects + Users (with profile pics, CW-20) ⬜
> **PRU-3 moved here from M1.2** (Ken, 2026-08-25). It needs an "All
> projects" mode and a project switcher, and no ticket built either —
> the same shape as the SPR/MSL gap, found while verifying M1.2. It
> sits with the rest of the project work rather than needing a ticket
> of its own.
Cases: SET-32, SET-42, PRU-3, PRU-5, PRU-6, PRU-7, PRU-8, PRU-9, PRU-10, PRU-11, PRU-12, PRU-13, PRU-15, PRU-16, PRU-17, PRU-18, PRU-19, PRU-20, PRU-21, PRU-22, PRU-23, PRU-24, PRU-25, PRU-26, PRU-27, PRU-28, PRU-29, PRU-30, PRU-31, PRU-32, PRU-33, PRU-34, PRU-35, PRU-36, PRU-37, PRU-38, PRU-39, PRU-40, PRU-41, PRU-42, PRU-43, PRU-44, PRU-45, PRU-46, XS-55, XS-63
- Route `/settings/$section`; nav grouped (Workspace/Workflow/Data/
  Tracker/Personal)
- Projects panel: CRUD with reference-count badge (CW-8), delete with
  remap
- **A `slug` field on projects, and URLs carry it** — Ken's ruling K3,
  `decisions.md` § 9. Scope this ticket did not previously carry, and
  it is a **core schema change**, so under the layer rule it owes CLI
  and MCP too.

  `flow-projects-users.md` assumes `?project=web`. `ProjectDefSchema`
  is `.strict()` with `{id, name, prefix, archived?}` — no slug — and
  `state.keys` is indexed by ULID, so today the URL carries the ULID.

  **This is a readability fix, not a broken case.** PRU-2's
  `?project=web` is illustrative ("e.g."), and everything it *requires*
  — the URL round-trip, back/forward, and that the **server** filtered
  rather than the client narrowing — is satisfied by ULIDs. M1.1
  passed its gate on that reading and does not reopen.

  Owed:
  - `slug` on `ProjectDefSchema`, generated from the name on create
  - **uniqueness**, enforced where the project is written, not in the UI
  - **a rename policy**, which is the real design question: does the
    slug follow the name (breaking every saved URL and bookmark) or
    stay fixed (and drift from a project renamed "Web" → "Website")?
    Neither is obviously right and no case settles it. **Decide at
    step 1 and record it**; if the answer looks load-bearing for saved
    views or shared links, it stops the run.
  - resolution accepting **both** slug and ULID, so existing URLs keep
    working — an unresolvable slug must say so rather than silently
    showing all projects (P4, ERR-1)
  - CLI and MCP accept the slug wherever they accept a project today
  - migration for existing trackers, which have no slug on disk
- Users panel: CRUD; archive blocked on active user; switch/edit/
  delete; **avatar upload with frontend image compression (CW-20)** —
  resize/recompress to JPG/WebP in browser before POST (max 256×256
  for avatar bucket)
- **Tests**: CRUD routes; reference-count endpoint; CW-20
  compressor (jpeg in → smaller jpeg/webp, dimensions clamped)

### M4.2 · Settings — workflow panels ✅
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

### M4.4 · Settings — personal + keyboard ✅
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

### M4.6 · Init wizard ✅
Cases: ONB-1, ONB-2, ONB-3, ONB-4, ONB-5, ONB-6, ONB-7, ONB-15, ONB-16, ONB-17, ONB-18, ONB-19, ONB-20, ONB-21, ONB-22, ONB-27, ONB-28, ONB-29, ONB-30, ONB-31, ONB-32, ONB-35, A11Y-48
- Route `/init` shown when `/api/info` reports uninitialized
- Form per C.7: project (name + prefix), skip-starter-docs
- Auto-user note (default user from $USER), cwd display
- On submit → `POST /api/init` → redirect to `/list`
- **Tests**: `/api/init` route; app routes to `/init` when
  uninitialized

### M4.7 · Sprint detail ✅
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

### M4.9 · Milestones view + detail ⬜
Cases: MSL-1, MSL-2, MSL-3, MSL-4, MSL-15, MSL-16, MSL-17, MSL-18, MSL-24, MSL-25, MSL-29, MSL-35, MSL-38
- Route `/milestones` (list) and the milestone detail route. Distinct
  from Settings → Milestones (M4.3), which is CRUD management, not a
  progress surface.
- **Route segment: settled by V3.** `/milestones/<ulid>`. The flow docs
  write `/milestones/$key`, but `MilestoneDef` is `{id, name,
  target_date, archived}` — there is no `key`. P-4 is scoped to UI
  *content*, so the address bar may carry the ULID. Same for M4.7's
  `/sprints/<ulid>`.
- **No server work.** Verified 2026-08-24: `GET/POST /api/milestones`,
  `PUT`/`DELETE` by id, and `?progress=true` all exist.
  `computeProgress` already counts by status **category** (MSL-2),
  reports `discarded` separately with `total` excluding it (MSL-3), and
  guards the zero denominator (MSL-15). **Client-side only.**

**Rows (MSL-1, MSL-16, MSL-17, MSL-18)**
- One row per non-archived milestone, none omitted or duplicated;
  `name` never the ULID
- `target_date` formatted per the workspace calendar, or an explicit
  "No target date" — never blank, never a bare dash, never today
- A progress bar plus a `done / total` readout whose fill matches the
  numbers
- Ordering stable across reloads: by target date, undated in a defined
  position after dated, never interleaved randomly. **An undated
  milestone still shows a working progress bar**
- Overdue is driven by incomplete tasks existing (category not
  `completed`/`discarded`), not by the date alone; a 100%-complete past
  milestone reads completed, not overdue. The flag is additive — **the
  progress numbers are unchanged by it**
- At 100% the bar reads full and the readout shows `n / n`

**Progress rule (MSL-2, MSL-3, MSL-15, MSL-29)**
- Counts by status **category**, not by a `done` key: two
  `completed`-category statuses both count, and renaming a status's key
  or label changes nothing
- Discarded tasks are **excluded from the denominator** (decided
  2026-08-14; `computeProgress` implements it and returns `discarded`
  alongside). The rule is stated where the number is shown, and
  identically on the list, the detail, and any sidebar count
- **CLI parity**: the same milestone via `loctt list` with a
  `status.category = completed` predicate returns the same numerator.
  This is the assertion that catches the UI computing progress
  independently of core — assert it against the real CLI
- Zero-task milestone shows "No tasks" — never `NaN`, `0/0`, or
  `Infinity` — with an empty bar and percent suppressed
- Recategorising a status in `workflow.yaml` raises the numerator on
  refresh: **the progress query is invalidated by a workflow config
  change**; no cached figure survives it

**Drill-in (MSL-4)**
- Clicking a row opens a task list scoped to that milestone; the URL is
  pasteable and Back restores scroll and expansion state
- **The row count equals the milestone's `total`** under the same
  discarded rule. This does not hold with today's API — see server work

**Archived and degradations (MSL-24, MSL-25, MSL-35, MSL-38)**
- Archived milestones keep a reachable detail route with a working task
  list, are excluded from the default view, and are revealed by a "show
  archived" affordance without unarchiving. *(Picker exclusion is
  M2.2's milestone dropdown, not this ticket.)*
- A dangling milestone id must not appear as a phantom row, and if such
  tasks are dropped from counts that must be visible somewhere —
  silently vanishing tasks are the failure mode
- A failed progress computation shows an error affordance **naming the
  milestone** with a retry, in place of the numbers, while other rows
  still render their own progress
- An unknown key in the detail URL is a not-found state linking back to
  the list, visually distinct from a milestone with zero tasks

**Partition defect to resolve (MSL-24)**
- MSL-24's first bullet — *"The task detail shows the reference as
  unresolved, naming the dangling id"* — is a **task-detail**
  assertion. This ticket builds no task detail, so it cannot verify it.
  Split MSL-24, or reassign that bullet to the ticket owning task
  detail, before claiming the case closed here.

**Server work (this ticket is NOT frontend-only)**
- **MSL-35 is architecturally unavailable today.** `withProgress` calls
  `milestoneProgress` once for the whole list, and `referenceProgress`
  does a single corpus scan by design — it either succeeds for every
  milestone or throws for all of them, and `handleListMilestones` does
  not catch it, so the whole response 500s. A per-row error with a
  per-row retry needs either a per-milestone progress endpoint or a
  partial-success shape (`progress | {error}` per item)
- **Remove the silent zero fallback.** `withProgress` fills any id
  missing from the map with `{done:0, total:0, ...}`, producing exactly
  the `0 / 0` MSL-35 forbids and making a missing computation
  indistinguishable from a real zero
- **MSL-4's count equality does not hold.** The drill-in would be
  `/api/tasks?milestone=<id>`, which returns discarded tasks too, while
  `progress.total` excludes them — MSL-3's own example (10 tasks →
  `4 / 8`) would show 10 rows. `STRUCTURED_FILTER_FIELDS` has no
  category negation, so either the drill-in carries a DSL `query`
  excluding discarded, or the equality is renegotiated with the case
- **MSL-24 needs an orphan count.** `referenceProgress` seeds its map
  with the requested ids only and silently drops tasks pointing at a
  deleted milestone; the response carries no counter, so "visible
  somewhere" has nothing to render
- No `GET /api/milestones/:id` route exists; the detail resolves from
  the list client-side. Workable — and arguably better for MSL-38 —
  but state it rather than implying an endpoint

**Unowned dependencies this ticket absorbs**
- **A workspace-calendar date formatter.** MSL-1 wants `target_date`
  "formatted per the workspace calendar". `GET /api/calendar` exists but
  no ticket builds a shared formatter bound to it — M4.2 builds the
  Calendar settings *panel*, not the formatter. This ticket builds it,
  as a shared utility rather than a local helper, since the timeline and
  task detail need the same thing
- **Scroll restoration on Back.** MSL-4 wants scroll and expansion state
  restored. Nothing in the TanStack Router setup establishes scroll
  restoration and M4.8's polish list does not name it. This ticket
  configures it

**Cross-ticket consistency (with M4.3)**
- M4.3's MSL-11 requires its reference count agree with MSL-3's
  progress rule. `countTasksByReferences` and `milestoneProgress` are
  separate paths with their own archived handling; neither ticket
  currently owns proving they agree. This ticket asserts it

**Tests**
- Category-driven numerator survives a status key rename and a label
  rename
- Numerator matches `loctt list` with `status.category = completed`
- Discarded excluded from denominator, and the rule stated on every
  surface that shows the number
- Zero-task readout emits no NaN / 0-0 / Infinity
- Overdue keys off incomplete tasks, not the date; 100% past milestone
  reads completed
- Undated milestone still renders progress and sorts to its defined slot
- Workflow recategorisation invalidates the cached progress figure
- Dangling id produces no phantom row, **and** the tasks it orphans are
  visible somewhere rather than silently absent from every count
- A progress failure shows a named, retryable error while other rows
  render
- Row count on the drill-in equals the readout's `total` for a milestone
  that has discarded tasks — the case where the two diverge today

---

### M5.1 · Structured export — the actual backup ⬜
> **New ticket, 2026-08-29.** Ken's ruling K4, `decisions.md` § 9.
> Deliberately **after M4**, and deliberately its own ticket: no case
> describes it, so folding it into an existing one would put behaviour
> in front of a gate that no case covers.

Cases: none yet — **these must be written before this is built**, and
they are Ken's to approve, not an agent's to author.

**Why it exists.** Asked what the CSV export is *for*, Ken answered "a
backup or archive". Measurement contradicted that: the CSV writes **18
columns against 27 frontmatter fields**, and the omissions are the
substance —

| Missing | Consequence for a restore |
|---|---|
| `body` | every task's markdown content is gone |
| `relationships` | a pile of disconnected tasks |
| `fields` | all custom field values |
| `key_history` | old keys stop resolving |
| `archived` / `archived_at` | archived tasks and their state |
| `rank` / `board_rank` | manual ordering |
| comments | stored separately, never exported |

So CSV stays a **report for a human in a spreadsheet** (K4, and the
reason F7 became a plain bug), and the backup is a separate format.

- **JSONL**, one task per line: streamable, appendable, diffable, and
  it loads without parsing the whole file — Ken's call.
- **Split above a size threshold.** The threshold is a number no case
  names, so it is decided at step 1 and **recorded with a revert
  path**, the same way BLK-30's was.
- Lossless against `task.md` **plus** what lives outside frontmatter:
  body, comments, history. If something is deliberately excluded, the
  ticket says which and why — silence is not a decision.
- **Core, so CLI and MCP both get it**, per the layer rule. A backup
  only the web app can take is not a backup.
- **Tests**: a round-trip — export a seeded tracker, restore into an
  empty one, and diff. Anything a CSV would have dropped must survive.
  That is the assertion the whole ticket is for, and a test that only
  checks the file parses would be exactly the vacuity the M1 sweep
  found 27 of.

**One thing worth stating plainly**, because it bounds the urgency:
`.loctt/` is *already* a complete, restorable, git-friendly backup.
Copying that directory loses nothing. This ticket buys a single
portable file and a defined restore path — convenience, not data
safety.

---

## Unplaceable cases

Cases the Phase 1 partition could not assign to any ticket. Each names
why. These are **not** deferred work items — they are cases the current
ticket set does not make verifiable, which is a gap in the tickets, not
in the cases. Listing them explicitly is what stops them being silently
dropped; `npm run cases:partition` fails if one is neither placed nor
listed here.

The 28 SPR/MSL cases that once sat here are gone: they named two whole
views the ticket set had never planned, and are now built by M3.5 and
M4.9. The two below are different in kind — the behaviour *is* ticketed,
just in a later milestone than the case's own tag implies.

- ERR-23 — its scenario is a create-task submit that half-applies; no M2 ticket builds the create modal (M3), so nothing in M2 makes this verifiable
- PRU-4 — every assertion is about the create modal (pre-select, key preview, submit); M1.1 ships that button as an explicit stub, so M1 cannot verify it
