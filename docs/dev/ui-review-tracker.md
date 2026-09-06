# UI review — running tracker

**Purpose.** A single running log of UI/UX issues found while Ken explores
the seeded demo tracker (`/tmp/loctt-demo`, served at :7755). **Track
now, fix later** — nothing here is fixed unless its Status says so. Ken
will decide what to action and when.

**No design mockups exist in the repo** — the UI test cases
(`docs/dev/ui-test-cases/`) pin *behavior*, not visual design. So most of
these are new design-intent calls, not "match the mockup" fixes. A fix
must keep the pinned behavior + the e2e test-ids.

Severity: **P1** broken/misleading · **P2** clearly wrong, visible ·
**P3** polish/nit.

Detailed proposals for the bigger items live in the sibling
`ui-review-*.md` docs (form-controls, toolbar, consistency,
ux-interactions, responsive-theme); this file is the index + Ken-reported
items.

---

## ⚠ Correctness bug found during the review (NOT a UI item)

| # | Area | Issue | Severity | Status |
|---|---|---|---|---|
| BUG-1 | core — journal replay / relationship remap | The per-view UX agent hit **HTTP 500 on board drag**; I reproduced it and found it's far broader: **every task write on every surface throws** `internal: missing relationships remap for "is_blocked_by" on task DEMO-4`. Root cause: a stuck `remap_workflow` entry in `.loctt/local/journal.yaml` (written during seeding, 07:34) that LocTT's crash-recovery **replays on every `withStateLock`**, and the replay's `applyRelationshipsRemap` (`config/workflow-write.ts:461+`) throws on the auto-written **inverse** relationship `is_blocked_by` (declared `blocks → inverse: is_blocked_by` in workflow.yaml). Effect: a tracker holding any blocks-relationship becomes read-only until the journal is cleared. **Two real questions for a diagnosis agent:** (1) how did the remap_workflow entry get stuck when no workflow edit was run? (2) why can't replay handle a valid inverse-relationship key? — same inverse-handling class Phase Z's git agent found. **Unstuck the demo** by clearing the entry (saved to `/tmp/poisoned-journal.yaml`); DEMO-1 restored to backlog. **CONFIRMED shipped bug (diagnosis agent, `bug-journal-remap-inverse.md`):** repro without seeding — `link A blocks B` then ANY Settings→Workflow save throws; root cause `applyRelationshipsRemap`/`validateRemapCoversDeletions` build rel vocab from `r.key` only, ignoring the inverse keys `linkTask` writes. **CONFIRMED THROUGH THE UI (workflow CRUD agent):** Settings→Estimation label change → Save → inline error "Not saved…: internal: missing relationships remap for is_blocked_by on task DEMO-2" (`PUT /api/workflow` 400); then DEMO-3 status change → **500**, tracker bricked, UI shows a "reload won't help" banner. **This is the root of Ken's "some CRUDs don't work."** Compounding UX: raw `internal:` error string; wrong `recovery: reload`; no user-facing way out (must hand-delete journal.yaml). **Fix (core `workflow-write.ts`):** build rel vocab via `flatMap(relationshipTypeKeys)` incl. inverses; re-seed the rel/journal test fixtures through `linkTask` (green because they bypass it). Fable diagnosis gives the exact fix. | **P0/P1** | CONFIRMED (API + UI) — fix ready to build |
| BUG-2 | core/web — milestone delete | Milestone-delete "leave it" copy promises the task keeps a **dangling milestone ref + drift marker** (Diagnostics-flagged), but the server actually **clears** the task's `milestone` field (verified on disk — no drift, nothing for doctor). Copy says the opposite of the behaviour = trust bug. Fix is a decision: make "leave it" truly leave the dangling ref (matches copy + degradation ethos), or fix the copy. Check label/sprint/project delete "leave" copy for the same shape. | P2 | tracked |

## Config CRUD (UI-driven, isolated trackers)

Workflow panel (`ui-crud-workflow.md`): **WORKS** = most individual
controls (reorder, delete, estimation/calendar fields, add-holiday).
**BROKEN** = the SAVE path on *every* workflow surface — all route to
`PUT /api/workflow` and 400 on any tracker holding a directional link
(= BUG-1; system-wide, also bricks non-workflow writes). **MISSING** =
in-UI **create** for statuses / priorities / task-types / relationships /
custom-fields (custom fields are YAML-only — no create/edit/delete/reorder
in UI at all). **INLINE-EDIT violations** = statuses/priorities/types/
relationships auto-save in place with no confirm (confirms the edit-model
audit). Projects/labels/milestones (`ui-crud-projects-labels-milestones.md`):
**17 WORKS · 0 BROKEN · 3 MISSING.** No 500s/no-ops; all destructive ops
confirm; BUG-1 NOT observed here (remap-on-delete returned 200). **WORKS:**
projects create/edit-name/**prefix-edit (PRU-44 IS built — editable via a
confirm dialog; slug is the readOnly field, not prefix)**/archive/
unarchive/delete/delete-with-remap; labels full CRUD incl. colour;
milestones create/edit/delete/delete-with-affected-task. **MISSING:**
(p1) project set-**default** absent from the panel (only a personal
default in My preferences; core `setDefaultProject` exists); (m1)
milestone **archive/unarchive** — no control anywhere (`useUpdateMilestone`
only sends {name,target_date}, though core supports it). **NEW BUG
(copy-vs-behaviour, data/trust):** milestone-delete "leave it" option
*promises* the task keeps a dangling ref + drift marker for Diagnostics,
but the server actually **clears** the task's milestone field (verified on
disk). Warning says the opposite of what happens → **BUG-2**. Minor:
"1 task currently use" agreement typo; a stale "Project deleted" dialog
leaked into a fresh Delete once.

Sprints/users/views (`ui-crud-sprints-users-views.md`): **18 WORKS · 8
MISSING · 0 BROKEN.** No raw 500s / silent no-ops / unconfirmed
destructive ops. **MISSING (backend exists, UI doesn't reach it):**
(u1) existing user name/email/timezone entirely uneditable in UI — must
delete+recreate to fix an email (= K-11, worst); (u2) sprint create /
delete / archive / unarchive absent from the Settings panel; (u3) saved-
view rename / edit-query absent (`PUT /api/views/:id` exists), + "+ New
filter" disabled (= K-8). **WORKS:** sprint detail edit (name/start/goal
commit-on-blur, state-select commit-on-change), burndown live; user
create/avatar/archive/delete incl. a working assignee-remap on delete
(so BUG-1 is the workflow-save remap path specifically, NOT remap in
general); saved-view save/archive/unarchive/delete. INLINE-EDIT note:
sprint-detail meta commits on blur/change (edit-model: sprint config →
should be Edit-gated per "inline is for tasks").

## CRUD check (Ken: "some UI interactions / CRUDs don't work")

Probed every task write endpoint on the live server after clearing the
BUG-1 journal: **CREATE 201, SET 200, UNSET 200, LINK 200, ARCHIVE 200,
DELETE 200 (→404 gone)** — all sound at the API/core layer (delete
correctly requires confirm; link's field is `type`). **Most likely cause
of the CRUD failures Ken saw: BUG-1's poisoned journal — while it was
present, EVERY write 500'd on all surfaces, so any UI CRUD in that window
failed.** Now cleared. If specific UI CRUDs still fail post-clear, they
need per-interaction repro (candidate: the client not sending the right
payload shape, or an unhandled error state) — flag the exact action.

## Ken-reported

| # | Area | Issue | Severity | Status |
|---|---|---|---|---|
| K-17 | Timeline view | Timeline feels janky (Ken). Beyond the earlier interaction pass — a focused VISUAL/layout review of the timeline: bar/lane spacing, alignment to the date axis, zoom (day/week/month) transitions, grouping, dependency arrows, the corrupt-dated + unscheduled affordances, empty state. Dedicated agent → `ui-review-timeline.md`. | P2 | tracked — `ui-review-timeline.md`. **T2 (P1): empty-state paints a ~388px blank framed void** because the seed had no fully-dated task (fixed the seed: added DEMO-16..20). Also: no vertical gridlines (T3); partial-week header 12px wide, label overflows (T4); h-6 header clips text 1px (T5); bars/arrows unverified until dated data (now seeded). | tracked |
| K-18 | Board (Kanban) view | Board is ugly — spacing/rhythm is bad (Ken): column gutters, card padding/margins, header spacing, WIP/count placement, density. Focused visual/layout review of the board → `ui-review-board.md`. Ties to K-15 + S-7. **`ui-review-board.md`: worst = redundant info** — count shown twice (chip bar `BoardView.tsx:361-386` + column header `:721-736`); project prefix twice per card (`DEMO` chip then `DEMO-1` key `BoardCard.tsx:205-216`); flat meta stack, no title/meta separation. **Root systemic (also blocks all layout fixes): root font is 14px so no Tailwind step lands on a 4/8 grid, and `--space-*` tokens were NEVER created — S-7 unmaterialized.** 5×P2, 4×P3. | P2 | tracked |
| K-15 | List — row hover | On row hover, the **project-ID cell and label cell don't pick up the highlight** (their inner pill/chip renders its own bg over the `<td>`), and the **label colour washes out into the hover** (`ListView.tsx:720` `hover:[&>td]:bg-bg-muted` is too bright). Fix: (a) tone the row-hover token down / use a subtler hover bg; (b) make chips theme-aware against the hover state so colour survives. Component-level (Chip primitive, B1) + hover-token (B1 contrast/token work). Ken: "maybe don't make the hover colour so bright." | P2 | tracked |
| K-16 | App-wide — cursor | Many interactive elements show the default arrow, not a pointer, on hover (e.g. the filter dropdowns) — native `<button>` has no pointer by default and only **5 of 80** button files set `cursor-pointer`. Ken: fix at the **component level, not copy-pasted** → bake `cursor-pointer` into the shared Button/ToolbarButton/IconButton/interactive primitives (B1); B4 migration removes the ad-hoc ones. | P2 | tracked |
| K-1 | Form controls | Native `type="checkbox"` looks bad — doesn't pick up the dark theme/accent, inconsistent sizing/focus. Systemic: raw native checkbox in ~10 client files, no shared `<Checkbox>` primitive. | P2 | tracked — see `ui-review-form-controls.md` |
| K-2 | List toolbar | "Advanced" button is a different height/weight/border from its neighbours (`FilterBar.tsx:194` uses `px-2 py-1 text-[12px]` vs the facets' `h-8 text-[13px]`), AND it's a mode-toggle (opens the DSL editor), functionally unlike the facet dropdowns it sits among — likely belongs in a different cluster. | P2 | tracked — see `ui-review-toolbar.md` |
| K-3 | List toolbar | Toolbar layout has "no rhyme or reason" — facet dropdowns, Show-archived toggle, Save-as-view, Refresh, Export mixed without functional grouping/alignment. Root cause: no shared Button primitive; each button is bespoke Tailwind. | P2 | tracked — see `ui-review-toolbar.md` / `ui-review-consistency.md` |
| K-4 | Task detail — relationships | A relationship row's label/status-pill doesn't right-align because the remove control (`RelationshipRow.tsx:174`, `opacity-0 … group-hover/row:opacity-100`) still occupies layout width while hover-hidden. Ken's idea: replace the hover-reveal remove with a persistent control button (a "⋯" / kebab) that opens a small dropdown of controls (remove, and room for future actions) — fixed slot, clean alignment. | P2 | tracked |
| K-7 | Task detail — rich-text editor | **Diagnosis corrected by live repro (`ui-review-editor.md`): the heading is NOT broken end-to-end** — H2 applies → serializes `##` → saves → reloads → renders `<h2>`, verified live. Why it *reads* as broken: (a) **no H1–H6 picker** — `Toolbar.tsx:31-34` hardcodes one H2 button (the real gap, **P1**); (b) a **caret quirk** — applying to a whole-paragraph selection drops the caret into a trailing empty `<p>` so the button never lights up → looks like nothing happened (P2). Fix is UI + wiring only — StarterKit already enables levels 1–6 and the markdown round-trip handles all six; no new extension, no round-trip fix. | P1 | tracked — `ui-review-editor.md` |
| K-7b | Editor | Sub-findings: **no ordered-list button** despite pipeline support (P2); **no placeholder** in the rich editor (P2); **markdown paste inserts as literal text** instead of parsing (P2); toolbar buttons hand-rolled, no shared primitive (P2, = K-3 root). | P2 | `ui-review-editor.md` |
| K-6 | Task detail — labels field | The "urgent ×" label chip and the "+ Label" add-affordance are different heights. Cause (`LabelsField.tsx`): the chip (line 142) has NO border; "+ Label" (line 167) adds `border border-dashed`, so its box is 2px taller (both otherwise share `px-2 py-0.5 text-[11px] rounded-full`). Fix: give the chip a matching transparent `border border-transparent` (or use box-sizing/height so both resolve to the same height). Trivial once a shared chip primitive exists (ties to K-1/K-3 design-system work). | P3 | tracked |
| K-8 | Sidebar — New filter | "+ New filter…" is hardcoded `disabled` (`Sidebar.tsx:715`, title "Saved-view editor arrives in a later milestone") — a deliberate placeholder for an unbuilt saved-view-create UI, not a bug. But an always-disabled control discoverable only on hover reads as broken. Options: hide it until built, or (better) build the create-view flow — note the Phase-Z parity review found saved-view management was web-only and only recently reached CLI/MCP; the web *create* entry point is the gap. | P2 | tracked |
| K-14 | Sprints — surfacing (nothing dropped) | Ken felt sprints are "missing stuff (burndown, dates)". Verified: **nothing was dropped** — burndown (`core/sprints/burndown.ts` → `GET /api/sprints/:key/burndown` → `BurndownChart.tsx` in `SprintDetail.tsx`) and start/end/state (`SprintMetaHeader.tsx`) are all built. It's a **surfacing** problem: the sprints *list/overview* (`SprintsView.tsx`) is sparse — burndown + dates live only on the detail page, and there's no at-a-glance preview (progress done/total, date range, days-remaining, a mini-burndown) on the overview. Ties to F1 (Phase Z fixed sprint-progress on CLI/MCP but the web sprint client still doesn't show done/total) and K-9 (milestones overview, same shape). Fix: enrich the sprint overview cards + make them fully clickable → detail. | P2 | tracked |
| K-11 | Settings — Users panel | Three problems (`UsersPanel.tsx`): (a) the avatar cell is a raw native `type="file"` input inline in the table (`:121-125`) → the ugly "Choose file / No file chosen" (same unstyled-native-control root as K-1). (b) **EMAIL is shown read-only but has no inline editor** — email/name/timezone are only settable in the "New user" *create* form (`:199,:212+`), so an existing user's blank email **cannot be edited at all** from this table. Core/CLI/MCP `user edit` exists — the web UI just doesn't expose it (parity-shaped gap, like PRU-44). (c) No per-row **Edit** affordance. Ken's fix: a per-row Edit button → an edit dialog (name, email, timezone, avatar), replacing the inline file input + read-only email. | P2 | tracked |
| K-10 | Sidebar — customization | Partial only. `SidebarPinsPanel` (Settings) pins/orders **saved views** in the sidebar (`SidebarPinsPanel.tsx`), and there's a `sweep_sidebar_pins` on CLI/MCP. But there is NO editor for the sidebar as a whole — you can't show/hide or reorder the top-level groups (Projects, Milestones, Sprints, Labels, Recently viewed) or the built-in filters. Ken wants a full show/hide + reorder editor. Design + build (a new capability, not just UI). Ties to K-8 (the disabled New-filter). | P2 | tracked |
| K-9 | Milestones page | (a) A milestone card isn't fully clickable — the whole card should open the milestone (currently only part is a target). (b) The page "looks very plain" — Ken wants an at-a-glance overview: e.g. progress bar (done/total — the data exists via `milestoneProgressDetailed`), target date + countdown/overdue, task-count breakdown by status, the `unreadable` notice, maybe assignee avatars. Needs a design pass, not just a click-target fix. **Review-2 correction: the progress bar ALREADY renders** (`MilestonesView.tsx` → `ProgressReadout`; MSL-1 is tagged + green). So K-9's real residual is full-card click (MSL-39) + countdown/overdue (MSL-40) + status breakdown (MSL-41) — NOT the progress bar. | P2 | tracked — see `ui-review-ux-interactions.md` (pending) |
| K-5 | Task detail — activity/comments | The Activity feed interleaves comments with field-change/status activity in ONE list (`ActivityPanel.tsx` flattens all entry types), so on a busy task the actual discussion is buried in automated-activity noise. Ken: should be **tabbed** (e.g. Comments / Activity / All). NOTE on pagination — it *does* paginate (`useInfiniteQuery`, server `?limit`/`?offset`, load-more per page with per-page failure handling), so it won't load everything at once; but pagination is linear append, not a jump, and doesn't separate comments from activity. Tabs solve the "hard to find the conversation" problem pagination can't. **Review-2 correction: CMT-18 is already tagged + green (sections "stacked, not tabs", `flow-comments.spec.ts:1308`) — NOT unsatisfied. K-5's tab split EDITS that green test (name it in the commit); no new case needed.** | P2 | tracked |

---

| K-12 | App-wide — interaction states | Some buttons/controls lack proper interaction states (hover / active / focus-visible / disabled) — inconsistent or missing feedback. Reinforces the need for **a proper design component library** (a real `Button`/`Chip`/`Input`/etc. with all states defined once), not per-button Tailwind. This is Ken's explicit call: "we need a proper design component library." | P2 | tracked — see `ui-review-consistency.md` + the design-system decision below |
| K-13 | App-wide — **edit model (PM/UX)** | **Principle (Ken):** view/"view-all" surfaces should NOT allow inline editing — it risks accidental edits, and created config isn't meant to change frequently. Editing belongs behind an explicit **Edit button → dialog**. First instance: relationships in the task detail's relationship list shouldn't be inline-removable (ties to K-4); same concern applies to Users (K-11), and likely labels/milestones/sprints/projects/workflow panels and inline task-field edits. **A dedicated PM/UX review is auditing every editable control across every screen against this principle** → output `ui-review-edit-model.md`. | P1 | tracked — PM/UX review dispatched |

## From the review swarm

Populated as the `ui-review-*.md` agent docs land. Each row cross-refs its
detail doc; the highest-severity items get pulled up here.

| # | Area | Issue | Sev | Detail doc |
|---|---|---|---|---|
| S-1 | Form controls | **~46 native form controls across 24 files, all unstyled** (15 checkbox, 7 radio, 14 select, ~21 text) — render as OS default, ignore tokens/accent/theme. (Confirms K-1, systemic.) Recommend `Checkbox`/`Radio`/`Toggle`/`Select`/`TextField` primitives in `ui/`. Indeterminate needed for ListView select-all. | P2 | `ui-review-form-controls.md` |
| S-2 | List | Header select-all checkbox (`ListView.tsx:586`) doesn't set `accent-accent` while the row checkboxes (`:600,:740`) do — checked color inconsistent within one table. | P3 | `ui-review-form-controls.md` |
| S-3 | List toolbar | **Export** button (`ExportMenu.tsx:122`) is a SECOND off-spec button — no `h-8`, shorter than Refresh beside it. So Advanced + Export are exactly the two that don't align (matches Ken's observation). | P2 | `ui-review-toolbar.md` |
| S-5 | App-wide | **~25 distinct button styles for ONE concept** — 51 distinct `<button>` className strings across 80 files, none shared (no `ui/Button`). The primary accent button alone has ~10 variants (height mechanism, font-weight, disabled opacity 50 vs 60). Root cause behind K-2/K-3/K-6/S-3/S-4. | P2 | `ui-review-consistency.md` |
| S-6 | App-wide | **Real defect (not cosmetic): `text-white` on colored buttons in 7 places** bypasses the `--accent-contrast` token → labels can be illegible on a light accent. | P2 | `ui-review-consistency.md` |
| S-7 | App-wide | No named scale: `rounded` (off-token 4px, 216×) vs `rounded-md` (6px token, 200×) ~50/50 for the same corner; 9 ad-hoc `text-[Npx]` sizes; pill/chip re-implemented ~11× with drift; text-input 9×; error-banner ~5×. Recommend scaffolding order: `Button` → `Chip` → `Input/Field` → `Callout` → `icons.ts` glyph map + a scale doc banning bare `rounded`/`text-white`. (Board already reuses List's `cells.tsx` chip renderers — the model to follow.) | P2 | `ui-review-consistency.md` |
| S-9 | Theme/contrast | **`--text-tertiary` fails WCAG AA (3.3–3.9 vs 4.5) on every background, in BOTH themes** — a real legibility issue (not a parity bug). `status-discarded`, `priority-low`, `border-subtle` also sub-threshold. Fix: darken/lighten the tertiary + these tokens to clear 4.5 (text) / 3:1 (borders). Accent-on-accent-muted chips PASS (cleared). | P2 | `ui-review-responsive-theme.md` |
| S-10 | Responsive | Settings at narrow width breaks worst: `SettingsShell.tsx:43,164` lays `w-56` nav + content side-by-side in `flex h-full` with no breakpoint → at 380px the panel squeezes to ~100px and text clips (h-scroll inside `<main>`). Also: mobile sidebar is a permanent unlabeled 56px icon rail, un-dismissable (toggle disabled <900px); `DeleteViewDialog` hard `w-[26rem]` no max-w. | P2 | `ui-review-responsive-theme.md` |
| S-11 | Theme | Hardcoded-hex ColorDots (`Sidebar.tsx:469,517,815`) bypass the theme system; board columns fixed `w-[280px]`; filter toolbar stacks tall on mobile. GOOD: no page-body h-scroll anywhere; theme parity sound; corrupt ⚠ reads in both themes. | P3 | `ui-review-responsive-theme.md` |
| S-8 | App-wide | Icon-glyph drift: star `★` vs `⭑`, close `×` vs `✕`, caret `▾` vs `▼` — needs a shared glyph map. | P3 | `ui-review-consistency.md` |
| S-4 | List toolbar | Toolbar is split across TWO components / two flex containers (facets+archived+Save-as-view in `FilterBar`, Refresh+Export in `ListView.tsx:480-487`) — root cause of "can't wrap/align together." Proposed IA: `[facets] ‹spacer› [Advanced query · Show archived · Save as view] │ [Refresh Export]`, chips on their own line. Advanced → mode-toggle (`aria-pressed`) in the action cluster, not among facets (confirms K-2). Needs a shared `ToolbarButton`. Preserve test-ids advanced-query-toggle/dsl-*/switch-to-basic + labels; cases LST-12, VUE-6/7/8/10/11. | P2 | `ui-review-toolbar.md` |

---

## Ken's decisions (for the implementation batches)

- **Case reversals APPROVED (Ken, 2026-09-06):** SET-16, SET-17, SET-19,
  SET-28, SPR-8, REL-12 rewrites in PROPOSED-UI-CASES.md are accepted —
  they apply already-made rulings (BUG-2 copy, K-4 kebab, edit-model).
  SET-51 additive (SET-34 untouched). PRU-44 preserved. These land in the
  flow docs + cases:index as the FIRST step of their batches (gate step 0),
  then code.
- **K-10 sidebar-groups shape DECIDED (Ken, 2026-09-06):** **per-user**
  (like existing pins) · built-in groups **hideable AND reorderable** ·
  **full CLI/MCP parity** (Ken: an agent/MCP may want to configure the UI
  too — parity principle applies). Load-bearing schema → a new per-user
  `sidebar_groups` settings shape in contracts/core, exposed on web +
  CLI + MCP, with doctor tolerance. This is the K-10 multi-layer lane.

**Operating rule (Ken 2026-09-06): don't run low-level UI preferences by
Ken.** If a call has a sensible recommended answer, the PM agent decides
it and we proceed with the best recommendation. Escalate to Ken ONLY for:
irreversible / scope / product-direction calls, a data-model or
cross-surface-contract shape, or a contradiction with a locked decision.
The 7 "open decisions" are re-triaged on that basis:
- PM-DECIDES (proceed, no Ken): edit-dialog shape ✓done, undo ✓done,
  config reorder ✓done, "all ingested findings in this release" (yes —
  Ken already said ingest all + release all), design-system's 6
  sub-decisions, Edit-gated-form-vs-modal specifics.
- KEN (real forks, surface only if the PM proposal hits a genuine fork):
  (1) K-10 sidebar-groups persisted-settings SHAPE (contracts/core/CLI/
  MCP/doctor blast radius); (2) doctor/journal P-11 give-up policy
  (data-integrity principle). PM agent proposes both; escalate only if a
  fork remains.

- **Edit-dialog shape (Ken 2026-09-06, recommended):** **modal for
  destructive/identity edits** (project prefix rename, delete-with-remap,
  workflow key changes that rekey tasks) — the high-cost, cascading ones
  get a hard boundary + confirm; **Edit-gated inline form (Save/Cancel,
  reuse Labels/Milestones pattern) for low-risk fields** (names, colours,
  dates). Consistency that matters = nothing edits until you opt in; both
  honor it. (B2.)
- **Undo (Ken 2026-09-06, recommended):** **add Undo (toast) to board/
  timeline drag + bulk-Set.** These are the one-gesture, no-confirm inline
  mutations "inline is for tasks" keeps — a misdrag is the easiest
  accident and the board may not even show it happened. Toast-Undo makes
  fast-inline safe. (B3 board/timeline + B-bulk lane.)
- **Config reorder (Ken 2026-09-06, recommended):** **keep reorder
  inline.** Reorder changes ORDER not content — no accidental-content risk
  the edit-model guards; gating it adds friction for no safety gain. Only
  field-content edits go behind Edit. Revises the literal SET-* reorder
  cases. (B2.)

- **Release model:** everything in this tracker ships in ONE release —
  **no prioritization**; every item is implemented. Batches are for
  execution grouping (dependencies + file-lanes), not importance.
- **Edit model (resolves the K1 conflict), Ken 2026-09-06:**
  **"inline everything is for tasks."** → Inline editing stays for
  TASKS (list inline edits, task-detail field panel, board/timeline
  drag). Everything else — all Settings/config panels (projects, labels,
  milestones, sprints, users, workflow statuses/priorities/task-types/
  relationships/custom-fields) AND relationships on a task — is
  **view-by-default; edit behind an explicit Edit button → dialog.**
  This SUPERSEDES K1 (decisions.md §9) for the config panels; a new
  decisions.md entry will record it at build time. So the ~12 config
  inline-edit "violations" + K-4 (task relationships) + K-11 (users) all
  get the Edit-dialog treatment; task inline edits are NOT touched.
- **`--root` canonical** (CLI-1) + `--cwd` alias — see Found-during-setup.

## Recommendations on the two blocking decisions (Ken asked "which makes more PM sense")

- **BUG-2 → recommend FIX THE COPY** (dialog says the field is cleared,
  because that's what happens). PM reasoning: "leave it" means "don't
  make me remap" — no user is asking to *manufacture* dangling refs +
  doctor warnings on a routine delete. The degrade-don't-destroy ethos is
  for tolerating corruption someone ELSE made, not creating it. Clearing
  is the sane default; only the copy is wrong. Reverses approved case
  SET-17 → must go through the PROPOSED-UI-CASES pass. **DECIDED (Ken,
  2026-09-06): fix the copy** — SET-17 (+ sibling "leave dangling" cases)
  rewritten to "clears the field"; recorded in decisions.md at build.
- **K-4 → recommend INLINE KEBAB + CONFIRM** (not an Edit-dialog). PM
  reasoning: a task's relationships are part of editing that task, so per
  "inline is for tasks" they stay inline — a full dialog would be heavy +
  inconsistent with every other task-field edit. Kebab (⋯→Remove, with
  confirm) fixes the real problems (hover-invisible, accidental click,
  alignment) without over-gating. So: config → Edit-dialog; a task's own
  relationships → inline kebab+confirm. Reverses REL-12 → PROPOSED-UI-
  CASES pass. **DECIDED (Ken, 2026-09-06): inline kebab + confirm.**
  REL-12 rewritten (kebab, confirm-on-remove); recorded at build.

## Proposals awaiting Ken's decision

- **Design component library** — `ui-design-system-spec.md`. Buildable
  plan: `icons.ts`+`cn` → Button → IconButton → ToolbarButton → Chip →
  Checkbox/Radio → Select/TextField/Callout → Toggle; + contrast-token
  fixes (independent). Effort: **core ~48–58h (6–7d)**; **min-viable
  (what Ken flagged: Button/IconButton/ToolbarButton + Checkbox/Radio +
  contrast) ~28–36h (~4d)**. Scope options A (all-at-once) / **B
  (incremental, recommended)** / C (min-viable). 7 open sub-decisions
  listed in the spec (Toggle look, count-badge shape, a `text-micro`
  name, raise-vs-document the 3 sub-AA tokens, `className` escape hatch,
  scope A/B/C). **This is the single highest-leverage item — most K/S
  visual findings collapse into it.**
- **Edit-model pattern** — `ui-review-edit-model.md` (DONE). **14
  VIOLATIONs** of Ken's view-vs-edit principle. Recommended rule:
  *view surfaces read and navigate; a saved record changes only through
  an explicit Edit (dialog for config, in-place for the task editor);
  destructive actions confirm, reversible actions offer Undo.*
  Confirms K-4 (relationship hover-remove, no confirm) + K-11 (users).
  The config Settings panels (Projects/Custom-fields/Enums/Status/
  Relationships) edit inline with no Edit gate; Sprint-detail state
  `<select>` commits on change. **Tension to resolve (Ken's call, flagged
  by the agent):** `decisions.md §9 K1` (Ken, 2026-08-29) explicitly made
  workflow panels editable inline — so 12 of the 14 were built as
  intended under K1. Reconciling the new principle with K1 is a Ken
  decision, not an agent's. 6 JUDGEMENT calls (board/timeline drag = keep
  but add Undo; config-row reorder = keep). Side-findings: `DeleteViewDialog`
  is dead code; some config panels have no add-row affordance (PG-5).

## Ingested from the per-view UX walkthrough + editor review

**Ken: "ingest them all."** These are the findings from
`ui-review-ux-interactions.md` and the three editor P3s from
`ui-review-editor.md` that the "From the review swarm" table above never
captured (that table drew only from form-controls / toolbar / consistency /
responsive-theme). Deduped against what is already tracked: ux §2.1 (board
500) **is BUG-1**; the editor P1/P2s **are K-7 / K-7b**; ux §6.6 tablet-width
board/toolbar **overlaps S-11** (cross-ref, not a duplicate). Severity uses
the same P1/P2/P3 scale as the rest of this doc.

**The signature-feature UX gap (call it out prominently).** The app's
degradation story is loud where it is *audited* (`doctor` / Diagnostics
§5.2, Timeline badge §3.1) and **silent in every surface a user actually
works in** — see UX-11 below. That is the single most important theme in
the walkthrough after BUG-1, and it is the thing most worth closing for
the app's signature capability.

| # | Area | Issue | Sev | Detail |
|---|---|---|---|---|
| UX-1 | List — `q=` filter | A free-query (`q=`) filter (every sidebar saved filter routes through it) shows **no chip, no highlighted Advanced button, and no "Clear all"**. A user landing from a bookmarked/saved filter sees a short list with no in-page explanation and no obvious way back. Facet params (`project`/`milestone`/`labels`/`sprint`) *do* render removable chips + a `· 1` count; the DSL `q=` param does not. Fix: render a chip ("Filtered query ✕" or the saved-filter name) and/or auto-highlight Advanced; at minimum expose Clear all. | P2 | ux §1.1 |
| UX-2 | List — sort direction | First click on a sort header sorts **ascending** (Low→Critical for Priority, oldest-first for Due). `workflow.yaml` documents priority top→bottom = highest→lowest, so a triage click on Priority expects Critical first; the first click gives the opposite. Fix: default the first click on priority (and arguably due date) to the most-useful direction, and/or show the sort-arrow direction more loudly. | P3 | ux §1.2 |
| UX-3 | List — sidebar hrefs carry ambient sort | Every sidebar link (projects, saved filters, milestones, sprints, labels) appends the live `sort`/`dir`, so a saved filter opens with whatever sort you happened to have (a "blocked" view can open Low-first) and looks like it "remembers" a sort it doesn't own. Fix: decide deliberately whether saved filters carry ambient sort; if not, strip `sort`/`dir` from those hrefs. | P3 | ux §1.3 |
| UX-4 | List — facet multi-select affordance | Facet dropdown items render as a bare list with no visible checkbox until clicked (then a ✓ + chip appear). Works, but the dropdown doesn't signal "multi-select" up front. Fix: show empty checkboxes / a hover state so multi-select is discoverable before the first click. (Ties to S-1 Checkbox primitive.) | P3 | ux §1.4 |
| UX-5 | Board — cards don't surface blocked / epic | A **blocked** card shows no lock/blocked marker; an **epic** card shows no child-count badge and its subtasks show no "belongs to epic" hint — the two relationships people most want at a glance on a board. Fix: small "blocked" pill/icon + an epic child-count badge (e.g. "◇ 3") on cards. | P2 | ux §2.3 |
| UX-6 | Board — status pills are unlabelled visibility toggles | Clicking a status pill in the board header hides/shows that column (pill dims) with no tooltip/label; a dimmed pill next to a missing column is easy to misread as "no tasks". Fix: tooltip ("Hide/show column") or an explicit eye/checkbox affordance. | P3 | ux §2.4 |
| UX-7 | Task detail — corrupt due_date renders as "—", unknown field invisible | On DEMO-2 (`due_date: 42`, `jira_id: ABC-123`): the **Due** field shows just **"—"** — indistinguishable from an empty due date; clicking opens an empty picker and a save silently drops the bad value. The unknown **`jira_id`** field is **not shown anywhere** on the detail page, though `doctor` says it's preserved by every write. Detail is exactly where a user would fix a bad field and it's the one place that gives no signal. Fix: render a corrupt field with an inline warning (`Due ⚠ corrupt: 42` + tooltip + clear/repair) and surface unrecognised keys in an "Unrecognised fields (preserved)" block. **Part of the signature-feature gap (UX-11).** | P1 | ux §4.1 |
| UX-8 | Task detail — parent/child relationship headers read backwards | On an epic, its children are grouped under a header labelled **"PARENT · 3"**; on a child, its parent epic is under **"CHILD · 1"** — both backwards. `workflow.yaml` provides distinct `label: Parent` / `inverse_label: Child`, so the direction is picked from the wrong side. Contrast: **blocks** reads correctly ("IS BLOCKED BY · 1"), so the display is inconsistent across relationship types. Fix: use the directional label consistently (children under "Child"/"Children", the parent under "Parent"), ideally with a connective ("Parent of…", "Blocked by…"). | P2 | ux §4.2 |
| UX-9 | Task detail — editor toolbar always visible in view mode | The DESCRIPTION block shows the full Bold/Italic/Code/… toolbar persistently even when merely viewing (and a Code-block button rendered active while viewing), reading as "always in edit mode" and adding visual weight. Fix: collapse the toolbar until the field is focused/edited, or clearly separate view vs edit. | P3 | ux §4.3 |
| UX-10 | Task detail — activity grammar / raw keys | Activity shows *"ken added a is_blocked_by link"* — "a" instead of "an", and the raw relationship key instead of the label ("Is blocked by"). Fix: use the label + correct article. | P3 | ux §4.5 |
| UX-11 | **App-wide — degradation is silent in the surfaces users live in (the signature-feature gap)** | Corruption handling is genuinely good **where shown** (Diagnostics §5.2, Timeline badge §3.1) but invisible/misleading where users work: task detail shows corrupt due_date as "—" and drops the unknown field (UX-7); the List shows the corrupt task as an ordinary row with no marker; Settings→Labels **hides** the broken label entirely (UX-13); and there is **no global signal** — no "3 warnings" badge in header/sidebar, no dot on Settings — pointing users to Diagnostics (three clicks deep behind a manual Run). Net: the feature communicates to a *CLI/doctor* audience, not a *UI* user. Fix: a lightweight global data-integrity indicator (header/sidebar badge with the warning count → Diagnostics) **plus** inline corrupt-field markers in detail + list so corruption is met where the data is used. | P1 | ux §6.1 |
| UX-12 | **Header — global search does nothing (dead input)** | Typing into the top "Search tasks…" box and pressing Enter does nothing — no filter, no results, no navigation, **no network request fired**. `/api/search` works, but `Header.tsx:120`'s `<input>` has no `onChange`/`onKeyDown`/`onSubmit` — a dead input. The most prominent, always-visible control reads as broken. (Note: `known-gaps.md:2342` records it as *disabled with a title*; the reviewer observed it **accepting input** — the shipped state is a live-looking but unwired box.) Fix: wire the box to `/api/search` (live or on Enter) with a results panel/navigation. | P1 | ux §6.2 |
| UX-14 | New-task modal — silent no-op on empty title; defaults show "—" | Clicking **Create task** with an empty title does nothing — no task, no inline "Title is required", the field isn't flagged, and Create still *looks* fully enabled. Separately, **Status** and **Type** default to "—" even though `workflow.yaml` marks `backlog` as `default: true` and there's a default task type. Fix: inline validation on empty title (and/or visibly disable Create), and pre-fill Status/Type with the configured defaults. **Review-2 correction: Create is ALREADY disabled on an empty title (`CreateTaskModal.tsx:181,265,665`) and NEW-2 (tagged, passing) pins it. Residual (NEW-42): visible-disabled cue + defaults pre-fill only.** | P2 | ux §6.3 |
| UX-13 | Settings → Labels — broken label silently vanishes | `labels.yaml` has `id: l_broken, name: 999` (name is a number). The Labels page lists only the 4 valid labels — the broken one is **completely omitted**, no row, no "1 label couldn't be read" notice, and both task counts and `doctor` say "4". So a user **cannot see, edit, archive, or delete** it in-app; the one place to manage labels pretends it doesn't exist. Fix: show it as a disabled/error row ("⚠ l_broken — couldn't be read (name must be text)") with a Repair/Delete action. **Part of the signature-feature gap (UX-11); this is `flow-degradation`/`flow-milestones-labels` territory.** | P2 | ux §5.1 |
| UX-15 | Settings → Milestones — copy points at a "Milestones view" the nav never links to | Settings→Milestones says progress lives on "the Milestones view", but there is no Milestones view in the primary nav (only List/Board/Timeline); the sidebar milestone links go to `/list?milestone=…`, a filtered list with **no progress bar**. The referenced "view" isn't discoverable. Fix: either add a real milestone progress display on the filtered-list header, or change the copy to point where progress actually renders. (Ties to K-9 milestones overview.) **Review-2 correction: premise false at HEAD — the sidebar DOES link the Milestones view (`Sidebar.tsx:749-751` `sidebar-milestones-link`; routed `router/index.tsx:183`). Residual (MSL-42) is copy/discoverability only.** | P3 | ux §5.3 |
| UX-16 | Board — responsive degrades awkwardly at tablet width | At ~760px the board shows essentially one column at a time with the next just peeking and no clear h-scroll affordance; the list toolbar's filter buttons stack into a tall vertical column; the list table clips the Title column. Detail stacks sensibly. Fix: visible h-scroll affordance / narrower board columns at tablet width; collapse the list filter row into a single "Filters" menu below a threshold. **Overlaps S-11** (board `w-[280px]`, filter toolbar on mobile) — same lane. | P3 | ux §6.6 |
| ED-1 | Editor — no strike / super / sub / math / mention buttons | These marks/nodes exist in `extensions.ts` and round-trip, but are reachable only by typing raw syntax or pasting — silently second-class in rich mode. Fix (scope call): expose toolbar buttons for them. | P3 | editor §7 |
| ED-2 | Editor — GFM pipe-tables neither parsed nor forced-to-raw | Pipe-tables are in the HTML allowlist but there is no table TipTap node and `fromMarkdown` doesn't parse `\| a \| b \|`, so a markdown table shows as literal paragraph text rather than forcing raw mode. Edge case. Fix: parse it, or add it to the lossy-content detection so it forces raw. | P3 | editor §8 |
| ED-3 | Editor — two editors share `data-testid="rich-editor"` | Both the description and comment surfaces render `[data-testid="rich-editor"]`, making the DOM ambiguous (tests must scope by `[data-testid="body-editor"]`). Test-hygiene, not user-facing. Fix: give the two editors distinct test-ids. | P3 | editor §9 |

**Also recommended by the edit-model audit but not yet a tracker row:**
**Undo on a *successful* board/timeline drop and on bulk Set-field**
(`ui-review-edit-model.md` §4 JUDGEMENT). Task drag stays inline
(per "inline is for tasks") but the audit recommends an Undo affordance
so an accidental drop is reversible. Not built anywhere. **Ken decision:
is this in the release?** (see the open-decisions list below).

## Still-open decisions for Ken (blocking parts of the build)

Ken's five rulings (one release; "inline is for tasks"; task
relationships → inline kebab+confirm; BUG-2 → fix the copy;
`--root` canonical) are recorded and resolve the biggest forks. The
Fable review surfaced nine; the rulings close #1 (BUG-2) and #2 (K-4).
These remain genuinely Ken's and are **not** decidable by the planning
pass — they are carried forward here and in `ui-plan-revision-summary.md`:

1. **Are the newly-ingested UX findings above (UX-1..16, ED-1..3) all in
   this release?** Ken said "ingest them all", which the tracker now
   does. Whether every one is *built* in this release (vs. tracked for
   later) is the release-scope call. Under "everything ships, no
   prioritisation" the default is yes; the batch plan assumes yes and
   assigns each a lane. Confirm.
2. **Undo on successful board/timeline drop + bulk Set-field** — in the
   release or not (edit-model §4). Default assumed: yes.
3. **Reorder of config rows** (statuses/priorities/types) — stays inline
   (keeps SET-6/21/28/34 as pinned) or moves inside the Edit dialog
   (revises them). The "inline is for tasks" ruling's literal text would
   dialog it; the edit-model audit judged keep-inline. **Recommend: keep
   reorder inline** (it is not a value edit and drag-reorder-in-a-modal
   is worse UX) and carve the exception explicitly. Ken to confirm.
4. **Does "Edit button → dialog" mean a modal**, or does an
   already-Edit-gated inline form satisfy it? Labels and Milestones
   panels already have Edit → scoped inline form → Save/Cancel (the
   edit-model audit's target pattern, marked OK). Converting those to
   modals is churn with no violation behind it and reddens
   `dataPanels.test.tsx`. **Recommend: an Edit-gated form satisfies it;
   only ungated inline auto-save must change.** Ken to confirm.
5. **K-10 sidebar-groups editor shape** — this is a **new per-user
   settings data shape** (`sidebar_groups`), load-bearing, owed on
   contracts+core+CLI+MCP+doctor+web, not UI-only. Open: per-user vs
   tracker-wide; may built-in filters and "Recently viewed" be hidden;
   CLI/MCP exposure. **Recommend: per-user (mirrors `sidebar_pins`),
   built-ins hideable, "Recently viewed" counts as a group.** Ken to
   confirm the shape before B4 opens.
6. **Design-system open decisions 1–6** (`ui-design-system-spec.md`
   § Open decisions): Toggle look, `rounded-full` count-badge, a
   `text-micro` name, raise-vs-document the three sub-AA tokens,
   `border-subtle` semantics, `className` escape hatch on `Button`.
   Blocks parts of B1 (Chip/Toggle/type-scale/contrast commit).
7. **Doctor / journal P-11** — may crash-recovery ever *give up* on a
   deterministically-failing replay (surface + typed error only, which
   B0 builds), vs. a discard path? Record in `decisions.md` § 9 either
   way. B0 builds the safe listing regardless.

Not on this list because the rulings settled them: BUG-2 (fix the copy),
K-4 (inline kebab+confirm). The `PROPOSED-UI-CASES.md` revisions below
encode both.

## Status legend

- **tracked** — logged, not started.
- **needs-decision** — a design fork for Ken.
- **in progress / done** — only when actually being/been built (with commit).

## Found during setup

- **CLI-1 (Ken flagged — standardise `--root` vs `--cwd`)**: the same
  "which tracker" concept has **two different names across surfaces**,
  and is **undocumented**:
  - **CLI** — global `--cwd <dir>` (`apps/cli/src/index.ts:48`). The only
    way to target another tracker; `loctt ui` / `loctt mcp` inherit it.
    No CLI command accepts `--root`.
  - **Web server** run directly (`apps/web/src/server/main.ts:28`) —
    `--root` / `LOCTT_ROOT` env (a *different name* for the same thing).
  - **MCP** — inherits `root` from the CLI `--cwd` (no own flag).
  - **Neither `--cwd` nor `--root`/`LOCTT_ROOT` is documented in
    `docs/user/`.** Users guess → `loctt ui --root` fails ("unknown
    option --root").
  **Fix (real, not a footnote):** pick ONE canonical name and alias the
  other for back-compat (recommend: keep `--cwd` as the CLI global since
  it's established, and make the web/`main.ts` accept `--cwd` as an alias
  of `--root`, OR — cleaner long-term — standardise on `--root`
  everywhere + `LOCTT_ROOT`, aliasing `--cwd`). Either way: (a) one
  vocabulary across CLI/web/MCP, (b) `loctt ui`/`loctt mcp` should accept
  the tracker flag directly (not only via the pre-command global), (c)
  document it in the CLI reference. **P2** (a real cross-surface parity +
  discoverability gap, same class as Phase Z's strict-parity findings —
  belongs in `decisions.md` once the canonical name is chosen).
  **KEN'S DECISION (2026-09-06): standardise on `--root` everywhere**
  (+ `LOCTT_ROOT`); keep `--cwd` as a back-compat alias so existing
  usage/scripts don't break. Scope when built: (a) add global `--root` to
  the CLI (`apps/cli/src/index.ts`), aliasing the existing `--cwd`;
  (b) `loctt ui` / `loctt mcp` accept `--root` directly (not only via the
  pre-command global); (c) web `main.ts` already uses `--root`/`LOCTT_ROOT`
  — keep, add `--cwd` alias there too for symmetry; (d) document `--root`
  + `LOCTT_ROOT` in the CLI reference; (e) record as a `decisions.md`
  entry (Ken's ruling). Update the earlier "use `--cwd`" note in this doc
  once shipped.
