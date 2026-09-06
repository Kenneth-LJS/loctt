# UI/UX Review — Per-View Interaction & Experience

Live walkthrough of the seeded demo at `http://localhost:7755` (16 tasks,
2 projects, milestones, sprints, labels, an epic with subtasks,
blocks-chains, comments, 2 archived, 3 deliberately-corrupt items).
Read-only on code; the live app was driven with the Browser tools.

Scope note: the toolbar checkbox / select-all / bulk-toolbar issues are
owned by other agents and are deliberately **not** re-reported here.

Severity legend: **broken** (fails / errors / does nothing) ·
**confusing** (works but misleads) · **rough-edge** (works but rough) ·
**polish** (cosmetic).

Screenshot refs are described inline (this session's screenshots are not
persisted to disk); each finding names the exact view + steps so it can
be reproduced.

---

## Headline

The app's signature "degradation" feature is **built well at the doctor
layer but under-surfaced in the day-to-day UI**, and one core board
interaction **500s**. The single most important finding is the board
bug (§2.1): dragging/moving a card that is (or lands next to) a blocker
returns HTTP 500 and refuses to save. Everything else is secondary.

---

## 1. List view

### 1.1 A free-query (`q=`) filter shows NO chip and no way to clear it — **confusing**
- **What I did:** Clicked the sidebar saved filter **Overdue** (→
  `/list?q=due_date < 2026-09-06 and status.category not in (completed,
  discarded)`). Also reproduced with **High priority**.
- **What's wrong:** The list correctly narrows to 2 rows ("Showing 1–2 of
  2"), but the toolbar shows **no filter chip, no highlighted "Advanced"
  button, and no "Clear all"**. A user who lands here (e.g. from a
  bookmarked saved filter) sees a short list with **no in-page
  explanation of why**, and no obvious way back except clicking "All
  projects" or hand-editing the URL.
- **Contrast:** A facet param *does* render a proper removable chip.
  `/list?milestone=…` shows `Milestone: v1.0 Launch ✕` + `Clear all` and
  lights up the Milestone facet with a `· 1` badge. So chips exist for
  `project` / `milestone` / `labels` / `sprint`, but **not** for the DSL
  `q=` param that every saved filter in the sidebar uses.
- **Suggestion:** When `q=` is present, render a chip ("Filtered query
  ✕" or the saved-filter's name) and/or auto-highlight "Advanced".
  Ideally expand it to the human-readable query. At minimum expose
  "Clear all".

### 1.2 First click on a sort header sorts *ascending* (Low/oldest first) — **rough-edge**
- **What I did:** Clicked the **Priority** header once.
- **What's wrong:** It sorts `dir=asc`, i.e. Low → Medium → High →
  Critical. `workflow.yaml` explicitly documents priority order as
  "top→bottom = highest→lowest", so a user clicking "Priority" to triage
  expects **Critical first**. The first click gives the opposite; you
  must click again to reverse. Same pattern likely applies to Due
  (oldest first) and Updated.
- **Suggestion:** For priority (and arguably due date), default the first
  click to the "most useful" direction (highest priority / soonest due)
  and toggle from there. Or show the sort arrow direction more loudly so
  the state is obvious.

### 1.3 Sidebar links silently carry your current sort into the target — **polish**
- **What I did:** Sorted by Priority, then inspected sidebar hrefs.
- **What's wrong:** Every sidebar link (projects, saved filters,
  milestones, sprints, labels) appends the live `sort=priority&dir=asc`.
  Clicking a saved filter keeps whatever sort you happened to have,
  which can surprise (a "blocked" view opens Low-first). Harmless but
  can look like the saved filter "remembers" a sort it doesn't own.
- **Suggestion:** Decide deliberately whether saved filters carry the
  ambient sort; if not, strip `sort`/`dir` from those hrefs.

### 1.4 Facet dropdown items read as plain rows until selected — **polish**
- **What I did:** Opened the **Status** facet.
- **What's wrong:** Options (Backlog / In progress / Done / Won't do)
  render as a bare list with no visible checkbox affordance until you
  click one (then a ✓ appears and a chip is added). It works and the
  resulting chip + `· 1` count badge are clear; the dropdown itself just
  doesn't signal "multi-select" up front.
- **Suggestion:** Show empty checkboxes (or a hover state) so
  multi-select is discoverable before the first click.

### 1.5 Archived rows render well — *(positive)*
- Toggling **Show archived** shows DEMO-8 / DEMO-9 dimmed with a clear
  `ARCHIVED` tag beside the key. Good treatment.

---

## 2. Board view

### 2.1 Board move / reorder returns HTTP 500 near a blocker — **broken** (highest priority)
- **What I did:** Dragged **DEMO-1 "Set up CI pipeline"** Backlog → In
  progress (**succeeded, 200**, counts updated). Then dragged it back
  into Backlog at a reorder position (**failed, 500**). Reproduced
  deterministically via the API:
  ```
  POST /api/tasks/DEMO-1/board-move  (X-Loctt-Client: web)
  → 500  detail: internal: missing relationships remap for
         "is_blocked_by" on task DEMO-4
  ```
- **Root cause (from data):** DEMO-4 stores a direct
  `is_blocked_by` relationship whose target is **DEMO-1**
  (`01M1TS9FBTRBT7BKP490J5RRTG`). The board-move rank-remap iterates
  affected tasks' relationships and has **no remap entry for the
  `is_blocked_by` inverse key** (it handles `blocks`), so it throws.
  Because Backlog contains DEMO-4, *any* move into/within Backlog that
  recomputes ranks now 500s — I confirmed even a plain
  `{"status":"backlog"}` move-back fails.
- **User impact:** Drag-and-drop — the board's primary interaction —
  crashes for a common, realistic data shape (a blocker being reordered,
  or any card moved into a column that holds a blocked task). This is a
  correctness bug, not just UX.
- **The error affordance itself is good** (see §2.2). The bug is the 500.
- **Suggestion:** Fix the remap table to cover inverse relationship keys
  (`is_blocked_by`, `child`, `is_cloned_by`, etc.), or remap by
  canonical relationship rather than raw stored key.
- **⚠ Side effect of my testing:** my first drag persisted, so **DEMO-1
  is now `in_progress` in the seed** (was `backlog`). The move-back API
  is broken so I could not revert it cleanly, and editing the data file
  was blocked by the sandbox. **Re-seed the demo** to restore DEMO-1 to
  Backlog.

### 2.2 Move-failure banner is clear and safe — *(positive)*
- The failed move showed a top banner: *"DEMO-1 was not moved — the
  change was not saved. The server failed while handling POST
  /api/tasks/DEMO-1/board-move."* with **Retry** / **Reload**, and the
  card was left where it was. Good optimistic-update rollback + recovery
  affordance. (The underlying 500 is the problem, not this UI.)

### 2.3 Board cards don't surface "blocked" or "epic/subtask" — **rough-edge**
- **What I did:** Inspected DEMO-5 (is_blocked_by DEMO-6) and DEMO-10
  (epic, 3 children) cards at full desktop width.
- **What's wrong:** A **blocked** card (DEMO-5) shows no lock/blocked
  marker; an **epic** card (DEMO-10 "Epic: Search revamp") shows no
  child-count badge, and its subtasks show no "belongs to epic" hint.
  For a task tracker board these are the two relationships people most
  want to see at a glance.
- **Suggestion:** Add a small "blocked" pill/icon and an epic
  child-count badge (e.g. "◇ 3") to cards.

### 2.4 Status pills toggle column visibility with no hint — **polish**
- **What I did:** Clicked the **In progress** pill in the board header.
- **What's wrong:** It hides that column (pill dims). Re-clicking
  restores it. Useful, but there's no tooltip/label explaining that the
  pills are visibility toggles; a dimmed pill next to a missing column is
  easy to misread as "no tasks".
- **Suggestion:** Tooltip ("Hide/show column") or an explicit
  eye/checkbox affordance.

### 2.5 WIP not shown
- No WIP limit indicators appear on columns. `workflow.yaml` defines no
  WIP limits in this seed, so this is expected, not a defect — but there
  is no WIP concept surfaced at all if/when one is configured. Flagging
  only so it isn't mistaken for a regression.

---

## 3. Timeline view

### 3.1 Corruption is surfaced here — *(positive, and telling)*
- **What I did:** Opened **Timeline**.
- **What I saw:** Empty chart with an excellent empty-state:
  *"None of these tasks has both a start date and a due date, so there is
  nothing to chart. They are listed under Unscheduled below."* The
  Unscheduled list annotates each row ("No start date — due 2026-09-04"),
  and **DEMO-2 carries a badge: "⚠ due_date is corrupt: 42"**.
- **Why it's telling:** This is the *only primary view* that visibly
  flags DEMO-2's corrupt field. The **task-detail view for the same task
  hides it** (§4.1). Same data, opposite treatment — see the
  cross-cutting finding §6.1.

### 3.2 Controls present: Day/Week/Month, Group by, Dependencies, Today
- The zoom/group controls render and the Dependencies toggle is on by
  default. Not exercised deeply because nothing is chartable in this
  seed (no task has both start + due). Worth a follow-up review once a
  task has both dates.

---

## 4. Task detail

### 4.1 Corrupt `due_date` renders as an empty "—"; unknown `jira_id` is invisible — **confusing** (signature-feature gap)
- **What I did:** Opened **DEMO-2 "Design onboarding flow"**. Its file
  has `due_date: 42` (a number) and `jira_id: ABC-123` (unknown field).
- **What's wrong:**
  - The **Due** field shows just **"—"**, indistinguishable from a
    legitimately empty due date. Clicking it opens an empty date picker
    (the bad value is silently discarded). A user has **no idea** their
    data was rejected. If they save, the corruption is quietly dropped.
  - The unknown **`jira_id`** field is **not shown anywhere** on the
    detail page. `doctor` says it's "kept in place and preserved by every
    write", but the person editing the task can't see it exists.
- **Why it matters:** The detail view is exactly where a user would fix a
  bad field, and it's the one place that gives them no signal. The
  Timeline (§3.1) and Diagnostics (§5.2) both flag DEMO-2 loudly; detail
  is silent.
- **Suggestion:** In detail, render a corrupt field with an inline
  warning (e.g. `Due ⚠ corrupt: 42` with a tooltip and a "clear/repair"
  action), and surface unrecognised keys in a small "Unrecognised
  fields (preserved)" block so they're visible and repairable.

### 4.2 Relationship group headers read backwards for parent/child — **confusing**
- **What I did:** Compared **DEMO-10** (epic) and **DEMO-11** (a child).
- **What's wrong:** On the epic DEMO-10, its 3 children are grouped under
  a header labelled **"PARENT · 3"**. On the child DEMO-11, its parent
  epic is grouped under **"CHILD · 1"**. Both read backwards — the epic's
  children are shown under "PARENT", and the child's parent under
  "CHILD". `workflow.yaml` provides distinct `label: Parent` /
  `inverse_label: Child`, so the direction is being picked from the wrong
  side.
- **Contrast:** The **blocks** relationship reads correctly — DEMO-5
  shows **"IS BLOCKED BY · 1"** → DEMO-6, using the inverse_label with a
  preposition. So the display is inconsistent across relationship types.
- **Suggestion:** Use the directional label consistently (children of an
  epic under "Child"/"Children", the parent under "Parent"), matching how
  blocks already works. A connective ("Parent of…", "Blocked by…") would
  remove all ambiguity.

### 4.3 Description formatting toolbar is always visible (even when just viewing) — **polish**
- The DESCRIPTION block shows the full Bold/Italic/Code/… toolbar
  persistently, and on DEMO-5 the "Code block" button rendered in an
  active/highlighted state while merely viewing. Reads as "always in edit
  mode" and adds visual weight.
- **Suggestion:** Collapse the toolbar until the field is focused/edited,
  or clearly separate view vs edit.

### 4.4 Comments render well — *(positive)*
- DEMO-5's two comments show avatar, author, relative time, body, and
  Edit/Delete per comment. Clean. (Whether **Delete** confirms before
  removing was **not verified** — the emulated-viewport ref drift made a
  safe click unreliable and I did not want to destroy seed data.
  **Recommend confirming** that comment/relationship Delete prompts for
  confirmation; if it hard-deletes on one click, that's a
  destructive-action gap.)

### 4.5 Activity log grammar / raw keys — **polish**
- Activity shows *"ken added a is_blocked_by link"* — "a" instead of
  "an", and the raw relationship key rather than the label ("Is blocked
  by"). Minor but visible.

### 4.6 Seeded junk in DEMO-5 description — **polish**
- DEMO-5's body contains test junk ("dsfdsf / sdfsd", empty headings).
  Cosmetic; clean up the seed before any demo/screenshot.

---

## 5. Settings

### 5.1 Broken label (`l_broken`) silently vanishes and is unmanageable — **confusing**
- **What I did:** Opened **Settings → Labels**. Config
  (`labels.yaml`) has `id: l_broken, name: 999` (name is a number).
- **What's wrong:** The Labels page lists only the 4 valid labels; the
  broken one is **completely omitted** — no row, no "1 label couldn't be
  read" notice. The task counts and the `doctor` label count both say
  "4", excluding it. So a user **cannot see, edit, archive, or delete**
  the broken label from the UI; the one place to manage labels pretends
  it doesn't exist. Their only path is hand-editing YAML (which the
  Diagnostics text does mention — but only if they go look there).
- **Suggestion:** Show the unreadable label as a disabled/error row
  ("⚠ l_broken — couldn't be read (name must be text)") with a Repair or
  Delete action, so it's visible and fixable in-app.

### 5.2 Diagnostics page is excellent — *(positive)*
- **Settings → Diagnostics → Run diagnostics** runs the `loctt doctor`
  checks and reports "15 passed · 3 warnings · 0 failed", surfacing all
  three corruptions with clear, actionable, per-file messages (jira_id
  unrecognised; due_date wrong_type: 42; l_broken name-not-a-string),
  each saying the value is preserved and how to repair (`loctt set` /
  `unset` or edit by hand). This is the degradation story done right.
- **The gap (see §6.1):** it's the *only* place a user learns any of
  this, and it's buried three clicks deep behind a manual "Run" button.

### 5.3 "Progress is shown on the Milestones view, not here" points nowhere obvious — **rough-edge**
- **Settings → Milestones** says progress lives on "the Milestones
  view". There is no Milestones view in the primary nav (only List /
  Board / Timeline); the sidebar milestone links go to
  `/list?milestone=…`, which is just a filtered list with **no progress
  bar**. So the referenced "view" isn't discoverable. (Progress may be
  computed by core `computeProgress`, but it isn't surfaced on the
  milestone-filtered list where a user would look.)
- **Suggestion:** Either add a real milestone progress display on the
  filtered list header, or change the copy to point at where progress
  actually renders.

### 5.4 Settings IA is strong — *(positive)*
- The left sub-nav groups (Workspace / Workflow / Data / Tracker /
  Personal) are comprehensive and well-organised.

---

## 6. Cross-cutting UX

### 6.1 Degradation is loud in `doctor`, silent in the surfaces users live in — **confusing** (the big one for this app)
- The corruption handling is genuinely good **where it's shown**
  (Diagnostics §5.2, Timeline badge §3.1). But in the surfaces a user
  actually works in it's invisible or misleading:
  - Task detail shows a corrupt due_date as an empty "—" and drops the
    unknown field entirely (§4.1).
  - The List view shows DEMO-2 as an ordinary row (Medium, no due) with
    no marker.
  - The Labels settings page hides the broken label completely (§5.1).
  - There is **no global signal** — no "3 warnings" badge in the header
    or sidebar, no dot on Settings — pointing users toward Diagnostics.
    A user would only find the warnings by manually opening Settings →
    Diagnostics → Run.
- **Net:** the feature communicates to a *CLI/doctor* audience, not to a
  *UI* user. For the app's signature capability, that's the thing most
  worth closing.
- **Suggestion:** Add a lightweight global "data-integrity" indicator
  (header/sidebar badge with the warning count, linking to Diagnostics),
  and inline corrupt-field markers in detail + list so the corruption is
  encountered where the data is used, not only where it's audited.

### 6.2 Global header search does nothing — **broken**
- **What I did:** Typed "redirect" (matches DEMO-5) into the top
  **"Search tasks…"** box and pressed Enter. Also set the value directly
  and pressed Enter.
- **What's wrong:** No filtering, no results panel, no navigation, no
  network request fired (console clean apart from the earlier board 500).
  The most prominent, always-visible control in the app appears **not
  wired up**. (Filtering is only reachable via the facet dropdowns or the
  Advanced DSL.)
- **Suggestion:** Either wire the box to filter/search (live or on
  Enter), or, if search is genuinely not built yet, disable it with a
  placeholder/tooltip ("Search coming soon") so it doesn't read as
  broken. Compare the honest treatment of "Mentions me" in the sidebar,
  which is greyed with a tooltip "available once comments land (M2)".

### 6.3 New-task form: silent no-op on empty title; defaults are "—" not the configured defaults — **rough-edge**
- **What I did:** Opened **New task**, clicked **Create task** with an
  empty title.
- **What's wrong:**
  - Nothing happens — no task created, no inline "Title is required",
    the Title field isn't flagged, and the Create button still *looks*
    fully enabled (purple). Silent no-op = user confusion.
  - **Status** and **Type** default to "—" even though `workflow.yaml`
    marks `backlog` as `default: true` (and there's a default task type).
    A new task usually wants to open pre-set to Backlog rather than
    unset.
- **Suggestion:** Show inline validation on empty title (and/or visibly
  disable Create), and pre-fill Status/Type with the configured defaults.

### 6.4 Empty & error states are generally strong — *(positive)*
- Good empty states seen: Timeline empty chart (§3.1), "No tasks in
  Won't do" board column, "No comments yet.", "No linked tasks.", "No
  attachments on this task yet." with an Upload affordance. The
  Advanced-mode fallback message is honest too: *"Basic mode cannot show
  this query: basic mode has no control for 'due_date'."*
- CSRF protection is enforced on writes (missing `X-Loctt-Client` →
  403 with a plain-English message).

### 6.5 Native-control accessibility — *(positive, partial)*
- Inline date editing uses a native `<input type="date">`; the search
  box is a real `type="search"`; there's a "Skip to main content" link
  and labelled toggles. Solid baseline. Full keyboard-nav of the list
  rows / board DnD was **not** exhaustively verified (tooling
  constraints) and is worth a dedicated a11y pass.

### 6.6 Responsive layout degrades awkwardly around tablet width — **rough-edge**
- At ~760px CSS width the board shows essentially **one column at a
  time** with the next column just peeking and no clear horizontal-scroll
  affordance; the list toolbar's filter buttons stack into a tall
  vertical column; the list table clips the Title column. The detail view
  stacks sensibly (metadata drops below the body), so the pattern exists
  — the board and list toolbar are the weak spots.
- **Suggestion:** Give the board a visible horizontal scroll affordance
  / narrower columns at tablet width, and collapse the list filter row
  into a single "Filters" menu below a threshold.

---

## Positives worth keeping
- Optimistic board move with clean rollback + Retry/Reload on failure.
- Diagnostics page mirrors `loctt doctor` with actionable repair hints.
- Timeline empty-state and per-row scheduling annotations (incl. the
  corrupt-field badge).
- Consistent, removable facet chips (for facet params) with count badges.
- Archived rows dimmed + tagged; comments UI; honest "not built yet"
  messaging for Mentions and for Advanced→basic fallback.
- CSRF-protected writes with human-readable refusals.
