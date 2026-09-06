# Review 2 of `ui-implementation-batches.md` — the revision

Adversarial, read-only re-review of the revised plan against
`ui-plan-revision-summary.md`, `ui-review-tracker.md` (incl. UX-1..16,
ED-1..3, K-15, K-16), `PROPOSED-UI-CASES.md` § "UI-RELEASE PASS",
`build-loop.md`, the case-index tooling (`tools/case-index/parse.ts`,
`tools/coverage/scan.ts`) and source at HEAD `59d55e0`. Every file/line
claim below was checked in source or by running the gate commands, not
copied from the docs. `npm run cases:check` is green at HEAD (997 cases);
`cases:coverage` reports 948/997 tagged.

**Verdict: CLOSE, NOT YET BUILDABLE AS WRITTEN.** The revision genuinely
fixed the shape problems (gate, cases-first, decisions in B0, B4
ownership, multi-layer sizing). What remains is (a) two mechanical
defects in the proposed cases that make step 1 of the build loop fail
for eleven of the new IDs, (b) one item (K-16) the revision did not map
at all, (c) one core track (K-10) that is re-sized but scheduled
nowhere, (d) three new file-ownership gaps the re-partition opened, and
(e) four premises in the plan that are false at HEAD — two of them
mine, carried over from the v1 review.

---

## 1. The 12 must-fixes — resolved?

Numbering below is the v1 review's list. Note that the revised plan's
own "MUST-FIX #n" labels follow a *different* numbering (its "#5" is my
#8, its "#8" pointer resolves to no section at all) — cosmetic, but
"see MUST-FIX #8" currently points nowhere. Renumber or drop the labels.

| # | v1 must-fix | Status | Evidence / what is still wrong |
|---|---|---|---|
| 1 | Gate = `build-loop.md`'s gate incl. `test:ui`, `cases:coverage` fail→pass, `cases:check` | **RESOLVED** | Gate block lines 35-52 matches `build-loop.md` § Per ticket. `npm run test:ui` exists (`package.json:25`; 26 spec files, plan says 27 — trivial). One omission: "accepted into the flow docs" also means someone runs `npm run cases:index` and commits the JSON, or `cases:check` fails at step 8 — say who does that in the acceptance commit. |
| 2 | Cases step 0 in every lane; REL-12 / SET-6/16/17/19/28/34 / SPR-8 / PRU-44 revised before B2/B3 | **PARTIAL** | Step 0 is in the gate block and B2/B3 name their prerequisites. Two gaps: (i) **B0 has a step-0 dependency the plan does not state** — the BUG-2 copy change reddens `tests/ui/flow-settings-workflow.spec.ts:272-313`, which asserts `remap-dangle-warning` `toContainText(/drift marker/i)` and `/Diagnostics/i`; that is SET-17 bullet 4 as pinned, so the SET-17/SET-19 supersedes must land in the flow docs before B0's copy commit. (ii) The artefact step 0 gates on has eleven IDs the index cannot ingest and two that collide — see § 3. Step 0 exists; the thing it points at is not yet usable. |
| 3 | K1-supersede + `--root` in `decisions.md` §9 written in B0 | **RESOLVED** | B0 lists all three §9 entries. `decisions.md` has none of them yet (grep for `--root`/`BUG-2`/"inline is for tasks" is empty) — correct, B0 writes them. |
| 4 | BUG-2 resolved with Ken | **RESOLVED** | Decided (fix the copy). B0 scope is copy + typo + SET-17/19 rewording, no core change — correct: the server already clears (`EnumCollectionPanel.tsx:227` sends `null`, `milestones/manage.ts:197` `remapTo ?? null`). |
| 5 | B4 re-partitioned by file ownership | **PARTIAL** | Feature lanes own their files; Board and Header lanes added; remainder list enumerated. Three files the re-partition left unowned or double-owned — § 4 items 2-4 (`list/cells.tsx`, `task/*`, `useDataMutations.ts`). |
| 6 | "Restructured in B2/B3 → migrated there, off B4" rule + named files | **RESOLVED** | Stated in B2, B3, and the 3+-batch file list. One unstated touch: B2 Sprints adds a "show archived" toggle to `SprintsView.tsx`, which B4's Sprints-overview lane owns. Sequenced B2→B4 so it is safe, but say it is a one-toggle edit, not a restructure, so the rule is not read as moving `SprintsView` off B4. |
| 7 | Map S-11 + minor items; K-6/K-12 → B1+B4; PRU-44 → B2 preserve + add `@verifies` tags | **RESOLVED, one false premise (mine)** | S-11, typo→B0, stale dialog→B2 Projects, K-6/K-12 → B1+B4 all present. **But "add `@verifies PRU-44/PRU-45` tags — none exist today" is wrong, and it was my v1 claim.** They exist: `apps/web/src/server/server.test.ts:779` (`@verifies PRU-44, PRU-45, PRU-46`) and `apps/web/src/client/settings/ProjectsPanel.test.tsx:10` (`@verifies PRU-44, PRU-45 (K30)`); `npm run cases:coverage -- --require PRU-44,PRU-45` passes. The v1 grep missed the comma-list form, which `scan.ts:27` handles. The real risk is the opposite one: `ProjectsPanel.test.tsx` is a *green, tagged* test the B2 Projects restructure will edit — name it in that commit per CLAUDE.md's "editing a green test" rule. Fix the plan's Projects bullet and `PROPOSED-UI-CASES.md` PRU-44 bullet 3. |
| 8 | Re-size K-10 as core+CLI+MCP+web with a shape decision | **PARTIAL — re-sized, not scheduled** | The plan says "moved to its own multi-layer track — see MUST-FIX #8 / Batch 4" (line 226) and B4's Sidebar lane is "the web half" (376). **There is no other half anywhere:** no batch bullet, no lane, no files for `contracts/users.ts` (`sidebar_groups`), `core/users/settings.ts`/`pins.ts`, the CLI flag, the MCP tool, doctor, or the two reference docs. It is the one core capability in the release with no home. Schedule it (a core lane in B2 wave 2 or alongside B3 — anything before B4 Sidebar opens) with a file list. |
| 9 | K-4 shape = Ken's pick | **RESOLVED** | Kebab + confirm per Ken; REL-12 rewrite matches. Note `flow-relationships.spec.ts:703-735` asserts no dialog + `relationship-undo-button`; both become legitimate edits once REL-12 is superseded — name them in the B3 commit. |
| 10 | Sequence `server.ts`, `useDataMutations.ts`, `RemapDeleteDialog.tsx` | **PARTIAL** | `server.ts`: fine by construction — Sprints (wave 1) and Projects (wave 2) are sequential; say that is *why* the waves are split that way. `useDataMutations.ts`: the rule ("sequence the pair, or one lane owns the file") is stated, **the owner is not named**, and Labels + Milestones are both wave 1. Name one (Milestones already widens `useUpdateMilestone` at `:130`; give it the file and have Labels hand over a one-hook diff). `RemapDeleteDialog.tsx`: **new ordering bug** — "its B1 Radio/Button swap rides in B0's finalisation" (line 448) while the dependency graph says B0 ∥ B1. B0 cannot consume B1 primitives if it runs in parallel with B1. Either B0 lands after B1 (serialising two batches that were meant to overlap) or the swap goes to B4's remainder list, where `RemapDeleteDialog.tsx` is currently absent. Recommend the latter; add the file to the remainder list. |
| 11 | `Dialog`/`DialogActions` in B1 with test-id convention | **RESOLVED** | Present. `ui/Modal.tsx` is a plain wrapper (title/onClose/children) so a new `Dialog.tsx` composes it without editing it; `ui/Modal` stays on B4's remainder list for its own close button. Consistent. |
| 12 | Locator-preservation rule + `testId` prop | **RESOLVED** | In the gate notes; `Menu.tsx:102-122` is the declared-not-spread precedent the rule cites. |

**Score: 8 resolved, 4 partial (#2, #5, #8, #10), 0 unresolved.** The
partials are each a paragraph to fix, but #8 and #10 are real ordering
defects, not wording.

---

## 2. New items — placed correctly?

| Item | Plan places it | Verified | Finding |
|---|---|---|---|
| K-15 row hover | B1 Chip theme-aware + hover token; B4 Toolbar/List swaps `ListView.tsx:720` | line 720 confirmed | **Half-placed.** The cells that "render their own bg over the `<td>`" are `list/cells.tsx` (`ProjectChip` etc.), not `ListView.tsx`. `cells.tsx` is imported by `board/BoardCard.tsx:12` — so it is shared by the Toolbar/List lane and the Board lane and **is in neither lane's file list nor the remainder**. Assign it (Toolbar/List lane; Board lane consumes). |
| **K-16 cursor pointer** | **nowhere** | grep of the plan for `K-16` / `cursor` = 0 hits | **Not mapped at all.** Not in B1's Button bullet, not in the coverage line. Worse, the spec it would build from omits it: `ui-design-system-spec.md:160` gives Button's base class as `inline-flex … disabled:cursor-not-allowed` with no `cursor-pointer`, while Checkbox/Radio/Select bases (`:347,:377,:415`) do include it; line 187's "keep the pointer-cursor change as the second cue" refers to something the class string never adds. Ken's instruction is explicit: bake it into Button/IconButton/ToolbarButton/interactive Chip/MenuItem in B1; B4 removes the 5 ad-hoc `cursor-pointer` sites. Add to B1, to the spec's Button base, and to the coverage line as K-16→B1+B4. |
| UX-1/2/4 | B4 Toolbar/List | — | OK. LST-53/54/56 drafted. |
| UX-3 | B4 Sidebar | — | OK (LST-55). |
| UX-5/6 | B4 Board | — | OK; BRD-N2 extends the existing BRD-3 (pills are toggles) — cross-ref it. |
| UX-7 corrupt due_date / unknown key | "B3 (task-detail degradation)" | `task/MetaPanel.tsx:200` renders `—` | **No B3 lane owns it.** B3's three lanes are Relationships / Editor / Activity; MetaPanel is none of them, and B4's remainder claims `task/*`. Either add a fourth B3 lane (MetaPanel + the DEG cases) or give it to Relationships (which already owns `TaskDetail.tsx`) — and narrow B4's `task/*` to `task/editors/*` + `DeleteTaskDialog`. Also see § 3 on DEG-7. |
| UX-8 | B3 Relationships | `flow-relationships.md` has no header-direction case (REL-5 pins the tree, not the label side) | Placed; **no proposed case**. |
| UX-9 | B3 Editor | — | OK (TSK-64). |
| UX-10 | B3 Activity | — | Placed; **no proposed case**. |
| UX-11 global indicator | "cross-cutting (B3 detail + B4 list + B4 Header/Sidebar)" | `server.ts:1288` `handleDoctor` = `runDoctor(root)` in full, every call | **Under-sized and un-owned**, the same way K-10 was in v1. "Header/Sidebar" is two lanes — pick one (Header). And a header badge that polls `/api/doctor` runs a full doctor scan per page load; DEG-N4 needs a data source (a cached/cheap warning-count endpoint or a count derived from what the list already returns) — that is server work the plan does not list. Size it. |
| UX-12 header search | B4 Header | `Header.tsx:123` input is `disabled` at HEAD (`known-gaps.md` was right; the walkthrough's "accepts input" is not what HEAD does) | Placed correctly; SHL-N2 is fine either way. |
| UX-13 broken label | B2 Labels (client-only) | `server.ts:2138` already returns `broken`; `LabelsPanel.tsx` never reads it; core keeps `config.broken` (K28) | **Correctly sized** — genuinely client-only. Good. |
| UX-14 new-task modal | B4 New-task lane | `CreateTaskModal.tsx:665` `disabled={!titleFilled …}` | **Premise half-false.** Create is already disabled on an empty title and NEW-2 (tagged, passing) pins it. The residual is "visibly disabled" styling (`disabled:opacity-60`) + pre-filling Status/Type. Narrow NEW-N1 accordingly, or it will fail step 1 for asserting what NEW-2 already covers. |
| UX-15 milestones copy | B4 Milestones | `Sidebar.tsx:759` links `/milestones` (`sidebar-milestones-link`); `router/index.tsx:183` routes it | **Premise false at HEAD** — the nav does link the view. Re-verify what the walkthrough saw before building; the residual may be copy only. No proposed case. |
| UX-16 | B4 Board/Toolbar (overlaps S-11) | — | OK; restyle under existing cases. |
| ED-1/2/3 | B3 Editor | ED-3's second `rich-editor` is rendered via `comments/CommentComposer.tsx`, which is on B4's remainder (`comments/*`) | Sequenced B3→B4, safe; note the touch. TSK-65/66/67 drafted. |

**Un-cased after this pass** (step 0 as written would stop these lanes):
UX-8, UX-10, UX-15, K-9's new bullets (the proposals say "draft when the
lane opens" — that is exactly the order step 0 forbids), m1 milestone
archive/unarchive, the B0 doctor journal listing (a surface `DEG-C*`
case or an explicit exemption), CLI-1 `--root` (a surface case or
exemption), and Undo (pending decision #2).

---

## 3. `PROPOSED-UI-CASES.md` coherence

### 3.1 Do the reversals quote real contradictions?

Checked each against the current flow-doc text.

| Case | Quoted contradiction | Real? |
|---|---|---|
| SET-17 | bullet 4 "render with a drift marker … and after confirming, they do" | **Yes**, verbatim (`flow-settings.md:157`). |
| SET-19 | bullet 3 "render it as the raw key with a drift marker and are surfaced by Diagnostics" | **Yes** (`:172`). |
| REL-12 | "remove control on hover and on keyboard focus" / "does not require a typed confirmation" / "undoable" | **Yes** (`flow-relationships.md:135-140`). |
| SPR-8 | "Changing `name` and blurring writes the new name" | **Yes** (`flow-sprints.md:74`). |
| SET-16 | "remain editable in the same form" → dialog | **Yes**, small (`:147`). |
| PRU-44 | preservation note | Not a reversal; **its bullet 3 ("none exists today") is false** — see § 1 #7. |
| **SET-6** | "assumes inline field editing throughout the panel" | **No.** Current SET-6 (`:56-63`) is reorder-only: drop indicator, `workflow.yaml` order, cold reload, board columns, priority `value`. It says nothing about value edits and contradicts nothing. The supersede *adds* an Edit-dialog bullet; that is a new case, not a reversal. |
| **SET-34** | reorder-only → add dialog-save-failure bullet | **No contradiction.** Current SET-34 (`:282-287`) is a reorder write failure; the new bullet is additive. |
| SET-28 | bullet 2 "if a drag-reorder was in flight" | **Weak.** The current bullet is reorder-specific; broadening to the dialog is additive. |

Recommendation: keep SET-6, SET-28, SET-34 **untouched** and put the
Edit-dialog behaviour in new IDs (SET-50 "value edits are behind Edit →
dialog", SET-51 "a failed dialog Save stays open, anchored error"). That
leaves the four tagged SET-6/28/34 tests green
(`flow-settings-workflow.spec.ts:146,183,1011,1099`,
`server.workflow-panels.test.ts:116`) and makes decision #3 (reorder) a
one-line §9 record instead of a case rewrite. True reversals are then
five: SET-16, SET-17, SET-19, SPR-8, REL-12.

### 3.2 ID collisions — verified against `case-index.json`, not the summary

Per-tree maxima (ui tree): TSK 56, VUE 39, SET 42, PRU 46, **SPR 38**,
SHL 44, DEG 28, BRD 49, NEW 41, LST 52.

| Proposed | Verdict |
|---|---|
| TSK-59..67 | Free (57/58 skipped — say why, or start at 57). |
| VUE-40, VUE-41 | Free. The VUE-39 fix is correct (VUE-39 = "query timing out is reported as a failure"). |
| SET-46..49 | Free (43-45 skipped). |
| PRU-47, PRU-48 | Free. |
| LST-53..56 | Free. The LST-50..52 fix is correct (all three exist). |
| **SPR-27, SPR-28** | **COLLIDE.** SPR-27 = "A task referencing a sprint id absent from `sprints.yaml` degrades visibly"; SPR-28 = "A sprint edited in the CLI while its detail page is open does not get clobbered". The summary's collision pass missed these. Use **SPR-39 / SPR-40**. |
| **SHL-N1, SHL-N2, DEG-N1..N4, BRD-N1, BRD-N2, NEW-N1** | **Unindexable.** `tools/case-index/parse.ts:67` `CASE_HEADING = /^###\s+([A-Z][A-Z0-9]*-C?\d+)\s+·/` requires digits after the dash; a non-matching `###` line is skipped silently (`continue`, no error — it is treated as a section heading). `tools/coverage/scan.ts:27` uses the same shape for `@verifies`. So: the case never enters the index, `cases:coverage --require SHL-N1` fails as unknown, step 1 can never pass, and a test tagged `@verifies DEG-N1` is not even scanned. Renumber now: **SHL-45/46, DEG-29..32, BRD-50/51, NEW-42.** The doc's own rule ("new IDs continue each file's existing numbering; no renumbering") was simply not applied to these nine. |

Format otherwise parses: milestones are all in `{M1..M4}`, severities in
`{blocker,major,minor}`, principles `P1..P10`.

### 3.3 Existing cases the proposals duplicate, or that already pass

- **DEG-N2 duplicates DEG-7** (`flow-degradation.md:81-85`: an
  unrecognised key "is shown in a 'Not recognised' group, read-only,
  with a remove control"). Do not re-case it. Two further facts: no
  client file renders any "Not recognised" group (grep of
  `apps/web/src/client` finds only `cells.tsx:107`'s sr-only
  "(unrecognised)"), yet `cases:coverage` reports DEG-7 **covered** —
  because its only tag is `packages/core/src/task/frontmatter.test.ts:171`,
  a round-trip test. That is a coverage-tool blind spot (a core tag
  satisfies a UI case) worth a `decisions.md` §8 note and a
  `known-gaps.md` entry; for this plan it means DEG-7's UI bullet is
  the case to tag from the UX-7 lane, and its current green tag should
  not be mistaken for the surface existing.
- **NEW-N1 half-duplicates NEW-2** (submit enabled only when the title
  is non-empty — built and tagged). Narrow to the visible-disabled cue +
  defaults pre-fill.
- **BRD-N2 extends BRD-3**; **SHL-N1 will contradict SHL-9 bullet 4**
  ("a group whose config file has no entries renders an explicit empty
  affordance rather than vanishing") and SHL-5/SHL-10 — the K-10 case
  needs a carve-out ("hidden by the user" is not "vanished").
- **§ C "tag-only" is wrong for both named cases.** CMT-18 is tagged at
  `tests/ui/flow-comments.spec.ts:1308` and passes — the test's own
  comment says the sections are "stacked (not tabs)"; MSL-1 is tagged
  at `flow-milestones.spec.ts:78` (plus 9 unit tags) and asserts the
  `4 / 8` readout and `data-fill` — the progress bar K-9 wants **already
  renders** (`MilestonesView.tsx` → `ProgressReadout`). Neither is
  "currently unsatisfied". Consequences: K-5 must *edit* the green
  CMT-18 test (legitimate — the case permits either shape — say so in
  the commit); K-9's scope is full-card click + countdown + breakdown,
  and those need the new MSL IDs *now*, not "when the lane opens".

---

## 4. New collisions / ordering bugs introduced by the revision

1. **`RemapDeleteDialog.tsx` — B0 depends on B1** (line 448 vs the
   graph's B0 ∥ B1). Move the Radio/Button swap to B4's remainder list.
2. **`list/cells.tsx` — unowned, shared by two B4 lanes** (Toolbar/List
   for K-15; Board via `BoardCard.tsx:12`). Assign to Toolbar/List.
3. **`task/*` — double-owned.** B4 remainder claims `task/*`; B3
   Relationships owns `task/TaskDetail.tsx`; UX-7/DEG-N1 need
   `task/MetaPanel.tsx` with no lane. Narrow the remainder entry and
   create/assign the MetaPanel lane in B3.
4. **`useDataMutations.ts` — both editors in the same wave, no owner
   named.**
5. **B0 reddens a Playwright test** (`flow-settings-workflow.spec.ts:
   272-313`, the `/drift marker/` + `/Diagnostics/` assertions) and so
   needs SET-17/SET-19 in the flow docs first. B0's section does not say
   this; the Dependency graph says "B0 — independent". It is not
   independent of step 0.
6. **`Dialog` needs `Button`; `Button` waits on design decision #6** —
   so the whole of B2 is transitively behind one open decision (§ 5).
7. **Undo default contradicts itself across docs**: the plan says "not
   built otherwise" (line 402-404); the tracker and the summary say
   "default assumed: yes". Pick one text before an agent reads either.
8. Not a collision, but stated wrongly: B2 Milestones "…and
   `dataPanels.test.tsx` stays green" — that file tests `LabelsPanel`
   and `DiagnosticsPanel` only (`dataPanels.test.tsx:76,218`); Milestones
   has no test there. Harmless; fix the sentence.

Sequencing that **is** now correct and should stay: `server.ts` (B0 →
B2 wave 1 Sprints → B2 wave 2 Projects); `Sidebar.tsx` (B2 Saved views
→ B4 Sidebar, one lane); `SprintMetaHeader.tsx` off B4; `flow-sprints.spec.ts`
edited by B2 (SPR-8) then B4 (SPR-39) in different batches; B1 composes
`Modal.tsx` without editing it.

---

## 5. Buildability

### Can B0 start now?

**Yes for BUG-1, the three §9 entries, the error envelope and the
doctor listing; the BUG-2 copy commit cannot land yet.** No *open*
decision blocks B0 — Ken has decided BUG-2, K-4 and the edit model.
What blocks the copy commit is three plan/case actions, not decisions:

1. Apply the SET-17 and SET-19 supersedes to `flow-settings.md` and run
   `npm run cases:index` (Ken accepting text that encodes his own
   ruling — an acceptance, not a new decision). Without it B0 either
   fails `test:ui` or edits the flow docs mid-build, which
   `build-loop.md` step 2 forbids.
2. Move the `RemapDeleteDialog` B1-primitive swap out of B0 (§ 4.1).
3. Give the doctor journal listing a surface case or a recorded
   exemption (build-loop rule 2: no ID, no build).

Two things the revision should fix before B0 opens so the agent is not
handed false claims: the PRU-44 "no tags exist" sentence (§ 1 #7) and
the plan's B0 "independent" claim (§ 4.5).

### Which open decision blocks which batch

| # | Open decision | Blocks | Minimum to answer before |
|---|---|---|---|
| 1 | Are UX-1..16 / ED-1..3 all built in this release? | The first lane that builds one: **B2 wave 1 Labels (UX-13)**; then B3 (UX-7/8/9/10, ED-1..3) and B4 (UX-1..6, 12, 14, 15, 16). Does not block B0, B1, or B2's other four wave-1 lanes. | B2 wave 1 opens — but it is a one-word answer; take it now. |
| 2 | Undo on board/timeline drop + bulk Set | **B4 only** (its own lane). The two docs disagree on the default (§ 4.7). | B4. Deferrable. |
| 3 | Config-row reorder inline vs dialog | **B2 wave 2 (Workflow lane)**. If SET-6/28/34 are left untouched per § 3.1, "keep inline" is the implied answer and only needs a §9 line; if Ken wants it in the dialog, SET-6/21/28/34 all get rewritten and B2 wave 2 waits for that. | B2 wave 2. |
| 4 | Does "Edit → dialog" require a modal, or does an Edit-gated inline form satisfy it? | **B2 wave 1 — Labels and Milestones lanes only** (2 of 5). Users, Saved views, Sprints can start without it. Also decides whether `dataPanels.test.tsx` is edited. | B2 wave 1 (or start wave 1 with three lanes). |
| 5 | K-10 `sidebar_groups` shape (per-user vs tracker-wide; hideable built-ins; Recently viewed; CLI/MCP exposure) | **The unscheduled K-10 core track (§ 1 #8) and B4 Sidebar lane**; and the SHL-N1 → SHL-45 case text. Does not block B0–B3. | Before the core track opens — which the plan must first schedule. |
| 6 | Design-system decisions 1–6 | **B1, and through it everything from B2 on.** Precisely: #6 (`className` escape hatch) blocks `Button` (P0) → `IconButton`/`ToolbarButton`/`Dialog` → every B2 dialog; #2 blocks `Chip` (K-6, K-15); #1 blocks `Toggle`; #3 blocks the type scale; #4/#5 block the contrast commit (S-9). B1 can start today on `icons.ts`/`cn`, `Checkbox`/`Radio`, `Select`, `TextField`, `Callout` without any of them. | **#6 first** — it alone unblocks Button + Dialog and therefore B2. #2 before Chip; #1/#3/#4/#5 before the tail of B1. |
| 7 | Doctor/journal P-11 (may recovery give up on a deterministic replay failure?) | **Nothing.** B0 builds the safe listing + typed error either way; only a "discard path" answer would reopen B0 later. | Deferrable; record in §9 whenever answered. |

**Minimum set to unblock in order:** B0 — none (three actions above).
B1 — #6, then #2. B2 wave 1 — #1 (trivially), #4 for two of five lanes.
B2 wave 2 — #3. B3 — #1 only. B4 — #2, #5. Core K-10 track — #5.

---

## Must-fix before building (this pass)

1. Renumber SHL-N*/DEG-N*/BRD-N*/NEW-N* to SHL-45/46, DEG-29..32,
   BRD-50/51, NEW-42; SPR-27/28 → SPR-39/40. (Blocks step 1 for every
   lane that owes them.)
2. Map **K-16** to B1 (Button/IconButton/ToolbarButton/Chip/MenuItem
   base class) + B4 (remove the 5 ad-hoc sites) + the coverage line;
   add `cursor-pointer` to the spec's §1.1 Button base.
3. Schedule the **K-10 core+contracts+CLI+MCP+doctor+docs track** with
   files, before B4 Sidebar.
4. Fix the three ownership gaps: `list/cells.tsx` → Toolbar/List;
   `task/*` → narrowed, MetaPanel lane in B3 for UX-7; name the
   `useDataMutations.ts` owner.
5. Move the `RemapDeleteDialog` primitive swap from B0 to B4 remainder;
   add B0's step-0 dependency on SET-17/SET-19.
6. Correct the four false premises: PRU-44 tags exist (plan + proposals);
   CMT-18 and MSL-1 are tagged and passing, not "unsatisfied"; UX-14's
   Create button is already disabled; UX-15's nav link exists.
7. Draft the missing cases (UX-8, UX-10, UX-15 residual, K-9's three new
   bullets, m1 archive, doctor listing, CLI-1) or record exemptions —
   before their lanes, not "when the lane opens".
8. Size UX-11's global indicator (data source + endpoint) and assign it
   to one lane.
9. Reconsider SET-6/28/34 as additive new cases rather than supersedes
   (keeps four green tagged tests green; makes decision #3 a one-liner).

## Should-consider

- Note the coverage-tool blind spot (a core `@verifies` satisfies a UI
  case) in §8 / `known-gaps.md`; DEG-7 is the live example.
- Resolve the Undo default text across the three docs.
- Drop or renumber the plan's internal "MUST-FIX #n" labels.
- Say in the gate block that acceptance = flow-doc edit + `cases:index`
  in one docs commit, by whoever applies Ken's acceptance.
