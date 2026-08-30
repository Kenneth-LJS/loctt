# The autonomous build plan

How LocTT gets to v1 with an agent running unsupervised.

This sits above [`build-loop.md`](docs/dev/build-loop.md), which governs a single
ticket. This governs the phases, their order, and what each is allowed to
decide on its own.

**For Phase 5, read [`TEMP-RUN-WORKFLOW.md`](TEMP-RUN-WORKFLOW.md) next.**
It settles how the run executes — sections, subsections, which agents
must be fresh, what the section gate is, and the only two things that
stop an unsupervised run. The Status table below is that run's log,
updated after every subsection commit rather than at section end.

## The problem this solves

An agent that writes the requirement, the test, and the implementation
has no external check on any of the three. This repo has already produced
fourteen tests that encoded a bug as intended behaviour — present,
passing, asserting what the code did rather than what the case required.

Every rule below keeps at least one of those three out of the agent's
reach.

---

## Vocabulary

**Case** — one acceptance criterion. 937 exist, across the 30 flow docs
in [`ui-test-cases/`](ui-test-cases/) and
[`surface-test-cases/`](surface-test-cases/). Prose describing observable
behaviour, with a stable ID:

```
### LST-13 · M1 · blocker · P2 P9
**Loading more appends rows rather than replacing them.**
```

**Flow** — a file grouping related cases. `flow-list.md` holds the list
view's; `flow-tasks.md` holds task detail's.

**Ticket** — a unit of build work. 21 exist, in
[`TEMP-WEB-TICKETS.md`](TEMP-WEB-TICKETS.md), e.g. `M2.1 · Task
detail — read shell`.

A test claims a case with `// @verifies LST-13`.
`cases:coverage --require LST-13` exits non-zero if nothing tags it.

---

## Status

**Updated at the end of every phase, and whenever a phase's state
changes.** An agent picking this up mid-run reads this section first.

Legend: ⬜ not started · 🔵 in progress · ✅ done · ⛔ halted

| Phase | State | Notes |
|---|---|---|
| 1 · Partition | ✅ | All 21 tickets carry a `Cases:` line; gate passes. The 28 cases asserting two unticketed views are **resolved as a ticket gap**, not a scope cut — see *Blocker, resolved*. |
| 2 · Measure | ✅ | Measured (CLI 17/49, MCP 26/75) and the blocker it raised is **cleared**: both reference docs corrected to the shipped API, every example executed. See *Blocker 2, resolved*. |
| 3 · Surface gaps | ✅ | **68 of 68 closed**: blockers 23/23, major 29/29, minor 16/16. Surface coverage 46 → 111. See *Phase 3 log*. |
| 4 · Structural audit | ✅ | **Groups A–F closed, the six swallowed-error findings with them, and the nine recorded decisions implemented** (2026-08-17). The two items previously listed here as open are now closed too: the MCP comment tools' bare catches (`a0677b4`) and `HistoryEntry`'s missing schema (`4fb7e4b`). Group G moves to Phase 6, itemised at 55 rather than the "~79" carried before. |
| 5 · UI build | 🔵 | **M1 through its gate** (round 8: 0 blockers, 0 majors). **All of M2 committed** (2.1 through 2.5b). **The M2 gate is next.** Coverage **449/937**, UI suite 329. Four core defects surfaced by probing before building — an unreadable `task.md` reporting as "task not found", an orphaned enum freezing every write to a task, plus `bodyToken` and `unarchiveView` built in core with no callers. |
| 6 · Cleanup | ⬜ | Group G's 55 items and the flakiness diagnosis. Deferred deliberately — see *The open items*. |

### ✅ Blocker — RESOLVED 2026-08-16: two views need tickets, not a scope cut

The partition placed 837 of 869 UI cases cleanly. **32 could not be
placed**, 10 of them blockers. Four are one-off dependency gaps; the other
28 are one structural problem, found independently by three agents that
were working on separate milestones and could not see each other's output:

| Cases | What they specify | What exists |
|---|---|---|
| 15 `SPR-*` (M3) — 4 blockers | A **sprints overview**: one column per sprint, ordered by start date; drag between columns writes the task's `sprint` field | Only `/sprints/$key` **detail**, in M4.7 |
| 13 `MSL-*` (M4) — 4 blockers | A **Milestones view** (row per milestone, target date, progress bar) and a **milestone detail route** | Only the Settings → Milestones management panel, in M4.3 |

Verified directly against the prose and the code, not taken from the agent
reports: `SPR-1` says *"The sprints view renders one column per
non-archived sprint"*; `MSL-1` says *"The Milestones view lists every
non-archived milestone with its target date and progress bar"*. No
`/sprints` overview or `/milestones` route appears in any of the 21
tickets, and `apps/web/src/client/routes/` contains only `Stub.tsx`.

The sprint split is clearly deliberate in the spec: every M3-tagged `SPR`
case is about the overview, every M4-tagged one about the detail. So the
spec assumes an overview the ticket list never planned.

**Resolved.** I had weighed `temp-ui-mockups/` as evidence the views were
never scoped. The user's ruling: *"the temp-ui-mockup should not be used
as the source of truth for the features."* The mockups are one design
artifact and an incomplete one; the case docs are the specification.

So these are **specified features with missing tickets** — a gap in
`TEMP-WEB-TICKETS.md`, not a question about scope. The 28 cases stand.

Direction given: derive the tickets, have an agent review them, then
build under the normal loop. One adjustment made to that, and agreed in
the same exchange: the tickets are **derived from the existing cases**,
not written as fresh requirements. The 28 cases already *are* the
requirements — authoring a second, agent-written spec beside them is the
self-grading failure this plan exists to prevent. What is missing is only
the build-work unit: routes, components, and which cases each owes.

The other four unplaceable cases:

- **ERR-3, ERR-4** (M1, blockers) — need an in-flight single-field write
  whose outcome is unknown. No M1 ticket has an editable field; task
  detail is M2.
- **ERR-23** (M2) — needs the create modal's partial-failure path (M3.4).
- **PRU-4** (M1) — asserts create-modal defaults (pre-select, key preview,
  submit). M1.1 ships that button as an explicit stub.

These four are milestone-tag problems rather than missing tickets: the
behaviour is ticketed, just later than the case's tag implies.

**After the review**, ERR-3 and ERR-4 came off this list to M2.2 — the
partitioning agent had scoped its search to M1, where no editable field
exists, and stopped there rather than looking forward. 30 remain
unplaceable, 28 of them the two missing views.

### Phase 5 run log

Written after every subsection commit, per
[`TEMP-RUN-WORKFLOW.md`](TEMP-RUN-WORKFLOW.md). Newest last.

| Ticket | Subsection | Commit | Cases | Notes |
|---|---|---|---|---|
| M1.4 | 1 · entity pickers | `2ca36cb` | BLK-7, BLK-8 | Coverage 111 → 113. Six mutations; two of my tests were vacuous and a fresh review agent found two more. |
| M1.4 | 2 · move to project | `e541456` | BLK-9, BLK-26, BLK-31 | Coverage 113 → 116. Found a live API defect and introduced one regression; review caught eight things. |
| M2.4a | comments | *(uncommitted)* | 12 of 12: CMT-1..12 | Every route already existed; this is the client. Composer and edit both reuse M2.3's `RichEditor` / `RichBuffer` rather than a second editor. **CMT-3 and CMT-7 pull opposite ways on one surface** — reopening an edit must show markdown source, and the `@` picker is a ProseMirror affordance — so an edit opens raw and the composer opens rich, both with M2.3's toggle (A?). **The reload in CMT-10 made it vacuous and it was proved so**: caching the mention resolution in a module map left it green, because a reload throws the cache away. Replaced with a real hidden → visible refocus; the same mutation now turns it red. Rendering is React elements throughout — no `dangerouslySetInnerHTML` anywhere on the path — so CMT-22's injection is structurally absent rather than filtered, and the one attribute sink (`href`) takes a scheme allowlist. Two defects I introduced and fixed: the composer did not clear after a post (an effect ran after the remount it was meant to seed), and the comment body stored a trailing newline. Nine M2.3 body specs went red on a bare `getByTestId("rich-editor")` that stopped being unique once a second editor was on the page — locators scoped, behaviour unchanged. **CMT-10's fourth bullet is not satisfiable**: there is no `mentions` field in the query DSL and no comment-scan endpoint, recorded in `TEMP-RUN-WORKFLOW.md`. |
| M2.5b | attachments | `12932d0` | 7 of 7: REL-35..41 | **M2 complete.** A live defect found and deliberately not fixed: attachment names **alias by case on macOS** — `DELETE .../DROP.TXT` returns 204, deletes `drop.txt`, and logs a removal naming a file that never existed. Found because a `.toUpperCase()` mutation stayed green; left alone because no case covers case-folding and the fix changes what CLI and MCP accept. Also **a mutation that did not mutate**: neutralising `basename` in `multipart.ts` left REL-36 green, because core's guard is the load-bearing one — verified by uploading `../../../ESCAPED.txt` with the web guard gone and watching it land safely. The redundant line stays; the overstating *comment* was fixed. Coverage 442 → 449. |
| M2.5a | relationships | `c9d6c5c` | 35 of 44: REL-1..15, 21..34, 42..46, XS-25 | **A blocker: a dangling link could not be unlinked from *any* surface** — 404 from the web route, exit 1 from the CLI, a raw ENOENT 500 from core. The one operation for cleaning up after a deletion was the one a deletion made impossible. The agent fixed core and the route; **I measured all three and the CLI was still broken**, so a core fix only one surface could reach. Fixed and covered by a test asserting through the CLI specifically. The agent also **rejected two of its own mutations** for going red on a `waitForResponse` timeout rather than the assertion. REL-31's own phrasing does not reach its premise (re-dropping on the same anchor is a measured no-op) and the case had no test anywhere. REL-33's second bullet stopped rather than narrowed. Coverage 409 → 442. |
| M2.4b | activity feed | `1ae1761` | 16 of 27: CMT-13/14/15/16/17/19/26/27/28/29/30/31/36/37/38, XS-53 | **CMT-31 was vacuous and my own probe had said otherwise.** Playwright inherits the host timezone, which equals the workspace's — so the workspace-timezone lookup could be deleted and the spec stayed green. Verified both halves: pinned spec red on the defect, unpinned original green against the same broken code. Generalised in known-gaps: any spec about *which clock the app reads* must pin a differing zone. It also corrected my CMT-37 note — a file with one broken row read back as a **complete, shorter history** no client could question (A17). Two of its own mutations were **inert, not survived**, caught by probing the mutated bundle. CMT-18 stopped rather than decided: a tab shell would move sections four tickets already built into. Coverage 394 → 409. |
| M2.4a | comments | `9966c2b` | 12 of 12: CMT-1..12 | **CMT-10 was vacuous as written and the agent proved it** — caching the mention resolution left it green, because its `page.reload()` rebuilds the JS context and throws the cache away. The XS-1 defect in a new place. Replaced with a real refocus; confirmed here by freezing the `useMemo`. CMT-22 asserts what the DOM *contains* with a paired positive, and rendering is React elements throughout, so injection is structurally absent rather than filtered. Two defects caught by specs asserting the far end (`_comments.yaml`, not the screen). Nine M2.3 specs were **narrowed** (not weakened) for a locator the page outgrew. Decision A16. Coverage 379 → 394. |
| M2.5a | relationships | *(uncommitted)* | 35 of 44: REL-1..15, 21..34, 42..46, XS-25 | Rendering and interaction; the API was in good shape. **Two live defects found and fixed, both blockers for REL-24/44**: a relationship whose target was deleted out of band **could not be unlinked from any surface** — the web route resolved the target first (404) and core's `unlinkTask` then read it unguarded (raw ENOENT → 500), so the one operation for cleaning up after a deletion was the one a deletion made impossible. Fixed in core plus the route, with two tests and a `? ` decision. **REL-31 had no test anywhere** — `reorder.test.ts` never mentioned rebalancing — and the case's own phrasing does not reach it: re-dropping the same row on the same anchor is a **no-op** after the first (measured), so the rank never grows. Two leapfrogging rows do, and the test says so. **REL-32's first two mutations were rejected, not scored**: both turned it red on a `waitForResponse` timeout rather than on the convergence assertion, which is a red for the wrong reason; the spec was restructured to assert only the outcome, and the third mutation fails it at the "an order neither user chose" check. **One defect I introduced, caught by REL-44**: a refused remove on a group's *last* row unmounted the section a frame after the message appeared, so the user was told nothing — errors for vanished groups now render at panel level. `loctt link` rejects the inverse side of a relationship the API accepts (`known-gaps.md`). 9 not claimed: REL-16..20 and 47..50, every one an attachment case, which the M2.5 probe assigned to M2.5b. **REL-33's second bullet is unimplemented at the API layer** — `reorderRelationship` never reads `ranked`, and a rerank on a kind switched to `ranked: false` answers 200 and writes a rank; its other two bullets are covered. Unit 2521 → 2547, UI 290 → 320. |
| M2.4b | activity | *(uncommitted)* | 16 of 27: CMT-13, 14, 15, 16, 17, 19, 26, 27, 28, 29, 30, 31, 36, 37, 38, XS-53 | The data was already there (probe); this is rendering, with **one server change**. **CMT-37's second bullet was not satisfied** despite the probe recording it as such: `readHistory` drops malformed rows and reports nothing, so a file with one broken entry read back as a *complete, shorter* history — the route now reads rows and reports `unreadable` (A?). **Two mutations were inert, not survived, and were caught rather than scored**: a non-consecutive bulk grouping is unreachable from a reverse-ordered fixture through the branch I first mutated, and the "no `bulk_op_id` never collapses" rule needed *two adjacent* no-id entries before any mutation could break it — the spec's fixture was widened. **CMT-31 was vacuous and proved so**: Playwright inherits the host zone, which here equals the workspace's, so deleting the workspace-timezone lookup left it green; the spec now pins the browser 21 hours away and the mutation turns it red (`known-gaps.md`). **One defect I introduced, caught by CMT-38**: `useInfiniteQuery.isError` is true for a failed *next* page, so a failed "Load more" replaced the 50 loaded entries with a full-panel error — the inverse of the case's first bullet. Guarded on `data === undefined`. Grouping never sorts (A?), so CMT-30 holds structurally rather than by a stable-sort accident — and the test file records that a stable descending sort is *correctly* undetectable. 11 not claimed: CMT-18 (needs a Comments/Activity tab shell nothing has built — both sections are stacked on one page today), CMT-20–25 and CMT-32–35 (all comment-surface behaviour: 80-comment pagination, mention/injection round-trips, post/edit/delete failure paths — M2.4a built the surface and this ticket built no part of them; CMT-21, 22 and 35 have partial unit coverage from M2.4a). Unit 2463 → 2503, UI 276 → 290. |
| M2.3 | body editor | `296bc19` | 13 tagged: TSK-15/16/17/18/25/35/38/40/48, XS-11/12/13/14, ERR-12/27 | **TSK-17 changed the ticket.** "Byte-identical round-trip" cannot be met by any markdown→AST→markdown pipeline — markdown is many-to-one (`_em_`/`*em*`, `-`/`+` bullets, `1.`/`1)`), so a serializer rewrites every body written in the other spelling the first time the user *glances* at the rich tab. Markdown is the buffer and the rich view a projection; unedited toggling is a **no-op**, so byte-identical is the absence of a step. Verified: serialize-on-read turns 12 tests red. **K2's precondition is wired and measured** — stale write refused with `conflict`, the other writer's content intact. Three more vacuous tests caught by the agent itself, and it broke TSK-19 with a `role="status"` collision and said so. Coverage 364 → 379. |
| M2.2b | failure and concurrency | `1445ea3` | 11 of 11: TSK-29/34/46/47, ERR-3/4/43, XS-4/7/8/57 | **The agent caught three vacuous tests of its own** and a defect it had introduced (`Row` defined inside `MetaPanel`'s render — a new component type each render, so an open editor lost its draft on any refetch, which is what XS-4 forbids). Three source fixes fell out, A11–A13. The asymmetry worth keeping: sending 10 extra frontmatter keys turns XS-7 and TSK-34 red while **XS-8 stays green**, because XS-8 asserts outcomes and extra keys do not change the outcome — proof that asserting the *request body* is what makes those cases real. Coverage 353 → 364. |
| M2.2a | meta panel pickers | `6b206ed` | 28 of 31, incl. TSK-4..14, XS-26/27/42/46/54, VUE-30 | Every meta row editable. **Every picker test asserts the far end** — the value read off disk or through the CLI, never off the screen, which is the shape that made LST-16 and VUE-6 vacuous in M1. The agent found the orphaned-value core defect **independently and from the opposite direction** (building pickers while I probed M2.2b), and its reproduction was better than mine: it hit the *custom field* variant, so the defect was never only about statuses. It also caught a vacuous test of its own (it had delayed *requests*, which the server's state lock reorders anyway, so the test asserted nothing — rewritten to delay *responses*), and **stopped rather than inventing scope** when TSK-12's fourth bullet turned out to need a `CustomFieldDef` field that does not exist. XS-26 had to be rewritten on merge: it was asserting the bug. Coverage 325 → 353. |
| — | core: orphaned values | `46507e8` | TSK-29 (partial) | An orphaned enum or custom-field value **froze every write to the task, from every surface**. Found twice independently within an hour. Fixed by scoping validation to the field being written; verified on CLI and web, mutation-proved (six tests red on a compiling mutation). |
| — | core: unreadable task | `e4d4056` | TSK-54, XS-51 | An unparseable `task.md` reported as **"task not found"** — a failure wearing an absence's clothes, ERR-1's exact prohibition. Two paths (500 when indexed, 404 when not), one cause. Now names the path and the parse position, on all three surfaces. |
| M2.1 | task detail read shell | `aaf2bab` | TSK-1, 2, 3, 19, 22, 23, 24, 44, 45, 50, 52, 53; XS-58; ERR-7, 8; SHL-44 | **Committed.** Built by an agent, reviewed by another, with two more fixing what the review found — the first ticket under the delegated-build rule. Coverage 309 → 325. 13 tests, 216 UI total. The build found **two real defects by testing, not inspection**: opening a task left the sidebar showing "No recent tasks" (the server pushes, but nothing invalidated the query that reads it), and — worse — a task deleted in the CLI still rendered its **full detail page from cache**, live-looking More menu and all, for a task with no directory on disk (XS-58). I confirmed both independently by mutation. The build also caught a vacuous test of its own before reporting: its first XS-58 used `page.goto`, a full page load that wipes the cache, so a build serving stale tasks still passed. The review then found a **blocker the build missed** — `useMoveTask`'s failure check has zero coverage, and deleting it leaves all 13 green while a failed move reports as success. And it corrected the handoff on TSK-54/XS-51 from "not covered" to **contradicted**. |
| 🚦 M1 | **gate round 8 — PASS** | `f8624aa`, `0cfb6ab` | — | **M1 is through the gate.** Eight rounds; zero blockers, zero majors, two minors, both fixed. The gate earned the verdict: it **mutated** both round-6 fixes rather than reading the diff, killed a real `loctt ui` with the page open (the procedure seven specs miss), and independently re-measured the claim decision A1 rests on. It upheld all three agent decisions. **F1**: sorting by `fields.*` was a silent no-op — accepted, kept in the URL, shown as applied, identical order both directions. My round-5 predicate said `fields.*` was sortable; the resolver could not read it. **F2**: `project create --name X` created a project called `--name`, and the same hole was in all five entity commands. |
| 🚦 M1 | round 7 abandoned + repairs | `2b86fd6`..`3b0e33b` | LST-4, LST-21, ERR-19, ERR-21, ERR-41, ERR-42 | **No verdict, correctly.** I kept committing into the tree the gate was auditing, so its results described a tree that no longer existed; it also stashed my uncommitted work, which is silent because `git status` reads clean and a stash is not a checkout. One mistake, two agents in one tree — the rule is now in `TEMP-RUN-WORKFLOW.md` § "The gate runs alone". Its one real finding was a `require-await` error my F2 fix introduced, **and the reason I missed it is worse**: `npm run lint` was crashing with a V8 OOM while `grep -c error` on the crash dump printed 0, so I reported "lint clean" three times from a command that never completed. The OOM was mine too — six sweep worktrees, 1.9GB, eslint walking all of them. Six vacuous tests repaired meanwhile: the error headline now has 5 of 16 tests watching it rather than 1. |
| 🚦 M1 | vacuity sweep + round 6 | `20cdf85`..`9a21b22` | SHL-41 | **The sweep found 27 vacuous tests of 186** — six agents, one per case-prefix, each mutating every test in its group. Four recurring shapes, written up in `gates/M1-vacuity-sweep.md`. **BLK is the only group with none (0 of 56)** — the M1.4 tests, the only ones built under the disciplined loop. Round 6 returned **FAIL**: F1 (blocker) is the banner never firing when the server dies with the page open, which seven outage specs missed because every one of them reloads and a reload empties the cache the bug lives in. F2's fix is in but **unproven** — handed to Fable. F3 declined as decision A1; the gate's supporting measurement did not reproduce. |
| 🚦 M1 | Fable review fixes | `8ba3aec`..`c351586` | ERR-2, BLK-42 | Reviewed the round-5 fixes adversarially and found **three defects the gate had passed**, two of them regressions from my own fixes: the sort predicate dropped sorts the server honours, `AppBootstrap` still dismantled itself on retry, and a broken config lost its parse position in the CLI. Also caught that I had claimed nine findings closed when F2 was never touched, and that a 409 lock conflict was being treated as permanent when BLK-42 says it clears. **The common cause is recorded in known-gaps.md**: `fetchState` un-says a settled error on every refetch, which is the trap behind four separate `AppBootstrap` bugs. |
| 🚦 M1 | round 5 fixes | `8ebcf15`..`ad14b26` | SHL-43, LST-29 | Six findings fixed, one declined, two did not reproduce — **not nine closed, as this row first claimed**. **Two blockers, both mine**: a failed `/api/info` destroyed the app (F1), and fixing that created a mount/unmount loop that hung the schema banner (F3). |
| 🚦 M1 | gate round 5 | `bf90537` (branch `gate/m1-round5`) | — | **FAIL.** 2 blockers, 2 majors, 5 minors. Suites all green except the UI one, which the gate read as self-contention — it was a concurrent rebuild. |
| 🚦 M1 | root cause | `72b1a5d` | ERR-1, ERR-2 | A **fable agent** found what three rounds missed: a paused query, not a predicate. See below. |
| 🚦 M1 | gate round 3 | `ecd2f8b` | — | **FAIL.** One blocker, mine, from round 2's fix. My predicate made the error branch unreachable. |
| M1.2 | verification | ten batches | 59/60 | Fifteen real defects in code marked ✅. MSL-22 unblocked by Ken; XS-56 accepted as-is; PRU-3 moved to M4.1. |
| M1.3 | verification | six batches | **45/45** | LST-16 (custom-field filters did nothing), LST-29 (I had built a 400 where the case wants a fallback), MSL-6 (label pills were not clickable), MSL-19 (40 labels, no typeahead). |
| M1.4 | verification | three batches, `fb5c044`..`348371c` | **62/62** | Two live defects: the export silently dropped unreadable tasks, and the delete confirmation asked the same word for 2 tasks as for 1,280. BLK-30's threshold is mine, not a case's — recorded in PROPOSED-UI-CASES.md. |
| M1.1 | verification | eight batches, `f081792`..`f694265` | **69/71** | Nineteen live defects. The schema banner was unreachable in every state it describes; a crashed migration reported as healthy; blocked localStorage blanked the app before first paint; there was no error boundary anywhere, and when added at the root it took the shell with it; nothing restored scroll; the theme flashed on every reload. Three of my own mechanisms survived their mutation tests and were deleted. |
| 🚦 M1 | gate round 2 | `12d93c8` | — | Confirmed 3 of 4 round-1 fixes. Found the stale-filter guard, plus two bugs in my own responsive change. Still **FAIL** pending round 3. |
| 🚦 M1 | gate round 1 | `6a8cb49`, `a395023` | — | **FAIL.** 4 blockers: every entity filter 400'd, moved keys did not resolve, no responsive handling, one non-reproducing. |
| M1.4 | 5 · remaining BLK cases | `9cae899` | BLK-6, 17, 19-21, 25, 27-29, 36, 40, 43, 46-48 | **M1.4 complete.** Four live defects incl. BLK-40, red since it was written. UI suite 65/65 for the first time. |
| M1.4 | 4 · concurrency + scale | `c4812bb` | BLK-22, 23, 24, 34, 41, 42 | Three live defects: ULID in a failure message, raw proper-lockfile error, unbounded hung request. Review found six more. |
| M1.4 | 3 · archive undo | `6b16801` | BLK-10 | The ticket's premise was wrong — archive never had a typed confirm. Undo + archived badge built instead. Fixed an intermittent I introduced in subsection 2. |
| M2.6 | duplicate | *(uncommitted)* | 1 of 1: TSK-20 | **The `(copy)` suffix is core's, not the CLI's** — the ticket brief and the M2.6 probe both attribute it to the CLI's `overrides`; `duplicateTask` reads `title: overrides.title ?? \`${fm.title} (copy)\`` and the CLI and MCP both merely inherit it. That inverts the decision: titling the web copy identically would make web the only surface overriding a documented core default. Recorded as **A24** with a one-argument revert. Built: `POST /api/tasks/:ref/duplicate`, a `useDuplicateTask` hook, a More-menu item, and navigation to the copy's *server-allocated* key. Five tests, each shown to fail: dropping `saveState` reds the repeat-duplicate key test; returning the source's frontmatter reds two; swallowing the 404 into a 200 reds the third; appending to the source after the copy reds the "original unmodified" assertion at **both** layers; removing the menu item and removing/misdirecting the navigation red the two UI specs. **One assertion I could not prove**: the 404 test also asserts `state.yaml` is unchanged, and I could not make that half fail independently — deleting the pre-lookup guard leaves it green, because `duplicateTask` throws before allocating and `saveState` is skipped. It is belt-and-braces, not load-bearing; the status assertion is the real one. Also: the stated unit baseline of 2551 is stale — the tree measures **2554**. Unit 2554 → 2557, UI 332 → 334. |
| M2 gate r3 | section gate | `479d5ae` | — | **FAIL → 1 of 2 blockers closed.** **B1 (fixed):** round 2's F5 fix reached the CLI and MCP but not the web *client* — `attachmentsError` was serialised by the server and read nowhere, so an unreadable directory rendered "No attachments on this task yet." while the activity feed said a file was attached. REL-49 read as *covered* on four `@verifies` tags, all four in core, none rendering a page; no UI test `chmod`ed a directory. Fixed in `AttachmentsPanel` + `TaskDetail`, recorded as **A25**, with the first UI test for REL-49 — red when the call site drops the prop. **B2 (open, Ken's):** K2's body-write precondition is web-only. `bodyToken`/`expectedToken` appear in `apps/web/src/server/server.ts` and in neither `apps/cli/src` nor `apps/mcp/src` (positive control run); core's own docstring says "Omit for last-write-wins, which is what every existing caller gets." K2's rationale names the CLI and MCP as *the threat*, so the guard protects the web editor from itself while the two surfaces it was written about write unguarded. Fixing it changes behaviour on two published surfaces — load-bearing, so it stops the run. **Gate method note:** zero vacuous tests found, but by scripted sweeps plus two close readings, not a full 334-test mutation — the report says so rather than implying a clean sweep. Also fixed: the CMT-10 flake, a 31s sleep against a 30s `staleTime`; it now waits on the refetch, and still reddens when a resolved name is cached. One suite failure was **my own build racing the run** (`dist/index.js` briefly absent), not a defect — 59/59 on re-run. |
| M3.1 | board view | `8583f4d` | 29 of 29: BRD-1..8, 14..24, 33, 39, 40, 45..48, ONB-11, MSL-5, MSL-20 | **A real defect the ticket did not ask for, found by writing the BRD-21 test**: the board rendered a 900-task column under a header reading `200` — page-size-as-total, which BRD-21's first bullet rules out and which would have made the board disagree with the list's count for the same filter (BRD-24). Measured at 200, fixed by exhausting the feed, re-measured at 900; **verified by my own mutation** (stop after page 1 → red). **BRD-45 implements Ken's ruling**: validation stays strict, the board renders the refusal — file, column index, duplicated status, how to fix — and asserts it does *not* silently fall back to 1:1 columns; verified by my own mutation (guard unreachable → red). Its "falls back to 1:1" bullet is unreachable by design and recorded. **Not built, deliberately**: MSL-20's `+N` hover-card (needs a popover component no case authorises — Ken has not approved it), BRD-21's two drag bullets and BRD-40's create modal (both other tickets). **Already built, found before rebuilding**: `LabelsCell`'s `+N` overflow and contrast helper, `useMainScrollRestoration` for BRD-8, and the `config_invalid` envelope, which already named the file and column. Decisions **A26** (chip visibility stores *hidden* columns, so a newly configured column is not silently hidden) and **A27** (200-row pages). Layer: all presentation stayed in the web client — a column is not a concept the CLI or MCP has. **A method error of mine**: I twice read "mutation absent from `apps/cli/dist/index.js`" as evidence it was dead, but the client is not bundled there and its local names are minified away, so that grep cannot succeed either way. The mutation was live; the test going red is the only honest check for client code. Unit 2557 → 2584, UI 334 → 364, coverage 455 → 487. |
| M3.2 | board drag-drop | `771bb1f` | 23 of 24: BRD-9..11, 13, 25..32, 34..38, 41..44, 49, XS-9 | **`setFields` got its first caller on any surface** — CW-5's atomic status+rank write; the route had been calling the singular `setField`, one field per request, and two writes where the case demands one leaves a card in a column its status contradicts if anything fails between them. `board_rank` is auto-managed so `setFields` refused it; rather than un-manage the field for every caller, an opt-in `allowAutoManaged` grant (empty by default) is passed a named constant holding exactly `board_rank`, so it is greppable and cannot quietly widen — `completed_date` stays server-computed on every path. **BRD-31 fixed in core**, the defect the case names outright: a no-op drop wrote history and bumped `updated_at` while the rank never changed. Measured before (rank `u`, history 2→3, `updated_at` advanced) and after (nothing written); **verified by my own mutation** — a guard that can never match reddens `reorder.test.ts`, and the CLI repro confirms CLI and MCP inherit the fix. **A defect the agent introduced and caught itself**: the no-op check first compared indices, but a held card leaves the flow, so cards below shift up and a pointer held still resolves one slot lower — sending exactly the write BRD-31 forbids; it now compares neighbour pairs. **BRD-12 cannot be satisfied — awaiting Ken.** A column may collapse several statuses, but `reorderBoardRank` scopes rank per status and refuses a sibling-status anchor (the recorded SPR-C2 fix, whose premise "a board column is a status" `workflow.boards` made false), so the board renders an order no drag can produce. Marked `test.fixme`, not `skip`: it runs and is expected to fail, so it starts passing loudly when core is fixed. **BRD-21's two drag bullets not built** (no virtualization to drag from, no edge auto-scroll); BRD-21 deliberately not tagged. Decisions **A28–A30**. **A method error of mine**: an `&& false` mutation made a branch unreachable and changed an inferred type, so the build failed and that run proved nothing — redone with one that compiles. Unit 2584 → 2609, UI 364 → 385 (+1 `fixme`), coverage 487 → 508. |
| M3.2 | board drag-drop | *(uncommitted)* | 23 of 24: BRD-9, 10, 11, 13, 25..32, 34..38, 41..44, 49, XS-9 — **BRD-12 blocked** | **BRD-31 was a real core defect and is fixed**: `reorderBoardRank` had no same-position guard, so a no-op drop rewrote `task.md`, advanced `updated_at` and appended a `rank_changed` entry whose `before` and `after` were the same string. Measured on the CLI (rank `u` both times, history 2 → 3), fixed in core so the CLI and MCP inherit it, re-measured to nothing-written (**A28**). **CW-5's atomic write is built on `setFields`, which had no caller**: a new `POST /api/tasks/:ref/board-move` writes `status` and `board_rank` in ONE change set; `board_rank` is auto-managed, so `setFields` gained an opt-in `allowAutoManaged` grant rather than the field being un-managed for everyone (**A29**). Verified on disk: one request, both fields, one history batch sharing a timestamp, and a concurrent `assignee` untouched (XS-9). An intra-column reorder still goes to `board-rerank` with **no** `status` key. Drag is pointer-events, not a new dependency (**A30**). **A defect I introduced and the spec caught**: `isNoOpDrop` first compared indices — while a card is held it leaves the flow, so the cards below shift up and a pointer held perfectly still resolves one slot *lower* (measured: origin 1, resolved 2), sending a write BRD-31 forbids. Fixed by keeping the dragged card's box in the column (BRD-11's placeholder) and comparing neighbour *pairs*. **A mutation that survived**: comparing only one neighbour passed my first `isNoOpDrop` tests, so a test was added that kills it. **BRD-12 cannot be satisfied and is `test.fixme`**: core scopes `board_rank` per *status* and refuses a cross-status anchor (the SPR-C2 fix, with two tests asserting it), while `workflow.boards` makes a column a *set* of statuses — the two layers disagree on what a column is. Fixing it changes CLI and MCP behaviour and contradicts a recorded decision, so it is reported, not decided (`known-gaps.md`). **Two fixtures of mine were wrong, not the code**: BRD-26 dragged the bottom card to the bottom (correctly a no-op), and the BRD-28 rebalance loop re-dropped against one anchor, which the new guard makes a fixed point. Unit 2584 → 2609, integration 427, e2e 21, coverage 487 → 508. |
| M3.3a | timeline view — rendering | *(uncommitted)* | 14 of 17: TML-1..8, 12 (snap math), 13..17 — **TML-9, 10, 11 are M3.3b's** (drag writes) | **A core defect fixed, and it is the reason TML-34 was unsatisfiable**: `autoClearTimelineDependency` *silently deleted* `timeline.dependency_relationship` from the user's own `workflow.yaml` whenever the value named a key not in `relationships` — its docstring called this deliberate. Measured before: set `blocks`, remove `blocks` from `relationships`, and the line is **gone** from disk. TML-34 requires the opposite — "a visible configuration notice **naming the missing key**" — which is impossible once the name is erased. The auto-clear is removed; the dangling value now survives (verified on disk, through the parser, and via MCP `get_workflow_config`), and `dependencyRelationshipStatus` returns `{kind: missing, key}` so M3.3b's notice has something to name (**A31**). **Two green tests were asserting the bug** and were inverted — "drops timeline.dependency_relationship when the referenced key is gone" and "preserves new timeline fields when dependency_relationship is auto-cleared", both of which asserted `undefined`; the first now also reads `workflow.yaml` off disk. CLI (`doctor`, `create`, `list`, `link`) and MCP verified sane against the dangling state — `link` refuses the removed relationship with a clean message rather than crashing. **Geometry is unit-tested as arithmetic, not as "a bar is visible"**: 31 tests over inclusive spans, the `dateToX`/`xToDate` inverse pair, DST boundaries (all day math is exact UTC multiplication, so a spring-forward day is still one column), leap years, and `first_day_of_week`. **The invariant that earns its keep** is TML-7's "the total row count is identical across all groupings" — it only holds because every grouping has an explicit absent-value band, and deleting that band reddens six tests including this one. Decisions **A32** (zoom/grouping/arrows in the URL, collapse local — TML-6 only requires collapse *not* change task scope, which local state gives by construction) and **A33** (shading at day/week only, the literal reading of TML-13's first bullet; 104 stripes at month zoom is noise). **Ten unit mutations + six UI mutations, each reddening its target with `npm run build` exiting 0.** **Two of my own fixtures were wrong, not the code**: `query: "true"` is not valid DSL, and `milestone create` takes a positional name, not `--name`. **A docs gap found, not fixed**: neither `boards` nor `timeline` was in schema-reference's `workflow.yaml` table; `timeline` is now documented incl. the dangling contract, `boards` is logged in `known-gaps.md`. Unit 2609 → 2677, coverage 508 → 522. |

**Verifying the ✅ tickets — where the run is now**

M1.1-M1.3 were marked done before any ticket declared its cases.
Working through them case by case, per Ken's instruction to verify all
110.

| Ticket | Was | Now |
|---|---|---|
| M1.1 | 1/71 | **69/71** |
| M1.2 | 12/61 | 59/60 |
| M1.3 | 3/45 | **45/45** |
| M1.4 | 51/62 | **62/62** |

## 🚦 M1 is through the gate

**Round 8: PASS.** Zero blockers, zero majors, two minors — both
fixed, both mutation-proved.

It took eight rounds. Rounds 1, 3 and 5 each failed on defects
introduced by the previous round's fixes; round 7 produced no verdict
at all because I kept committing into the tree it was auditing.

What made round 8 different was not the code being better — it was the
gate refusing to take anything on trust. It mutated both round-6 fixes
rather than reading the diff. It killed a real `loctt ui` with the page
open, which is the procedure seven specs quietly skip by reloading
first. It re-measured the claim decision A1 rests on rather than
accepting the entry. And it ran in its own worktree at a pinned SHA, so
nothing moved underneath it.

**All three agent-made decisions (A1, A2, A3) were upheld.**

The two findings, both now fixed:

- **F1** · sorting by `fields.*` was a silent no-op. Accepted, kept in
  the URL, shown with a sort indicator, identical order for `asc` and
  `desc`. My round-5 predicate said `fields.*` was sortable and the
  resolver could not read it — the two disagreed, and the URL was
  validated against the one that was wrong.
- **F2** · `project create --name X` created a project literally called
  `--name`. `rejectUnknownFlags` could not catch it, because `--name`
  is a real flag of `project rename`. The same hole was in all five
  entity commands.

### What the milestone cost, and what it bought

M1's four tickets were marked ✅ **before any ticket declared its
cases**. Verifying them found ~41 live defects. The vacuity sweep then
found **27 of 186 tests asserting nothing** — including one blocker
case failing in production behind a test that could not see it.

The one group with zero vacuous tests was BLK: M1.4, the only ticket
built under the disciplined loop rather than marked done in advance.
That is the clearest evidence in this run for what the loop is worth.

---

**All four M1 tickets are verified.** Gate round 6 returned **FAIL**
with 1 blocker, 1 major and 3 minors. **All five are now
dispositioned:**

| | Finding | Disposition |
|---|---|---|
| F1 | blocker · banner never fires mid-session | **Fixed** (`20cdf85`), proved by mutation |
| F2 | major · sidebar claims empty during a retry | **Fixed** (`9a21b22`, `bb6b9fc`) — and Fable found a worse defect underneath it |
| F3 | minor · API 200s an unknown `sort` | **Declined**, decision A1. LST-29 requires the fallback; the gate's supporting measurement did not reproduce |
| F4 | minor · CSV writes raw ULIDs | **Ken's**, unchanged. Four options in `PROPOSED-UI-CASES.md` |
| F5 | minor · error panel headed "Loading tasks" | **Fixed** (`1e5aa39`) |

Three decisions were recorded rather than escalated: **A1** (the sort
fallback stays a 200), **A2** (one failed request is enough to raise
the banner — SHL-41's own words, and the stricter reading made that
blocker unimplementable), **A3** (a wrong claim during a retry counts
as making it). A2 and A3 answer the gate's own PC-18 and PC-19, which
it raised as behaviour no case covers.

**Round 7 is next, and it needs an agent that wrote none of this.**

The F2 investigation is worth carrying forward. Three of my fixes
failed to establish the mechanism, which fired the "a fix that fails
twice" rule for the first time under the new workflow. A Fable agent
separated the phases and found my fix was correct but my diagnosis
wrong — and that a *worse* defect sat underneath: every sidebar group
claimed "No projects yet" from its first paint, for **1089–2098ms** on
a cold load against a dead server, directly under the banner saying
the server was down.

A vacuity sweep ran alongside it: **27 of 186 M1 tests assert
nothing**, found by mutating every test in six parallel groups. See
`docs/dev/gates/M1-vacuity-sweep.md` for the four recurring shapes.
The one group with zero vacuous tests is BLK — M1.4, the only part
built under the disciplined loop rather than marked ✅ in advance.

Three things from round 5 worth carrying forward:

- **Two blockers were mine, and the second was caused by the first.**
  F1's fix — render the shell rather than a fatal page — put a second
  `useInfo()` consumer behind a gate keyed on that query, which is
  F3's loop. The gate reported them separately; they were one
  structural problem.
- **F9 was a measurement error, three times over.** Every "failing"
  UI run had a `npm run build` racing it. A clean run is 194/194.
  `tests/ui/README.md` now states the rule.
- **F7 was declined, not deferred.** Resolving ULIDs in CSV exports
  is a decision about what an export is *for*; it is in
  `PROPOSED-UI-CASES.md` with four options and no recommendation
  dressed up as a finding.
- **F2 is refuted, not fixed.** The gate reported that an errored
  query never polls for recovery. Measured: six `/api/info` requests
  in a clean 20-second window, and unattended recovery in under a
  second. Its mechanism claim was wrong too — `onQueryUpdate()` does
  re-arm the interval. Pinned by an ERR-2 spec.
- **I claimed nine findings closed when F2 had never been touched.**
  A Fable review caught it. "Decided is not done" applies to
  "surveyed" as well: the row above now says six fixed, one declined,
  two non-reproducing, one refuted.

M1.1's two remaining cases are both parked with reasons, not skipped:
**SHL-33** (both obvious tests for it are vacuous — see known-gaps)
and **SHL-44** (needs the real `/tasks/$key`, which is M2.1's).

Roughly half of each batch turns out already correct and needing only
a test; the other half is a live defect. **Six tests have been found
asserting the bug** and rewritten, each noted in its commit.

Cases parked, with reasons, in `known-gaps.md`:

- **XS-56** — rows cannot be marked stale because the data layer drops
  them on error. Ken accepted the error state instead.
- **PRU-3** — needs an "All projects" mode no ticket built; moved to
  M4.1.
- **BLK-44** — the blocker half is fixed; its remaining bullet points
  at a `flow-list.md` case that was never written.
- **LST-14** — the `q` param is covered; the header search box is a
  deliberate stub, and M1.3's ticket never claimed one.

**The M1 gate loop, and why it did not converge**

Three rounds, three FAILs, and **two of the three found regressions I
had introduced fixing the previous round**. The pattern was not bad
luck; it was debugging at the wrong layer.

- **Every fix was keyed on `isError`, and in the failing state
  `isError` is false — permanently.** TanStack's retryer checks
  `onlineManager.isOnline()` between the first failure and the retry
  and, if the browser reports offline, pauses the query *indefinitely*:
  `status` stays "pending", the error is never recorded. One mechanism
  produced all three screens the gate reported.
- **I never captured the observer state where it failed.** All three
  predicates were reasoned out from intuition about a third-party
  state machine. One `console.log` of `status`/`fetchStatus`/
  `isPlaceholderData` in the gate's repro would have ended it at round
  two.
- **"Reproduces first try" versus "cannot reproduce" is an environment
  difference, and I never diffed the environments.** Playwright and
  jsdom are always online; the gate's harness was not. My
  warm-cache-versus-fresh-page diagnosis was wrong, and every spec I
  wrote against it was doomed.
- **I used the gate as a debugger.** A gate is for verdicts. Each
  iteration cost ~35 minutes and every miss looked like whack-a-mole.
  `ListView.paused.test.tsx` reproduces the same bug in ~50ms by
  driving `onlineManager` directly with the production client config.

**The rule this leaves:** when a fix depends on a third-party state
machine, dump that machine's actual state at the failure *before*
writing the fix, and build the fast reproduction before the second
attempt — not the fourth.

**Carried forward from the M1 gate:**

- **The ✅ marks cashed exactly as predicted.** M1.1–M1.3 sit at
  12/177 verified, and *every* gate blocker landed there or in core.
  M1.4 — the part built under this loop — was the best-behaved thing
  either agent walked.
- **`dslAtom` broke every entity filter.** Its comment asserted "all
  ids are bare identifiers"; every ULID starts with a digit, so the
  tokenizer read `01` as a number and 400'd. *A comment stating an
  invariant is not the same as the invariant holding.*
- **A moved task's new key did not resolve.** The key index's lazy fold
  keys off unknown *ids*, and `move` keeps the id. `doctor` called it
  in sync because a rekey leaves the entry count unchanged.
- **One predicate cannot serve two failures.** `items.length === 0`
  was standing in for "a failed Load more", and also matched "a failed
  filter", where keeping rows is wrong.
- **My own fix introduced two blockers.** `overflow-hidden` made seven
  columns unreachable; the toggle went inert but still absorbed clicks
  that surfaced later. *A responsive change needs walking at the width
  it targets, not only at the one it was written on.*
- **A spec can pass for the wrong reason.** My ERR-1 test killed the
  network then reloaded — which routes through the shell boundary, a
  fresh boot rather than the mid-session failure the journey names.
- **An agent report is a claim, not a fact.** Two round-1 blockers did
  not reproduce; one round-2 finding was real but smaller than
  described. Probe each one before building against it.

**Carried forward from subsection 5:**

- **`updated_at` had an unreachable error message.** It was in
  `USER_IMMUTABLE_FIELDS`, so the generic guard fired first and the
  explanation written for it never ran — on any path, on any surface.
  *Guard order decides which message wins; a specific case must precede
  the general one.*
- **An archived entity reported as "unknown"** sends the user hunting a
  typo. `resolveProjectIdFromInput` fell through to unknown for
  archived projects, and echoed a ULID while doing it.
- **A test's pattern can be looser than its own comment.** The
  integration test asked for "say why" and accepted `/immutable/`,
  which says nothing about why. It was asserting the bug.
- **`<a download>` cannot report failure** — no file, no event. Export
  now fetches, but a *modified* click still goes to the browser so
  BLK-37's copyable URL survives.
- **The select-all race was mine, twice.** Five call sites clicked the
  header checkbox before the table rendered. `tbody tr` visibility is
  not enough; wait for the count line.
- **BLK-44 is deferred and recorded in `known-gaps.md`.** One malformed
  `task.md` breaks every read through `loadAllTasks` — a P-11
  violation needing a data-shape change to core. The case also points
  at a broken-task indicator in `flow-list.md` that was never written.

**Carried forward from subsection 4:**

- **`AbortSignal.timeout` keeps running after a caller aborts.** So
  checking `deadline.aborted` in a catch block classifies a routine
  unmount as a timeout. Use an `AbortController` cleared on the
  caller's abort, and reproduce the *ordering* in the test — the bug
  only appears when the deadline elapses between the rejection and the
  handler.
- **`ELOCKED` was unmapped**, so every surface printed
  proper-lockfile's internals. Anything a dependency throws reaches
  the user verbatim unless core translates it.
- **A bulk `catch` that flattens to 400** blames the user for a schema
  mismatch or an unreadable file (ERR-31). Map the code, not the
  route.
- **Seeding 5,000 tasks via the CLI takes 20 minutes** at ~250ms per
  `create`. `tracker.seedBulk` writes the files directly — but it does
  **not** advance the key counter, so a `create` after it collides.
  Read/scale specs only.
- **A mutation that gets optimised away is not a mutation** either. A
  reviewer's busy-wait was dead-code-eliminated by esbuild, the bundle
  came out byte-identical, and the "survives" result was false. Add a
  sink the compiler cannot remove.
- **A doc comment is a claim.** Two here were false — `seedBulk`'s
  counter promise and a CSV row count that said it parsed and did not.
  Both would have misled the next reader.

**Carried forward from subsection 3:**

- **The ticket said archive shipped behind a typed confirm. It did
  not** — and I had repeated that into this plan without checking.
  Archive has been one click since `bd62543`, asserted since then.
  What BLK-10 actually still wanted was the Undo and the badge.
  *A ticket bullet is a claim, not a fact; probe it like any other.*
- **A boolean return discarded what the caller needed.** `runBulk`
  returning "did anything succeed" made Undo restore the refs *sent*,
  so a partial archive un-archived a task the batch had failed on.
  Returning the succeeded ids is both simpler and correct.
- **An action that clears the selection unmounts its own result.**
  Fixed properly here by sharing one `BulkResult` between the bar and
  the standalone region, after a vacuous test forced the issue.
- **Select-all before the table renders checks nothing**, then
  unchecks itself when rows arrive. Surfaces only under full-suite
  load as "Clicking the checkbox did not change its state". Row
  checkboxes auto-wait via the locator; select-all does not. Every new
  test now waits for `tbody tr` first.
- **An intermittent is not a flake until it is diagnosed.** This one
  passed alone 4/4 and failed roughly 1 run in 3 in the suite. Capture
  the error text before concluding anything.
- **A mutation that does not compile is not a mutation** — cost a
  build cycle again, and a careless `git checkout --` afterwards threw
  away an unrelated fix in the same file.

**Carried forward from subsection 2:**

- **`handleBulkMove` discarded the key changes.** Core returns
  `{taskId, oldKey, newKey}`; the web flattened it to `taskId`, so
  BLK-9's "name the new keys" was unsatisfiable from the client. The
  pattern to watch: a handler flattening a richer core result to a
  shared response shape silently drops what a case needs.
- **Core's no-op move is already correct** — a task already in the
  destination keeps its key and burns no number. I had flagged this as
  the risky part of the subsection; it was already right.
- **I regressed BLK-31.** `busy` never included `bulkMove.isPending`,
  so nothing was disabled during a move. A passing case broke because
  the new action was not added to an existing list — exactly what
  build-loop rule 4 is for, applied to a *variable* rather than a test.
- **Clearing the selection destroys the result message.** The bar
  unmounts at zero selection and the outcome lived inside it. Any
  action that clears needs its result rendered outside. Archive had
  the same latent hole.
- **Two substrings are not one assertion.** `toContainText("BACKEND1")`
  plus `toContainText("→")` passes with the arrow reversed.
- **`keysOnDisk` cannot see a burned counter.** A number allocated and
  abandoned leaves keys looking correct and a gap in the sequence.
  Read `state.yaml`.
- **The fixture's prefix is `T-` and the list renders newest-first.**
  `seed()` returns the real keys; the first checkbox is the task seeded
  *last*. Both burned a test iteration.
- **`npx playwright test` skips the build; `npm run test:ui` does not**
  (`pretest:ui` runs `npm run build`). The review agent reported a
  false vacuous-test result from a stale `dist/`.

**Carried forward from subsection 1:**

- **BLK-8's "write the config `key`" is a stale premise, not a
  contradiction.** `MilestoneDef` and `SprintDef` are `{id, name, …}`
  and strict — there is no `key`. The prose predates `48b2b57`. BLK-7
  asks for the ULID explicitly, so the spec's intent is consistent.
- **`/api/users` filters archived server-side; `/api/milestones` and
  `/api/sprints` do not.** So a test asserting the *user* picker
  excludes archived passes whether the client filters or not. Force the
  archived entry into the payload with `page.route` to make it real.
- **Disk state cannot distinguish "sent the name" from "sent the id".**
  `resolveEntityRef` resolves names on write, so frontmatter reads
  identically either way. Assert the wire value.
- **`loctt show` renders the resolved name**, so it cannot prove
  identity either. Read frontmatter off disk.
- **`npm run test:ui` rebuilds; `npx playwright test` does not.** A spec
  run directly against a stale bundle fails for the wrong reason.
- **UserProfile's field is `name`, not `display_name`.** Typecheck did
  not catch the wrong one; the rendered menuitem was simply blank.
- **BLK-40 fails and is expected to.** Pre-existing, scheduled into
  subsection 5.

### Why 4 is running before 3

The plan orders 3 before 4 "because a restructure needs a net". That
argument is about **changing code**, not about reading it. Phase 4 splits
cleanly in two:

- **Read and report** — needs no net. Findings go to a file for triage.
- **Apply the auto-fixes** — needs the net, and is what the ordering rule
  protects.

With Phase 3 blocked on stale reference docs, the reporting half was run
now and **no fix of any kind was applied**, including the provable-only
ones the plan permits. Every agent was told report-only explicitly.

Applying anything still waits for Phase 3, per the original order.

Slices were also re-cut: the plan estimated `core/task` at 2,400 lines; it
is **4,399**, past the size where an agent reads rather than skims. It was
split into 1a (writes, ~1,700) and 1b (reads, ~2,400).

### ✅ Blocker 2 — RESOLVED 2026-08-16: reference docs corrected

Phase 2 measured **CLI 17/49 covered, 12 partial, 20 uncovered** and
**MCP 26/75 covered, 11 partial, 38 uncovered**. Coverage is bimodal and
the split is not random:

- **The task surface is genuinely well tested** — create, list, show,
  set, unset, body, log, link, archive, delete, attach, comments, config,
  git, with real error paths and edge cases. It does not need work.
- **The entity surface is close to untested at the surface layer** —
  users, labels, milestones, sprints. `loctt user`, `loctt label`,
  `loctt calendar` and `loctt rerank` appear in no test file in the repo.
  30 MCP tools appear only in a schema-contract test that snapshots tool
  *names* and never calls them. Registration is not behaviour.

**The blocker is that the docs drifted in exactly that region.** Verified
directly: `mcp/reference.md:451` documents `create_label` as taking
required `key` + `label`, while `apps/mcp/src/tools/label.ts:33` ships
`name` + optional `color`, and `createLabel` in core takes `name`.

The CLI reference has the same drift. `cli/reference.md:217` documents
`loctt label create <key> [--label <label>]`; the shipped command takes a
name and ignores `--label` entirely. **The doc's own example succeeds
while doing the wrong thing** — verified by running it verbatim:

```
$ loctt label create blocker --label "Blocker" --color "#cc0000"
Created label "blocker" (id 01M031MN…)
```

The label is named `blocker`; "Blocker" is discarded silently. That is
worse than a doc that errors, because nothing signals the divergence.

**Correction:** an earlier version of this section said the CLI reference
documents no `loctt label` command at all. It does — at
`cli/reference.md:217`, under a `##` heading, which a grep for `###`
missed. The drift is worse than the absence I claimed.

**Scale of the drift, from the slice-9 map:** 17 of 75 MCP tools have
parameter-level drift, 2 tools are undocumented (`move_task`,
`duplicate_task`), and one guideline is self-contradictory. By region:
Milestones 6/6 drifted, Projects 6/8, Labels 5/6, Sprints 4/7. **Users
(7 tools) is clean** and is the one entity family Phase 3 could transcribe
today. The task, tracker, config, git and rank regions are accurate.

**Resolved.** The user authorised correcting the docs. Both references now
match the shipped API: 17 MCP tools fixed across Projects, Labels,
Milestones and Sprints, `move_task` and `duplicate_task` documented for the
first time, the self-contradictory migration guideline removed, and the CLI
label and sprint sections rewritten to `<name|id>` / `--name`.

Every corrected example was executed against a temp tracker, and a
mechanical doc-vs-schema diff over all 75 tools now reports no parameter
drift. Phase 3 can transcribe the entity region.

The code was right and the docs wrong: `ProjectDefSchema` is `.strict()`
with no slug, and P-1 forbids adding one.

Sizing for the rest, once the docs are settled: **~25–35 integration
tests** — one Phase 4 slice, not a UI build.

### Two green tests asserting behaviour that does not exist

Found while measuring, then verified by running the built CLI directly:

- **`tests/e2e/03-cli-full-lifecycle.test.ts:55`** passes `--hard`.
  `cli/reference.md:621` states "There is no `--hard` flag", and there is
  none in `apps/cli/src`. It passes because `--yes` alone does the work.
- **`tests/e2e/10-error-paths.test.ts:39`** is titled "delete on an
  already-archived task without `--hard` exits non-zero". Its comment says
  the first bare `delete` archives. It does not: bare `delete` exits 2 on
  the non-TTY confirmation gate and the task survives. The test would
  still pass with the already-archived check deleted entirely.

**Underlying defect:** unknown flags are silently ignored on every task
command. Verified by running `list --bogus`, `show T1 --bogus`,
`archive T1 --bogus`, `delete T1 --bogus --yes` — all exit 0 and proceed.
`init` rejects unknown options, so the CLI is inconsistent with itself.
A typo'd flag on an irreversible command is accepted.

Fixing that is a behaviour change and outside both phases' remit, so it is
recorded rather than done. It belongs in Phase 3 or 4 with a case behind
it. The two tests should be corrected in the same change — per
`CLAUDE.md`, a fix that requires editing a green test means that test was
asserting the bug, and the commit must say so.

### Per-ticket coverage, now that the partition exists

Computable for the first time after Phase 1 — previously there was no
mapping from a ticket to the cases it owed.

```
M1.1   0/75    M2.1  0/21    M3.1  0/27    M4.1  3/47   M4.5  0/22
M1.2  10/67    M2.2  0/41    M3.2  0/24    M4.2  0/25   M4.6  0/23
M1.3   3/44    M2.3  0/15    M3.3  0/50    M4.3  0/74   M4.7  0/23
M1.4  26/59    M2.4  0/38    M3.4  0/41    M4.4  0/6    M4.8  1/64
               M2.5  0/51
```

**M1.1, M1.2 and M1.3 are marked ✅ in `TEMP-WEB-TICKETS.md` and are at
0/75, 10/67 and 3/44.** Those ticks were awarded before any ticket
declared its cases, so they record "the bullets were built", not "the
cases are verified". Both readings are legitimate for what was known at
the time; they are not interchangeable now.

This is input for the 🚦 Milestone 1 gate, which is a human decision and
has not been run. An agent must not silently re-mark those tickets.

**As of 2026-08-15**, with Phase 1 complete and halted:

- **Case coverage: 46 / 937** tagged, by 84 `@verifies` tags — unchanged
  by Phase 1, which wrote no tests.
- **Tickets:** 3 ✅ (M1.1, M1.2, M1.3) · 1 🔵 (M1.4) · 17 ⬜, all 21 now
  declaring their cases. See the caveat on those ✅ marks above.
- **Suites, all green:** 1,894 unit · 193 integration · 20 e2e · 35
  Playwright · 15 LLM scenarios. Phase 1 added 7 tests for the partition
  parser (tools suite: 12 → 19).
- **The 🚦 Milestone 1 review gate has not been run.**

### Verified, so it need not be re-derived

- **`cases:coverage --require` gates correctly.** Exit 1 on a fabricated
  ID, exit 1 on a real-but-untagged case, exit 0 when genuinely covered.
  Checked directly via `npx tsx tools/coverage/main.ts`. An earlier check
  through `npm run` appeared to show exit 0 — that was the harness
  measuring a following `echo`, not the tool. The foundation this plan
  rests on is sound.
- **The reference docs are structured enough to gap-analyse against:** 49
  headed sections in `cli/reference.md`, 75 in `mcp/reference.md`, one per
  command or tool.
- **Zero of the 21 tickets contain a `Cases:` line.** Confirmed by grep at
  the start of Phase 1.
- **The 869 UI cases split M1 248 · M2 167 · M3 157 · M4 297.** Surface
  cases (68) are not part of the partition — they have no milestone and are
  scheduled by severity in Phase 3.
- **`cases:partition` is the completeness gate**, added in Phase 1. It
  reads the `Cases:` lines and fails on an unpartitioned ticket, an
  unplaced case, a case in two tickets, a fabricated ID, or a surface case
  in a UI ticket. Run `npm run cases:partition -- --check`.

## Phases

```
1  Partition        Write each ticket's case IDs into the ticket
2  Measure          Read-only: what do the CLI and MCP tests actually cover?
3  Surface gaps     Close the 68 documented surface cases
4  Structural audit Nine slices across core, contracts, cli, mcp
5  UI build         M1.4 → M4.8, per build-loop.md
6  Cleanup          Group G's 55 cosmetic items; the flakiness diagnosis
```

**Phase 6 exists so the deferrals have somewhere to live.** Both items
were being carried as "later" with no phase, which is how a deferral
becomes a disappearance. Neither can be done sooner: Group G is mostly
in `apps/web` code M2–M4 rewrites, and the flakiness has not
reproduced in eight runs, so there is nothing to diagnose yet.

### Why this order

**1 first, because every later gate depends on it.** Until each ticket
declares its cases, the agent picks its own — and passes an exam it set.
Any phase run before this one grades itself.

**2 before 3, because 2 is read-only and may resize 3.** Measuring costs
one agent and produces a decision input, not work.

**3 before 4, because a restructure needs a net.** The surface cases
assert observable behaviour through the CLI binary and MCP stdio by
design ("so they survive refactors"), so a layering change inside core
does not invalidate them. Running the audit first means restructuring
against a suite with known holes, in the areas the audit touches.

**4 before 5, because core is shared.** A defect in core surfaces three
times. Fixing it through Playwright is the slowest, narrowest, most
expensive route available. And P10 parity is undecidable for the UI agent
while core's behaviour is still moving — hardened first, parity becomes a
lookup rather than a judgement call.

---

## Phase 1 — Partition the cases

**Problem:** no ticket declares its case IDs. `build-loop.md` step 8
gates on `--require <ids>`, but the agent chooses the list. Zero of the
21 tickets contain a `Cases:` line.

**Fix:** one line per ticket.

```
### M2.1 · Task detail — read shell ⬜
Cases: TSK-1, TSK-2, TSK-3, TSK-8, TSK-19, TSK-40, …
```

`--require` then reads the ticket, not the agent's choice.

Most of the partition is derivable — every case carries a milestone tag
and lives in a flow file. The judgement is in splitting one flow across
sibling tickets: which task-detail cases are M2.1 versus M2.2 versus
M2.3.

**Three steps:**

1. **An agent partitions** the 869 UI cases and writes the `Cases:`
   lines.
2. **A script gates completeness.** Every M1–M4 UI case lands in exactly
   one ticket — none dropped, none double-counted, and any case the agent
   cannot place is listed explicitly rather than silently omitted.
3. **A second agent reviews the split.** It did not author the
   partition, so it is not grading its own work. It checks cases sit with
   the ticket that builds the behaviour they describe — which the script
   cannot judge.

The script catches omission; the review catches misplacement. Neither
alone is sufficient.

**Output:** `Cases:` lines in `TEMP-WEB-TICKETS.md`, plus a completeness
script under `tools/`.

---

## Phase 2 — Measure CLI/MCP coverage

No document says what the CLI *should* do case by case, the way
`flow-list.md` does for the list view. Its specification is
[`cli/reference.md`](docs/user/cli/reference.md) — 49 headed sections, one
per command. The MCP's is
[`mcp/reference.md`](docs/user/mcp/reference.md) — 75 sections, one per
tool.

Whether the 74 CLI + 61 MCP unit tests, 193 integration tests, 20 e2e
journeys and 15 LLM scenarios cover that surface is unmeasured. Note that
unmeasured is not evidence of inadequate.

**One read-only agent:**

1. Enumerate every command and tool from the reference docs.
2. For each, determine what existing tests assert.
3. Report the holes, with severity.

**Output:** a gap report. A handful of gaps folds into Phase 3. A large
number is evidence for a bigger pass, schedulable knowing what it buys.

The agent may not edit the reference docs. Any cases it appends to
`surface-test-cases/` are transcribed from them, not invented; it
proceeds without approval, then runs `npm run cases:index` and commits
the regenerated JSON.

---

## Phase 3 — Close the surface gaps

**Input:** [`surface-test-cases/`](surface-test-cases/) — 68 cases across
10 flows, plus anything Phase 2 added.

These are gaps only. The README is explicit: *"behaviour already covered
by an existing test is not restated."* They are holes found in shipped
code, not a specification of the CLI and MCP.

**Order:** blocker → major → minor, ignoring flow boundaries. There is no
build order to respect — these are defects in code that already ships.

**Loop:** `build-loop.md` steps 1–8, with the E2E step replaced by
integration tests since no UI is involved.

**Gates:**

```bash
npm run cases:coverage -- --require <ids>   # must FAIL before, PASS after
npm run test && npm run typecheck && npm run lint
npm run test:integration
npm run test:e2e
npm run llm:verify
npm run cases:check
```

**Every new test must be shown to fail.** Break the behaviour, watch that
specific test go red, restore. The most-violated rule in this repo's
history.

---

## Phase 4 — Structural audit

**Remit:** `packages/core`, `packages/contracts`, `apps/cli`,
`apps/mcp`. Not `apps/web` — it is ~15% built and M2–M4 will rewrite most
of it.

**Looks for:** code smells, potential bugs, bad layering, weak
abstractions, duplication. Not behaviour changes.

### Sliced, because whole-repo reviews skim

An agent given 25,400 lines does not review 25,400 lines. It reads the
first few thousand carefully and skims the rest, and nothing in its
output distinguishes the two. Fresh agent per slice, each small enough to
read in full.

| # | Slice | ~Lines |
|---|---|---|
| 1 | `core/task/*` — update, comments, relationships, traversal, bulk, history | 2,400 |
| 2 | `core/git/*` — publish-sync, merge, three-way, resolve-conflicts | 1,700 |
| 3 | `core/config/*` + `core/schema/*` | 1,700 |
| 4 | `core/query/*` + `core/rank/*` | 1,800 |
| 5 | `core/{projects,users,sprints,milestones,labels}` | 2,300 |
| 6 | `core/{state,paths,init,diagnostics,markdown,utils,views}` + `index.ts` | 2,400 |
| 7 | `packages/contracts` | 2,100 |
| 8 | `apps/cli` | 3,035 |
| 9 | `apps/mcp` | 2,515 |

Five agents in parallel, two waves. Each gets its slice,
[`invariants.md`](docs/dev/invariants.md), [`decisions.md`](docs/dev/decisions.md), and a
fixed finding schema.

A third wave runs one cross-slice pass reading only the nine findings
files, never the code — catching abstractions wrong across slices, at a
size where the whole picture fits.

### What an agent fixes without asking

Only changes where "no behaviour change" is provable by construction:

- Dead code with **zero** references
- Unused exports
- Import ordering
- Local variable renames (function-scoped, no export touched)
- Comment corrections

Everything else escalates **by rule**, including changes that look small.
The agent does not judge risk; it matches against this list.

Size and risk are different axes, and an agent judges size well and risk
badly. Collapsing two near-duplicate functions is small, tidy and
obviously correct right up until the duplication was load-bearing — which
is how the near-duplicate survived.

Anything touching a **signature, public export, on-disk shape, or error
message** escalates regardless of size.

Auto-fixes land as their own commit series, never mixed into feature
work, so a bad one is revertible without unpicking anything else.

### Findings

Escalated findings go to `docs/dev/audit-findings.md`: slice, file:line,
what is wrong, why it matters, blast radius, size (S/M/L). The user
triages in one pass; approved items execute before Phase 5.

### What the net does and does not cover

Phase 3's cases cover *known gaps* — places already found wrong. They are
not a net over behaviour that currently works and that a restructure
could break. The existing 1,894 unit and 193 integration tests are the
real net there, and core's 1,290 will churn under a layering change.

"The tests will catch it" is weaker than it sounds. This phase must not
lean on it when touching data layout.

---

## Phase 5 — The UI build

Per [`build-loop.md`](docs/dev/build-loop.md), M1.4 → M4.8, with:

- `--require` reading the ticket's `Cases:` line from Phase 1.
- `/simplify` and a tech-debt sweep at each 🚦, not before — a code-smell
  pass over `apps/web` today would tidy code M2–M4 rewrites.
- 🚦 milestone gates staying human.

`build-loop.md` decoupled the surface cases from UI tickets, arguing a
CLI export bug should not stall the board view. That argument was made
while UI work was in flight; with Phases 3 and 4 complete first, the
conflict does not arise.

---

## Escalation

**The run halts.** No parking, no queue, no continuing to the next
ticket.

On a genuine blocker — two cases contradicting each other, a case whose
dependency does not exist, a case that appears wrong — the agent stops
and states it: ticket, case IDs, what is contradictory, what it tried.

This costs throughput; a blocker at 1am costs the rest of the night. That
is the trade. Work built on a wrong assumption costs more to unpick than
the hours lost waiting.

The agent never adjudicates a contradiction. The docs are the
specification; an agent that may rewrite the spec to match its code has
no specification.

---

## Not automated

- **The 🚦 milestone gates** — where accumulated judgement gets checked by
  someone who can overrule it.
- **Phase 4's escalated findings** — structural decisions about the layer
  all three surfaces depend on.
- **The Phase 2 decision** — whether a measured gap list warrants more
  work.
- **Any blocker** — the run halts; a human unblocks it.

Everything else runs unsupervised.

## Keeping the status section true

The Status table is part of each phase's exit, not an afterthought. A
phase is not finished until it is updated.

- **Entering a phase:** mark it 🔵 before doing any work.
- **Leaving a phase:** mark it ✅ and record what it produced — files
  written, cases closed, findings raised — in the Notes column.
- **Halting:** mark it ⛔ and state the blocker inline. The next agent
  must be able to see why the run stopped without reading a transcript.
- **Anything an agent would otherwise "remember":** put it under
  *Verified* or in the phase's Notes. A fact that lives only in a
  session's context is lost at the next compaction, and the agent after
  that will re-derive it — differently.

Report what is true rather than what was intended. A phase marked ✅ that
left work undone is worse than one honestly marked 🔵: the next agent
builds on the claim, not the code.

## Phase 3 log

Closed, newest first. A case listed here has a `@verifies` tag and a test
that was shown to fail before the fix.

| Case | Commit | Was it a real defect? |
|---|---|---|
| MSL-C1 | `48b2b57` | **Yes.** `set T-1 milestone v1` stored the *name* while identity is a ULID, so milestone progress read 0/0 for a milestone holding tasks. Sprints identical. |
| SPR-C1 | `1966559` | **Yes.** `inSprint` meant "has *a* sprint", so every burndown in a multi-sprint tracker summed all of them — wrong on all three surfaces at once. |
| REL-C1 | `1966559` | **Yes, web only.** `handleUnlink` omitted `workflowConfig`, stranding the inverse edge permanently. CLI and MCP were correct. |
| GIT-C2 | `a7c1451` | **Yes.** The rekey pass ran only after a *merge*, but two clones creating tasks offline produces a *copy* — the one case it was written for. Skipped collisions were also discarded by the caller. |
| PRU-C1 | `6be19ce` | No — already correct, nothing asserted it. |
| QRY-C1 | `6be19ce` | No — premise stale, brackets fixed in `36c8872`. Pinned the round trip instead. |
| GIT-C4 | `82403c2` | **Yes.** The CLI printed "Published local state" and exited 0 when the push failed. |
| GIT-C1 | `82403c2` | No — covered by the per-field merge in `62f6438`. Tagged. |
| ONB-C4 | `4b685eb` | **Yes.** `doctor` was blocked by the schema guard, so the one command that explains a broken tracker could not run on one. |
| TSK-C1 | `4b685eb` | **Yes.** A raw Zod dump instead of prose; MCP already returned prose for the same input. |
| CFG-C1 | `86f96f6` | **Yes.** A refused workflow edit still left a journal entry, which the next operation replayed. |
| TSK-C7 | `0f6168e` | Partly — export is web-only, now documented as absent rather than silently missing. |
| CMT-C1 | `858c212` | **Yes.** Six commands dispatched but absent from `--help`; `comment-delete` had no confirmation. |
| CFG-C3 | `0fe0a8f` | **Yes, small.** MCP's unknown-key error omitted the valid-key list the CLI gives. |
| PRU-C11 | `0fe0a8f` | No — already correct, nothing asserted it. |
| TSK-C2 | `1324a0f` | **Yes.** `updated_at` was hand-writable on CLI and web — the field git-sync, recency sort and the activity feed all read. |
| CMT-C3 | `cce45a3` | **Yes.** Two clients could both read a task and both write it; the second silently discarded the first's paragraphs. Optional token; omitting it keeps last-write-wins. |
| ONB-C1 | `cce45a3` | No — already resolved in the spec, only untagged. |
| CFG-C2 | `1b87b8b` | **Yes.** doctor filtered workflow-key errors as "out of scope", so a task holding a deleted status read as ✓ valid — and the DSL rejects the literal, so there was no way to find the affected tasks. |
| CMT-C2 | `1b87b8b` | **Yes.** "pass an explicit author" is not something the CLI can do, and the typed text was lost. |
| ONB-C3 | `c55b9d7` | **Yes.** init refused a damaged tracker with "already exists", leaving `rm -rf .loctt/` as the only route back. |
| PRU-C10, PRU-C12 | earlier | Tagged before this run. |

### Since the blockers

Nineteen more closed. The ones that were live defects:

| Case | Commit | What was wrong |
|---|---|---|
| CMT-C7 | `fec640e` | `readHistory` coerced a non-array to `[]`, so a corrupt `_history.yaml` read as empty — and the next append **overwrote it**. History is M2's recovery path, so silently discarding it removes what makes a lost merge race recoverable. |
| QRY-C5 | `de865d9` | `limit` applied before `offset`, so every MCP page returned the same rows — paging was impossible. A truncated list also never said so. |
| PRU-C8 | `de865d9` | `set_user_setting` was documented as step 2 of the project-resolution chain and existed nowhere. |
| GIT-C8 | `de865d9` | `enable_git` claimed to create a branch on a sparse worktree; it records config, and the branch appears on first publish. |
| TSK-C8 | `c949426` | `show` promised "full details" and omitted labels, milestone, sprint, estimate, dates and custom fields — all writable, none readable back. |
| ONB-C5 | `435432f` | `info` never printed the schema status it already computed, and was blocked by the guard from running on the tracker that most needed describing. |
| CMT-C4 | `cec1927` | `log` had `--limit` and no `--offset`: a long history was reachable only from its newest end. |
| TSK-C5 | `b6a868b` | `create` accepted four flags on the CLI and five parameters on MCP, while core took thirteen. |
| QRY-C4 | `ca2c462` | Sort and offset existed in core and only on the web. |
| QRY-C2 | `ca2c462` | A mistyped query became `500 Internal server error`, discarding the position and suggestions `validate.ts` carries. |
| CMT-C6 | `b154a62` | Rank changes wrote frontmatter and recorded no history — the one mutating operation with no audit trail. |
| TSK-C3 | `5e4074d` | The CLI validated the enum before the lookup, so a typo'd key on a missing task blamed the status vocabulary and exited 2 instead of 1. |
| ONB-C2 | `5e4074d` | `timezone` was CLI-only, so an agent initialising for a team in another zone recorded the server machine's. |
| GIT-C7 | `56b02b2` | `git enable` adopted a branch holding foreign content silently; only a later publish refused. |
| PRU-C9 | `2f3a1f6` | `project create --label` was documented, never read, and silently discarded. **None of the entity commands validated flags** — the earlier fix covered only the task commands. |
| GIT-C9 | `2f3a1f6` | Verified only after writing a test outside the repo tree: `withTmpLoctt` creates workspaces *inside* LocTT's own git repo, so every git test here sees a `.git` walking up. |

**Fifteen of the twenty-three were live defects.** Two were stale premises, two
were correct-but-unasserted, and the rest were partial.

**Five tests were found asserting a bug** and rewritten, each named in
its commit: the `--hard` trio, `comment-delete` with no confirmation,
`assignProvisionalPrefixes` ids that sorted opposite to their claim,
"publish exits 0" on a failed push, and a fixture referencing a
milestone that never existed.

## Picking this up next

**Finish M1.4, then Phase 5 in ticket order.** Decided 2026-08-24,
replacing the "build M3.5 and M4.9 first" ordering that stood here.

1. **M1.4** — the 29 open major/minor BLK cases. All 13 blockers are
   already covered; the ticket is 🔵, not ✅.
2. **🚦 Milestone 1**, then **M2.1 → M4.9** in ticket order. M3.5 sits
   after M3.4; M4.9 after M4.8.
3. **Phase 6** — Group G's 55 cosmetic items, last.

### Why M3.5 and M4.9 are no longer front-loaded

Two reasons were recorded for building them first. **Both are gone.**

- *"Both carry server work."* **Verified false 2026-08-24.** Every route
  exists: `GET/POST /api/sprints`, `GET/POST /api/milestones`, both
  `PUT`/`DELETE` by id, and `GET /api/sprints/<id>/burndown`. Both list
  handlers already take `?progress=true` and run `withProgress`, and
  `computeProgress` in `core/task/progress.ts` already answers the hard
  cases: it counts by status **category** (MSL-2), reports `discarded`
  separately with `total` excluding it (MSL-3), and guards the zero
  denominator (MSL-15). SPR-4's "write the id, not the name" was fixed
  in `5c81d96`. **Both tickets are client-side only.**
- *"An open `$key` route decision."* Settled by **V3** — route segments
  carry the ULID.

The one open question found while checking — where SPR-3's per-user
expand/collapse state lives — is settled by **V12**: `localStorage`, no
server work.

Roughly five non-cosmetic findings are left open on purpose. Each is
named in `audit-findings.md` with why: they need the code that owns them
(the M2 task-detail handler, the MCP comment tools) rather than a sweep.

### M1.4's remaining work, sized 2026-08-24

Read from the cases, not from the ticket bullets. The server is **done**
— all five bulk routes exist (`set`, `archive`, `delete`, `move`,
`link`), `moveTaskToProject` is in core, `key_history` is in the task
schema, and `BulkResponse` already splits `succeeded`/`failed` with
`ErrorItemFailure` for naming each one. This is client work.

| Group | Cases | What it needs |
|---|---|---|
| Set assignee / milestone / sprint | BLK-7, 8 | Pickers in the shape of the built status/priority ones. Exclude archived; offer clear/none; write the config **key**. |
| Move to project | BLK-9, 26 | Old key into `key_history`; result **names the new keys**, not a count; a task already in the destination is a **no-op success, not a rekey** — it must not burn a key number. |
| Undo after archive | BLK-10 | **V11.** Remove the typed confirm; lightweight confirm with cancel focused; in-memory undo. |
| Concurrency + scale | BLK-22, 23, 24, 34, 41, 42 | Honesty, mostly. |

**BLK-10 is a removal as well as an addition.** M1.4 shipped bulk
Archive behind a typed confirm; the case says demanding one is itself a
violation, because archive is reversible.

**BLK-41 is the one to design deliberately.** A hung bulk request must
state **unknown** — not success, not failure — and per P4's rare
exception must say all three: what was attempted, what state the data
is in, what to do. The envelope already carries `data_state` and
`recovery`; the UI has to render the unknown case rather than falling
back to a failure toast.

**BLK-22 must not say "8 tasks updated"** when one task vanished. Report
7 succeeded, 1 failed, naming the missing key.

### Decisions recorded 2026-08-17 — read these first

Six, and they change what the work above *is*. `decisions.md` §7 and two
new invariants.

Three, in [`decisions.md` §7](docs/dev/decisions.md) — read them before starting
the work above, because two change what that work is:

- **V1 · Core owns validation.** Every CLI and MCP rule migrates into
  core, so it is enforced once and reported identically. Carries two
  audits (what core validates today; which surface rules must move) and
  structured errors from core. Two cautions are recorded with it: MCP has
  no version negotiation, so changing its error shape is a breaking
  change worth doing deliberately; and whether the code set is the right
  one is only answerable once a UI renders it.
- **V2 · Malformed history degrades, never blocks.** Superseded in scope
  by **P-11**. ✅ implemented for comment threads (`149a07a`); history
  and the config slices still to follow.
- **V3 · Route segments carry the ULID.** `/milestones/<ulid>`,
  `/sprints/<ulid>`. The address bar is outside the UI for P-4, which is
  now scoped in `invariants.md` to UI *content*. Settles the open `$key`
  question on M3.5, M4.9 and M4.7.
- **V4 · Sync pre-flight runs under both `--dry-run` and a real sync**,
  and a real sync refuses on failure. ✅ implemented (`f72461a`) — one
  function backs both, so they cannot drift.
- **V5 · The validator is maintained by a test, not an instruction.**
  Schema-coverage test over the Zod shapes, plus a reasoned exemption
  list. **Not yet implemented.**
- **V6 · Multi-file ops get stage-then-swap plus a journal.** ✅
  implemented (`f72461a`) as stage → back up → journal → swap → roll
  back, per the user's scheme. `bulkSetFields` and `bulkArchive` are
  two-phase; recovery rolls back, never forward.
- **V7 · An unreadable user profile is kept, not skipped.** ✅
  implemented (`de107eb`), and extended to labels, milestones and
  sprints: the guard fails **closed** on any slice it cannot read, for
  *new* references only — an unreadable file must not freeze every write
  on a task that already carries the field.
- **P-11 · Leniency means keeping, never destroying** (`invariants.md`).
  ✅ implemented for comment threads (`149a07a`). A malformed entry is
  kept at its index and survives a post, an edit, or a deletion of
  either neighbour; an unreadable file is never written over.
- **P-12 · Validate at the boundary** (`invariants.md`). Cross-file
  dependencies included. Hand-edits and `git pull` are unsupported —
  LocTT warns cheaply, the user owns the outcome. The boundary is the
  gate; P-11 is the floor.

### The open items, and which phase each belongs to

Five things were left in [`known-gaps.md`](docs/dev/known-gaps.md) and
[`audit-findings.md`](docs/dev/audit-findings.md) after Phase 4.
Investigated 2026-08-17 against the code, not taken from the docs.

| # | Item | Phase |
|---|---|---|
| 2 | `HistoryEntry` had no schema | **Before Phase 5** — ✅ done, `4fb7e4b` |
| 3 | ERR-11 / ERR-12 client half | **Phase 5** — ERR-12 in M2.3, ERR-11 in M4 |
| 4 | `reorderBoardRank` is O(all tasks) per call | **Phase 5** — M3.3, when the board exists |
| 1 | Group G — 55 cosmetic items | **After Phase 5** |
| 5 | Integration-suite flakiness | **After Phase 5** — cannot act yet |

**2 · `HistoryEntry` schema — done.** `kind` was never checked against
its union, so a hand-edited `not_a_real_kind` reached every reader.
Fixed before the UI starts because M2.4's activity feed switches on
`kind` to pick an icon and would have had no case for it. The schema is
in `contracts`, so it covers all three surfaces, not just the web.

**3 · ERR-11 / ERR-12 — is Phase 5, not before it.** Both require the
user's typed content to stay in the editor when a save fails, so
neither can be built before the editor exists. The spec tags ERR-12 M2
(blocker) and ERR-11 M4 (major); build each with its milestone.

**4 · `reorderBoardRank` — M3.3.** `loadAllTasks` runs on *every* drag,
not only on rebalance — the doc comment at `rank/reorder.ts:190`
understates it. It does not block Phase 5: nothing calls it
interactively until M3.3 builds the board, and the right fix depends on
the shape that ticket chooses. Invisible at a few hundred tasks; you
would need thousands to feel it. **Measure it in M3.3 rather than
guessing at a fix now.**

**1 · Group G — after Phase 5**, itemised in
[`audit/group-g-itemised.md`](docs/dev/audit/group-g-itemised.md). 55
items, not the "~79" carried before. Deferred because much of it is in
`apps/web` code M2–M4 rewrites, so tidying now means tidying twice.

**5 · Flakiness — after Phase 5, and currently unactionable.** One run
reported 5 failures; **eight consecutive runs since have been green**,
including one with four CPU-saturating processes alongside. The
recorded diagnosis was wrong — it blamed vitest's 5s default, but the
integration runner has carried 15s since the harness was built. The
output was never captured, so nobody knows whether they were even
timeouts. Raising a timeout that may not be the cause would only hide
whatever is. **Capture the failure output on the next occurrence.**

### After M1.4 — M2.1, the task-detail read shell

**Everything in the work queue above is done.** Nine decisions and two
invariants have code; all seven suites are green with zero FAIL lines.
Item 8 is the UI build. **M1.4 comes first** (see above); M2.1 is where
the new tickets start.

**The API is already built.** Every route M2 needs exists and is
tested: `set`, `unset`, comments (GET/POST/PUT/DELETE), activity, link,
unlink, attachments, archive. Verified by reading the route table in
`apps/web/src/server/server.ts:3150`ff. **M2 is client-side work.**

What exists on the client: `apps/web/src/client/routes/` contains only
`Stub.tsx`. There is no task-detail hook — `api/hooks/` has
`useTasks.ts` for the list and nothing for a single task.

**Size honestly.** M2 is 166 cases across five tickets and is several
sessions, not one:

| Ticket | Cases | Work |
|---|---|---|
| M2.1 read shell | 21 | Route, layout, breadcrumb, More menu |
| M2.2 meta edits | 43 | 11 inline-editable field types, optimistic updates |
| M2.3 body editor | 17 | TipTap + CodeMirror, autosave, mentions |
| M2.4 comments + activity | 39 | Composer, edit/delete, activity collapse, paging |
| M2.5 relationships + attachments | 51 | Grouped panel, drag-reorder, upload grid |

Take **one ticket at a time** through `build-loop.md`. Finishing M2.1
beats starting all five.

**Dependencies are already installed** — TipTap 3.30, CodeMirror 6,
`@tiptap/extension-table`. No package work needed.

**Reuse rather than rebuild:**

- `apps/web/src/client/ui/ErrorState.tsx` (`4bb211b`) renders a failure
  from the server's envelope — headline, data state, recovery control,
  details affordance. Task detail needs it for ERR-7 (404 naming the
  key) and ERR-8 (a hand-typed key that never existed).
- `ApiError.envelope` carries `code`, `field`, `data_state`,
  `recovery`. **Branch on `code`, never on message text** — the whole
  point of V1 is that copy can be reworded without breaking behaviour.
- `packages/core/src/test-support/entities.ts` — `seedLabel`,
  `seedUser`, `seedMilestone`, `seedSprint` return **ids**. Frontmatter
  stores ULIDs and the write paths refuse a reference to something that
  was never created, so a fixture cannot invent `"bug"`.

**M2 extends code that is already well tested, so `build-loop.md` rule
4 applies throughout:** after adding a case to an existing scan, switch
or handler, delete your new branch and run that file's tests. If they
stay green, the coverage you assumed is not there. That rule exists
because `doctor`'s history reporting could be deleted with all nine
integrity tests passing — the file was written when the scan covered
comments only, and nobody extended it.

**Read before building M2.2's error handling:**
[`flow-error-handling.md`](docs/dev/ui-test-cases/flow-error-handling.md). ERR-14
puts a field rejection *at the field*; ERR-18 makes the data-state claim
mandatory on writes; ERR-3 calls that "the single most important error
behaviour in the app". Core now supplies all of it — the UI's job is
placement, not invention.

### ✅ Done 2026-08-17: P-11, P-12, V4, V6, V7 implemented

All six swallowed-error findings are **closed**, and four of the nine
recorded rules now have code. See [`audit-findings.md`](docs/dev/audit-findings.md)
for the per-finding detail.

| Rule | State | Commit |
|---|---|---|
| **P-11** | ✅ implemented for comment threads | `149a07a` |
| **V7** | ✅ implemented | `de107eb` |
| **V4** | ✅ pre-flight under `--dry-run` and real publish | `f72461a` |
| **V6** | ✅ stage → back up → journal → swap → roll back | `f72461a` |
| **V1** | ⬜ not started — see the note below |
| **P-12** | ⬜ not started (V4's pre-flight is the hook it needs) |
| **V5** | ⬜ not started |
| **V2** | — absorbed into P-11 |
| **V3** | — decided; comes due with M3.5/M4.9/M4.7 route work |

**Every finding was re-probed against the built binary first, and none
was a false positive.** The ~⅓ stale-premise rate from Phase 3 did not
repeat. Two were worse than recorded, and one (the archived guard) does
not reproduce through the CLI at all — it needed a core-level test, or
it would have passed while asserting nothing.

**Read before starting V1:** `utils/read-state.ts` already makes the
absent / loaded / unreadable distinction that V1's structured errors
depend on, and six call sites now use it. V1 should **adopt** it, not
replace it.

**Scope note on P-11.** It is implemented for *comment threads* only.
History entries and the config slices follow the same shape and do not
have it yet. `checkDataIntegrity` in `diagnostics/integrity.ts` is where
each new store gets reported once it does — the severity split
(`unreadable` blocks a publish, `malformed` never does) is the part to
preserve.

Nothing was retrofitted. P-11 applies from here forward.

### The work queue, agreed 2026-08-17

Ordered. Each item's decision is recorded before it is built.

| # | Work | Decision | State |
|---|---|---|---|
| 1 | **P-11 for history entries** | P-11, **V9** | ✅ `e379de8` |
| 2 | **P-11 for config slices** — refuse and report | **V9** | ✅ `e379de8` |
| 3 | **P-12** — inverse-relationship validation | P-12 | ✅ `17fae3f` |
| 4 | **`ListView.tsx` / `Sidebar.tsx`** `isError` branch | ERR-1 | ✅ `4bb211b` |
| 5 | **V1's two audits** | V1 | ✅ `79cf58f`, `d7a3b65` |
| 6 | **V1 proper** — core states its own cause | V1, **V8**, **V10** | ✅ `e19964f` |
| 7 | **V5** — the schema-coverage test | V5 | ✅ `761df3e` |
| 8 | **M2**, then the rest of Phase 5 | — | ⬜ ← next |

**Found and fixed along the way**, each reproduced against the built
binary before any code was written:

- **GIT-C2's test never reached the code it asserted** (`55d891c`). Its
  fixture gave both tasks an identical `created_at`, so the tiebreak
  fell to the id and the *local* task was rekeyed — successfully. The
  case had been unverified since `a7c1451`.
- **`setFields` did not resolve entity names** (`5c81d96`). `loctt set
  T1 milestone v1` stored the ULID; `loctt set T1,T2 milestone v1`
  stored `"v1"`. MSL-C1 reopening on the path its Phase 3 fix missed.
- **No write path checked an entity exists** (`5c81d96`). Only `doctor`
  passed `aux`. `createTask` never resolved names at all.

**Investigated and closed as not-a-defect:** the `rekeyCollisions` skip
path (`6da4188`). I had claimed it produced wrong behaviour on real
syncs; two-clone testing showed it does not, and two of my supporting
facts were wrong — `state.yaml` *is* mirrored, and tasks in different
projects cannot collide because prefixes are unique.

**Why this order.** 1–4 are independent of everything else and close
known gaps. 5 is read-only and sizes 6. 6 must precede M2, because M2's
editable fields render whatever V1 produces. 7 must follow 6, or it
tests an arrangement that is about to change.

**Before designing V1's error set, read
[`flow-error-handling.md`](docs/dev/ui-test-cases/flow-error-handling.md).** The
ERR-* cases are the specification for error behaviour. The failure kinds
sketched in V8 are derived from the code, not from the spec — if the doc
names different ones, those win. An agent does not adjudicate against
the spec; it halts and says so.

**Two rejected proposals worth not re-making:**

- Error categories named for where the UI renders them (field-level,
  toast, full-page). Rejected — see **V8**. Core describes the error;
  the surface decides the presentation.
- Keep-and-merge for malformed *config*. Rejected — see **V9**. A
  config value is a definition other data references, not a record of
  an event, so LocTT refuses rather than building on it.

### A note on how this session went wrong

Twice I did more than was asked: I began fixing audit findings when the
ask was to review them. The work is sound and mutation-verified, but
"the fix is obvious" is not authorisation, and a reviewer who wanted to
weigh the finding first now has to weigh a diff instead. If you are
picking this up: **the audits above are reading queues, not work
orders.**

Treat the 124 audit findings as a reading queue, not a fix list. Roughly
a third of Phase 3's "defects" were not defects, and the same rate should
be expected here — probe the built binary before writing anything.

The loop that worked, per case — unchanged for Phase 4:

1. Read the case in full from its flow doc. The one-line index title is
   regularly misleading, and several premises are stale because the code
   moved under them.
2. **Probe the built CLI/MCP before writing anything.** Roughly a third
   of cases turned out already correct and needed only a test.
3. Write the test, watch it fail, fix, then **mutate the fix and watch
   the test fail again**. This caught several tests of mine that passed
   while asserting nothing.
4. All five suites, then commit one case (or a coherent pair) at a time.

### Traps that cost time

- **Every git test runs inside LocTT's own repo.** `withTmpLoctt`
  creates workspaces under `tests/workspace/`, so `isGitRepo` walks up
  and finds `.git`. Use `mkdtemp(tmpdir())` for anything git-related.
- **The MCP server is bundled into the CLI binary.** Rebuild `apps/cli`
  after touching MCP code, or you are testing a stale binary.
- **`lint --fix` moves imports between blocks.** It once sorted
  `ParseError`/`TokenizeError` into the `@loctt/contracts` import, where
  they do not exist, so `instanceof` threw at runtime. Re-run typecheck
  after any autofix, and read the diff.
- **A mutation that does not compile is not a mutation.** Check the build
  output, not just the test result. Removing a line often orphans a
  variable and the "mutation" never ran.
- **The same error string can appear at several call sites.** A blind
  `replace` aimed at `requireSupportedSchema` edited `planMigration`
  instead; the source looked right and the runtime did not change. Check
  which site changed in `dist`.
- **Real git or HTTP work needs an explicit test timeout.** Two web
  git-error tests passed alone and timed out at 5s inside the full
  `apps/web` run. A timeout reads as a product failure — check whether a
  failing test passes in isolation before believing it.
- **Fixtures lie quietly.** `makeTasks` passes no workflow config, so
  tasks start with *no* status; `createTask` needs a project id;
  `queries.yaml` entries need a ULID `id`. A wrong fixture usually shows
  up as a passing test, not a failing one.

Closed in this stretch (coverage 92 → 111):

| Case | Was it a live defect? | Commit |
|---|---|---|
| CFG-C4 | No — both behaviours correct, nothing held them | `2a646c5` |
| CFG-C5 | Yes — exit code right, explanation missing | `e74a547` |
| CMT-C5 | Yes — raw keys and ULIDs, no actor at all | `def23d0` |
| CMT-C8 | Latent — in-place reverse, safe only by luck | `def23d0` |
| GIT-C5 | Yes — web flattened conflicts into 500 | `ae336ca` |
| GIT-C3 | Yes — reconcile.yaml written by nothing | `6aec16d` |
| GIT-C6 | Yes — status had no drift at all | `c733582` |
| GIT-C10 | Partly — operations correct, messages named the wrong branch | `c733582` |
| MSL-C3 | Yes — schema docs still key-era; CLI half closed earlier | `148efaa` |
| ONB-C6 | Partly — routes existed; recovery pointed at a refusing command | `f0d9567` |
| ONB-C7 | Yes — doctor was prose only | `f0d9567` |
| PRU-C5 | No — name-addressing and ambiguity already correct | `95e1328` |
| PRU-C7 | Yes — delete_user's guard never fired | `95e1328` |
| QRY-C3 | No — all ten DSL constructs already run | `0dc287d` |
| QRY-C6 | Yes — views were unaddressable by id | `0dc287d` |
| REL-C3 | No — cap correct, untested because the fixture was slow | `ca18244` |
| REL-C4 | Yes — a file that could be attached and never detached | `ca18244` |
| REL-C5 | Partly — premise unreachable; handler hardened | `ca18244` |
| SPR-C2 | Yes — board rank ignored its column | `bda1499` |

Three notes worth carrying forward:

- **GIT-C5's premise was half stale.** The case says the handlers return
  400 with raw stderr; they had already been given structured envelopes.
  What was still true was the part the case listed last — conflicts were
  not distinguished, and `GitConflictError` was not exported from core's
  package root, so `apps/web` *could not* have distinguished it.
- **CMT-C8 could not be caught by asserting output.** The behaviour was
  already correct because `readHistory` re-reads the file each call. The
  test was proved meaningful by adding a cache to `readHistory` — the old
  handler then returned alternating orderings, the copying one did not.
- **CFG-C4's pass-through half needed a fixture that declares the
  optional blocks.** The shipped default `workflow.yaml` has neither
  `boards` nor `estimation.weights`, so a narrowing of
  `get_workflow_config` would have left every existing test green.
- **GIT-C10 is the shape to expect from the remaining cases.** Four of
  its six bullets were already satisfied; only the success messages were
  wrong. Probing first is what separated "build the feature" from "fix
  one string" — and the tests still had to cover the correct bullets, or
  the next change could break them silently.
- **GIT-C6's local-drift count went through three wrong implementations
  before a right one.** Publish mirrors `.loctt/` to the *branch root*,
  so branch paths are not working-tree paths and every index-based
  comparison (`read-tree`, `diff-index`, `status --porcelain`) either
  reported the whole tree as changed or dropped untracked files.
  Comparing blob hashes sidesteps the path mismatch. The exclusion list
  must come from the same sets publish uses plus `.gitignore`, or the
  count never reaches zero and means nothing.
- **Real git work needs explicit test timeouts.** The two web git-error
  tests passed alone and timed out at 5s inside the full `apps/web` run.
  A timeout reads as a product failure in the summary line; check whether
  a failing test passes in isolation before believing it.
- **I wrote a vacuous test and only caught it by mutating.** The
  guard-exemption test compared a guarded route against an exempt one
  using a too-new tracker — where both return byte-identical bodies. It
  passed with the exemption deleted. Rewritten around an empty version
  file, where the two genuinely differ. Mutation is not a formality.
- **The same error string appeared at three call sites.** A `replace`
  aimed at `requireSupportedSchema` silently edited `planMigration`
  instead, and the runtime behaviour did not change while the source
  looked right. Check `dist` for *which* site changed, not just that
  something did.
- **ONB-C7 replaced a test that asserted the old contract.** It was
  titled "returns prose diagnostic output" and survived the switch to
  JSON only because the check names still appear inside it. Per
  CLAUDE.md, a fix that requires editing a green test means that test was
  asserting the bug — noted in the commit.

The loop that has worked, per case:

1. Read the case in full from its flow doc — the one-line title in the
   index is regularly misleading, and several cases' stated premises are
   now stale because the code moved.
2. **Probe the built CLI/MCP before writing anything.** Roughly a third
   of the cases turned out already correct and needed only a test; the
   rest were live defects. Assuming either way wasted time.
3. Write the test, watch it fail, fix, then **mutate the fix and watch
   the test fail again**. This caught four tests of mine that passed
   while asserting nothing.
4. `npm run test && test:integration && test:e2e && typecheck && lint`,
   then commit one case (or a coherent pair) at a time.

### Traps that cost time here

- **Every git test runs inside LocTT's own repo.** `withTmpLoctt`
  creates workspaces under `tests/workspace/`, so `isGitRepo` walks up
  and finds `.git`. A test asserting "not a repository" silently proves
  nothing — use `mkdtemp(tmpdir())` instead. Relevant to the four GIT
  cases still open.
- **The MCP server is bundled into the CLI binary.** `apps/mcp/dist` is
  not what the tests spawn; rebuild `apps/cli` after touching MCP code
  or you are testing a stale binary.
- **`npm run lint --fix` moves imports between blocks.** It once sorted
  `ParseError`/`TokenizeError` into the `@loctt/contracts` import, where
  they do not exist, so `instanceof` threw at runtime. It also strips an
  `as "asc" | "desc"` assertion that the integration build then needs.
  Re-run typecheck after any autofix.
- **A mutation that does not compile is not a mutation.** Check the
  build output, not just the test result.

### Traps that cost time in the 2026-08-17 session

- **`npm run test` reports a summary line, not a verdict.** I called the
  core suite green five times while a test was failing, because I read
  `Tests 1443 passed` without checking for `FAIL` lines above it. Grep
  for `FAIL` explicitly; a count of zero is the only clean result.
- **`git stash` leaves untracked files behind.** Stashing to get a
  baseline left a new test file in place, which broke the build and made
  the baseline meaningless. Use `git stash push -u`, and check
  `git status --short` is empty before trusting the result.
- **`npx tsc --build` is not `npm run build`.** The CLI binary is
  bundled separately, so a core change verified through `tsc` alone
  tests a stale binary. Deleting `dist/` also poisons tsc's incremental
  state — recover with `npx tsc --build --force`.
- **A shell probe can lie in both directions.** An `awk` fixture told me
  the CLI stored a name when it stored a ULID, and I nearly reported a
  defect that did not exist. Read the raw file, not a parsed summary.
- **`withTmpLoctt` does not guarantee the `T` prefix.** A test assuming
  `T1` asserted against a task-not-found instead of the behaviour it
  named. Read the key from the create output.
- **An empty directory can be renamed over on macOS.** A fixture using
  one as a "failure" never failed, so the test asserted nothing. Use a
  non-empty directory, or a file where a parent must be created.

### After Phase 3

Phase 4's remaining groups (B–G, ~112 findings) in
[`audit-findings.md`](docs/dev/audit-findings.md), which now has the test net
Phase 3 built underneath it. Group G is ~79 cosmetic items — worth
leaving until after the UI build, since much of it is in code M2–M4
rewrites.

## Residual risk

Phase 1 moves case selection out of build time and a second agent reviews
the split, but both the partition and its review are agent work. The
completeness gate is mechanical; the judgement that a case sits with the
right ticket is not externally checked.

What holds is that the **cases themselves** are not agent-authored. They
were written before the code, and no agent may edit a flow doc. An agent
can misplace a requirement. It cannot invent or weaken one.
