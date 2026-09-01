# M4 Section Gate — Round 1

**Worktree** `/Users/ken/Documents/PDev/loctt/.claude/gate-m4r1`, pinned at
`354e1ed06cf1203b9741e1ba6d34c6c954844226` (verified `git log --oneline -1`
before starting). Tree `git status --porcelain` empty at start, after every
mutation, and at finish.

**Verdict: FAIL** — 2 blockers, 2 mis-tagged tests, 1 proven-vacuous coverage
area. All mechanical gates pass; the failures are behavioural and were found by
probing the running app, not by the suites.

---

## Half 1 — mechanical gates

Every count was predicted before it was read, and every one matched. Judged by
exit code.

| Command | Exit | Result |
|---|---|---|
| `npm run test` | **0** | 3103 passed + 1 skipped (151+1688+88+67+1090+19) |
| `npx playwright test --config tests/ui/playwright.config.ts --workers=1` | **0** | **645 passed**, 0 failed, 26.0m |
| `npm run test:integration` | **0** | 457 passed (134 files) |
| `npm run test:e2e` | **0** | 21 passed (11 files) |
| `npm run typecheck` | **0** | — |
| `npm run lint` | **0** | — |
| `npm run cases:check` | **0** | index not stale |
| `npm run cases:coverage` | 0 | **801/937** tagged by 1421 tags |

`grep -c FAIL` on the unit log = 0. **No flaky tests were encountered** — the
full UI suite passed 645/645 on the first clean serial run, so none of the
known-flaky list (SHL-6, XS-18, MSL-6, …) needed adjudication.

### A contamination I caused and corrected

My first UI run was started before I began mutating. Two `npm run build`s for
mutations overwrote `dist/` underneath it, and the Playwright fixture serves the
**built** SPA. I killed that run at test 53, restored source, rebuilt from clean
source, and restarted. **The 645/645 above is from the clean re-run.** Every
later mutation was done with no suite in flight. Flagging this because a gate
that had reported the first run's numbers would have been reporting a tree that
did not exist — the exact failure mode the brief warns about.

---

## BLOCKERS

### B1 · SET-1 — `/settings` renders the app-level 404 instead of redirecting

**Case** (`flow-settings.md`, SET-1, **blocker**, P2), bullet 1:
> Landing on `/settings` redirects to a concrete section (e.g.
> `/settings/general`) rather than rendering an empty pane.

**What the code does.** `apps/web/src/client/router/index.tsx:214-222` declares
exactly one settings route, `path: "/settings/$section"`. There is no `/settings`
route and no redirect anywhere in the route tree (`routeTree.addChildren`,
line 241-253). Bare `/settings` therefore falls through to the global not-found
handler.

**Measurement.** Real `loctt ui` server on a freshly `loctt init`ed tracker
(port 7391), driven with Chromium:

```
REQUESTED: /settings
  FINAL: /settings
  MAIN:  "That page doesn't exist  Nothing is routed at /settings.
          The link may be out of date, or the path may have a typo.
          Go to the task list"
  nav present: false

REQUESTED: /settings/general          ← positive control
  MAIN:  "WORKSPACE General Projects Users WORKFLOW Statuses …"

REQUESTED: /nonsense-route            ← positive control
  MAIN:  "That page doesn't exist  Nothing is routed at /nonsense-route. …"
```

`/settings` is byte-identical in shape to `/nonsense-route`. The contrast that
makes this unambiguous is **SET-32**, which is covered and passing:

```
/settings/nonexistent  → nav present: TRUE, settings shell with a not-found pane
/settings              → nav present: FALSE, dumped to the app root 404
```

A *typo'd* section is handled gracefully; the *canonical* URL is not. That
asymmetry rules out "deliberate design".

**Why the test does not catch it.** `tests/ui/flow-settings-workflow.spec.ts:1181`
carries `// @verifies SET-1`. It starts at `/settings/calendar` and never
requests bare `/settings`. Bullets 2, 3 and 4 are asserted well; bullet 1 is
not asserted at all. No mutation was needed — **the defect is live in shipped
code and the tagged test is green.**

In-app links (`Sidebar.tsx:775`, `Header.tsx:295`, `MilestonesView.tsx:154`,
`SprintsView.tsx:348`) all target a concrete section, so this only bites a user
who types or bookmarks `/settings` — which is precisely the user SET-1 bullet 1
describes.

**Not previously recorded**: absent from `known-gaps.md`, `decisions.md`, and
`TEMP-RUN-WORKFLOW.md` § "Cases that cannot be satisfied yet".

---

### B2 · VUE-8/10/11/31/32/33 — the Advanced DSL editor is not mounted anywhere

**Cases** (all **blocker**, M4.5): VUE-8 "Advanced mode **exposes** a raw DSL
textbox with live parse-error markers", VUE-10 "Basic → Advanced is lossless",
VUE-11 "Advanced → Basic is **disabled** with an explanation", VUE-31/32/33
(error states in the editor and the result area).

**What the code does.** `AdvancedQueryEditor.tsx` exists and is well written.
Nothing imports it.

```
$ grep -rln "AdvancedQueryEditor" apps/web/src --include=*.tsx --include=*.ts | grep -v dist
apps/web/src/client/list/AdvancedQueryEditor.test.tsx
apps/web/src/client/list/AdvancedQueryEditor.tsx

positive control:
$ grep -rln "ListView" apps/web/src --include=*.tsx | grep -v dist
  → 8 files (AppBootstrap, cells, router, 3 test files, ListView.tsx, RegionErrorBoundary)
```

The only references are the component's own source and its own test. The string
`"Advanced"` appears in **no other client source file** at all.

**Measurement 1 — the running app.** Live server, Chromium:

```
/settings/saved-views   has "Advanced": false   dsl-input count: 0
/list                   has "Advanced": false   dsl-input count: 0
  MAIN: "Project▾ Status▾ Priority▾ Type▾ Assignee▾ Label▾ Milestone▾
         Sprint▾ Show archived ⭑Save as view ⟳Refresh Export▾ …"
```

No Basic/Advanced toggle exists on the list filter bar or in the saved-views
panel. Contrast probe: `/milestones` and `/sprints` both render their real
content, so the probe method is sound.

**Measurement 2 — the shipped bundle.**

```
$ cat apps/web/dist/client/assets/*.js | grep -o "dsl-input"     | wc -l  →  0
$ cat apps/web/dist/client/assets/*.js | grep -o "milestone-row" | wc -l  →  2   (positive control)
```

The component is tree-shaken out of the production bundle entirely, because
nothing imports it. **It does not ship.**

**Why the tests do not catch it.** Every one of M4.5's 21 tagged cases is
verified against either the unmounted component (rendered directly by
`AdvancedQueryEditor.test.tsx` / `dslToSearch.test.ts`) or the server API
(`server.query-validate.test.ts`). Both layers are correct in isolation. Neither
can observe that no user can reach them. Per-case tag locations:

| Case | Sev | Verified against |
|---|---|---|
| VUE-8 | blocker | unmounted component + `POST /api/query/validate` |
| VUE-10 | blocker | `dslToSearch.test.ts` (pure functions) |
| VUE-11 | blocker | unmounted component + pure functions |
| VUE-31 | blocker | unmounted component + API body |
| VUE-32 | blocker | unmounted component + API body |
| VUE-33 | blocker | unmounted component + API body |

This is **rule 4's shape**: VUE-8 says "exposes", VUE-11 says the toggle "is
disabled" — cases about what renders, asserted against a response body and a
component no route mounts.

**This is the TSK-20 failure mode, repeated.** `TEMP-RUN-WORKFLOW.md` records
TSK-20 as a blocker "declared, unbuilt, and not silently dropped", and states
the general lesson: *"an untagged case and an unbuilt case look identical to
`cases:coverage`."* VUE-8/10/11/31/32/33 are a step worse — they are **tagged**,
so the tool reports them covered, and only probing the app reveals the gap.

**Not previously recorded.** M4.5's Status row is exhaustive about internals
(A73, A74, A76, A77, the VUE-34 vacuity bug it caught itself) and describes
"Advanced→Basic refuses rather than approximates" as though the toggle exists.
It never states the editor is unmounted. Absent from `known-gaps.md` and from
the known-unmet list; VUE-22 is the only M4.5 case recorded as not built.

---

## MIS-TAGGED TESTS

### M1 · `@verifies MSL-13` asserts MSL-12's mechanic

- **Tag**: `apps/web/src/server/server.data-delete.test.ts:207`, the only
  `MSL-13` tag in the repo.
- **What the test asserts**: `DELETE /api/milestones/:id?remap_to=…` moves a
  task's `milestone` field to the survivor, and the response reports
  `affectedTaskCount: 1`. That is server remap mechanics — MSL-12's subject.
- **What MSL-13 says** (major, P5) — three bullets, all about **dialog shape**:
  1. "A zero-reference milestone confirms with a simple confirm — no remap
     picker is shown, since there is nothing to remap."
  2. "A referenced milestone demands the remap choice per MSL-12."
  3. "In neither dialog is the destructive button the default-focused control."

None of the three is asserted. The behaviour **is** implemented —
`MilestonesPanel.tsx:162` passes `count` to a shared `RemapDeleteDialog` that
switches on it — but `MilestonesPanel` has **no test file anywhere**, and
bullet 3 (default focus) is asserted for no entity type.

**Mutation.** `RemapDeleteDialog.tsx:63`, `const inUse = count > 0;` →
`const inUse = (count > 0) || true as boolean;` — forcing the remap picker onto
every delete, violating bullet 1 directly. `npm run build` **exit 0**. All
**66** `apps/web/src/client/settings` tests stayed **green**. Restored, verified.

### M2 · `@verifies MSL-10` asserts file state, not the pickers

- **Tags**: `server.data-delete.test.ts:141` and `:166` (the only two).
- **What the tests assert**: after `POST /api/labels/:id/archive`, `labels.yaml`
  still contains the id and the string `archived`; the referencing task's
  `labels` array is unchanged; unarchive clears the flag.
- **What MSL-10 says** (major, P7 P5) — "Archiving a label preserves existing
  references **but blocks new ones**", four bullets:
  1. Tasks carrying the archived label still display it, marked "(archived)".
  2. **The label no longer appears in the label picker.**
  3. **The label no longer appears in the default filter-bar label list.**
  4. Unarchiving restores it **to pickers**, references intact.

All four bullets are about rendering. None is asserted. The tagged tests verify
YAML on disk — the layer beneath the one the case is about.

**Proof it is unguarded.** The behaviour exists at
`apps/web/src/client/task/editors/LabelsField.tsx:92` (`l.archived !== true`),
and `LabelsField` has **no test file** (`find apps/web/src -name "LabelsField*test*"`
→ empty). See V1 below for the mutation.

---

## VACUOUS / UNGUARDED COVERAGE

### V1 · MSL-10 bullet 2 — archived labels can be offered with the whole suite green

- **File**: `apps/web/src/client/task/editors/LabelsField.tsx:92`
- **Mutation**: `l.archived !== true &&` → `(l.archived !== true || true as boolean) &&`
  — archived labels are offered in the picker, violating MSL-10 bullet 2.
- **`npm run build` exit 0.**
- **Result**: `npm run test` → **exit 0, 3103 passed + 1 skipped** (identical to
  baseline). Targeted UI specs `flow-task-meta.spec.ts` + `flow-task-create.spec.ts`
  → **exit 0, 68 passed**.
- Restored; `git status --porcelain` empty; filter line confirmed back at line 92.

### V2 · XS-41 — "the exact command is shown and copyable" is asserted by nothing

- **Case** XS-41 (**blocker**, P1 P4 P10), bullet 3: "The repair is stated as
  CLI-only: `loctt doctor --rebuild-index`. The exact command is shown and
  **copyable**."
- **Test**: `apps/web/src/client/settings/dataPanels.test.tsx:260`, the only
  `XS-41` tag. Its comment says *"the exact command is shown, and the UI offers
  NO rebuild button"* — but it only asserts the **absence** of a rebuild button.
  There is no assertion for the command being rendered. This is shape (b): the
  comment claims the effect, the code asserts only half of it.
- **Absence proof with positive control**: the implementation renders the
  command in a `<code data-testid="diagnostics-command" class="… select-all">`
  (`DiagnosticsPanel.tsx:56`).
  ```
  $ grep -rn "diagnostics-command" tests apps packages --include=*.ts --include=*.tsx | grep -v dist
  apps/web/src/client/settings/DiagnosticsPanel.tsx:56:  data-testid="diagnostics-command"
  ```
  One hit — the source. **No test in the repo references it.**
- **Mutation**: `MessageWithCommands` short-circuited to render the message as
  plain text (no copyable `<code>` span). `npm run build` **exit 0**.
  `dataPanels.test.tsx` → **exit 0, 11 passed**. Restored, verified.
- XS-41 bullets 2 ("surfaces the key-index check as a warning naming what
  drifted") and 5 ("explains *why* it happened") are likewise unasserted.

---

## NON-BLOCKING FINDINGS

### N1 · PRU-17 (blocker) — the remap is never executed; the test's title overstates it

`tests/ui/flow-settings-projects-users.spec.ts:231` and `:258` carry the two
`PRU-17` tags.

- Bullet 4 — "Confirming with remap moves all 12 tasks' `project` to the target
  and reports the number moved; **the tasks' existing keys are unchanged**, so
  `BACKEND-14` remains `BACKEND-14`" — is **not asserted**. The first test stops
  at `await expect(page.getByTestId("project-delete-confirm")).toBeEnabled();`.
  The delete-with-remap path is never actually run in a PRU-17 test, so the
  key-stability claim (an invariant-adjacent property) is unverified here.
- Bullet 5 — the second test is named *"cancelling leaves projects.yaml **and
  the tasks** byte-identical"* but asserts only `projects.yaml`. Shape (b):
  the title asserts more than the body.

### N2 · VUE-10 bullet 4 is unsatisfiable and unrecorded

"Sort entries survive the round trip." The DSL grammar has no sort construct:

```
$ grep -in "sort" packages/core/src/query/tokenizer.ts packages/core/src/query/parser.ts   →  (nothing)
$ grep -c "and" packages/core/src/query/parser.ts                                          →  15   (positive control)
```

`buildDsl.ts` contains no sort handling and no test asserts it. This is a
genuine "cannot be satisfied yet" case, but unlike VUE-22 it is **not recorded**
in `TEMP-RUN-WORKFLOW.md` § "Cases that cannot be satisfied yet" or in
`known-gaps.md`. It should be recorded rather than left implicit.

### N3 · The known-gap's own closing obligation was not honoured

`known-gaps.md:1975-1981` says of the three `built: false` settings sections
(General, Board columns, Timeline defaults): *"**Whichever ticket closes M4 owes
the full sweep** — assert every entry in `SETTINGS_SECTIONS` renders a real
panel, and delete the `built` flag if it has no remaining false values."*

M4.9 closed M4. The sweep was not done; `sections.ts:43,60,61` still carry
`built: false`. The gap itself is recorded, so this is the obligation going
unmet rather than a new defect. Note this interacts with B1: SET-1's own
suggested redirect target, `/settings/general`, is one of the unbuilt panels.

### N4 · Minor bullet gaps in otherwise strong tests

Recorded for completeness, not as failures — each case's principal bullets are
covered:

- **MSL-11** (blocker) — bullet 1 ("count matches the rows returned when
  filtering by that entry") is covered by the deliberately-untagged
  `flow-milestones.spec.ts:220` reconcile test, which asserts the **API body**
  rather than the rendered Settings badge. The tagged test covers bullet 3 only.
- **MSL-1** (blocker) — bullet 5 ("ordering stable across reloads") is not
  asserted directly, though MSL-16 covers undated-sorts-last with a
  discriminating two-element list.
- **MSL-34** — bullet 2 ("if the user proceeds, creation succeeds") unasserted;
  the test checks only that submit is not disabled.
- **VUE-35** (blocker) — bullet 3 (editor retains the query, offers retry) is
  client behaviour; both tags are on server tests. The server half is excellent
  and includes an explicit positive control.
- **ERR-24** — bullets 1 and 3 (grid shows no phantom row; retry does not
  duplicate) are client-side; the tag is on a server test.
- **A11Y-24** (blocker) — the four tags are on `Announcer.test.tsx`, which tests
  the component in isolation. Bullet 4 is effectively covered by A11Y-46's
  end-to-end failed-save test, which does assert rendered output.

---

## What is GOOD — this is not a weak milestone

Reported because a gate that only lists faults misrepresents the tree. The
following were audited closely and are genuinely strong:

- **`workspaceDate.test.ts`** — the noon-UTC trap (a fixed zone passing a
  timezone test) is named in a comment, *measured*, and fixed with a full-ISO
  timestamp that actually moves the answer across zones. This is the shape (d)
  hunt done correctly by the builder.
- **`flow-milestones.spec.ts`** — MSL-2 cross-checks the UI numerator against
  the real `loctt list` binary by status **category**; MSL-3 compares the
  discarded-note text **character-for-character** across list and detail.
- **`flow-onboarding.spec.ts`** — a real uninitialized server, all six routes,
  `getByRole("heading")` rather than text (so a styled div fails), and an
  explicit positive control guarding the absence assertions.
- **`server.workflow-panels.test.ts`** (SET-16) — asserts the rejection, the
  file unchanged on disk, **and** the positive control that a safe edit is
  accepted.
- **`server.view-write-failure.test.ts`** (VUE-35) — carries a test whose entire
  purpose is a positive control, explicitly labelled.
- **`SidebarPinsPanel.test.tsx`** — asserts the **request body** rather than the
  render (avoiding shape (e)), and pairs every absence assertion with a control.
- **`flow-sprints.spec.ts`** (SPR-8, SPR-33) — all four SPR-33 bullets asserted
  separately; the stale-cache clobber test (SPR-28) is a real concurrency test.
- **Honest untagging** — `flow-milestones.spec.ts:534` (MSL-35) and
  `flow-accessibility.spec.ts:105` (A11Y-2) both argue a case is unmet in a
  comment and correctly carry **no** `@verifies` tag. I checked specifically for
  the trap of an argued-unmet comment still claiming the tag: **none found.**
  `grep` for non-canonical `@verifies` lines returned only doc prose, JSDoc
  block tags, and `dist/` copies (which the scanner skips).

---

## Audit coverage

**297 M4 cases exist. 185 carry a tag. I audited 78 of the 185 against their
case prose.**

| Group | In M4 | Tagged | **Audited** |
|---|---|---|---|
| Blocker | 85 | 45 | **45 (all)** |
| Major | 155 | 99 | **28** |
| Minor | 57 | 41 | **5** |

- **All 45 tagged blockers** were read against their full case text, bullet by
  bullet, and their tagged tests read in full. This was the priority the brief set.
- **28 of 99 tagged majors** audited, selected by risk: every major whose tags
  sit on a *different layer* than the case describes (server test for a
  rendering case, unit test for a UI case), plus all MSL/ONB/SET/VUE majors.
- **5 minors** spot-checked (SET-32, SET-42, VUE-23, VUE-28, VUE-29).
- **112 untagged M4 cases** were classified but not individually audited: 40
  blockers, 56 majors, 16 minors. Cross-checked against the known-unmet list —
  the 26 GIT cases, the A11Y set, MSL-35, ONB-18, VUE-22 are all accounted for.
  I additionally verified that MSL-8 and SET-15/31/37/XS-36 (migrate) are
  **built but untagged**, matching M4.3's honest "34 of 73" claim rather than
  indicating missing work.

### What I did NOT check, and why

- **The 71 unaudited tagged majors and 36 unaudited minors.** Budget. Given
  three real findings surfaced in the majors I did sample (MSL-10, MSL-13,
  ERR-24), I would expect more bullet-level gaps in the remainder. A round 2
  should sweep them.
- **The a11y cases requiring a real screen reader or an axe dependency** (25
  itemised in M4.8). Out of scope by the flow doc's own preamble and already
  recorded.
- **The 26 GIT cases** — recorded as unbuildable (A69, `reconcile.yaml` is a
  four-field crash sentinel). I did not re-derive that; the M4.3 row's evidence
  is specific and checkable.
- **Half 2 journey walking.** I spent the budget on tag-to-case fidelity, which
  the brief named as the primary job, plus the targeted app probing that found
  B1 and B2. A journey walk of the M4 list ("Change a workflow status…",
  "Keyboard-only: reach every interactive control") has **not** been done and is
  still owed before M4 can pass.
- **Mutation of every tagged blocker.** I mutated three levers (DiagnosticsPanel
  command rendering, RemapDeleteDialog `inUse`, LabelsField archived filter).
  Each was confirmed to be the real lever by grepping the symbol first, and each
  compiled with `npm run build` exit 0.

---

## Summary

- **Blockers: 2** — SET-1 bullet 1 (`/settings` → 404); VUE-8/10/11/31/32/33
  (Advanced DSL editor is unreachable and does not ship).
- **Mis-tagged tests: 2** — MSL-13 (asserts MSL-12's mechanic), MSL-10 (asserts
  file state, not the pickers the case is about).
- **Vacuous / unguarded: 2 proven by mutation** — MSL-10 bullet 2, XS-41
  bullet 3. A third (MSL-13 bullet 1) was proven green under mutation.
- **Non-blocking: 4** — PRU-17 bullet 4 unexecuted; VUE-10's sort bullet
  unsatisfiable and unrecorded; the `built: false` sweep obligation unmet; six
  minor bullet gaps.
- **Cases audited: 78 of 185 tagged (all 45 blockers).**
- **All 8 mechanical gates: exit 0.** Every predicted count matched exactly.

**The single most important finding** is B2. Six blockers are tagged, green, and
reported as covered by `cases:coverage`, while the component they verify is
tree-shaken out of the shipped bundle because nothing imports it. The suites
cannot see this: the component tests mount it directly and the server tests
assert a response body. It is the TSK-20 failure mode with the added twist that
the tags make the tool report success — exactly what
`TEMP-RUN-WORKFLOW.md` warns cannot be caught by reading coverage output alone.
