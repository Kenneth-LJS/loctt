# UI-release plan revision — summary (2026-09-06)

PM/planning pass over the single UI release. **Docs only; no source or
test code touched.** Three jobs.

## What changed in each doc

### `ui-review-tracker.md` (JOB 1 — ingest all ux/editor findings)

- Added **§ "Ingested from the per-view UX walkthrough + editor review"**
  — the findings the "From the review swarm" table never captured.
  Deduped: ux §2.1 board-500 = BUG-1; editor P1/P2 = K-7/K-7b; ux §6.6
  tablet = cross-ref of S-11.
  - **UX-1..UX-16** (ux-interactions): UX-1 `q=` no chip/clear (P2), UX-2
    sort-asc-first (P3), UX-3 sidebar hrefs carry ambient sort (P3), UX-4
    facet multi-select affordance (P3), UX-5 board no blocked/epic badges
    (P2), UX-6 status-pill toggles unlabelled (P3), **UX-7 corrupt
    due_date "—" + unknown field invisible (P1)**, UX-8 parent/child
    headers backwards (P2), UX-9 editor toolbar always visible (P3), UX-10
    activity grammar/raw keys (P3), **UX-11 degradation silent in working
    surfaces — the signature-feature gap (P1)**, **UX-12 header search
    dead input (P1)**, UX-13 broken label vanishes from Settings (P2),
    UX-14 new-task silent no-op + defaults "—" (P2), UX-15 milestones copy
    points nowhere (P3), UX-16 tablet-width board/toolbar (P3).
  - **ED-1..ED-3** (editor P3s): no strike/sub/sup/math buttons; GFM
    tables neither parsed nor forced-raw; two editors share `rich-editor`
    testid.
  - Called out the **signature-feature UX gap (UX-11)** prominently, and
    the **Undo-on-drag** edit-model recommendation as a Ken decision.
- Added **§ "Still-open decisions for Ken"** — the 7 residual forks (see
  below).
- **Note:** Ken added a **K-15** row (list row-hover / label wash-out,
  P2) during this pass; left as-is and mapped to B1+B4 in the batch plan.

### `ui-implementation-batches.md` (JOB 2 — fix all 12 Fable must-fixes)

Rewritten. All 12 must-fixes resolved (see the checklist below). Key
structural changes: a correct gate section (adds `test:ui`,
`cases:coverage` fail-then-pass, `cases:check`); a **step 0 "cases"** in
every lane; the K1-supersede + `--root` + BUG-2 decisions **written in
B0**; B4 **re-partitioned by file ownership** with a new **Board lane**
and a **Header lane**; K-10 **re-sized** as a core+CLI+MCP+web track; the
coverage line corrected (S-11 restored, K-6/K-12 → B1+B4, PRU-44 →
B2-preserve + `@verifies` tags); the JOB-1 UX/ED items mapped to lanes.

### `PROPOSED-UI-CASES.md` (JOB 3 — cases before code)

Appended a **"UI-RELEASE PASS (2026-09-06)"** section (the earlier
content is historical and untouched):
- **A. Reversals** (supersede, with the contradicting text quoted):
  **SET-17** (leave→clear, BUG-2), **SET-19** (BUG-2 sibling), **REL-12**
  (hover-remove→kebab+confirm), **SET-6/16/28/34** + **SPR-8** (inline
  config edit → Edit-dialog), **PRU-44** (preserve + add missing
  `@verifies` tags).
- **B. New cases** for the un-cased items: K-7 (TSK-59 heading picker +
  60 caret + 61 ordered list + 62 placeholder + 63 paste + 64 toolbar
  collapse; ED → 65/66/67), K-8/u3 (VUE-39/40), workflow-create +
  custom-field CRUD (SET-46..49), K-11 + p1 (PRU-47/48), K-14 + u2
  (SPR-27/28), K-10 (SHL-N1) + UX-12 (SHL-N2), degradation-visible
  (DEG-N1..N4), board/create polish (BRD-N1/N2, NEW-N1), list/sidebar
  polish (LST-50..53).
- **C.** Existing cases to tag-only (CMT-18 for K-5 tabs; MSL-1 for K-9;
  A11Y-2 after header search).
- **D.** The still-open Ken decisions.
- Every item marked **PROPOSED — awaiting Ken**; the locked
  `ui-test-cases/*.md` were not edited.

## The 12 must-fixes — all resolved (12/12)

1. **Gate line corrected** — added `cases:coverage` (fail→pass),
   `test:ui` (Playwright), `cases:check`, per lane; noted the
   split-the-suite memory constraint. ✔
2. **Cases step 0 in every lane** — `PROPOSED-UI-CASES.md` is the gate;
   REL-12 / SET-6/16/17/19/28/34 / SPR-8 / PRU-44 revised before
   B2/B3 open. ✔
3. **K1-supersede + `--root` + BUG-2 recorded in B0**, not B5. ✔
4. **B4 re-partitioned by file ownership** — feature lanes own their
   migration + responsive; new Board + Header lanes; `Sidebar.tsx` is one
   lane; explicit migration-remainder list. ✔
5. **Re-sized multi-layer items** — p1 set-default (new route),
   sprint-archive (`handleUpdateSprint` gains `archived` + server),
   K-10 (core+CLI+MCP+web + doctor + degradation). ✔
6. **Coverage line fixed** — S-11 restored (was dropped), K-6/K-12 →
   B1+B4, PRU-44 → B2 preserve + `@verifies`, JOB-1 UX/ED items mapped. ✔
7. **B0 is not "no client"** — it owns `RemapDeleteDialog.tsx` (BUG-2
   copy + typo); the file-touched-by-3+-batches sequencing is stated. ✔
8. **`server.ts` / `useDataMutations.ts` sequenced** — B0 first; one
   owner for the route-table additions; the Milestones/Labels hook pair
   sequenced. ✔
9. **B1 gains `Dialog`/`DialogActions`** with a test-id naming
   convention so 7 B2 lanes converge. ✔
10. **Locator-preservation + `testId`-prop rule** stated in the gate
    section (data-testid declared-not-spread). ✔
11. **K-4 shape set to Ken's ruling** — inline kebab + confirm (not the
    v1 kebab-with-one-click-remove, not a dialog); REL-12 rewritten to
    match. ✔
12. **File-restructured-in-B2/B3-is-migrated-there rule** stated;
    `SprintMetaHeader`, the settings panels, `RelationshipRow/Panel`,
    `editor/Toolbar` named as off-B4. ✔

Also folded in the review's SHOULD-CONSIDER items: named B2 waves; K-5
data-path recommendation (a) (comments endpoint, no core change);
Labels/Milestones already-gated question (open decision #4); classified
reorder / archive / default-status radio; CI drift guard in B1; corrected
the "`DeleteViewDialog` is dead code" claim (it is rendered by
`SidebarPinsPanel.tsx:237`); B0 partial-write note; doctor count-assert
warning.

## Still-open decisions for Ken (JOB 1-3 could not resolve)

Carried in both `ui-review-tracker.md` and `PROPOSED-UI-CASES.md` § D:

1. Are all newly-ingested UX/ED findings in *this* release? (default yes)
2. Undo on successful board/timeline drop + bulk Set-field — in or out?
3. Config-row **reorder** — inline (plan default) or into the dialog?
4. Does "Edit → dialog" require a **modal**, or does an already-Edit-gated
   inline form (Labels/Milestones) satisfy it?
5. **K-10 sidebar-groups data shape** (SHL-N1) — per-user vs tracker-wide;
   hideable built-ins; CLI/MCP exposure. Load-bearing.
6. Design-system open decisions 1–6 (`ui-design-system-spec.md`).
7. Doctor/journal **P-11** — may recovery ever give up on a deterministic
   replay failure?

Ken's five rulings (one release; inline-is-for-tasks; task-rels →
kebab+confirm; BUG-2 → fix the copy; `--root` canonical) are treated as
decided and drive the reversals; they are NOT re-litigated.

---

## Review-2 corrections applied (2026-09-06)

The second Fable review (`ui-batch-plan-review-2.md`) found the revised
plan "CLOSE, NOT YET BUILDABLE" — the shape was right but nine mechanical
defects remained. All were PM-decided already; this pass applied them.
**Docs only; no source or test code.**

1. **Unbuildable / colliding case IDs renumbered** (in
   `PROPOSED-UI-CASES.md`). The `-N#` placeholders never parse — the
   case-index parser (`tools/case-index/parse.ts:67`) and coverage scanner
   (`tools/coverage/scan.ts:27`) both require `[A-Z][A-Z0-9]*-C?\d+`, so a
   `-N` heading is silently skipped and `cases:coverage --require` fails as
   unknown. Renumbered to real next-free IDs (verified against
   `case-index.json` maxima and each other — no collisions, all parse):
   - SHL-N1/N2 → **SHL-45/46** (SHL max 44)
   - DEG-N1/N3/N4 → **DEG-29/30/31** (DEG max 28); **DEG-N2 dropped**
     (duplicated DEG-7 — see #6)
   - BRD-N1/N2 → **BRD-50/51** (BRD max 49)
   - NEW-N1 → **NEW-42** (NEW max 41)
   - **SPR-27/28 collided** (SPR max 38) → **SPR-39/40**
   - added **MSL-39/40/41** (K-9 residual) + **MSL-42** (UX-15) (MSL max 38)
   Count: **13 IDs renumbered/renamed, 4 new MSL IDs added, 1 dropped.**
2. **SET-6 and SET-34 NOT superseded.** Both are reorder-only in the flow
   doc and contradict nothing; superseding them would redden 4 green tagged
   tests. Converted the Edit-gated behaviour to **additive SET-50 (value
   edits behind Edit) + SET-51 (failed dialog Save stays open)**, leaving
   SET-6/34 intact. Decision #3 (reorder stays inline) becomes a one-line
   §9 note. Re-checked the six genuine reversals stay as supersedes:
   **SET-16, SET-17, SET-19, SET-28, SPR-8, REL-12**.
3. **Four false premises dropped/corrected** (verified in source):
   - **PRU-44/45 `@verifies` tags exist and pass** (`server.test.ts:779`,
     `ProjectsPanel.test.tsx:10`) — the "none exist" claim was false;
     re-scoped to "the restructure edits a green tagged test, name it".
   - **CMT-18 (K-5) and MSL-1 (K-9) are tagged and green, NOT unsatisfied.**
     K-5 re-scoped to the Comments/Activity **tab split** (edits the green
     CMT-18 test); K-9 re-scoped to **full-card click + countdown +
     breakdown** (MSL-39/40/41) — the **progress bar already renders**.
   - **UX-14** — Create is already disabled on empty title
     (`CreateTaskModal.tsx:181,265,665`, pinned by NEW-2); NEW-42 narrowed
     to the visible-disabled cue + defaults pre-fill.
   - **UX-15** — the sidebar **does** link the Milestones view
     (`Sidebar.tsx:749-751`); MSL-42 narrowed to copy only.
4. **K-16 (cursor pointer) mapped** — was absent from both the batch plan
   and the design-system spec. Added to **B1** (`cursor-pointer` baked into
   the Button/IconButton/ToolbarButton/interactive-Chip/MenuItem base) +
   **B4** (remove the 5 ad-hoc sites) + the coverage line; added
   `cursor-pointer` to the spec's §1.1 Button base (and §1.2/§1.3), which
   line 187 already assumed.
5. **Ownership gaps closed** in `ui-implementation-batches.md`:
   - **`list/cells.tsx`** → B4 Toolbar/List lane owns it (K-15 real fix);
     Board consumes via `BoardCard.tsx:12`, sequenced after.
   - **`useDataMutations.ts`** → Milestones owns it; Labels hands a one-hook
     diff.
   - **K-10 core track** (contracts+core+CLI+MCP+doctor+docs) scheduled as
     a real lane with a file list, before B4 Sidebar — the earlier "see
     MUST-FIX #8" pointed nowhere.
   - **`task/MetaPanel.tsx`** → new B3 Task-meta/degradation lane (UX-7);
     B4 remainder `task/*` narrowed to `task/editors/*` + `DeleteTaskDialog`.
   No file is owned by two parallel lanes.
6. **DEG-7 blind-spot recorded.** DEG-7 reports "covered" only via a *core*
   round-trip test; **no client** renders the "Not recognised" group. UX-7's
   unrecognised-field-in-detail folds into DEG-29 (a client case) rather
   than duplicating DEG-7; the lane must tag DEG-7 from a client test.
   Flagged for `decisions.md §8` + `known-gaps.md`.
7. **B0 split into B0a/B0b.** B0a (BUG-1 + §9 entries + error envelope +
   doctor listing) is startable today. B0b (BUG-2 copy) needs SET-17/SET-19
   superseded + re-indexed first (a spec asserts `/drift marker/` +
   `/Diagnostics/`). The **`RemapDeleteDialog` B1-primitive swap moved from
   B0 to B4** (B0 ∥ B1, so B0 cannot consume B1 primitives); B0b only
   rewords copy.

**Two genuine forks left for the PM/design agent** (noted, not invented):
design-system decision #6 (`className` escape hatch on `Button`) and the
K-10 `sidebar_groups` shape (open decision #5). PM proposes; escalate only
if forked.

**Buildability check:** every new/renumbered ID in the UI-RELEASE PASS
section matches the parser regex and is free in `case-index.json` — a
later `cases:coverage --require <ids>` can find each once accepted into the
flow docs. Note the parser reads only `docs/dev/ui-test-cases/flow-*.md`
and `docs/dev/surface-test-cases/flow-*.md`, so these IDs enter the index
only when the supersedes/new cases are applied to the locked flow docs at
each lane's step 0.
