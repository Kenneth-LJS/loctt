# M2 section gate — round 6

**Worktree** `/Users/ken/Documents/PDev/loctt/.claude/gate-m2r6` pinned at
`8144805f63a74c45278690803ba55d53c152a0d1`.
**Tree-identity check passed before any conclusion was drawn:** unit
`147+1647+88+67+837+19 = 2805 passed, 1 skipped`; coverage
`617/937 cases tagged by 1073 @verifies tag(s)`. Both match the predicted
figures exactly, so the measurements below are from the right tree.

Tree left clean. Every mutation was `cp`-backed up, restored, and the
restore verified by `git status --porcelain` + `git diff --stat` (both
empty) and, for the load-bearing one, by re-running the suite to green.
`apps/web/dist` was rebuilt from pristine source after the last restore.
No commit, no stash.

---

## Audit coverage

**171 M2 cases** total (from the `Cases:` lines of tickets M2.1, M2.2,
M2.3, M2.4, M2.5, M2.6 — lines 244, 282, 300, 395, 412, 438 of
`TEMP-WEB-TICKETS.md`): **70 blocker, 71 major, 30 minor.**

| | Audited |
|---|---|
| Blocker | **70 / 70** — every one, tag-to-prose |
| Major | ~35 / 71 — the CMT and REL majors, plus the 11 untagged |
| Minor | ~8 / 30 — only those adjacent to an audited blocker |
| **Total** | **~113 / 171** |

"Audited" means: the case's full prose was read from
`docs/dev/ui-test-cases/`, the test carrying its `@verifies` tag was read
in full including fixture setup, and the two compared bullet by bullet.
Four findings were then re-verified by me personally with mutation or
grep-with-positive-control; the rest rest on that reading.

**Not checked, and why:** the majority of M2.2/M2.3 *majors* and most
*minors* (TSK-26/28/30–33/36/37/41/42/49, XS-4/7/8/26/27/42/46/54/57,
ERR-43, VUE-30, TSK-16/18/25/38/40, ERR-27, XS-13/14). Blockers were
prioritised as instructed and the budget went to mutation-verifying the
four highest-value hits rather than to a thinner pass over more cases.
I did not re-derive the closed items (REL-49, K10, the round-4 nine,
round-5's TSK-21 half, `moveTaskToProject` cross-surface); no contrary
evidence appeared.

---

## BLOCKERS

### 1. CMT-31 is vacuous at HEAD — a mutation-catching pin was deleted and the comment claiming it is present was left behind

Severity: the case itself is minor, but this is filed as a blocker
finding because a *known, documented, previously-fixed* vacuity has been
silently reintroduced into committed source, and the surrounding prose
actively misreports the state of the test.

`tests/ui/flow-activity.spec.ts:766-767`:

```
  test.describe("in a browser far from the workspace", () => {
    // pin removed (simulating the vacuous original)
```

The doc comment immediately below it (lines 771-784) still asserts the
opposite, in bold: *"**The browser's zone is pinned**, and that is
load-bearing rather than tidiness… Measured: with the zone unpinned,
replacing the workspace timezone with
`Intl.DateTimeFormat().resolvedOptions().timeZone` left this test
green."*

`docs/dev/known-gaps.md:1008-1040` records this exact vacuity being found
and fixed during M2.4b mutation testing, and prescribes the fix:
`test.use({ timezoneId: "America/Los_Angeles" })`.

**Measurement — absence, with positive control:**

```
grep -rn "timezoneId" --include="*.ts" tests apps packages   → no matches
grep -rn "test\.use(" tests/ui/*.ts                          → no matches
grep -n "@verifies TSK-50" ... tests apps  → flow-tasks.spec.ts:679  (control passes)
node -e 'Intl.DateTimeFormat().resolvedOptions().timeZone'   → Asia/Singapore
```

The host is UTC+8 — precisely the configuration known-gaps.md says cannot
discriminate. And the removal is committed, not a stray working-tree
edit: `git show HEAD:tests/ui/flow-activity.spec.ts | grep -n "pin removed"`
→ `767`.

**Mutation proving the test does not catch it.** In
`apps/web/src/client/activity/ActivityPanel.tsx:75`, the workspace-zone
read was replaced with the browser zone on both branches — the whole
mechanism deleted, exactly the mutation known-gaps.md names:

```ts
const timezone = calendar === undefined // MUTATION: whole mechanism deleted
  ? Intl.DateTimeFormat().resolvedOptions().timeZone
  : Intl.DateTimeFormat().resolvedOptions().timeZone;
```

`npm run build` → **exit 0** (valid mutation; `calendar` still referenced,
no TS6133). `npx playwright test flow-activity.spec.ts` → **exit 0, 15
passed**, CMT-31 among them:

```
✓ 9 flow-activity.spec.ts:787:5 › CMT-31: day headings follow the
    workspace timezone, per day (2.7s)
```

An activity feed that ignores `calendar.yaml` entirely and reads the
browser's clock turns nothing red. Restored; `flow-activity` re-verified.

**Mitigation:** the day-bucketing *logic* is genuinely covered by
`apps/web/src/client/activity/days.test.ts:43,57,81`, which pins both
zones explicitly and requires them to differ. The blocker-level CMT-13
timezone bullet is likewise safe via `days.test.ts:17,26` and
`group.test.ts:168`. What is unprotected is the browser-level claim —
that the *rendered feed* follows the workspace rather than the reader.

**Fix:** restore the `test.use({ timezoneId: "America/Los_Angeles" })`
line the comment and known-gaps.md both describe. One line.

---

## MIS-TAGGED TESTS

### 2. `flow-tasks.spec.ts:963` — tagged `@verifies TSK-21`, titled `TSK-44`, actually asserts **TSK-51**

This is the round-5 precedent recurring, and it is the most important
finding of the round.

- **The tag** (line 948) says `TSK-21` — *"Move to project reassigns the
  task and its key."*
- **The title** (line 963) says `TSK-44` — the minor case about
  *cancelling* dialogs.
- **The body** asserts neither. It asserts that a `200` carrying a
  non-empty `failed[]` is not mistaken for success: the dialog stays
  open, the reason is named, the URL and key chip are unchanged, and
  `frontmatterOf(...) === before`.

That is **TSK-51** verbatim — *"A failed move to project does not leave a
half-moved task"* — whose bullets it matches one for one:

| TSK-51 bullet | assertion |
|---|---|
| "retains its original project and its original key" | `expect(await frontmatterOf(tracker.root, key)).toBe(before)` (:1013) |
| "names the destination project and the reason" | `toContainText("the destination project is archived")` (:1000) |

**Measurement — TSK-51 has no tag anywhere**, with positive control:

```
grep -rn "TSK-51" --include="*.ts" --include="*.tsx" tests apps packages tools
   → (nothing)
grep -rn "@verifies TSK-50" --include="*.ts" tests apps
   → tests/ui/flow-tasks.spec.ts:679          (control: the grep works)
```

`cases:coverage --milestone M2` accordingly lists **TSK-51 (major) as
uncovered**, while its behaviour is in fact well covered — and credits
TSK-21 with three tests when one of them is not about TSK-21.

**Mutation proving what the test actually guards.** In
`apps/web/src/client/api/hooks/useTaskMutations.ts:101`, the `failed[0]`
check was disabled:

```ts
if (failure !== undefined && false) { // MUTATION: failure check disabled
```

`npm run build` → exit 0. `npx playwright test flow-tasks.spec.ts` →
**exit 1, exactly one failure**:

```
✘ 17 flow-tasks.spec.ts:963:3 › TSK-44: a move the server reports as
     failed keeps the dialog open and names it
     Error: expect(locator).toContainText(expected) failed
18 passed, 1 failed
```

Every other TSK-21- and TSK-44-tagged test stayed green, including the
real TSK-44 at `:583` and the move-success test at `:1027`. So `:963` is
the sole guard of the TSK-51 behaviour, and it is filed under two other
case IDs. Restored; suite re-verified 19/19 green.

**Fix:** retag `:963` as `@verifies TSK-51` and correct its title. Per
instruction I have not re-tagged it myself.

### 3. `flow-tasks.spec.ts:1027` — tagged `TSK-21`, titled `TSK-44`

Same file, same stale-title defect, benign direction: the tag is right
(it is the Move success path), the title is wrong. Worth fixing in the
same pass so the file stops showing three "TSK-44" tests.

### 4. `flow-list.spec.ts:2479` — `@verifies TSK-1` on a test that asserts none of TSK-1's five bullets

An M1 leftover inside `test.describe("LST — sort validation and the
detail stub")`, from when `/tasks/$key` was an unbuilt stub. It asserts
only that the literal string `$key` is absent and the key appears
somewhere unscoped — vacuity shapes (b) and (c). TSK-1 is properly
covered at `flow-tasks.spec.ts:104` (breadcrumb label, column geometry,
ULID regex, cold-paste), so the case is safe; the tag is redundant and
inflates the count.

### 5. REL-31 — a core unit test standing in for a UI drag case

`packages/core/src/rank/reorder.test.ts:170` is the only tag. The test is
strong *as a core test* (guards against vacuity with
`expect(rebalanced).toBe(true)`), but REL-31's premise is a 50-item
ranked group reordered by dragging; the test calls
`reorderRelationship()` directly with **four** linked children and its own
comment (lines 203-217) records that it deliberately substituted a
different scenario because the case's literal one is a no-op. Bullet 5
("no user-visible error or flash") is unreachable from a unit test and
unasserted. The rank *mechanism* is covered; the *UI case* is not.

---

## NON-BLOCKING findings

### 6. REL-8 bullet 3 is asserted in the test title only — and `lookupExact` is guarded by nothing

Case bullet: *"Typing a former key from a task's `key_history` resolves to
the task it now belongs to."* The test
(`tests/ui/flow-relationships.spec.ts:482`) is titled *"…matches key,
title **and a retired key**…"* but seeds two plain tasks (`:484-486`),
never rekeys anything, and never types a retired key. `viaRetiredKey` is
never asserted either.

This matters because the code exists on purpose: `decisions.md` A21
records that core's `text ~` alias does not search `key_history`, so a
`lookupExact` fallback was added *specifically for this bullet*, with the
revert note "REL-8's third bullet becomes unmet."

**Measurement:**
```
grep -rn "lookupExact" --include="*.ts" --include="*.tsx" tests apps packages
   → apps/web/src/client/api/hooks/useTaskSearch.ts:53   (definition)
   → apps/web/src/client/api/hooks/useTaskSearch.ts:101  (call site)
```
No test file references it.

**Mutation:** `lookupExact` forced to return `undefined` always
(`if (res.frontmatter !== undefined) return undefined;` — the request is
still issued, so the symbol remains the lever). `npm run build` → exit 0.
`npx playwright test flow-relationships.spec.ts` → **exit 0, 30/30
passed**. The entire retired-key fallback can be deleted and the whole
relationships UI file stays green. Restored and verified.

### 7. XS-11 bullet 3 is contradicted by the build, and the design call is unrecorded

Case bullet 3: *"If the two edits do not overlap, the result contains
both the user's text and the CLI's paragraph; the user is told a merge
happened rather than it being silent."*

The build instead raises the conflict surface with a "keep both" option.
`apps/web/src/client/editor/BodyConflictDialog.tsx:41-45` gives a sound
reason — no common ancestor for a three-way merge, and a silent
line-level merge is how conflicting edits get lost. The XS-11 test at
`flow-task-body.spec.ts:344` asserts that conflict outcome, i.e. it
asserts the opposite of the case's third bullet.

I verified bullet 1 is genuinely met: the case permits *"or a conditional
write carrying a base version"*, and `expectedToken` is exactly that.
`grep -n "apiClient\.\(get\|post\)" apps/web/src/client/editor/useBodyAutosave.ts`
returns a single line (172, the POST) — there is no GET on the write
path, which is fine under the case's own alternative.

So this is a **deliberate, defensible deviation on a blocker case that
was never written down.** CLAUDE.md requires it in `decisions.md` § 8
with a revert path.

**Measurement — absence, with positive control:**
```
grep -n "keep both\|three-way\|XS-11" docs/dev/decisions.md   → nothing
grep -n "keep both\|three-way\|merge"  docs/dev/known-gaps.md → nothing
# controls (same greps find real content in the same files):
grep -n "A56" docs/dev/decisions.md   → 3785
grep -n "XS-12" docs/dev/known-gaps.md → 1268
grep -c "" docs/dev/decisions.md → 3923 ; known-gaps.md → 1533
```

**Recommendation:** record the call in § 8, or de-tag XS-11. Do not
silently leave a blocker scored green by a test asserting a different
outcome than the case describes.

### 8. REL-16 bullet 1 is knowingly unbuilt and cites a record that does not exist

`flow-attachments.spec.ts:869-874` states that PNGs render a family glyph,
not an inline thumbnail, that *"the case's first bullet is not satisfied
by this build"*, and refers the reader to known-gaps. There is no REL-16
entry there — `grep -n "REL-" docs/dev/known-gaps.md` yields REL-5, 28,
30, 32, 36, 46 only, and `thumbnail` appears nowhere in known-gaps.md or
decisions.md. A blocker ships knowingly incomplete, tagged green, with an
empty citation.

### 9. ERR-12's UI behaviour is covered under someone else's tag

`useBodyAutosave.test.ts:325` (the only ERR-12 tag) asserts the hook
relays the message and preserves the buffer, but never that a control
renders or that the message reaches the screen. The adjacent TSK-48 UI
test (`flow-task-body.spec.ts:491`) *does* assert
`toContainText("No space left on device")` and a visible `save-retry` —
the mirror of finding 2. Adding `@verifies ERR-12` at `:491` closes it
with no new test.

### 10. Unasserted bullets on covered blockers

Recorded for the ticket owner; each is a real gap, none is vacuity:

- **TSK-21** bullet 3 — `key_history` appended and the old key still
  resolving via `/tasks/<old-key>` is never asserted at a TSK-21 site.
- **TSK-35 / XS-12** bullet 4 — only `conflict-choice-mine` is ever
  clicked (grep: lines 431, 485 only). "Keep theirs" and "keep both" are
  asserted as *dialog text*, never as a resulting file.
- **CMT-10** bullet 4 — "Mentions me" after a rename; the filter is
  deliberately inert (`builtinFilters.ts:29`), so this is unbuilt, not
  merely untested.
- **CMT-7** — the two `users.test.ts:75,87` tags assert the
  disambiguation bullet, not filtering. Filtering itself rests solely on
  `flow-comments.spec.ts:627`, which does discriminate (`toHaveCount(2)`
  plus two `not.toContain`), so the case is covered.
- **XS-58** bullet 2, **TSK-54** bullet 3, **XS-51** bullets 1 and 3,
  **TSK-50** bullet 4 (retry-after-failure never exercised),
  **TSK-23** bullet 5, **REL-18** bullet 4's HEIC clause (no HEIC
  fixture; `imageFixture` supports jpeg/png/gif/webp only).

---

## VACUOUS TESTS

One, measured:

| File | Line | Test | Mutation that left it green |
|---|---|---|---|
| `tests/ui/flow-activity.spec.ts` | 787 | `CMT-31: day headings follow the workspace timezone, per day` | `ActivityPanel.tsx:75` workspace-zone read replaced by browser zone on both branches — build exit 0, `flow-activity` exit 0, 15/15 passed |

Two near-misses that are redundant rather than vacuous: the `TSK-1` tag at
`flow-list.spec.ts:2479` (finding 4) and the `ERR-3` tag at
`fieldFailure.test.ts:127`, which asserts `dataState === "not_saved"` on
an object but no message text — ERR-3's real coverage is the UI test at
`flow-task-failure.spec.ts:557`, which is thorough.

### Positively verified as NOT vacuous

- **REL-18** — the round-3 `void`-and-discard shape is genuinely fixed.
  `flow-attachments.spec.ts:1101-1105` now does two unavoidable
  comparisons (`sha256` equality and `Buffer.compare(...) === 0`), plus
  decoded dimensions via sharp, and closes shape (e) by wrapping
  `window.fetch` to assert **what the client sent** (`:1113-1115`), not
  only what landed.
- Shape (e) was searched for across all audited families and found
  **nowhere else**. The tests that read frontmatter consistently pair the
  disk read with a UI-observable effect, and `flow-task-failure.spec.ts:230-236`
  goes further, asserting the request payload's keys are exactly
  `["field","value"]` against 17 forbidden names.
- Shape (f) — no other fetch-then-discard survives.
- Shape (c) is used widely but almost always paired with a positive
  control, with comments saying so.
- No `toBeDisabled()`-in-`<label>` hazard: `OptionPicker.tsx:181-186`
  renders options as `<button role="option" disabled>`, so no retargeting
  is possible, and TSK-7/TSK-46 assert the clicked ULID landed rather
  than a label.

---

## What I did not check

- The M2.2/M2.3 majors and minors listed under Audit coverage above.
- The 16 untagged M2 cases beyond confirming they are untagged — they are
  already visible to `cases:coverage`, so they are a scheduling question,
  not a fidelity one. (Note **TSK-51 is in that list wrongly**, per
  finding 2 — its behaviour is covered.)
- `npm run test:integration` and `test:e2e` were not run; the unit suite
  and three UI files were, all at the predicted counts. No integration or
  e2e claim appears above.
- No flaky-list test was reported as a regression; the only red I
  produced was mutation-induced and reverted to green.

---

## Verdict

Nothing here contradicts the M2 build's substance — the suite is
unusually disciplined, and several files defend against exactly the
shapes this gate hunts. But **the sampling problem the round was called
to address is real and recurred**: a blocker-adjacent major (TSK-51)
again has good coverage filed under the wrong ID, and a previously-fixed
vacuity (CMT-31) has been reintroduced into committed source with its
justifying comment left intact and now false.

Recommended before the gate closes: restore the CMT-31 timezone pin;
retag `flow-tasks.spec.ts:963` to TSK-51 and fix the two stale titles;
add the `@verifies ERR-12` tag at `flow-task-body.spec.ts:491`; record
the XS-11 merge decision in § 8 or de-tag it; write the REL-16 known-gaps
entry the test already cites.
