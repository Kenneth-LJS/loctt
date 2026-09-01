# The Phase 5 run workflow

How the UI build runs unsupervised: who does what, what splits into
what, and the four things that stop the run.

Decided with Ken 2026-08-24; the autonomy rules revised with him
2026-08-29 after M1. This governs the *run*.
[`TEMP-BUILD-PLAN.md`](TEMP-BUILD-PLAN.md) governs the phases;
[`build-loop.md`](docs/dev/build-loop.md) governs one ticket.

**Working state.** Deleted when Phase 5 lands.

---

## The shape

```
SECTION      = one ticket        M1.4, M2.1, … M4.9
  SUBSECTION = a coherent group  implement → test → review → commit
  SUBSECTION = …
  ─────────────────────────────────────────────────────────────
  SECTION GATE  agentic testing + review     ← only at section end
```

A subsection ends in a **commit**. A section ends in a **gate**.

Ken is not in the loop for either. He reads the gate report after the
fact.

---

## Who does what

**Everything is AI.** Building, tests, review, gating, approval.

That removes the human check the earlier plan assumed, so the
compensating rule is **freshness**: the agent that reviews did not write
the code, and the agent that gates wrote nothing at all.

| Role | Who | Why |
|---|---|---|
| Build + tests | Main session (me) | Holds the context across tickets |
| Subsection review | **Fresh agent** | Did not write it — not grading itself |
| Section gate | **Fresh agent** | Wrote nothing in the section |

A review agent that also wrote the code is not a review. If context
pressure ever makes that tempting, spawn a new one instead.

### Building is delegated too

**Changed 2026-08-29 on Ken's instruction: "use agents to code to
preserve context".**

The earlier rule had the main session build, reasoning that a build
agent writing the requirement, the test *and* the implementation has
no external check on any of the three. That reasoning was half wrong.
The main session had no external check either — it was reviewed at
each subsection boundary, and **that review is what supplies the
check, whoever wrote the code.** The freshness rule is untouched: the
reviewer did not write it, the gate wrote nothing.

What delegation buys is context. M1 spent most of a session's window
on probes, mutations and suite output, and a compaction mid-ticket
loses exactly the details a build depends on.

| Role | Who |
|---|---|
| Plan, probe, split | Main session — it holds the case docs and decisions |
| Build a subsection | **Fresh agent**, one subsection, briefed with the case text |
| Review | **Fresh agent**, wrote none of it |
| Section gate | **Fresh agent**, own worktree, pinned SHA |

**What the main session keeps.** Step 1 (read the cases, run the
inverted coverage gate) and step 2 (probe the built binary) stay here,
because they decide *what* is owed and a build agent that also decides
that is grading itself. The main session also owns every stop
condition: an agent that hits one reports it rather than deciding.

**What a build agent is given.** The case text in full, the relevant
probe findings, `invariants.md`, `decisions.md` — and **not** a
suggested implementation. It writes tests tagged `// @verifies`, and
each must be shown to fail.

**Agents that write code get their own worktree** when they may run
concurrently, for the reason round 7 established: two agents in one
working tree cost a whole gate round.

---

## The subsection loop

A subsection is a coherent group of cases inside a ticket — small enough
that a review agent can read the whole diff.

```
 1  PLAN      Read every case in full from its flow doc. Not the index title.
              GATE  cases:coverage --require <ids>     MUST FAIL

 2  PROBE     Run the built binary against the claim before writing code.
              Roughly a third of "defects" in this repo were already correct.

 3  BUILD     Implement. Never edit a flow doc.

 4  TEST      Tests tagged // @verifies <ID>.
              Each one SHOWN TO FAIL: break the behaviour, watch it go red, restore.
              Rule 4: extending tested code? Delete your branch, run their file.
              If it stays green, the coverage you assumed is not there.
              GATE  test && typecheck && lint

 5  REVIEW    Fresh agent, on the diff. See below.

 6  FIX       Apply every finding, or record why not. Loop 4–6 until clean.

 7  VERIFY    GATE  cases:coverage --require <ids>     MUST PASS
              GATE  cases:check

 8  COMMIT    One commit. Update the run log.
```

Step 1's gate is inverted deliberately: requiring the IDs *before*
writing proves they exist. A hallucinated `BLK-99` fails in thirty
seconds rather than at step 7.

### What the review agent is told

It gets: the diff, the case text for every ID claimed, `invariants.md`,
`decisions.md`. It does **not** get my reasoning for the approach — that
is what it is checking.

It answers four questions:

1. Does the implementation satisfy each case it claims, in full?
2. **Is any test vacuous?** Would it still pass with the behaviour
   deleted? This is the highest-value question it asks.
3. Does anything violate an invariant or a recorded decision?
4. Is anything here not required by any case?

Every finding is applied, or a reason is recorded in the commit. "I
disagree" is not a reason on its own; it needs the case text behind it.

---

## The section gate

Runs once, at the end of a ticket. Two halves.

### Half 1 — mechanical

Non-negotiable. Exit codes, not opinions.

```bash
npm run test             # workspace unit
npm run typecheck
npm run lint
npm run test:ui          # Playwright — real clicks, real tracker
npm run test:integration
npm run test:e2e
npm run cases:coverage -- --require <every case in the ticket>
npm run cases:check
```

**Never run two suites concurrently** — each `pretest` rebuilds `dist/`,
and a concurrent build surfaces as ~30 scattered failures that do not
reproduce in isolation.

**A summary line is not a verdict.** `Tests 1443 passed` has appeared
above a `FAIL`. Grep for `FAIL`; zero is the only clean result.

### The gate runs alone, in its own tree

**Added after round 7 was abandoned mid-run.** The gate agent shared
the main working tree with the session that was fixing things. Three
commits landed underneath it, two of them rewriting the very tests it
was auditing — so its suite results described a tree that no longer
existed. It stopped rather than report them, which was right.

It had also run `git stash` to get a clean tree for the suites, and
that swallowed 45 lines of the coordinator's uncommitted work. The
symptom is silent: `git status` reads clean, the reflog shows no
checkout, because a stash is neither.

Two rules, and the first is not optional:

1. **Give the gate its own worktree, at a pinned SHA.** Tell it the
   commit explicitly and have it verify with `git log --oneline -1`
   before starting — worktrees are created from an old base by
   default (see `known-gaps.md`). Pre-build it, because the agent may
   not have permission to.
2. **Commit everything before dispatching it**, whichever tree it
   runs in. Uncommitted work near a gate agent is not safe.

A gate verdict on a moving tree is worth nothing, and this branch has
already lost rounds to that class of confusion.

**Copy the report out before removing the worktree.** The gate writes
`docs/dev/gates/<milestone>-round<n>.md` into *its* tree, and
`git worktree remove --force` takes it with everything else. M2's
round-1 report was lost that way and had to be reconstructed from the
agent's returned summary — which is thinner than the original, and had
to be labelled a reconstruction because a gate report is evidence.

    cp .claude/gate-m2/docs/dev/gates/M2-round1.md docs/dev/gates/

before the `worktree remove`, not after.

### Half 2 — agentic

A fresh agent drives a real browser against a real seeded tracker. It
wrote none of this code.

**Real clicks only.** `page.click()` — Chromium's input pipeline,
hit-tested, trusted events. **`page.evaluate(() => el.click())` is
banned**: it bypasses hit-testing, so it passes through a modal overlay
that would block a user.

It walks the milestone's journeys (§ Journeys below), and is explicitly
licensed to deviate — wander, try the wrong order, click the thing no
case mentions. That is where its value is; a scripted walk only
re-checks what the specs already cover.

**Its verdict is the gate.** Ken approves after, from the report.

### The gate report

Written to `docs/dev/gates/<ticket>.md`:

```
Verdict:  PASS | FAIL
Suites:   each command, exit code, FAIL count
Journeys: each one walked, what was observed
Findings: severity, what happened, reproduction steps
Cases:    any behaviour found that no case covers
```

A finding that contradicts a case is a **defect**. A finding that no
case covers is a **proposed case** — recorded, never invented into the
flow docs, because an agent that may write the spec has no spec.

---

## Journeys

Per milestone. The named list is the floor, not the ceiling.

**M1 — shell + list**
- Land cold on `/list`; read the table; sort a column; page to the end
- Filter to a subset; copy the URL; open it in a new tab; confirm it reproduces
- Select rows across two pages; bulk set a field; confirm the count is honest
- Move tasks to another project; check the keys changed and the old ones still resolve
- Archive a selection; undo it; toggle Show archived
- Export CSV with a filter applied; open the file
- Kill the server mid-session; confirm the failure is stated, not rendered as empty

**M2 — task detail**
- Open a task from the list; use Back; confirm scroll position survives
- Edit each meta field; reload; confirm it persisted
- Write a body; navigate away mid-edit; return
- Post a comment, edit it, delete it; check the activity feed
- Link a relationship; open the other end; confirm the inverse is there
- Type a key that never existed into the URL

**M3 — board, timeline, create**
- Drag a card between columns; reload; confirm it stuck
- Drag to an invalid target; confirm the card returns
- Create a task from the modal; find it in the list
- Move a card between sprint columns; check the count on both

**M4 — settings, init, polish**
- Change a workflow status; confirm existing tasks still render
- Archive an entity that tasks reference; confirm they degrade visibly
- Walk the init wizard on an empty directory
- Keyboard-only: reach every interactive control, no mouse

**Always, every milestone:**
- Reload on every route
- Back and forward through the whole journey
- One flow at a narrow viewport

---

## What stops the run

**Revised 2026-08-29 with Ken, after M1.** M1's failure mode was not
the run going wrong — it was the run stopping constantly for calls
that were the agent's to make. "Should I fix the blockers?" is not a
question. The rules below exist to make that concrete.

**Default: fix it.** If something is broken and the fix is known, make
it — then re-run the failing tests *and* the tests around whatever the
fix touched, to confirm the fix landed and nothing regressed. That
second half is not optional: a fix verified only by the test that
failed is a fix that has not been checked for blast radius.

### A test written around a defect becomes assertable when the defect is fixed

**Established 2026-08-29, three times in one session.**

An agent that meets a live defect mid-ticket often does the honest
thing: it asserts the *reachable* half of the case and says in a
comment why the real bullet cannot be tested yet. That is right — far
better than a vacuous test or a silently narrowed case.

But it leaves a trap. When the defect is fixed, **that test now
asserts the wrong thing**, and it fails — which reads exactly like the
fix broke something.

The instances:

- **XS-26** asserted that an unrelated save *fails* with an error
  naming the orphaned field, because core rejected every write to such
  a task. Its comment said the real bullet — "saving an unrelated
  field does not strip it" — could not be asserted. Once `46507e8`
  fixed that, the test failed on the assertion it had been forced to
  invert.
- **TSK-54 / XS-51** were reported as "not covered"; the review
  corrected that to **contradicted**, which is what produced the
  lookup fix.
- **The `ServerUnreachableBanner` unit test** required silence for a
  state that is exactly what a dead server produces.

**So when a core fix lands, re-run the tickets that worked around
it — and read any failure as a possible inversion before treating it
as a regression.** The tell is a comment in the test saying what it
could not assert.

Fixing one is not a rewrite: the case text already says what it should
assert. Delete the workaround, assert the bullet, and mutate the fix
to prove the test can still fail.

### TSK-20 (Duplicate) is declared, unbuilt, and not silently dropped

**Raised by the M2 gate at round 2 (F6), 2026-08-30. Ken's call.**

TSK-20 is a **blocker**, declared in M2.1's `Cases:` line, and there
is no Duplicate anywhere in the web client — no route, no control.
M2.1's run-log row lists what it closed and simply omits it.

**Core already has `duplicateTask`**, and the CLI and MCP both call
it. Only the web layer does not — the inverse of the usual gap here,
where core has a capability nobody uses.

Why this is a stop rather than a fix: the case has four bullets
including *"the app navigates to the new task"*, so it is a route, a
menu item, an optimistic-navigation path and its failure state — not
a wrapper. That is a ticket's worth of work, arriving after the ticket
that owed it has shipped.

**Options, none taken:**

1. Build it into M2.1 retroactively and re-gate M2.
2. Give it its own ticket before M3, since core is ready and the CLI
   shows the shape.
3. Record it as deferred with a named milestone.

What must not happen is the fourth option: leaving it declared,
unbuilt, and unmentioned. It was in that state for the whole of M2,
and only the gate's own probing found it — the coverage tool reported
it as untagged, which reads as a tagging gap rather than a missing
blocker.

**The general lesson**, and it is why this is written here rather than
in a ticket: *an untagged case and an unbuilt case look identical to
`cases:coverage`*. The tool cannot tell them apart, so a gate that
only reads its output will call a missing blocker a bookkeeping
problem. Round 2 caught it by reading the panel and probing the app.

### The stop gate

**Added 2026-08-29 on Ken's instruction**, after the run kept stopping
mid-ticket to report progress rather than to ask anything.

`.claude/hooks/stop-gate.sh` runs when a turn ends. It does not
re-derive the conditions below — it asks one question: **was a reason
declared?**

    echo "<reason>" > .claude/STOPPING

The file is consumed on read, so a reason authorises exactly one stop
and cannot be left behind to cover the next.

Two things pass without a declaration, and one of them is conditional:

- **Waiting on work that is advancing.** A running suite or agent is a
  legitimate reason to stop, because the model cannot do that work for
  it — but only while it is *moving*. The gate fingerprints the suite
  logs and process count each turn; if nothing has changed since the
  last turn, that is a **hang, not a wait**, and it says so. Ken's
  point: "the agent might be stuck too."
- **Nothing else.** Reporting a finished step, summarising, or handing
  back a status is stopping out of nowhere.

The gate cannot tell whether stopping is *right* — only whether it was
*declared*. That is the whole design. Deciding is the model's job;
this makes the decision explicit instead of implicit.

### The four stop conditions

Only these. Everything else continues.

**1. It changes scope.** A case needs a view, route, or feature no
ticket plans. The sprints overview and the Milestones view were these:
28 cases specifying screens the ticket list never had.

**2. It invents a requirement.** No case covers the behaviour, and
building it means authoring the spec. BLK-30's confirmation threshold
was this — "proportionate" with no number, and the number I picked was
mine, not the case's. An agent that may write the spec has no spec.

**3. It violates a principle or a recorded decision.** The ten
principles in [`ui-test-cases/README.md`](docs/dev/ui-test-cases/README.md)
(P1–P10) are the "is this in line with the rest of the app" test, and
they are already tagged per case. `decisions.md` sections 1–7 are the
other half. A decision needing a principle that does not yet exist
**is** an escalation.

**4. It is load-bearing.** Later work will build directly on top of
it, so being wrong means rework rather than a tweak.

Condition 4 is the judgment call and the one that matters. There is no
count. An earlier draft capped recorded decisions at three per ticket;
Ken replaced that with this, because the number was never the risk —
**stacking** was. Three contained decisions are fine. One foundational
one is not.

### What "load-bearing" means, concretely

Ask: **if this is wrong, what gets thrown away?**

| Answer | Do |
|---|---|
| This one behaviour, in one place | Decide. Record. Continue. |
| Every screen that follows this pattern | Stop. |
| A data shape, URL scheme, or storage format others will read | Stop. |
| A test's expectations, and nothing else | Decide. Record. Continue. |
| Whether a later ticket's cases even make sense | Stop. |

When genuinely unsure, decide — and say so in the record's **Why**.
An entry that admits it was a close call is more useful on review than
a confident one that was wrong.

### Recording a decision

**Numbers collide when agents work in parallel.** Two agents in
separate worktrees both wrote a "decision A4" on 2026-08-29, neither
able to see the other. Merging produced two entries with the same ID
and six stale cross-references.

So: an agent proposes its entry under a **placeholder** (`A?`) and
states what it decided; **the main session assigns the number** when
the work lands, because only it can see every branch. Renumbering
after the fact means chasing every `Decision A5` in a comment.


Every decision made under this rule goes in
[`decisions.md`](docs/dev/decisions.md) § 8, in the six-field format
that section specifies: situation, what had to be decided, options,
decided, why, **and how to revert**.

That last field is not bookkeeping. The whole arrangement — agent
decides, Ken reviews later — only works if reverting is cheap when he
disagrees. An entry without a revert path has taken a decision away
from him rather than deferring it.

**A contradiction between two cases is still a stop.** The docs are
the specification; an agent that may rewrite the spec to match its
code has no specification. State the two case IDs and what is
contradictory; do not adjudicate.

### Cases that cannot be satisfied yet

**Ken's standing rule, 2026-08-29.** An audit found ~25 existing cases
that fail as written — not because the case is wrong, but because the
API it assumes does not exist. The rule is that a case is never
quietly narrowed to fit the code.

**Never reword a case to match what is buildable.** That is an agent
editing the specification, and the whole arrangement rests on it not
doing that. If a case cannot be satisfied, the case is right and
something is missing.

Sort by what is actually missing, because the three differ by an order
of magnitude:

| Kind | Do |
|---|---|
| **Core has it; nothing wired it** | Build it. A case failing because two halves were never connected is not scope growth. |
| **Cross-cutting** — one fix unblocks a whole flow doc | Its own ticket, **early**, because everything downstream inherits it. |
| **A genuine feature** — it exists nowhere | **Stop.** This is scope (condition 1). |

Worked example, measured rather than assumed:

- **Wire-ups (7):** SPR-26 (core has `archived` and the CLI has
  `sprint archive`; only the route is missing), VUE-38
  (`unarchiveView` exists with no caller), PRU-33 (the web DELETE
  never passes `hard:true`), SET-43, LST-13 (the honest `total` is
  already returned, never rendered), REL-40, VUE-1/16.
- **Cross-cutting (1):** the error envelope. ERR-30, the whole of
  `flow-error-handling.md`, and LST-44/45 are one root cause — a DSL
  parse error losing its position hurts CLI and MCP identically.
- **Features (3):** milestone progress (exists nowhere), a
  query-validation endpoint (`validateQuery` is built and unwired, but
  its response shape is a core contract), avatar removal.

That turns "25 cases need a decision" into **three**.

**A worked instance, 2026-08-29.** TSK-12's fourth bullet — "fields
scoped to a task type appear only for tasks of that type" — needs a
scope field on `CustomFieldDef`. The schema is `.strict()` with
`key`, `label`, `type`, `multi`, `searchable`, `values` and nothing
else, so there is no task-type scope anywhere to render from.

The build agent **stopped rather than inventing one**, built the
bullet's other half (the visible set updates without a reload), and
marked the seam in `MetaPanel.tsx` as `scopedCustomFields()`. That is
condition 2 working as intended: a feature existing nowhere is scope,
and adding a field to a shared contract is Ken's call, not an
agent's.

#### M4.9 · MSL-35 needs a progress shape the server cannot produce

**A wire-up that is really a feature, so the case is left uncovered.**
MSL-35 wants a *per-row* progress error: the failing milestone's row
shows an error naming that milestone, with a retry, **while other
milestones' rows continue to render their own progress**.

Measured, not argued:

- `withProgress` (`apps/web/src/server/server.ts`) calls
  `milestoneProgress` **once for the whole list**, and core's
  `referenceProgress` does a single corpus scan by design. It succeeds
  for every milestone or throws for all of them.
- `handleListMilestones` has no catch, so a throw is a whole-response
  500.
- `withProgress` fills any id missing from the map with a zeroed
  entry, producing exactly the `0 / 0` the case forbids. Verified on a
  live server: every item in a `?progress=true` response carries a
  `progress` object; it is never `undefined`.

So there is no per-row failure on the wire to render. Satisfying the
case needs either a per-milestone progress endpoint or a
`progress | {error}` partial-success shape, plus removing the silent
zero fallback — a response-shape change to a route the CLI and MCP do
not share, but a **feature that exists nowhere**, which the table
above makes condition 1.

**The case is left uncovered and not reworded.** No test carries its
tag. M4.9 built and unit-tested the client half anyway
(`progressState(undefined)` → `kind: "unavailable"`, rendered by
`ProgressReadout` in place of the numbers rather than `0 / 0`); it is
unreachable from the current server. The UI spec covers the
whole-list failure — a named error state with a working retry, never
`0 / 0` — under a test that deliberately carries no tag.
`decisions.md` A90–A93 and `known-gaps.md` record it.

#### M4.8 · A11Y-2 has no target, and 25 more cases need what this repo cannot measure

**A11Y-2 — a genuine feature, so the run did not build it.** The case
needs `/` to focus "the filter/search input". The binding is built and
registered; the app's only global search box is `disabled` with
`title="Search arrives in a later milestone"`
(`shell/Header.tsx:102`). Grepping `TEMP-WEB-TICKETS.md` for "search"
finds no ticket that builds one. Per the table above this is condition
1 — a feature existing nowhere — so the case is **left uncovered and
not reworded**, and no test carries its tag. `decisions.md` A84 and
`known-gaps.md` record it.

**Twenty-five a11y cases need instruments this repo does not have.**
They fall into three kinds, and only the first is a scope question:

- **Needs a dependency (7):** A11Y-16 (a visible focus indicator on
  every stop, both themes), A11Y-30 (colour never the sole carrier),
  A11Y-40 (contrast ratios), A11Y-37 (`prefers-reduced-motion`),
  A11Y-38/39 (zoom to 200%, page and text-only), A11Y-19 (tab order
  matching *visual* order). These are computed-style, contrast and
  rendered-geometry questions. `@axe-core/playwright`, `axe-core` and
  `jest-axe` are all absent — verified against `package.json`,
  `apps/web/package.json` and `node_modules`, with `@playwright/test`
  as the positive control. **Adding a test dependency is a call that
  stops the run**, so none was added and none of these is tagged.
  Playwright can assert roles, names, focus and `aria-*`; it cannot
  audit contrast or run a ruleset.

- **Needs a real screen reader (4):** A11Y-51 (a long partial-result
  announcement "not truncated by a live region that cuts off long
  text"), A11Y-52 (the unreachable state "remains discoverable
  afterwards" to a user who was away), A11Y-49 (the crashed-migration
  screen read heading-by-heading), A11Y-42's announcement half. The
  flow doc says so itself in its preamble: verification "assumes a
  real screen reader … not an automated audit tool". The DOM contract
  under several of these *is* covered — `ui/Announcer.test.tsx`
  asserts atomicity and the no-backlog rule — but the cases as written
  are about what is spoken, and no test here can claim that.

- **Needs surfaces later tickets own (16):** A11Y-9/10/11 (full
  keyboard cycles through list → open → edit → save), A11Y-5, A11Y-12,
  A11Y-17, A11Y-18, A11Y-23, A11Y-28/29 (keyboard alternatives to drag
  on board and timeline — the *bindings* exist, `BoardCard.tsx:100`;
  the announcement and disk-check bullets do not), A11Y-36, A11Y-41,
  ERR-32 (an audit across every milestone's E2E suites, explicitly
  "re-run at each milestone review gate" — a process, not a test),
  ERR-44.

ERR-24 started in this list and was moved out: its last bullet
("nothing is left in `tasks/<id>/attachments/` — verify by listing the
directory") is server-side and was covered in
`server.attachments.test.ts`. The claim that it was unreachable did
not survive being checked, which is why it is called out here.

None of these was narrowed to fit. 38 of the ticket's 64 cases are
covered; the other 26 are listed above with what each actually needs.

#### M4.6 · ONB-18's two entry conditions are both unreachable from the wizard

**Measured 2026-09-01.**

ONB-18 (prefix collides with an existing project prefix) names its own
precondition: it is "only reachable when initializing into a directory
that already has a tracker, or when the wizard is reused for adding a
project". Neither state exists:

- **Initializing into an existing tracker** is what ONB-35 forbids.
  `AppBootstrap` renders the wizard only for `initState` `absent` or
  `empty`, and `/init` on a `ready` tracker redirects to `/list`
  (`RedirectFromInit`). A tracker with a project to collide with is
  `ready` by definition, so the wizard is not on screen.
- **The wizard reused for adding a project** did not happen. Adding a
  project is `settings/ProjectsPanel.tsx`, built in M4.3 with its own
  prefix field, its own `problems.prefix` validation and its own
  `data-testid="project-create-prefix-problem"` alert — a separate
  component, not this one.

So the collision check has nowhere to fire *in the init wizard*. The
case is not wrong and has not been reworded; it describes a wizard
that also creates projects into an existing tracker, which is not the
shape M4.6 was built to. If that reuse is ever built, ONB-18 attaches
to it.

**Not** recorded as a defect: `ProjectsPanel` already validates
prefixes on the path where a collision is actually possible.

#### M4.5 · VUE-22 needs `queries.yaml` to load per-entry, which is a core contract change

**Measured 2026-09-01, with a positive control.**

VUE-22 requires that a hand-edited saved view which no longer parses
is "flagged, not hidden": the sidebar still lists it marked broken,
clicking it shows the parse error, and **"other views and the rest of
the sidebar render normally"**.

Today one bad entry takes down every view. `parseQueriesConfig`
(`packages/core/src/config/queries.ts:38-49`) maps over the entries
and **throws** `QueriesConfigError` on the first unparseable query —
directly under a comment that says such queries "shouldn't crash the
rest of the load". The comment describes the intent; the code does the
opposite. `loadOptionalConfigs` calls it, `handleListTasks` calls
that, and nothing catches it, so `GET /api/tasks?view=<any>` becomes
the generic 500 — including for a healthy view sitting next to the
broken one.

**Reproduced**: a `queries.yaml` with `ok` (`status = backlog`) and
`broken` (`status = = done`) makes `GET /api/tasks?view=ok` return
500. Positive control: with the `broken` entry removed, the same
request returns 200.

**Why this stops rather than being built.** The fix is per-entry
tolerance on *load* while `saveQueriesConfig` stays strict — and
`parseQueriesConfig` is the same function both use
(`queries.ts:106` validates on save). Splitting them changes a core
contract shared by CLI, MCP and web, and decides what a partially
loadable config *is*. That is condition 2, not an agent's call.

`GET /api/views` already does the right thing at its own layer: it
returns 400 `config_invalid` with the loader's message, and
`SavedViewsPanel` renders it as a load failure naming the file
(VUE-36/XS-66). So the sidebar's *listing* half is solved; the task
route's is not.

The rest of M4.5 is built and tested. VUE-22 is the one case of the
22 with no implementation, and VUE-21 — which shares its symptom —
**was** buildable and is now wired (`onWarning` → a `warnings` field
on the tasks response).

#### M4.3 · The git reconciliation cases have no model to render

**Measured 2026-09-01, with a positive control. Full reasoning in
`decisions.md` A69.**

`local/reconcile.yaml` is a **crash sentinel, not a decision model**.
`ReconcileStateSchema` (`packages/contracts/src/state.ts:43-49`) is
`.strict()` with exactly four fields: `mode`, `base_commit`,
`remote_commit`, `started_at`. No per-task rows, no per-field values,
no chosen sides. `packages/core/src/state/reconcile.ts` exports only
load / save / clear / parse / serialize — there is **no function that
applies a reconciliation decision**. A grep for
`applyReconcil|resolveReconcil|reconcileDecision|keepLocal|keepRemote|
pickValue` across `packages/core/src`, `apps/cli/src`, `apps/web/src`
returns 0 hits; the same technique returns real hits for
`GitConflictError`, which is the positive control.

`GitConflictError` carries a flat `readonly string[]` of file
**paths**, not fields — and per `git-errors.test.ts:87-91`,
`config/workflow.yaml` is essentially the only path that still raises
it, since task frontmatter merges per field. The CLI has no reconcile
command by explicit design (`apps/cli/src/commands/git.ts:14-21`).

**26 cases cannot be satisfied**, and none of them is wrong — each
describes a real product requirement whose engine does not exist:

- **Conflict resolution UI (no data model):** GIT-5, GIT-6, GIT-7,
  GIT-11, GIT-12, GIT-13, GIT-14, GIT-16, GIT-17, GIT-26, GIT-31,
  GIT-32, GIT-37.
- **Rekey summary + confirm (`rekeyCollisions` is a pure function
  whose `RekeyOutcome` is flattened to `rekeyed: number` before it
  leaves `sync`):** GIT-8, GIT-9, GIT-19, GIT-33.
- **Publish/sync reporting at task-and-field granularity.**
  `SyncOutcome` reports **file counts** (`copied`/`merged`/`deleted`)
  and cannot distinguish created from updated — `plan.copies` is one
  bucket, and the per-path detail is discarded at
  `publish-sync.ts:1030`: GIT-15, GIT-21, GIT-23, GIT-34, GIT-35,
  GIT-36.
- **Filesystem-class detection for the advisory-lock warning.** It
  exists **nowhere** — `grep -rniE "icloud|dropbox|onedrive|statfs|
  nfs|smb|cifs|fstype"` over `packages` and `apps` returns 14 hits,
  **zero of them code**: two docstring lines in `state/lock.ts`, one
  architecture-doc line, and eight case specs. Positive control:
  the same grep for `advisory|lockfile|\.lock` returns
  `proper-lockfile` imports in `state/lock.ts`. Affects **GIT-22 and
  XS-50**.
- **Non-fast-forward vs auth distinction (GIT-29).** `gitErrorResponse`
  maps exactly two shapes — conflict → 409, everything else → 500 —
  and `PushResult.error` is an opaque string.

**Also unsatisfiable, unrelated to git:** **SET-29** ("checks stream in
individually"). `runDoctor` accumulates into a local array and returns
once; there is no callback, generator or async iterator, and no SSE
route anywhere in `apps/web/src`. Streaming needs work in three
layers (core signature, route, client) and is a feature, not a
wire-up.

#### M3.4 · NEW-20 and NEW-41 name states that cannot exist

**Both are measured, not inferred, and neither case is wrong** — each
describes a state the current schema makes unreachable. Recorded so the
next agent does not re-derive them. Full reasoning in `decisions.md`
A44 and A45.

- **NEW-20** — "a workspace default naming a nonexistent project
  degrades to the ask state". It cannot: `ProjectsConfigSchema`
  rejects a `default` that is not in the projects list at **parse
  time**, so `GET /api/projects` returns `400 config_invalid` and
  there is no project list to degrade *with*. Measured against a real
  tracker with `default: ghost`. The case's **third** bullet ("the
  config drift is surfaced somewhere actionable") is satisfied, and
  more loudly than the case expects. Its first two are unreachable.
  `resolveProjectChoice` already handles the fall-through if the
  schema is ever relaxed, and that path is unit-tested.

- **NEW-41** — "a modal opened while the tracker's schema is
  **outdated**". There is no outdated state: `CURRENT_SCHEMA_VERSION`
  is 1, and `readSchemaVersion` rejects anything below 1 as malformed,
  so `.schema-version = 0` reports `kind: "unknown"`, not `"outdated"`.
  The `outdated` branch in `diagnostics/info.ts` is unreachable at this
  version — core's own migrate test skips itself with "can't go below
  1" for the same reason. Verified against `future` (`.schema-version
  = 2`) instead, which goes through the identical server gate: every
  route 409s, the shell never mounts, and the modal cannot open. That
  is NEW-41's first branch, satisfied structurally.

**Not deferred work.** Neither needs building. NEW-20 needs a schema
decision that is Ken's, and NEW-41 becomes reachable on its own when
`CURRENT_SCHEMA_VERSION` moves past 1.

#### M3.3b · TML-26, 27, 30, 32 · the timeline has no virtualization

**Not a ruling — a build of its own, and it is named here so the next
agent does not re-derive it.** Four section-B cases each ask the
timeline to stay usable at scale, and each names a mechanism that does
not exist rather than a behaviour that is subtly wrong:

- **TML-26** — 3,000 dated tasks: rows must virtualize vertically.
  `buildLayout` places every row and `TimelineChart` renders every one.
  Measured: the rendered bar count equals the task count.
- **TML-27** — 40 assignee bands with **sticky** band headers. The
  header is `absolute`, so it scrolls away inside a long band.
- **TML-30** — 60 overlapping bars: each already gets its own row (that
  half holds), but the vertical extent is not windowed.
- **TML-32** — 50 outgoing arrows, with hovering the source bar
  highlighting its arrows. No hover-highlight behaviour exists.

**TML-21 is tagged and passing, but honestly partial**, and it belongs
in the same paragraph: its responsiveness, its bar width (>1,000,000px
rather than an overflow artefact) and its far-end date correctness are
asserted and hold. Its *second* bullet — "roughly 47,000 day columns
are not all rendered at once — the header and the grid virtualize" —
is unmet for the same reason as the four above. The test asserts only
what was measured.

**Why it was not done inside M3.3b.** It is a windowing layer in two
axes, and the arrows make it more than a `react-window` drop-in: they
are positioned from `layout.centreById` *before* paint, precisely so
they do not lag a frame behind the bars. A windowed layout has to keep
answering `centreById` for rows that are not mounted, or the arrows
anchor to nothing. Doing half of that would produce a view whose band
counts and arrow anchors disagree with what is on screen — worse than
the honest non-virtualized version.

Logged in `known-gaps.md` with the reproduction and the fix sketched.

#### M3.2 · BRD-12 · core and the board disagree on what a column is

**Cross-cutting, and it needs a ruling — not a build-agent decision.**

BRD-12 requires reordering *inside* a column that collapses several
statuses: a `blocked` card dragged above an `in_progress` card in the
same `In flight` column writes **only** `board_rank`. The client half
works and is asserted — exactly one request, no `status` key, the card
stays `blocked` — but core refuses the write:

```
$ loctt board-rerank C2 --before C1
Error: cannot rank before 'C1': it is in status 'in_progress' but C2 is
in 'blocked'. Board rank is per-column — move the task to that status
first, or pick an anchor in its own column.
```

`reorderBoardRank` derives peers from `moved.frontmatter.status` and
its `anchorRank` throws on a cross-status anchor. That is deliberate —
it is the SPR-C2 fix, with two tests in `rank/reorder.test.ts`
asserting the refusal, on the reasoning that a rank interpolated
between tasks the user cannot see next to the moved one is
meaningless.

But `workflow.boards.columns[].statuses` (BRD-2, BRD-12, BRD-13) makes
a column a **set** of statuses, and the board sorts on that basis. So
the board can *render* an order — `in_progress` and `blocked` cards
interleaved by rank — that core will not let a user *produce*.

**Why it was not decided here.** The fix is to scope rank to the
configured board column rather than to one status. That changes what
`loctt board-rerank` and the MCP `reorder_board` tool accept, requires
rewriting the two SPR-C2 tests that assert the current refusal, and
needs a ruling on what board rank means when there is no `boards`
block and "column" and "status" genuinely coincide. Contradicting a
recorded core decision is condition 3, so it is reported.

The spec is `test.fixme`, not skipped: it runs, is expected to fail,
and starts passing loudly the moment core is fixed. Detail in
`docs/dev/known-gaps.md`.

#### M3.1 · three cases are covered in part, by construction

**BRD-45's 1:1 fallback cannot happen, and Ken ruled it stays that
way.** The case's second bullet offers the user "remove the `boards`
block to fall back to 1:1 columns" as a *fix*, which is built and
true. But its own framing implies the board could fall back on its
own. It cannot: `BoardsConfigSchema` rejects a duplicated status at
parse time, so `loadWorkflowConfig` throws and **every** read fails —
measured, `/api/workflow` and `/api/tasks` both return 400
`config_invalid`. There is no parsed config to fall back *with*.

Ken ruled (2026-08-29): validation stays strict, and the web renders
the refusal as BRD-45's designed state rather than relaxing the schema
to make a literal fallback reachable. `ConfigErrorState.tsx` names the
file, the offending column index and the duplicated status key, and
tells the user both fixes. The other bullets — an explicit
configuration-error state, no white pane, no *silent* 1:1 fallback —
all hold. Only "falls back to 1:1 columns" as a runtime behaviour
does not, and it is unreachable by design.

**BRD-21 is covered for the three bullets a static board owns.** The
header count reading the true total, the column scrolling
independently of its neighbours, and cards rendering far down the
range are built and asserted (`flow-board.spec.ts` BRD-21). The
remaining two bullets — dragging from a virtualized row, and
auto-scroll at a column edge — are drag behaviour and belong to M3.2
with the rest of BRD-9..13 / 25..38.

Note that the count bullet was a **real defect found by building the
test**: the board initially rendered a 900-task column under a header
reading `200`, the page size, which is exactly what the bullet
forbids. The board now exhausts the paged feed itself
(`BoardView.tsx`).

**MSL-20's `+N` reveal is not built, and needs a component that does
not exist.** The case wants the overflow affordance to "reveal the
remaining labels on click/hover" with "each remaining label
individually clickable to filter". Today `LabelsCell` renders `+N` as
a `<span>` carrying a `title` — a static tooltip, not a hover-card:
the hidden labels are named in the tooltip text but none of them is
clickable.

The rest of MSL-20 holds and is asserted: pills overflow to `+N`
rather than widening the card, the due date stays on screen, row
height stays bounded, and each *rendered* pill filters on click. The
reveal itself needs a new interactive popover component, shared with
the list row (`LabelsCell` serves both surfaces), and no case in M3.1
authorises building one. **Not built, deliberately** — condition 2.

#### M2.4b · CMT-18 is a whole surface nothing has built

**CMT-18** — *"Comments and Activity are separate, addressable
sections"* — asks for three things: both reachable without a full page
load, **whichever is a tab records itself in the URL** so a link opens
on the activity tab, and switching between them does not refetch the
whole task.

The first and third hold today and are not what is missing: both
sections are on one task page, rendered from queries that are already
loaded, and neither refetches `["task", ref]` when the other is
touched.

The second needs a **tab shell that does not exist**. `TaskDetail`
stacks Description, Related, Attachments, Activity and Comments as
plain `<Section>` headings down one column; there is no tab component
anywhere in `apps/web/src/client`, and `/tasks/$key` declares no search
schema, so there is nothing for a tab to write itself into.

**M2.4b did not build one, deliberately.** Deciding that the task page
becomes tabbed is a change to the shape of a page four tickets have
already built into (M2.1's shell, M2.3's body editor, M2.4a's
comments, and M2.5's relationships and attachments still to come), and
it would move sections those tickets placed. That is the page's
layout, not this ticket's rendering — and the case is written
conditionally ("**whichever** is a tab"), which reads as permitting the
stacked layout while requiring addressability *if* tabs are chosen.

Not narrowed, not claimed. It wants a decision on whether the task
detail page is tabbed at all, which belongs with whoever owns the page
rather than with the activity feed.

#### M2.5a · REL-33's refusal has no guard to refuse with

**REL-33's second bullet** — *"A drag attempt against a stale page is
refused with a message that the kind is no longer ranked"* — needs a
check that does not exist at any layer.

`reorderRelationship` (`packages/core/src/rank/reorder.ts`) never loads
the workflow config and never reads `ranked`. Measured against a live
server: switch `blocks` to `ranked: false` in `workflow.yaml`, then
`POST /api/tasks/T-1/relationships/blocks/T-3/rerank {"before":"T-2"}`
answers **200 `{"rank":"f","rebalanced":false}`** and writes the rank.

**The other two bullets are built and tested.** The panel's drag
handles come from `group.ranked`, which is read from the live config,
so they disappear on the next refresh; and the existing `rank` values
are untouched by the config change. Both are asserted in
`tests/ui/flow-relationships.spec.ts`'s REL-33 spec, with the
handles-present case asserted first so the absence is a change rather
than a constant.

**Not built, deliberately.** Adding the guard means `reorder.ts` starts
loading and enforcing workflow config — a *new refusal* on a shared
core path that the CLI's `loctt rerank` and any future MCP tool
inherit. That is a behaviour change to a contract three surfaces use,
raised by a case rather than by a defect, so it is condition 1 rather
than something to decide mid-ticket.

**Where it belongs:** `reorderRelationship` should take the
`workflowConfig` its sibling `linkTask` already takes, and throw a
`ReorderError` naming the kind when the definition is absent or
`ranked` is not true. The web route already maps `ReorderError` to a
400 with `field: "relationships"`, which the panel renders at the
group — so only core and the route's `loadWorkflowConfig` call are
missing.

#### M2.1 · bullets deferred to a later ticket in the same flow

Recorded rather than narrowed. Each is a bullet of a case whose other
bullets M2.1 does satisfy; the missing half needs a surface a later
M2 ticket builds. None is a missing API.

- **XS-58, bullet 2** — *"Any pending unsaved body text is preserved
  somewhere the user can copy it out before navigating away."* M2.1's
  body is read-only; there is no editor and therefore no unsaved
  text to preserve. **Owed by M2.3** (body editor), which introduces
  the state this bullet protects.
- **TSK-54 and XS-51** — a corrupt `task.md` reported with its path
  and an actionable parse error. `TaskDetail` routes a non-404 error
  to `ErrorState`, which renders the server's envelope including
  `detail` and any `recovery`, so the *client* half is in place. What
  is unverified is what `GET /api/tasks/:ref` actually puts in that
  envelope for an unparseable file — whether it names the path under
  `.loctt/tasks/<id>/` and which field failed. That is a server
  question and a server test; M2.1 neither measured nor changed it,
  so it is not claimed.
- **TSK-19's Duplicate, and TSK-43/TSK-20/TSK-21** — listed on the
  M2.1 ticket but absent from the 18-case brief this ticket was
  built against. Duplicate (CW-3) is not implemented: no case in the
  brief covers it, and building it from the ticket's one-word bullet
  would be authoring the requirement.

#### M2.2a · bullets that need something that does not exist

Recorded rather than narrowed, per Ken's standing rule.

- **TSK-12, bullet 4** — *"Fields scoped to a task type appear only
  for tasks of that type, and changing the type updates the visible
  field set without a reload."* **`CustomFieldDef` has no task-type
  scope.** Its schema
  (`packages/contracts/src/workflow.ts`, `CustomFieldDefSchema`) is
  `key`, `label`, `type`, `multi`, `searchable`, `values` — nothing
  names a task type, so every declared field applies to every task and
  there is no scoping to render. This is a **feature that exists
  nowhere**: adding it is a contract change with CLI, MCP and
  settings-UI consequences, which is condition 1. The seam is marked
  in the code (`scopedCustomFields()` in `MetaPanel.tsx`) so the
  eventual change lands in one place. The bullet's other half — that
  the visible set updates without a reload — is already satisfied,
  since the set is derived from `fm.task_type` on every render.
- **TSK-30 / TSK-31 / XS-26, the "unrelated edit" half** — blocked by
  a **core defect**, not a missing feature: `setField` validates the
  whole task, so a stale custom-field value makes every subsequent
  write to that task fail from every surface. Reproduced on the CLI.
  Recorded in `known-gaps.md` ("A stale custom-field value blocks
  every subsequent write to that task") with where the fix belongs.
  The UI half of each case — rendering the stale value flagged rather
  than blank — is built and tested.

#### M2.4a · one bullet that needs something that does not exist

Recorded rather than narrowed, per Ken's standing rule.

- **CMT-10, bullet 4** — *"The 'Mentions me' saved filter still
  matches the comment for that user after the rename."* **There is no
  way to query on mentions at all.** Measured: the query DSL has no
  `mentions` field (nothing in `packages/core/src/query/` references
  one), and there is no comment-scan endpoint on the web server. The
  "Mentions me" built-in in `apps/web/src/client/sidebar/
  builtinFilters.ts` already resolves to `null` for exactly this
  reason, with a comment saying it "needs a comment-scan endpoint that
  lands with the comments feature".

  This is a **feature that exists nowhere**, which is condition 1:
  matching tasks by who is mentioned in their comments means indexing
  every `_comments.yaml` at query time, and that is a core capability
  with CLI and MCP consequences, not a web-client detail.

  **The bullet's other three are satisfied and tested** — the stored
  `mentions` array is unchanged by a rename, the chip reads the current
  name on the next render, and the stored body still holds the old
  token. Those are the mechanism the fourth bullet would be built on,
  so nothing here has to be undone when it lands.

### Which layer — and core is not done until all three have it

**Ken's rule, 2026-08-29.** Decide the layer *before* proposing the
fix, and then honour what that choice costs:

> If it goes in core, it ships to **CLI and MCP too**, not just the
> web app.

Otherwise core grows a capability one surface uses, which is exactly
the drift that putting it in core was meant to prevent. Measured on
this repo: `unarchiveView` is exported from core and called by
**nothing** — not CLI, not MCP, not web. A core function with no
consumers is not shared logic; it is dead code with a good address.

The test for core: **would two surfaces have to answer the same
question?** If yes it belongs in core, and all three get it. If only
the web app could ever ask, it belongs in `apps/web`.

A ticket that adds a core capability owes three things, and is not
complete with one:

| | Owes |
|---|---|
| `packages/core` | the logic, and its tests |
| `apps/cli` | a command or flag, and the reference doc updated |
| `apps/mcp` | a tool, and the reference doc updated |

If a surface genuinely should *not* expose it, say so in the ticket
and why. Silence is not a decision.

**Grep core before building anything.** Ten user-facing capabilities
sit in `packages/core` with **zero callers on any surface** —
`unarchiveView`, `archiveView`, `validateQuery`, `bodyToken`,
`computeBurndown`, `computeWorkflowKeyUsage`, `extractMentions`,
`removeRecent`, `findMigrationPath`, `backupLocttDir`. Measured
2026-08-29.

They are not dead code. Several are specified by cases a later ticket
owes — `computeBurndown` by `flow-sprints.md`, `extractMentions` by
the mention cases — so they were built *ahead* of their consumers and
then forgotten.

Four were found the hard way in one session, each moments before being
rebuilt from scratch or reported as a missing feature:

| | found while |
|---|---|
| `unarchiveView` | auditing the failing cases |
| `validateQuery` | the same |
| `bodyToken` | probing M2.3 — the ticket said *build the precondition*; core already had it, tested, with the right error message |
| `bulk_op_id` in history | probing M2.4 — reported in the response, never written to disk |

**So step 2 of the subsection loop is not optional, and it starts in
core.** Before building a capability, grep `packages/core/src/index.ts`
for it. The cost of not looking is building twice; the cost of looking
is one grep.

**Check before claiming something does not exist.** The audit said
milestone progress "does not exist anywhere in `packages` or `apps`",
and that was repeated twice before anyone looked. It exists:
`computeProgress` at `packages/core/src/task/progress.ts:45`, with
`loctt milestone list --progress` in the CLI and a milestone tool in
MCP. The only gap was the web view, which is M4 work. A "build from
scratch" estimate was nearly given for something already built on two
surfaces.

### When a gate will not pass

Rounds 1, 3 and 5 of M1's gate each failed on defects introduced by
the *previous* round's fixes. So the escalation is by round, not by
finding:

| Round | Who |
|---|---|
| 1–2 | Orchestrator dispatches fixes normally |
| **3+** | **A Fable agent investigates** — not to fix, but to find what the rounds are missing. It recommends; a cheaper agent implements. |
| Fable also stuck | Ken |

This is not a guess. A Fable agent found the paused query three
rounds of Opus had misdiagnosed as a predicate; another found
`fetchState` un-saying a settled error, the single trap behind four
`AppBootstrap` bugs diagnosed as unrelated. The pattern is
**investigate with Fable, implement with Opus**.

**A claim about mechanism needs a measurement, not an argument.** This
repo has produced several confident, wrong mechanism claims — in gate
reports and in my own commits. If you assert *why* something happens,
show the trace, the request log, or the experiment. Three agents
reasoning from the same priors will agree with each other and still be
wrong.

**Everything else continues:**

| Situation | Action |
|---|---|
| Gate finds a defect | Fix, re-run the failing tests plus the ones around what changed, re-gate |
| **A fix fails twice** | Stop fixing. The model of the failure is wrong, not the fix. Capture the actual state at the failure and build a reproduction that runs in seconds before attempting a third time |
| **A gate reproduces what a spec cannot** | That is an environment difference. Diff the environments before writing another spec — the gate's browser and the test harness disagree about something, and that something is usually the bug |
| A defect sits in a ticket already marked ✅ | Fix it anyway. A ✅ that predates its cases records "the bullets were built", not "the cases pass" |
| The gate finds behaviour **no case covers** | Record it as a proposed case; do **not** build it. Deciding what it should do is writing spec, which is the one thing an agent may not do |
| A case's premise is stale | Test the correct behaviour, note it |
| A green test asserts a bug | Rewrite it, **say so in the commit** |
| Two equivalent implementations | Pick one, note why |
| A case needs behaviour built later | Record against the later ticket |
| A suite is flaky | Prove it against a clean tree before saying "pre-existing" |

On a stop: write it in the run log, mark the section ⛔, and stop
cleanly. No half-committed work.

---

## The run log

Progress lives in [`TEMP-BUILD-PLAN.md`](TEMP-BUILD-PLAN.md)'s Status
table — one place, already the first thing an agent reads.

Updated **after every subsection commit**, not at section end. A
compaction between two commits must not lose where the run is.

Each line records: ticket, subsection, commit SHA, cases closed, and
anything the next agent would otherwise have to re-derive.

> A fact that lives only in a session's context is lost at the next
> compaction, and the agent after that will re-derive it — differently.

---

## Sections

23 tickets. Subsections are chosen per ticket at step 1; M1.4's are
fixed here because they were sized already.

| Section | Subsections |
|---|---|
| **M1.4** | 1 · Set assignee/milestone/sprint pickers (BLK-7, 8) |
| | 2 · Move to project (BLK-9, 26) |
| | 3 · Archive undo — removes the typed confirm (BLK-10) |
| | 4 · Concurrency + scale (BLK-22, 23, 24, 34, 41, 42) |
| | 5 · The remaining BLK majors and minors |
| **🚦 M1** | Section gate over the whole milestone, not just M1.4 |
| **M2.1–M2.5** | Split at step 1 |
| **🚦 M2** | |
| **M3.1–M3.5** | Split at step 1 |
| **🚦 M3** | |
| **M4.1–M4.9** | Split at step 1 |
| **🚦 M4** | v1 |

A milestone gate covers the milestone, not the last ticket in it. M1's
gate walks the shell and list built in M1.1–M1.3 as well.

**Expect M1's gate report to be long.** M1.1–M1.3 are marked ✅ but sit
at 0/75, 10/67 and 3/44 cases covered. Those ticks were awarded before
any ticket declared its cases, so they record "the bullets were built",
not "the cases are verified" — both readings were legitimate at the
time and they are not interchangeable now. The gate is the first thing
to walk that code against its cases, so findings there are expected
rather than a surprise, and they are M1.4-adjacent work: fixed and
re-gated under the normal rule, not escalated.

**One consequence worth stating.** If the gate finds enough in
M1.1–M1.3 to constitute a ticket's worth of work, that is a finding
about the ✅ marks, not a reason to halt. Record it, fix it, and note in
the run log that the marks were re-earned rather than assumed.

---

## Known state at the start

- **`tests/ui/flow-list.spec.ts` BLK-40 fails.** Pre-existing, and a real
  defect: `updated_at` is in `USER_IMMUTABLE_FIELDS`, so the generic
  immutable guard at `update.ts:528` catches it before the message
  explaining *why* at `update.ts:535`, which is unreachable on every
  path. BLK-40 requires the why. `completed_date` explains itself;
  `updated_at` does not. Fix in M1.4 subsection 5.
- 34 of 35 UI specs pass. Coverage 111/937.
- Everything else green as of `f7ebbdf`.
