# Review of `ui-implementation-batches.md` — before building

Adversarial, read-only review of the batch plan against its inputs
(`ui-review-tracker.md`, the seven `ui-review-*.md` docs, the three
`ui-crud-*.md` docs, `ui-design-system-spec.md`,
`bug-journal-remap-inverse.md`) and against source at HEAD `59d55e0`.
Every claim below that names a file or line was checked in source, not
copied from the review docs.

Ken's rulings (one release, no prioritisation, "inline is for tasks",
`--root` canonical) are taken as given and not re-argued.

**Verdict: NEEDS-REVISION.** The batch *shape* (bugs → primitives →
config edit-model → task detail → views/migration → CLI/docs) is right
and the dependency direction is right. What is wrong is (a) the plan
does not know the repo's actual build gate — it omits the Playwright
suite and the case-coverage gates that `build-loop.md` makes mandatory,
and it has no step for authoring/revising the UI cases that gate
depends on; (b) Batch 4's "parallel lanes" share files; (c) three
items are sized as UI work that are in fact core capabilities owing
CLI/MCP parity; (d) the coverage line is not true as written; and
(e) five decisions the plan silently makes or leaves dangling are
Ken's, two of them blocking Batch 0 and Batch 2.

---

## 1. Coverage — is every tracker item in a batch?

**Verdict: mostly, with one unmapped row, two false "B1-only"
mappings, one internal contradiction, and a class of findings the
tracker itself never ingested.**

Checked every row of the tracker against the coverage line and the
batch bullets.

| Item | Plan says | Actual | Finding |
|---|---|---|---|
| BUG-1 | B0 | B0 | OK. |
| BUG-2 | B0 "decide" | unresolved, see §6 | Not decidable by an agent — §6. |
| K-1, S-1, S-2 | B1+B4 | — | OK. |
| K-2, K-3, S-3, S-4 | B4 (K-3 also B1) | — | OK. |
| K-4 | B3 | — | Mapped, but the *shape* contradicts Ken's ruling — §5. |
| K-5 | B3 | — | Mapped, under-sized — §6. |
| **K-6** | **B1 only** | Needs LabelsField.tsx to adopt `Chip` | The fix is a call-site migration (`task/editors/LabelsField.tsx:142,167`); B1 is additive and touches no call sites, so K-6 is not fixed until B4. Map **B1+B4**. |
| K-7 / K-7b | B3 | — | OK; editor P3s (#7 strike/sub/sup buttons, #8 GFM tables, #9 shared `rich-editor` testid) are in `ui-review-editor.md` but not in the tracker, so not in the plan — see "never ingested" below. |
| K-8 | B2 | — | OK. |
| K-9, K-14 | B4 | — | OK. |
| K-10 | B4 | — | Mapped, mis-sized as UI-only — §6. |
| K-11 | B2 | — | OK. ("K-11a" in the plan is not a tracker id; it is K-11 (a).) |
| **K-12** | **B1 only** | Interaction states reach the screen only when call sites migrate | Same as K-6: B1 defines the states, B4 delivers them. Map **B1+B4**. |
| K-13 | B2+B3 | — | OK. |
| S-5, S-6, S-7, S-8 | B1+B4 | — | OK. Note B1's bullet "kills the 7 `text-white` bugs" is false in B1 — the seven sites (`ReconcilePanel:260`, `GitSyncPanel:171`, `CommentComposer:272`, `DeleteViewDialog:78`, `DeleteConfirmDialog:122`, `CreateTaskModal:1270`, `DeleteTaskDialog:131`) are only fixed when swapped in B4. |
| S-9 | B1 | — | OK, but see §4: this edits `styles/tokens.css`, so B1 is not "no existing file changes". |
| S-10 | B4 | — | OK. |
| **S-11** | **absent from the coverage line** | Sidebar ColorDot hexes (`Sidebar.tsx:469,517,815`), board `w-[280px]` (`BoardView.tsx:671`, `SprintsView.tsx:597`), filter toolbar on mobile (`FilterBar.tsx:189`) | **Dropped.** B4's Responsive bullet lists only S-10's three items. Add S-11 to B4 (ColorDots → the Sidebar lane; board column width → a Board lane that does not otherwise exist; toolbar-on-mobile → the Toolbar IA lane). |
| config-MISSING u1/u2/u3/p1/m1, workflow-create, custom-fields, saved-view-edit | B2 | — | All present in B2 bullets. OK. |
| CLI-1 | B5 | — | OK. |
| PRU-44 | "already built (no work)" | see below | Built; but the plan contradicts itself. |
| Tracker minor items: "1 task currently use" agreement (`RemapDeleteDialog.tsx:70`), stale "Project deleted" dialog leaking into a fresh Delete | not mapped | — | Both are in the tracker's config-CRUD paragraph. Map the typo to B0 (it is in the same dialog BUG-2 touches) and the stale-dialog bug to B2's Projects lane. |

**PRU-44.** Confirmed built, not a claim: `ProjectsPanel.tsx:23` is
headed "PRU-44/PRU-45: the per-project prefix is an editable control";
`useSetProjectPrefix` (`useProjectMutations.ts:102`) calls
`PUT /api/projects/:id/prefix` (`server.ts:4827`, plus the
`prefix-rename/complete` recovery route at `:4828`); the CRUD agent got
a live 200 with `renamed:0`. So "no new capability" is right. But the
plan says two things: the coverage line says "no work", and the B2
Projects bullet says "fold into the dialog". The second is correct and
is work: the Projects Edit dialog must carry the prefix control **and**
keep PRU-44's own pinned shape ("editing it does not save on blur",
confirm states the blast radius in numbers) and the PRU-46 Playwright
test (`tests/ui/flow-settings-projects-users.spec.ts`). Change the
coverage line to "PRU-44 → B2 (preserve, no new capability)". Also:
no test anywhere is tagged `@verifies PRU-44` or `PRU-45` (grep of
`apps/web/src` and `tests/ui`), so the panel restructure has nothing
guarding those two cases — add the tags in B2 or they can regress
silently.

**Findings the tracker never ingested, so the plan cannot cover.** The
tracker's "From the review swarm" table has rows only from the
form-controls, toolbar, consistency and responsive-theme docs.
`ui-review-ux-interactions.md` contributed **no S-row** (K-9 cites it
as "pending"), and the editor doc's three P3s are not in K-7b. Under
"everything ships, no prioritisation" Ken will reasonably assume the
swarm's findings are all in. They are not. Not in the tracker, hence
not in the plan:

- ux-interactions §1.1 — a `q=` filter (every sidebar saved filter)
  shows no chip and no "Clear all" (confusing).
- §1.2 — first click on Priority sorts Low→Critical.
- §1.3 — sidebar links carry the ambient `sort`/`dir`.
- §1.4 — facet dropdown items show no checkbox until selected.
- §2.3 — board cards show no blocked marker / epic child count.
- §2.4 — board status pills are unlabelled column-visibility toggles.
- §4.1 — corrupt `due_date` renders as "—" on task detail; unknown
  `jira_id` invisible (the degradation story is silent where users
  edit). Partly known: `known-gaps.md` has the `src.health` note but
  not the detail-view rendering.
- §4.2 — parent/child relationship group headers read backwards
  ("PARENT · 3" over an epic's children).
- §4.3 — editor toolbar always visible in view mode.
- §4.5 — activity says "a is_blocked_by link" (raw key, wrong article).
- §5.1 — a broken label (`l_broken`) is omitted from Settings → Labels
  with no notice, so it cannot be repaired in-app.
- §5.3 — Settings → Milestones copy points at a "Milestones view" the
  sidebar never links to.
- §6.1 — no global data-integrity indicator; Diagnostics is three
  clicks deep behind a manual Run.
- §6.2 — header search does nothing. (`known-gaps.md:2342` records it
  as *disabled with a title*; the reviewer observed it accepting input.
  Either way, not in the tracker.)
- §6.3 — New-task empty title is a silent no-op; Status/Type default to
  "—" instead of the configured defaults.
- §6.6 — tablet-width board/toolbar degradation (overlaps S-11).
- editor §7/#8/#9 — no strike/sub/sup/math buttons; GFM tables neither
  parsed nor forced-raw; two editors share `data-testid="rich-editor"`.
- edit-model JUDGEMENT recommendations that the tracker's K-13 row
  quotes ("board/timeline drag = keep but add Undo") — Undo on a
  successful board/timeline drop and on bulk Set-field is recommended
  in `ui-review-edit-model.md` §4 and is nowhere in the plan.

This is not a plan defect so much as a tracker defect the plan
inherits — but "nothing dropped" is only true of the tracker, not of
the review. **Ken must say whether these are in the release** (see the
decisions list at the end). If yes, they need batches; the natural
homes are: §1.1/1.2/1.3/1.4 → B4 Toolbar/List lane; §2.3/2.4/6.6 → a
new B4 Board lane; §4.1/4.2/4.3/4.5 and editor P3s → B3; §5.1 → B2
Labels lane; §5.3/6.1 → B4; §6.2/6.3 → their own lanes (header,
create-modal); Undo-on-drag → a B3/B4 board+timeline lane.

**Double-counting.** None found. K-1/S-1/S-2 and K-3/S-3/S-4/S-5 are
the same root causes counted from two directions, and the plan maps
them to the same batches.

---

## 2. Dependency correctness

**Verdict: the graph is right; two prerequisites are missing from it
and one is scheduled after the work that needs it.**

- **B1 → B2/B3/B4.** Yes, a real prerequisite. B2 builds ~10 Edit/
  Create dialogs; building them on hand-rolled buttons and then
  re-swapping in B4 is exactly the rework the plan is trying to avoid.
  One gap: **the plan lists "Dialog" among the B1 primitives B2
  consumes (`ui-implementation-batches.md:77`), but B1 does not build a
  Dialog.** `ui/Modal.tsx` already exists (title/onClose/children,
  focus trap per A11Y-14, inert background, Esc/backdrop close) and is
  adequate as the base. What every B2 lane will otherwise hand-roll is
  the *footer* — Save/Cancel `Button`s, pending state, an anchored
  `Callout` for the save error, `data-testid`s. Add a thin
  `ui/Dialog.tsx` (or `Modal` + `DialogActions`) to B1 with a named
  test-id convention (`<panel>-edit-dialog`, `<panel>-edit-save`,
  `<panel>-edit-cancel`, `<panel>-edit-error`) so seven lanes converge
  instead of drifting on day one.
- **B0 BUG-1 → B2 Workflow lane.** Yes. Any tracker with a directional
  link 400s on `PUT /api/workflow` (`workflow-write.ts:776`, `:332`),
  and the Playwright workflow spec seeds via the CLI so a fixture with
  a `parent`/`blocks` link would poison the journal mid-suite. BUG-1 is
  **not** a prerequisite for B2's other six lanes (labels/milestones/
  users/projects/sprints/views go through their own remap paths, which
  the CRUD agents showed working) — the plan is right to sequence
  B0 ∥ B1 → B2, but should say the Workflow lane specifically waits on
  BUG-1 so the other lanes are not blocked on it.
- **B0 BUG-2 → B2.** Missing from the graph. BUG-2's copy lives in
  `settings/RemapDeleteDialog.tsx`, which **five** B2 lanes consume
  (`EnumCollectionPanel`, `RelationshipsSettingsPanel`,
  `CustomFieldsPanel`, `MilestonesPanel`, `LabelsPanel`). If BUG-2 is
  resolved as a behaviour change it also touches `workflow-write.ts`
  (the same file as BUG-1) and `milestones/manage.ts`. B0 must land
  before any B2 lane opens `RemapDeleteDialog`, and the plan's claim
  that B0 is "core + server, no client" is false — the dialog is
  client.
- **decisions.md entry for the K1 supersession is scheduled in B5, but
  B2's first commit violates K1 as recorded.** `decisions.md §9 K1`
  ("SET-3 is dropped; workflow panels are editable") is a Ken ruling
  that an agent may not revert; the tracker says "a new decisions.md
  entry will record it at build time". Build time is B2, not B5. Per
  `TEMP-RUN-WORKFLOW.md` § "What stops the run" condition 3, an agent
  committing B2 against the current decisions.md is violating a
  recorded decision. **Move the §9 entry to B0 (it is Ken's ruling,
  already made — it just needs writing down) so it precedes B2.**
  Same for the `--root` ruling: write it in B0, build it in B5.
- **Case revisions precede B2/B3, not follow them.** `build-loop.md`
  step 2 says "Do not edit the flow docs", and the run workflow says a
  contradiction between a case and the work is a stop. The edit-model
  change contradicts pinned cases (list in §6). Those go through
  `PROPOSED-UI-CASES.md` → Ken → flow docs **before** the batch that
  breaks them, or every B2/B3 subsection stops at step 1.
- **B3 before B4:** fine. **B2/B3 before B4:** fine, *provided* B2/B3
  lanes build their new surfaces on the primitives and migrate the
  files they restructure (see §3) — otherwise B4 re-opens every panel.
- **B5 "mostly independent":** true for the CLI work. The docs half is
  not independent — CLI and MCP reference docs must change in the
  batch that adds each core capability (CLAUDE.md: "a capability in
  core is not done until CLI and MCP have it"). B5 should be the
  sweep, not the first time the docs are touched.

No ordering was found that forces rework *within* the plan's own
scope. The rework risk is entirely in what the plan leaves out (the
decisions and cases above).

---

## 3. File-lane collisions

**Verdict: B2 and B3 lanes are disjoint enough; B4's are not. Three
files are touched by three or more batches.**

### Batch 2 — per-panel lanes (verified file sets)

| Lane | Files it must touch | Shared with |
|---|---|---|
| Users | `settings/UsersPanel.tsx`, `api/hooks/useUserMutations.ts` (new `useUpdateUser` — `PUT /api/users/:id` at `server.ts:4869` already accepts name/email/timezone) | — |
| Projects | `settings/ProjectsPanel.tsx`, `api/hooks/useProjectMutations.ts`, **`server/server.ts`** (there is **no** set-default route — `setDefaultProject` is only called internally at `server.ts:1670,1706,1709`; p1 needs a route), `settings/ProjectsPanel.test.tsx` | server.ts (B0, Sprints lane) |
| Milestones | `settings/MilestonesPanel.tsx`, `api/hooks/useDataMutations.ts:130` (widen; `PUT /api/milestones/:id` already accepts `archived` — `server.ts:2074+`) | useDataMutations.ts (Labels lane) |
| Labels | `settings/LabelsPanel.tsx`, `api/hooks/useDataMutations.ts:94-115`, `settings/dataPanels.test.tsx` | useDataMutations.ts (Milestones lane) |
| Sprints | `settings/SprintsPanel.tsx`, `sprints/SprintMetaHeader.tsx`, `sprints/SprintDetail.tsx`, `api/hooks/useSprintDetail.ts`, new create/delete hooks (`POST`/`DELETE /api/sprints` exist at `server.ts:4861,4863`), **`server/server.ts`** (`handleUpdateSprint` at `:1992` accepts name/start/end/state/goal — **no `archived`**; core `archiveSprint`/`unarchiveSprint` exist at `sprints/manage.ts:217,231`, CLI has it, so this is web reaching parity, but it is a server edit), `sprints/SprintDetail.test.tsx` | server.ts (B0, Projects lane); SprintMetaHeader (B4 Chip migration) |
| Workflow | `settings/EnumCollectionPanel.tsx`, `RelationshipsSettingsPanel.tsx`, `CustomFieldsPanel.tsx`, `WorkflowPanelFrame.tsx`, `workflowEdits.ts`, `api/hooks/useWorkflowMutations.ts`, `settings/workflowEdits.test.ts`, `tests/ui/flow-settings-workflow.spec.ts` | `RemapDeleteDialog.tsx` (B0) |
| Saved views | `settings/SavedViewsPanel.tsx`, **`shell/Sidebar.tsx:715-720`** (enable "+ New filter…"), `api/hooks/useCreateView.ts` + new `useUpdateView` (`PUT /api/views/:id` at `server.ts:4857`, core `editView` at `views/manage.ts:98`), likely `list/AdvancedQueryEditor.tsx` reuse | Sidebar.tsx (B4 ×3) |

Collisions inside B2: `server.ts` (Projects + Sprints), and
`useDataMutations.ts` (Milestones + Labels). Both are small, separable
additions, but they are the same file in parallel worktrees. Either
sequence those two pairs or assign one lane to own the file and have
the other lane hand it a one-function diff. Say which.

Seven lanes at ≤5 agents means two waves; the plan should name the
waves (suggest: wave 1 = Users, Labels, Milestones, Saved views, Sprints;
wave 2 = Projects, Workflow — the two that need server.ts and the two
most likely to need a Ken answer).

### Batch 3 — task-detail lanes

Disjoint as listed (`relationships/*`, `editor/*`, `activity/*`), with
one shared parent: **`task/TaskDetail.tsx`** is where K-4's per-panel
Edit button mounts and where K-5's tab state + URL param (CMT-18) live.
Assign it to one lane (Relationships) and have Activity expose a
self-contained tabbed component.

### Batch 4 — the lanes are NOT disjoint

The plan lists five B4 lanes as "parallelizable". By file:

| File | Toolbar IA | Overviews | Sidebar K-10 | Primitive migration | Responsive |
|---|---|---|---|---|---|
| `list/FilterBar.tsx`, `ListView.tsx`, `ExportMenu.tsx`, `RefreshButton.tsx`, `FilterDropdown.tsx` | ✔ | | | ✔ (ToolbarButton, Checkbox ×2, TextField) | ✔ (S-11 toolbar) |
| `milestones/MilestonesView.tsx`, `sprints/SprintsView.tsx` | | ✔ | | ✔ (Chip, Checkbox) | ✔ (S-11 board width in SprintsView) |
| `shell/Sidebar.tsx` | | | ✔ | ✔ (Chip, TextField, S-11 ColorDots, S-8 `★`) | ✔ (R2 rail) |
| `shell/useSidebarCollapse.ts`, `shell/Header.tsx` | | | ✔ | ✔ (Header TextField) | ✔ (R2) |
| `settings/DeleteViewDialog.tsx` | | | | ✔ (Button, `text-white`) | ✔ (R3 max-w) |
| `settings/SettingsShell.tsx` | | | | | ✔ (R1) |

Four of five lanes overlap the migration lane; three overlap the
responsive lane. Running these in parallel worktrees produces a rebase
mess on `Sidebar.tsx` (800+ lines) and `ListView.tsx` in particular.
**Re-partition B4 by file ownership**: every feature lane owns *all*
changes to its files, including the primitive swap and the responsive
fix for those files; the "Primitive migration" lane owns only files no
other lane touches, and the plan should enumerate them (roughly:
`settings/*` panels B2 did not restructure — Calendar, Estimation,
Backup, Preferences, Reconcile, GitSync, Diagnostics, Keyboard,
CardLayout, SidebarPins; `create/CreateTaskModal.tsx`;
`comments/*`; `task/*` incl. `DeleteTaskDialog`; `list/DeleteConfirmDialog`,
`BulkBar`; `board/*`; `timeline/*`; `init/InitWizard`; `ui/Modal`,
`ui/Toast`). The Responsive lane collapses to `SettingsShell.tsx` (R1)
plus whatever `useSidebarCollapse` needs, with `Sidebar.tsx`'s R2
change owned by the Sidebar lane.

### Files touched by three or more batches

- **`apps/web/src/server/server.ts`** — B0 (error envelope at
  `:1508-1512`), B2 Projects (set-default route), B2 Sprints
  (`archived` on PUT), B3 Activity if a `kind` filter is added (§6),
  B5 not at all (`main.ts` instead). Safe only if B0 lands first and B2
  serialises the two additions. The route table is one array
  (`:4818-4919`); two agents appending to it will conflict.
- **`shell/Sidebar.tsx`** — B2 (K-8 enable, ~line 720), B4 Sidebar
  (K-10 rewrite of the groups), B4 migration (Chip/TextField/ColorDots),
  B4 responsive (R2). Sequenced B2 → B4 is fine; inside B4 it must be
  one lane.
- **`settings/RemapDeleteDialog.tsx`** — B0 (BUG-2 copy/behaviour,
  agreement typo), B2 ×5 consumers (dialogs may re-mount it inside the
  Edit dialog), B4 migration (Radio ×2, Button). B0 first; B2 lanes
  should not edit it; B4's swap is mechanical.
- **`sprints/SprintMetaHeader.tsx`** — B2 (edit-gate), B4 (Chip at
  `:217`, Select at `:196`). B2 should adopt the primitives while it
  restructures so B4 does not reopen it. State this rule generally:
  **a file restructured in B2/B3 is migrated in B2/B3 and is off
  B4's list.**
- **`packages/core/src/config/workflow-write.ts`** — B0 BUG-1 (`:332`,
  `:563-616`, `:776`), B0 BUG-2 if behaviour option (§6), B2 Workflow
  lane only if custom-field create needs core (it does not — `PUT
  /api/workflow` takes the whole document and
  `validateRemapCoversDeletions` already covers `custom_fields`
  `:363-405`). Fine.

---

## 4. Gate-ability

**Verdict: the plan's gate is not the repo's gate, and two batches
cannot go green without editing green tests — which is legitimate here
but must be planned and said.**

**The gate line is wrong.** The plan (`:17-18`) defines the full gate
as "build/typecheck/lint + core/web/integration/e2e". The repo's gate
(`build-loop.md` § Per ticket) is: `cases:coverage --require <ids>`
(must fail at step 1, pass at step 8), `test` + `typecheck` + `lint`,
**`test:ui`** (Playwright, `tests/ui/*.spec.ts` — 27 specs, ~576
tests, selecting by `data-testid`), `cases:check`, `test:integration`.
`test:e2e` (`tests/e2e`, CLI/MCP journeys) is the one the plan names
and is the *least* relevant to UI work. The toolbar review's line "the
`tests/e2e` suite is CLI/MCP only and does not touch the web toolbar"
is true and misleading — `tests/ui` does, and
`tests/ui/flow-list.spec.ts` exists. **Fix the gate line to match
`build-loop.md` and add `npm run test:ui` to every batch.** Note the
run log records that the full Playwright run has crashed Node on
memory and had to be split into batches (`TEMP-BUILD-PLAN.md` M4.5
row); budget for it.

**Per batch:**

- **B0** — green-able. The BUG-1 fixtures in
  `workflow-write.test.ts:469-490,560-580` and `journal.test.ts:697-842`
  must be re-seeded through `linkTask` and shown red first (the plan
  says so; good). Two things it does not say: (i) the doctor addition
  changes doctor's check list, and any integration/e2e/UI test that
  asserts a pass/warn/fail *count* (SET-14 shows "15 passed · 3
  warnings") will need its expectation updated — say so in the commit;
  (ii) the `handlePutWorkflow` envelope change (`server.ts:1508-1512`)
  is asserted by `server.workflow-panels.test.ts` ("the message does
  not start with `internal:`", per the M4.2 run log) — that test was
  guarding exactly this and should go green, not need editing.
- **B1** — green-able. Additive files plus `styles/tokens.css` and the
  `@theme` block in `styles/index.css` (type names `text-body/label/
  meta/heading`). Each primitive owes a component test shown failing.
  No consumer, so nothing else can break — except the contrast-token
  edit, which moves every surface at once; the spec says its own
  commit. Keep that.
- **B2** — **cannot go green without editing green tests, by design.**
  `ProjectsPanel.test.tsx`, `dataPanels.test.tsx` (Labels),
  `SprintDetail.test.tsx` assert blur/change-save; Playwright
  `flow-settings-workflow.spec.ts`, `flow-settings-projects-users.spec.ts`,
  `flow-sprints.spec.ts` verify SET-6/16/17/19, PRU-*, SPR-8 as
  currently written. These tests were asserting K1-era behaviour that
  Ken has now superseded; editing them is the CLAUDE.md "a green test
  edited to make a fix pass was asserting the bug" case *in reverse* —
  the behaviour changed on purpose. That is fine **if** (a) the cases
  are revised first (§2), (b) each commit names the tests it changed
  and why, and (c) the `@verifies` tags move with the behaviour so
  `cases:coverage` still passes. The plan says none of this. Also, B2
  as *one* commit is seven lanes — commit per lane, gate per lane;
  otherwise one lane's red blocks six.
- **B3** — same shape: `RelationshipRow.test.tsx` and the REL-12 block
  of `flow-relationships.spec.ts` assert hover-reveal + no-confirm
  remove. Legitimate to change once REL-12 is revised. `ActivityPanel.test.tsx`
  will need the tab split. Editor: `Toolbar.tsx` has no test file;
  TSK-18 ("toolbar applies formatting … heading") is in
  `flow-task-body.spec.ts` and stays satisfiable.
- **B4** — green-able if the locators in §6 survive. `FilterBar.test.tsx`
  asserts `getByLabelText("Show archived")` and `getByRole button
  /Save as view/` (`:157,202,207`); `ListView.test.tsx`,
  `Sidebar.test.tsx`, `useSidebarCollapse.test.tsx`, `MilestonesView.test.tsx`,
  `SprintsView.test.tsx` all exist and select by role/testid. A pure
  restyle should not touch them; a re-grouping that changes DOM order
  should not either, since none of them assert position.
- **B5** — green-able; `tests/e2e/*` and `tests/integration` drive the
  CLI with `--cwd`, which stays as an alias, so nothing reddens unless
  a test asserts the *unknown-option* error for `--root`.

**Does any batch remove something a later batch still uses?** No. B1
adds; B2/B3 replace inline controls with dialogs on their own files;
B4 replaces class strings. The one "removal" that looks like it —
retiring the hover-reveal remove in `RelationshipRow.tsx` — is inside
B3's own lane.

**Half-migrated tree risk.** B4's migration is the only place the tree
can sit half-migrated across a commit boundary (some files on `Button`,
some not). That is acceptable — the spec's §3 recipe is per-primitive,
commit per file-group — and does not break the gate. The spec's
optional CI grep (`§2.5`) is what stops *new* drift; the plan should
land it in B1 so B2/B3 lanes cannot hand-roll a button.

---

## 5. Edit-model application

**Verdict: the config side is classified correctly and the
MISSING-create work is correctly folded into the same dialogs. The
task-relationships side contradicts the ruling it claims to apply,
and five inline-config controls are left unclassified.**

**Correct:**
- Task inline edits untouched — list rows (read + navigate only),
  `MetaPanel` OptionPickers/dates, `LabelsField` (K-6 is a chip-height
  fix, not a dialog — correct), body autosave (K2), board/timeline
  drag. Nothing task-side is wrongly slated for a dialog.
- Every config panel → view + Edit dialog: Users, Projects, Milestones,
  Labels, Sprints (incl. the sprint-detail header, which the edit-model
  audit correctly identified as the ungated deferral target), Workflow
  ×5, Saved views. Correct set.
- MISSING create (u2 sprint create/delete, p1 set-default, m1 archive,
  workflow-create ×4, custom-fields CRUD, u3 view rename/query, K-8 New
  filter) built inside the same Edit/Create dialogs — right, it is the
  same component and the same hook.

**Wrong or unstated:**

1. **K-4 relationships: the plan builds a kebab, the ruling says a
   dialog.** B3 says "kebab → dropdown … editing/removing behind that
   control". That is Ken's K-4 idea from *before* the K-13 ruling; the
   tracker's decision text says "AND relationships on a task — is
   view-by-default; edit behind an explicit Edit button → dialog", and
   `ui-review-edit-model.md` recommends a per-panel Edit → dialog
   listing links with explicit remove + confirm. A per-row kebab with a
   one-click "Remove" item is still an inline mutation on a view row —
   it only moves the hover problem behind a click. Three Ken inputs now
   disagree (K-4 kebab, K-13 dialog, and REL-12 which pins "remove
   control on hover and on keyboard focus … does not require a typed
   confirmation … undoable"). **Ken must pick one**; the plan should not
   quietly pick the kebab. Whichever it is, "+ Add link" (a create flow,
   `RelationshipsPanel.tsx:395`) can stay, and the ranked-reorder drag
   handle (REL-13, `data-testid="drag-handle"`) needs a home.
2. **Reorder is unclassified.** Statuses/priorities/task-types drag or
   keyboard reorder saves immediately via `PUT /api/workflow`
   (`EnumCollectionPanel.tsx:137`, `ReorderableRows`); SET-6, SET-21,
   SET-28, SET-34 pin that it persists on drop. The edit-model audit
   called it JUDGEMENT → keep inline. The ruling's literal text
   ("edit behind Edit button → dialog") would put order inside the
   dialog. The plan says nothing. **Decide and record** (it is Ken's:
   it contradicts four cases either way it goes, or keeps them and
   carves an exception to the ruling).
3. **One-click Archive/Unarchive on config rows** (projects, labels,
   users, saved views — JUDGEMENT in the audit) — unclassified. Same
   treatment: decide and record. Cheap either way, but seven lanes will
   each answer it differently if the plan does not.
4. **Default-status radio** (`EnumCollectionPanel.tsx:314`, testid
   `statuses-default-*`) — presumably inside the status Edit dialog;
   say so, because it is tracker-wide and the audit wanted a confirm.
5. **Panels that are already compliant are not named as such.**
   Calendar and Estimation are draft-then-Save (Pattern A, the audit's
   "cleanest model"); Card layout, Sidebar pins and Preferences are
   per-user settings the audit ruled outside the principle. The plan
   should say "unchanged" so no lane "fixes" them. Related: **Labels
   and Milestones already have an Edit button → scoped inline form →
   Save/Cancel** (`LabelsPanel.tsx:167`, `MilestonesPanel.tsx:141`),
   which the audit called the target pattern and marked OK. Converting
   an already-gated inline form into a modal is churn with no
   violation behind it, and it reddens `dataPanels.test.tsx`. Worth one
   question to Ken: does "Edit button → dialog" mean a modal, or does
   an Edit-gated form satisfy it? If the former, keep the plan; if the
   latter, two lanes shrink to "add the missing fields".
6. **B2 Sprints "archive"** — the CRUD agent said "archiving is not a
   sprint concept"; that is wrong (`contracts/sprints.ts:31` has
   `archived`, core has `archiveSprint`, CLI lists `(archived)`), so
   the plan is right to include it — but it is a server edit
   (`handleUpdateSprint` lacks `archived`) plus "show archived" toggles
   on `SprintsPanel`/`SprintsView` for parity with CLI `--all`. Not
   client-only as the lane implies.

---

## 6. Right-sizing and missing scaffolding

**Verdict: five real gaps, three of which are blocking.**

### 6.1 Cases: the plan has no step for them, and the gate needs them (blocking)

`build-loop.md` step 1 requires case IDs before a line is written
(`cases:coverage --require <ids>` must *fail*), step 5 transcribes them
into `tests/ui`, step 8 requires them to pass. The run workflow's stop
condition 2 is "no case covers the behaviour, and building it means
authoring the spec". Checked which plan items have cases:

| Item | Case status |
|---|---|
| K-1/S-1 form controls, S-5..S-9, S-10 responsive | Restyles; BLK-1..4, A11Y-21/31/40, LST-10/12, VUE-6..11 lock behaviour — **no new case needed**, existing ones must stay green |
| K-2/K-3/S-3/S-4 toolbar IA | Same — LST-12, VUE-6/7/8/10/11 |
| K-4 relationship edit dialog | **REL-12 contradicts it** (hover remove, no confirm) — revision needed |
| K-5 tabs | **CMT-18** already pins "Comments and Activity are separate, addressable sections … whichever is a tab records itself in the URL" — a case exists; check it is currently *unsatisfied* and tag the fix |
| K-7 heading picker, ordered list, placeholder, paste | **TSK-18** covers "heading" as one button only — new cases needed for levels, ordered list, placeholder, markdown paste |
| K-8 New filter, u3 view rename/query | No case (flow-saved-views has "Save as view" only) — new |
| K-9 milestones overview | **MSL-1** already pins progress bar + `done/total` per card; full-card click, countdown, status breakdown — new |
| K-10 sidebar groups editor | **No case at all** (flow-app-shell pins the groups as fixed) — new, and see 6.3 |
| K-11 user edit dialog | PRU-* cover create; no edit case — new |
| K-14 sprint overview cards | SPR-1/2 pin columns + counts; days-left/mini-burndown — new |
| B2 config Edit dialogs | **SET-6/16/17/19/28/34, SPR-8, PRU-44 (name "saves on blur")** describe inline behaviour — revisions |
| workflow create ×4, custom-fields CRUD | PG-5 in the audit, no case — new |
| u2 sprint create/delete/archive, p1 set-default, m1 milestone archive | No case — new |
| BUG-1 | Core; unit + integration tests, no UI case needed; SET-17's remap branch covers the UI path |
| BUG-2 | **SET-17 bullet 4 and SET-19 bullet 3 pin "leave dangling → drift marker + Diagnostics"** — see 6.5 |

**Add a step 0 to every batch: "cases — new IDs proposed in
`PROPOSED-UI-CASES.md`, revisions listed with the contradicting case
text, both to Ken; batch opens when accepted."** Without it every
subsection stops at build-loop step 1.

### 6.2 Test-id and locator preservation (blocking for B4, relevant to B2/B3)

The plan never mentions `data-testid`, Playwright, or the
design-system spec's "`data-testid` is declared, not spread" rule
(`ui-design-system-spec.md:50-56`, from `MenuItem`'s own comment: a
caller writing `data-testid=` on a component that renders its own
element type-checks and silently never reaches the DOM). Every B1
primitive must take `testId?`/forward `data-testid` to the inner
element; every B4 swap must carry the existing id verbatim. The
consolidated list the reviews produced — `advanced-query-toggle`,
`"Show archived"` label, `/Save as view/` name, `Filter <Label>` /
`Filter by <Label>`, `Refresh`/`Export` aria-labels + `aria-haspopup`/
`aria-expanded`, `dsl-*`, `switch-to-basic*`, `query-warnings`,
`broken-view*`, `estimation-enabled`, `create-another`,
`milestones-show-archived`, `timeline-arrows`, `backup-mode-*`,
`statuses-default-*`, `custom-field-searchable-*`,
`relationship-symmetric-*`, `meta-input-*`, `relationship-remove`,
`relationship-undo-button`, `drag-handle`, `sprint-meta-*`,
`remap-dangle`, `remap-confirm`, `remap-to-*`, `view-delete*`,
`user-*` — should be in the plan as a hard rule, and each B2 lane
should list which ids its dialog *inherits* (e.g. the user Edit dialog
keeps `user-create-name`'s sibling naming) versus *retires*.

### 6.3 K-10 is a core capability, sized as a UI lane (blocking for B4)

Sidebar pins are per-user settings in `contracts/users.ts:175`
(`sidebar_pins`), validated in core (`users/settings.ts`, `users/pins.ts`),
exposed on CLI (`loctt user settings --sweep-pins`) and MCP
(`sweep_sidebar_pins`, `get_user_settings`), with a case (SET-13/SET-27).
A "show/hide + reorder editor for groups" is a **new per-user settings
shape** (say `sidebar_groups: [{id, hidden}]`) — a data shape others
will read, which the run workflow lists as load-bearing (stop). It owes:
contracts schema + degradation per `corruption-handling-guide.md`
(unknown group id, duplicates), core read/write + sweep, CLI flag and
MCP tool + both reference docs, doctor if pins get one, and web. The
tracker even says "a new capability, not just UI". The plan's B4 bullet
is one line. **Re-size it as core+CLI+MCP+web, and put the shape to
Ken** (per-user vs tracker-wide; can built-in filters be hidden; does
"Recently viewed" count as a group).

### 6.4 K-5 tabs need a data-path decision

`GET /api/tasks/:key/activity` takes `limit`/`offset` only
(`server.ts:3993-4020`, `useActivity.ts:70`). A "Comments" tab that
filters *loaded pages* client-side is wrong on a busy task — page 1 can
hold zero comments while page 4 holds ten, and "load more" then means
"load more noise". Two honest designs: (a) the Comments tab reads the
existing comments endpoint (`useComments`, `GET …/comments`) and only
Activity/All page the activity feed — no core change; (b) add
`?kind=` to the activity route → core filter → CLI `history`/MCP
parity per the which-layer rule. The plan should pick (a) unless Ken
wants the filtered feed on CLI/MCP too. CMT-18 already requires the
tab in the URL.

### 6.5 BUG-2 is unresolved, broader than milestones, and not an agent's call (blocking for B0)

The plan says "Decide: honor the copy or fix the copy" and B5 says
"record BUG-2 resolution". Nobody is named as the decider, and it is
Ken's, for three reasons the plan does not surface:

- **It is not a milestone bug.** `RemapDeleteDialog.tsx:106-110` is
  shared by statuses/priorities/types/relationships/custom-enum-values/
  milestones/labels. Every backend treats "dangle" as *clear*:
  workflow `validateRemapCoversDeletions` demands "a remap target (or
  null to clear)" (`workflow-write.ts:311,347,399`) and the panels send
  `{[key]: null}` for `{kind:"dangle"}` (`EnumCollectionPanel.tsx:227`);
  milestones send no `remapTo` and core does `to: options.remapTo ?? null`
  (`milestones/manage.ts:197`); labels the same shape
  (`LabelsPanel.tsx:219`). The copy lies on all seven surfaces.
- **A Ken-approved case pins the copy's behaviour, and the spec never
  verified it.** SET-17 bullet 4: "Choosing to leave them dangling is
  allowed but the panel warns … drift marker … Diagnostics … — **and
  after confirming, they do**." SET-19 bullet 3 likewise. The Playwright
  SET-17 test asserts the warning *text* and exercises only the remap
  branch (`flow-settings-workflow.spec.ts:272-313`); SET-18 reaches the
  dangling state by hand-editing `workflow.yaml` with the comment "the
  state SET-17's 'leave them dangling' branch produces" (`:1147-1150`).
  So the branch that is supposed to produce that state was never run.
  This is a shipped case-vs-code contradiction, which the run workflow
  says is a stop.
- **Honouring the copy is core work with CLI/MCP consequences, not a
  string edit.** "Leave dangling" would need a third remap directive
  (not "target", not "null") that `validateRemapCoversDeletions`
  accepts and `applyScalarRemap`/`applyRelationshipsRemap` treat as
  "skip", plus the journal replay, `deleteMilestone`/`deleteLabel`
  options, CLI `--dangle`-style flags, MCP params, doctor's drift
  report, and the degradation guide's "field-local" contract. Fixing
  the copy instead means rewording SET-17/SET-19 to "clear the field on
  N tasks" and choosing whether a true "leave" option still exists
  anywhere.

Put both options to Ken with those costs. B0 cannot finish without it,
and five B2 lanes mount the dialog.

### 6.6 Smaller under-specifications

- **Doctor "pending journal" + typed replay error** (B0, secondary):
  the diagnosis doc asks whether recovery should ever *give up* on a
  deterministic failure and says to record it in `decisions.md §9`
  (P-11: auto-discarding an entry is how a crash becomes silent
  corruption). The plan builds the listing without surfacing the
  question. Surface it; build the listing regardless (it is safe).
- **Design-system spec open decisions 1–6** (Toggle vs checkbox for the
  three view toggles; `rounded-full` sidebar count badge; `text-micro`
  name; raise `status-discarded`/`priority-low` to AA or document as
  intentionally muted; `border-subtle` decorative vs divider;
  `className` escape hatch on `Button`). Decision 7 (scope) is settled
  by "everything ships"; 1–6 are not, and B1 cannot build `Chip`,
  `Toggle`, the type scale or the contrast commit without them. The
  plan does not list them.
- **B1 "no existing file changes"** is false (`tokens.css`,
  `index.css @theme`); harmless but the collision analysis relies on
  it. Say "new files + two style files".
- **B1 should include the CI drift guard** (spec §2.5) so B2/B3 cannot
  regress.
- **B2 Workflow create dialogs** need field specs the plan does not
  give: status = key (immutable after create, SET-16-shaped lock) +
  label + category + default; relationship = key + label + symmetric/
  inverse + inverse_label + graph + ranked (`RelationshipDef`); custom
  field = key + label + type + multi + searchable + enum values with
  weights (type/multi locked after create per SET-16). Key uniqueness
  and the "key is permanent" copy exist on the read side today; the
  create side must validate before `PUT`.
- **Decisions are recorded per batch, not in B5.** CLAUDE.md and the
  run workflow require an `A?` placeholder entry in `decisions.md §8`
  when the call is made; B5's "record the superseding decisions" would
  be the third time this repo learned that lesson.
- **CLI-1 detail**: `apps/cli/src/index.ts:48` strips `--cwd` before
  dispatch and hands `root` to every command (`:95-126`), so "ui/mcp
  accept it directly" is already true in effect — the change is
  accepting `--root` as the *global* and documenting it; `main.ts:28`
  gains a `--cwd` alias. Fine as sized; also update the tracker's
  "Found during setup" note and both reference docs.
- **`DeleteViewDialog` is not dead code.** The edit-model audit says
  it is unwired; it is imported and rendered by
  `settings/SidebarPinsPanel.tsx:10,237`. `SavedViewsPanel` uses an
  inline two-step confirm instead (`:103-135`). B4's R3 max-width fix
  is therefore live, and B2's Saved-views lane can adopt the dialog for
  consistency. Do not "delete dead code" here.

---

## MUST-FIX (plan changes before building)

1. **Replace the gate line** with `build-loop.md`'s gate: `cases:coverage`
   (fail-then-pass), `test`+`typecheck`+`lint`, **`test:ui`**,
   `cases:check`, `test:integration`. Apply per batch; commit per lane
   in B2/B3.
2. **Add a "cases" step 0 to every batch** (new IDs + revisions via
   `PROPOSED-UI-CASES.md` → Ken), with the §6.1 table as the starting
   list. Specifically REL-12, SET-6/16/17/19/28/34, SPR-8, PRU-44 must
   be revised or explicitly exempted before B2/B3 open.
3. **Write the K1-supersede entry in `decisions.md §9` in B0**, not B5
   (and the `--root` entry alongside it). B2 cannot commit against the
   current §9.
4. **Resolve BUG-2 with Ken before B0 closes** (§6.5) — it spans seven
   delete surfaces and a pinned case, and B2 depends on the dialog.
5. **Re-partition B4 by file ownership** (§3): feature lanes own the
   migration + responsive change for their files; the migration lane
   gets an explicit remainder list; `Sidebar.tsx` is one lane.
6. **Add the rule "a file restructured in B2/B3 is migrated to the
   primitives there and is off B4's list"**, and name `SprintMetaHeader`,
   the seven settings panels, `RelationshipRow/Panel`, `editor/Toolbar`
   as B2/B3-migrated.
7. **Map S-11** (dropped) and the two tracker minor items; fix K-6 and
   K-12 to B1+B4; fix PRU-44 to "B2 — preserve, no new capability" and
   add `@verifies PRU-44/45` tags (none exist).
8. **Re-size K-10** as core+CLI+MCP+web with a schema decision for Ken
   (§6.3).
9. **Fix K-4's shape to whatever Ken picks** among kebab / Edit dialog /
   REL-12 as written (§5.1). Do not build the kebab on the current
   text.
10. **Sequence `server.ts`**: B0 first; inside B2, one owner for the
    route-table edits (Projects set-default route, Sprints `archived`);
    likewise `useDataMutations.ts` (Milestones + Labels) and
    `RemapDeleteDialog.tsx` (B0 only).
11. **Add `Dialog`/`DialogActions` (or a `Modal` footer convention) to
    B1** with the test-id naming rule, so seven B2 lanes converge.
12. **Add the locator-preservation rule + list** (§6.2) and the
    `testId`-prop constraint to B1/B4.

## SHOULD-CONSIDER

- Name B2's two waves (≤5 agents; seven lanes), putting Projects and
  Workflow in wave 2 since they carry the server edits and the open
  questions.
- K-5: choose design (a) (Comments tab from the comments endpoint) to
  avoid a core change; record it.
- Ask Ken whether Labels/Milestones' existing Edit → scoped form →
  Save/Cancel satisfies "Edit button → dialog" (§5.5); if yes, two
  lanes shrink and `dataPanels.test.tsx` stays green.
- Classify reorder, one-click archive/unarchive, and the default-status
  radio explicitly (§5.2–5.4) so the seven lanes agree.
- Land the spec's CI drift grep in B1.
- State B1's real file footprint (new `ui/*` + `tokens.css` +
  `index.css @theme`), keep the contrast change its own commit, and
  note it needs the WCAG re-measure the responsive review did.
- B0: say what "the delete-with-remap partial-write" fix is — with the
  vocabulary fix the journal replay completes the interrupted remap, so
  the partial write becomes recoverable rather than needing a rollback;
  confirm with a test that replays the delete path after a mid-loop
  throw.
- B0 doctor: note the count-asserting tests that will need updating.
- Record decisions per batch with `A?` placeholders, not in B5.
- Give the workflow create dialogs a field spec (§6.6) before the lane
  starts; it is the largest B2 lane and the one with the least existing
  test coverage on the create side.
- Correct the note that `DeleteViewDialog` is dead code before someone
  deletes it.

## Decisions the plan needs from Ken and has not surfaced

1. **BUG-2** — behaviour ("leave dangling" becomes real: core directive
   + CLI/MCP flags + doctor, SET-17/19 kept) **or** copy (dialog and
   SET-17 bullet 4 / SET-19 bullet 3 reworded to "clears the field on N
   tasks"; decide whether any true "leave" option survives). Blocks B0.
2. **K-4 relationships** — kebab menu (K-4 as written), per-panel Edit
   → dialog (K-13 ruling / edit-model recommendation), or REL-12 as
   pinned (hover remove, no confirm, undo). Blocks B3; needs the REL-12
   revision either way.
3. **Reorder of config rows** — stays inline (keeps SET-6/21/28/34) or
   moves inside the Edit dialog (revises them). Blocks B2 Workflow.
4. **Are the un-ingested review findings in the release?** (§1 list:
   ux-interactions §1.1–6.6, editor P3s, Undo on board/timeline drag
   and bulk Set.) If yes, they need batches and cases.
5. **K-10 shape** — per-user vs tracker-wide; may built-in filters and
   "Recently viewed" be hidden; CLI/MCP exposure. Load-bearing data
   shape.
6. **Design-system open decisions 1–6** (`ui-design-system-spec.md`
   § Open decisions): Toggle look, `rounded-full` badge, `text-micro`,
   sub-AA tokens raise-or-document, `border-subtle` semantics,
   `className` escape hatch. Blocks parts of B1.
7. **Does "Edit button → dialog" require a modal**, or does the
   existing Edit-gated inline form (Labels/Milestones) satisfy it?
8. **Doctor/journal P-11** — may recovery ever give up on a
   deterministically-failing replay (surface + typed error only, which
   B0 builds, vs. a discard path)? Record in §9 either way.
9. **One-click archive/unarchive on config rows and the default-status
   radio** — keep as-is or gate. Small, but seven lanes need one
   answer.
