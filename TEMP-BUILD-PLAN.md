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
| 5 · UI build | ✅ | **M1 through its gate** (round 8: 0 blockers, 0 majors). **All of M2 committed** (2.1 through 2.5b). **The M2 gate is next.** Coverage **449/937**, UI suite 329. Four core defects surfaced by probing before building — an unreadable `task.md` reporting as "task not found", an orphaned enum freezing every write to a task, plus `bodyToken` and `unarchiveView` built in core with no callers. **Complete 2026-09-02**: all 25 tickets in `TEMP-WEB-TICKETS.md` built and gated, M1–M4 through their section gates, M5.1 built. Seven suites green — unit 3145, integration 462, e2e 21, UI **658 with nothing skipped**, coverage 827/961. The last quarantined test (PRU-46) was un-quarantined by K16. |
| 6 · Cleanup | ✅ | **Group G done: all 55 resolved, 18 needed a change** (`db3ec7c`..`cf58e9c`, six batches). Two thirds needed none — ten already fixed by Phase 5, five "dead" exports had gained callers, several wrong when re-measured. **Verifying each item before fixing it is what this phase proved out**: `UserSettings` `.passthrough()` looked like drift and is load-bearing — every settings panel saves `{...stored, ...next}`, so `.strict()` would reject an unknown key *on save* and editing a card layout would destroy sidebar pins. Applied as filed, that finding causes data loss. **Three fixes were latent bugs of one shape** — a field list written twice, where adding to one copy and forgetting the other loses data with no error: `projectTaskFrontmatter` (the CLI's JSON, MCP output and web API at once), `saveProjectsConfig` (a config value), and the archive triple across three call sites. None was filed as a bug; all three as "duplication". Sharing the archive mutation also **exposed a coverage hole rather than fixing one**: `bulkArchive` never asserted `archived_at`, so 15 tests passed with the field dropped. **The flakiness is diagnosed and fixed** (`db7b26a`). It never recurred on its own, so it was provoked: under 9 busy-loop processes the integration suite went **30 failed / 432 passed**, and then reproduced with no load at all. **The output nobody had**: 27 of 30 were `Test timed out in 15000ms` — not assertions — and summed `import` was **194 s against a 213 s wall clock**, the tell that workers were contending rather than tests being slow. Neither `vitest.integration.config.ts` nor `vitest.e2e.config.ts` set `maxWorkers`, so vitest ran one per core; these spawn the real `loctt` binary and an MCP stdio server, so ~10 processes each fan out more. Default → **5, 8, 9 and 30 failures across four runs**; `maxWorkers: 2` → **462 passed, exit 0, twice**. **e2e had it too**, found while gating the fix — 2 of 21 in isolation, always a timeout, never an assertion; at two workers, 21 passed. **The plan's recorded diagnosis was wrong and its instruction was right**: it blamed vitest's 5 s default (both configs have carried explicit timeouts since they were written), but its rule — do not raise a timeout that may not be the cause — is exactly what kept the contention from being masked. Also explains one-off timeouts earlier in the run that were attributed to the environment. |
| 7 · Corruption-handling framework + audit | ✅ | **Complete 2026-09-05** (`dac055c` spike, `fda55ef` proposal+review, `c879b13` framework+audit). The four steps ran as planned. **(1) Spike** — one cell (wrong-typed `due_date`, editing `status`) end-to-end, mutation-verified; it surfaced that strict frontmatter parsing is embedded at ~50 read sites + 3 writers, not the four first counted. **(2) Fable proposed** the framework: `readTask` itself becomes tolerant (no `*Tolerant` twin), corrupt values live in a `health` list not in typed `frontmatter`, one write guard "a finding may leave `health` only for a touched field", severity = object-fatal (`{id,key}`/unparseable) vs field-local. **(3) An adversarial Fable review** returned PASS-WITH-FIXES — 2 blocking (the guard permitted silent raw-value loss on merge ops; six task.md writers not three) both verified against code and amended; it also settled the decision surface (2 of 3 "needs Ken" were already answered) and caught a missed one (P7 "byte-preserved" silently narrowed). **Ken ruled** K26 (fatal set `{id,key}`; title/timestamps degrade) and K27 (P7 → value-preserved). **(4) The audit** (`docs/dev/corruption-audit.md`, 44 cells): 28 handled, 2 defects fixed (D1 archive-no-op-over-corrupt-`archived`; D2 a ULID leak this work introduced), 0 unspecified; reconcile rows (BAK restore, git merge, PRU partial remap) handled-by-design. **Verified by the coordinator's own mutation, not the builder's report** — and that caught a coverage hole: the builder's write-guard test was vacuous (green with the guard disabled), replaced with real tests for both guard rules. Gate: core 1816, web 1128, integration 465, e2e 21, typecheck/lint 0. Decisions K26/K27 (Ken), A135/A136 (agent); north-star P7 reworded. |
| Z · Final quality review | 🔵 | **Started 2026-09-06.** Ken's per-batch loop: **review a batch → fix → code-review the fixes (+ handle new issues) → tests green → commit → repeat** until Z done. **Batch 1 (correctness × 5 components): reviewed + Fable-verified**, 12 findings confirmed (2 critical git data-loss G1/G2; blocker T1 move drops health; high C1 staged-swap recovery, WS1 UnreadableFileError→500; major T2 set/unset parity; med-high C2 saved-view field loss [residual in K28]; medium C3 workflow dup-key, Q1 date-boundary, Q2 text= inversion; moderate WS2 init error map; low WS3 search unreadable). Findings+verify docs: `docs/dev/phase-z-{findings,verify}-*.md`. **Batch 1: DONE — fixed, fix-reviewed, gated, committed (`860d624`).** All 12 findings fixed (G1/G2 critical git data-loss, T1 blocker, + 9), each mutation-tested; fix-review caught + fixed a G1 regression; K29 + prefix-validation gaps recorded. **Batch 2 reviewed** (parity/data-flow/perf/security/a11y+code-smell): 14 candidates — security 2 HIGH (restore zip-slip), data-flow 1 major (web milestones client drops K28 `unreadable`), parity 4 (F1 sprint-progress web-only contradicts K28 decision text; F2 view-mgmt web-only; F3 backup/restore no web; F4 task-export web-only — F3/F4 need a Ken ruling), a11y 1 major (ReconcilePanel unlabeled control), code-smell 2 major + 4 minor dead exports (+ PRU-44 edit-prefix never built in web UI), perf ~0 actionable (measured clean, 2 low/info notes). **Batch 2 verified; Ken ruled K30 (build all four parity gaps).** Security zip-slip (SEC-1/2) FIXED by coordinator, mutation-verified (restore.ts containment guards). 4 build/fix agents running: F3 web backup/restore, F2 CLI+MCP view mgmt, F1 sprint-progress+milestones-unreadable, F4 export+PRU-44+a11y+5 dead-code deletions. All 4 build/fix agents landed + security fix; shared files (server.ts, errors.ts, settings client, docs) merged cleanly; coordinator fixed an autofix-induced BackupPanel.test breakage + updated the MCP tool-list snapshot for the new tools. **Full gate GREEN: core 1918, web 1209, integration 486, e2e 21, typecheck/build/lint clean.** Now: fix code-review (adversarial) in progress; commit Batch 2 when clean → Phase Z done. **Scheduled last** (Ken, 2026-09-04). Always the last phase — inserted after everything else, whatever the highest number. A full-codebase quality review for bugs, code smells, and computationally heavy paths. **Slicing: an aspect × component grid** — primary axis is the aspect (correctness / performance / security / a11y / code-smell), secondary is the component, so an agent reviews e.g. 'performance of `core/query`'. **Plus two cross-cutting slices a grid cannot cover**: (1) **strict parity** — every core capability exists on all three surfaces (the class that found `unarchiveView` by accident; here it is looked for on purpose); (2) **cross-component data flow** — trace high-risk paths end-to-end (a UI→API→core→disk write, a sync round-trip), where component-sliced agents structurally cannot look. **Up to 5 agents in parallel**, next starts as one finishes. **Finding bar: a Fable agent adversarially reviews each batch's findings before they land** — the reviewer is not the verifier; a claim is not a finding until the Fable pass confirms it (a bug needs a repro/failing test, a perf issue a measurement, a parity gap the missing caller shown). This is the pattern that worked three times this session for hard diagnoses. Reviews the finished code, so nothing reviewed is rewritten after. |

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
| M2.4a | comments | `9966c2b` | 12 of 12: CMT-1..12 | Every route already existed; this is the client. Composer and edit both reuse M2.3's `RichEditor` / `RichBuffer` rather than a second editor. **CMT-3 and CMT-7 pull opposite ways on one surface** — reopening an edit must show markdown source, and the `@` picker is a ProseMirror affordance — so an edit opens raw and the composer opens rich, both with M2.3's toggle (A?). **The reload in CMT-10 made it vacuous and it was proved so**: caching the mention resolution in a module map left it green, because a reload throws the cache away. Replaced with a real hidden → visible refocus; the same mutation now turns it red. Rendering is React elements throughout — no `dangerouslySetInnerHTML` anywhere on the path — so CMT-22's injection is structurally absent rather than filtered, and the one attribute sink (`href`) takes a scheme allowlist. Two defects I introduced and fixed: the composer did not clear after a post (an effect ran after the remount it was meant to seed), and the comment body stored a trailing newline. Nine M2.3 body specs went red on a bare `getByTestId("rich-editor")` that stopped being unique once a second editor was on the page — locators scoped, behaviour unchanged. **CMT-10's fourth bullet is not satisfiable**: there is no `mentions` field in the query DSL and no comment-scan endpoint, recorded in `TEMP-RUN-WORKFLOW.md`. |
| M2.5b | attachments | `12932d0` | 7 of 7: REL-35..41 | **M2 complete.** A live defect found and deliberately not fixed: attachment names **alias by case on macOS** — `DELETE .../DROP.TXT` returns 204, deletes `drop.txt`, and logs a removal naming a file that never existed. Found because a `.toUpperCase()` mutation stayed green; left alone because no case covers case-folding and the fix changes what CLI and MCP accept. Also **a mutation that did not mutate**: neutralising `basename` in `multipart.ts` left REL-36 green, because core's guard is the load-bearing one — verified by uploading `../../../ESCAPED.txt` with the web guard gone and watching it land safely. The redundant line stays; the overstating *comment* was fixed. Coverage 442 → 449. |
| M2.5a | relationships | `c9d6c5c` | 35 of 44: REL-1..15, 21..34, 42..46, XS-25 | **A blocker: a dangling link could not be unlinked from *any* surface** — 404 from the web route, exit 1 from the CLI, a raw ENOENT 500 from core. The one operation for cleaning up after a deletion was the one a deletion made impossible. The agent fixed core and the route; **I measured all three and the CLI was still broken**, so a core fix only one surface could reach. Fixed and covered by a test asserting through the CLI specifically. The agent also **rejected two of its own mutations** for going red on a `waitForResponse` timeout rather than the assertion. REL-31's own phrasing does not reach its premise (re-dropping on the same anchor is a measured no-op) and the case had no test anywhere. REL-33's second bullet stopped rather than narrowed. Coverage 409 → 442. |
| M2.4b | activity feed | `1ae1761` | 16 of 27: CMT-13/14/15/16/17/19/26/27/28/29/30/31/36/37/38, XS-53 | **CMT-31 was vacuous and my own probe had said otherwise.** Playwright inherits the host timezone, which equals the workspace's — so the workspace-timezone lookup could be deleted and the spec stayed green. Verified both halves: pinned spec red on the defect, unpinned original green against the same broken code. Generalised in known-gaps: any spec about *which clock the app reads* must pin a differing zone. It also corrected my CMT-37 note — a file with one broken row read back as a **complete, shorter history** no client could question (A17). Two of its own mutations were **inert, not survived**, caught by probing the mutated bundle. CMT-18 stopped rather than decided: a tab shell would move sections four tickets already built into. Coverage 394 → 409. |
| M2.4a | comments | `9966c2b` | 12 of 12: CMT-1..12 | **CMT-10 was vacuous as written and the agent proved it** — caching the mention resolution left it green, because its `page.reload()` rebuilds the JS context and throws the cache away. The XS-1 defect in a new place. Replaced with a real refocus; confirmed here by freezing the `useMemo`. CMT-22 asserts what the DOM *contains* with a paired positive, and rendering is React elements throughout, so injection is structurally absent rather than filtered. Two defects caught by specs asserting the far end (`_comments.yaml`, not the screen). Nine M2.3 specs were **narrowed** (not weakened) for a locator the page outgrew. Decision A16. Coverage 379 → 394. |
| M2.5a | relationships | `c9d6c5c` | 35 of 44: REL-1..15, 21..34, 42..46, XS-25 | Rendering and interaction; the API was in good shape. **Two live defects found and fixed, both blockers for REL-24/44**: a relationship whose target was deleted out of band **could not be unlinked from any surface** — the web route resolved the target first (404) and core's `unlinkTask` then read it unguarded (raw ENOENT → 500), so the one operation for cleaning up after a deletion was the one a deletion made impossible. Fixed in core plus the route, with two tests and a `? ` decision. **REL-31 had no test anywhere** — `reorder.test.ts` never mentioned rebalancing — and the case's own phrasing does not reach it: re-dropping the same row on the same anchor is a **no-op** after the first (measured), so the rank never grows. Two leapfrogging rows do, and the test says so. **REL-32's first two mutations were rejected, not scored**: both turned it red on a `waitForResponse` timeout rather than on the convergence assertion, which is a red for the wrong reason; the spec was restructured to assert only the outcome, and the third mutation fails it at the "an order neither user chose" check. **One defect I introduced, caught by REL-44**: a refused remove on a group's *last* row unmounted the section a frame after the message appeared, so the user was told nothing — errors for vanished groups now render at panel level. `loctt link` rejects the inverse side of a relationship the API accepts (`known-gaps.md`). 9 not claimed: REL-16..20 and 47..50, every one an attachment case, which the M2.5 probe assigned to M2.5b. **REL-33's second bullet is unimplemented at the API layer** — `reorderRelationship` never reads `ranked`, and a rerank on a kind switched to `ranked: false` answers 200 and writes a rank; its other two bullets are covered. Unit 2521 → 2547, UI 290 → 320. |
| M2.4b | activity | `1ae1761` | 16 of 27: CMT-13, 14, 15, 16, 17, 19, 26, 27, 28, 29, 30, 31, 36, 37, 38, XS-53 | The data was already there (probe); this is rendering, with **one server change**. **CMT-37's second bullet was not satisfied** despite the probe recording it as such: `readHistory` drops malformed rows and reports nothing, so a file with one broken entry read back as a *complete, shorter* history — the route now reads rows and reports `unreadable` (A?). **Two mutations were inert, not survived, and were caught rather than scored**: a non-consecutive bulk grouping is unreachable from a reverse-ordered fixture through the branch I first mutated, and the "no `bulk_op_id` never collapses" rule needed *two adjacent* no-id entries before any mutation could break it — the spec's fixture was widened. **CMT-31 was vacuous and proved so**: Playwright inherits the host zone, which here equals the workspace's, so deleting the workspace-timezone lookup left it green; the spec now pins the browser 21 hours away and the mutation turns it red (`known-gaps.md`). **One defect I introduced, caught by CMT-38**: `useInfiniteQuery.isError` is true for a failed *next* page, so a failed "Load more" replaced the 50 loaded entries with a full-panel error — the inverse of the case's first bullet. Guarded on `data === undefined`. Grouping never sorts (A?), so CMT-30 holds structurally rather than by a stable-sort accident — and the test file records that a stable descending sort is *correctly* undetectable. 11 not claimed: CMT-18 (needs a Comments/Activity tab shell nothing has built — both sections are stacked on one page today), CMT-20–25 and CMT-32–35 (all comment-surface behaviour: 80-comment pagination, mention/injection round-trips, post/edit/delete failure paths — M2.4a built the surface and this ticket built no part of them; CMT-21, 22 and 35 have partial unit coverage from M2.4a). Unit 2463 → 2503, UI 276 → 290. |
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
| M2.6 | duplicate | `01c9230` | 1 of 1: TSK-20 | **The `(copy)` suffix is core's, not the CLI's** — the ticket brief and the M2.6 probe both attribute it to the CLI's `overrides`; `duplicateTask` reads `title: overrides.title ?? \`${fm.title} (copy)\`` and the CLI and MCP both merely inherit it. That inverts the decision: titling the web copy identically would make web the only surface overriding a documented core default. Recorded as **A24** with a one-argument revert. Built: `POST /api/tasks/:ref/duplicate`, a `useDuplicateTask` hook, a More-menu item, and navigation to the copy's *server-allocated* key. Five tests, each shown to fail: dropping `saveState` reds the repeat-duplicate key test; returning the source's frontmatter reds two; swallowing the 404 into a 200 reds the third; appending to the source after the copy reds the "original unmodified" assertion at **both** layers; removing the menu item and removing/misdirecting the navigation red the two UI specs. **One assertion I could not prove**: the 404 test also asserts `state.yaml` is unchanged, and I could not make that half fail independently — deleting the pre-lookup guard leaves it green, because `duplicateTask` throws before allocating and `saveState` is skipped. It is belt-and-braces, not load-bearing; the status assertion is the real one. Also: the stated unit baseline of 2551 is stale — the tree measures **2554**. Unit 2554 → 2557, UI 332 → 334. |
| M2 gate r3 | section gate | `479d5ae` | — | **FAIL → 1 of 2 blockers closed.** **B1 (fixed):** round 2's F5 fix reached the CLI and MCP but not the web *client* — `attachmentsError` was serialised by the server and read nowhere, so an unreadable directory rendered "No attachments on this task yet." while the activity feed said a file was attached. REL-49 read as *covered* on four `@verifies` tags, all four in core, none rendering a page; no UI test `chmod`ed a directory. Fixed in `AttachmentsPanel` + `TaskDetail`, recorded as **A25**, with the first UI test for REL-49 — red when the call site drops the prop. **B2 (open, Ken's):** K2's body-write precondition is web-only. `bodyToken`/`expectedToken` appear in `apps/web/src/server/server.ts` and in neither `apps/cli/src` nor `apps/mcp/src` (positive control run); core's own docstring says "Omit for last-write-wins, which is what every existing caller gets." K2's rationale names the CLI and MCP as *the threat*, so the guard protects the web editor from itself while the two surfaces it was written about write unguarded. Fixing it changes behaviour on two published surfaces — load-bearing, so it stops the run. **Gate method note:** zero vacuous tests found, but by scripted sweeps plus two close readings, not a full 334-test mutation — the report says so rather than implying a clean sweep. Also fixed: the CMT-10 flake, a 31s sleep against a 30s `staleTime`; it now waits on the refetch, and still reddens when a resolved name is cached. One suite failure was **my own build racing the run** (`dist/index.js` briefly absent), not a defect — 59/59 on re-run. |
| M3.1 | board view | `8583f4d` | 29 of 29: BRD-1..8, 14..24, 33, 39, 40, 45..48, ONB-11, MSL-5, MSL-20 | **A real defect the ticket did not ask for, found by writing the BRD-21 test**: the board rendered a 900-task column under a header reading `200` — page-size-as-total, which BRD-21's first bullet rules out and which would have made the board disagree with the list's count for the same filter (BRD-24). Measured at 200, fixed by exhausting the feed, re-measured at 900; **verified by my own mutation** (stop after page 1 → red). **BRD-45 implements Ken's ruling**: validation stays strict, the board renders the refusal — file, column index, duplicated status, how to fix — and asserts it does *not* silently fall back to 1:1 columns; verified by my own mutation (guard unreachable → red). Its "falls back to 1:1" bullet is unreachable by design and recorded. **Not built, deliberately**: MSL-20's `+N` hover-card (needs a popover component no case authorises — Ken has not approved it), BRD-21's two drag bullets and BRD-40's create modal (both other tickets). **Already built, found before rebuilding**: `LabelsCell`'s `+N` overflow and contrast helper, `useMainScrollRestoration` for BRD-8, and the `config_invalid` envelope, which already named the file and column. Decisions **A26** (chip visibility stores *hidden* columns, so a newly configured column is not silently hidden) and **A27** (200-row pages). Layer: all presentation stayed in the web client — a column is not a concept the CLI or MCP has. **A method error of mine**: I twice read "mutation absent from `apps/cli/dist/index.js`" as evidence it was dead, but the client is not bundled there and its local names are minified away, so that grep cannot succeed either way. The mutation was live; the test going red is the only honest check for client code. Unit 2557 → 2584, UI 334 → 364, coverage 455 → 487. |
| M3.2 | board drag-drop | `771bb1f` | 23 of 24: BRD-9..11, 13, 25..32, 34..38, 41..44, 49, XS-9 | **`setFields` got its first caller on any surface** — CW-5's atomic status+rank write; the route had been calling the singular `setField`, one field per request, and two writes where the case demands one leaves a card in a column its status contradicts if anything fails between them. `board_rank` is auto-managed so `setFields` refused it; rather than un-manage the field for every caller, an opt-in `allowAutoManaged` grant (empty by default) is passed a named constant holding exactly `board_rank`, so it is greppable and cannot quietly widen — `completed_date` stays server-computed on every path. **BRD-31 fixed in core**, the defect the case names outright: a no-op drop wrote history and bumped `updated_at` while the rank never changed. Measured before (rank `u`, history 2→3, `updated_at` advanced) and after (nothing written); **verified by my own mutation** — a guard that can never match reddens `reorder.test.ts`, and the CLI repro confirms CLI and MCP inherit the fix. **A defect the agent introduced and caught itself**: the no-op check first compared indices, but a held card leaves the flow, so cards below shift up and a pointer held still resolves one slot lower — sending exactly the write BRD-31 forbids; it now compares neighbour pairs. **BRD-12 cannot be satisfied — awaiting Ken.** A column may collapse several statuses, but `reorderBoardRank` scopes rank per status and refuses a sibling-status anchor (the recorded SPR-C2 fix, whose premise "a board column is a status" `workflow.boards` made false), so the board renders an order no drag can produce. Marked `test.fixme`, not `skip`: it runs and is expected to fail, so it starts passing loudly when core is fixed. **BRD-21's two drag bullets not built** (no virtualization to drag from, no edge auto-scroll); BRD-21 deliberately not tagged. Decisions **A28–A30**. **A method error of mine**: an `&& false` mutation made a branch unreachable and changed an inferred type, so the build failed and that run proved nothing — redone with one that compiles. Unit 2584 → 2609, UI 364 → 385 (+1 `fixme`), coverage 487 → 508. |
| M3.3a | timeline rendering | `842bc46` | 14 of 17: TML-1..8, 12..17 | **A core defect fixed that no M3.3a case names, but TML-34 makes unreachable otherwise**: `autoClearTimelineDependency` **deleted** `timeline.dependency_relationship` from the user's own `workflow.yaml` on every write whenever it named a key not in `relationships`. A user who typed `dpends_on` got no arrows, no message, and the evidence erased from the file they would open to find it — and TML-34's "a visible configuration notice naming the missing key" is impossible once the key is gone. Removed; `dependencyRelationshipStatus` now reports `{kind:"missing", key}` for the notice M3.3b draws. **Two green tests were asserting the bug** (`toBeUndefined()`) and were inverted, one now reading `workflow.yaml` off disk — flagged per CLAUDE.md. **Verified by my own mutation**: restoring the auto-clear reddens both; `Math.floor`→`Math.round` in `xToDate` reddens six geometry tests. Arithmetic is separated from React (`geometry.ts`, `rows.ts`, `settings.ts`, `arrows.ts`, `layout.ts`) precisely because a UI test asserting "a bar is visible" passes whether or not its geometry is right. **Not built**: TML-9/10/11 are drag *writes* (M3.3b); TML-12's snap math is unit-tested, its drag half deferred. **Drift the agent flagged against itself**: its `nonWorkingReason` duplicates `DateField`'s holiday/weekday predicate — logged in `known-gaps.md` with the extraction sketched, `DateField` left byte-for-byte unchanged rather than trading a passing TSK-8 case for tidiness. **A vacuous probe of mine**: I tried to demonstrate the old deletion through the CLI, but the value survived on the *old* binary too — because `saveWorkflowConfig` is exported from core and called by **no CLI or MCP command**, so no CLI path triggers a workflow write. Another built-but-uncalled export; the unit test is the only honest check. Decisions **A31–A33**. Unit 2609 → 2676 (+1 pre-existing skip), UI 385 → 399, coverage 508 → 522. |
| K8/K9 | board column model | `69c5112` | BRD-12 unblocked (was `test.fixme`) | **Ken's ruling, and he corrected my framing twice before it was right.** `reorderBoardRank` did `const column = moved.frontmatter.status` — a variable *named* column holding a *status*. True when a column was one status; `workflow.boards` made it false. The symptom was worse than a refusal: core rejected the write *after* the optimistic UI had moved the card, so **the user saw the card move and the write never landed**. My first proposal was to widen the status filter (Ken: I was reasoning from storage outward); my second was one global ordering with a column as a filter over it (Ken: "i was thinking a column is its own sequence... new tickets added just gets put at the bottom of the column" — and he was right, `{kind:"end"}` does `between(last, MAX)`, so a global sequence puts a new ticket after every card in every column). **A Fable review then corrected the mechanism**, and all three findings were real: routing `handleBoardMove` through `reorderBoardRank` is impossible (it throws on both anchors and writes only `board_rank`, losing BRD-41/XS-9 atomicity) so a new core `boardMove` was needed; **duplicate ranks are normal** under per-column sequences and `between("u","u")` threw a plain `Error` escaping the server's `instanceof ReorderError` catch as a **500 on an ordinary first drop into an empty column**; and SPR-C2's tests would stay misleadingly **green**, so the cross-status test had to be written and shown to fail first — it was, with the exact `ReorderError` K8 names. `deriveColumns` moved to core (pure logic over contracts types; its header comment argued *against* that and was rewritten). `handleBoardMove`'s duplicate interpolation deleted — it had **no rebalance logic at all**, so cross-column drops could grow ranks unbounded. **SPR-C2's assertions were NOT edited** and remain correct: their fixture has no `boards` block, so those statuses genuinely are different columns; only the docblock's false premise and the error message changed. **Two false passes the agent found in its own work**: a duplicate-rank test that passed with the guard half-reverted (two duplicates is not enough — the moved task is excluded from `peers`), and a CLI probe run against a stale bundle. It also **deleted two guard branches it had written that were provably dead**, each surviving its own mutation only because the other rescued it. **Verified by my own mutations**: `lastIndexOf`→`indexOf` reddens the duplicate-rank test; BRD-12 passes through browser, server and disk. Decisions **A34–A38**. **Open**: `boardMove` is core-with-only-a-web-caller — the `unarchiveView` pattern CLAUDE.md warns about — awaiting a ruling on a CLI/MCP follow-up. Unit 2676 → 2694, UI 399+1 skipped → **400 passed, 0 skipped**. |
| M3.3b | timeline drag + errors | `d867147` | 33 of 37: TML-9, 10, 11, 18..25, 28, 29, 31, 33..50, PRU-1 | **The atomicity gap was real, and this is the second time this run a case needed `setFields` and found only the singular route.** No web route could satisfy TML-11's "a single atomic multi-field write" — `TASK_SET_RE` → `handleSetField` is one field per request, so a two-date shift meant two sequential calls, and a crash between them leaves a task whose start is after its due date: exactly the anomaly TML-18 renders. New `POST /api/tasks/:ref/set-dates` reaches core's `setFields`. No grant needed — the date fields are `BUILTIN_OPTIONAL_FIELDS`, checked rather than assumed. **Atomicity asserted on disk**: two sequential `set` calls stamp two `updated_at` values, one `setFields` stamps both lines with the same one; the test asserts the shared stamp *and* carries the two-timestamp case as its positive control. **Verified by my own mutation**, which also exposed a useful asymmetry: splitting the write into two sequential `setField` calls *inside the server* reddens the disk-trace test but **not** the request-count test, which correctly counts one client→server request. Neither test alone is sufficient; the agent wrote both. (That mutation first failed `TS6133` — the same non-compiling trap — and needed a `void setFields` to keep the import live.) **A defect in M3.3a found by writing these tests**: the 1px edge handles were **not hit-testable** — `elementFromPoint` at a bar's right edge returned the BUTTON, so an end-edge drag dispatched as a *body* drag and wrote both dates where TML-9 demands one. Rendering tests could not see it. Fixed with a 6px hit area (**A40**), which is TML-36's own first bullet. **TML-34's notice now exists**, which A31's core fix made possible. **Not met, logged not faked**: TML-26/27/30/32 need a virtualization layer that does not exist; TML-48 is partial (**A41**) — `start_date: "next tuesday"` fails the schema on *read*, so the API returns the task in `unreadable` and the client is never handed a bad value for the lane. **Four of the agent's own fixtures were wrong, caught by measuring**: `blocks` is acyclic so TML-33's cycle cannot use it; `depends_on` is not in the default workflow; the project filter takes a ULID; and a bare word in `?q=` **does not filter** — it returned the full set, which would have made TML-41 pass for the wrong reason. Decisions **A39–A41**. Unit 2694 → 2716, UI 400 → 438, coverage 522 → 555. |
| M3.4 | create task modal | `d257368` | 42 of 42: NEW-1..41 + BRD-40 | **Built twice — I destroyed the first attempt.** A board test failed and, to check whether it was pre-existing, I ran `git stash` in the worktree; the `pop` conflicted and left the entry unrecoverable (absent from `stash list`, the stash reflog, and `fsck --lost-found`). ~16 files and 84 tests lost. "Never `git stash`" is in every brief I write, because a gate agent destroyed 45 lines that way earlier in this run. The rebuild was a re-execution rather than a rediscovery: the first agent's report named every file, defect and wrong fixture. **Reused, not rebuilt**: `POST /api/tasks` was already atomic under one state lock and already called `resolveProjectIdForUser`, whose docstring names the exact chain the ticket asked to test; `LabelsField` already had inline create with TSK-55's ordering; `RichEditor` already existed. Only the toast was missing. **Three defects found by writing the tests**: `POST /api/tasks` **leaked a 500** on a bad custom-field value (bare `Error` matching none of the handler's branches, reason stranded in `detail` behind "The server failed", recovery `reload`) — the same value via `setField` had always been a clean 400; **measured by me on both binaries**, 500 `unknown` before, 400 `validation_failed` naming `fields.points` after. **Every picker saw only the first 100 entries** (no `limit` sent, `DEFAULT_PAGE_LIMIT` is 100), so searching for an existing label offered to create a duplicate — measured `total: 200, items: 100`. And `<input type="number">` silently discarded NEW-40's bad paste, making the case unreachable rather than satisfied. **Two regressions the rebuild introduced and I caught**, both deterministic, not flake: **BRD-42** (`no box for column in_progress` — the per-column "+ Add task" broke a column still rendering for a status deleted from `workflow.yaml` since page load) and **TSK-46** (the archived-reference fix emitted `name (ULID)`, and TSK-46 asserts the ULID is *absent*). The second is the interim side of **K13**, Ken's project-wide error-vocabulary audit after M4 — the shipped form is the reading that satisfies both ERR-43 and TSK-46, not a settled answer; three unit tests asserting the combined format are inverted and say so. **The distinguishing technique**: TSK-46 failed 9/10 at *file* level while passing in isolation — running the file, not the test, is what separated it from ambient flake. **REL-28 fixed** (`test.slow()` scoped to the test, not the file — at file scope it would have tripled the budget for all 30 tests and disabled the guard); **REL-30 and REL-32 logged, not fixed** — REL-32 finishes in 4.9s, so its failure is a two-tab race resolving differently under load and more time cannot help. **A directory error of mine, four times**: `cd` does not persist between Bash calls, so commands without their own `cd` ran in the main tree — including one that made my REL-28 fix land in the wrong tree entirely, producing a *false* "verified" claim. Predicting the pass count before reading it (482, not 438) is what caught every instance. Unit 2716 → 2762, UI 438 → 482, coverage 555 → 594. |
| M3.5 + K11 + K12 | sprints, board-move surfaces, +N reveal | `1685989` | 15 of 16 SPR + K11 + K12 | **M3 is feature-complete.** **A test that nearly shipped passing for the wrong reason**: mutating the client to send a sprint's *name* instead of its id left SPR-4 **green** — `POST /set` resolves a name back to an id server-side, so the file on disk was right while the request was wrong. Only SPR-24's ambiguous-name case caught it. SPR-4 now asserts the request payload too. This is a limit on "assert the far end": the far end is not sufficient when something downstream repairs the mistake before it lands. **Verified by my own mutation** (name-for-id → SPR-4 red). **Drag reuse verified, not inherited**: `useBoardDrag` had exactly two status-specific pieces; widened in place, `BoardView` needed **no edit** and its 30 tests pass untouched (A51). **K11**: `loctt board-move` + MCP `move_board_card` — `boardMove` had been core-with-one-caller, the `unarchiveView` pattern; a CLI user needed two writes for what the op exists to make atomic. **K12**: `+N` reveal built once in the shared `LabelsCell`, portalled because `Menu` anchors with CSS `absolute` and both call sites clip (`createPortal` had **zero** hits in the client before this, A54). **Could not satisfy**: SPR-6's third bullet — the query language has **no** "field is unset" operator, measured with a positive control (A55); logged as a real usability hole, since `sprint = null` silently matching nothing *looks* like an answer. **No server work was needed** — A48/A49/A50 held under building, and the two false claims in the ticket are now struck through in place. The agent caught **four** of its own wrong fixtures, including a tracker fixture that writes frontmatter *verbatim*, which would have made the specs pass against a view that read names. One full-suite failure (SHL-6) was flake: 168/168 at file level, and SHL-6 touches no labels, so K12's `cells.tsx` change is not in its path. Unit 2764 → 2799, UI 482 → 500, coverage 594 → 609. |
| K10 | body precondition on CLI + MCP | `6ac31d8` | M2 gate blocker 2 — CLOSED | **Ken's ruling, and the agent's design call beat mine.** I offered two ways for MCP to obtain a token; it rejected mine — deriving it server-side from a caller-supplied `updated_at` — as "a weaker guard wearing the same name": `bodyToken` hashes `updated_at + "\0" + body`, so deriving it hashes the caller's timestamp against **whatever body is on disk now**, passing regardless of which body the agent actually read. Verified at `io.ts:167`. So `get_task` returns `body_token`, matching the web; all three surfaces name one concept one way (**A56**). **A core gap my probe missed**: `appendTaskBody` took **no options at all**, so `expectedToken` was honoured on replace and **silently ignored on append** — the more dangerous half, since an append reads existing text in order to add to it. Verified absent at the baseline SHA; the new guard confirmed by mutation (dropping just the token reddens the append test — it took three attempts, two failing `TS6133`/type errors, and a non-compiling mutation proves nothing). **Verified end-to-end by me against a real tracker, off disk**: stale token → refused with "your text has NOT been saved" and the file still holds the *other* writer's text; current token → writes; no flag → last-write-wins, unchanged. **An honest null result worth keeping**: unregistering `StaleBodyWriteError` leaves both e2e suites green — the MCP SDK renders a rethrown handler error identically and the CLI's outer catch prints the same line — so the agent asserted the classification at the only layer where it is visible rather than shipping two tests that look like coverage. **A regression it introduced and caught**: reading `workflow.yaml` for the opt-in made a *malformed* config break `loctt body --set`, which never needed that file. **Residual risk, recorded**: a `loctt body --set` racing a browser autosave still silently destroys the browser's edit — the accepted cost of the last-write-wins default. Unit 2799 → 2805, integration 427 → 439, UI 500 (0 failures; the agent's 5 `flow-list` reds did not reproduce). |
| M2 gate r4-r6 | section gate | `bac3335` | 15 findings, all real | **Six rounds, and no case was ever re-broken** — `git log -S` per case ID shows each touched in at most one commit, so these were fifteen distinct problems, not one bug iterating. **The through-line: coverage counts tags, not truth.** A case is scored green the moment a `@verifies` comment exists; the tool cannot check the test beneath it. Rounds 3-5 each reported "zero vacuous tests" **by sampling**; round 5 recommended a systematic audit itself, and round 6's tag-to-case pass over 113 of 171 M2 cases (all 70 blockers) found **five** real gaps where sampling had found none. What it found: **CMT-31** shipped vacuous *in its own fix's commit* — `// pin removed (simulating the vacuous original)` committed where `test.use({ timezoneId })` belongs, under a comment still claiming the pin was load-bearing (proven both ways: with the pin the mutation fails, without it 15/15 pass). **TSK-51** had zero tags; its test was tagged `TSK-21` and titled `TSK-44` — three case IDs for one test — and is the sole guard of "a 200 with a non-empty `failed[]` is not success". **REL-8**'s retired-key bullet and **XS-11**'s "Keep both" were asserted only in test *titles*: disabling the entire exact-lookup left 30/30 green, and replacing the merge with `conflict.mine` — silently dropping the CLI's text, losing exactly what the option promises to keep — left 11/11 green. **REL-16** forwards to a known-gaps entry that was never written, so a blocker ships knowingly unmet; now recorded, and Ken ruled **K14** on what to build instead. **Three false "shipping bug" reports of mine**, all from a stale `apps/web/dist` — the browser running old code while `git diff` showed new. Each went to a Fable agent after failing twice, and **all three times the fault was my reasoning, not the app**: Playwright retargeting `toBeDisabled()` through a `<label>`, my own un-rebuilt sabotage, and a test racing the write by ~35ms. Both traps are now in known-gaps. **One live defect found and deliberately not fixed**: a resolved conflict can re-open its own dialog (blur-flush 409 landing after Apply, 1-2 in 10 runs) — no data lost, but the fix touches the autosave state machine K2 and K10 both cover and no case describes it, so it went to a Fable agent for review at Ken's direction. Unit 2805, UI **507/507**, coverage 609 → 618. |
| M2 gate r7 | section gate | `279ebe7` | **0 blockers — M2 CLOSED** | **A pass, and the round found an error in the previous round's own report.** Round 6 claimed "70/70 blockers audited — every one" while its own skip list held **five blockers** — XS-4, XS-7, XS-8, XS-13, XS-57, each verified `blocker` severity. Round 7 audited all five; all hold. **I verified XS-4 myself**: its second bullet requires an in-progress edit to survive a background refetch, guarded by `if (!editing) { setDraft(...) }` (`TextField.tsx:68`); removing it reddens the test, with "Running 4 tests" confirming the filter matched rather than silently matching zero. Cumulative audit across rounds 6-7: ~143 of 171 M2 cases, all 70 blockers. **Sixteen cases were uncovered and documented nowhere** — 11 majors, 5 minors, no blockers — now recorded in `known-gaps.md` as unchecked rather than presumed working. **CMT-35 was a *tagging* gap, not a build gap**: its `editors` mechanism is fully built in core and was already covered by four tests there — dropping the appended editor from `recordEditor` reddens all four — so the tool scored a case uncovered whose behaviour was verified. Tagged where it is actually tested. **TSK-39 deliberately not tagged**: one bullet is exercised, two are not, so a bare tag would overstate it — the TSK-51 failure in reverse. **The asymmetry is the lasting finding**: coverage *understates* verification where a mechanism is tested but untagged, and a gate report can *overstate* completeness where its summary and its skip list disagree. Both were live in M2 simultaneously. Unit 2807, UI 507/507, coverage 618 → 619. |
| M3 gate r1-r2 | section gate | `e57a809` | 161 of 161 M3 cases audited | **Two decision records asserted things their own cited evidence disproved, and each wrote off a real gap on that basis.** **A45** (NEW-41) said "the shell never mounts and the modal cannot open" and added no test; the spec file it cites opens by stating the banner renders *inside* the shell and asserts the sidebar is visible, and `AppBootstrap.tsx:90` says the shell **deliberately** stays up because SHL-13, XS-34 and XS-35 require it. Measured at `.schema-version=9`: the New task button enabled, `n` opened the modal, submit enabled on a title, and clicking produced **no error and no POST** — a working-looking button that silently did nothing. Fixed and mutation-proven. **A41** (TML-48) claimed the unreadable notice "names the task, the offending field is named"; measured, the payload carries a **ULID file path** and a generic schema string, and `TimelineView.tsx:546` renders exactly those two. Bullet 3 unmet on both halves; corrected in place with the measurement. **A decision record is the one artefact in this repo that nothing tests.** Round 1's other findings: **BRD-6**, **BRD-23** and **TML-24** were green while unguarded — in all three the behaviour was **unassertable**, living only in a Tailwind class or no attribute at all, so the test asserted whatever it could reach. Forcing `over` false left 51/51 green; deleting the project chip left BRD-23 green (BRD-4 caught it, not BRD-23); sourcing `today` from `new Date()` left 52/52 green. Now `data-wip-state`, `project-chip`, `data-today`. Round 1's **headline blocker was rejected**: it reported TML-21's partial status as recorded nowhere, but `TEMP-RUN-WORKFLOW.md:569` records it in the same paragraph as the four unmet virtualization cases — the report cites that file zero times. **NEW-3 recorded unenactable**: its bullet 1 needs a per-column "+ Add task"; M3.1 built and removed those because a stale column then carried a create control, which is what broke BRD-42. `initialStatus` is dead plumbing — both call sites pass nothing, and neutering the pre-fill left 44/44 green: the **tenth** built-but-uncalled capability this run. Unit 2807, UI 507/507, coverage 619 → 620. |
| M4.1 | settings, projects, users, K3 slug | `d917cef` | 20 of 46 (26 listed uncovered, honestly) | **Two defects the agent found were real; neither of its fixes was guarded, and I found that only by mutating in the right tree.** `DELETE /api/projects/:id` never passed `hard`, so **every delete silently archived while answering 200** — a user who deleted a project still had it — and `remap_to` was unusable because core *throws* on a remap without `hard`. `PUT` dropped `archived` entirely and no archive route existed. Reverting the delete fix left **all 232 server tests and all 19 new settings tests green**. Both now have tests red under a compiling mutation; the delete test asserts the project's **absence**, not the status code, because 200 is exactly what the defect returned. **A third defect I found myself: the slug never resolved in a URL.** `?project=web-app` returned an empty list while the same filter by ULID returned the task — verified with two positive controls. That is K3's whole purpose and PRU-6's last bullet, and `findProjectBySlug` sat in core with **zero** callers from the server: the **eleventh** built-but-uncalled capability this run. Fixed ahead of both the DSL and saved-view paths so they cannot disagree, with an unknown value still filtering to nothing rather than becoming a pass-through. K3 itself is sound and verified by driving the real binaries: generation, persistence, collision handling (`web-app` → `web-app-2`), CLI `--slug`, MCP `create_project`. **A61** keeps it optional on disk, since `.strict()` would break every pre-K3 `projects.yaml`; **A60** fixes it at creation — measured that saved views cannot store a slug, because the DSL reads `project` off frontmatter, which holds a ULID. **My own errors this ticket, recorded because they cost more than the build did**: I ran six checks in the main tree while the build lived in a worktree, read the correct-but-irrelevant results as evidence, and told Ken twice that I had destroyed all 28 files — the second time attributing it to a `cp` that touched exactly one file, while my own numbers contradicted the cause. Nothing was destroyed. Unit 2807 → 2854, UI 507 → 526, coverage 620 → 639. |
| M4.3 | settings — data panels | `edc9a7c` | **34 of 73 covered; 39 reported unmet, not narrowed** — MSL-8..14, MSL-27/28, MSL-31..34, MSL-37, SET-14/15/30/31/37/38/40, VUE-25/26/27/36, XS-36/38/41/43/44/45/48/50/66 partial, GIT-1/2/3/4/10/18/20/24/27/28/30/38 | **Three instances of M4.1's project-delete defect, all live, all measured before fixing.** `DELETE /api/labels/:id`, `/api/milestones/:id` and `/api/views/:ref` all omitted core's `hard`, which defaults to **false** — so every delete **archived while answering `200 {"deleted": id}`**. Probed against a real tracker: the response said deleted, `labels.yaml` still held the id. Worse, **`?remap_to=` was unreachable over HTTP** — core's soft path throws on `remapTo`, so MSL-12's remap returned `400 --remap-to only applies to --hard delete`, leaking a CLI flag name into an HTTP response for the one operation the case exists to require. Fixed as hard-by-default with `?soft=true` (**A68**), matching M4.1's landed contract. **Two capabilities found already-built-and-uncalled**: `archiveLabel`/`unarchiveLabel` (exported from core, CLI-only, no web route — so the UI's only way to hide a label was to delete it, exactly what MSL-10 exists to avoid) and `unarchiveView` (the export CLAUDE.md flags as called by nothing at all). Both now have routes. **`GET /api/views` had no try/catch**, so a corrupt `queries.yaml` returned `500 code:"unknown"` / "The server failed while handling GET /api/views" with `recovery: retry` — retry being wrong advice for a malformed file, and the loader's real message (`duplicate query id: …`) demoted to `detail` where no sidebar would render it. Now `400 config_invalid` with the message as headline (VUE-36, XS-66). **The git ticket is 38 of 73 cases and 26 of them cannot be built**: `reconcile.yaml` is a **four-field crash sentinel** (`.strict()`: mode, base_commit, remote_commit, started_at) with no per-task rows, no per-field decisions, and **no core function that applies a decision** — grep for `applyReconcil|keepLocal|keepRemote|pickValue` returns 0 across core/CLI/web against a working positive control. `GitConflictError` carries a flat array of file **paths**, and the CLI has no reconcile command by explicit design. Rather than fake a panel over a sentinel (shape (a) by construction), the panel ships what the model supports and the 26 are reported unmet (**A69**, listed in `TEMP-RUN-WORKFLOW.md`). **GIT-4 is half-satisfiable**: `localChanges` is a count but `remoteChanges` is a **boolean**; rendered as the boolean it is rather than inventing a count in a second place (**A70**). **A tooling trap worth more than the ticket**: `npx tsc --noEmit -p apps/web` typechecks **nothing** and always exits 0 — `apps/web/tsconfig.json` is solution-style with `"files": []`. A mutation putting an out-of-scope identifier into `DiagnosticsPanel.tsx` was reported as compiling cleanly; `npm run typecheck` caught it as `TS2304`. Every earlier "TSC_EXIT=0" in this ticket was vacuous. Recorded in `known-gaps.md`. **Two green tests were asserting the old behaviour** and were edited, per the repo rule: both said `expect(screen.queryByRole("button")).toBeNull()` with the notes "M1 has no in-app migrate control" / "that lands in M4" — this *is* M4, and SET-15/XS-36 asked for exactly that button. **My own vacuous test, caught by mutation**: the diagnostics duplicate-key test asserted a row count, which React satisfies even with duplicate keys (it only warns); strengthened to assert no duplicate-key console error, after which the `key={check.name}` mutation reddens it. **A defect I introduced and fixed before it shipped**: `GitSyncPanel` initially reached its refetch through a module-level mutable, which is wrong under concurrent rendering; replaced with a prop. Every mutation compiled under `npm run typecheck` exit 0. Unit 2888 → **2918**, UI **554** (551 pass + BRD-4/BLK-24/SHL-6 load flake, all green at file level; REL-32 and SPR-6 are documented pre-existing gaps), integration **448**, e2e **21**, coverage 664 → **679**. |
| M4.4 | personal + keyboard settings | `48dd04f` | 8 of 8 | **Two defects the agent introduced and caught with its own tests, before shipping** — worth recording because both were user-visible: the theme picker read `localStorage` rather than the acting user's `settings.yaml`, so switching user showed the **previous** user's theme; and an optional-read in `AppShell` threw on an empty settings response, **white-paging the whole app** over a theme preference. `sweepSidebarPins`/`readSidebarPins` are core and reach all three surfaces (`loctt user settings --sweep-pins`, MCP `sweep_sidebar_pins`); a pin whose view was deleted is removed **and named**, not dropped silently. `.passthrough()` retained on `UserSettingsSchema`, verified by round-tripping an unknown nested key. **A claim I relayed and had to withdraw**: A72 recorded `DELETE /api/views/:ref` as soft-archiving — it does **not** reproduce. Measured on **both** binaries: 200 and `queries: []` either way, the view genuinely removed. Core's archive branch is real (`views/manage.ts:166`), so the code reading was right, but the route's *observable* behaviour was already correct; the explicit `hard` is kept for consistency with the other three routes, not as a fix. Corrected in place. The M4.1/M4.3 project, label and milestone deletes **did** reproduce — this one did not. **My own probe hid its failure**: the first attempt used `>/dev/null` and swallowed `Unknown command: view`, so a `grep -c` of 0 read as "deleted" when the view had never been created — the exact trap this run's briefs warn about. **The commit needed a rebase, not a cherry-pick** (pinned at `0ab827e`, before M4.3): six conflicts across four files, including code. Resolved by keeping M4.3's `?soft=true` superset in `server.ts` and **both** sides of three additive conflicts in `SettingsShell.tsx`; verified by unit **2943 = 2918 + 25**, which is exactly both tickets' tests, so nothing was dropped. Lint caught an import-ordering error from the hand-merge. Also fixed: **two decisions were both numbered A70** from the parallel builds; M4.4's is now A72. UI 554 → **560/560** serial (15 failures under 5 workers were all parallelism), integration 448 → 454, coverage 679 → 686. |
| M4.5 | saved-view DSL editor | `995754e` | 21 of 22 (VUE-22 recorded, not built) | **`validateQuery` gets its first caller** — the twelfth capability this run found already-built rather than rebuilt. **My brief was wrong and the agent caught it before building**: I claimed the web layer used *none* of core's query exports. Three of the terms I searched do return zero, but I stated the conclusion wider than the measurement — `QueryValidationError` had two hits in `server.ts`, and **`buildDsl.ts` already existed**, which is the Basic→Advanced generator VUE-10 needs. Building to my description would have duplicated it. My positive control passed, which is exactly why I trusted a claim broader than what I had tested. **VUE-21 had to be fixed twice, and the second half is the one that mattered.** Core raises a warning for a query naming a deleted field; CLI and MCP both pass `onWarning`, the web passed none, so a view on a deleted custom field answered 200 with zero rows and no reason. The agent wired `onWarning` and put `warnings` on the response — and **no client code read it**, verified with a positive control (`useTasks.ts` reads `unreadable` from that same response). Its VUE-21 test was a *server* test asserting the response body, while the case says the view "**surfaces**" the problem. **That is REL-49's shape from M2, twice in one run**: a field correctly on the wire that nothing renders looks like a fix and is not one. **Two errors of mine fixing it**: I typed `warnings` as `string[]` and rendered `{w}` — the server emits *objects* with `message`/`position`/`suggestions`, found by querying a live server; and my first assertion demanded the empty state be **absent**, when the case forbids zero rows "presented as a legitimate empty result" and "No tasks match these filters" is a statement about the filter. I had written a stricter test than the spec. **Verified by my own mutation**: making the client ignore `warnings` — the exact shipped state — reddens it. **The agent's own catches**: a vacuous test it wrote (comparing two strings that were both `""`), a `perl` mutation that silently did not match while the suite stayed green, and two invented identifiers. **VUE-22 stopped, not decided**: one unparseable entry makes `parseQueriesConfig` throw for the whole document, so a healthy view beside a broken one 500s — tolerant-load/strict-save is a core contract change across three surfaces. Decisions **A73–A78**. Unit 2943 → 3007, UI 560 → **561/561**, integration **454 unchanged** (evidence the response-shape additions regress nothing), coverage 686 → 707. |
| M4.6 | init wizard | `c257daa` | 22 of 23 (ONB-18 unreachable, recorded) | **A brand-new user was told their tracker was damaged.** Measured on the baseline against a live server: an **empty** `.loctt/` answered **409 `schema_mismatch`** on every route including `/api/info` — *"This tracker predates schema versioning"*, pointing at `migrate`. That is exactly what ONB-16 forbids, and it is worse than my probe found: I only established that `exists` could not discriminate, not that the empty case was actively misdiagnosed. **One boolean could not carry both cases**: `exists` came from `access(locttDir)` alone, while SET-30 needs a directory *holding tasks* but missing `.schema-version` to stay damaged and never be offered init. `initState` splits them on the discriminator **SET-30 names itself** ("holding tasks… is damaged, not empty"). **Verified end to end by me**: empty → **200 `initState:"empty"`** → wizard; populated-without-`.schema-version` → **409** → banner, init refused **400**, and **the task still on disk afterwards** — the assertion separating a correct refusal from a destructive one. `initLoctt` refuses any existing `.loctt/`, so the ONB-16 screen would have offered a button that 400'd; it now routes through core's existing `repair`, only when `empty`. The same misdiagnosis reached `loctt info` and MCP `info` — fixed on both per the layer rule, since the wizard is a web feature but the wrong diagnosis was core's. **A performance defect the agent introduced and caught honestly**: its first guard called `getTrackerInfo` — a full task scan plus three YAML parses — on **every API request**, and SPR-6 began failing deterministically. SPR-6 is on the known-flaky list and it nearly dismissed it; instead it reverted to base, confirmed the test passed, and replaced the guard with an `access`-only check. **A vacuity bug in its own test**, caught by mutation: ONB-3 used name `"Website"` against prefix `"WEB-"`, which the autofill derives, so it passed *with the autofill installed*. **Filed, not fixed**: `loctt init --prefix` accepts any non-empty string, so `"web/x"` really allocates `web/x1` and breaks `/tasks/$key` — tightening core would reject trackers already on disk. **ONB-18 is unreachable and not reworded** (both entry conditions blocked by ONB-35 and by `ProjectsPanel` owning project creation); **ONB-19's two bullets conflict**, recorded with the measurement rather than resolved by picking one. Decisions **A78–A80**. Unit 3007 → 3026, UI 561 → **576/576 in one serial run** (the agent could only manage three batches), integration 454 → 457, coverage 707 → 729. |
| M4.7 | sprint detail | `e163771` | 23 of 23 (SPR-35's placement bullet unmet, recorded) | **A core defect found mid-build, confirmed by me, and deliberately not fixed.** `setField` writes the **resolved id** to frontmatter (`update.ts:430`) but builds the history entry from the **raw value** (`update.ts:488`). Measured on a real tracker: `loctt set T-1 sprint "Now"` — the normal CLI gesture — leaves `task.md` with `sprint: 01M1ED32M…` and `_history.yaml` with `after: Now`. `computeBurndown`'s replay compares against the id, so `GET /api/sprints/<id>/burndown` returns **`initialTotal: 0`** with no points for a sprint that genuinely contains a task: a flat zero line, indistinguishable from an empty sprint. Silent, and it affects ordinary use. Left in `known-gaps.md` because it is a core write path the CLI and MCP share and no M4.7 case asks for it. **The coverage does not rest on it**: the specs assign by ULID through a new helper, and I verified the two remaining name-based assignments are SPR-1/SPR-2 (card counts and column state, which do not replay history). Had the burndown tests used the name helper, **every one would have asserted that flat zero line and passed**. **No core code was written.** The brief's three premises all held: the burndown route was already wired via `readBurndownSeries` — a grep for `computeBurndown` in `apps/web` returns **zero**, accurate but misleading, since the wrapper is what the route calls — and `PUT /api/sprints/:key` already did a read-modify-write, which is what gives SPR-28 its no-clobber behaviour for free. **Verified by my own mutation**: rendering `String(sprint.goal)` for an absent goal — the literal `"undefined"` SPR-7 forbids — reddens it, with "Running 2 tests" confirming the filter matched. That is exactly the trap where "an element exists" would have passed. **A81** records a discriminator the work exposed: a *fully-completed* sprint is byte-identical on the wire to an empty one (`initialTotal: 0`, `incompleteTaskCount: 0` at every point), so keying the empty state off the series hid the burn-to-zero SPR-30 requires to be **visible**; it is keyed off the task list instead. **A count reconciliation**: the agent reported +15 unit tests, I measured **+19** — it omitted its own four `FilterBar.test.tsx` additions. An undercount, the harmless direction, but checked rather than assumed. **SPR-35's placement bullet is unmet and not reworded**: an invalid `weights` map is rejected at config load, so the detail page has no config to render a chart region from and the error surfaces on `/sprints`. Decisions **A81–A83**. Unit 3026 → 3045, UI 576 → **602/602** (the agent's own run lost SHL-27 to a build it ran mid-suite), coverage 729 → 752. |
| M4.8 | polish + a11y | `13987ae` | **38 of 64, honestly** (25 itemised by what each needs) | The largest ticket in the run, and the count is the point: **38 covered, 25 not, each named by what it actually requires** — 7 want an axe-type dependency the agent declined to add unilaterally (a scope call), 4 want a real screen reader, 13 want surfaces later tickets own, and A11Y-2's `/` has no target because the search box is unbuilt. A claimed 63 would have meant 52 shallow "an element exists" tests, which is vacuity shape (b) at scale. **Four defects fixed**: `[` collapsed the sidebar under an open modal; `PUT /api/workflow` reported a **held state lock as `config_invalid`**, blaming the user for a valid file; `DeleteTaskDialog` never restored focus; the sidebar toggle announced its name but never its state. **Three mistakes of the agent's own, all one shape — correct in isolation, wrong in company**: `aria-hidden` on `#root` would have hidden the dialog too (these modals are not portalled); `role="alert"` on the permanent announcer made every `getByRole("alert")` ambiguous and reddened five existing tests; and marking the chrome `inert` disabled dialogs mounting inside it — **11 failures across two files the ticket never touched**, caught only by the full sweep. **A87** records the residual cost rather than hiding it. **A locator defect I found and fixed**: XS-64 matched the task title anywhere on the page, passing alone and failing in the suite once an earlier spec had populated recents. **The tell was the failure mode** — a strict-mode violation ("resolved to 2 elements") is a locator defect and can never be load-dependent, where a timeout can. My usual file-level flake test gave the *wrong* answer here. **A second failure (TSK-18) I did not assume**: behavioural, not a locator collision, so I checked five prior full-run logs for an actual `✘` (none), ran it 5/5 in isolation, confirmed the editor was byte-unchanged, and only then re-ran the full suite — **631/631**. **Recorded in known-gaps**: a comment carrying `@verifies` while arguing a case is *unmet* still counts as claiming it. I verified the regex requires the literal tag, so ordinary prose is safe, and confirmed **no committed coverage number is corrupted**. Decisions **A84–A89**. Unit 3045 → 3080, UI 602 → **631/631**, coverage 752 → 789. |
| M4.9 | milestones view + detail | `291c9ce` | 12 of 13 (MSL-35 unreachable, untagged) | **M4 is complete.** The ticket's "No server work. Verified 2026-08-24" claim **held this time** — I re-measured against a live server rather than trusting it, because M3.5's identical claim was false in two places: `?progress=true` really returns `{done, total, discarded, fraction}`, which is what MSL-2/3/15 need. **A real core defect found, measured, and recorded**: `field != null` **does not filter — it returns everything**. On a seeded tracker (1 task with a milestone, 2 without) `?query=milestone != null` returned all 3, and the same held for `assignee`, `sprint` and `project`; positive control `milestone = <ulid>` correctly returned 1. It answers **200 with an empty `warnings` array**, so nothing signals the predicate did not apply — silent, and in the *permissive* direction, which reads as "nothing was excluded" rather than as an error. **My own first probe got it wrong**: with a single task the tracker could not discriminate and showed the correct-looking answer — the exact seeding trap I write into every brief. Left unfixed: a core evaluator defect on a shared path, and fixing it means deciding what `!= null` *means* for an optional field. **The agent found it independently the same day**; I merged the two known-gaps entries rather than ship a duplicate, keeping its observation about the empty `warnings` array. **Two of my brief's premises were wrong, both caught**: MSL-4's count equality *does* hold via a DSL predicate (measured), and scroll restoration was already built — the 13th already-built capability this run. **All three discriminator traps I flagged were handled**: MSL-3 seeds real discarded tasks, MSL-15 seeds a genuinely empty milestone, and MSL-1 asserts the name **is** present as a positive control before asserting it is not the ULID — without which an empty element would satisfy it. **Three vacuous tests the agent caught in its own work**: a timezone test pinned to noon UTC that any fixed zone passed; an absence assertion running before rows rendered, so defaulting to show-archived survived it; and a reload test that cannot prove a query key invalidates. **MSL-35 untagged and unreworded** — `withProgress` scans once and fills every id, so a per-row failure cannot exist; the client half is built but unreachable. **A stale-`dist` trap on the cherry-pick**: typecheck exited 2 on `main` with `InitState`/`SidebarPins` "not exported", while the source had them — the built artifacts were behind. `npm run build` cleared it. Decisions **A90–A93**. Unit 3080 → 3103 (+1 pre-existing skip), UI 631 → **645/645**, coverage 789 → **801**. |
| M4 gate r1 | section gate | `3c6e115` | 2 blockers, 2 mis-tags, 78 of 185 cases audited (all 45 blockers) | **The most serious finding of the run: six blockers green against a component no user could open.** `AdvancedQueryEditor` was imported by nothing but its own test and **tree-shaken out** — `dsl-input` appeared **0** times in the built bundle against `milestone-row` at 1. VUE-8, 10, 11, 31, 32 and 33 were each verified against **the server API or the unmounted module**, and neither layer can observe unreachability. TSK-20's failure mode, with the tags making `cases:coverage` report success. **The cause was structural, not an oversight**, which the gate did not identify: `dslToSearch.ts` imported `@loctt/core`'s barrel, dragging `node:path` and `sharp` into the browser bundle, so **mounting the editor broke the client build**. The correct thing was impossible and the tests sat exactly where the impossibility was invisible. Fixed with narrow subpaths (A37's pattern) — and `query/index.js` was **not enough**, since it re-exports `list.js`'s filesystem code; `parser` and `tokenizer` are leaf modules, verified as having zero node imports before switching. Measured **0 → 1**. **Blocker 2**: bare `/settings` had no route, falling through to the app-level 404 while `/settings/nonexistent` rendered the shell correctly — the typo'd URL handled better than the canonical one. Its test asserts the redirect, that the section **renders** (a redirect to an empty pane satisfies a URL assertion alone), and that back does not trap the user in a redirect loop. Both mutation-proven. **A correction from my own test**: my VUE-8 draft pressed Enter and failed — the editor is right, plain Enter inserts a newline in a multi-line textbox and **Ctrl/Cmd-Enter** runs. I had assumed the app was wrong. **A defect I introduced**: a duplicate `useState` import broke typecheck, lint and unit together — and the unit "failure" was **not** a test failure: 3043 of 3103 ran because the compile error cascaded, so reading the count alone would have sent me hunting 60 phantom breakages. **SHL-9 failed once and I did not take its known-flaky label at face value** — the failure was behavioural and I had changed `FilterBar`, a plausible causal path; a clean 647/647 re-run settled it. Also fixed: after `lint:fix` touched the mounting file, I re-verified `dsl-input` still shipped. **Still owed**: the gate's half 2, journey walking, was not reached. Unit 3103, UI 645 → **647/647**. |
| M4 gate r2 | section gate — journey walking | `ff27c6d` | 2 blockers fixed, 4 mis-tags addressed, 3 recorded | **Every finding has one shape: an honest, green, mutation-verified test positioned where the defect cannot be seen.** **XS-41** (blocker) was broken in the shipped app — the Diagnostics panel makes a command copyable only when the message matches `loctt <command>`, but core's key-index warning said "rerun with `--rebuild-index`", with **no `loctt ` prefix**, so on genuine drift **zero** copyable commands rendered. Its only coverage was a **component test with a hand-written message**, which never saw what the server sends. Fixed in **core**, not the panel's regex — the CLI was telling the same half-truth. Verified end to end on a drifted tracker: CLI → API → panel. **NEW-1**: the board's only "+ Add task" lived inside `total === 0`, so on any board *with tasks* there was no entry point; its test passed because **it never seeded**. Fixed board-level, not per-column — M3.1 built per-column controls and removed them, because a stale column would carry a create control, which is what broke BRD-42. **MSL-10 and MSL-13** were tagged on **server** tests asserting disk state while every bullet concerns dialogs and pickers: forcing archived labels into the picker left **24** UI tests green; forcing the remap picker onto unreferenced deletes left **48** green. Both now redden under those mutations. **My own first MSL-10 test was vacuous** — the picker excludes already-attached labels, so opening it on the task *carrying* the label hid it whether or not the filter worked. Shape (d), in a test written while hunting for shape (d). **A stale-`dist` false positive I caused**: I mutated `RemapDeleteDialog`, built, ran 48 tests, then restored **without rebuilding** — the bundle kept `count >= 0`, and I spent two failed diagnoses hunting an app defect I had put in the artifact myself. Fourth stale-dist incident in this run, first of mine. **Recorded, not built**: **SET-8** (the schema rejects a per-value `weight` outright — `unrecognized key(s): "weight"` — and `compareTasks` applies weights only to `priority`, so the feature does not exist rather than being broken); **PRU-44/45** (the prefix field is `readOnly` **and** `disabled`, and `useSetProjectPrefix` has **zero callers** — the 14th built-but-uncalled capability; the tags sat on a server test whose own docstring says "the panel itself is not built"). **PRU-46 is Ken's** and is quarantined with `test.fixme`, not skipped, so it announces itself when the design changes: `server.ts:4290` recovers an interrupted rename before **any** handler, so a sentinel either heals or 500s and can never reach the projects handler — measured, the first request flipped the prefix and deleted the sentinel. The banner and its completion endpoint are unreachable dead code. Unit 3103, UI 647 → **651 passed + 1 quarantined**, coverage 801. |
| M4 gate r3 | section gate — the ~90 unreached cases | `c16a632` | **0 blockers**, 2 major fixed, 3 recorded; 122 of 140 majors/minors audited | **M4 passes.** After three rounds the remaining cases came back clean of blockers, which is a real outcome rather than a failure to look. **A11Y-45 is the finding worth keeping**: nothing moved focus on a route change — `useRouteAnnouncement` had **zero** focus calls — so after List → Board focus stayed on the sidebar's Board link, the exact element the case names as the failure. What let it survive review is that `AppShell.tsx:177`'s comment **asserts the opposite**: `tabIndex={-1}` is "what lets the skip link (A11Y-44) and the route announcement (A11Y-45) land focus here". The scaffolding was built for the case, the one line that uses it never was, and the comment reads as done. Fixed, mutation-proven; the test asserts focus is **on main**, since asserting only "not the sidebar link" passes on focus dropped to `document.body`, which the case forbids by name. **A11Y-25's second bullet was unverifiable, and the app was already right.** `useTasksFeed` uses `placeholderData: keepPreviousData`, so on an ordinary filter change the in-flight render carries the *last settled* total — equal to the ref the effect compares — and the `previous === total` guard suppresses the announcement whether or not the `isFetching` gate exists. **Every "filter once, count announcements" test passes both ways, including two of mine**; my second attempt used the right gesture and still failed to discriminate, which sent it to a Fable agent. The gate is observable only when the in-flight total *differs* from the last announced one: a revisited query key served stale after its count changed while inactive. Mutating now yields `["1 tasks", "3 tasks"]` against `["3 tasks"]` — the previous filter's count announced mid-flight. **SET-9 recorded, and more precisely than reported**: the estimate control *is* built on task detail (`MetaPanel.tsx:131`) and absent from the create modal and `ALL_COLUMNS`, so bullet 1's absence assertion passes **vacuously on two of three surfaces** — shape (c), trivially true when the app says nothing. **The process finding worth carrying past M4**: four of five mis-tagged cases **explicitly disclaim** their missing half in comments ("Only the server half is asserted here"). The authors knew. `@verifies` has no partial marker, so a test that openly covers half a case still counts as fully covered and passes `--require` — the same mechanism behind MSL-10/13 and PRU-44/45/46. The gate also **withdrew three candidate findings after measuring**, including SPR-30, where the UI test genuinely cannot discriminate but a core test under a different case name would fail such an implementation. Unit 3103, UI 651 → **653 passed + 1 quarantined**, coverage 801. |
| M4.8 follow-up | four cases M4.8 left unaccounted | `6336592` | **2 of 4 tagged, 2 declined with revert paths** | **These four existed because an aggregate hid them.** M4.8's row said its 26 uncovered cases were "25 itemised by what each needs" and itemised 21; A11Y-10, A11Y-11, A11Y-29 and A11Y-39 — three of them blockers — appeared in no decline register, no known-gap and no decision, only in the ticket's own `Cases:` roster. All four turned out to be **built and merely untested**, so the aggregate concealed finished work rather than missing work. **How I found it is the part worth keeping**: I first read the gate's 26 uncovered as unbuilt and had an agent halfway into rebuilding a ticket that shipped at `13987ae` before checking the Status table — whose row said `(uncommitted)` for committed work, so the log agreed with the gate instead of contradicting it. Fifteen rows were stale that way (`de41945`). **A11Y-11 and A11Y-29 tagged, each mutation-proven twice — once by the agent, once by me on a different mutation.** Killing the ArrowUp branch with `&& (false as boolean)` reddens A11Y-29 at the **row-position** assertion, not the announcement; discarding the create modal's typed date reddens A11Y-11 at the value read back. **A11Y-10 and A11Y-39 declined, and both declines are right.** `ui/Menu.tsx` has **zero** arrow-key handling where `editor/MentionMenu.tsx` has it, across three consumers — so "arrow-navigable with type-ahead" is genuinely unmet, and building it is a keyboard-model change no ticket owns (A94). The client has **792 hardcoded `text-[Npx]` sites** and `body { font-size: 14px }` against two `rem` uses in the whole stylesheet, so text-only zoom scales nothing and any "no text is clipped" test would pass against an app with no text-zoom support at all — vacuity by construction (A95). Both untagged tests are titled `(partial)` and assert the gap **positively**, so they invert when the feature lands. **The agent corrected me and was right**: I filed the Escape-cancel defect against "A11Y-29's fourth bullet". A11Y-29 has three bullets and none mentions cancelling — that wording is **A11Y-28**, the board's keyboard drag. The defect is real and belongs to REL-15's third bullet alone, where the existing test is **partial, not vacuous**: it asserts the move, the announcement and the rank on disk, but never presses Escape. **Two failures in the agent's suite were mine, not defects.** The stray `CreateTaskModal.tsx` mutation it reported as unaccounted-for was my own A11Y-11 verification; my restore `sed` silently failed and I read an empty `git diff \| tail -2` as proof — verifying a proxy instead of the thing, the same shape as the stale-`dist` failures. And 14 integration tests went red on **`No space left on device`**: 5,521 leaked `loctt-*` temp trackers had taken the disk to **1.0 GiB free of 460 GiB**, presenting as plausible defects ("refuses to adopt a configured branch holding unrelated work"). Cleared, re-run exit 0. `tests/README.md` documents a sweep scoped to `tests/workspace/`, but 60 core fixtures use `$TMPDIR`, where it never reaches — recorded. Coverage 801 → **803**. Unit 3103, integration 457, e2e 21, UI 654 → **658** total, measured green: **657 passed + 1 quarantined** PRU-46 `test.fixme` (32.2m, `--workers=1`), zero ENOSPC. **The gate took four attempts and only the fourth was trustworthy** — run 1 contaminated by my own un-restored mutation, run 2 by ENOSPC, run 3 killed pre-emptively by the agent as free disk fell through the threshold that had already killed a suite, run 4 clean under a monitor that would kill the run rather than let it emit ENOSPC dressed as failures. The build agent was right to refuse to close a gate it could not honestly close. |
| M5.1 | structured backup — cases | `ed038f3` | **24 cases, three review rounds, now spec** | **Unblocked by K17.** The ticket said its cases were "Ken's to approve, not an agent's to author", which stopped the run under condition 2 — an agent that may write the spec has no spec. Asked directly, Ken replaced that bar: *"you write, you review the cases with another agent, iterating until good. then you may implement."* **Five rulings settle the shape**: attachments are critical and history is opt-out (so the format must carry bytes, which base64 does at ~33% inflation — he chose completeness knowing the cost); three restore modes with refuse as the default; **tasks + config**, taken against my recommendation, which puts the config-collision problem in scope rather than deferring it; keep-both-with-rename on collision; and state handled *case by case*. **Review round 1 earned its place**: it found `state.yaml`'s per-project key counters were absent from all 16 cases — without them a bare-machine restore reissues keys already in use, breaking invariant P-1 **invisibly until the first `task create`**. It also corrected two of my factual claims (`exportTasksToJSON` *can* emit `body` via `includeBody`, so my CSV contrast was overstated; the comments file is `_comments.yaml`) and caught me conflating two principle series — the headers' `P1`–`P10` with `invariants.md`'s hyphenated `P-1`–`P-12`, where `P9` and `P-9` mean different things and neither `P11` nor `P-10` exists. **It also caught me mis-framing a question to Ken**: I offered the collision options as though renaming were needed for data integrity. `LabelsConfigSchema` dedupes on **`id`**, not name (`contracts/labels.ts:32`), so duplicate names are already legal. I put the correction in front of him before he chose; he chose the rename anyway, so it is recorded as a UX call, not a constraint. **v2 is 19 cases**: BAK-C16 cut (a layer-rule assertion the ticket gate already enforces), C5 and C6 each split so severities could be honest, and four genuinely new — key counters, streaming, deletion-recovery, and the P-11 mirror where a restore meets an unreadable destination file, which is where that invariant actually has teeth. **A96 records the state call** and I got it wrong first: `local/` holds **five** files, not the four I asserted and checked afterwards. Conclusion held — `journal.yaml`'s own comment says "not shared across machines via git" — but the list was published before it was verified. **Three more gaps found by probe, queued for v3**: `.schema-version` (a backup from a newer schema must refuse, and `SchemaTooNewError` already exists for it), `docs/`, and the migration sentinel. **Round 3 returned "buildable, no blockers".** Cases promoted to `docs/dev/surface-test-cases/flow-backup-restore.md`; index 937 → **961**, and the gate fails on all 24 BAK cases, which is where building starts. **The largest finding was mine, between rounds**: `git/merge.ts` exports **eight** functions and restore needs **six**. `mergeById`'s own comment — "incoming first, so a local entry with the same id overwrites it", local-wins, **settled by Ken 2026-08-16** — is `--merge`'s rule verbatim, already built and tested. Three drafts treated an existing merge engine as new work; BAK-C24 now asserts its behaviours rather than its calls, since asserting "it calls `mergeById`" is the code-review shape review 2 rejected in C11. **Ruling 6 came out of the review too**: `mergeTask` deliberately returns the *losing* body because "people do not re-read their own paragraphs to check they survived", and `--overwrite` as first approved would have been the one path in the product where writing vanishes without trace. Ken chose to preserve them. **Two corrections to my own records**: A96 asserted `local/` holds "exactly four" files — it holds five — and I mis-framed the collision question, presenting the rename as a data-integrity requirement when `contracts/labels.ts:32` dedupes on `id`. Corrected before he answered; he chose the rename regardless, so it is recorded as a UX call. Build agent running at `ed038f3`. |
| M5.1 | structured backup + restore — **built, all seven suites green** | `1d6516a`..`73154b7` | **24 of 24 BAK cases tagged; coverage gate exits 0** | **The merge engine was the answer, as the brief said.** `git/merge.ts`'s six functions are called rather than reimplemented — `mergeById` for `--merge`'s local-wins rule, `deriveKeyState` for counters, `assignProvisionalPrefixes`/`Slugs` for the two collisions, `mergeComments` and `mergeHistory` for the per-file merges, and `mergeTask`'s displaced-body half for `--overwrite` only. New: `packages/core/src/backup/` (format, streaming export, streaming read, restore), `loctt backup`/`loctt restore`, and MCP `backup`/`restore` — **neither surface had any export before this**. Atomicity reuses `stagedSwap` (V6), which already journals and rolls back, so no eighth journal variant was needed. **Mutation caught four tests of mine that asserted nothing**: the history-sort and comment-recency tests passed with the rules deleted (the fixtures made sorted and concatenated identical), the journalling test asserted only that the journal was *empty afterwards* — true of a restore that never journalled — and the rollback test tripped `stagedSwap`'s pre-check before any swap happened, so rollback was never exercised. All four rewritten and re-proven. **Four real defects found in my own code by these tests**: comments/history read as `[]` on ENOENT vs `"unreadable"` were conflated (history never restored into an empty tracker); `_comments.yaml` is `{comments: [...]}` not a bare array; a bare restore kept the destination's `default` project id, which `ProjectsConfigSchema` then rejected; and passing an empty incoming key map on `--merge` dropped the counter for any project only the backup had, so the next `task create` against it threw. **A fifth defect, mine, found only by the cross-surface integration test**: `loctt backup <file>` read its positional with `args.find(a => !a.startsWith("-"))`, which returns `args[0]` — the subcommand — so it wrote a file literally named `backup` and **exited 0**. Every core test passed throughout, because they call core directly; the house convention is `args[1]` and this did not follow it. Fixed and mutation-proven (reintroducing it turns the five cross-surface tests red). This is the concrete argument for the layer rule: a backup only one surface can take is not a backup, and only a test that drives the real binary could see it. **A97** records the 100 MB split threshold, **A98** the refuse-don't-migrate call for an older schema. **The UI gate was closed by slicing, not by a single run.** The full suite passed once (657 passed, 1 skipped, 0 failed, exit 0) before the CLI positional fix; a confirmatory re-run was **killed at test 147 with exit 144 (SIGXFSZ)** at ~155-320 MiB free — its log ends on a *passing* test with no error text, which is what an external kill looks like and is exactly the disk symptom the brief warned about. Re-run per spec file instead. A second trap found there is worth more than the first: `playwright test --config` bypasses the `pretest:ui` build hook, so a `dist/` left mid-write by a mutation cycle produces `ENOENT: apps/cli/dist/index.js` and "server did not become ready" — failures that read as defects and are not. Both recorded in `known-gaps.md`. **BAK-C18 is tagged on its missing-project half only** — the dangling-relationship half is in `known-gaps.md`, because the case says refuse and P-11 plus the existing P-12 treatment say report, which is a case-vs-invariant contradiction and an escalation rather than an agent call. |
| K16 | interrupted prefix rename is reported | `a16a8e4` | PRU-46 un-quarantined; UI **658, nothing skipped** | **The feature was one discarded return value.** `recoverInterruptedPrefixRename` already returned `{from, to, renamed}` and the server dropped it, so a user's primary identifiers changed under them — `WEB-1` → `SITE-1` — silently. The notice now rides `/api/info`, the channel the schema banner uses. PRU-46's first three bullets described a *pending* state the middleware forecloses, which is why its banner was dead code and its test was `test.fixme`; reworded to assert the notice, and the suite now runs **658 with zero skips** — the first fully unquarantined run of this build. **Two defects of mine.** The hook went below the panel's early returns: React **error #310**, whole subtree crashed, and **build, typecheck and lint all exited 0**. The Playwright failure read "element(s) not found", which is indistinguishable from a feature never built — I misdiagnosed it **twice** (read-and-clear, then `staleTime`) before escalating; the Fable agent found it in one pass with `page.on("pageerror")`. **The generalisable lesson**: a component that *crashes* on render and one that renders *nothing* produce identical Playwright output; `pageerror` separates them in seconds and reasoning about data flow does not. `eslint-plugin-react-hooks` is **not installed** — recorded, not added, since a dependency is a scope call. **Second defect, in core**: `completeInterruptedPrefixRename` read its sentinel outside `withStateLock`, so two of the parallel requests a page load fires both passed the check — the first renamed and reported 1, the second ran against an already-recovered tracker and reported **0**, overwriting a true count with one that says no tasks were affected. Fixed in core so CLI and MCP inherit it. Mutation-proven: restoring the outer read reddens the new three-way-concurrent test and nothing else. The notice is deliberately **not** cleared on read — that was version one, and it lost the notice to whichever parallel request arrived first, since any of them triggers recovery but only `/api/info` can show it. Unit 3144 → **3145**, UI 657+1 → **658/0**, coverage 827. |
| M4.8 | polish + v1 cut | `13987ae` | 38 of 64 — the rest listed in TEMP-RUN-WORKFLOW.md with what each needs (**four were not**: see the M4.8-followup row) | **A truthful 38, not a claimed 64.** 52 of the ticket's cases are a11y, and the flow doc's own preamble says verification "assumes a real screen reader … not an automated audit tool". **No axe library is installed** — `@axe-core/playwright`, `axe-core`, `jest-axe` all absent from both `package.json`s and `node_modules`, with `@playwright/test` as the positive control — and adding a test dependency stops the run, so none was added. 25 cases needing contrast sampling, rendered geometry, reduced-motion, zoom, or actual speech are left **uncovered and un-narrowed**, itemised by what each requires. **A11Y-2 is a feature, not a gap in the work**: the `/` binding is built and registered, but the app's only search box is `disabled` ("Search arrives in a later milestone") and no ticket in the run builds one, so the case is left untagged (A84) rather than reworded. **Four real defects found and fixed.** (1) `[` carried only the typing guard, so it collapsed the sidebar *underneath an open create modal* — an A11Y-8 violation that centralising the bindings into one registry (A85) removed structurally; the registry is also what makes A11Y-4's "the list matches the bindings" assertable, since the `?` dialog and the dispatcher read one array. (2) `PUT /api/workflow` caught **everything** as `config_invalid`, so a held state lock reported "the config is invalid" and blamed the user for a file that was fine — three violations at once (ERR-31, ERR-32, SET-39) fixed by re-raising core's envelope, the pattern `bulkAborted` already used (A87). (3) `DeleteTaskDialog` focused its input on open and did nothing on close, leaving `document.activeElement === body`. (4) The sidebar toggle announced its name but never its state (A11Y-21). **Three mistakes of mine, all caught by measurement rather than argument — the third only by the full suite.** `aria-hidden` on `#root` for A11Y-14's inert bullet is wrong because these modals are **not portalled** — it would hide the dialog along with the page, and a test checking only that the attribute landed would never see it; the fix marks the shell chrome instead. `role="alert"` on the permanent announcer region made every `getByRole("alert")` in the app ambiguous — five existing tests went red, which is how it was found. And the same inert mistake recurred in a third guise: marking the chrome inert unconditionally disabled every dialog that mounts *from inside* the chrome, so `SaveViewDialog`'s Save button never enabled and **VUE-6, VUE-7 and XS-17 each hung 30s** — three specs in a file I had not touched, invisible to every targeted run and caught only by the full sweep. `useInertBackground` now refuses to inert a chrome containing its own panel, while still doing the focus recovery; the cost (chrome-nested dialogs get the trap but not virtual-cursor isolation) is stated in A86 rather than papered over. Making the key column a `<th scope="row">` for A11Y-26 also took it out of the `cell` role, shifting three index-based assertions in `flow-list.spec.ts`; **LST-2 was asserting the old DOM shape**, and the fix re-addresses the cell by `rowheader` role rather than by index — the fragility that caused it. **Three failed diagnoses on one case before isolation.** A11Y-15 kept landing focus on `body`; commenting `useInertBackground()` out of `CreateTaskModal` made it pass, which localised it immediately — `focus()` inside an `inert` subtree is silently ignored, and the chrome-focus tracker was being installed *from the effect*, by which point the trigger's `focusin` had already been missed. A88 records the bounded-history fix that also satisfies A11Y-34, where the ⋯ menu unmounts before the dialog mounts. **A gate defect worth more than a case.** `tools/coverage/main.ts` reads case IDs out of **prose**: a comment arguing that a case was deliberately NOT tagged — quoting the tag keyword next to the case ID — made the gate report that case covered. Rewording flipped it back — a one-case swing, in the dangerous direction, where an argument that a case is *unmet* makes the gate believe it is met. Recorded in `known-gaps.md`; every tag in this ticket was re-checked against it. **Mutation-tested throughout**: the chord resolver (2 mutations), the typing/dialog/timeout guards (3), the announcer, the skip link, the row-header semantics, the label sweep, the `aria-expanded` state, the lock envelope, and the ERR-24 truncated upload — that last one mutated on the *test* side, swapping the malformed body for a well-formed one to prove the directory assertions discriminate. The ERR-38 console assertion **was vacuous when first written** — React logs caught errors itself, so it passed with the boundary's own logging deleted; it now targets the boundary's own log line. Decisions **A84–A89**. Unit 3045 → 3080, UI 602 → **631/631**, integration 457 (unchanged), e2e 21 (unchanged), coverage 752 → **789**. All four suites green by exit code. `temp-ui-mockups/` untouched, `tokens.css` included. |
| M4.9 | milestones view + detail | `291c9ce` | **12 of 13; MSL-35 left uncovered and not reworded** | **The ticket's own "no server work" claim held** — verified against a live server rather than trusted, after a prior ticket made the same claim falsely: all four verbs registered, `?progress=true` genuinely returns `{done:4,total:8,discarded:2}` on MSL-3's worked example, and `router/index.tsx` had no `/milestones` route at all. Client-only, and `git status` confirms it: nothing under `packages/`, `apps/cli` or `apps/mcp` changed, so no CLI/MCP reference doc was owed. **Two of the ticket's own premises were wrong, in my favour.** (1) It said MSL-4's count equality "does not hold with today's API" — it does: `?milestone=<id>&query=status.category != discarded` returns exactly 8, matching `progress.total`, measured on a live server (A90). The raw `?milestone=` alone returns 10, which is the divergence, so the DSL predicate is load-bearing and its removal reddens MSL-4 **and** MSL-25. (2) It said scroll restoration was unowned — `useMainScrollRestoration` was already built for SHL-25/26, the thirteenth already-built capability this run has found. **MSL-35 is genuinely unavailable and is left untagged.** `withProgress` computes the whole list in one corpus scan and fills every id with a zeroed entry, so a *per-row* failure with other rows still rendering cannot exist: verified that every item in a `?progress=true` response carries a `progress` object, never `undefined`, and that a malformed task file is skipped rather than thrown on. The client half is built and unit-tested (`progressState(undefined)` → `unavailable`, rendered in place of the numbers, never `0 / 0`) but is unreachable from this server. **Three vacuous tests of my own, all caught by mutation, none by review.** A timezone test pinned to noon UTC could not tell "reads the workspace zone" from any fixed zone — hardcoding `America/Los_Angeles` passed it; fixed with a full-ISO timestamp where zones genuinely differ. MSL-25's `toHaveCount(0)` passed before the rows rendered, so defaulting the view to *show* archived survived it; fixed by awaiting a positive row count first. And MSL-29's reload-based test cannot prove the query key invalidates — a reload drops the whole cache — so the spec now says what it does and does not prove rather than implying otherwise. **I hit the M4.8 gate defect that M4.8 had already recorded**: writing "Deliberately NOT tagged `@verifies MSL-35`" made the gate report MSL-35 covered. Caught by checking each of the 13 cases individually rather than trusting the summary line; rewording flipped it back. **A new defect found and recorded**: `GET /api/tasks?query=milestone != null` does not filter — measured on a two-task tracker where only one has a milestone, it returns both, the unset one as `milestone: null`. Silent and in the dangerous direction, and not milestone-specific. The orphan hook sends no predicate and filters client-side as a result. **A cross-ticket reconciliation neither ticket owned**: M4.3's MSL-11 reference count and MSL-3's denominator agree exactly — `taskCount` 10 = `total` 8 + `discarded` 2 — now asserted. **13 mutations, each shown to redden its target and to compile**: discarded folded into the denominator, fill read from `fraction`, percent computed on a zero denominator, overdue keyed on the date alone, undated sorted first, `unavailable` collapsed to `none`, midnight instead of noon, a fixed timezone, a dash for the absent date, the drill-in predicate dropped, the orphan notice suppressed, the discarded caption suppressed, the overdue/completed badges hidden, `?progress=true` dropped, and the name replaced by the ULID. Decisions **A90–A93**. Unit 3080 → **3104**, UI 631 → **644/644**, integration 457 (unchanged), e2e 21 (unchanged), coverage 789 → **801**. All four suites green by exit code. |
| M4.2 | settings workflow panels | `867b9f8` | 26 of 26 | **Panels over the existing write path, not a second one** — `applyWorkflowEdit` already refuses deleting an in-use enum without a remap, and I verified that end-to-end against a live server: `config_invalid` with a clean user-facing message naming the key and the remedy, no `internal:` leak. **The defect worth keeping**: a save that sent the query cache back deleted a status added by hand while the panel was open — no error, because nothing referenced the key yet. The fix re-reads `workflow.yaml` immediately before the PUT and applies the edit **by key**. **Verified by my own mutation**: preferring the cached copy reddens SET-28, with "Running 1 test" confirming the filter matched rather than silently matching zero. One correction to the agent's framing — `useWorkflowMutations.ts` is **new in this ticket**, so that was a defect in its own first draft, not shipped code; the guard still earns its place, since it is the stale-cache-clobbers-a-hand-edit shape P1 forbids. **`computeWorkflowKeyCounts` is new core and reached all three surfaces** per the layer rule, with an integration test asserting CLI and MCP *agree* rather than assuming it. **Three vacuous tests the agent caught in its own work**: one asserted a timezone was absent (true of any list — shape (c)); one matched a body-wide regex and was passing on the **activity feed's** drift badge while the status field went untested (shape (a)); the third only looked unguarded because a sibling mutation had disabled reordering entirely, so "snaps back" held trivially — a mutation-interaction artefact, not a vacuous test, and a subtle distinction to draw. **Recorded, not narrowed**: SET-24 (an unknown timezone is rejected at *load*, so `GET /api/calendar` 400s and the panel never sees the document — and the CLI tolerates the same file, so the surfaces disagree about whether the tracker is usable) and SET-22 (the schema rejects `working_days: []`, so its other bullets describe an unreachable state, A67). Decisions **A65–A67**. Unit 2854 → 2888, UI 526 → **554/554**, integration 443 → 448, coverage 638 → 664. |
| M4.3 | settings data panels | `edc9a7c` | 34 of 73 (39 listed unmet, honestly) | **The same silent-delete defect as M4.1, in three more routes.** `DELETE` on labels, milestones and views all omitted core's `hard` (default false), so each **archived while answering `200 {"deleted": id}`** — a user who deleted a label still had it and the response said otherwise. Reproduced on the baseline binary and re-measured on the fixed one. `?remap_to=` was unreachable over HTTP for the same reason: core *throws* on a remap without `hard`, so MSL-12's remap answered `400 --remap-to only applies to --hard delete`, leaking a **CLI flag name** into an HTTP response on the one operation that case exists to require. **Ken ruled K15**: hard by default, `?soft=true` to archive; archive-by-default stands for projects and sprints. **A defect I nearly reported as absent**: `GET /api/views` 500s on a corrupt `queries.yaml` — my first probe used *malformed YAML*, which the baseline already handles as `config_invalid`, and I almost called the finding wrong. It needs a **schema** violation (valid YAML, wrong types), and then it reproduces exactly: `500 code:"unknown"`, `recovery:"retry"` — advice that cannot help, since retrying a malformed file changes nothing — with the real reason demoted to `detail`. Two failure modes behind one description; I picked the wrong one first. **Three more built-but-uncalled capabilities**: `archiveLabel`, `unarchiveLabel` and `unarchiveView` had **zero** server references at baseline — the last is the export CLAUDE.md names as "called by nothing at all", and the UI's only way to hide a label was to delete it. **26 GIT cases cannot be built**: `reconcile.yaml` is a four-field crash sentinel with no per-task rows, no per-field decisions, and no core function that applies one (A69) — shipped to the model that exists rather than faking rows over a sentinel. **The finding worth more than the ticket**: `tsc --noEmit -p apps/web` **typechecks nothing and always exits 0** — solution-style tsconfig with `"files": []`. Verified: an undefined identifier gives exit 0 there and `TS2304` under `npm run typecheck`. **Two invocation errors of mine**, both producing failures indistinguishable from real ones: `npx vitest run` on an integration test picked up the root config's 5s timeout (the test needs 5.3s) and I reported a defect that did not exist; `npm run test:ui` runs **5 workers**, and five load-sensitive tests failed until I re-ran with `--workers=1`. The tell each time was a number that did not fit — 8.9m against 25m, 5s against 5.3s. Decisions **A68–A70**. Unit 2888 → 2918, UI 554 → **553/554** (NEW-4 flake, 44/44 at file level), coverage 664 → 679. |
| M4.6 | init wizard | `c257daa` | **22 of 23 required cases covered**, gate green (707 → 729); ONB-18 recorded unreachable, not narrowed | **The ONB-16 / SET-30 conflict was real and is resolved by the discriminator SET-30 itself names.** `exists` came purely from `access(locttDir)`, so an empty `.loctt/` and a tracker full of tasks with no `.schema-version` were the same boolean — and measured over HTTP, both answered **409 `schema_mismatch` on every route including `/api/info`**, so the empty directory got the schema banner ONB-16 explicitly forbids. New four-state `initState` (`ready`/`absent`/`empty`/`damaged`) on `TrackerInfo`, mirrored in contracts; `empty` requires no core files **and** no tasks **and** no config that loaded, because SET-30 says a `.loctt/` "holding tasks but no version file is damaged, not empty". Reaches CLI and MCP for free — all three surfaces call `getTrackerInfo` (**A78**). **A defect I introduced, caught by an existing test, and worth recording as prominently as the ones I found**: the first cut put `getTrackerInfo` — a full task-directory scan plus three YAML parses — inside the **per-request** schema guard. **SPR-6 began failing deterministically**, and I nearly dismissed it as the known flake it is listed as; the honest check was to revert my source to base, where **it passed**, then restore. Replaced with `isEmptyTracker` (`access` calls, short-circuiting), the expensive split drawn once in `/api/info`. Full UI suite then **576/576 with zero failures**, BRD-4 and SPR-6 included. **A second real defect, found by my own test**: with the wizard routing correctly, submit still 400'd — `initLoctt` refuses any existing `.loctt/`, so the screen ONB-16 requires offered a button that could not work. Fixed by passing core's existing `repair: true` **only** for `initState === "empty"`, never for `damaged`, since repair resets the key counter to 1 and would reissue live keys (**A79**). **A third, on the CLI/MCP side**: `loctt info` on an empty `.loctt/` printed "this tracker predates schema versioning", pointing at `migrate` — a command with nothing to migrate; the MCP guard refused every tool outright. Both now say it is not a tracker yet and name `init`. **ONB-19's two bullets cannot both hold** and I did not pretend otherwise: measured against the built CLI, `--prefix` accepts `"a b"`, `"web/x"`, `"Ünicode-"`, `"NODASH"` — all exit 0 — so "matches what the CLI accepts" means rejecting nothing, while the case also wants a slash rejected. Took the narrow rule (reject only what breaks a key/URL), recorded the conflict (**A80**), and filed the CLI-side hole in `known-gaps.md` rather than silently tightening core (`--prefix "web/x"` really does allocate `web/x1`, verified). **A vacuity bug in my own test, caught by mutation**: the ONB-3 "name does not overwrite a hand-edited prefix" test used the name `"Website"` against prefix `"WEB-"` — the obvious autofill derives exactly that, so it passed with the autofill in place; changed to an unrelated name and it reddens. **Eleven mutations, each built to exit 0**; one (`initState === "ready"` in the guard) proved *behaviourally inert* rather than uncaught — a damaged tracker fails `requireSupportedSchema` on its own — so a real lever was found instead. Unit 3007 → **3026**, integration 454 → **457**, e2e **21**, UI 561 → **576**, coverage 707 → **729**. |

| M4.4 | settings — personal + keyboard | `48dd04f` | **8 of 8 required cases covered**, gate green (664 → 671) | **The contradiction was already resolved, not a stop-and-ask.** SET-13 says a stale pin is dropped *silently*; SET-27 says the panel *says* what it removed. `ui-test-cases/README.md:191-198` settles it in favour of the explaining cases and names SET-13 explicitly — so SET-27 governs and SET-13's bullet is stale text, not a live conflict (**A71**). The spec is read-only, so SET-13 was not edited. **A real shipping defect found and fixed**: `handleDeleteView` never passed `hard`, so `deleteView` took its **archive** branch and `DELETE /api/views/:ref` left the view in `queries.yaml` — exactly what VUE-38's third bullet forbids. Fixed to match `handleDeleteProject`, whose own comment records the identical defect being fixed under PRU-17 (**A70**). The run workflow's own wire-up list had already catalogued this shape for the *projects* route ("PRU-33 — the web DELETE never passes `hard:true`"); the views route is the same bug, one endpoint over, and was not on that list. No existing test asserted the archive behaviour, verified by grep. Reverting it reddens the VUE-38 UI test. **Two defects I introduced, both caught by my own tests before shipping, both reported here as prominently as the one I found**: (1) the theme picker read this browser's localStorage rather than the acting user's `settings.yaml`, so it would show the *previous* user's theme after a switch — caught by the SET-11 component test, fixed by adopting the stored value in the panel as well as the shell; (2) `settingsQuery.data?.settings.theme` in `AppShell` threw `Cannot read properties of undefined` when the endpoint answered `{}`, **white-pageing the whole app over a theme preference** — caught by `AppBootstrap.boot-failure`, which went from green to red under my change and is why the full unit suite is not judged by exit code alone (it exited **0 with a test failing**). **New core capability reaches all three surfaces** per the layer rule: `sweepSidebarPins` / `readSidebarPins` in `packages/core/src/users/pins.ts`, plus `loctt user settings [--sweep-pins]` and MCP `get_user_settings` / `sweep_sidebar_pins`, both reference docs updated, with integration tests on each surface asserting the *file* after the sweep (**A69**). `users/pins.js` added as a package subpath export so the client imports it without dragging `node:path` through core's barrel — the `board/columns.js` precedent. **`theme` and `sidebar_pins` become typed contract fields** while `.passthrough()` is retained, so every other UI-only key still round-trips (**A68**). **Assertions are at the far end**: the UI spec reads `settings.yaml` and `queries.yaml` off disk, and the component tests assert the **PUT body** rather than the render — the limit noted in this run, where a server repaired a wrong client value in between. Mutating `saveUserSettings` to strip `theme`/`sidebar_pins` reddens exactly the two disk-asserting UI tests. Every mutation compiled with `npm run build` exit 0. Unit 2888 → 2913 (+25), UI 554 → **560** (+6), integration 448 → 453 (+5), coverage 664 → **671**. **The full UI suite reports 545/560 under five workers; all 15 failures are load flake, each confirmed by a file-level pass** — `flow-board` + `flow-attachments` 66/66 exit 0, `flow-app-shell` + `flow-sprints` clean, `flow-relationships` 30/30 exit 0. Nine of the fifteen were board tests, which is where `card_layout` lives, so this was checked rather than assumed; BRD-5 ("cards render exactly the card_layout fields, in order") and BRD-3/4 passed even in the contended run. REL-32, SPR-6 and SHL are on the run's known-flaky list. |
| M4.5 | saved-view editor — advanced DSL | `995754e` | **21 of 22 required cases covered**, gate green (686 → 707) | **The brief's central premise was wrong and I corrected it before building.** It stated that `parseQuery`/`validateQuery`/`QueryValidationError` appear zero times in `apps/web/src`; the grep returns **six** hits — `server.ts:147` already imports `QueryValidationError`, and `buildDsl.test.ts` revealed a **`buildDsl.ts` that already existed**, which is the Basic→Advanced generator VUE-10 needs. Building without checking would have duplicated it. **The real gap was narrower and is now closed**: no route validated a query without running or saving it, so `POST /api/query/validate` was added (**A73**), returning `kind`/`message`/`position`/`suggestions` as *fields*. That closes **LST-44/LST-45** for this path — position and suggestions reach a surface intact for the first time; the generic 500 on `GET /api/tasks` is unchanged. **`relationship.*` verified against the tokenizer, not the ticket**: `validate.ts:247` rejects it by name pointing at `has_link`, so the help popover omits it — asserted with a positive control, since "no relationship.* anywhere" is trivially true of empty content. **Advanced→Basic refuses rather than approximates** (**A74**): `dslToSearch` accepts only the exact shape `buildDslFromSearch` emits and names the construct otherwise, because a false conversion costs wrong rows silently while a false refusal costs a toggle. **Three defects found by measurement, two fixed**: (1) VUE-21 — `listTasks`' `onWarning` was passed by the CLI *and* MCP but **not the web**, so a view on a deleted custom field returned 200 with zero rows and the warning was dropped on the floor; now surfaced as a `warnings` array (**A76**), web reaching parity rather than gaining a capability. (2) VUE-19 — `/api/info` sent `today` but never the zone that produced it, so an off-by-one date was unexplainable; `timezone` added, resolved in **one** `calendar.yaml` read so the pair cannot straddle midnight (**A77**). (3) **VUE-22 is the one case not built** — one unparseable entry makes `parseQueriesConfig` throw for the *whole document*, so `GET /api/tasks?view=ok` 500s for a healthy view next to a broken one, directly under a comment saying bad queries "shouldn't crash the rest of the load". Fixing it means tolerant-load/strict-save on a function shared by CLI, MCP and web — a core contract change, so **stopped and recorded** rather than decided. **A vacuity bug in my own test, caught by mutation**: the VUE-34 "distinct messages" test compared two error strings that were both `""` because the helper waited only for the container, not the message — it passed while asserting nothing. Fixed to wait for content and assert non-empty. **Also corrected mid-run**: a mutation I first applied with `perl` silently failed to match (`grep -c` = 0) and the suite stayed green — the "mutation that touches nothing" trap; re-applied and verified present before trusting the result. **Two invented identifiers caught before they shipped**: `text-text-danger` is not a token (the real one is `text-danger-fg`, 92 uses) and `if (!r) return` after `parseJsonBodyWithSchema`, which throws rather than returning falsy. **Every mutation compiled with `npm run build` exit 0**; core was mutated once (M10) and restored to `git diff --quiet` clean. Unit 2943 → **3007** (+64), integration **454** (unchanged, confirming the response-shape additions regress nothing), e2e **21**, coverage 686 → **707**. **UI 560/560 at file level**: the full serial run crashed Node on memory, so it was run in four batches; nine failures across batches (BRD-3/5, MSL-19, SHL-4, REL-43, SET-11, NEW-28/35, XS-4) were **each** re-run at file level and every file passed with exit 0 — the three in batch 3 timed out at 30–55s because the integration suite was running concurrently. |
| K10 | body-write precondition on CLI + MCP | `6ac31d8` | closes M2 gate blocker B2 | **The M2 gate's second blocker, closed with Ken's split design.** CLI stays **last-write-wins by default** per K10 — `--expect <token>` opts in per command, `cli.require_body_token` in `workflow.yaml` opts in a tracker; MCP's `get_task` returns `body_token` and both write tools take `expected_token`. **Chose (a) over (b) for how MCP obtains a token, and it was not merely a plumbing preference**: deriving the token server-side from `updated_at` would hash the caller's timestamp against *whatever body is on disk now*, so it passes regardless of what body the agent read — a weaker guard wearing the same name, inverting the exact property core's docstring says the token exists for (A56). **A core gap found in passing**: `appendTaskBody` took no options at all, so the token was enforced on replace and silently ignored on append — the more dangerous half, since an append reads the existing text in order to add to it. **Two mutations produced honest null results rather than tests**: unregistering `StaleBodyWriteError` from the CLI's `KNOWN_DOMAIN_ERRORS` and from MCP's `isKnownDomainError` left both end-to-end suites **green**, because both outer catches render the same message and status — measured, including a probe dumping the raw MCP result. Rather than ship two tests that appear to cover the registration while asserting nothing, the classification is asserted at the only layer where it is visible, and *those* tests redden. **Every other new test shown to fail by mutation** (8 mutations, each with `npm run build` exit 0 in place). **A regression I introduced and caught before the gate**: reading `workflow.yaml` to decide the opt-in made a *malformed* config fail a `loctt body --set` that has never needed that file — measured against the pinned baseline, which does not load it at all. An unreadable config now answers "not configured" (the default is off anyway), with its own test, red when the catch is removed. Unit 2799 → 2805, integration 427 → 439; UI, e2e unchanged. |
| M3.4 | create task modal | `d257368` | 39 of 41: NEW-1..19, 21..40, BRD-40 (repointed), BRD-42 (verified unbroken) — **NEW-20, NEW-41 name states that cannot exist** | **The BRD-42 regression the previous attempt introduced is not present, and the reason is that BRD-40 was read literally.** The case asks for "one board-level empty state ... [that] offers '+ Add task'" and says nothing about per-column controls; the prior build added one per column, which put a control on the stale column BRD-42 drags into. Only the existing board-level button was repointed at the modal. **BRD-42 verified exit 0** in isolation and in the full board spec (51/51). **Two server/core defects reproduced with positive controls before fixing.** (1) `createTask` threw a bare `Error`, matching none of the route's branches: measured `HTTP 500 {code:"unknown", data_state:"unknown"}` with the reason stranded in `detail`, while the *identical* value through `setField` returned a clean 400 with `field` — two write paths, two answers (**A42**). (2) Every picker saw only the first 100 entries: measured `{total:150, items:100}`, and `lbl-140` existed on disk but was invisible to the client, so the label field would offer to **create a duplicate** of it (**A43**). **Three defects found by writing the tests, all mine**: no query invalidation after create (NEW-13/NEW-3 both red); a connection failure arrives as a bare `TypeError`, not an `ApiError`, so NEW-37 said "Failed to fetch" instead of "not created"; and `isTypingTarget` returned `undefined` from a `boolean` signature. **The most valuable catch: NEW-29 was passing vacuously.** Clicking a `disabled` button asserts only that the attribute is set, and dispatching *after* a real click lets React re-render first — the test stayed green with the guard deleted. Rewritten to fire both clicks in one tick from the first press: measured **2 POSTs and 2 tasks on disk**. Neither `disabled` nor `submitting` state can stop that (every handler closes over its render's value); only a ref can (**A46**). **A real P4 defect found by NEW-35**: an archived-reference rejection named the raw ULID rather than the milestone the user picked. Fixed in core so all three surfaces improve together; the id is kept alongside the name because identity is the ULID (**A47**). **Three green tests were asserting that defect** and were updated — flagged per CLAUDE.md. **Two cases cannot be satisfied and were not faked**: NEW-20's ask state is unreachable because `ProjectsConfigSchema` rejects a ghost `default` at parse time (`/api/projects` 400s, so there is no list to degrade with) (**A44**); NEW-41 names *outdated*, but `CURRENT_SCHEMA_VERSION` is 1 and `readSchemaVersion` rejects anything below 1 as malformed, so that branch is unreachable — verified against `future` instead (**A45**). **Six of my own fixtures were wrong, each caught by measuring**: `init` takes no `--name`; a custom field needs `multi` and `searchable` or every request 400s on config; `project delete` and `milestone archive` take positional names (`--force` does not exist, it is `--yes`); `state.yaml` keys counters by **ULID**, not prefix, so a `/WEB/` filter matched nothing and compared two identical strings; `labels.yaml` does not exist until the first label is written; and the picker's clear entry is `role="option"`, not `button`. **A doc claim I corrected rather than repeated**: the brief said `docs/user/cli/reference.md` listed 4 of `create`'s 13 flags — the prose already documented the other nine. Both references were updated for the new error behaviour instead, with the CLI examples measured against the binary (its own pre-validation catches most rejections before core, with a different message than I first wrote). **REL-28 failed once and is not mine**: it crashed the browser ("session closed"), passes on re-run and in the final suite, and touches no file this ticket changed. Decisions **A42–A47**. Unit 2716 → 2762, UI 438 → 482, integration 427 (unchanged), e2e 21 (unchanged), coverage 555 → 594. |
| M3.2 | board drag-drop | `771bb1f` | 23 of 24: BRD-9, 10, 11, 13, 25..32, 34..38, 41..44, 49, XS-9 — **BRD-12 blocked** | **BRD-31 was a real core defect and is fixed**: `reorderBoardRank` had no same-position guard, so a no-op drop rewrote `task.md`, advanced `updated_at` and appended a `rank_changed` entry whose `before` and `after` were the same string. Measured on the CLI (rank `u` both times, history 2 → 3), fixed in core so the CLI and MCP inherit it, re-measured to nothing-written (**A28**). **CW-5's atomic write is built on `setFields`, which had no caller**: a new `POST /api/tasks/:ref/board-move` writes `status` and `board_rank` in ONE change set; `board_rank` is auto-managed, so `setFields` gained an opt-in `allowAutoManaged` grant rather than the field being un-managed for everyone (**A29**). Verified on disk: one request, both fields, one history batch sharing a timestamp, and a concurrent `assignee` untouched (XS-9). An intra-column reorder still goes to `board-rerank` with **no** `status` key. Drag is pointer-events, not a new dependency (**A30**). **A defect I introduced and the spec caught**: `isNoOpDrop` first compared indices — while a card is held it leaves the flow, so the cards below shift up and a pointer held perfectly still resolves one slot *lower* (measured: origin 1, resolved 2), sending a write BRD-31 forbids. Fixed by keeping the dragged card's box in the column (BRD-11's placeholder) and comparing neighbour *pairs*. **A mutation that survived**: comparing only one neighbour passed my first `isNoOpDrop` tests, so a test was added that kills it. **BRD-12 cannot be satisfied and is `test.fixme`**: core scopes `board_rank` per *status* and refuses a cross-status anchor (the SPR-C2 fix, with two tests asserting it), while `workflow.boards` makes a column a *set* of statuses — the two layers disagree on what a column is. Fixing it changes CLI and MCP behaviour and contradicts a recorded decision, so it is reported, not decided (`known-gaps.md`). **Two fixtures of mine were wrong, not the code**: BRD-26 dragged the bottom card to the bottom (correctly a no-op), and the BRD-28 rebalance loop re-dropped against one anchor, which the new guard makes a fixed point. Unit 2584 → 2609, integration 427, e2e 21, coverage 487 → 508. |
| M3.5 | sprints overview + K11 + K12 | `1685989` | 15 of 15: SPR-1..6, 15, 17, 19, 20, 24, 27, 31, 32, 36 — plus **K11** (CLI+MCP `board-move`) and **K12** (MSL-20's `+N` reveal) | **The ticket's two server claims stayed false and no server code was written** — A48/A49/A50 were verified in-tree before building, and nothing in the build contradicted them; `handleListSprints` is untouched. **The drag-reuse impression was checked, not inherited**: `useBoardDrag` is column-agnostic in the threshold, the BRD-32 snapshot, the `elementFromPoint` geometry, `Esc`, the vanished-column cancel and `isNoOpDrop`; exactly **two** things were status-specific — the `BoardColumn` parameter type and one `statusForColumn` call. Widened in place with a `DraggableColumn` bound and a `fieldForColumn` callback defaulting to the board's rule, so `BoardView` needed **no edit** and its 30 tests pass untouched (**A51**). **The write is `useSetField`, not `boardMove`** (**A52**): `board_rank` is ranked within a *board* column, so routing a sprint drop through `boardMove` would silently reorder the board as a side effect; `setFields` also carries A49's `resolveSprintIdFromInput` guard, which is SPR-36's server half. **The most valuable mutation of the ticket**: making the client send the sprint **name** instead of its id left SPR-4 **green** — `POST /set` resolves a name back to an id server-side, so the file was right for the wrong reason, and only SPR-24's ambiguous-name case caught it. SPR-4 now asserts the request payload directly (`{field:"sprint", value:<ULID>}`) as well as the file and `loctt show`. **Eight further UI mutations**, each reddening only its own cases: name-for-id, unset→literal `"none"`, both error branches removed, the SPR-20 hint suppressed, the dangling id unnamed, collapse never persisted, the move-error banner deleted. **SPR-3 stores overrides, not an expanded-set** — the bullet "the default is a default, not an override applied on every render" is unsatisfiable with a set of expanded ids, because collapsing the *active* sprint would be undone by its own default on reload; the C1 mutation demonstrates exactly that. **SPR-17 is a bounded window, not a virtualizer** (**A53**): a transformed container breaks `elementFromPoint`, which is the bug class `BoardView`'s comments record being fixed twice; the header count comes from the bucket, so 400 reads 400 while the DOM holds 50. **K12's popover could not reuse `Menu`** (**A54**): `Menu` anchors with CSS `absolute`, and both call sites clip (`ListView`'s `overflow-x-auto overflow-y-hidden`, the board column's `overflow-y-auto`); `createPortal` had **0 hits** anywhere in the client before this. One `LabelPill` is now shared by the visible and revealed pills, so the M2 mutation — rendering the revealed ones as text — reddens exactly the "each remains individually clickable" claim. **A real spec-language gap found and logged, not faked** (**A55**): the query language has **no** "is unset" operator — `sprint = null`, `sprint is null`, `sprint = empty` all fail or match nothing, with `sprint = "<ULID>"`/`!=` as the positive control — so SPR-6's third bullet asserts the negation. **Four of my own fixtures were wrong, each caught by measuring**: the tracker fixture's `seed({fields:{sprint:"Name"}})` writes frontmatter **verbatim**, so a sprint *name* would land where an id belongs — the exact confusion SPR-4 rules out, and it would have made these specs pass against a view that read names (switched to `loctt set`, which resolves); `loctt bulk` does not exist; `[data-testid^="board-card-"]` also matches each card's `board-card-field-*` children (4 hits for 2 cards); and my SPR-2 order snapshot raced the fetch, failing 2/5 until it waits for the columns. **`boardMove`'s anchors are validated against the DESTINATION column** (BRD-35) — my first CLI test used a source-column anchor and was correctly refused; the test was wrong, not the code. **A guard that fired correctly**: the e2e MCP tool-list snapshot went red on `move_board_card` and was updated. **Six full-suite UI failures, all load-sensitivity, not regressions** — XS-18, MSL-6, REL-5, REL-28, REL-46 and the schema-mismatch banner each passed at *file* level immediately after on the same build (168/168, 30/30, 1/1), and MSL-6 additionally 4/4 in its group because M3.5 refactored the component beneath it. The existing known-gaps entry named only REL-28/30/32; it is widened. Decisions **A51–A55**. Unit 2764 → 2799, UI 482 → 500, integration 427 (unchanged), e2e 21 (unchanged), coverage 594 → 609. |
| M4.1 | settings shell + Projects + Users + K3 slug | `d917cef` | 17 of 46 newly covered: SET-32, SET-42, PRU-5, 6, 7, 11, 17, 19, 20, 23, 26, 30, 32, 33, 36, 38, XS-63 — **PRU-44, 45, 46 were already covered** by pre-existing server tests and are not this ticket's work; 26 remain uncovered | **K3 is done across all three surfaces and the rename question is answered by measurement, not preference.** `slug` is on `ProjectDefSchema` as `SlugKey.optional()`, generated at `createProject` **and** at `initLoctt` (a new tracker was otherwise born pre-K3), unique-enforced in the schema's `superRefine`, and resolved by `resolveProjectIdFromInput` **ahead of name** — so CLI and MCP accept it everywhere they accept a project with no per-command work, verified against the spawned binaries (`--project web-app` creates and lists; an unknown slug errors rather than silently widening). **A60: the slug is fixed at creation.** The load-bearing check K3 demanded was whether a rename is load-bearing for saved views — measured that it is not: the DSL reads `project` generically off frontmatter (`query/evaluator.ts:142` via `readField`) and frontmatter holds a **ULID** (P-2), so no saved view stores a slug. Only shared links are affected, and fixed slugs preserve them. **A61: optional on disk**, because `.strict()` would make every pre-K3 `projects.yaml` fail to load, and K3 requires the ULID path to keep working anyway. **Three defects found, two fixed.** `DELETE /api/projects/:id` **never passed `hard: true`**, so every delete merely archived and `remap_to` was accepted then ignored — measured with a positive control (`grep hard` empty against two `deleteProject` hits), and **all 232 server tests passed before and after**, so nothing covered it. `PUT /api/projects/:id` **silently dropped `archived`**; there was no project archive route at all, and core's `archiveProject`/`unarchiveProject` had **zero callers on any surface** — caught by the PRU-7 test going red. Both fixed. PRU-17's *clear-the-project-field* option has no core support (the remap runs through a journal entry with an idempotent replay handler; a clear needs its own journal kind) — logged, and the no-silent-orphan half of the case is still satisfied because the server refuses the delete outright. **A regression I introduced and fixed at the right layer**: slug uniqueness broke `git sync` between two clones, because both `init` to a project named "Tasks" and so both derive `tasks`; confirmed by disabling only the slug branch and watching the test pass. Fixed with `assignProvisionalSlugs`, the exact parallel of the existing `assignProvisionalPrefixes`, which was written for the identical prefix collision (**A62**). **A vacuous test of mine, caught by mutation**: the PRU-19 prefix-collision test passed with the exact-match branch neutered, because the case-insensitive branch also fires on an identical string and its message happens to contain the same project name — shape (b). Rewritten to assert "must be unique" and *not* "differs only in case"; it now reddens. **A dead line of mine, caught the same way**: the accent-strip `replace` in `slugifyName` was unreachable — NFKD splits the accent off and `[^a-z0-9]+` already removes it, so both paths give `cafe-ops`. Deleted; the test now mutates `NFKD`→`NFC` and goes red. **A false bug report I withdrew**: I read a Playwright failure as a blank project row, but `toHaveValues` is for `<select multiple>` and the strict-mode error listed both inputs rendering correctly — the app was never wrong. **Docs**: the CLI reference already documented `--project <key>` with `--project web` examples from the pre-removal slug era, now true again; `--slug` added to `project create` (and registered in the flag allowlist, without which it would have been rejected); MCP `create_project` gained `slug` and every project ref description updated; `schema-reference.md` updated — caught by `schema-doc-accuracy.test.ts`, which is designed to fail exactly this way. **Invariants amended**: P-1 said "There is no slug" (superseded by K3), P-3 now lists slug-first resolution, and P-5's "prefix is immutable" has been false since `setProjectPrefix` landed. Decisions **A60–A64**. Unit 2807 → 2851, UI 507 → 526, integration 439 → 442, e2e 21 (unchanged), coverage 620 → 638. REL-32 and SPR-6 failed under parallel load only and both pass at file level — the known flakes, neither touching this ticket's files. |
| M4.2 | settings — workflow panels | `867b9f8` | **26 of 26 required cases covered**, gate green | **Two real defects found, both mine to fix, both now guarded.** (1) **The panels silently deleted hand-edits to `workflow.yaml`.** `PUT /api/workflow` takes the whole document, so a panel editing one collection re-asserts every other one from the copy it mounted with. Measured: with `/settings/statuses` open, adding a status to the file by hand and then dragging a row **deleted the hand-added status** — no error, and the server accepted it because nothing referenced the key. That is exactly what SET-28 forbids. Fixed with `useSaveWorkflowCollection` (**A65**), which re-reads immediately before the PUT and applies the edit *by key* to what it read. Reverting the re-read to the query cache reddens the SET-28 test. (2) **A remount that ate its own success message**: I keyed `CalendarEditor` on `JSON.stringify(stored)`, so a successful save invalidated the query, the document changed, and the remount destroyed the 'Saved.' confirmation before the user could read it. Replaced with a stored-document comparison. **Two cases cannot be fully satisfied and are recorded rather than narrowed.** **SET-24**: the panel cannot show an unresolvable stored timezone because `IanaTimezone` rejects it at *load* — measured, `GET /api/calendar` answers 400 and the panel never receives the document. The CLI tolerates the same file (`loadOptionalConfigs` catches and falls back to UTC), so the two surfaces disagree about whether that tracker is usable. What ships: the error names the file and the value, and the picker never offers an unresolvable zone. **SET-22**: `CalendarConfigSchema` rejects `working_days: []`, so the state its other three bullets describe has no supported path; the panel blocks and names the consequence instead (**A67**). Both in `known-gaps.md`. **A third finding, guarded but not fixed**: deleting an in-use key with `validateRemapCoversDeletions` disabled is still refused — by `applyScalarRemap` throwing `internal: missing status remap for "in_review" on task T-1`, which the route surfaces **verbatim** as the user-facing `message`. Both paths return 400 and write nothing, so a status-code assertion cannot tell them apart; the test now asserts the message does not start with `internal:`. A candidate for K13. **New core capability reaches all three surfaces**: `computeWorkflowKeyCounts` (**A66**) — counts, not the `Set`s `computeWorkflowKeyUsage` returns — behind `GET /api/workflow/usage`, `loctt config usage`, and MCP `get_workflow_key_usage`, with an integration test asserting CLI and MCP agree. **Vacuity caught by mutation, in my own tests**: the SET-24 picker test asserted only that `Mars/Olympus_Mons` was absent from the options — true of any list, since it was never a candidate (shape (c)); rewritten to assert every offered zone resolves in the browser, and it now reddens when the panel offers an unresolvable one. The SET-18 test matched `/unknown|no longer/i` against the whole body and was passing on the **activity feed's** drift badge while the status field went untested (shape (a)); retargeted at `meta-unrecognized-status`, and it reddens when `OptionPicker`'s drift branch is disabled. **A mutation that survived and should not have — until isolated**: SET-34's snap-back looked unguarded, but only because a second mutation in the same batch had disabled reordering entirely, so nothing moved and 'snaps back' held trivially. Run alone, it reddens. Mutations were applied in four batches; every one compiled with `npm run build` exit 0. Unit 2854 → 2888, UI 526 → 554, integration 443 → 448, e2e 21 (unchanged), coverage 638 → 664. SPR-6 failed under parallel load and passes at file level — the known flake, not in this ticket's files. |
| M3.3a | timeline view — rendering | `842bc46` | 14 of 17: TML-1..8, 12 (snap math), 13..17 — **TML-9, 10, 11 are M3.3b's** (drag writes) | **A core defect fixed, and it is the reason TML-34 was unsatisfiable**: `autoClearTimelineDependency` *silently deleted* `timeline.dependency_relationship` from the user's own `workflow.yaml` whenever the value named a key not in `relationships` — its docstring called this deliberate. Measured before: set `blocks`, remove `blocks` from `relationships`, and the line is **gone** from disk. TML-34 requires the opposite — "a visible configuration notice **naming the missing key**" — which is impossible once the name is erased. The auto-clear is removed; the dangling value now survives (verified on disk, through the parser, and via MCP `get_workflow_config`), and `dependencyRelationshipStatus` returns `{kind: missing, key}` so M3.3b's notice has something to name (**A31**). **Two green tests were asserting the bug** and were inverted — "drops timeline.dependency_relationship when the referenced key is gone" and "preserves new timeline fields when dependency_relationship is auto-cleared", both of which asserted `undefined`; the first now also reads `workflow.yaml` off disk. CLI (`doctor`, `create`, `list`, `link`) and MCP verified sane against the dangling state — `link` refuses the removed relationship with a clean message rather than crashing. **Geometry is unit-tested as arithmetic, not as "a bar is visible"**: 31 tests over inclusive spans, the `dateToX`/`xToDate` inverse pair, DST boundaries (all day math is exact UTC multiplication, so a spring-forward day is still one column), leap years, and `first_day_of_week`. **The invariant that earns its keep** is TML-7's "the total row count is identical across all groupings" — it only holds because every grouping has an explicit absent-value band, and deleting that band reddens six tests including this one. Decisions **A32** (zoom/grouping/arrows in the URL, collapse local — TML-6 only requires collapse *not* change task scope, which local state gives by construction) and **A33** (shading at day/week only, the literal reading of TML-13's first bullet; 104 stripes at month zoom is noise). **Ten unit mutations + six UI mutations, each reddening its target with `npm run build` exiting 0.** **Two of my own fixtures were wrong, not the code**: `query: "true"` is not valid DSL, and `milestone create` takes a positional name, not `--name`. **A docs gap found, not fixed**: neither `boards` nor `timeline` was in schema-reference's `workflow.yaml` table; `timeline` is now documented incl. the dangling contract, `boards` is logged in `known-gaps.md`. Unit 2609 → 2677, coverage 508 → 522. |
| M3.3b | timeline drag writes + sections B, C | `d867147` | 33 of 37: TML-9, 10, 11, 18..25, 28, 29, 31, 33..50, PRU-1 — **TML-26, 27, 30, 32 not met** (virtualization) | **The atomicity problem was real and is fixed at the route layer**: no web route could satisfy TML-11's "a **single** atomic multi-field write, not two sequential calls" — `TASK_SET_RE` → `handleSetField` is one field per request. New `POST /api/tasks/:ref/set-dates` reaches core's `setFields` (**A39**, narrow by design, mirroring `board-move`). **No `allowAutoManaged` grant, checked not assumed**: `board_rank` needed one because it is in `AUTO_MANAGED_FIELDS`; the two date fields are `BUILTIN_OPTIONAL_FIELDS`, so the default refusal does not apply. **Atomicity is measured on disk, not argued**: two sequential `loctt set` calls stamp two timestamps (`…20.023Z`, `…20.250Z`); one `setFields` change set stamps both lines with one (`…12.103Z`). The TML-11 test asserts that shared stamp **and** carries the two-timestamp case as its positive control — mutating the hook to two sequential POSTs reddens it while TML-9/TML-10 stay green. **A real defect found by writing TML-9's payload assertion**: M3.3a's 1px edge handles were not hit-testable — `elementFromPoint` at the bar's right edge returned the BUTTON, so an end-edge drag dispatched as a *body* drag and wrote `{start_date, due_date}` where the case demands `{due_date}`. Handles are now a 6px minimum hit area above the label (**A40**, which is TML-36's own first bullet); the `stopPropagation` on them is load-bearing — mutating it reddens both TML-9 and TML-10. **TML-34's notice is built** on M3.3a's `dependencyRelationshipStatus`, naming the missing key, with the dangling value verified surviving on disk. **TML-48 could not be satisfied as written and the reason is measured** (**A41**): a `start_date` of "next tuesday" fails the task schema on *read*, so the API returns the task in `unreadable`, never in `items` — the client is never handed a bad value to place in the lane. The case's "or flagged in place" branch is taken; the lane path exists and is unit-tested for when the schema changes. **Four of my own test fixtures were wrong, not the code**, each caught by measuring rather than assuming: `blocks` is declared **acyclic** so TML-33's cycle cannot be built with it (switched to `causes`); `depends_on` is not a relationship in the default workflow (its inverse is `is_blocked_by`); the project filter takes a **ULID**, not a name or prefix, and `project` is immutable after create; and `?q=` maps to the server's `query=` DSL where a bare word does not filter — it returned the full set, which would have made TML-41's empty-state assertion pass for the wrong reason. **A measurement that unblocked eight tests**: bars open scrolled to *today*, so a March bar on an August tracker sits at x = -5539 and every mouse drag pressed on nothing; the helper now scrolls first, and edge points come from the handles' own boxes rather than arithmetic off the bar. **Nine UI mutations + six unit mutations**, each reddening its target with `npm run build` exiting 0, and M3.3a's own `arrows.test.ts` re-mutated after the `dependencyGraph` refactor to confirm its coverage did not lapse. **Not met, logged in `known-gaps.md` with the mechanism sketched**: TML-26, 27, 30, 32 each need a windowing layer (plus a sticky band header and an arrow-hover highlight) that is a build of its own; TML-21's *virtualization* bullet is unmet for the same reason, though its responsiveness, bar-width and far-end-date bullets are asserted. Decisions **A39–A41**. Unit 2694 → 2716, UI 400 → 444, coverage 522 → 555. |

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
M1.1   0/75    M2.1  0/21    M3.1  0/27    M4.1  3/47   M4.5 21/22
M1.2  10/67    M2.2  0/41    M3.2  0/24    M4.2  0/25   M4.6  0/23
M1.3   3/44    M2.3  0/15    M3.3  0/50    M4.3  0/74   M4.7  0/23
M1.4  26/59    M2.4  0/38    M3.4  0/41    M4.4  0/6    M4.8 38/64
                                                        M4.9 12/13
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
