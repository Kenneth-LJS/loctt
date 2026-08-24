# The build loop

How a ticket in [`TEMP-WEB-TICKETS.md`](../../TEMP-WEB-TICKETS.md) gets
built, verified and closed — by an agent, without a human in the middle.

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

## Per ticket

```
 1. PLAN       Read the ticket. Look up its cases in docs/dev/case-index.json.
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

 6. REVIEW-2   Deep review (/review) on the diff.

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

Prove it, and prove it against a tree that holds only your own changes:

```bash
git stash -u && <run the failing suite>; git stash pop
```

A clean-tree run is only evidence if the tree was actually clean. When
more than one agent is working, stashing removes *your* changes and
leaves theirs, so their in-flight breakage reads as "already broken at
HEAD" — which is precisely the excuse an agent needs to stop
investigating. If that is possible, check out HEAD into a separate
directory and run there instead.

"Pre-existing" is a claim about someone else's work. Hold it to the same
standard as a claim about your own.

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

## Milestone gates stay human

The 🚦 marks in `TEMP-WEB-TICKETS.md` are review gates for the user, not
for the loop. Everything between them is automatable; the gates
themselves are where the accumulated judgement calls get checked by
someone who can overrule them.

## Scheduling the surface cases

The 65 CLI/MCP cases are **gaps only**, ordered by severity, not by
milestone — the CLI and MCP already exist. Binding them to UI tickets
would stall UI work behind unrelated fixes. The exception is the P10
parity cases, which assert that a concept means the same thing across
surfaces: those belong to the UI ticket that introduces the concept.
