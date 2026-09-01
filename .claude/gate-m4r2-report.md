# M4 Section Gate — Round 2 (journey walking)

Worktree `/Users/ken/Documents/PDev/loctt/.claude/gate-m4r2` at
`dfd0aa37922abc25d44200630df9000a980da71d`.

**Baseline counts all matched the prediction**, so the tree is the right one:

| Suite | Predicted | Measured | Exit |
|---|---|---|---|
| unit | 3103 passed + 1 skipped | 151+1688+88+67+1090+19 = **3103 + 1 skipped** | 0 |
| integration | 457 | **457 passed** | 0 |
| coverage | 801/937 | **801/937, 1423 tags** | — |
| UI | 647 | **642 passed + 5 failed** (4 self-inflicted, 1 known flaky) | 1 |

Verdict: **M4 is not clean.** One blocker (XS-41) is defective in the
shipped app; a second major (SET-8) sorts by the wrong values in shared
core, so both surfaces are affected; one M3 blocker (NEW-1) and one M3
major (NEW-3) are unreachable on any populated board; three majors
(PRU-44/45/46) are tagged against an API for a UI that does not exist.
Round 1's three unguarded behaviours and two mis-tags are all
**confirmed still unfixed**, and I found **three more mis-tags** of the
same shape.

The single most important finding: **XS-41, a blocker, is broken in the
shipped app and its test cannot see it** — the test asserts only the
absence of a button, and deleting the required copyable command
outright leaves all 11 tests in its file green.

---

## JOURNEY RESULTS

All journeys were walked in a real browser against the real built SPA
served by the real `loctt ui` binary, on trackers seeded through the
real CLI. Every write was verified on disk, not in the DOM.

### The round-1 defect class: is the component in the bundle?

Round 1's headline was `AdvancedQueryEditor` tree-shaken out. I checked
this structurally across the whole client and then by hand.

- Extracted all 445 `data-testid` literals from `apps/web/src/client`
  and grepped each against the shipped
  `apps/web/dist/client/assets/index-BuSq3QjH.js`. **444/445 present.**
- The one miss, `card-field-row-assignee`, is a **false positive of my
  own grep**: `ReorderableRows.tsx:66` composes it as
  `` `${testIdPrefix}-row-${rowKey(item)}` ``. Verified rendered in the
  live DOM. Not a defect.
- **No component in M4's surface is missing from the bundle.**

### 1. New tracker → `/init` → create → `/list` — PASS

Booted a server in an empty directory (`initState: "absent"`).

- `/` redirects to `/init`. The wizard renders in full.
- Typed a non-default name (`Gate Project`) and prefix (`GP-`); the
  live preview updated to "First task will be GP-1".
- Submit landed on `/list`; the new project appears in the sidebar.
- **Disk verified** — not just the redirect:
  `projects.yaml` holds `name: "Gate Project"` / `prefix: "GP-"`,
  `state.yaml` holds `prefix: "GP-"`, and `.loctt/docs/` was written
  (4 files) because I left "skip starter docs" unticked.
- The typed values reached disk unrepaired, which is the check
  vacuity shape (e) exists for.

### 2. Settings — every section by clicking — PASS

Reached Settings only via the sidebar link, then clicked all 22 nav
entries in turn (no pasted URLs).

- The footer link points at `/settings/general`, so round 1's bare
  `/settings` 404 does not arise.
- **All 22 sections navigate and render.** None blank, none 404, no
  console errors beyond a benign missing `favicon.ico`.
- Three panels are honest declared stubs — General, Board columns,
  Timeline defaults — rendering "This panel is not built yet…".
  `settings/sections.ts` marks exactly these three `built: false`.
  That is tracked scope, not a hidden defect.

### 3. List → Advanced → run → back to Basic — PASS (round 1's defect is fixed)

This is the surface round 1 found unreachable. It is now reachable.

- Clicking **Advanced** mounts `advanced-query-editor` with the
  client build intact — `dsl-input`, `dsl-run`, `dsl-help-toggle`,
  `switch-to-basic` all present.
- Typed `status = in_progress`, clicked Run: the URL became
  `?q=status+%3D+in_progress` and **the table filtered 3 rows → 1**
  (the genuinely `in_progress` task). Not a no-op.
- "Switch to basic" was disabled with the reason
  "Basic mode cannot show this query…" beforehand, became enabled
  after a parsing query, and the round-trip produced
  `?status=in_progress` — the DSL translated back into a basic chip.

### 4. Board and timeline drag — PASS, writes verified on disk

- **Board.** Cards are `draggable=false` by design (the gesture is
  pointer-based, `useBoardDrag`/`onPointerDown`, not HTML5 DnD).
  Drove a real pointer drag of T-1 from Backlog to In progress. The
  card moved, **and `task.md` on disk now reads `status: in_progress`.**
- **Timeline.** With no dated tasks it correctly explains itself
  ("None of these tasks has both a start date and a due date…") and
  lists all 3 under Unscheduled. After giving T-1 real dates a bar
  rendered and the unscheduled count dropped to 2. Dragged the bar
  +120px: **disk moved `start_date` 09-01→09-11 and `due_date`
  09-05→09-15** — exactly 10 days, duration preserved.

### 5. Sprint and milestone detail, reached by clicking — PASS

- `/milestones` lists the milestone with a real progress readout
  (`0 / 1 (0%)`) and links to the detail. Clicked through: the detail
  shows the correct task with its live status.
- Sprint detail is reached from Settings → Sprints via a **Burndown**
  link (`/sprints/<id>`). It renders the metadata header, editable
  state, the burndown ("Nothing to burn down — no tasks were in this
  sprint during its window", 15 days, starting at 0) and an embedded
  filter-bar task list.

### 6. Create a task — PARTIAL; **this journey found the important defect**

- **From the header:** works. Full modal, submitted, **T-4 exists on
  disk** with the typed title and the resolved reporter.
- **With `n`:** works. Modal opens, focus lands on `create-title`.
- **From a board column: DOES NOT EXIST on a populated board.**

Measured on a board with 4 tasks:

```
taskCount: 4, boardEmptyPresent: false, addTaskButtons: 0
```

The only "+ Add task" in the client is `BoardView.tsx:395`, rendered
**inside the `total === 0` empty state**. Any board with at least one
task has no per-column and no board-level create affordance.

---

## BLOCKERS

### XS-41 (M4, blocker) — the required CLI command is never shown

**The case requires:** "The repair is stated as **CLI-only**:
`loctt doctor --rebuild-index`. The exact command is shown and
copyable."

**What the code does.** `DiagnosticsPanel.tsx:37` turns commands into
copyable `<code data-testid="diagnostics-command">` spans, but only by
matching `/(loctt [a-z-]+(?: --[a-z-]+)*)/g` **inside the server's
check message**. The real message contains no `loctt ` prefix, so the
regex cannot fire.

**Measurement.** Induced real key drift (hand-edited `key: T-3` →
`T-999`). `loctt doctor` emits:

```
! key index: 1 stale entry/entries: T-3 → 01M1FC…JH (now has key T-999);
  1 task dir(s) not in index — rerun with --rebuild-index to repair
```

In the browser at `/settings/diagnostics`, after the check ran:

```
copyableCommands: []          count: 0
allCodeEls: ["loctt doctor"]  ← the panel's static blurb only
```

The sole `<code>` element is the panel's own sentence "The same checks
`loctt doctor` runs", which is not the remedy and is not tagged
`diagnostics-command`. **`loctt doctor --rebuild-index` never renders.**
(The "no rebuild button" bullet *is* satisfied.)

**Mutation showing the test does not catch it.** Neutered the copyable
rendering entirely (`i % 2 === 1` → `false` in `MessageWithCommands`).
`npm run build` exit **0**. `dataPanels.test.tsx`: **11/11 passed**,
including the test tagged `@verifies XS-41`. Restored; `git diff` empty.

The tagged test is vacuous by shape (c): its only assertion is the
*absence* of a rebuild button, with no positive control that the
command renders. Its comment claims "the exact command is shown" while
asserting nothing of the sort — and its mock message
(`"…rerun with --rebuild-index to repair"`) could not have rendered a
command even if it did assert one.

### NEW-1 (M3, blocker) — only two of three entry points are reachable

**The case requires** the header `+`, a board column's "+ Add task",
and `n` to open the same modal.

**What the code does.** The board's "+ Add task" only exists inside the
`total === 0` empty state (`BoardView.tsx:373-395`). On a board with
tasks there is no create affordance at all (measured above).

**Why the test passes.** `tests/ui/flow-task-create.spec.ts:85` seeds
**nothing**, so `board-empty` is showing and the third entry point
exists for the test only. Its own comment says so: "the tracker is
empty, so the board-level empty state is showing". No mutation needed —
the test cannot fail for the reason a user would.

*(M3, so strictly outside this milestone, but it is a blocker and the
board is an M4-touched surface.)*

---

## MIS-TAGS

Five, all confirmed by reading the tagged test against the case's own
bullets. All five are reported **covered** by the gate:

```
$ npm run cases:coverage -- --require PRU-44,PRU-45,PRU-46,MSL-10,MSL-13,XS-41,NEW-1,NEW-3
✓ all 8 required case(s) covered.
```

### Round 1's two — both CONFIRMED, still unfixed

**MSL-13** (major) — its only tag is
`apps/web/src/server/server.data-delete.test.ts:207`, on a test titled
*"applies `?remap_to=` to the tasks that referenced the deleted
milestone"*. That is **MSL-12's** mechanic. MSL-13's three bullets are
all about the *dialog* — a lighter confirm, no remap picker, and the
destructive button not default-focused. The server test asserts none of
them and, being a server test, cannot.

**MSL-10** (major) — both tags
(`server.data-delete.test.ts:141,166`) assert the `archived:` flag in
`labels.yaml` and that references survive. Three of the four bullets
concern **pickers and the filter bar**; the fourth ("unarchiving
restores it to pickers") is asserted as a YAML flag — vacuity shape (b),
the label asserted instead of the effect.

### Three more of the same shape — NEW

**PRU-44 / PRU-45 / PRU-46** (all major) share one tag at
`apps/web/src/server/server.test.ts:779`, whose own comment reads:

> *"The panel itself is not built (settings routes are still stubs), so
> these cover the contract the panel will consume"*

This is the trap named in the brief: a comment arguing a case is unmet
while still claiming it. PRU-44's bullet 1 requires "The prefix field is
editable, not disabled". **Measured in the live Settings → Projects
panel:**

```
inputs: [ {val:"Tasks", disabled:false},
          {val:"tasks", disabled:true},
          {val:"T-",    disabled:true} ]   ← prefix is DISABLED
buttons: [project-archive-…, project-delete-…, project-create-open]
```

There is no prefix-edit control on any row, so bullets 1–4 (editable
field, blast-radius confirm, renamed list, old key resolving via
search) are all unreachable. The API works; the UI does not exist.

*Partial credit:* **PRU-45 is genuinely satisfied for project
*creation*.* Typing the colliding prefix `T-` into the new-project form
renders inline *"Prefix T- is already used by "Tasks". Prefixes must be
unique across the tracker."* and disables submit — refused at the
field, nothing written. It is only the *rename* path that is missing.

### A sixth, self-declared: NEW-3

`tests/ui/flow-task-create.spec.ts:775` carries `@verifies NEW-3` while
its comment states bullet 1 is **"unenactable"**, that `initialStatus`
is "plumbed through provider and modal and no caller supplies it", and
that neutering the pre-fill "left all 44 tests in this file green". The
tag still makes the gate count NEW-3 as covered. Honest comment,
misleading tag.

---

## THE THREE UNGUARDED BEHAVIOURS — all CONFIRMED, all still unfixed

Each mutation compiled (`npm run build` exit 0), was verified to be the
real lever, and was restored with `git diff` empty afterwards.

**1. Archived labels forced into the picker — NOT CAUGHT.**
Removed `l.archived !== true &&` from
`apps/web/src/client/task/editors/LabelsField.tsx:92`.
Build exit 0. **`apps/web` unit suite: 1090/1090 passed.**
Verified the mutation is real, in the browser against the rebuilt
bundle: the label picker on T-1 went from `["keepme"]` to
`["keepme", "gonearchive"]` — a direct violation of MSL-10 bullet 2,
with `keepme` as the positive control. The *behaviour is correct*
unmutated; it is simply unguarded.

**2. The remap picker forced onto unreferenced deletes — NOT CAUGHT.**
Changed `const inUse = count > 0;` to `const inUse = true as boolean;`
in `RemapDeleteDialog.tsx:63` (`as boolean` per the inferred-type
trap). Build exit 0. **All 66 settings tests passed** — round 1's exact
count. In the browser, deleting a 0-reference milestone then showed the
full picker: *"0 tasks currently use orphan-ms. What should happen to
those 0 tasks?"* — MSL-13 bullet 1 violated, nothing red.

**3. The copyable CLI command removed — NOT CAUGHT.** See XS-41 above.
11/11 `dataPanels` tests green with the rendering deleted outright.

---

## FURTHER DEFECT — SET-8 (major): custom-enum weights do not sort

**The case requires** (bullet 2): "Setting weights XS=1, S=2, M=3, L=5
and sorting the list by that field orders rows by **weight, not
alphabetically**."

**What the code does.** `packages/core/src/query/list.ts`,
`compareTasks` applies the weight map **only** under
`if (field === "priority")`. A custom enum field falls straight through
to a string comparison on the raw value key.

**Measurement.** Declared `size` with weights `xs:1, m:3, l:5` — chosen
so weight order (XS, M, L) and alphabetical order (l, m, xs) disagree.
Set the values through the CLI and **verified them on disk**
(`size: l`, `size: xs`, `size: m`):

```
$ loctt list --sort fields.size --dir asc
T-1  task-L     ← weight 5
T-3  task-M     ← weight 3
T-2  task-XS    ← weight 1        (alphabetical: l, m, xs)

$ loctt list --sort fields.size --dir desc   → XS, M, L  (clean reverse)
```

The sort works — on the wrong values. The web API agrees, because the
defect is in shared core:

```
GET /api/tasks?sort=fields.size&dir=asc → [T-1 'l', T-3 'm', T-2 'xs']
```

**Why the test misses it.** `flow-settings-workflow.spec.ts:595` covers
bullets 1 and 3 properly (the sub-table is editable, the weight reaches
`workflow.yaml` as `value: 1`, and the panel names each fallback). For
bullet 2 it asserts only `data-sort-basis="weight"` — an **attribute on
the settings panel**. Vacuity shape (b): the label is asserted, the
effect is not. Nothing in the test ever sorts a list.

*Two false starts, recorded per the brief:* my first attempt appended a
duplicate `custom_fields` key (`custom_fields: []` already sat at line
77) and `workflow.yaml` failed to parse; my second used `fields.size`
as the CLI field name and every `set` was rejected. Both were visible
only because stderr was not suppressed. The result above is from the
third attempt, with the writes confirmed on disk first.

## NON-BLOCKING FINDINGS

- **SET-12 bullet 2 is untested but correct.** No test asserts "changes
  every board card on the next render". Verified by hand: card T-1
  showed `[key, due_date]`; after hiding due_date in Settings the
  user's `settings.yaml` became `[key, priority, assignee, labels]` and
  the board card re-rendered as `[key]` only. Bullet 3 (per-user
  isolation) is also unasserted. Coverage gap, not a defect.
- **SET-17 bullet 4 tail unasserted.** The test takes the remap branch,
  so "after confirming, they do [appear in Diagnostics]" is never
  exercised. The rest of SET-17 is well covered, including a
  cross-surface CLI check.
- **MSL-25 bullet 2 half-covered** — "excluded from … pickers" is not
  asserted (the default-view exclusion is).
- **No `aria-invalid` / `aria-describedby`** on the project-prefix
  field carrying a validation message. Relevant to A11Y-23, which is
  already on the known-unmet list.

## Tests that are *good* (checked, and they hold up)

Worth recording so the weak ones stand out as the exception:

- **SPR-12** — all three bullets, discriminating values (remaining `8`,
  not a task count of `2`; drops to `3` on completing the weight-5
  task), asserted against the rendered chart.
- **VUE-9** — content checked against the *real tokenizer*, the Esc
  bullet tested on the mounted editor, and an explicit **POSITIVE
  CONTROL** guarding its absence assertion.
- **MSL-25** — documents a mutation-verified fix for vacuity shape (c),
  ordering the positive control first because `toHaveCount(0)` passed
  trivially before rows rendered.
- **ONB-16** — copy assertions, negative assertions with a
  discriminator, and a disk check.
- **MSL-24** — verified live: dangling milestone id renders as
  *"01M1FC… — not in the current config"*, the Milestones view shows no
  phantom row, and the exclusion is stated ("1 task names a milestone
  that milestones.yaml does not define… : T-1").

---

## UI suite — 642 passed, 5 failed, and **I caused four of the five**

`npx playwright test --config tests/ui/playwright.config.ts
--workers=1` → **642 passed, 5 failed, exit 1**, 27.0m. 647 total,
matching the predicted count.

I ran the suite concurrently with mutation work. That was a mistake,
and it is exactly the hazard the brief names ("never mid-suite, which
empties `apps/cli/dist/` and fails unrelated specs with ENOENT").
Reading the failure text rather than trusting the isolated re-runs is
what caught it:

| Spec | Failure mode | Cause |
|---|---|---|
| A11Y-25 | `ENOENT … apps/cli/dist/index.js` in `seed()` | **mine** — rebuild emptied `apps/cli/dist/` |
| LST-29 | `ENOENT … apps/cli/dist/index.js` in `seed()` | **mine** — same |
| XS-19 | `getByText('Still open')` not found | **mine** — seeding silently produced no tasks |
| SET-33 | `workflow-panel-error` not found | **mine** — same window |
| SPR-6 | count `"0"`, expected `"1"` after a drag | **known flaky** (on the list) |

Two failed with the ENOENT verbatim, which is unambiguous. XS-19 and
SET-33 carry ordinary "element not found" text but fall in the same
window and depend on a seeded tracker.

**Verified on the restored, stable tree** — all four non-flaky
failures re-run together and pass:

```
✓ A11Y-25 (1.8s)   ✓ XS-19 (1.7s)   ✓ LST-29 (2.4s)   ✓ SET-33 (0.9s)
4 passed (8.3s)
```

**So the UI suite is clean apart from the known-flaky SPR-6**, and the
earlier draft of this report — which claimed "I did not cause these"
on the strength of isolated passes — was wrong. A file-level or
isolated pass really is not evidence; only the failure text was.

---

## Coverage of this audit

- **Cases audited in depth: 24** of the 185 tagged — XS-41, NEW-1,
  NEW-3, PRU-44, PRU-45, PRU-46, MSL-10, MSL-13, MSL-24, MSL-25,
  SET-1, SET-5, SET-8, SET-12, SET-13, SET-17, SET-18, SET-19,
  SPR-12, VUE-9, ONB-4, ONB-5, ONB-7, ONB-16.
- Round 1 covered 78; the union is roughly 95 of 185, weighted to
  blockers (round 1) and majors (this round).
- Beyond those, every M4 surface was exercised end-to-end by the six
  journeys, which is broader than the case list but shallower per case.

## What I did NOT check, and why

- **A clean full UI run.** The suite completed (642/647) but I
  contaminated four specs by rebuilding mid-run. Each was re-verified
  individually on the stable tree, and a fresh uncontaminated full run
  would be worth having before sign-off — I did not have time for the
  second 27-minute pass.
- **e2e (21 specs).** Not run — one suite at a time, and the UI suite
  consumed the budget.
- **The remaining ~123 tagged M4 blocker/major cases.** Prioritised
  majors that round 1 skipped and cases whose bullets describe *render*
  behaviour, since those are the ones server and unit tests structurally
  cannot observe.
- **The 24 known-unmet a11y cases, ONB-18/19, VUE-22, MSL-35,
  SPR-35's placement bullet, and the 26 GIT cases** — excluded by
  instruction. (Noted only in passing: ONB-19 does carry tags despite
  being on that list.)
- **Multi-user behaviour** (SET-12 bullet 3, "a second user's board is
  unaffected") — one identity in the scratch trackers.
- **Mutation-testing every finding.** Mutated three levers; the other
  findings rest on direct measurement of the shipped app, which for
  "does this render" questions is stronger evidence than a mutation.

## Tree hygiene

No commits, no `git stash`. Three files were mutated
(`LabelsField.tsx`, `RemapDeleteDialog.tsx`, `DiagnosticsPanel.tsx`),
each `cp`-backed up first, each restored, each restore verified by an
empty `git diff --stat` plus re-reading the restored line. Final
`npm run build` reproduces the original bundle hash
`index-BuSq3QjH.js`, and `git status` is clean. All test data was
written to scratch trackers outside the repo.
