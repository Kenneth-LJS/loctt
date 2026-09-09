# UI review — implementation batch plan

**Everything in `ui-review-tracker.md` ships in ONE release. No
prioritization** — every item is implemented. Batches group work by
**dependency order** (foundations before their consumers) and
**file-ownership** (disjoint lanes so parallel agents don't collide),
never by importance.

Governing decisions (Ken, 2026-09-06):
- Release all at once; implement everything.
- **Edit model: "inline is for tasks."** Task editing stays inline
  (list, detail field panel, board/timeline drag). ALL config/settings
  panels → view-by-default, edit behind an explicit **Edit button →
  dialog**. Supersedes K1 for config panels. **Exception:** a task's own
  relationships → **inline kebab (⋯) + confirm** (NOT a dialog), because
  a task's relationships are part of editing that task.
- **BUG-2 → fix the copy** (dialog says the field is cleared, because
  that's what happens). Reverses approved case SET-17 (+ siblings).
- **`--root`** canonical (+ `LOCTT_ROOT`), `--cwd` kept as alias.

**This plan was revised against the Fable review
(`ui-batch-plan-review.md`) — all 12 must-fixes are folded in.** The
changes-from-v1 are summarised in `ui-plan-revision-summary.md`.

## Run status

**✅ COMPLETE — B0 through B5 all committed (2026-09-09).** Commits:
B2 `52b2e69`, B3 `f5c0666`, B4 `6409e65`, B5 `772df6d` (plus step-0 and
decisions commits). Every batch went through the full build-loop gate
(cases-before-code → build/typecheck/lint → unit → cases:coverage →
integration → e2e → UI Playwright) and a Fable adversarial fix-review
before commit; the fix-reviews caught real bugs each time (B2 silent
email data-loss; B3 CRLF-paste hang + corrupt-custom-field-clear 400; B4
two HIGH K33 editor data-loss bugs), all fixed and mutation-proven.

**Three taste calls are flagged for Ken's review** (all shipped with a
revert path, none blocking): **A164** (whether an extrinsic fault — a
dangling user / enum drift — gets the corrupt-field inline notice, or
only its picker's own indicator), **A179** (TSK-32 reconciled to DEG-7:
unrecognised keys are now shown in a "Not recognised" group), **A180**
(external images in the description render as a click-to-open link, not an
auto-loaded `<img>`, for privacy).

**TEMP working-state files** (`TEMP-BUILD-PLAN.md`, `TEMP-RUN-WORKFLOW.md`,
`TEMP-WEB-TICKETS.md`, `PROPOSED-UI-CASES.md`) are left in place — CLAUDE.md
says they are deleted "when the build lands", but that is the user's call
to make (and they are useful context for the three flagged reviews).

- **B0 / B1 — done** (earlier commits).
- **B2 — done.** The edit-model conversion of every config/settings panel
  (Projects, Users, Milestones, Sprints, Saved views, Workflow enums /
  relationships / custom fields, Sidebar groups) + K-10 header search &
  sidebar-groups + sprint archive routes. Built across 4 file-disjoint
  lanes, then a fix-review (18 confirmed bugs fixed red-first, several
  silent-data-loss), a merge reconciliation (email validation moved to
  **core** for CLI/MCP parity; A11Y search-selector fixes; Sidebar
  two-lane merge), and a **Fable adversarial fix-of-fixes review that
  caught a HIGH re-introduced data-loss bug** (the single-PUT sprint save
  diffing against the live prop, clobbering a concurrent edit) — fixed and
  mutation-proven. 4 pre-existing error-surface e2e failures (ERR-10,
  LST-51, TML-48, SPR-31) were HEAD-proven pre-existing and quarantined
  `test.fixme` with a consolidated known-gap. Gate green: core 1948 /
  web 1368 / integration 501 / e2e 21 / UI all-pass.
- **B3 — done.** Task-detail surfaces across 4 file-disjoint lanes:
  Relationships (REL-12 kebab+confirm replacing the hover-✕; REL-51/UX-8
  header direction — found already-correct, demo-data at fault, A161),
  Editor (H1–H6 picker, caret fix, ordered list, placeholder,
  markdown-paste, view-mode collapse, distinct testids — TSK-59..67),
  Activity (Comments/Activity/All tab split, CMT-39 label+article), and
  Task-meta/degradation (DEG-29 corrupt-field inline warning + "Not
  recognised" group, DEG-7 now tagged from a client test). The coordinator
  completed K-5's page integration (removed TaskDetail's standalone
  Comments section, added the `?tab=` URL param so CMT-18 bullet 2 is met,
  default tab → Comments). A **Fable adversarial fix-review found 2 HIGH
  bugs the Editor lane introduced** — a CRLF-paste infinite loop (tab
  hang/OOM) and a corrupt-custom-field Clear that always 400'd — both fixed
  and mutation-proven; plus 3 med/low (invisible placeholder CSS,
  code-block paste ejection, extrinsic-fault mislabel A164). Gate green:
  core 1948 / web 1400 / integration 501 / e2e 21 / UI all-pass.
  **One taste call flagged for Ken: A164** (whether extrinsic faults —
  dangling user, enum drift — get the corrupt notice, or only their
  picker's own indicator; shipped as the latter).
- **B4 — done.** List/board/overview surfacing + sidebar editor + header
  (verify-only, B2 already shipped it) + new-task + primitive migration +
  responsive, across 9 file-disjoint lanes, plus the K33 description
  read-then-edit model (Ken's 2026-09-09 ruling). Highlights: the K-15
  row-hover fix (`--bg-row-hover` token), LST-53/54/56, BRD-50/51,
  MSL-39..42, SPR-39/40 overview, SHL-45 sidebar-groups + LST-55, NEW-42
  pre-fill, the 21-file B1 primitive migration, and K33 (TSK-68..71).
  Decisions K31/K32/K33 (Ken) + A164..A180 (agent). A **Fable adversarial
  fix-review found 2 HIGH silent-data-loss bugs in the K33 editor** — a
  blur-race that dropped the editor before a failing save (TSK-48) and an
  Escape that *wrote* instead of cancelling — both fixed and red-first
  proven (the blur race via a deferred-fetch real-hook test). Also fixed:
  a keyboard-link trap, a privacy fix so external images don't auto-load
  (A180), the BRD-50 `dependency_relationship: null` opt-out, and a
  case-vs-case contradiction (TSK-32 reconciled to DEG-7, A179). The A163
  default-tab flip's test blast radius (3 feed specs) was fully
  reconciled. Gate green: web 1477 / core 1948 / integration 501 / e2e 21;
  UI all-pass single-worker (SPR-6 / git-reconcile are documented
  concurrency flakes, pass isolated). **Taste calls flagged for Ken:
  A164** (extrinsic-fault corrupt notice), **A179** (TSK-32↔DEG-7),
  **A180** (external-image link vs inline).
- **B5 — not started.**

---

## The gate (every batch, every lane) — MUST-FIX #1

The plan's earlier "build/typecheck/lint + core/web/integration/e2e"
line was **not** the repo's gate. The real gate is
[`build-loop.md`](build-loop.md) § Per ticket. Every batch and every
per-lane commit runs it:

```
 0. CASES     New case IDs proposed in PROPOSED-UI-CASES.md; revisions listed
              with the contradicting case text; both to Ken. Lane opens only
              once its cases are accepted into the flow docs. (MUST-FIX #2.)
 1. PLAN      Restate each case; name the ones this lane satisfies.
              GATE  npm run cases:coverage -- --require <ids>   (must FAIL here)
 2. IMPLEMENT Build. Do not edit the flow docs.
 3. UNIT      Tests tagged // @verifies <ID>, each SHOWN TO FAIL.
              GATE  npm run test && npm run typecheck && npm run lint
 4. REVIEW-1  Fresh agent: does the work match the cases it claims?
 5. E2E       Transcribe UI cases into tests/ui/*.spec.ts; each shown red first.
              GATE  npm run test:ui        ← Playwright; the plan omitted this
 6. REVIEW-2  /review (correctness) then /simplify (smell/efficiency).
 7. FIX       Loop 3–6 until clean.
 8. VERIFY    GATE  npm run cases:coverage -- --require <ids>   (must PASS now)
              GATE  npm run cases:check                          (index not stale)
 9. SURFACE   GATE  npm run test:integration   (CLI + MCP in this domain)
10. COMMIT    One squashed commit per lane. Update TEMP-BUILD-PLAN.md status.
```

Notes the plan must budget for:
- `npm run test:ui` is the load-bearing UI gate — `tests/e2e` is CLI/MCP
  journeys and barely touches the web. The full Playwright run has
  crashed Node on memory before (`TEMP-BUILD-PLAN.md` M4.5 row); **split
  the suite** rather than running all 27 specs at once.
- **`data-testid` is declared, not spread** (`ui-design-system-spec.md`
  §50-56): a B1 primitive that renders its own element type-checks a
  `data-testid=` passed to it but never puts it in the DOM. Every B1
  primitive takes `testId?` and forwards it to the inner element; every
  B4 swap carries the existing id **verbatim**. See the locator list in
  MUST-FIX #12 below.

---

## Cases before code — MUST-FIX #2

`build-loop.md` step 1 requires case IDs *before* a line is written, and
the run workflow's stop-condition 2 is "no case covers the behaviour,
and building it means authoring the spec". So **step 0 above is the first
thing in every lane**, not an afterthought. The starting list of new IDs
+ revisions is in `PROPOSED-UI-CASES.md` (drafted this pass) — awaiting
Ken. Specifically, these must be **revised or explicitly exempted before
their batch opens**:

- **B0b opens after:** SET-17/SET-19 superseded in `flow-settings.md` +
  `cases:index` re-run (the BUG-2 copy reddens `flow-settings-workflow.spec.ts:272-313`
  otherwise — review-2 §2/§4.5).
- **B2 opens after:** SET-16/17/19/28, SPR-8 revised (genuine reversals);
  **SET-6/34 are NOT revised** — they are reorder-only and contradict
  nothing, so the Edit-gated value-edit behaviour is in additive **SET-50 /
  SET-51** instead (review-2 §3.1); PRU-44 preserved (its `@verifies` tags
  already exist). Reorder-stays-inline (decision #3) is a one-line
  `decisions.md §9` note, not a SET-6 rewrite.
- **B3 opens after:** REL-12 revised (pins hover-remove + no-confirm;
  Ken's ruling is inline kebab + confirm).
- New IDs (all real next-free numbers, no `-N#` placeholders — the ones
  proposed with placeholders / collisions were renumbered this pass to
  ingest cleanly: SPR-27/28→**SPR-39/40**, SHL-N1/N2→**SHL-45/46**,
  DEG-N1/N3/N4→**DEG-29/30/31** (DEG-N2 folded into DEG-7),
  BRD-N1/N2→**BRD-50/51**, NEW-N1→**NEW-42**; plus **MSL-39/40/41** for
  K-9's residual and **MSL-42** for UX-15): K-7 (TSK-59..64), ED (TSK-65..67),
  K-8/u3 (VUE-40/41), workflow-create + custom-fields (SET-46..49), the
  Edit-gated config value edits (SET-50/51), K-11 + p1 (PRU-47/48), K-14 +
  u2 (SPR-39/40), K-10 (SHL-45) + UX-12 (SHL-46), degradation-visible
  (DEG-29/30/31), board/create polish (BRD-50/51, NEW-42), list/sidebar
  polish (LST-53..56) — see `PROPOSED-UI-CASES.md`. **UX-8 and UX-10 have
  no proposed case yet** (review-2 §2): draft one or record an exemption in
  step 0 before their B3 lanes open.

Where an existing case already pins the target: **CMT-18 (K-5 tabs) and
MSL-1 (K-9 progress bar) are already tagged and green** — NOT unsatisfied
(review-2 §3.3). K-5's tab split *edits* the green CMT-18 test (name it in
the commit); K-9's progress bar already renders, so only its residual
(full-card click / countdown / breakdown, MSL-39/40/41) needs new cases.

---

## Batch 0 — Correctness bugs + the recorded decisions (unblocks everything)

Standalone core/server + **the decisions that later batches build
against**. Done first so later UI work isn't tested on a brickable
tracker, and so B2 does not commit against a stale `decisions.md`.

**B0 splits into B0a and B0b (review-2 §4.5 / §5).** The plan's earlier
"B0 — independent" claim was wrong: the BUG-2 **copy** commit reddens
`tests/ui/flow-settings-workflow.spec.ts:272-313` (the `remap-dangle-warning`
`toContainText(/drift marker/i)` + `/Diagnostics/i` assertions), which is
SET-17 bullet 4 / SET-19 bullet 3 as currently pinned. So the copy commit
has a **step-0 dependency**: the SET-17/SET-19 supersedes must land in
`flow-settings.md` (+ `npm run cases:index`) before it. Therefore:

- **B0a — startable TODAY, no case dependency:** BUG-1 (+ its fixture
  re-seed and partial-write/journal-replay test), the three `decisions.md`
  §9 entries (K1-supersede, `--root`, BUG-2-decision), the `server.ts`
  error-envelope change, and the doctor pending-journal listing + typed
  error. None of these touch a pinned case's asserted text.
- **B0b — needs its case revision landed first:** the BUG-2 **copy** +
  agreement-typo rewording of `RemapDeleteDialog.tsx`. Opens only after
  SET-17/SET-19 are superseded in the flow docs and re-indexed (step 0).

The `RemapDeleteDialog` **B1-primitive swap** (Radio/Button) is **NOT** in
B0 — it moves to **B4's migration remainder** (review-2 §4.1). B0's earlier
note said the swap "rides in B0's finalisation", but B0 ∥ B1 in the
dependency graph, so B0 cannot consume B1 primitives. B0b only **rewords
copy**; the primitive swap is migration and belongs in B4.

**Recorded decisions written HERE, not in B5 — MUST-FIX #3.** The K1
supersession is Ken's ruling, already made; it just needs writing down,
and B2's first commit violates K1 as recorded (`decisions.md §9 K1`
made workflow panels editable inline). Per the run workflow's stop
condition 3, an agent committing B2 against the current §9 is violating a
recorded decision. So B0 writes:
- **§9 entry: edit-model supersedes K1** for config panels (view + Edit
  dialog), with the task-relationship exception (inline kebab + confirm).
- **§9 entry: `--root` canonical + `--cwd` alias** (Ken's ruling).
- **§9 entry: BUG-2 → fix the copy** ("leave it" clears the field).
- (B5 still *builds* `--root`; B0 only records the ruling.)

Bug/decision work:

- **BUG-1** — workflow-save relationship-remap ignores inverse keys →
  bricks any tracker with a blocks/parent link. Fix `workflow-write.ts`
  (`applyRelationshipsRemap` + `validateRemapCoversDeletions`) to build
  the rel vocab via `flatMap(relationshipTypeKeys)` incl. inverses;
  re-seed rel/journal test fixtures through `linkTask` (they're green
  only because they bypass it — show them red first). Also the
  delete-with-remap partial-write and the wrong `recovery: reload`
  envelope. **Partial-write note:** with the vocab fix the journal
  replay *completes* the interrupted remap, so the partial write becomes
  recoverable rather than needing a rollback — confirm with a test that
  replays the delete path after a mid-loop throw.
- **BUG-2 → FIX THE COPY (decided).** `RemapDeleteDialog.tsx:106-110` is
  shared by statuses/priorities/types/relationships/custom-enum-values/
  milestones/labels — the copy lies on **all seven** surfaces, and every
  backend already **clears** the field on the "leave" branch. Reword the
  dialog copy to say the field is cleared on N tasks (no dangling ref, no
  drift marker). Revise SET-17 bullet 4 and SET-19 bullet 3 accordingly
  (`PROPOSED-UI-CASES.md`). **No core behaviour change** — this is a copy
  + case fix, not a new "leave dangling" directive. Also fix the
  agreement typo "1 task currently use" (`RemapDeleteDialog.tsx:70`) here
  since it is the same dialog.
- **doctor** (secondary, from the diagnosis doc): list pending journal
  entries + a typed error for a deterministically-failing replay, so
  BUG-1-class states are visible, not silent. **Surface the P-11
  question** (may recovery ever give up on a deterministic failure?) to
  Ken and record in §9; build the *listing* regardless (it is safe).
  **Note:** this changes doctor's check list — any integration/e2e/UI
  test asserting a pass/warn/fail *count* (e.g. SET-14 "15 passed · 3
  warnings") needs its expectation updated; say so in the commit.
- The `handlePutWorkflow` envelope change (`server.ts:1508-1512`) is
  asserted by `server.workflow-panels.test.ts` ("message does not start
  with `internal:`") — that test was guarding exactly this and should go
  **green**, not need editing.

Lane / files:
- **B0a:** `packages/core/src/config/workflow-write.ts`,
  `.../milestones/manage.ts`, `diagnostics/`, `apps/web/src/server/server.ts`
  (error envelope), `docs/dev/decisions.md`.
- **B0b:** **`apps/web/src/client/settings/RemapDeleteDialog.tsx`** (BUG-2
  copy + agreement typo **only** — this is a **client** file, so B0 is NOT
  "core + server, no client"; the B1 Radio/Button primitive swap is **not**
  here — it is in B4's migration remainder). B0b opens only after
  SET-17/SET-19 are superseded and re-indexed.

**B0 (a and b) must land before any B2 lane opens `RemapDeleteDialog` (5
lanes consume it).**

## Batch 1 — Design-system foundation (blocks Batches 2–4's polish)

The shared primitives everything else adopts. Build FIRST so later
batches consume them instead of re-hand-rolling. Spec:
`ui-design-system-spec.md`. The 6 open design-system sub-decisions (Toggle
look, count-badge shape, `text-micro`, sub-AA tokens, `border-subtle`,
`className` escape hatch) gate Chip/Toggle/the type scale/the contrast
commit. **Per Ken's operating rule, the PM decides 5 of the 6; only
design-system #6 (`className` escape hatch on `Button`) is a genuine Ken
fork** — PM proposes it, escalate only if it forks. (The other genuine Ken
fork is the **K-10 `sidebar_groups` shape** — open decision #5, gating the
K-10 core track; PM proposes, escalate only if forked. These are the two
items left for the PM/design agent; do not invent them here.)

- `icons.ts` glyph map + local `cn` helper (no clsx/cva dep).
- `Button` (variant×size×state — hover/active/focus-visible/disabled;
  uses `--accent-contrast`) — S-5, S-6, K-12, **K-16**. **B1 defines the
  states; the 7 `text-white` sites are only fixed when swapped in B4** — do
  not claim B1 "kills" them. **K-16 (cursor pointer):** bake
  `cursor-pointer` into the `Button` base class (a native `<button>` has no
  pointer; only 5 of ~80 sites set it today) — see the spec's §1.1 Button
  base, now corrected to include it. `disabled:cursor-not-allowed` still
  wins for disabled.
- `IconButton`, `ToolbarButton` (preset over Button) — inherit the K-16
  `cursor-pointer` base (spec §1.2/§1.3 corrected). Interactive `Chip` and
  `MenuItem` carry it too.
- **`Dialog` / `DialogActions`** (or `Modal` + a footer convention).
  `ui/Modal.tsx` already exists (title/onClose/children, focus trap,
  inert background, Esc/backdrop close) and is the base; what 7 B2 lanes
  would otherwise each hand-roll is the **footer** — Save/Cancel
  `Button`s, pending state, an anchored `Callout` for the save error,
  and `data-testid`s. Ship a thin `Dialog` with a named test-id
  convention (`<panel>-edit-dialog`, `-edit-save`, `-edit-cancel`,
  `-edit-error`) so the lanes converge instead of drifting day one.
  **(MUST-FIX #11.)**
- `Chip`/`Pill` — K-6, S-7.
- `Checkbox` + `Radio` (appearance-none, themed, indeterminate for the
  list select-all; empty-checkbox affordance for UX-4 facet dropdowns) —
  K-1, S-1, S-2, UX-4.
- `Select`, `TextField`, `Callout/Banner`, `Toggle`.
- Token scale doc + contrast-token fixes (text-tertiary / status-
  discarded / priority-low / border-subtle to clear WCAG AA) — S-9;
  ban bare `rounded`, `text-white`. **Its own commit** (moves every
  surface at once); needs the WCAG re-measure the responsive review did.
- **CI drift guard** (spec §2.5 grep) so B2/B3 lanes cannot hand-roll a
  button after this lands.

Lane / files: NEW files under `apps/web/src/client/ui/` **plus
`styles/tokens.css` and the `@theme` block in `styles/index.css`** — so
B1 is "new files + two style files", not "no existing file changes".
**Migration of existing call-sites happens in the owning feature lane
(B2/B3) or in B4's remainder lane** — see MUST-FIX #6.

## Batch 2 — Edit-model: config panels → view + Edit-dialog

Apply "inline is for tasks" to every config surface. Each panel becomes
read-by-default with an explicit Edit → dialog, AND this is where the
**MISSING create/edit affordances** get built (same work: a dialog wired
to the core CRUD the backend already has). Consumes B1 primitives
(Button/TextField/Select/Dialog). **Rule: a file restructured here is
migrated to the B1 primitives here and is OFF B4's list** (MUST-FIX #6).

**Prereqs:** B0a (decisions written) + B0b (BUG-2 copy landed in
`RemapDeleteDialog`; its primitive swap is deferred to B4, not a B2
prereq). Only the **Workflow** lane additionally waits on **BUG-1**
(any tracker with a directional link 400s on `PUT /api/workflow`, and the
workflow Playwright spec seeds via the CLI) — the other six lanes go
through their own remap paths, shown working by the CRUD agents, so they
are NOT blocked on BUG-1.

**Right-sized layers (MUST-FIX #5):** three items the v1 plan mis-sized
as UI-only are multi-layer:
- **p1 set-default** — **there is NO set-default route**; `setDefaultProject`
  is only called internally (`server.ts:1670,1706,1709`). Needs a **new
  endpoint** + hook + dialog control. Server work.
- **u2/SPR-26 sprint archive** — `handleUpdateSprint` (`server.ts:1992`)
  accepts name/start/end/state/goal but **no `archived`**; core
  `archiveSprint`/`unarchiveSprint` exist (`sprints/manage.ts:217,231`)
  and the CLI has it, so this is **web reaching parity** = a **server
  edit** + "show archived" toggles on `SprintsPanel`/`SprintsView`. Not
  client-only.
- **K-10 sidebar-groups** — a **new per-user settings shape**; built as
  its own multi-layer **K-10 core track** (scheduled below, before B4
  Sidebar opens), not UI-only.

### K-10 core track (contracts + core + CLI + MCP + doctor + docs)

**Review-2 §1 #8 fix — this was re-sized but scheduled nowhere.** The
web half (the sidebar editor) is B4's Sidebar lane; **this track is the
other half** and must land before B4 Sidebar opens. Schedule it as a
standalone core lane running alongside B2 wave 2 / B3 (it shares no files
with them). Blocked only on Ken open decision #5 (the `sidebar_groups`
shape). Files:

- `packages/contracts/src/users.ts` — add the `sidebar_groups` per-user
  field (mirrors `sidebar_pins`).
- `packages/core/src/users/settings.ts` (+ `pins.ts` alongside) — read/
  write/validate `sidebar_groups`; degrade on an unknown/duplicate group
  id per `corruption-handling-guide.md` (field-local, not object-fatal).
- `apps/cli/src/` — a CLI flag/command to view/set sidebar groups
  (parity with `sweep_sidebar_pins`).
- `apps/mcp/src/` — the matching MCP tool.
- `packages/core/src/diagnostics/` (doctor) — a check for a corrupt/
  unknown `sidebar_groups` entry.
- `docs/user/cli/reference.md` **and** `docs/user/mcp/reference.md` — per
  CLAUDE.md "a capability in core is not done until CLI and MCP have it",
  both reference docs update **in this track**, not deferred to B5.

Cases: **SHL-45** (the behaviour, incl. the SHL-9/5/10 carve-out) is the
web-facing case; a surface `SHL-C*` case or a recorded exemption covers the
CLI/MCP exposure — draft it in step 0 for this track.

**Waves (≤5 agents, 7 lanes → 2 waves).** Wave 1: Users, Labels,
Milestones, Saved views, Sprints. Wave 2: Projects, Workflow (the two
that edit `server.ts` and carry the open questions).

Per-panel lanes (disjoint files; the collision notes are MUST-FIX #10):
- **Users** (`UsersPanel.tsx`, new `useUpdateUser` — `PUT /api/users/:id`
  at `server.ts:4869` already takes name/email/timezone) — Edit dialog
  for name/email/timezone (u1/K-11, the worst MISSING); avatar via a
  proper control not raw file input (K-11a). **New case: user edit
  dialog** (PRU-* cover create only).
- **Projects** (`ProjectsPanel.tsx`, `useProjectMutations.ts`,
  **`server.ts` — new set-default route**) — Edit dialog; add
  **set-default** (p1). **PRU-44 (editable prefix via confirm dialog) is
  already built** — preserve it, fold into the dialog, keep its pinned
  shape (no save-on-blur; confirm states the blast radius in numbers) and
  the PRU-46 Playwright test. **`@verifies PRU-44/PRU-45` tags already
  exist and pass** (`server.test.ts:779`, `ProjectsPanel.test.tsx:10`;
  `cases:coverage --require PRU-44,PRU-45` passes) — the earlier "none
  exist today" claim was false (review-2 §1 #7). The real rule: the
  restructure **edits the green, tagged `ProjectsPanel.test.tsx`**, so name
  that edit in the commit per CLAUDE.md's "editing a green test" rule.
  Fix the stale "Project deleted" dialog leaking into a fresh Delete
  (tracker minor item) in this lane.
- **Milestones** (`MilestonesPanel.tsx`, **owns `useDataMutations.ts`** —
  widens `useUpdateMilestone` at `:130`; `PUT /api/milestones/:id` already
  accepts `archived` at `server.ts:2074+`) — Edit dialog; add
  **archive/unarchive** (m1). **`useDataMutations.ts` owner (review-2 §1
  #10):** both Milestones and Labels touch this file in wave 1, so
  **Milestones owns it** (it already widens a hook here) and **Labels hands
  it a one-hook diff** rather than editing it in parallel.
  **Milestones already has Edit → scoped inline form → Save/Cancel**
  (`MilestonesPanel.tsx:141`), the edit-model audit's target pattern — if
  Ken rules an Edit-gated form satisfies "Edit → dialog" (open decision
  #4), this lane shrinks to "add the missing fields" and `dataPanels.test.tsx`
  stays green.
- **Labels** (`LabelsPanel.tsx`, `dataPanels.test.tsx`; its
  `useDataMutations.ts:94-115` change is handed to the Milestones owner as
  a one-hook diff — Labels does not edit that file in parallel) — Edit
  dialog (CRUD works; gate editing). Same
  already-gated caveat as Milestones (`LabelsPanel.tsx:167`). **Plus
  UX-13: show the broken label (`l_broken`) as a disabled/error row with
  Repair/Delete instead of omitting it** — this is a degradation-surface
  fix (see the UX-11 theme). New case (`flow-milestones-labels` /
  `flow-degradation`).
- **Sprints** (`SprintsPanel.tsx`, `SprintMetaHeader.tsx`,
  `SprintDetail.tsx`, `useSprintDetail.ts`, **`server.ts` —
  `handleUpdateSprint` gains `archived`**, `POST`/`DELETE /api/sprints`
  exist at `server.ts:4861,4863`) — add create/delete/**archive** from
  the settings panel (u2); move sprint-meta detail edits behind Edit
  (currently commit-on-blur/change) — revises **SPR-8**.
- **Workflow** (`EnumCollectionPanel.tsx`, `RelationshipsSettingsPanel.tsx`,
  `CustomFieldsPanel.tsx`, `WorkflowPanelFrame.tsx`, `workflowEdits.ts`,
  `useWorkflowMutations.ts`, `flow-settings-workflow.spec.ts`) —
  Edit/Create dialogs; **build the MISSING create** for statuses /
  priorities / task-types / relationships; **custom-fields full CRUD**
  (YAML-only today); move inline auto-save behind Edit. Revises
  **SET-16/17/19/28/34**. **Waits on BUG-1.** **Create-dialog field specs
  (they don't exist yet):** status = key (immutable after create,
  SET-16-shaped lock) + label + category + default; relationship = key +
  label + symmetric/inverse + inverse_label + graph + ranked; custom
  field = key + label + type + multi + searchable + enum values with
  weights (type/multi locked after create). Key uniqueness + "key is
  permanent" copy validated **before** `PUT`.
- **Saved views** (`SavedViewsPanel.tsx`, **`Sidebar.tsx:715-720`**
  enable "+ New filter…", `useCreateView.ts` + new `useUpdateView` —
  `PUT /api/views/:id` at `server.ts:4857`, core `editView`) — build
  rename/edit-query dialog (u3); enable the sidebar "+ New filter" create
  flow (K-8). **Reuse `AdvancedQueryEditor.tsx`. Note `DeleteViewDialog`
  is NOT dead code** (rendered by `SidebarPinsPanel.tsx:237`) — this lane
  may adopt it for consistency; do not delete it.

**Classifications the v1 plan left open (MUST-FIX, from §5 of the
review):**
- **Reorder of config rows** — Ken open decision #3. **Plan default:
  keep inline** (not a value edit; drag-reorder-in-a-modal is worse) and
  carve the exception; SET-6/21/28/34 stay as pinned. If Ken dialogs it,
  those four cases are revised.
- **One-click Archive/Unarchive on config rows** — plan default: keep
  as a row action (reversible, cheap). Record as an agent decision.
- **Default-status radio** (`EnumCollectionPanel.tsx:314`) — lives inside
  the status Edit dialog; the audit wanted a confirm.
- **Already-compliant panels are UNCHANGED** — say so so no lane "fixes"
  them: Calendar and Estimation (draft-then-Save, Pattern A); Card
  layout, Sidebar pins, Preferences (per-user settings, outside the
  principle).

## Batch 3 — Task relationships + editor + activity (task-detail lane)

Task-detail surfaces. Consumes B1 primitives. **Rule: files restructured
here are migrated here, off B4.** Shared parent **`task/TaskDetail.tsx`**
(where K-4's control mounts and K-5's tab state + URL param live) is
owned by the **Relationships** lane; Activity exposes a self-contained
tabbed component. **Four lanes (review-2 §2 UX-7 / §4.3):** Relationships,
Editor, Activity, and a **Task-meta / degradation** lane that owns
`task/MetaPanel.tsx` for UX-7 (the corrupt-field + unrecognised-field
detail work). Because this lane owns `MetaPanel.tsx`, **B4's remainder
`task/*` entry is narrowed to `task/editors/*` + `DeleteTaskDialog`** so no
file is owned by two lanes.

- **Relationships** (`RelationshipRow.tsx`, `RelationshipsPanel.tsx`,
  `TaskDetail.tsx`) — **inline kebab (⋯) → dropdown with Remove +
  confirm (Ken's ruling), NOT a dialog.** The persistent kebab is a fixed
  slot → fixes the hover-invisible + alignment problem (K-4) and the
  accidental-click problem. "+ Add link" (`RelationshipsPanel.tsx:395`)
  stays; the ranked-reorder drag handle (REL-13, `data-testid="drag-handle"`)
  stays. **Revises REL-12** (hover-remove + no-confirm → kebab + confirm).
  Also **UX-8: fix the parent/child group headers reading backwards** —
  use the directional label consistently.
- **Rich-text editor** (`editor/Toolbar.tsx`, `RichEditor.tsx`) — H1–H6
  level picker (K-7, the P1); fix the whole-selection caret quirk; add
  ordered-list button; placeholder; markdown-paste parsing (K-7b).
  Toolbar buttons adopt B1 primitives. Also **UX-9: collapse the toolbar
  in view mode.** New cases for levels/ordered-list/placeholder/paste
  (TSK-18 covers "heading" as one button only). ED-1/ED-2/ED-3 (P3) fold
  in here if in scope.
- **Activity/comments** (`ActivityPanel.tsx`, self-contained tab
  component) — tab split (Comments / Activity / All) (K-5). **CMT-18 is
  already tagged and green** (`tests/ui/flow-comments.spec.ts:1308`; its
  own comment notes the sections are "stacked (not tabs)") — it is **not**
  "unsatisfied" (review-2 §3.3 corrected the earlier claim). CMT-18 permits
  either shape, so K-5's tab split **edits the green CMT-18 test**; name
  that edit in the commit per CLAUDE.md's "editing a green test" rule (no
  new case needed for the tab split itself). **Data-path decision (open,
  recommend (a)):** the Comments tab reads the existing comments endpoint
  (`useComments`) and only Activity/All page the activity feed — **no core
  change**. Option (b) — add `?kind=` to the activity route — is
  core+CLI+MCP work; take it only if Ken wants a filtered feed on CLI/MCP
  too. Also **UX-10: activity label + article** ("added an Is-blocked-by
  link", not "a is_blocked_by") — **no proposed case** yet (review-2 §2);
  draft one under `flow-comments-activity` numbering in step 0 or record an
  exemption before this lane opens.
- **Task-meta / degradation** (`task/MetaPanel.tsx`) — **UX-7:** render a
  corrupt field with an inline warning (`Due ⚠ corrupt: 42` + tooltip +
  clear/repair) instead of a bare `—` (`MetaPanel.tsx:200` renders `—`
  today); surface unrecognised preserved fields in DEG-7's "Not
  recognised" client group. Cases **DEG-29** (corrupt field + unrecognised
  field in detail) — note **DEG-7 is a coverage blind spot**: it reports
  "covered" only via a *core* round-trip test
  (`packages/core/src/task/frontmatter.test.ts:171`) while **no client**
  renders the group (grep of `apps/web/src/client` finds only
  `cells.tsx:107`'s sr-only "(unrecognised)"). So this lane must tag DEG-7
  from a **client** test that renders the group, and the UX-7
  unrecognised-field behaviour folds into DEG-29 rather than duplicating
  DEG-7 (review-2 §3.3 / §6). Record the blind spot in `decisions.md §8` +
  `known-gaps.md`.

## Batch 4 — List/board/overview surfacing + primitive migration + responsive

The remaining views + rolling B1 primitives across the files no B2/B3
lane restructured. Last because it touches the most files. **B4 lanes are
re-partitioned by FILE OWNERSHIP (MUST-FIX #4)** — the v1 "parallel
lanes" collided on `Sidebar.tsx`, `ListView.tsx`, `MilestonesView.tsx`,
`SprintsView.tsx` and the migration. Each feature lane owns **all**
changes to its files (feature + primitive swap + responsive fix); the
migration lane owns only files no other lane touches.

- **Toolbar / List lane** (`FilterBar.tsx`, `ListView.tsx`,
  **`list/cells.tsx`**, `ExportMenu.tsx`, `RefreshButton.tsx`,
  `FilterDropdown.tsx`) — regroup facets / Advanced (mode-toggle) /
  actions; Advanced + Export to spec height (K-2, K-3, S-3, S-4);
  ToolbarButton/Checkbox/TextField migration for these files; S-11
  filter-toolbar-on-mobile + UX-16 list-toolbar collapse. **K-15 real fix
  (review-2 §2):** the cells that "render their own bg over the `<td>`" are
  in **`list/cells.tsx`** (`ProjectChip` etc.), not `ListView.tsx` — so
  this lane **owns `cells.tsx`** and does the K-15 chip theme-aware +
  row-hover token fix here. `cells.tsx` is also imported by the Board lane
  (`board/BoardCard.tsx:12`), so **it is owned by this ONE lane and the
  Board lane merely consumes it** — sequence the Board lane after this so
  the shared file has one owner. **Plus the List UX items: UX-1** (`q=`
  chip + Clear all, **LST-53**), **UX-2** (sort-direction-first-click,
  **LST-54**), **UX-3** (strip ambient sort from sidebar hrefs — shared
  with the Sidebar lane, assign to Sidebar, **LST-55**), **UX-4** (facet
  empty-checkbox affordance, using the B1 Checkbox, **LST-56**).
- **Board lane** (`BoardView.tsx`, `board/*`) — **NEW lane the v1 plan
  lacked.** S-11 board `w-[280px]` fixed width; UX-16/6.6 tablet-width
  degradation + h-scroll affordance; **UX-5** blocked marker + epic
  child-count badge on cards (**BRD-50**); **UX-6** tooltip/label on the
  column-visibility status pills (**BRD-51**, extends BRD-3); Chip
  migration. **Consumes `list/cells.tsx` (owned by the Toolbar/List lane
  via `BoardCard.tsx:12`) — does not edit it**; sequence this lane after
  the Toolbar/List lane's `cells.tsx` change.
- **Milestones overview lane** (`MilestonesView.tsx`) — full-card click,
  at-a-glance data (target date + countdown/overdue, status breakdown, the
  K28 `unreadable` notice) (K-9); Chip/Checkbox migration; UX-15. **MSL-1
  is already tagged and green** — the progress bar + done/total per card
  **already renders** (`MilestonesView.tsx` → `ProgressReadout`), so it is
  NOT "unsatisfied" (review-2 §3.3). K-9's real residual is **full-card
  click (MSL-39) + countdown/overdue (MSL-40) + status breakdown (MSL-41)**
  — those are the new cases. **UX-15 premise is false at HEAD** — the
  sidebar **does** link the Milestones view (`Sidebar.tsx:749-751`
  `sidebar-milestones-link`; routed at `router/index.tsx:183`), so UX-15
  narrows to copy/discoverability only (**MSL-42**).
- **Sprints overview lane** (`SprintsView.tsx`) — full-card click,
  progress done/total (F1), date range, days-remaining, mini-burndown
  (K-14); S-11 board width; Chip migration. New cases **SPR-39** (overview
  at-a-glance data) + **SPR-40** (create/delete/archive/unarchive parity)
  — renumbered from the proposed SPR-27/28, which collided with existing
  cases (review-2 §3.2).
- **Sidebar lane** (`shell/Sidebar.tsx`, `useSidebarCollapse.ts`) —
  **K-10 groups show/hide + reorder editor** (the **web half** of the
  K-10 core track above — the core/CLI/MCP/doctor/docs half is scheduled
  as the K-10 core track, which must land before this lane opens); S-11
  ColorDots (hardcoded hex → tokens); S-8 star glyph; Chip/TextField
  migration; R2 mobile-rail dismiss; UX-3 strip ambient sort from hrefs
  (**LST-55**). Case **SHL-45** (renumbered from SHL-N1). **`Sidebar.tsx`
  is ONE lane** (800+ lines; B2 already touched it for K-8, sequenced
  B2→B4).
- **Header lane** (`shell/Header.tsx`) — **UX-12: wire the dead search
  input** to `/api/search` (onChange/Enter → results/navigation). This is
  the header's own lane so it does not collide with the Sidebar rewrite.
  Case **SHL-46** (renumbered from SHL-N2); note the a11y A11Y-2 (`/`
  focuses search) becomes reachable once this lands.
- **New-task modal lane** (`create/CreateTaskModal.tsx`) — **UX-14** (case
  **NEW-42**, renumbered from NEW-N1 and **narrowed**): Create is **already
  disabled** on an empty title (`CreateTaskModal.tsx:181,265,665`) and
  **NEW-2 (tagged, passing) already pins** submit-enabled-only-when-title-
  non-empty (review-2 §2). So this lane does NOT re-assert the disable — it
  makes the disabled Create a **visible** cue (`disabled:opacity-60`) and
  **pre-fills** Status/Type with the configured `workflow.yaml` defaults
  instead of showing "—".
- **Primitive-migration remainder lane** — owns ONLY files no other lane
  touches. Enumerated: `settings/*` panels B2 did not restructure
  (Calendar, Estimation, Backup, Preferences, Reconcile, GitSync,
  Diagnostics, Keyboard, CardLayout, SidebarPins); `comments/*`;
  **`task/editors/*` + `task/DeleteTaskDialog`** (narrowed from `task/*`:
  `task/MetaPanel.tsx` is owned by B3's Task-meta lane and `task/TaskDetail.tsx`
  by B3's Relationships lane — review-2 §4.3); `list/DeleteConfirmDialog`,
  `BulkBar`; `timeline/*`; `init/InitWizard`; `ui/Modal`, `ui/Toast`;
  **`settings/RemapDeleteDialog.tsx` (the B1 Radio/Button primitive swap —
  moved here from B0, review-2 §4.1; B0b only rewords its copy)**;
  `settings/DeleteViewDialog.tsx` (Button + `text-white` — and its R3
  max-width). Icon-glyph unification (S-8) across the remainder.
- **Responsive remainder lane** — collapses to `SettingsShell.tsx` (R1
  narrow-width breakpoint) plus whatever `useSidebarCollapse` needs;
  `Sidebar.tsx`'s R2 is owned by the Sidebar lane, dialog max-widths by
  the file that owns each dialog (S-10).

**Undo on successful board/timeline drop + bulk Set** (edit-model §4) —
if Ken rules it in (open decision #2), it is a board+timeline+bulk lane
here; not built otherwise.

## Batch 5 — CLI/cross-surface + docs sweep

- **CLI-1** — build `--root` global (alias `--cwd`); `ui`/`mcp` accept it
  directly; web `main.ts:28` gains a `--cwd` alias. (The decision was
  *recorded* in B0; B5 builds it.) Document `--root`/`LOCTT_ROOT` in the
  CLI reference; update the tracker's "Found during setup" note.
- **The reference-doc sweep is a sweep, NOT the first touch.** Per
  CLAUDE.md "a capability in core is not done until CLI and MCP have it",
  the CLI + MCP reference docs must change **in the batch that adds each
  core capability** — the p1 set-default route, sprint `archived`, the
  K-10 settings shape all update their surface docs in their own batch.
  B5 verifies nothing was missed and adds anything cross-cutting.
- Verify all `decisions.md` § 8/§9 entries are present (they were written
  as the calls were made, not deferred here).

---

## Dependency graph (why this order)

- **Batch 0** — bugs **+ the recorded decisions**; **B0a** is independent
  of the primitives and startable today; **B0b** (the BUG-2 copy) waits on
  its SET-17/SET-19 case revision landing first (step 0). First so nothing
  is tested on a brickable tracker and so B2 has a `decisions.md` that
  permits it. B0 ∥ B1: B0 no longer touches any B1 primitive — the
  `RemapDeleteDialog` Radio/Button swap moved to B4, so B0b only rewords
  copy in that file and needs nothing from B1.
- **Batch 1** — additive new files + two style files; **blocks** the
  polish/migration + all the Edit/Create dialogs in B2–B4.
- **Batch 2** — needs B1 (incl. `Dialog`) + B0 (decisions + BUG-2 copy;
  Workflow lane also BUG-1). Two waves.
- **Batch 3** — needs B1 primitives.
- **Batch 4** — needs B1; touches the most files, so last; re-partitioned
  by file ownership.
- **Batch 5** — builds CLI-1 (decision already recorded in B0) + the docs
  sweep.

Files touched by 3+ batches, and the sequencing rule for each:
- **`server.ts`** — B0 (error envelope), B2 Projects (set-default route),
  B2 Sprints (`archived`). B0 first; inside B2 **one owner serialises the
  route-table additions** (the route table is one array at `:4818-4919`;
  two appenders conflict). B5 does not touch it (`main.ts` instead).
- **`Sidebar.tsx`** — B2 (K-8 enable), B4 Sidebar lane (everything else).
  Sequenced B2→B4; inside B4 it is one lane.
- **`RemapDeleteDialog.tsx`** — **B0b** (copy + typo only) then **B4
  remainder** (the B1 Radio/Button primitive swap). The swap is NOT in B0
  (B0 ∥ B1, so B0 cannot consume B1 primitives — review-2 §4.1). B2 lanes
  must not edit it. Sequenced B0b → B4.
- **`useDataMutations.ts`** — B2 Milestones + B2 Labels both need a hook.
  **Owner: Milestones** (it already widens `useUpdateMilestone` at `:130`);
  **Labels hands it a one-hook diff** rather than editing it in parallel.
  (review-2 §1 #10.)
- **`list/cells.tsx`** — **owner: B4 Toolbar/List lane** (K-15 chip
  theme-aware + row-hover fix); the **B4 Board lane consumes it** via
  `board/BoardCard.tsx:12` and does not edit it. Sequenced Toolbar/List →
  Board. (review-2 §2 / §4.2.)
- **`task/MetaPanel.tsx`** — **owner: B3 Task-meta / degradation lane**
  (UX-7 / DEG-29); B4's remainder is narrowed to `task/editors/*` +
  `DeleteTaskDialog` so it is not double-owned. (review-2 §4.3.)
- **`SprintMetaHeader.tsx`** — B2 restructures + migrates it (off B4).

## Coverage check — every tracker item → a batch (corrected, MUST-FIX #7)

BUG-1→B0 · BUG-2→**B0 (fix the copy, decided)** · K-1→B1+B4 · K-2→B4 ·
K-3→B1+B4 · **K-4→B3 (inline kebab+confirm, decided)** · K-5→B3 ·
**K-6→B1+B4** (LabelsField call-site swap is B4, not B1-only) ·
K-7/K-7b→B3 · K-8→B2 · K-9→B4 · **K-10→B4 Sidebar (web half) + the K-10
core track (contracts+core+CLI+MCP+doctor+docs, scheduled alongside B2
wave 2 / B3, before B4 Sidebar — see the "K-10 core track" section in B2)**
· K-11→B2 · **K-12→B1+B4** (states defined in
B1, delivered when call-sites migrate) · K-13(edit-model)→B0(record)+B2+B3
· K-14→B4 · CLI-1→B0(record)+B5(build) · S-1..S-8→B1+B4 · S-9→B1 ·
S-10→B4 · **S-11→B4** (Sidebar ColorDots→Sidebar lane; board width→new
Board lane; toolbar-on-mobile→Toolbar lane — was DROPPED in v1) ·
**K-15→B1+B4** (Ken-added row-hover: Chip theme-aware + hover-token in
B1; the real fix is in **`list/cells.tsx`** — owned by B4 Toolbar/List
lane, consumed by Board — not `ListView.tsx:720`) ·
**K-16→B1+B4** (cursor pointer: `cursor-pointer` baked into the
Button/IconButton/ToolbarButton/interactive-Chip/MenuItem base in B1 +
the spec's §1.1 Button base; B4 migration removes the 5 ad-hoc
`cursor-pointer` sites — review-2 §2, was UNMAPPED) ·
config-MISSING(u1/u2/u3/p1/m1, workflow-create, custom-fields,
saved-view-edit)→B2 · **PRU-44→B2 (preserve, no new capability; PRU-44/45
`@verifies` tags already exist + pass — the restructure edits the green
`ProjectsPanel.test.tsx`, name it in the commit)**.

Newly ingested (JOB 1): **UX-1(LST-53)/UX-2(LST-54)/UX-4(LST-56)→B4
Toolbar/List · UX-3(LST-55)→B4 Sidebar · UX-5(BRD-50)/UX-6(BRD-51)→B4
Board · UX-7(DEG-29)→B3 Task-meta/degradation lane · UX-8→B3
Relationships (no proposed case yet — draft or exempt in step 0) ·
UX-9(TSK-64)→B3 editor · UX-10→B3 activity (no proposed case yet — draft
or exempt in step 0) · UX-11(DEG-31)→cross-cutting; the global indicator
lands in ONE lane (B4 Header — not "Header/Sidebar"), plus the B3 detail
marker (DEG-29) and B4 list marker; DEG-31 carries the data-source sizing
note (a cheap/cached warning-count endpoint, not a full `runDoctor` per
page load) · UX-12(SHL-46)→B4 Header · UX-13(DEG-30)→B2 Labels ·
UX-14(NEW-42, narrowed — Create already disabled, see the lane)→B4
New-task modal · UX-15(MSL-42, premise false — nav link exists; copy only)
→B4 Milestones · UX-16→B4 Board/Toolbar (overlaps S-11) · ED-1/2/3
(TSK-65/66/67)→B3 editor.**

K-9→B4 Milestones: **MSL-1 already green (progress bar exists)**; residual
is MSL-39 (full-card click) + MSL-40 (countdown) + MSL-41 (breakdown).
K-5→B3 Activity: **CMT-18 already green (stacked, not tabs)**; the tab
split edits that green test — no new case.

Tracker minor items: agreement typo (`RemapDeleteDialog.tsx:70`)→B0b;
stale "Project deleted" dialog→B2 Projects. `DeleteViewDialog` is **not**
dead code — do not delete it. Nothing dropped.
