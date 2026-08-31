# M2 section gate — round 7

**Worktree** `/Users/ken/Documents/PDev/loctt/.claude/gate-m2r7` pinned at
`23a7c0e039df9506b8f710666048792c4e27db19`.

## Tree-identity check — passed before any conclusion was drawn

Every predicted figure matched exactly, each judged by **exit code**, not
by grepping output:

| Suite | Predicted | Measured | Exit |
|---|---|---|---|
| unit | 2807 + 1 skipped | `147+1647+88+67+839+19` = **2807 passed, 1 skipped** | 0 |
| UI | 507 | **507 passed** (5.8m) | 0 |
| integration | 439 | **439 passed** | 0 |
| e2e | 21 | **21 passed** | 0 |
| coverage | 618/937 | **618/937 by 1074 `@verifies` tags** | 0 |

(Unit is +2 over round 6's 2805, consistent with the fixes landed since.)

**Process note worth recording.** My first attempt at the UI suite used a
bare `npx playwright test`, which picked up vitest files and produced
`Vitest failed to find the current suite` noise. The correct invocation is
`npm run test:ui` (`--config tests/ui/playwright.config.ts`). Both
mutation runs below were confirmed to have matched **`Running 1 test`** —
not zero — so neither is the `-g "TSK-20"` failure mode that wasted a
previous pass.

Tree left clean: `git status --porcelain` empty, `git diff --stat` empty,
no untracked files, HEAD still `23a7c0e`. Both mutated files were `cp`
backed up and restored, each restore verified by grepping the restored
line back. `apps/web/dist` was rebuilt from pristine source afterwards.
No commit, no stash.

---

## Audit coverage

**171 M2 cases** (from the `Cases:` lines of M2.1–M2.6, lines 244, 282,
300, 395, 412, 438 of `TEMP-WEB-TICKETS.md`): **70 blocker, 71 major,
30 minor** — identical to round 6's count, independently rederived.

| | This round |
|---|---|
| The 30 cases round 6 named as skipped | **30 / 30**, tag-to-prose, bullet by bullet |
| Uncovered-case sweep | **16 / 16** (all M2 cases with no tag at all) |
| Round 6's five fixes + A59 | **6 / 6** independently re-verified |
| Cross-surface (K10 body precondition) | verified across core / CLI / MCP / web / docs |
| Mutation-verified | **2** load-bearing mechanisms |

**Cumulative with round 6: ~143 of 171** (round 6's 113 plus the 30 it
named as skipped, minus overlap in the uncovered sweep).

### Correction to round 6's stated coverage

Round 6 reported **"Blocker 70/70 — every one"**. That is not accurate.
Its own "not checked" list contains **five blockers**: **XS-4, XS-7,
XS-8, XS-13, XS-57**. This is a reporting error in the round-6 report,
not a defect in the code. I audited all five this round; all five hold
(see below). No blocker is now unaudited across the two rounds.

### What I did NOT check, and why

- The ~83 M2 cases round 6 audited and cleared that I did not re-derive
  (its blocker sweep minus the five above, and the CMT/REL majors). Round
  6's method was sound where I could check it — its five findings were
  real and its fixes verified — so re-running it would have bought less
  than the unaudited 30 plus the uncovered 16.
- Deep bullet-level fidelity on the 11 uncovered majors listed below.
  Once a case has no tag at all, the finding is established; confirming
  precisely which bullets are unmet is build work, not gate work.
- I did not mutation-test every case I read. Two mutations were spent on
  the two highest-value mechanisms; the rest rest on reading.

---

## BLOCKERS

**None.**

All five previously-unaudited blockers (XS-4, XS-7, XS-8, XS-13, XS-57)
have a `@verifies` tag, and in each case the test beneath the tag
genuinely exercises the case rather than its title.

Two were mutation-verified rather than merely read:

**XS-4 — verified by mutation.** The case requires that a background
refetch not clobber a field the user has open. The test's own comment
names the lever: the guard in `TextField.tsx` that suppresses
`setDraft(value)` while `editing`.

- Mutation: `apps/web/src/client/task/editors/TextField.tsx:68`,
  `if (!editing) {…}` → `if (true) {…}`.
- `npm run build` exit **0** with the mutation in place (rule 1), and the
  Vite client bundle was rebuilt, so it reached what Playwright serves
  (rule 3). The symbol was confirmed present in the edited file (rule 2).
- Result: **red**, on the intended assertion —
  `expect(input).toHaveValue("13")` received `"99"`, i.e. the CLI's value
  overwrote the user's open draft, exactly the failure XS-4 forbids.

**TSK-30 / XS-27 — verified by mutation.** A single test carries both
tags, which is the classic shape of one case riding on another's work.

- Mutation: `OptionPicker.tsx:120`,
  `const unrecognized = value !== undefined && current === undefined;` →
  `const unrecognized = false as boolean;` (the `as boolean` form, so the
  inferred type is unchanged — rule 1).
- Build exit **0**. Result: **red** — `meta-unrecognized-team` not found.

The unaudited set is, on reading, unusually well constructed. Several
tests carry explicit anti-vacuity reasoning that is *correct*, not
decorative — XS-7 seeds a deliberately populated task because a sparse
one could not discriminate a field-level write from a whole-object PUT;
XS-42 sends the `X-Loctt-Client` header because without it a 403 would
masquerade as the immutability rejection; TSK-37 delays the *response*
rather than the request, correctly reasoning that delaying the request
would reorder server-side writes and test the wrong thing; TSK-40
navigates in-app rather than via `page.goto` because a hard load
refetches everything and would make a leaked buffer indistinguishable
from a clean one.

### A note on mutation rule 4 — checked, does not apply

Three sites assert `toBeDisabled()` on `getByRole("option")`
(`flow-task-meta.spec.ts:569, 570, 1113, 1114`). Playwright's retarget
trap applies to a native `<option>` inside a `<label>`. These are
`<button type="button" role="option" disabled>` elements
(`OptionPicker.tsx:180-186`), which *are* on Playwright's control list,
so `toBeDisabled()` evaluates the button itself. The assertions are
sound. The repo already documents this trap correctly at
`flow-tasks.spec.ts:913`.

---

## MIS-TAGGED TESTS

**None found.** Every tag I checked names a case the test beneath it
actually exercises.

---

## VACUOUS TESTS

**None found.** No test I read fetched evidence and discarded it (the
REL-18 pattern), asserted a label in place of an effect, or relied on
seeding that could not discriminate. I specifically searched the autosave
and body-conflict area — where vacuity shape (e), "the file on disk is
right because a layer in between repaired what the client sent", would
live — and found the opposite: `useBodyAutosave.test.ts` asserts on
`api.writes[…].body`, i.e. **what was sent**, not only what landed.

---

## NON-BLOCKING FINDINGS

### F1 · Fourteen M2 cases are uncovered *and* undocumented (major)

`cases:coverage --milestone M2` lists 16 uncovered cases. Of those, only
**CMT-18** (`TEMP-RUN-WORKFLOW.md:678`) and **TSK-43** are recorded
anywhere. The other **fourteen appear in no document at all** — not
`known-gaps.md`, not `decisions.md`, not `TEMP-RUN-WORKFLOW.md`
(including its § "Cases that cannot be satisfied yet", which is the
designated home for exactly this).

Measurement, with positive control:

```
grep -n "<ID>" docs/dev/known-gaps.md TEMP-RUN-WORKFLOW.md docs/dev/decisions.md
  → 0 matches for each of the fourteen
positive control: REL-16 → 2 matches in known-gaps.md
positive control: CMT-18 → 2 matches in TEMP-RUN-WORKFLOW.md
```

| Case | Sev | Title |
|---|---|---|
| CMT-20 | major | 80 comments render without collapsing the page |
| CMT-23 | major | A comment posted from another surface appears in the UI |
| CMT-24 | major | Editing a comment deleted elsewhere fails cleanly |
| CMT-25 | major | 300 history entries paginate correctly |
| CMT-35 | major | An edit of another user's comment succeeds and is attributed |
| ERR-23 | major | A multi-step failure says which step failed |
| REL-14 | major | Reordering into first and last position works |
| REL-47 | major | A failed upload leaves no partial file and says so |
| TSK-39 | major | A task deleted underneath an open detail view is reported |
| XS-10 | major | Optimistic updates are reconciled against the server response |
| XS-65 | major | A conflict surface that itself fails leaves the file untouched |
| TSK-27 | minor | A very large body loads and edits without freezing |
| TSK-55 | minor | Inline label creation failing does not attach a phantom label |
| TSK-56 | minor | A save blocked by schema migration is explained |

No blockers among them. This is filed non-blocking because M2's blockers
are covered and the run's own rule is that an uncovered case is a
scheduling question — but *silently* uncovered is different from
scheduled, and fourteen of these are currently invisible to anyone
reading the docs.

### F2 · At least two of the fourteen are tagging gaps, not build gaps

Worth separating, because the fix differs and the coverage number
under-reports what is actually verified.

- **TSK-39.** Its scenario is exercised at `tests/ui/flow-tasks.spec.ts:827-902`,
  which is tagged `@verifies XS-58` / `@verifies ERR-7` but not TSK-39.
  That test covers TSK-39's **first** bullet (the view reports the task no
  longer exists). Its second ("further edits are prevented rather than
  failing one-by-one") and third ("a route back to the list is offered")
  are *not* asserted there — so TSK-39 is genuinely part-covered, and a
  bare re-tag would overstate it.
- **CMT-35.** The whole mechanism is built and unit-tested in core:
  `packages/core/src/task/comments.ts:396-430` (`editors`, `editedLabel`,
  self-edit exclusion, dedupe in first-edit order), tested at
  `packages/core/src/task/comments.test.ts:175-321` including the
  three-editor "X, Y, and Z" formatting. None of it is tagged CMT-35.
  This is the mirror of round 6's TSK-51 finding: real coverage filed
  under no ID.

I did not check the remaining twelve for this pattern.

### F3 · A residual write window survives A59 (minor, reported not fixed)

A59's guard is real and correctly placed (see verification below), but
"no write leaves the editor while a conflict dialog is open" is very
slightly stronger than what the code guarantees. The guard
(`useBodyAutosave.ts:245`, `if (conflictRef.current !== null) return;`) is
evaluated when `flush()` is **called**, not when `write()` runs. A flush
already chained onto `inFlightRef` before the conflict opened will still
reach its `write()`. In practice that is the write that *produces* the
conflict, so the window is narrow; but a second flush chained behind it
in the same tick would pass the guard and hit the network after the
dialog is up. Not a regression, not something A59 claimed to have closed
— recording it so it is not re-derived.

### F4 · TSK-51 under-covers one half-bullet (minor)

TSK-51's third bullet asks that the message name the **destination
project**. The test asserts the failure reason and `/not moved/i`; the
shipped copy (`useTaskMutations.ts:103`) does not include the destination
either. The bullet's substantive half — that a 200 with a non-empty
`failed[]` is not success — is genuinely and solely guarded by this test,
as claimed.

---

## Round 6's five fixes plus A59 — independently verified

All six **VERIFIED**, by reading source and grep rather than by trusting
the report.

| Item | Verdict | Decisive evidence |
|---|---|---|
| **CMT-31** | VERIFIED | `test.use({ timezoneId: "America/Los_Angeles" })` at `flow-activity.spec.ts:777`. `grep -rn "pin removed"` across tests/apps/packages/docs → **no matches**; the stale comment is gone and the doc comment now matches reality. Workspace is `Pacific/Kiritimati` (UTC+14) vs pinned UTC-7 — 21h apart, so the pin is load-bearing. `timezoneId` appears nowhere else, and nowhere else needs it. |
| **TSK-51** | VERIFIED | `flow-tasks.spec.ts:948`. Route returns HTTP **200** with `failed: [{taskId, error}]`; the test then asserts the dialog stays visible. The client's only failure detector is `useTaskMutations.ts:101-103`, which throws on `result.failed[0]` — delete it and `onSuccess` closes the dialog, reddening the assertion. Also asserts frontmatter byte-identity (`toBe(before)`), covering bullets 1–2. The previously-mistagged TSK-21/TSK-44 tests still exist independently at :904 and :582, so no tag was stolen. |
| **REL-8** | VERIFIED | `flow-relationships.spec.ts:482`. Moves a task, parses the new key, asserts `movedKey !== movable`, then searches the **old** key and asserts `link-result[data-key="<newKey>"]` is visible — a string matching no current key and no title word, so disabling retired-key lookup reddens it. Correctly avoids the 30s staleTime trap by moving a different task than bullet 1 searched. |
| **XS-11** | VERIFIED | `flow-task-body.spec.ts:344`. "Keep both" is asserted **on disk**, not in the dialog: after Apply, `expect(merged).toContain("Note from CLI")` **and** `toContain("My addition.")`. Replacing the merge with `conflict.mine` drops the CLI text and reddens the first. Bullet 1 (`expectedToken` on the payload) asserted via route interception. |
| **REL-16** | VERIFIED | Known-gaps entry now exists at `known-gaps.md:1588` and genuinely describes REL-16 (case location, bullet 1, family glyph instead of thumbnail, and why it is unbuilt). The test's forwarding comment now points at something real. **K14** exists at `decisions.md:3983` in § 9, marked "Ken's ruling — an agent may not revert this", quoting Ken verbatim. Bullets 2–4 are genuinely asserted. |
| **A59** | VERIFIED (with F3) | `decisions.md:3925`, § 8, all six fields present including **To revert**, which names the exact guard line and test blocks. Guard in source at `useBodyAutosave.ts:245`. Write-path audit: `apiClient.post` to `/body` occurs at exactly one place (:186), called from exactly one place (:249, inside `flush`); every trigger — both `onBlur` handlers, Ctrl/Cmd+S, the idle timer, `retry`, and the unmount effect — routes through `flushRef.current()`, so the guard covers all of them. Caveat in F3. |

---

## Cross-surface

**K10's body-write precondition is genuinely present on every surface** —
checked in the instructed order (core's exports first, before asserting
any absence):

- core: `packages/core/src/index.ts:376` exports `bodyToken`,
  `StaleBodyWriteError`
- CLI: `apps/cli/src/commands/task-crud.ts:640, 654` (`expectedToken`)
- MCP: `apps/mcp/src/tools/task-body.ts:26-28`, `task-crud.ts:110`
  (`body_token`)
- web: client sends it — `useBodyAutosave.ts:188`
  (`{ body: text, expectedToken: tokenRef.current }`) — and the server
  enforces it, including rejecting a wrongly-typed token with 400 rather
  than silently dropping it
- docs: `docs/user/mcp/reference.md:121, 305, 317, 328, 332` and
  `docs/user/cli/reference.md:630`

No M2 capability was found in core and uncalled by a surface.

---

## Summary

- **Blockers: 0**
- **Mis-tagged tests: 0**
- **Vacuous tests: 0**
- **Cases audited this round: 46** of 171 directly (the 30 round 6 named
  as skipped + the 16 uncovered), plus 6 fix re-verifications and a
  cross-surface check. **~143 of 171 cumulative** across rounds 6–7.
- **Mutations: 2**, both compiled (exit 0), both reached the served
  bundle, both reddened the intended assertion.

**M2 is clean on blockers.** The most important thing found is not a
code defect but a bookkeeping one: **round 6's claim of "70/70 blockers
audited" was wrong — five blockers (XS-4, XS-7, XS-8, XS-13, XS-57) were
in its own skipped list.** All five audited this round and all five hold,
two by mutation. The standing risk is **F1**: fourteen M2 cases are
uncovered *and* recorded nowhere, and at least two of those (**TSK-39**,
**CMT-35**) are real coverage filed under no ID — the same shape as round
6's TSK-51, which means the coverage number understates verification in
one direction while F1 overstates completeness in the other.
