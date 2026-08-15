# The autonomous build plan

How LocTT gets to v1 with an agent running unsupervised.

This sits above [`build-loop.md`](build-loop.md), which governs a single
ticket. This governs the phases, their order, and what each is allowed to
decide on its own.

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
[`TEMP-WEB-TICKETS.md`](../../TEMP-WEB-TICKETS.md), e.g. `M2.1 · Task
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
| 1 · Partition | ⛔ | Partition **done** — all 21 tickets carry a `Cases:` line, gate passes. Halted on what it exposed: 28 cases assert two views no ticket builds. See *Blocker* below. |
| 2 · Measure | ⬜ | Not started. Not blocked by Phase 1 — could run first if the blocker takes time to resolve. |
| 3 · Surface gaps | ⬜ | 68 cases outstanding |
| 4 · Structural audit | ⬜ | |
| 5 · UI build | ⬜ | M1.4 is 🔵 from earlier work, predating this plan |

### ⛔ Blocker — two specified views have no ticket

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

**This is a scope decision, and the plan reserves it.** The options are to
add tickets for the two views, fold them into M4.7/M4.3, or accept that 28
cases ship unverifiable. An agent may not choose among those.

The other four unplaceable cases:

- **ERR-3, ERR-4** (M1, blockers) — need an in-flight single-field write
  whose outcome is unknown. No M1 ticket has an editable field; task
  detail is M2.
- **ERR-23** (M2) — needs the create modal's partial-failure path (M3.4).
- **PRU-4** (M1) — asserts create-modal defaults (pre-select, key preview,
  submit). M1.1 ships that button as an explicit stub.

These four are milestone-tag problems rather than missing tickets: the
behaviour is ticketed, just later than the case's tag implies.

**As of 2026-08-15**, before any phase has run:

- **Case coverage: 46 / 937** tagged, by 84 `@verifies` tags.
- **Tickets:** 3 ✅ (M1.1, M1.2, M1.3) · 1 🔵 (M1.4) · 17 ⬜.
- **Suites, all green:** 1,894 unit · 193 integration · 20 e2e · 35
  Playwright · 15 LLM scenarios.
- **The 🚦 Milestone 1 review gate has not been run.**

Nothing in this plan has been executed. The only change made when it was
written was creating this file.

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
```

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
[`cli/reference.md`](../user/cli/reference.md) — 49 headed sections, one
per command. The MCP's is
[`mcp/reference.md`](../user/mcp/reference.md) — 75 sections, one per
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
[`invariants.md`](invariants.md), [`decisions.md`](decisions.md), and a
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

Per [`build-loop.md`](build-loop.md), M1.4 → M4.8, with:

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

## Residual risk

Phase 1 moves case selection out of build time and a second agent reviews
the split, but both the partition and its review are agent work. The
completeness gate is mechanical; the judgement that a case sits with the
right ticket is not externally checked.

What holds is that the **cases themselves** are not agent-authored. They
were written before the code, and no agent may edit a flow doc. An agent
can misplace a requirement. It cannot invent or weaken one.
