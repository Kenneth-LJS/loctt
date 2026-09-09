# Build discipline — lessons from the v1 build

> **How to build**, the counterpart to [`north-star.md`](north-star.md)'s
> **what to build**. Distilled from the completed multi-phase v1 run
> (CLI + MCP + web over one core). These are reusable principles, not a
> run log — the run log itself was deleted once it landed. Read this
> before more UI work; every principle here was paid for by a concrete
> failure in this repo, cited so the lesson keeps its teeth.

The root problem this whole discipline defends against: **everything here
is AI — building, tests, review, gating. The only external check on an
agent grading its own work is structure.** Freshness, mutation, and a
gate that exits non-zero are that structure.

---

## Testing discipline

The core failure mode: one agent writes the requirement, the test, and
the code with nothing outside itself to check any of them.

**A new test must be shown to fail — unit tests included.** Break the
behaviour it covers, watch *that* test go red, restore. A test still
green with the behaviour deleted asserts nothing, and green is exactly
how that hides. *This caught an unmount test asserting
`dom.isConnected === false` — which React makes true regardless of
cleanup — and a cursor test whose subject was a guard it never reached.*

**If a fix requires editing a green test, that test was asserting the
bug — say so in the commit.** This repo shipped fourteen tests that were
present, passing, and encoding the wrong behaviour. Vacuity is hygiene;
an expectation that is simply *wrong* is the failure hygiene misses.
*`autoClearTimelineDependency` silently deleted a user's config key;
two green tests asserted `toBeUndefined()` on exactly that deletion and
had to be inverted.*

**A test written around a live defect inverts when the defect is fixed.**
It asserts the reachable (wrong) half with a comment saying why the real
bullet can't be tested; once the core fix lands it fails like a
regression. When a core fix lands, re-run the tickets that worked around
it and read a failure-with-a-caveat-comment as a probable inversion
first. *XS-26 asserted that an unrelated save **fails**; the core fix
made it succeed and the test went red on its inverted assertion.*

**Extending code someone else tested? Mutate their tests too.** The
rule above covers tests you write; it misses a test file that stopped
covering its subject when the code beneath it grew. Delete your new
branch, run their file — if it stays green, the coverage you assumed is
not there. *`diagnostics/integrity.test.ts` was written when the scan
checked comments only; history scanning was added beside it and the file
never extended, so `doctor`'s entire history path could be deleted with
all nine tests green.*

**A mutation that does not compile is not a mutation.** Removing a line
often orphans a variable (`TS6133`) so the "mutation" never ran and the
green is meaningless; a `sed`/`perl` mutation can silently fail to match
and leave the code intact. Verify the build, and verify the diff. *An
M4.5 `perl` mutation silently did not match while the suite stayed green
— the touch-nothing trap.*

**Assert the far end — disk, file, the request body — not what's on
screen.** A screen assertion passes whether or not the value is correct.
*But know its limit:* the far end is insufficient when something
downstream repairs the mistake before it lands. *SPR-4 stayed green when
the client sent a sprint **name** instead of its id, because the server
re-resolved the name to an id — the file was right for the wrong reason.
Fixed by additionally asserting the request payload.*

**Behaviour that lives only in a CSS class or no attribute at all is
unassertable — the test degrades to asserting whatever it can reach.**
Give the behaviour an observable hook. *BRD-6, BRD-23 and TML-24 were all
green while unguarded; forcing the condition false or deleting the
element left the suite green. Fixed with `data-wip-state`,
`project-chip`, `data-today`.*

**Separate arithmetic from React** (geometry, layout, rank math) so it is
unit-testable as pure functions over inclusive spans, inverse pairs, and
DST / leap-year boundaries. A UI test asserting "a bar is visible" passes
whether or not the geometry is right. *`Math.floor`→`Math.round` in
`xToDate` reddened six geometry tests that no rendering test could catch.*

**When two tests each catch a different half of a behaviour, keep both.**
*Atomicity has two independent observables — one client→server request
**and** one shared disk timestamp; splitting the write into two sequential
calls inside the server reddens the disk-trace test but not the
request-count test.*

**Seed a fixture that can discriminate.** A single-item corpus can't tell
a working filter from one that returns everything. *`?query=milestone
!= null` "returns everything"; the first probe with one task showed the
correct-looking answer. It needed 1-matching, 2-not to expose the bug.*

**Pin a differing environment value for any test about which env value
the code reads.** Harnesses inherit the host timezone/locale; if it
equals the workspace's, the lookup can be deleted and the test stays
green. *CMT-31 was vacuous because Playwright inherited the host zone =
the workspace zone; fixed by pinning the browser 21 hours away.*

**Vacuity has recurring shapes — a sweep that mutates every test in a
group finds what sampling misses.** Sampling reported "zero vacuous"
three rounds running; a systematic per-case mutation pass found five real
gaps. Known shapes: a body-wide regex matching the wrong element; an
assertion satisfied by a near-identical branch; an absence assertion
trivially true when the app says nothing; a picker/filter that hides the
element regardless of the logic under test.

**Fixtures lie quietly — a wrong fixture is a passing test, not a
failing one.** Repo-specific traps: `makeTasks` passes no workflow config
(tasks start statusless); `createTask` needs a project id; `queries.yaml`
entries need a ULID `id`; `state.yaml` keys counters by ULID not prefix;
an empty directory can be renamed over on macOS (so a "failure" fixture
never fails); every git test runs inside LocTT's own repo unless it uses
`mkdtemp(tmpdir())`.

---

## Verification discipline

A report names findings; it does not prove them. This applies to your own
claims, other agents', and every decision record.

**Verify a builder's report by your own mutation, in the right tree.**
*A Phase 7 builder shipped a write-guard test that was vacuous — green
with the guard disabled; the coordinator's own mutation caught it. In
M4.1, reverting a "fixed" delete left all 232 server tests green —
nothing had ever covered it.*

**Probe the built binary before writing anything — roughly a third of
"defects" aren't.** Case titles and briefs go stale as code moves under
them. *An audit claimed milestone progress "does not exist anywhere"; it
was `computeProgress` in core with a CLI flag and an MCP tool — repeated
twice before anyone looked. Phase 6 verified each item before fixing:
two-thirds needed no change.*

**A claim about mechanism needs a measurement, not an argument.** Three
agents reasoning from the same priors agree with each other and are still
wrong. Show the trace, the request log, the experiment. *Use a positive
control: grep for the thing you claim is absent **and** for a similar
thing you know is present; if the positive control also returns zero,
your grep is wrong, not the code.*

**State a conclusion only as wide as the measurement.** A positive
control that passes tempts a claim broader than what you tested. *An
M4.5 brief claimed the web layer used none of core's query exports; the
grep actually returned six hits and `buildDsl.ts` already existed —
building to the claim would have duplicated it.*

**A decision record is the one artefact nothing tests — treat it as a
claim and re-measure before relying on it.** *A45 said "the shell never
mounts and the modal cannot open" and added no test; measurement showed
the button was enabled and silently did nothing. A41 claimed the
unreadable notice "names the field"; the payload carried a ULID path and
a generic string.*

**A green typecheck / lint / build can be lying — verify the command did
what you think.** *`npx tsc --noEmit -p apps/web` typechecks nothing and
always exits 0 (solution-style tsconfig with `"files": []`); `npm run
typecheck` caught the mutation. `npm run test` prints `Tests N passed`
directly above `FAIL` lines — grep for `FAIL`. A lint V8-OOM crash with
`grep -c error` printing 0 was reported "lint clean" three times.*

**Verify the thing, not a proxy for it.** A swallowed error or a
silently-failed restore reads as success. *A probe used `>/dev/null` and
swallowed `Unknown command: view`, so `grep -c` of 0 read as "deleted"
for a view that never existed. A restore `sed` silently failed and an
empty `git diff | tail -2` was read as proof of restoration.*

**Predict the pass count before you read it.** A number that doesn't fit
is the tell for a stale binary, wrong tree, or a cascaded compile error.
*A duplicate `useState` import made 3043 of 3103 tests run — a compile
cascade, not 60 failures; predicting the count caught four wrong-tree
`cd` incidents.*

**`pageerror` distinguishes a component that crashes on render from one
that renders nothing** — reasoning about data flow cannot; both give
identical "element not found" output. *A hook below early returns caused
React error #310 (whole-subtree crash) while build/typecheck/lint all
exited 0; a fresh agent found it in one pass with `page.on("pageerror")`.*

---

## Core / surface parity

Core exists so two surfaces answer the same question the same way.

**A capability in core is not done until every surface — CLI, MCP, web —
can reach it, and the reference docs describe it.** The
built-but-uncalled export is the signature failure of this run: at least
fourteen surfaced, `unarchiveView` being the emblem (exported, called by
nothing at all). **Grep `packages/core/src/index.ts` for callers before
building anything** — the thing may already exist.

**The test for "does this belong in core":** would two surfaces have to
answer the same question? If yes, it is core and all three get it. A core
function with no consumers is dead code with a good address.

**Only a test that drives the real binary catches a surface-local bug** —
core tests call core directly and cannot see it. *`loctt backup <file>`
read its positional as the subcommand, wrote a file literally named
`backup`, and exited 0; every core test passed. Only the cross-surface
integration test saw it.*

**Fix at the correct layer: if two surfaces tell the same half-truth,
the bug is in core.** *The Diagnostics panel made a command copyable only
when it matched `loctt <command>`, but core's warning lacked the `loctt `
prefix; fixed in core, not the panel's regex, because the CLI told the
same half-truth.*

**A field correct on the wire that nothing renders looks like a fix and
is not — verify the client reads it.** *Twice in one run, a server
serialized an `attachmentsError` / `warnings` array that the client read
nowhere, so the UI showed "no attachments" / zero rows with no reason.*

**When adding a config field, keep the schema tolerant of pre-existing
files.** `.strict()` rejects every older file on load, or destroys
unknown keys on save. *`UserSettings.passthrough()` is load-bearing:
every panel saves `{...stored, ...next}`, so `.strict()` would destroy
sidebar pins when editing an unrelated card layout — a data-loss bug that
looked like drift to remove.* Add a write-path check for the new field
(this repo's `schema-coverage.test.ts` enumerates the schema at runtime
and fails naming an unhandled field), or exempt it with a one-line reason.

---

## Diagnosis & debugging

**When a fix depends on a third-party state machine, dump its actual
state at the failure before writing the fix.** Reasoning about a
library's internals from intuition produces predicates doomed against the
real state. *The M1 gate didn't converge for three rounds — every fix
keyed on `isError`, but TanStack pauses an offline query indefinitely so
`isError` is permanently false. One `console.log` of `status`/`fetchStatus`
would have ended it at round two.*

**Don't use a gate or a full suite as a debugger — build a fast, isolated
reproduction that drives the production config directly.** *A ~50ms
`ListView.paused.test.tsx` reproduced the paused-query bug that 35-minute
gate iterations had chased.*

**A fix that fails twice means the model of the failure is wrong.** Stop,
capture the actual state, build a seconds-fast repro before a third
attempt. Escalation is per-round, not per-finding — a round's fixes
introduce the next round's defects.

**Root-cause flakiness before touching timeouts.** Contention presents as
**timeouts, not assertion failures**, which raising the timeout only
masks. The tell is timeouts plus summed import time approaching wall
clock. *27 of 30 failures were `Test timed out`; summed `import` was 194s
against a 213s wall clock. Neither integration nor e2e config set
`maxWorkers`, so vitest ran one-per-core and each spawned ~10 real
processes. `maxWorkers: 2` → 462 passed. The recorded diagnosis (blaming
the 5s default) was wrong; its instruction (don't raise a timeout that
may not be the cause) was right.*

**Distinguish a real defect from ambient flake by running the file, not
just the test — but know which failure modes can't be load-dependent.**
*TSK-46 failed 9/10 at file level while passing in isolation (real,
order-dependent). A strict-mode "resolved to 2 elements" is a locator
defect that can never be load-dependent — the failure mode is the tell.*

**Never run two suites concurrently.** Each `pretest` rebuilds `dist/`, so
a concurrent build surfaces as ~30 scattered failures that don't
reproduce in isolation.

**Beware the stale-`dist` trap.** A stale `dist` makes the browser run old
code while `git diff` shows new — four separate stale-dist incidents
produced false bug reports. The MCP server is bundled into the CLI
binary, so rebuild `apps/cli` after touching MCP code. `playwright test
--config` bypasses the `pretest:ui` build hook.

**`lint --fix` moves imports between blocks and strips type assertions —
re-run typecheck and read the diff after any autofix.** *It sorted
`ParseError`/`TokenizeError` into an import where they don't exist, so
`instanceof` threw at runtime.*

---

## Scope, change safety & reuse

**Read the requirement literally and reuse what exists — don't build
scaffolding the spec never asked for.** *BRD-40 asks for one board-level
empty state; a prior build added a per-column "+ Add task", which put a
create control on a stale column and broke BRD-42. The v1 restore reused
the six functions of `git/merge.ts` rather than reimplementing them.*

**Size and risk are different axes — an agent judges size well and risk
badly.** Only changes where "no behaviour change" is provable by
construction (dead code with zero refs, unused exports, import ordering,
comment fixes) are safe to make unasked. Anything touching a signature, a
public export, an on-disk shape, or an error message escalates regardless
of size. *Phase 6's three latent bugs were all "a field list written
twice" filed as "duplication" — sharing the mutation also exposed that
`bulkArchive` never asserted `archived_at`, so 15 tests passed with the
field dropped.*

**Refuse rather than approximate when a wrong conversion fails silently.**
A false conversion costs wrong data with no signal; a false refusal costs
a visible "can't". *Advanced→Basic DSL conversion accepts only the exact
shape the generator emits and names the construct otherwise. Same
principle: config is refused when malformed (a definition other data
references), while event records degrade in place.*

**Never `git stash` in a working tree to get a baseline — it is silently
destructive and irrecoverable.** `git status` reads clean after a stash,
so the loss is invisible; untracked files and conflicted pops vanish from
`stash list`, reflog and `fsck`. *A `git stash`/`pop` conflict left ~16
files and 84 tests unrecoverable; a gate agent destroyed 45 lines of
uncommitted work the same way.* To prove something is "pre-existing" or
to get a clean baseline while others may be working, **check out HEAD into
a separate directory and run there.**

---

## Coverage-tooling & self-grading traps

The coverage gate (`cases:coverage`) counts `@verifies` tags, not truth.

**A `@verifies` comment scores a case green regardless of what the test
beneath it asserts, and there is no partial marker.** *A test tagged with
three case IDs; REL-8 and XS-11 asserted only in test **titles** —
disabling the whole mechanism left 30/30 green. Four mis-tagged cases
explicitly disclaimed their missing half in comments.*

**Prose near a tag keyword corrupts the tool — a comment arguing a case
is deliberately *unmet* can make the gate report it *met*, and the swing
is always in the dangerous direction.** *"Deliberately NOT tagged
`@verifies MSL-35`" made the gate report MSL-35 covered; rewording
flipped it back.*

**An untagged case and an unbuilt case look identical to the tool.** A
gate that only reads coverage output calls a missing blocker a tagging
problem. *TSK-20 (Duplicate) was a declared blocker with no route
anywhere in the web client; coverage reported it as merely untagged. Only
reading the panel and probing the app caught it.*

**An aggregate ("38 of 64, the rest itemised") conceals both finished and
missing work — reconcile item by item, and keep the status log honest.** A
group reason for uncovered cases is fine *only if the group names its
members by ID*; otherwise a decline and an omission are indistinguishable.
*Four A11Y cases were lost inside a "25 itemised" summary that itemised
21 — all four were built and merely untested; an agent was halfway into
rebuilding shipped work before a stale status row was caught.*

**Invert the coverage gate at step 1: require the case IDs before writing
code, and watch the command FAIL.** This proves the IDs are real and
defeats the invent-a-requirement-then-satisfy-it failure mode. A
hallucinated `BLK-99` fails in thirty seconds instead of at the final
gate.

---

## Process (for a multi-agent, review-after run)

**The reviewer never wrote the code; the gate wrote nothing at all.** A
review agent that also wrote the code is not a review — spawn a fresh one
even under context pressure. Hand the reviewer the diff, the case text,
`invariants.md` and `decisions.md` — but not your reasoning for the
approach.

**The gate is the "done" authority, not the agent's judgment.** An agent
can be wrong about whether it satisfied a case; it cannot be wrong about
whether the gate command exited 0. Give the gate its own worktree at a
pinned SHA, commit everything first (a verdict on a moving tree is worth
nothing), and copy the report out before removing the worktree — a gate
report is evidence.

**The run stops for exactly four things; everything else is decided and
recorded.** Stop only when a call (1) changes scope, (2) invents a
requirement, (3) violates a P-principle or a recorded decision, or (4) is
load-bearing. Otherwise decide it, record it in `decisions.md` §8 with a
revert path, and continue. The failure mode being prevented is stopping
constantly to report progress rather than to ask. *"Should I fix the
blockers?" is not a question; BLK-30's unspecified confirmation threshold
was — the number picked would be the agent's, not the case's.*

**"Load-bearing" means: if this is wrong, what gets thrown away?** There
is no count — stacking is the risk, not quantity. "This one behaviour in
one place" or "a test's expectations and nothing else" → decide and
continue. "Every screen that follows this pattern" or "a data shape / URL
scheme / storage format others will read" → stop. When genuinely unsure,
decide and say it was a close call in the record.

**Never reword a case to fit the code.** The docs are the specification;
an agent that may rewrite the spec to match its code has no
specification. Sort each unsatisfiable case by what is actually missing —
wire-up (core has it, nothing wired it → build it), cross-cutting (one
fix unblocks a whole flow doc → its own ticket), or genuine feature
(exists nowhere → stop). *This turned "25 cases need a decision" into
three.* The current roster of unsatisfiable cases lives in
[`known-gaps.md`](known-gaps.md).

**Every recorded decision needs a revert path.** The arrangement (agent
decides, Ken reviews later) only works if reverting is cheap on
disagreement. An entry without a revert path has *taken* a decision rather
than deferred it. Use `decisions.md` §8's six fields: situation, what to
decide, options, decided, why, how to revert.

**Raise an objection to a premise before the decision is made, inside the
question — an objection appended after the answer is worthless.** Put the
cost in the option's own description. *The collision-rename question was
first framed as a data-integrity requirement, but the schema dedupes on
id, not name; the correction went in front of Ken before he chose, so his
answer is recorded as a UX call, not a constraint.*

**Working state that lives only in context is lost at the next
compaction.** A decision, a defect, or a "cannot satisfy yet" not written
down is re-derived differently by the next agent. Update the durable docs
after each commit, not at the end. *A stale status convention produced
fifteen log rows saying `(uncommitted)` for shipped work.*

**Numbers collide when agents work in parallel — use placeholders, assign
centrally.** *Two agents in separate worktrees both wrote "decision A4"
the same day; merging produced duplicate IDs and six stale
cross-references.* An agent proposes under a placeholder (`A?`); the main
session assigns the number when the work lands, because only it sees every
branch.

**Slice large reviews per fresh agent.** A whole-repo review reads the
first few thousand lines and skims the rest, and nothing in its output
shows which. *Phase 4 sliced ~25,400 lines into nine ~2,000-line slices,
fresh agent each. Phase Z used an aspect × component grid plus two
cross-cutting slices (strict parity; cross-component data flow) that
grid-sliced agents structurally cannot cover.*

**Real clicks only in the agentic browser gate, and wander off-script.**
`page.click()` is hit-tested and dispatches trusted events;
`page.evaluate(() => el.click())` passes through a modal overlay that
would block a real user, so it is banned. The scripted journey list is
the floor, not the ceiling — a walk that only re-checks the specs finds
nothing new.

---

## Reporting your own work

**"Decided" is not "done".** Never call work complete when only a
decision was recorded. Separate implemented from recorded from
still-open, and check the code before writing the summary.

**Report defects you introduced as prominently as ones you found.**
*Several tickets record self-caught defects — a theme picker reading the
wrong user's storage and white-paging the app; a `Row` component defined
inside a render losing draft state — logged as prominently as the
defects found.*
