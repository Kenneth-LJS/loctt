# M2 section gate — round 5

**SHA:** `ca89cae59831bc2d2df21aa6c6aa8a9e66b05e9f`
**Worktree:** `/Users/ken/Documents/PDev/loctt/.claude/gate-m2r5`
**Verdict:** FAIL — 1 blocker, 2 non-blocking findings, 0 vacuous tests found.

## Baseline confirmed (right tree)

Every predicted count matched exactly, which is the tree check.

| Suite | Predicted | Measured | Exit |
|---|---|---|---|
| unit | 2805 + 1 skipped | 147+1647+88+67+837+19 = **2805**, 1 skipped | 0 |
| UI | 506 (504 + 2 flaky) | **504 passed, 2 failed** (SHL-6, REL-32) | — |
| integration | 439 | **439** | 0 |
| e2e | 21 | **21** | 0 |
| coverage | 616/937 | **616/937**, 1072 tags | 0 |
| lint | — | — | **0** |
| typecheck | — | — | **0** |
| `cases:check` | — | — | **0** |

The two UI failures are both on the known-flaky list and both passed at
**file** level immediately after, on the same build: `flow-relationships.spec.ts`
**30/30**, `flow-list.spec.ts` **168/168**. Flakes, not regressions.

---

## BLOCKER

### B1 · TSK-21 (M2, **blocker**) — one bullet is built, unasserted, and nothing catches its removal

**What the case requires** (`docs/dev/ui-test-cases/flow-tasks.md`), bullet 1:

> The picker lists non-archived projects, **excluding the current one**.

**What the code does.** `apps/web/src/client/task/MoveTaskDialog.tsx:43`
filters archived projects out, and line 75 disables the current one. Both
halves are built and both are correct.

**The measurement.** `TSK-21` appears in **zero** test files:

```
grep -rn "TSK-21" tests/ apps/ packages/ --include='*.ts' --include='*.tsx'   → 0 hits
grep -rn "TSK-20" tests/ --include='*.ts'                                     → 3 hits  (positive control)
```

`npm run cases:coverage -- --milestone M2` lists TSK-21 as uncovered, and it
is the only **blocker** in that list of 18.

**The mutation showing nothing catches it.** In `MoveTaskDialog.tsx`, both
halves of bullet 1 broken at once — archived projects re-admitted and the
current project made selectable:

```
const choices = projects.filter(p => p.archived !== true);  →  const choices = projects;
disabled={p.id === currentProject}                          →  disabled={false}
```

`npm run build` exit **0** with the mutation in place (a non-compiling
mutation proves nothing). Full UI suite under the mutation: **504 passed, 2
failed** — SHL-6 and REL-32, the same two known flakes as the clean run, and
neither touches the project picker. **No test anywhere goes red.** Restored;
`git status --porcelain` empty and `const choices = projects.filter(...)`
verified back in place.

**Why this is a blocker and not bookkeeping.** TSK-21's other three bullets
*are* genuinely covered, just under the wrong tag (see N1) or in core
(`packages/core/src/task/move.test.ts:43` asserts `key_history` gains the old
key; `:56` asserts the old key still resolves; `:120–129` covers the counter
and the P-7 collision guarantee). Bullet 1 is the one bullet that lives only
in the web client, and it is the one bullet with no assertion on any surface.
This is exactly round 4's shape — a declared M2 blocker, built, and asserted
by nothing — repeating for a tenth case.

---

## NON-BLOCKING

### N1 · Two tests tagged `@verifies TSK-44` actually assert TSK-21 and TSK-51

**Coverage honesty**, the category that hid REL-49 in round 3 and the nine in
round 4.

`TSK-44` is a **minor** case with a single subject:

> **Cancelling a destructive dialog leaves nothing changed.** Open Delete and
> Move dialogs, then dismiss each.

Three tests carry the tag. One is honest — `tests/ui/flow-tasks.spec.ts:582`,
"cancelling Delete or Move changes nothing". The other two are not:

| Line | Test | What it actually verifies |
|---|---|---|
| 904 | "a move the server reports as failed keeps the dialog open and names it" | **TSK-51** (major) — the failed-move path |
| 972 | "a successful move rekeys the task and follows it to the new key" | **TSK-21** bullet 2 (blocker) — rekey + navigation |

Neither test cancels anything. Both are *good tests* — I broke `useMoveTask`
(swallow `failed[0]` and never return `new_key`; build exit 0) and both went
red, alongside REL-32's flake. The defect is that their tag points at a minor
case about dialog dismissal, so the coverage tool reports TSK-21 and TSK-51 as
uncovered while the behaviour is in fact covered. That is the REL-31 pattern
from round 4 — behaviour covered, case scored uncovered — with the extra harm
that a **blocker** is the case being mis-scored.

**Fix:** add `@verifies TSK-21` at line 972 and `@verifies TSK-51` at line 904,
keeping TSK-44 only at 582. That alone moves coverage 616 → 618 and leaves B1
as the single real gap.

### N2 · REL-16 bullet 1 is unmet, and the note pointing at the gap points nowhere

`docs/dev/ui-test-cases/flow-relationships.md`, REL-16 (M2, **blocker**),
bullet 1:

> The PNG shows an **inline image thumbnail**.

`AttachmentsPanel.tsx:455–465` renders a glyph for every family including
`image`; there is no `<img>` on the tile path at all. The round-4 test says so
itself (`tests/ui/flow-attachments.spec.ts:872–876`):

> "The case's first bullet ... is **not satisfied by this build**; see
> known-gaps."

**It is not in known-gaps.** `grep -n "REL-16\|thumbnail" docs/dev/known-gaps.md`
returns nothing, while `grep -n "REL-" docs/dev/known-gaps.md` returns 8 hits —
so the grep works and the entry is absent.

The source cites REL-38 as its justification, but REL-38 is scoped to files
with **no extension** ("A file with no extension gets a generic icon and no
MIME guess"). It does not license suppressing thumbnails for a PNG. So a
declared blocker has an unmet bullet, deliberately, with the reasoning recorded
only in a code comment that forwards to a document that does not contain it.
The build's position is defensible — REL-38's own comment notes an inline
`image/svg+xml` render is a script-execution path — but that is a **decision**
(`decisions.md` § 8, with a revert path) or a **known gap**, not a comment.

Not a blocker because the behaviour is deliberate and the test is honest about
what it does and does not assert. It needs a record, not a code change.

### N3 · Two cited decisions do not exist — `A5` and `A6` are missing from `decisions.md`

`tests/ui/flow-tasks.spec.ts:906` justifies its own existence with:

> "A6 records why this needs its own test: there is no single-task move
> endpoint..."

`decisions.md` has no A5 and no A6 — the headings run `A1, A2, A3, A4, A7,
A8, A9, ...`. The decision the comment is describing is **A9** ("Single-task
Move goes through the bulk endpoint", `decisions.md:1117`), whose text matches
the comment almost word for word. A reader following the citation finds
nothing and cannot tell whether the rationale was lost or never written.

---

## VACUOUS TESTS

**None found.** Bounded, and stated as such below.

The one shape I actively hunted was the fifth — *asserting the far end while
the client sends the wrong value and a layer in between repairs it*, which is
how M3.5's SPR-4 passed for the wrong reason. M2's write path has the
preconditions for it: `handleSetField` (`server.ts:3233`) passes
`request.value` straight into core's `setField`, which resolves names to ids,
and **no M2 spec asserts a request payload**:

```
grep -c "waitForRequest|postData|postDataJSON"
  flow-tasks 0 · flow-comments 0 · flow-attachments 0
  flow-relationships 0 · flow-task-meta 0 · flow-task-body 2
```

So I ran the M3.5 mutation directly at M2's picker — `namedOptions` in
`MetaPanel.tsx:494`, `key: e.id` → `key: e.name`, build exit 0, making every
milestone/sprint write send a **name** where an id belongs:

**Three tests caught it** — TSK-10, TSK-42 and TSK-33 in `flow-task-meta.spec.ts`.
M2's meta path is **not** vulnerable to the fifth shape. Restored and verified.

---

## The six round-4 tests not independently verified — all six hold up

Each mutation compiled (`npm run build` exit 0 with it in place); each was
restored and the restore verified with `git status --porcelain` empty. For the
two server-side ones I additionally confirmed the mutation reached
`apps/web/dist/server/server.js` by grep, and confirmed it was gone after
restore + rebuild.

| Case | Lever mutated | Result |
|---|---|---|
| **REL-16** | `familyForMime`: `image/*` → `"generic"` | **RED** at line 876, `data-family` |
| **REL-17** | `onDragOver`: `setDragOver(true)` → `(false)` | **RED** at line 974, `data-dragover` |
| **CMT-33** | server: `/no current user/` → `/no current user XYZ/` | **RED** — falls back to core's raw text |
| **CMT-34** | server: `/unknown comment id/` → `/... XYZ/` | **RED** at 1272, saw the raw `unknown comment id: <ulid>` |
| **CMT-21** | not mutated — see below | reviewed, judged sound |
| **CMT-22** | not mutated — see below | reviewed, judged sound |

**CMT-21 and CMT-22 got no new test in `ca89cae`.** The commit message claims
nine blockers were addressed; the diff adds **seven** `@verifies` tags
(REL-31, REL-16, REL-17, REL-18, CMT-32, CMT-33, CMT-34). CMT-21 and CMT-22
were already covered by pre-existing M2.4a **unit** tests
(`comments/users.test.ts:25,44`, `comments/editors.test.ts:47`,
`comments/renderMarkdown.test.tsx:148,177,209`). I read all six in full rather
than mutating them: they assert effects with paired positives, name both
failure modes explicitly (`not.toBe(ghost)`, `not.toBe("")`), and the
`javascript:` test deliberately uses mixed case so a denylist cannot pass it.
These are among the stronger tests in the repo. Two bullets are nonetheless
**not** reached by them, and by nothing else:

- **CMT-21 bullet 3** — "the comment *list* does not fail to load because one
  mention doesn't resolve." The unit tests exercise the resolver in isolation;
  nothing renders a list containing an unresolvable mention.
- **CMT-22 bullet 5** — a comment containing `:`, `---` and a leading `- `
  round-trips through the comments file "without corrupting it or the
  neighbouring comments." This is a YAML-serialization claim about the file,
  and no test writes those characters through the composer.

Both are non-blocking: the behaviour is structurally likely to hold (rendering
is React elements throughout; the comments file is written by core's YAML
serializer), but neither is asserted.

**REL-31 (verified by round 4, re-read here).** The core test at
`reorder.test.ts:170` is strong and explicitly anti-vacuous — it asserts
`rebalanced === true` so the loop cannot pass without triggering one, and pins
`longestBefore === REBALANCE_LENGTH_THRESHOLD` so it got there by growing a
rank rather than some other route. Note it is a **core** test: bullet 5 ("no
user-visible error or flash accompanies the rebalance") is a UI claim a core
test structurally cannot make, and `grep -rn "rebalanc" tests/ui/` returns
nothing. Non-blocking — the same class as N2, an unasserted bullet on a
covered case.

---

## Checked and found correct (round 6 need not redo)

- **All five suites and both static gates**, judged by exit code, run one at a
  time, never concurrently with a build. All match baseline exactly.
- **K10 / M2-gate-r3 blocker B2 closed.** `bodyToken` and `expectedToken`
  reach core, CLI **and** MCP (`grep -rl`: cli 1, mcp 1, web 6/4). Round 4's
  verdict confirmed independently.
- **REL-49 (round 3's B1)** — covered by a real UI test at
  `flow-attachments.spec.ts:723`, passing.
- **Cross-surface for M2's core additions.** `unlinkTask`, `duplicateTask`,
  `bodyToken`/`expectedToken` all reach CLI and MCP. **I nearly filed a false
  finding here**: `moveTaskToProject` greps to core + CLI only, with zero hits
  in `apps/mcp`. MCP exposes it under the **bulk** variant — tool `move_task`,
  `task-crud.ts:323`, calling `bulkMoveTasksToProject`. Cross-surface is
  **clean**; the gap I suspected does not exist.
- **Move-to-project behaviour verified end-to-end off disk**, against a real
  tracker built with the pinned `apps/cli/dist/index.js`: `loctt move T-1 Beta`
  → `Moved T-1 → BET1`, exit 0; `key_history: [T-1]` present in the task file;
  `loctt show T-1` still resolves to `BET1`. The feature is correct — the
  finding in B1 is about assertion, not behaviour.
- **`cases:check` exit 0** — the committed case index is not stale.
- **`cases:partition --check` exits 1**, on `TSK-20` claimed by both M2.1 and
  M2.6. **Pre-existing, not a round-5 regression**: introduced by `fc639b6`
  ("TSK-20 gets its own ticket, M2.6, before K7"), which added the M2.6 ticket
  without trimming M2.1's `Cases:` line. Unchanged by `ca89cae`.
- **Tree integrity.** Final `git status --porcelain` empty, HEAD still
  `ca89cae`, and both pre-existing stashes (`stash@{0}` `lookup-fix`,
  `stash@{1}` WIP) untouched. Nothing committed, nothing stashed. Every
  mutation backed up by `cp` to the scratchpad, restored, and the restore
  verified by re-grepping the mutated line.

## Not checked, and why

- **No exhaustive mutation sweep of all 506 UI tests.** Six targeted mutations
  plus one full-suite run per mutation is what fit; each full UI run is ~7
  minutes. Rounds 3 and 4 were bounded the same way and said so. **The vacuity
  question for M2 remains bounded, not settled** — my "0 vacuous" is a
  statement about the shapes I probed, not a swept suite.
- **M2 cases outside the nine + TSK-21/51 were not read bullet-by-bullet.**
  M2 spans ~167 UI cases. I read in full: the nine round-4 blockers, TSK-21,
  TSK-44, TSK-51, REL-38 and REL-32. The other ~150 were checked only via the
  coverage tool's tagged/untagged split, which N1 demonstrates is not
  trustworthy on its own — a tag can name the wrong case. **A tag-to-case
  fidelity audit across all of M2 is the single highest-value thing left**,
  and N1 is evidence it will find more.
- **The 17 non-blocker uncovered M2 cases** (CMT-18/20/23/24/25/35, ERR-23,
  REL-14/47, TSK-27/39/43/51/55/56, XS-10/65) were not investigated
  individually. TSK-51 is explained by N1; the rest are majors and minors that
  several tickets already recorded as deferred or unsatisfiable.
- **Attachment case-folding on macOS** (`DELETE .../DROP.TXT` deleting
  `drop.txt`) is recorded in `TEMP-BUILD-PLAN.md` as a live defect
  deliberately not fixed. Not re-derived; not a new finding.
