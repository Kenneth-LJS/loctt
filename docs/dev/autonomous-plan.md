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
| 1 · Partition | ✅ | All 21 tickets carry a `Cases:` line; gate passes. The 28 cases asserting two unticketed views are **resolved as a ticket gap**, not a scope cut — see *Blocker, resolved*. |
| 2 · Measure | ✅ | Measured (CLI 17/49, MCP 26/75) and the blocker it raised is **cleared**: both reference docs corrected to the shipped API, every example executed. See *Blocker 2, resolved*. |
| 3 · Surface gaps | 🔵 | **23 of 68 closed — every blocker.** Surface coverage 46 → 66. Remaining: 29 major, 16 minor. See *Phase 3 log*. |
| 4 · Structural audit | 🔵 | Reading **done**: 8 slices, ~18,700 lines, **124 findings** in [`audit-findings.md`](audit-findings.md). **Group A (silent wrong answers) is fixed** — 9 of 9, each with a test shown to fail first and killed by mutation. Groups B–G outstanding. |
| 5 · UI build | ⬜ | M1.4 is 🔵 from earlier work, predating this plan |

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

**Fifteen of the twenty-three were live defects.** Two were stale premises, two
were correct-but-unasserted, and the rest were partial.

**Five tests were found asserting a bug** and rewritten, each named in
its commit: the `--hard` trio, `comment-delete` with no confirmation,
`assignProvisionalPrefixes` ids that sorted opposite to their claim,
"publish exits 0" on a failed push, and a fixture referencing a
milestone that never existed.

## Residual risk

Phase 1 moves case selection out of build time and a second agent reviews
the split, but both the partition and its review are agent work. The
completeness gate is mechanical; the judgement that a case sits with the
right ticket is not externally checked.

What holds is that the **cases themselves** are not agent-authored. They
were written before the code, and no agent may edit a flow doc. An agent
can misplace a requirement. It cannot invent or weaken one.
