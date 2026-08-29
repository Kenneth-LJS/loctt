# 🚦 Milestone 1 gate — round 6

Verdict: **FAIL**
Date: 2026-08-29 (round 6)
Tree: `cc45c2f`, clean; rebuilt with `npm run build` before the first suite
and again after each mutation experiment. Every browser observation below
is against the built tree served by a real `loctt ui`, not a dev server.

**Round 5's findings are, with two exceptions, genuinely fixed — and I
checked them rather than took them.** F1 (a failed `/api/info` destroying
the app), F3 (the schema-mismatch spinner hang), F4 (a malformed config
reported as "Could not load"), F5 (horizontal scroll at 375px) and F8 (the
uninterpolated `$key`) all reproduce as *fixed*. The `AppBootstrap`
rewrite holds: the shell survives an unreachable server, a schema
mismatch, and a "Try now" press, and the one screen that still replaces
the shell — "No tracker here yet" — is reached only when the server
actually answers `exists: false`.

It fails on something the round-5 fixes introduced.

**When the server dies while the page is open, nothing on screen says
so.** No banner, no alert, no degraded styling — 50 rows of stale data
under an authoritative "Showing 1–50 of 63", with the server dead for
over a minute and a Refresh click already spent. This is the *plainest*
reading of SHL-41 ("Stop the `loctt ui` process while the browser is
open, then click around") and of ERR-1, and it is a regression: the guard
that produces it was added in round 5 to stop a single aborted request
raising a false alarm.

The banner works perfectly on a **cold** load against a dead API. That is
also why every spec passes: all seven of them reach the state through
`page.reload()`, which throws the cache away. None reproduces an actual
outage.

Net for the milestone: **SHL-41 fails, ERR-1 fails on the mid-session
path and passes on the cold path, ERR-2 passes, SHL-13/XS-34/XS-35 pass,
SHL-43 passes.**

---

## Suites

Run strictly one at a time. No build ran while any suite was running,
except deliberately during the two mutation experiments, which were run
alone. `FAIL` counted by grep over full output; Playwright marks failures
with `✘`.

| Command | Exit | FAIL / ✘ | Detail |
|---|---|---|---|
| `npm run build` | 0 | 0 | clean |
| `npm run typecheck` | 0 | **0** | all workspaces |
| `npm run lint` | 0 | **0** | no output |
| `npm run test` | 0 | **0** | 2362 passed, 1 skipped across 6 workspaces |
| `npm run test:integration` | 0 | **0** | 421 passed / 125 files |
| `npm run test:e2e` | 0 | **0** | 21 passed / 11 files |
| `npx playwright test` (run 1) | **1** | **1** | BLK-24 timeout — see below |
| `npx playwright test` (run 2) | 0 | **0** | **202 passed** |
| `npx tsx tools/coverage/main.ts --require <238 M1 ids>` | **1** | — | 3 uncovered, all three parked with reasons — see below |
| `npm run cases:check` | 0 | **0** | index up to date, 937 cases |

### The one UI failure is contention, and I proved it rather than assumed it

Run 1 failed only `BLK-24: select-all on a page stays responsive at 5,000
tasks`, a 30s timeout, at load average 36 and rising.

- Re-run alone at `--workers=1`: **passed in 14.6s** against a 30s budget.
- Full suite re-run: **202/202, exit 0**, at load average **105** — three
  times the load of the failing run.

So this is the load-sensitivity already recorded in `known-gaps.md`, not a
regression. Recorded here because the gate command did exit non-zero once,
and because the round-5 report was itself misled by this suite.

### Coverage: three uncovered cases, all three already parked

`SHL-33`, `SHL-44` and `XS-56` have no `@verifies` tag. All three have a
recorded reason and none is a new finding:

- **SHL-33** — both obvious tests for it are vacuous; documented in
  `known-gaps.md` with what a real test would need.
- **SHL-44** — needs the real `/tasks/$key`, which is M2.1's
  (`TEMP-BUILD-PLAN.md:190`).
- **XS-56** — Ken accepted the error state in place of marked-stale rows.

---

## Journeys

Fixture: `loctt init --prefix T` → 63 tasks with statuses, priorities and
types varied across all four/four/five configured values. Hostile titles:
`<script>alert("xss")</script>`, `=cmd|/c calc!A1`, and a CJK + kana +
quotes + commas title. Served on port 47311. Two further trackers for the
schema-mismatch and no-tracker screens, plus an HTTP proxy that serves the
SPA while refusing `/api/` — which is the exact condition the Playwright
specs create, used to isolate cold-load behaviour from mid-session
behaviour.

All interaction was **real clicks**. `javascript_tool` was used to *read*
— geometry, DOM text, and the live query cache through the React fiber —
and once to drive a `refetchQueries` for a mechanism measurement, which is
noted where it appears. No synthetic click stands behind any finding.

| Journey | Result |
|---|---|
| Land cold on `/list` | **Pass.** 50 rows, "Showing 1–50 of 63". Hostile titles render as text, not markup. No page overflow at 1280px. |
| Sort a column | **Pass.** Priority sorts by configured *rank* (Low → Medium → High → Critical), not alphabetically. URL gains `?sort=priority&dir=asc`. |
| Sort by various columns, incl. custom fields | **Pass, and the round-5 F6 half-fix is correct.** `?sort=nonexistent_field` is dropped from the URL (`replace`, so Back is unaffected), while `?sort=created_at` and `?sort=fields.effort` are **kept** — the shared `isSortableTaskField` predicate agrees with the server. The Fable review's concern that a client-side column list would strip sorts the server honours does not reproduce. |
| Page to the end | **Pass.** `?page=999` returns all 63 rows with an honest "Showing 1–63 of 63" rather than an empty page. |
| Filter, copy URL, reopen | **Pass.** `?status=done` → 16 rows, footer 16 of 16, reproduces from the URL alone. |
| Export CSV with a filter | **Pass.** `?status=done&format=csv` → exactly 16 rows, all `status=done`, RFC-4180 escaping, Unicode intact. **Round 4's D5 guard still holds**: `=cmd\|/c calc!A1` exports as `'=cmd\|/c calc!A1`. Raw ULIDs in reference columns unchanged (round-5 F7, still a minor and already in `PROPOSED-UI-CASES.md`). |
| Reload on every route | **Pass.** `/`, `/list`, `/board`, `/timeline`, `/tasks/T1`, `/tasks/NOSUCH999`, `/settings`, `/settings/general`, `/nonexistent`, `?bogus=1`, `?limit=99999`, `?page=999` all 200. |
| Back and Forward | **Pass.** `/list` → `?status=done` → `/board`, then Back ×2 and Forward: 50/63 ↔ 16/16 reverts and re-applies exactly at each step. |
| Narrow viewport (375px) | **Pass. Round 5's F5 is fixed.** `documentElement.scrollWidth === clientWidth === 375` — no horizontal page scroll. Header fits (theme toggle, create, avatar all reachable), sidebar collapses to an icon rail, table scrolls inside its own container. Round 5 measured `scrollWidth 561` here. |
| Task-detail stub | **Pass. Round 5's F8 is fixed.** `/tasks/T1` renders `Route stub: /tasks/T1`, interpolated, inside the shell. |
| A directory with no tracker | **Pass.** `exists: false` → "No tracker here yet" with the `loctt init` instruction. This is the one state that legitimately replaces the shell, and it is reached only because the server *answered*. |
| **Schema-mismatched tracker** | **Pass. Round 5's F3 blocker is fixed.** `.schema-version` set to `9`: the banner renders **in the shell**, navigation intact, and 25 samples over 3 seconds show `shell` every time — no mount/unmount loop, no permanent spinner. Round 5 measured "Loading…" still spinning at 142 seconds. |
| **"Try now" on the unreachable banner** | **Mostly pass — see F2.** The shell survives, which is the round-5 fix holding. But for ~1s the banner vanishes and the sidebar reads "No projects yet / No milestones yet / No labels yet". |
| **Server killed mid-session** | **FAIL — see F1.** No banner, no alert, nothing. |
| Server restarted (ERR-2 recovery) | **Pass.** With the server back, the six sidebar "Could not load" alerts cleared **on their own** in under 15s — no reload, no click. Recovery works; it is only the banner that never appeared. |
| Malformed `labels.yaml` | **Pass. Round 5's F4 is fixed on all three bullets.** Sidebar reads *"labels.yaml could not be parsed. Retry · or run `loctt doctor`"*; "Show details" reveals the full parse error with `line 4, column 5` and the offending source line; the task list keeps working (50 rows). The Label dropdown now says *"Label options could not be loaded — see the sidebar for why"* rather than round 5's "No options". |

---

## Findings

### F1 · blocker · A server that dies mid-session is completely silent

**Contradicts SHL-41 (bullets 1, 2, 3) and ERR-1 (bullets 1, 2, 4).**
This is a **regression introduced by a round-5 fix**.

**Repro — SHL-41's own words, 100% reproducible:**

1. `loctt ui` on a seeded tracker; open `/list`; let it load (50 rows).
2. Kill the server.
3. Click **Refresh**, or click around, or simply wait.

Measured, after the server had been down for over a minute and a Refresh
click had been spent:

```
banner:      false        ← no [data-server-unreachable]
alertCount:  0            ← no [role=alert] anywhere
rows:        50           ← stale, presented as current
footer:      "Showing 1–50 of 63"
```

The server was verifiably gone at that moment — an in-page
`fetch('/api/info')` threw `TypeError: Failed to fetch`.

**Why, measured rather than argued.** `ServerUnreachableBanner`'s
`recompute` counts a query as evidence *only* when the server has never
answered it:

```js
if (q.state.dataUpdatedAt > 0) { lastSuccess = …; continue; }
```

Replaying that predicate against the live cache in that exact state:

```
totalErrored:        17
everAnswered:        17
erroredAndAnswered:  17
skippedBecauseAnswered: 17
countedAsEvidence:    0
lastFailure:          0     →  wouldShowBanner: false
```

Every query that could be evidence is disqualified by having worked
earlier — which is the definition of a mid-session outage. The banner is
reachable only when *no* query has ever succeeded.

**Confirmed by construction.** Against an HTTP proxy that serves the SPA
but refuses `/api/` — a **cold** load, empty cache — the banner appears
correctly within seconds, the shell stays up, and the footer honestly
reads "task count unavailable" instead of a fabricated zero. So the
banner's rendering is fine; only its trigger is wrong.

**The guard is round 5's.** Its comment explains the intent — a single
aborted page load inside an already-answered query is "a failed request,
not a stopped process". That reasoning is sound for *one* query. Applied
to all of them at once it inverts: seventeen simultaneous
envelope-less failures across every endpoint is the strongest possible
evidence the process is gone, and it is exactly the case the guard
discards.

**Why no suite caught it, and this is the important part.** All seven
outage specs in `flow-app-shell.spec.ts` and `flow-list.spec.ts` follow
the same shape:

```js
await page.route(/\/api\//, route => { void route.abort("connectionrefused"); });
await page.reload();
```

The `reload()` discards the query cache, so every query restarts at
`dataUpdatedAt === 0` — precisely the state the guard requires. And the
route pattern is `/\/api\//`, so the HTML and bundle still load from a
live server, a condition no real outage produces. **No UI spec ever stops
the real server** (`grep` for `kill(`/`server.close` across `tests/ui/`
returns one hit, in the schema spec, for an unrelated purpose).

**Proved in the harness, not just my browser.** I mutated the SHL-41 spec
to drop the `reload()` and click Refresh instead — the case's own "click
around":

```
✘ retrying while the server is still down does not dismantle the shell
  expect(banner).toBeVisible({ timeout: 15_000 })  — timed out
```

Restored afterwards; tree verified identical to `HEAD`.

**Severity.** SHL-41 is a blocker case and this defeats it on its
headline sentence. ERR-1's "must not render the empty state … conflating
them reads as data loss" is defeated in a worse way than an empty state
would be: the screen shows *plausible* data with an authoritative count,
so the user has no cue at all that they are looking at a corpse.

---

### F2 · major · Pressing "Try now" shows an empty tracker for ~1 second

**Contradicts ERR-1 bullet 2.** This is the **fifth** instance of the
`fetchState` trap `known-gaps.md` documents, in a file that entry does not
cover.

**Repro:** reach the unreachable banner (cold load against a dead API),
press **Try now**, watch the sidebar.

Measured from a real click, sampling the sidebar every 40ms:

```
frames sampled over 5.2s
"No projects yet"/"No labels yet"/"No milestones yet" visible: t=243ms … t=1242ms
banner absent over the same window
```

Independently screenshotted: banner gone, sidebar reading "No projects
yet", "No milestones yet", "No labels yet", while the server was still
down. It self-corrects to "Could not load" afterwards.

**Why, measured.** `Sidebar.tsx` decides each group with live status:

```ts
const failed = projects.isError;          // :318, and :393, :516, :550, :586
…
{!failed && items.length === 0 ? <GroupEmpty>No projects yet</GroupEmpty> : null}
```

Driving `refetchQueries(['projects'])` against the dead server and logging
every cache transition:

```
pending/fetching/undef   × 15
error/idle/undef         × 11
```

For those fifteen frames `isError` is false **and** `data` is undefined,
so `!failed && items.length === 0` is true and the empty state renders.
This is exactly the reset `known-gaps.md` describes: `status`, `error` and
`data` do not survive a refetch; `errorUpdatedAt` / `dataUpdatedAt` do.

Five groups share the pattern — Projects, Saved filters, Milestones,
Sprints, Labels. The known-gaps entry predicts this ("If a fifth bug
appears in this file…"); it appeared in a different file.

**Not a blocker** only because it is transient and self-correcting, and
because the shell survives — the round-5 fix for the *shell* half is
genuinely holding. But "a server that is down and a tracker that is empty
must be visibly different screens" is a data-loss claim, and for a second
the app makes the wrong one.

---

### F3 · minor · An unknown `sort` field is accepted by the API

Round 5's F6, unchanged on the server side. Re-measured:

| Query | Result |
|---|---|
| `?dir=sideways` | **400** "Sort direction must be ascending or descending." |
| `?sort=nonexistent_field` | **200**, 63 rows, different ordering |

The **client** half was fixed and is correct (see the sort journey): the
URL is rewritten to drop the unhonourable sort. The API still accepts it
silently, so a direct API consumer gets no signal where a bad `dir`,
`status` or `limit` all get a 400.

---

### F4 · minor · CSV export writes raw ULIDs where the UI shows names

Round 5's F7, unchanged. `project` exports as
`01M14QQHG1BCXN97M197QZSZHD`. Already sitting in `PROPOSED-UI-CASES.md`
as a decision for Ken with four options; recorded here only to confirm it
still reproduces.

---

### F5 · minor · An error state is headed "Loading tasks"

The list's error panel renders, inside `role="alert"`:

```
Loading tasks
The LocTT server is not responding. It may have been stopped in the
terminal where you ran `loctt ui`.
```

"Loading tasks" is `ErrorState`'s `context` prop — "what was being
attempted (ERR-30)" — so the intent is deliberate and the case is
satisfied. But as the first line of a failure notice it reads as a
progress claim, and a screen reader announces "Loading tasks" at the
moment loading has permanently stopped. Phrasing only ("Could not load
tasks" would satisfy ERR-30 identically); no case is contradicted, so
this is graded minor rather than a defect.

---

## Vacuity checks

The brief asked me to doubt the tests behind the fixed findings rather
than accept them. Two mutations, both built and run alone:

- **ERR-2's recovery spec is genuine.** Disabling the 5-second recovery
  poll (`refetchInterval` returning `false` in the error branch) makes
  `ERR-2: the UI recovers on its own` **fail**. The quiesce added in
  `cc45c2f` is doing real work — this is the spec that previously passed
  on retry backoff, and it no longer can.
- **SHL-41's spec is vacuous with respect to the case it names.** Removing
  the `page.reload()` — which the case never mentions and which is what
  makes the state reachable — makes it fail. It tests the cold-load
  banner, not the mid-session outage SHL-41 describes. This is F1.

Both files were restored and the tree verified byte-identical to `HEAD`
(`git diff HEAD -- apps packages tests docs` empty).

---

## Round 5 findings — verified individually

| Round 5 | Status |
|---|---|
| **F1** one failed `/api/info` destroys the app | **Fixed.** Shell survives an unreachable server, a schema 409, and a "Try now" press. |
| **F2** errored query never polls for recovery | **Refuted and pinned.** Recovery measured working; the spec proving it is non-vacuous. |
| **F3** schema-mismatched tracker hangs on "Loading…" | **Fixed.** Banner in the shell, 25/25 samples stable, no loop. |
| **F4** malformed config reported as "Could not load" | **Fixed.** All three SHL-43 bullets now pass, dropdown included. |
| **F5** horizontal scroll at 375px | **Fixed.** `scrollWidth === clientWidth === 375`. |
| **F6** unknown `sort` silently reorders | **Half fixed.** Client drops it correctly; API still 200s. Now F3 above. |
| **F7** CSV writes raw ULIDs | **Unchanged**, by decision. Now F4 above. |
| **F8** task stub prints `$key` | **Fixed.** Interpolates. |
| **F9** UI suite fails under its own parallelism | **Not reproduced as a defect.** One contention timeout in run 1, 202/202 in run 2 at three times the load. |

---

## Behaviour no case covers

Proposed cases only. **Nothing here has been written into
`docs/dev/ui-test-cases/` or `docs/dev/surface-test-cases/`.**

- **PC-18 · No case says how much evidence "the server is not
  responding" requires.** F1 sits in this gap. SHL-41 says "the next
  failed request produces a persistent, visible state" — one request —
  while the implementation demands a query that has *never* succeeded.
  Both readings are defensible from the case text; the guard's own
  comment argues for the stricter one. A case should state the rule,
  because the two readings differ exactly on the most common outage.

- **PC-19 · No case constrains what may be shown *during* a retry.** F2
  lives here. Every surface derived from live query status flickers
  through a data-less `pending` on every refetch, and no case says
  whether a transient wrong claim counts as making that claim. This is
  the general form of PC-16 from round 5 and of four `AppBootstrap`
  bugs; stating it once would retire the whole family.

- **PC-20 · No case says what the UI owes when data on screen is known
  to be stale but the surface is otherwise healthy.** In F1's state the
  rows are real, just old. XS-56 was decided as "show the error state
  instead of marking rows", but that decision assumed the error state
  *appears*. When it does not, there is no rule at all.

- **Carried from round 5, unchanged:** PC-13 (layout below the sidebar
  breakpoint — now moot at 375px, still undecided in principle), PC-5
  (export field representation, F4), PC-6 (unknown query params ignored),
  PC-14/PC-15/PC-17, PC-1 (lexicographic key sort).

- **Positive findings worth locking in with cases.** Verified correct
  this round and currently unprotected: the shared `isSortableTaskField`
  predicate keeping client and server in agreement on `created_at` and
  `fields.*`; the malformed-config surface naming file, parse location
  and next action, with the dropdown deferring to it rather than
  claiming emptiness; `?page=999` returning an honest full set; the CSV
  formula-injection guard; and the 375px layout.

---

## What I could not test, and why

- **Bulk selection across pages, move-to-project, archive/undo.** The
  Claude browser pane reported a `0×0` viewport for most of the session,
  which broke `read_page` and made screenshot-to-page coordinate mapping
  unreliable — two clicks aimed at the table header landed in the
  sidebar. Rather than fake these with `page.evaluate`, which is banned
  and would prove nothing about hit-testing, I left them to the 202
  passing Playwright specs that cover them and to round 5's report, which
  walked them all successfully against the same code. **No M1.4 code
  changed between round 5 and round 6**, so this is a gap in my
  independent confirmation, not an untested area.

- **Actual CSV file download.** Sandboxed. The export URL was composed by
  the UI and fetched out-of-band, then parsed with Python's `csv`.

- **Keyboard-only navigation.** An M4 journey.

- **ERR-3, ERR-4, ERR-5.** Task detail is a stub; no editable field
  exists to fail mid-write.

---

## Assessment

The `AppBootstrap` rewrite is a real improvement and it holds under every
probe I aimed at it, including the three states that broke it in rounds 3,
4 and 5. The rule it now encodes — *ask whether a query has ever settled,
never what its status is right now* — is correct, and where it is applied
the behaviour is right.

The failure is that the rule was applied in `AppBootstrap` and nowhere
else. `ServerUnreachableBanner` reads `dataUpdatedAt` but draws the
opposite conclusion from it, and `Sidebar` still reads `isError` directly
in five places. So the same trap that produced four bugs in one file has
produced two more in the two files next to it, and the more serious of
them is a regression from the round-5 fix rather than an old defect.

The pattern from previous rounds therefore repeats a fourth time, and the
reason is the same one the run workflow already names: **the specs never
run against a stopped server.** Every outage spec fakes the outage with a
route interception plus a reload, and that combination is the one shape of
outage in which the defect cannot occur. Round 5's report said this in its
last paragraph. It is still true, and F1 is what it cost.

The narrowest fix for F1 is to stop treating "has answered before" as
disqualifying evidence — a query that answered and is *now* failing with
no envelope is the strongest signal available, not the weakest. The
narrowest fix for F2 is the rule already written in `known-gaps.md`,
applied to `Sidebar`'s five groups. The most valuable fix is neither:
it is one spec that kills a real `loctt ui` and asserts the banner, since
that is the assertion no test in this repo currently makes.
