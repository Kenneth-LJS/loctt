# 🚦 Milestone 1 gate — round 8

Verdict: **PASS**
Date: 2026-08-29 (round 8)
Tree: pinned `3b0e33b`, own worktree at `.claude/gate-round8`, pre-built.
Working tree clean at start and at end; every mutation restored and
verified byte-identical with `git status --porcelain` returning empty.

**All six mechanical suites are green, and both of round 6's open
findings (F1 blocker, F2 major) are genuinely fixed — verified by
mutation, not by reading the diff.** Killing a real `loctt ui` with the
page open and never reloading — the exact procedure seven specs missed
— now raises the banner within seconds. That was the round-6 blocker
and it is closed.

One new finding, a **minor**: sorting by a custom field (`?sort=fields.<key>`)
is accepted, kept in the URL, and silently does nothing — `asc` and
`desc` return identical order. No case covers custom-field sorting, so
it is recorded as a **proposed case**, not a defect.

---

## A note on tree integrity — read this first

**A commit landed in my worktree mid-run.** I verified `3b0e33b` at
start; at the end `git log` read `b0cbe54` ("docs: run log — round 7
abandoned, and why"). This is the round-7 failure mode and I stopped to
diff it rather than report results from a tree I had not checked.

It is **documentation only**:

```
$ git diff --name-only 3b0e33b b0cbe54 | grep -vE '\.md$'
NONE — markdown only

$ git diff --stat 3b0e33b b0cbe54 -- apps packages tests tools \
    package.json package-lock.json eslint.config.js tsconfig.base.json
(empty — identical)
```

One line added to `TEMP-BUILD-PLAN.md`. `apps/`, `packages/`, `tests/`
and every build config are byte-identical to my pinned base, so no
suite result or browser observation is affected. **The verdict stands.**
Recorded because a moving tree under a gate is exactly what cost
round 7, and "it was only docs" is a conclusion that has to be
measured rather than assumed.

---

## Suites

Run strictly sequentially. No build ran while any suite was in flight.
Exit codes captured with `echo "EXIT=$?"` immediately after the command,
never after a pipe.

| Command | Exit | FAIL | Detail |
|---|---|---|---|
| `npm run typecheck` | **0** | 0 | all workspaces |
| `npm run lint` | **0** | 0 | 4 lines of output total, no errors/warnings |
| `npm run test` | **0** | 0 | **2365 passed**, 1 skipped / 168 files |
| `npm run test:integration` | **0** | 0 | **421 passed** / 125 files |
| `npm run test:e2e` | **0** | 0 | **21 passed** / 11 files |
| `npx playwright test --workers=1` | **0** | 0 | **203 passed** — the expected count exactly |
| `npx tsx tools/coverage/main.ts --require <238 M1 ids>` | 1 | — | 3 uncovered, all three already parked |
| `npm run cases:check` | **0** | 0 | index up to date, 937 cases |

**The lint check was made deliberately.** The brief records `grep -c error`
printing `0` over a V8 OOM crash dump three times. I checked the exit
code directly (`EXIT=0`), the total output length (4 lines — a crash
dump is thousands), and a case-insensitive count of `error|warning|✖`
(zero). Lint genuinely ran and genuinely passed.

**The UI count was checked, not skimmed.** 203 is the documented total;
`✘`/numbered-failure marks grepped to 0; exit 0. The round-5 trap of
`195 passed` printed above five hidden failures cannot apply here.

### Coverage: the same three, all previously parked

`SHL-33`, `SHL-44`, `XS-56` have no `@verifies` tag. Unchanged from
round 6, each with a recorded reason: SHL-33's obvious tests are
vacuous (documented in `known-gaps.md`), SHL-44 needs the real
`/tasks/$key` from M2.1, XS-56 was decided by Ken as the error state.
Not new findings.

---

## Journeys

Fixture built in my own worktree: `loctt init --prefix T` → **63 tasks**
across all four statuses, four priorities and five types, plus three
hostile titles — `<script>alert("xss")</script>`, `=cmd|/c calc!A1`,
and a CJK + kana + quotes + commas title. Served by a real
`loctt ui --port 47823 --no-open`. Two further trackers for the
no-tracker and schema-mismatch screens, and an HTTP proxy serving the
SPA while refusing `/api/` to isolate cold-load from mid-session.

All interaction was **real hit-tested clicks**. `javascript_tool` was
used only to *read* state and to arm samplers. No `page.evaluate`-style
synthetic click stands behind any finding.

| Journey | Result |
|---|---|
| Land cold on `/list` | **Pass.** 50 rows, "Showing 1–50 of 63", `scrollWidth === clientWidth === 1280`. Hostile titles render as text, not markup. |
| Sort a column | **Pass.** Priority sorts by configured *rank* (Low → Medium …), not alphabetically; URL gains `?sort=priority&dir=asc`. |
| Sort by various columns | **Pass.** `title` asc/desc reverse correctly. `created_at` honoured and kept in the URL. Unknown `sort` stripped from the URL. |
| **Sort by a custom field** | **FAIL — see F1 (minor).** Accepted, kept in the URL, silently a no-op; asc and desc identical. |
| Page to the end | **Pass.** `?page=999` → all 63 rows, "Showing 1–63 of 63", not an empty page. `?limit=99999` clamped to 200 and rewritten into the URL. |
| Filter, copy URL, reopen | **Pass.** `?status=done` → 16 rows, all Done, footer 16 of 16, reproduces from the URL alone. |
| Select rows; bulk set a field | **Pass.** "3 tasks selected" honest. Bulk *Set status → In progress* moved two tasks out of the `status=done` filter (16 → 14) and **persisted to disk** — CLI `show T55`/`T59` both read `in_progress`. |
| Archive a selection; undo it | **Pass.** 16 → 13 with a "3 tasks archived · Undo" toast and **no typed confirmation** (BLK-10). Undo restored all three (13 → 16). |
| Move tasks to another project | **Pass.** Toast reads **"2 tasks moved: T19 → S1, T17 → S2"** as one string (BLK-9's own guard). Count honestly 61. |
| Old keys still resolve | **Pass.** After the move, `loctt show T19` returns S1, and `GET /api/tasks/T19` → 200 alongside `/api/tasks/S1` → 200. |
| Export CSV with a filter | **Pass.** `/api/tasks/export?status=done&format=csv` → exactly 14 rows, all `status=done`. **Formula-injection guard holds**: `=cmd\|/c calc!A1` exports as `'=cmd\|/c calc!A1`. |
| Reload on every route | **Pass.** All 14 routes tested return 200, including `/tasks/NOSUCH999`, `/nonexistent`, `?bogus=1`, `?dir=sideways`. |
| Back and Forward | **Pass.** `/list` → `?status=done` → `/board`, Back ×2: 14/14 ↔ 50/63 reverts exactly at each step. |
| Narrow viewport (375px) | **Pass.** `scrollWidth === clientWidth === 375`, no page overflow. Sidebar collapses to an icon rail; table scrolls in its own container. |
| Task-detail stub | **Pass.** `/tasks/T17` renders `Route stub: /tasks/T17` — interpolated, inside the shell. |
| A directory with no tracker | **Pass.** "No tracker here yet" + `loctt init` instruction. Visibly distinct from both the unreachable banner and the "could not load" panel (ERR-1). |
| **Schema-mismatched tracker** | **Pass.** `.schema-version` → 9: banner **in the shell**, nav links intact, names v9 vs v1 and the next action. Text length constant across 15 samples over 14.7s, never "Loading…" — **no loop**. |
| **Server killed mid-session, NO reload** | **Pass — round 6's F1 blocker is CLOSED.** See below. |
| **"Try now" while still down** | **Pass — round 6's F2 is CLOSED.** Shell survives; banner never vanished; **zero** frames claimed emptiness. |
| Cold load against a dead API | **Pass.** Banner at ~2.3s; **zero** frames showed "No projects/milestones/labels yet"; footer honestly "task count unavailable"; never "No tracker here yet". |
| Server restarted (ERR-2 recovery) | **Pass.** Banner and all six sidebar alerts cleared **on their own** within ~12s — no reload, no click. |
| Malformed config (`projects.yaml`) | **Pass.** Sidebar: *"projects.yaml could not be parsed. Retry · or run `loctt doctor`"*; "Show details" reveals `line 3, column 12` **and** the offending source line; list keeps working (50 rows); project cells degrade to a marked "unknown" chip — not blank, not a raw ULID. |
| Config drift while open | **Pass.** A new project and a new custom field both appeared **without a restart** — "Second" in the sidebar, an "Effort" filter chip in the bar. |

### The blocker check, in detail

Round 6's F1 was that a server dying mid-session was completely silent.
Reproduced its exact procedure — and it now passes:

1. `loctt ui` on the seeded tracker, `/list` loaded (50 rows, no banner).
2. Killed the process. Verified dead: `curl` → `HTTP=000`, `PROCESS GONE`.
3. **No reload.** Clicked **Refresh** with a real hit-tested click
   (verified `elementFromPoint` resolved to the button before clicking —
   my first attempt missed by 30px and I caught it rather than scoring it).

Measured 6s later:

```
banner:     true      ← [data-server-unreachable] present
alerts:     6         ← every sidebar group "Could not load. Retry"
rows:       50        ← stale but no longer presented as fresh
emptyClaims: []       ← no "No projects yet" anywhere
```

Banner text: *"The LocTT server is not responding. The terminal running
`loctt ui` may have stopped — restart it and this will clear on its own."*
with a **Try now** button. Round 6 measured `banner: false, alertCount: 0`
in this same state.

---

## Round 6 findings — verified individually

| Round 6 | Status |
|---|---|
| **F1** blocker · server dies mid-session, nothing says so | **CLOSED.** Reproduced the exact procedure against a real killed server with no reload; banner appears. Fix verified non-vacuous by mutation (below). |
| **F2** major · "Try now" shows an empty tracker for ~1s | **CLOSED.** Zero frames claimed emptiness on either the Try-now path or the cold-outage path. `hasAnswered` gates all five groups plus recents. Verified non-vacuous by mutation. |
| **F3** minor · unknown `sort` field accepted as 200 | **Open by decision (A1), and A1 is right.** Re-measured — see A1 below. |
| **F4** minor · CSV export writes raw ULIDs | **Unchanged, by decision.** Still reproduces (`project` → `01M152W3E0M3RVX9YP4BH9W3MC`). Parked in `PROPOSED-UI-CASES.md` for Ken. |
| **F5** minor · error panel headed "Loading tasks" | **CLOSED.** Now reads **"Could not load tasks"**, pinned by a positive assertion at `tests/ui/flow-list.spec.ts:3135`. |

### The two fixes were mutated, not taken on trust

Both mutations compiled and were confirmed to reach the running code by
watching the *specific* named test flip.

**F1 — `ServerUnreachableBanner.tsx`.** Restored round 6's `continue`
after `lastSuccess` (A2's option 1, verbatim from the revert note):

```
× speaks when an answered query then fails — a dead server looks like this
  AssertionError: expected null not to be null   (ServerUnreachableBanner.test.tsx:172)
  Tests  1 failed | 6 passed (7)
```

**F2 — `Sidebar.tsx`.** Forced `hasAnswered()` to `return true`:

```
× expect(screen.queryByText("No projects yet")).toBeNull()
  (Sidebar.error.test.tsx:236)
  Tests  1 failed | 38 passed (39)
```

Both files restored; `git status --porcelain` empty afterwards. Neither
guard is vacuous: reverting either fix turns a test red.

---

## Findings

### F1 · minor · Sorting by a custom field is silently a no-op

**No case covers custom-field sorting, so this is a proposed case
(PC-21 below) rather than a defect.** It is recorded as a finding
because the *code's own comment* asserts the opposite behaviour.

**Repro:**

1. Add a valid custom field to `workflow.yaml`
   (`key: effort`, `type: enum`, `multi: false`, `searchable: true`,
   values `s`/`m`/`l`).
2. `loctt set T1 effort l`, `T2 effort s`, `T3 effort m`, and eight more.
3. `GET /api/tasks?limit=63&sort=fields.effort&dir=asc` and `&dir=desc`.

**Measured** (11 tasks carrying values):

```
asc:  T1=l, T2=s, T3=m, T5=s, T7=s, T9=s, T11=s, T13=s, T15=l, T17=l, T19=l
desc: T1=l, T2=s, T3=m, T5=s, T7=s, T9=s, T11=s, T13=s, T15=l, T17=l, T19=l
       ↑ identical — direction ignored entirely
```

Full-order comparison: `asc == desc` (direction ignored), and the order
is exactly `T1,T2,…,T63` — on-disk scan order. For contrast, `sort=title`
reverses correctly, and `sort=priority` orders by configured rank.

**Mechanism, measured rather than argued.** `getTaskFieldValue`
(`packages/core/src/query/list.ts:356`) resolves the value in two steps,
and the dotted key matches neither:

```ts
if (hasOwnProperty(task.frontmatter, field))        // "fields.effort" — false
if (hasOwnProperty(task.frontmatter.fields, field)) // key there is "effort" — false
return undefined;
```

On disk the value is `frontmatter.fields.effort`. So *every* task
returns `undefined`, every comparison hits `compareTasks`'s
"push to end regardless of direction" branch (`:394-396`), and
`Array.prototype.sort` — being stable — leaves the input in scan order.

**I tested this rather than assumed it, and my first prediction was
wrong.** I predicted `sort=fields.effort` would equal the *default*
order; it does not, because the default branch re-sorts by `updated_at`
while the sort branch leaves scan order. Predicting scan order
(`T1..T63`) instead: **exact match.** Only then did the mechanism hold.

**Why it matters.** The server comment at `server.ts:434-441` states the
intent — *"a task that does not carry one sorts as absent, which is
correct"*. That is silently true of **every** task, so the feature the
comment defends does not exist. And `isSortableTaskField` accepts
`fields.*` on shape, so the client **keeps** `?sort=fields.effort&dir=desc`
in the URL and presents the sort as applied — the precise failure the
LST-29 comment at `server.ts:2300-2305` says the code exists to prevent
("the list came back in its original order while the header still showed
the sort as applied").

**Not a defect against LST-29**, which is satisfied: no column indicator
is shown (`aria-sort` unset on all nine headers), because `fields.effort`
has no visible column.

### F2 · minor · `loctt project create --name X` creates a project named `--name`

Outside M1's UI scope; recorded because it was found in passing and is
a silent data-corrupting input.

```
$ loctt project create --name "Second" --prefix S
Created project "--name" (prefix S, id 01M153TTMT4PX9EAPH1YN66ADX)
```

The unsupported flag is consumed as the positional name and `"Second"`
is discarded, with no error. The correct form is positional
(`project create "Second" --prefix S`), which works. `project list`
rejects unknown flags with a helpful message; `create` does not.

---

## Decisions — A1, A2, A3

### A1 · Unknown `sort` stays a 200 — **RIGHT, keep it**

I re-measured the claim A1 rests on, because A1 itself overturned a
round-6 assertion and a decision resting on a measurement deserves an
independent one.

```
GET /api/tasks?limit=63                        → order X
GET /api/tasks?limit=63&sort=nonexistent_field → order X   (IDENTICAL)
HTTP 200 for the bogus sort; HTTP 400 for ?dir=sideways
```

**A1's refutation is correct**: round 6's F3 claim of "different
ordering" does not reproduce; the fallback genuinely works. And the
reasoning is sound — LST-29 requires `/list?sort=nonexistent_field` to
render with the default sort rather than an error, so a 400 would have
to be swallowed by the client, buying consistency by adding a special
case. Option 1 or 3 would be authoring a requirement (stop condition 2).

Verified in the browser: the client drops the unknown sort from the URL
via `replace`, so Back is unaffected.

**One qualification, not an objection.** A1 reasons that `fields.*` keys
are accepted on shape and sort correctly; F1 above shows they do not
sort at all. That does not change A1's verdict — the asymmetry it
declines to fix is still not required by any case — but the "valid
custom sorts work" premise nearby is false, which is worth knowing when
PC-21 is decided.

### A2 · One failed request is enough — **RIGHT, keep it**

Decided the banner should fire on "any failure later than the last
success" rather than requiring a never-answered query.

**This is reading SHL-41, not extending it.** The case says "the *next*
failed request produces a persistent, visible state" — one request. The
old rule made a **blocker** case unimplementable: with the page open,
every query has been answered, so no failure could ever count. I
reproduced the fix working against a genuinely killed process, and
confirmed by mutation that reverting it turns the named test red.

The cost A2 accepts — a failed "Load more" briefly raising the banner —
is the right side of an asymmetric trade against a dead server saying
nothing at all, and LST-49 never asks the banner to stay silent.
Option 3 (a threshold) would have authored a number no case names.

The entry is honest that it answers a question the spec does not ask
(PC-18), and its revert path is accurate — I executed it.

### A3 · A transient wrong claim counts as making it — **RIGHT, keep it**

The strongest of the three, and the one with the most leverage.

P6's four designed states (empty / loading / partial / broken) are
about *which claim is being made*, and duration does not change the
claim. ERR-1 requires a failure and an absence not to look alike, with
no exemption for brief ones. Option 2 (a duration threshold) is also
defeated on its own terms by the measurement: 1089–2098ms is not a
flicker, and no case names a threshold anyway.

Verified as implemented: `hasFailed` and `hasAnswered` use
`errorUpdatedAt`/`dataUpdatedAt`, which survive `fetchState`'s reset,
and all five sidebar groups plus recents are gated on both. Measured
**zero** empty-claim frames on both the retry path and the cold-outage
path. Option 3 ("case by case") is exactly what produced four
`AppBootstrap` bugs diagnosed as unrelated, so rejecting it is right.

**This is the entry most worth generalising rather than reverting.**
The rule — *ask what a query has ever done, never what it is doing now*
— has now retired six bugs across three files.

---

## Behaviour no case covers

Proposed cases only. **Nothing here has been written into
`docs/dev/ui-test-cases/` or `docs/dev/surface-test-cases/`.**

- **PC-21 · No case says what sorting by a custom field should do.**
  F1 sits in this gap. `isSortableTaskField` accepts `fields.*` on
  shape and the client keeps it in the URL, but nothing sorts. A case
  should state whether `?sort=fields.<key>` orders by the field's
  **declared enum rank** (as `priority` does via its `value` weights),
  by raw string value, or is rejected — and what the header shows when
  the sorted field has no visible column. Note the three answers differ
  for exactly the case a user hits first.

- **PC-22 · No case constrains unknown-flag handling in CLI
  subcommands.** F2 sits here. `project list` rejects unknown flags;
  `project create` consumes them as positional data.

- **Carried and re-confirmed from round 6:** PC-18 (how much evidence
  the banner requires — now answered by A2, still unstated in a case),
  PC-19 (what may be shown during a retry — answered by A3, same),
  PC-20 (what is owed when on-screen data is known stale but the
  surface is healthy), PC-5 (export field representation, round 6's F4),
  PC-13, PC-6, PC-14/15/17, PC-1.

- **Positive behaviour worth locking in with cases**, verified correct
  this round and currently unprotected: the mid-session outage banner
  against a genuinely killed process (no spec kills a real server);
  the honest "task count unavailable" footer; the malformed-config
  surface naming file + parse location + next action, with row cells
  degrading to a marked "unknown" chip; live config drift adding both a
  project and a custom-field filter without a restart; move-to-project
  reporting `OLD → NEW` per task with old keys still resolving.

---

## What I could not test, and why

- **The strongest sampling resolution.** The browser pane reported
  `document.hidden === true` throughout, which throttles timers and
  suspends `requestAnimationFrame` — one rAF sampler returned **zero**
  frames, which I discarded as inert rather than scoring it as "no
  empty-state frames observed". The `setInterval` samplers did run
  (13–15 samples over 9–14s). The empty-claim findings rest on those
  plus direct DOM reads and screenshots at the decisive moments, not on
  frame counts alone.
- **A 0×0 viewport episode** (the same one round 6 hit) made `read_page`
  return an empty tree mid-run; recovered with `resize_window`. Two
  early clicks landed off-target and I verified with `elementFromPoint`
  rather than trusting them — one is noted in the F1 procedure above.
- **Keyboard-only navigation** — an M4 journey.
- **ERR-3/4/5** — task detail is a stub; no editable field exists to
  fail mid-write.
- **Actual CSV file download** — sandboxed; the export URL was composed
  from the UI's own `href()` builder and fetched out-of-band, then
  parsed with Python's `csv`.

---

## Assessment

**This is the first round in which the previous round's fixes did not
break something.** Rounds 1, 3 and 5 each failed that way, and round 6's
own fixes broke five specs and introduced a lint error. Round 8 finds
neither: 203/203 UI specs, clean lint with the exit code checked
directly, and both round-6 fixes surviving mutation.

The rule that A3 records — *ask what a query has ever done, never what
it is doing right now* — is doing the work. It is now applied in
`AppBootstrap`, `ServerUnreachableBanner` and `Sidebar`, and the three
states that broke the shell in rounds 3, 4 and 5 all behave correctly.
The single most valuable remaining gap is the one round 6 named: **no
spec kills a real server.** I did, by hand, and it passed — but that
assertion still lives nowhere in the harness, so the next regression of
F1 would again be invisible to CI.

The one new finding is minor and, notably, **not** a regression: custom
field sorting has presumably never worked, and it surfaced only because
I added a custom field rather than walking the seeded columns. It is a
gap in the spec before it is a gap in the code, which is why it is
recorded as PC-21 for Ken rather than fixed.

All three agent-made decisions are, in my judgement, correct as
recorded. A2 and A3 in particular read their cases rather than extend
them, and both carry accurate revert paths — I executed both.
