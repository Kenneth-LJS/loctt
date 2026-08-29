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
