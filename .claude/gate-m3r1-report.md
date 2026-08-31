# M3 Section Gate — Round 1

**Verdict: FAIL** (1 blocker-grade misrecord, 1 vacuous test, 3 weak cases)

Worktree `/Users/ken/Documents/PDev/loctt/.claude/gate-m3r1`, pinned at
`546e6af32bc8c06e67edd37f51085ca4a15a86ef`. Verified before and after:
`git status --porcelain` empty, SHA unchanged, no stash created by me
(the two entries in `git stash list` pre-date this gate).

M3 is in good shape. The suites are genuinely green, the counts match to
the test, and the drag-write tests are markedly better than M2's — most
of them assert the **request payload**, which is the specific defence M2
had to learn the hard way. The findings below are real but narrow.

---

## Half 1 — mechanical (all exit 0)

Every count predicted in the brief was matched exactly, which confirms
the tree. Judged by exit code, never by grepping output.

| Gate | Exit | Result |
|---|---|---|
| `npm run test` | 0 | 147+1647+88+67+839+19 = **2807 passed + 1 skipped** ✓ predicted |
| `npm run typecheck` | 0 | clean |
| `npm run lint` | 0 | **0 errors**, 29 warnings (non-null assertions) |
| `npm run test:ui` | 0 | **507 passed** ✓ predicted |
| `npm run test:integration` | 0 | **439 passed** ✓ predicted |
| `npm run test:e2e` | 0 | **21 passed** ✓ predicted |
| `cases:coverage` | 0 | **619/937** ✓ predicted |
| `cases:coverage --require` (53 BRD/M3.1+M3.2, 15 SPR) | 0 | all required tagged |
| `cases:check` | 0 | index up to date (937 cases) |
| `cases:partition --check` | **1** | pre-existing M2 issue, see below |

`cases:partition --check` fails on **TSK-20 claimed by both M2.1 and
M2.6**. That is an M2 artefact, not M3, and does not block this gate —
but it is a live partition-gate failure and someone should own it.

No flaky-list test failed; no re-runs were needed.

---

## BLOCKERS

### 1. TML-21 — a bullet recorded MET is unmet, and it is the *same* gap the four unmet cases are recorded for

`docs/dev/ui-test-cases/flow-timeline.md:171` (major, P9). Bullet 2:

> Roughly 47,000 day columns are not all rendered at once — **the header
> and grid virtualize**, and scrolling shows correct dates at the far ends.

**What the code does:** nothing virtualizes.
`apps/web/src/client/timeline/TimelineChart.tsx:175` is
`props.cells.map(...)` and `:243` is `band.rows.map(...)` — both
unconditional. The test's own assertion
`expect(width).toBeGreaterThan(1_000_000)` confirms the full ~47,000-column
extent is laid out.

**Measurement.**
`grep -rniE "virtual|overscan|windowing|react-window" apps/web/src/client/timeline/` →
no windowing hits (the only `slice(` matches are date-string slicing in
`geometry.ts`). Positive control: `grep -n "cells.map\|rows.map" TimelineChart.tsx`
→ hits at 175 and 243, so the grep can see this file.

**Why this is the blocker.** TML-26/27/30/32 are recorded unmet *for
exactly this reason* and are honestly tagged — I confirmed **0 `@verifies`
tags** on all four. TML-21 has 1 tag and is recorded MET, while sharing
the same unbuilt dependency. The virtualization gap leaks past the
boundary that was drawn to contain it. Either TML-21's bullet 2 joins the
recorded-unmet set, or virtualization gets built; what it must not do is
stay silently green.

---

## VACUOUS TESTS

### 2. BRD-23 — the project indicator can be deleted entirely and the test stays green

- **File:** `tests/ui/flow-board.spec.ts:891`
- **Test:** `BRD-23: an all-projects board shows a project indicator on each card`
- **Case** (`flow-board.md:189`, minor): every card shows a project
  indicator when scoped to All projects; ranks from different projects
  interleave in one column without collision.

**Shape (d) — the fixture cannot discriminate.** It creates a `BACKEND-`
project, then seeds **one task in the default project**, and asserts only
that the key field contains `"T-1"`. The second project is never
populated; the chip is never asserted; bullet 2 is untouched. The inline
comment claims "the key field carries a project chip", which nothing
beneath it checks.

**Mutation (proof).** Deleted the chip outright from
`apps/web/src/client/board/BoardCard.tsx` — both the render at :180 and
the `ProjectChip` import (removed together so it compiles; `TS6133`
otherwise). `npm run build` exit **0**. Confirmed the mutation reached
the served bundle: `grep -c ProjectChip apps/web/dist/client/assets/*.js` → **0**.

```
✓  1 [chromium] › tests/ui/flow-board.spec.ts:891:3 › BRD-23 ... (1.7s)
1 passed
```

Green with the feature gone. Restored; md5 back to `0237ef1e…`.

---

## NON-BLOCKING FINDINGS

### 3. TML-48 — "partial" understates it; two of three bullets are unmet, including the headline one

Case (`flow-timeline.md:365`, major): bullet 1 the invalid value shown
**verbatim**; bullet 2 no `Invalid Date` leak; bullet 3 the message names
**the task and the offending field value**.

Bullet 2 is genuinely met. Bullets 1 and 3 are not.
`TimelineView.tsx:546` renders `{u.path}: {u.reason}`, and `reason` is a
static zod string (`packages/contracts/src/task.ts:14`,
`"must be YYYY-MM-DD or full ISO-8601 timestamp"`) that never
interpolates the offending value.

**Measurement.** I added one assertion for what the case requires and ran it:

```
Received string: "1 task file could not be read, … /Users/ken/…/.loctt/tasks/
01M1CHBC7S404SZXSWRTKB7VVK/task.md: start_date must be YYYY-MM-DD or full ISO-8601 timestamp"
```

`"next tuesday"` never reaches the screen, and the task is identified by
an absolute path containing a **ULID** — not the task key, which bullet 3
names. The test asserts `toContainText("start_date")` and
`("YYYY-MM-DD")` — the field *name* and the format rule — which is shape
(b): a label asserted where the case demands the effect. The test's long
comment treats "the offending field is named" as satisfying "the
offending field **value**". Probe removed; md5 back to `553784b6…`.

### 4. BRD-6 — over-cap is implemented but nothing tests it

Case (`flow-board.md:58`, major) bullets 2–3: a fourth card changes the
indicator to over-cap styling showing `4 / 3`, and **the drop is still
allowed**. The test (`flow-board.spec.ts:411`) seeds exactly 3 cards and
asserts `"3 / 3"` plus plain counts. No fourth card is ever dragged in.

**Mutation (proof).** `BoardView.tsx:604`, `const over = … && false as boolean`
(that shape, per the brief, to avoid changing the inferred type).
`npm run build` exit 0. Ran the **whole** board spec:

```
51 passed (1.2m)
```

All green with over-cap styling permanently disabled. Restored; md5 back
to `1dc9092b…`.

### 5. TML-24 — the timezone pin the case requires is absent

Case (`flow-timeline.md:194`, major) states its premise explicitly: "run
the browser with the OS set to `America/Los_Angeles` (a 16–17 hour offset
that straddles a date boundary)". The test's comment repeats it — "A
browser 16 hours from the workspace must render the same columns" — but
nothing establishes it.

**Measurement.** `grep -rn "timezoneId" tests/ --include='*.ts'` → **one
hit**, `tests/ui/flow-activity.spec.ts:777`, a different spec (that hit is
the positive control: the mechanism exists and is used elsewhere).
`tests/ui/playwright.config.ts` `use:` block sets no `timezoneId`. So the
browser runs in the host zone: on a UTC box, Tokyo-vs-UTC is 9 hours and
does not straddle the boundary the case names; on a Tokyo box the test
compares Tokyo to Tokyo and asserts nothing.

This is the CMT-31 shape from M2 — a comment claiming a load-bearing pin
that is not there. One line fixes it:
`test.use({ timezoneId: "America/Los_Angeles" })`.

### 6. SPR-4 bullet 2 and SPR-17 bullet 3 — claimed in comments, not asserted

- **SPR-4** (blocker) bullet 2: counts change *after a refetch*, not only
  optimistically. The test asserts `toHaveText("1")`, which an optimistic
  update and a refetched value satisfy identically. The comment says
  "and after the refetch, not only optimistically"; nothing distinguishes
  them. Everything else in SPR-4 is the strongest work in M3 — see below.
- **SPR-17** (major) bullet 3: "dragging a card out completes without
  visibly re-rendering every card". No drag occurs in that test at all.

### 7. `showArchived` is core-with-no-surface

`grep -rn "showArchived" apps/web/src/` → 3 hits, all in
`sprints/columns.ts` and its test; none in any `.tsx`. Compliant with
SPR-1 as written ("unless an explicit affordance is enabled"), but the
option is unreachable by a user — the "drift with a good address" pattern
CLAUDE.md flags, and the same shape as `unarchiveView`.

### 8. TML-32's unmet reason is incomplete

Correctly recorded unmet, but "no virtualization" is not the whole story:
bullet 2, "hovering the source bar highlights its arrows", is a plain
interaction with nothing to do with scale, and is unbuilt and unrecorded.

---

## MIS-TAGGED TESTS

**None found.** Every `@verifies` tag traced across BRD, TML and SPR lands
on a test whose assertions belong to that case. The multi-tag blocks
(`board-move.test.ts:160` → BRD-44/35; `reorder.test.ts:714` → BRD-29/25;
SPR-2/SPR-20; SPR-6/SPR-27) genuinely assert content for both cases named.
This is the M2 TSK-44/TSK-51 failure, and it did not recur.

---

## What I verified positively (worth recording)

- **K11 is genuinely on both surfaces.** `boardMove` is exported from
  `packages/core/src/index.ts:235` and *called* by `apps/cli` (`board-move`)
  and `apps/mcp` (`move_board_card`). Probed the built CLI against a real
  tracker: `board-move T1 --status in_progress --after T2` → both fields
  written with an **identical log timestamp**, i.e. one atomic write, not
  two. The K8/K9 column semantics are live — an anchor in a different
  column is refused with "no longer in that column, so this board is out
  of date".
- **BRD-31's no-op guard is real,** verified independently on disk: a
  repeat `board-rerank` to the same position left the file **byte-identical**
  (md5 unchanged) with `updated_at` unadvanced and no new log entry.
- **Shape (e) is well defended in M3.** TML drag tests hook
  `page.on("request")` and assert the payload; TML-11 pins
  `expect(seen.calls).toHaveLength(1)` with both dates in that one call.
  SPR-4 asserts `expect(payloads[0]).toEqual({ field: "sprint", value: toId })`
  with a comment recording that the name-vs-id failure was *measured*.
  SPR-24 is an independent structural backstop (two sprints sharing a name,
  so an ambiguous name cannot resolve to the right id).
- **TML-34's regression guard exists** — it reads `workflow.yaml` back and
  asserts the dangling key survives, so the config-deletion defect cannot
  silently return.
- **K8/K9 multi-status columns are genuinely exercised**, not 1:1-only:
  five multi-status fixtures in the UI spec, and `board-move.test.ts:139`
  validates anchors against the destination column rather than the origin.
- **BRD-12** is a real test now, no longer `test.fixme`.
- **The four unmet TML cases are honestly recorded** — 0 tags each, so
  coverage is not overstating them.
- **A55 still holds.** Re-measured rather than trusted:
  `packages/core/src/query/parser.ts:4` has no unset/null operator
  (`"=" | "!=" | "<" | "<=" | ">" | ">=" | "~" | "in" | "not in"`).
  SPR-6 bullet 3's recorded reasoning is intact.

---

## Two premises in my own brief that the code contradicts

Recorded because they would mislead the next round:

1. **There is no `?counts=true` path in the sprints view.** `SprintsView.tsx:69`
   fetches **one** feed and pages it to exhaustion, buckets client-side, and
   renders `tasks.length` as the header count. Header count and rendered
   cards come from one array, so no fixture can make "two independent paths"
   disagree — the architecture forecloses it. SPR-1's count equality is
   near-tautological *by design*; SPR-17 is what gives it teeth.
2. **The per-column fetch does pass an explicit limit** (`SPRINTS_PAGE_SIZE = 200`,
   not the default 100), but 200 < 400, so SPR-17's correctness rests on the
   exhaust-the-feed effect. It does seed 400 (`tracker.seedBulk(400)`) and
   asserts header `"400"` while rendered < 400 — a genuine discriminating fixture.

---

## Audit coverage

**119 of 119 M3 cases audited**, across three parallel tag-to-case passes
(a systematic audit, not a sample — this is what M2 rounds 6–7 established
and rounds 3–5 got wrong):

| Set | Audited | Skipped |
|---|---|---|
| BRD (M3.1 + M3.2) + ONB-11, MSL-5, MSL-20, XS-9 | 53 / 53 | none |
| TML (M3.3a + M3.3b) + PRU-1 | 51 / 51 | none |
| SPR (M3.5) | 15 / 15 | none |

**Re-read of my own skip list:** every set reports zero skips, and nothing
in the findings above references a case outside the three sets, so the
summary does not contradict the skip list. Blockers were audited first,
then majors, then minors, in every set.

**NEW-1..41 (M3.4, create task modal) was NOT audited.** 39 unique NEW tags
exist and the ticket is marked ✅ complete, but the modal was outside the
three passes I ran. That is the largest deliberate gap in this report and
round 2 should cover it.

## What I did not check, and why

- **M3.4 / NEW-*** — as above; not sampled at all.
- **Suite-wide mutation testing.** I mutated four specific levers
  (BRD-23's chip, BRD-6's `over`, TML-48's assertion, plus the CLI probes).
  A comprehensive mutation pass over M3 was out of budget.
- **Cases owned by other milestones** (M1, M2, M4) except where a gate
  command surfaced them — hence the TSK-20 partition note.
- **`npm run test:perf`** — not part of the gate's mechanical half.
- **Visual/animation bullets** (e.g. BRD-11's "animates the gap rather
  than teleporting") are asserted as presence, not motion. Reasonable
  under Playwright; noted rather than counted as a finding.
