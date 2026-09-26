# The build loop

How a build ticket gets built, verified and closed — by an agent,
without a human in the middle.

The design constraint is that **the agent never decides whether it is
done.** Every gate below is a command that exits non-zero. An agent can
be wrong about whether it satisfied a case; it cannot be wrong about
whether `npm run cases:coverage -- --require …` exited 0.

## Why the gates exist

The 2026-08-14 session found fourteen tests that encoded a bug as
intended behaviour — present, passing, asserting what the code produced
rather than what the case required. That is the failure mode an agent
writing both implementation and tests reproduces by construction.

Three defences, in order of how much they carry:

1. **The case doc precedes the test.** The acceptance criteria were
   written before the code and are not editable as part of building the
   ticket. An agent that finds a case inconvenient must escalate, not
   rewrite.
2. **Case IDs are checkable.** A test claims cases by ID; a fabricated ID
   fails the build. The agent cannot invent a requirement it then
   satisfies.
3. **Every new test must be shown to fail.** Not just the Playwright
   specs — unit tests too. Break the behaviour the test covers, watch
   that specific test go red, restore. A test that still passes with the
   behaviour deleted asserts nothing, and green is exactly how it hides.

   This is not hypothetical. In one session it caught an unmount test
   asserting `dom.isConnected === false` — which React makes true whether
   or not the cleanup ran — and a cursor test whose stated subject was a
   guard it never reached. Both were written by an agent that believed
   they worked, and both passed.

   Where a branch genuinely cannot be reached from a test, say so in the
   comment rather than writing a test that implies coverage it does not
   have.

4. **Extending code someone else tested? Mutate their tests too.** Rule
   3 covers the tests you write. It does not catch a test file that
   quietly stopped covering its subject when the code beneath it grew.

   `diagnostics/integrity.test.ts` was written when the scan checked
   comments. History scanning was added beside it later and the test
   file was never extended — so `doctor`'s entire history-reporting path
   could be deleted with all nine tests still green. Nobody wrote a bad
   test; the code outgrew a good one.

   The check is cheap: after adding a case to an existing scan, switch
   loop or handler, delete your new branch and run that file's tests. If
   they pass, the coverage you assumed is not there.

5. **A test that must be edited to make a fix pass was asserting the
   bug.** If a green test goes red when you fix the behaviour it covers,
   it was encoding the old, wrong behaviour — say so in the commit. This
   is the failure the other rules miss: they catch a test that asserts
   *nothing* (vacuity is hygiene), not one whose expectation is simply
   *wrong*. `autoClearTimelineDependency` silently deleted a user's
   config key and two green tests asserted `toBeUndefined()` on exactly
   that deletion; the fix had to invert them.

6. **A test written around a live defect inverts when the defect is
   fixed.** Such a test asserts the reachable (wrong) half with a comment
   saying why the real behaviour can't be tested yet; once a core fix
   lands it fails like a regression. When a core fix lands, re-run the
   tickets that worked around it and read a failure-with-a-caveat-comment
   as a probable inversion first, not a new bug.

## Making a test actually assert its subject

A test can be green and prove nothing. The recurring shapes:

- **Assert the far end — disk, file, the request body — not what's on
  screen.** A screen assertion passes whether or not the value is
  correct. The far end is insufficient only when something downstream
  repairs the mistake before it lands (a client sending a sprint *name*
  where the server re-resolves it to an id writes the right file for the
  wrong reason); assert the request payload too when a repair is
  possible.
- **Behaviour that lives only in a CSS class, or in no attribute at all,
  is unassertable** — the test degrades to asserting whatever it can
  reach and stays green when the behaviour is deleted. Give the
  behaviour an observable hook (a `data-*` attribute) and assert that.
- **Separate arithmetic from React.** Geometry, layout and rank math
  belong in pure functions over inclusive spans, inverse pairs and
  DST / leap-year boundaries, unit-tested directly. A UI test asserting
  "a bar is visible" passes whether or not the geometry is right; a
  `Math.floor`→`Math.round` slip reddens a geometry unit test that no
  rendering test can catch.
- **When two tests each catch a different half of a behaviour, keep
  both.** Atomicity has two independent observables — one client→server
  request *and* one shared disk timestamp; splitting a write into two
  sequential server calls reddens the disk-trace test but not the
  request-count test.
- **Seed a fixture that can discriminate.** A single-item corpus cannot
  tell a working filter from one that returns everything; a
  `!= null`-style filter needs 1-matching, 2-not to expose the bug.
- **Pin a differing environment value for any test about which env value
  the code reads.** Harnesses inherit the host timezone/locale; if it
  equals the workspace's, the lookup can be deleted and the test stays
  green. Pin the browser's zone far from the workspace's.
- **A cross-cutting sweep must mutate every test in a group, not
  sample.** Sampling reports "zero vacuous" while a systematic per-case
  mutation pass finds the gaps: a body-wide regex matching the wrong
  element, an assertion satisfied by a near-identical branch, an absence
  assertion trivially true when the app says nothing, a picker that
  hides the element regardless of the logic under test.

**A mutation that does not compile is not a mutation.** Removing a line
often orphans a variable (`TS6133`) so the "mutation" never ran and the
green is meaningless; a `sed`/`perl` mutation can silently fail to match
and leave the code intact. Verify the build and read the diff before
trusting a red-proof.

**Repo-specific fixture traps** (a wrong fixture is a passing test, not a
failing one): `makeTasks` passes no workflow config, so tasks start
statusless; `createTask` needs a project id; `queries.yaml` entries need
a ULID `id`; `state.yaml` keys counters by ULID, not prefix; an empty
directory can be renamed over on macOS, so a "failure" fixture never
fails; every git test runs inside LocTT's own repo unless it uses
`mkdtemp(tmpdir())`.

## Rebuild before you red-proof — the stale-`dist` trap

The tests that drive a real binary run against built output, not source,
so a break you make in a `.ts` reaches them only after a rebuild. A
red-proof that "passes" (shows no failure) against a stale bundle reads
as "the test is vacuous" when in fact the mutation never loaded.

- **UI specs run against `apps/cli/dist`.** The Playwright fixture
  (`tests/ui/fixtures/server-harness.ts`) boots the *built* `loctt ui`,
  which serves the *built* client. The CLI bundles `@loctt/web` /
  `@loctt/core` / `@loctt/mcp` from *source* (tsup `noExternal` + an
  alias to `../web/src/...`), and tsup's incremental cache can serve a
  stale bundle even after `npm run build --workspace apps/cli`. Before
  a UI red-proof, `rm -rf apps/cli/dist`, rebuild web+cli, and confirm
  the break is actually in `apps/cli/dist/index.js` (grep it).
- **MCP integration tests spawn `apps/cli/dist/index.js mcp`**, not
  `apps/mcp/dist` — the stdio adapter launches the CLI binary, which
  embeds the MCP tools, and MCP bundles to a single `dist/index.js`
  (tsup), so a per-file `dist/tools/*.js` you `sed` does not exist.
  Rebuild the CLI for an MCP change to take effect.
- **The same stale `dist` hides a real regression, not just a vacuous
  red-proof.** A behaviour-changing core commit can leave a *green* UI
  spec asserting the pre-change contract, because the spec booted the
  stale bundle. After any change to code a UI spec exercises, rebuild and
  re-run the affected specs — a still-green suite over a stale bundle is
  not evidence. A green such test that must be rewritten to the new
  behaviour was asserting the bug (see rule 5 above).

## Verification discipline

A report names findings; it does not prove them. This applies to your
own claims, another agent's, and every decision record.

- **Verify a builder's report by your own mutation, in the right tree.**
  A shipped "write-guard" test can be vacuous — green with the guard
  disabled — and reverting a "fixed" delete can leave the whole suite
  green because nothing ever covered it.
- **Probe the built binary before writing anything — roughly a third of
  "defects" aren't.** Case titles and briefs go stale as code moves
  under them. Grep for callers and run the command before building a
  "missing" capability.
- **A claim about mechanism needs a measurement, not an argument.**
  Three agents reasoning from the same priors agree with each other and
  are still wrong. Show the trace, the request log, the experiment. Use
  a positive control: grep for the thing you claim is absent *and* for a
  similar thing you know is present; if the control also returns zero,
  your grep is wrong, not the code. State a conclusion only as wide as
  the measurement.
- **A decision record is the one artefact nothing tests — treat it as a
  claim and re-measure before relying on it.** A record saying "the
  modal cannot open" or "the notice names the field" is a claim; measure
  before building on it.
- **A green typecheck / lint / build can be lying — verify the command
  did what you think.** `npx tsc --noEmit -p apps/web` typechecks
  nothing and always exits 0 (solution-style tsconfig with
  `"files": []`); use `npm run typecheck`. `npm run test` prints
  `Tests N passed` directly above `FAIL` lines — grep for `FAIL`. A lint
  V8-OOM crash exits in a way that `grep -c error` reads as clean.
  Verify the thing, not a proxy for it: a `>/dev/null` that swallows
  `Unknown command` makes a `grep -c` of 0 read as "deleted" for
  something that never existed.
- **Predict the pass count before you read it.** A number that doesn't
  fit is the tell for a stale binary, a wrong tree, or a cascaded
  compile error (a duplicate import can make N-of-M tests "run" as a
  compile cascade, not as failures).
- **A cross-cutting sweep must run EVERY suite it could touch.**
  `npm run test` runs the workspace *unit* suites only — not
  integration, e2e, or the Playwright UI specs. A sweep that reports
  "all suites green" on the strength of `npm run test` has verified
  perhaps half of what it changed. Before claiming a repo-wide change is
  done, run `npm run test`, `npm run test:integration`, `npm run
  test:e2e`, and the Playwright UI suite — and say which you ran.
- **`page.on("pageerror")` distinguishes a component that crashes on
  render from one that renders nothing** — reasoning about data flow
  cannot; both give identical "element not found" output. A hook below
  an early return can crash a whole subtree (React #310) while
  build/typecheck/lint all exit 0.

## Per ticket

```
 1. PLAN       Read the ticket. Look up its cases in tests/cases/case-index.json.
               Restate each in one line and name the ones this ticket satisfies.
               GATE  npm run cases:coverage -- --require <ids>   (must FAIL here —
                     nothing is tagged yet; this proves the IDs are real)

 2. IMPLEMENT  Build the ticket. Do not edit the flow docs.

 3. UNIT       Tests alongside the implementation, each tagged `// @verifies <ID>`.
               GATE  npm run test && npm run typecheck && npm run lint

 4. REVIEW-1   Cheap review: does the implementation match the cases it claims?
               Wrong-shape work is caught before specs are written against it.

 5. E2E        Transcribe the ticket's UI cases into tests/ui/*.spec.ts.
               Break the behaviour, watch each spec go red, restore.
               GATE  npm run test:ui

 6. REVIEW-2   Deep review (/review) on the diff — correctness and bugs.
               THEN a smell/efficiency pass (/simplify) for reuse,
               heavy-compute paths, and code smell. (Ken, 2026-09-04:
               a lightweight quality lens on every commit now, so the
               final Phase Z review inherits cleaner code. Z stays the
               deep full-codebase sweep; this is continuous hygiene.)

 7. FIX        Loop 3–6 until clean.

 8. VERIFY     GATE  npm run cases:coverage -- --require <ids>   (must PASS now)
               GATE  npm run cases:check                          (index not stale)

 9. SURFACE    Run the matching surface cases for CLI + MCP in this domain.
               GATE  npm run test:integration

10. COMMIT     One squashed commit. Update the ticket's status mark.
```

Step 1's gate is deliberately inverted: requiring the IDs *before*
writing anything proves they exist in the index. An agent that
hallucinates `LST-99` finds out in the first thirty seconds rather than
at step 8.

## Adding a field to a schema

A new field on `TaskFrontmatterSchema` — or any contracts schema the
validator covers — needs a write-path check, or an explicit exemption
saying why it does not.

**You do not have to remember this.**
`packages/core/src/config/schema-coverage.test.ts` enumerates the schema
at runtime and fails naming the field:

```
add a check for these, or exempt them with a reason: brand_new_field
```

Exempt a field only when nothing about its *value* can be wrong — not
when writing the rule is inconvenient. The exemption carries a one-line
reason, and a second test fails if that reason names a field that no
longer exists, so the list cannot rot.

**What this does not prove.** Coverage, not correctness: it says the
field is looked at, not that the rule is right. The failure mode it
targets is forgetting entirely, which is the one that actually happens
(V5).

## Running the suites

**Never run two suites concurrently.** Each `pretest` hook rebuilds
`dist/`, which the others spawn — a concurrent build surfaces as ~30
scattered failures that do not reproduce in isolation. See
[`tests/README.md`](../../tests/README.md#how-to-run).

## Before calling a failure "pre-existing"

"Pre-existing" is a claim about someone else's work; hold it to the same
standard as a claim about your own. Prove it against a tree that holds
only your own changes — but **never `git stash` a working tree to get
that baseline.** `git stash` is silently destructive and irrecoverable:
`git status` reads clean after a stash, so the loss is invisible, and
untracked files and conflicted pops vanish from `stash list`, the reflog
and `fsck`. When more than one agent is working, stashing also removes
*your* changes and leaves theirs, so their in-flight breakage reads as
"already broken at HEAD" — precisely the excuse an agent needs to stop
investigating. **Check out HEAD into a separate directory and run there
instead.**

## Diagnosing a failing gate

- **When a fix depends on a third-party state machine, dump its actual
  state at the failure before writing the fix.** Reasoning about a
  library's internals from intuition produces predicates doomed against
  the real state — e.g. TanStack pauses an offline query indefinitely,
  so a fix keyed on `isError` never fires because `isError` is
  permanently false. One `console.log` of `status`/`fetchStatus` settles
  it.
- **Don't use a gate or a full suite as a debugger — build a fast,
  isolated reproduction that drives the production config directly.** A
  ~50ms component test reproduces in seconds what 35-minute gate
  iterations chase.
- **A fix that fails twice means the model of the failure is wrong.**
  Stop, capture the actual state, build a seconds-fast repro before a
  third attempt. Escalation is per-round: a round's fixes introduce the
  next round's defects.
- **Root-cause flakiness before touching timeouts.** Contention presents
  as *timeouts, not assertion failures*, which raising the timeout only
  masks. The tell is timeouts plus summed import time approaching wall
  clock: vitest defaults to one worker per core and each spawns ~10 real
  processes, so integration/e2e configs pin `maxWorkers: 2`. Raising a
  timeout that is not the cause hides the contention.
- **Distinguish a real defect from ambient flake by running the file,
  not just the test — but know which modes can't be load-dependent.** A
  test that fails at file level while passing in isolation is
  order-dependent (real); a strict-mode "resolved to 2 elements" is a
  locator defect that can never be load-dependent — the failure mode is
  the tell.
- **"Flake" is a hypothesis, not a finding.** Of five e2e failures once
  written off as "pre-existing flake, passes on re-run", two (NEW-10,
  SPR-6) were real bugs that failed in isolation on an idle machine. A
  test is not a flake until it has been run alone, repeatedly, and still
  passes; until then it is an open defect.
- **Playwright is only trustworthy at 2 workers.** Each worker boots its
  own tracker server; above 2 the machine contends and the suite
  reports failures that are not defects (measured: 56 at 5 workers, 23
  then 5 at 3, 0 at 2). `tests/ui/playwright.config.ts` now pins
  `workers: 2` by default, overridable via `LOCTT_E2E_WORKERS` (an
  explicit `--workers` on the Playwright CLI still wins over both). Note
  that Playwright exits 0 even when tests fail — read the `N failed`
  line, not the exit code.
- **A "hang" in a component test is often a render loop or a stray
  timer, not slowness — no `testTimeout` fixes either.** A `useEffect`
  whose dependency is a per-render new array/object loops forever; a
  library focus/selection path (ProseMirror `focus("end")`, a React
  Query settle) can schedule a `setTimeout` that outlives jsdom teardown
  and fires as `document is not defined`. Drive the state model directly
  (`editor.state.selection`, a stable dep), not the DOM/focus path.
- **`lint --fix` moves imports between blocks and strips type
  assertions** — it can sort a name into an import where it does not
  exist, so `instanceof` throws at runtime. Re-run typecheck and read the
  diff after any autofix.

## What blocks the loop

The agent stops and escalates, rather than proceeding, when:

- **Two cases contradict each other.** Fifteen such contradictions were
  found by human review in one session; they are where an unsupervised
  agent produces confident garbage. Escalate, do not adjudicate.
- **A case cannot pass because something it depends on does not exist.**
  Record it against the missing thing; do not write a spec that asserts
  a weaker claim so it can pass.
- **A case appears wrong.** The docs are the specification. An agent
  that may rewrite the spec to match its code has no specification.

## Coverage-tooling traps

The coverage gate (`cases:coverage`) counts `@verifies` tags, not truth.

- **A `@verifies` comment scores a case green regardless of what the test
  beneath it asserts, and there is no partial marker.** A test can tag
  three case IDs while asserting one only in its *title*; disabling the
  whole mechanism leaves it green. Where a case's real behaviour cannot
  be reached, do not tag it and say so — a tag is a claim of coverage.
- **Prose near a tag keyword corrupts the tool.** A comment arguing a
  case is deliberately *unmet* ("Deliberately NOT tagged `@verifies
  X`") can make the gate report it *met*, and the swing is always in the
  dangerous direction. Keep case IDs out of explanatory prose.
- **An untagged case and an unbuilt case look identical to the tool.** A
  gate that only reads coverage output calls a missing blocker a tagging
  problem. Read the panel and probe the app before concluding a case is
  merely untagged.
- **An aggregate conceals both finished and missing work.** "38 of 64,
  the rest itemised" hides a decline and an omission behind one number.
  Reconcile item by item; a group reason for uncovered cases is fine
  *only if the group names its members by ID*.
- **Invert the coverage gate at step 1** (the first table above):
  requiring the case IDs before writing code proves they are real and
  defeats the invent-a-requirement-then-satisfy-it mode. A hallucinated
  `BLK-99` fails in thirty seconds instead of at the final gate.

## The multi-agent process

For a review-after run where one agent builds and a fresh one reviews:

- **The reviewer never wrote the code; the gate wrote nothing at all.**
  A review agent that also wrote the code is not a review — spawn a fresh
  one even under context pressure. Hand it the diff, the case text,
  `invariants.md` and `decisions.md`, but not your reasoning for the
  approach.
- **The gate is the "done" authority, not the agent's judgment.** Give
  the gate its own worktree at a pinned SHA, commit everything first (a
  verdict on a moving tree is worth nothing), and copy the report out
  before removing the worktree — a gate report is evidence.
- **The run stops for exactly four things; everything else is decided
  and recorded.** Stop only when a call (1) changes scope, (2) invents a
  requirement, (3) violates a P-principle or a recorded decision, or (4)
  is load-bearing. Otherwise decide it, record it in `decisions.md` § 8
  with a revert path, and continue. "Should I fix the blockers?" is not
  a question; an unspecified confirmation threshold is (the number
  picked would be the agent's, not the case's).
- **"Load-bearing" means: if this is wrong, what gets thrown away?**
  There is no count — stacking is the risk, not quantity. "One behaviour
  in one place" or "a test's expectations" → decide and continue. "Every
  screen that follows this pattern" or "a data shape / URL scheme /
  storage format others will read" → stop. When genuinely unsure, decide
  and say it was a close call in the record.
- **Every recorded decision needs a revert path.** The arrangement
  (agent decides, Ken reviews later) only works if reverting is cheap on
  disagreement. Use `decisions.md` § 8's six fields: situation, what to
  decide, options, decided, why, how to revert.
- **Never reword a case to fit the code.** The docs are the
  specification; an agent that may rewrite the spec to match its code has
  no specification. Sort each unsatisfiable case by what is actually
  missing — wire-up (core has it, nothing wired it → build it),
  cross-cutting (one fix unblocks a whole flow doc → its own ticket), or
  genuine feature (exists nowhere → stop).
- **Working state that lives only in context is lost at the next
  compaction.** A decision, a defect, or a "cannot satisfy yet" not
  written down is re-derived differently by the next agent. Update the
  durable docs after each commit, not at the end.
- **Numbers collide when agents work in parallel — use placeholders,
  assign centrally.** An agent proposes a decision under a placeholder
  (`A?`); the main session assigns the number when the work lands,
  because only it sees every branch.
- **Slice large reviews per fresh agent.** A whole-repo review reads the
  first few thousand lines and skims the rest, and nothing in its output
  shows which. Slice into ~2,000-line chunks with a fresh agent each, and
  add cross-cutting slices (strict parity; cross-component data flow)
  that grid-sliced agents structurally cannot cover.
- **Real clicks only in the agentic browser gate, and wander
  off-script.** `page.click()` is hit-tested and dispatches trusted
  events; `page.evaluate(() => el.click())` passes through a modal
  overlay that would block a real user, so it is banned. The scripted
  journey list is the floor, not the ceiling.
- **Report defects you introduced as prominently as ones you found**, and
  never call work complete when only a decision was recorded — separate
  implemented from recorded from still-open, and check the code before
  writing the summary.

### Change safety

- **Read the requirement literally and reuse what exists — don't build
  scaffolding the spec never asked for.** A board-level empty-state case
  asks for one board-level empty state; adding a per-column "+ Add task"
  puts a create control on a stale column and breaks a neighbouring case.
- **Size and risk are different axes — an agent judges size well and risk
  badly.** Only changes where "no behaviour change" is provable by
  construction (dead code with zero refs, unused exports, import
  ordering, comment fixes) are safe to make unasked. Anything touching a
  signature, a public export, an on-disk shape, or an error message
  escalates regardless of size. Latent bugs hide behind "just
  duplication": sharing a field list written twice can expose that one
  copy never asserted a field, so tests passed with it dropped.
- **Raise an objection to a premise before the decision is made, inside
  the question** — an objection appended after the answer is worthless.
  Put the cost in the option's own description.

## Milestone gates stay human

The 🚦 marks in the ticket roster are review gates for the user, not
for the loop. Everything between them is automatable; the gates
themselves are where the accumulated judgement calls get checked by
someone who can overrule them.

## Scheduling the surface cases

The 65 CLI/MCP cases are **gaps only**, ordered by severity, not by
milestone — the CLI and MCP already exist. Binding them to UI tickets
would stall UI work behind unrelated fixes. The exception is the P10
parity cases, which assert that a concept means the same thing across
surfaces: those belong to the UI ticket that introduces the concept.
