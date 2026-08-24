# The Phase 5 run workflow

How the UI build runs unsupervised: who does what, what splits into
what, and the two things that stop the run.

Decided with Ken 2026-08-24. This governs the *run*.
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

### Why the main session builds rather than delegating

A build agent that writes the requirement, the test and the
implementation has no external check on any of the three — the failure
this repo already produced fourteen times. The main session is not
immune to that, but it carries the case docs, the invariants and the
decision history, and it is the thing that gets reviewed by someone
fresh at every subsection boundary.

Delegation is used where it *adds* an independent view: review and
gating. Not where it only adds a second unchecked author.

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

Two things. Everything else, I fix and continue.

**1. A design decision that is genuinely Ken's.** Not "which of two
equivalent shapes" — that is mine. Genuinely his means: it changes what
the product does, it is not derivable from the cases, and guessing wrong
means rework rather than a tweak. V11 and V12 were these.

**2. A contradiction between two cases.** The docs are the
specification. An agent that may rewrite the spec to match its code has
no specification. State the two case IDs and what is contradictory; do
not adjudicate.

**Everything else continues:**

| Situation | Action |
|---|---|
| Gate finds a defect | Fix, re-gate |
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
