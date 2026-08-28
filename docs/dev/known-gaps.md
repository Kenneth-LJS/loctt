# Known gaps

Defects and documentation holes that are real, understood, and not yet
fixed. Each says what is wrong and where the fix belongs, so it can be
picked up without rediscovering it.

This file is not a backlog for features — that is
[`TEMP-WEB-TICKETS.md`](../../TEMP-WEB-TICKETS.md) — and not a place for
things that merely might be wrong. Delete an entry when it is fixed.

## Code

### ERR-11 / ERR-12 have a client half that is not built

The server side is done: `FsAccessError` names permission and disk-full
failures, and the web API returns them as `io_failed` with a
`not_saved` claim and a retry control.

What remains is client-side and needs the body editor: both cases require
the user's typed content to **stay in the editor** when a save fails, so
they can copy it out. Nothing may clear the buffer on failure.

**They are not both M2.** The spec tags **ERR-12 as M2** (blocker, disk
full) and **ERR-11 as M4** (major, read-only or wrong-ownership
`.loctt/`). An earlier version of this entry said both landed with M2.3;
that contradicted the flow doc, which is the specification. ERR-12 lands
with M2.3; ERR-11 lands in M4.

Cases: ERR-11, ERR-12 in
[`ui-test-cases/flow-error-handling.md`](ui-test-cases/flow-error-handling.md).

## Tests

### The integration suite is flaky under parallel load

**Observed 2026-08-17.** A full `npm run test:integration` reported
5 failures across `git/with-remote.test.ts` and
`mcp/list-truncation.test.ts`. Both files passed in isolation, and **four**
consecutive full runs afterwards were green (392/392 each) — so the failures are
contention, not a defect in the code under test.

Both files do real subprocess work: `with-remote` runs git against a
bare remote, `list-truncation` spawns the MCP server over stdio.

**The cause is not established.** This entry originally blamed vitest's
5-second default, which is wrong: the integration runner has carried a
15-second timeout since the harness was written
(`tests/vitest.integration.config.ts:8`). So either those runs genuinely
exceeded 15s under load, or the failures were not timeouts at all. The
failure output was not captured at the time, so nobody knows which.

The same *shape* was hit and fixed once in `apps/web`, whose two
git-error tests passed alone and timed out inside the full web run; they
now carry explicit 30s timeouts. That may or may not be the same
problem.

**Why this matters more than an ordinary flake:** a timeout renders as
`FAIL` in the summary line, indistinguishable from a real regression.
Anyone running the suite after a change will read it as their fault.
**Attempted reproduction, 2026-08-17: could not.** Three consecutive
full runs, then a fourth with four CPU-saturating processes running
alongside. All four were 419/419 with zero failures. Combined with the
four green runs recorded at the time of the original observation, that
is eight clean runs against one bad one.

**No fix has been applied**, and none should be until the cause is
known — raising a timeout that may not be the problem would just hide
whatever is. Capture the failure output on the next occurrence; one
real failure message settles it.

**The practical risk today is misreading, not breakage.** A timeout
renders as `FAIL` identically to a regression, so someone will think
they broke something. That is the reason this entry stays.

**Before believing an integration failure: re-run the named file alone.**

## `rekeyCollisions` skip path — reachable, correct, low value to change

Investigated 2026-08-17 after the GIT-C2 fixture fix, because I had
claimed the sort produced wrong behaviour on real syncs. **It does not.**

**Two things I got wrong, corrected here so nobody re-derives them:**

- `state.yaml` **is** mirrored by sync. `NEVER_MIRROR` holds only
  `local/` and `.git`. I had extended the invariant about
  `.loctt/local/` to `state.yaml`, which is not what it says. Counters
  therefore propagate, and a synced task's project normally has one.
- Two tasks in **different** projects cannot collide. Prefixes are
  unique per project (`ProjectsConfigSchema.superRefine`), so `T1` and
  `M1` are different strings. Only same-project tasks collide, and they
  share a counter, so both sides are rekeyable.

**Verified against two real clones:** both created `T1` offline → sync →
one became `T2`. Two projects independently created with the same
prefix `X`, both tasks `X1` → sync → one became `X21`. Both resolved,
`unresolvedKeys` empty.

**The skip path is reachable, but only by hand-editing the branch** to
add a task whose `project` exists nowhere. When it fires it behaves as
GIT-C2 specifies: stderr warning naming task and reason, `unresolvedKeys`
populated, non-zero exit, and `doctor` reporting the dangling project.

**The one real wrinkle, left alone deliberately.** When the unrekeyable
task sorts *second* (later `created_at`), the collision stays
unresolved — two tasks keep the same key. Sorting rekeyability first
would always resolve it, but that contradicts GIT-C2's stated rule
("the task with the earlier `created_at` keeps the key"), and the input
only arises from a hand-edited branch, which P-12 already classes as
unsupported. Not worth a spec change on that evidence.

## ~~One malformed `task.md` breaks the whole list~~ — FIXED 2026-08-25

**Closed while verifying M1.2.** ERR-9 is the same defect as BLK-44 and
is a blocker, so it came due with that ticket rather than waiting for a
cleanup phase. `loadAllTasksDetailed` keeps the tasks that parse and
returns the ones that do not; `loadAllTasks` keeps its `Task[]` shape
for all 48 callers. `/api/tasks` reports the failures and the list
names each path with its YAML error.

BLK-44's own bullet about a broken-task indicator "see flow-list.md"
still points at a case that was never written there — that half remains
unaddressed, and BLK-44 stays untagged.

The original entry follows, for the record.

## One malformed `task.md` breaks the whole list (BLK-44 deferred)

**Found 2026-08-25 while building M1.4 subsection 5. Verified against
the built CLI, not inferred.**

A single task whose frontmatter will not parse takes down every read
that goes through `loadAllTasks`:

```
$ loctt list
Error: Implicit keys of flow sequence pairs need to be on a single line
```

The web list shows the error state and the export button disables at
`total === 0`, so one corrupt file makes the tracker look empty on
every surface at once.

**This is a P-11 violation** — leniency means keeping, never
destroying, and here one unreadable neighbour destroys access to
everything else. `readCommentEntries` and `readHistoryRows` already
have the keep-and-report shape; task files do not.

**Deferred deliberately.** The fix is in
`packages/core/src/task/load-all.ts:61`, one line at the change point:

```ts
return mapWithLimit(ids, READ_CONCURRENCY, id => readTask(locttDir, id));
```

but the return type is what every consumer reads, so making it
partial-tolerant is a data-shape change to the layer all three surfaces
depend on — the "escalate by rule" case in `TEMP-BUILD-PLAN.md`, not
something a UI ticket decides.

**BLK-44 is not tagged**, and its last bullet points at a broken-task
indicator "see flow-list.md" that **does not exist there** — no case in
`flow-list.md` specifies it. So the case names a dependency that was
never written. Both need settling together.

**Related and already fixed:** BLK-29's drift indicator (a *status* the
workflow no longer defines) shipped in the same subsection. The same
visual treatment is what a broken *task* row would want.

## Every list request re-reads every task file

**Re-measured 2026-08-25 on a quiet machine. The first numbers recorded
here were 3-6x too high — taken while the machine sat at load average
688 — and the conclusion drawn from them was wrong.**

`loadAllTasks` (`packages/core/src/task/load-all.ts:59`) re-reads and
re-parses the whole tracker on every call, with no cache. Actual cost:

| Tasks | `/api/tasks` | Full page load (9 endpoints) |
|---|---|---|
| 2,000 | ~200ms | ~342ms |
| 5,000 | ~500ms | — |

**Not worth optimising at these sizes**, and the shape is better than
it first looked: the four `loadAllTasks` call sites in
`apps/web/src/server/server.ts` are four *different endpoints* — list,
search, export, migrate-plan. A page load pays the scan **once**, not
four times. A proposed per-request memo was dropped for exactly that
reason: there is nothing within one request to memoise.

**Still O(N), so worth knowing.** At tens of thousands of tasks this
becomes the page-load cost. The fix then is an mtime-keyed cache or a
persisted index, and both carry invalidation risk that is not worth
taking for a 500ms scan — LocTT supports the CLI writing files behind
the server's back, so any cache has to be right about that.

**What this actually cost:** a UI spec that passed alone and failed
under `--workers`. BLK-24's settle gate had the default 5s budget, and
five concurrent Playwright workers pushed one 500ms scan past it. That
gate now has 20s while every *measured* assertion keeps its strict
budget, so the cost is measured rather than hidden.


## XS-56: the error state stands in for marked-stale rows

**Decided by Ken 2026-08-25: the error state is accepted.** The case
asks for the rows to be kept and marked; the app replaces them with an
explicit failure surface instead, and that is enough.

The reasoning, for whoever reads the case next: the error state is
honest — it names the failure and offers a retry, and nothing reads as
data loss. Rows that look real but are not invite acting on them, and a
bulk write against stale rows is a worse failure than a table that says
plainly it cannot reach the tracker. The case also predates the choice
of data layer, and TanStack's own answer to this is "do not show
errored data".

**The case is not edited** — flow docs are the specification and an
agent does not rewrite them. This note is the decision; amending
XS-56's second bullet is a docs change for whoever owns that file.

**Original finding, for the record.**

XS-56 wants both halves at once:

- the already-rendered rows are **not wiped** to an empty state, and
- they are **visibly marked** as possibly out of date.

The first half is satisfied in effect: the table shows the error state
with a Retry, never the empty-tracker copy, so nothing reads as data
loss. The second is not, and cannot be as written — TanStack drops the
data when a query settles into an error, so by the time the UI knows
the tracker is unreachable there are no rows left to mark.

I built the banner and then removed it: `items.length > 0 &&
tasks.isError` is never true, so it was an unreachable branch and its
test passed with the error state deleted entirely. Shipping either
would have been worse than the gap.

**What it would take.** Keeping the last successful page beside the
query state and rendering *that* when the live query fails — a
deliberate stale-data cache with its own invalidation rules, not a
predicate change. Worth doing if the case's marked-stale reading is
what is wanted; worth amending the case if the error-state reading is
enough.

**XS-56 stays untagged.**

## The UI suite used to compete with itself under `--workers` (fixed)

**Measured 2026-08-25, fixed 2026-08-28. Never a product defect — a
harness one.** Kept because the diagnosis is worth having if it
recurs, and because two run logs misread it as a defect first.

Six tests fail as a group under the full suite and all six pass alone,
at load average 21:

    LST-13 (x2), LST-17, LST-35, LST-49, BLK-24

They are the seeding-heavy ones. `tracker.seed()` spawns one `loctt
create` per task — sixty processes for a single test — and Playwright
runs five workers at once. The suite's own contention pushes settle
gates past their budgets.

**Fixed 2026-08-28.** `seed` no longer spawns a `loctt set` per field:
it creates the tasks, then writes their frontmatter in one batch. A
sixty-task seed with fields went from well over a hundred subprocesses
to sixty.

That was enough. The full suite went **20 failures → 0**, and the run
from 4.3 minutes to 2.6 — all six of the named specs among the
passes, at load average 128, which is six times the load this entry
was first measured at.

**Why removing only the `set` calls fixed specs that seed no fields:**
the contention is suite-wide, not per-spec. Five workers run at once,
so the field-heavy specs' hundred-odd extra processes were starving
the pagination specs running beside them. Cutting the former gave the
latter their budget back.

**`create` is still one process per task**, because key allocation is
stateful and the assigned key is what the specs read back.

**The M1 gate (F9) reported this as still failing, and it is not** —
but the gate was not wrong to see failures. Every run of this suite
that showed them, including two of mine, had a `npm run build` racing
it: the fixture serves `apps/cli/dist`, so rebuilding mid-run swaps
the binary underneath the workers. A clean run on 2026-08-28 at load
average 86 was **194/194**.

That is the more useful finding, and it generalises: *never run a
build while the UI suite is running.* A failure under those
conditions says nothing about the code, and it has now been misread
three times — twice by me, once by the gate.

`seedBulk` was made a genuine drop-in anyway (2026-08-28): it takes
the tracker's own key prefix and advances `state.yaml`'s counter, so
a later `create` no longer collides. It is not yet used by the
pagination specs, which assert `Task N` titles it does not write —
converting them needs a title pattern on `seedBulk` and eight call
sites changed, which is more than the measured problem justifies.

**The diagnosis in this entry was right and the fix was cheaper than
it predicted** — worth remembering before assuming a flaky suite needs
a fixture rewrite.

**Still true in general:** a failure in this set is not by itself
evidence of a defect. Re-run the named tests alone before believing
it — the run log has been wrong about this twice.

## SHL-33 is untagged, and the two obvious tests for it are vacuous

**Measured 2026-08-28.**

SHL-33 says a workflow with ten statuses "does not distort the shell —
no group grows unbounded; Views group entries are unchanged". The
claim is that the sidebar and header *do not react* to the status
count, which is a negative, and both attempts to test it failed for
the same underlying reason.

**As a Playwright spec** it failed three times on fixture problems:
replacing `statuses:` in `workflow.yaml` leaves the seeded task with a
status nothing recognises, and adding to the list needs the default
flag preserved and the right list indentation. Each round tested
whether the config had loaded, not whether the shell reacted.

**As a component test** it passed with a group that grows with the
status count deliberately inserted — the mutation survived, so the
test asserted nothing. Removed rather than left green.

**Why it is genuinely awkward:** proving "X does not affect Y" needs a
mutation that makes X affect Y, and the mutation has to reach the
component through the same data path the real code uses. Getting that
wrong yields a passing test either way, which is worse than no test.

**What would work:** a spec that renders the shell twice through the
real bootstrap with two different workflow configs and diffs the
sidebar's DOM. It needs the config to arrive by the app's own path,
not a stubbed hook — which is why this is a gap and not a five-minute
fix.

## `git/status-drift.test.ts` times out under heavy machine load

**Measured 2026-08-28, at load average 118.**

`returns to zero local drift after publishing` exceeded even the
20s budget `packages/core/vitest.config.ts` already sets for the
subprocess-heavy specs — it took 24s. It publishes to a real git
worktree, so it is several `git` subprocesses deep, and a loaded
machine starves each of them.

**It is not a defect and it is not new.** It passes in isolation and
it passes under load with more headroom.

**Two things cost a round of investigation, both worth knowing:**

- **The failure is reported against the wrong workspace.**
  `npm run test` runs workspaces in sequence and prints
  `npm error workspace @loctt/web` at the end whichever one failed.
  The web suite was green (51 files, 463 tests) throughout. Grep the
  full output for `FAIL` rather than trusting the trailing npm error.

- **`npx vitest run packages/core/...` from the repo root uses the
  *root* config**, whose timeout is vitest's 5s default — not the
  workspace's 20s. Four tests "fail" that way that are fine under
  `npm run test`. Run core's specs from `packages/core`, or expect
  to misread the result.

## `apps/web`'s pagination spec is load-sensitive too

**Observed 2026-08-28 at load average 128.**

`/api/tasks pagination total exceeds the core listTasks default cap
of 30` failed once inside the full web suite and passed both alone
and on the immediate re-run of the same suite (471/471). It seeds 30+
tasks through the CLI, so it is subprocess-bound in the same way the
git specs are.

Not investigated further because it did not reproduce. Recorded so
the next agent does not spend a round on it: re-run before believing
a single failure here, and check `uptime` first.

## `fetchState` un-says a settled error — the trap behind four bugs

**Established 2026-08-29, by a Fable review plus direct measurement.**

`query-core`'s reducer, `query.js`:

```js
function fetchState(data, options) {
  return {
    fetchFailureCount: 0, fetchFailureReason: null,
    fetchStatus: ...,
    ...data === void 0 && { error: null, status: "pending" }
  };
}
```

**Any** fetch on a query that has never held data resets it to
`pending` with `error: null`. Not just a mount fetch — the interval
tick, a focus refetch, and a manual `refetchQueries()` all do it.

Four separate bugs in `AppBootstrap` came from reading live query
status and acting on that reset:

1. A full-page fatal error on any `/api/info` failure (gate F1).
2. A mount/unmount loop at ~70Hz that hung the schema banner behind a
   permanent spinner (gate F3) — caused by fixing 1.
3. Pressing "Try now" on the unreachable banner destroying the shell
   holding the banner.
4. "No tracker here yet" shown to a user whose tracker was fine,
   because `info.data` is undefined mid-attempt.

**The rule that avoids all four:** ask whether a query has *ever*
settled (`errorUpdatedAt > 0 || dataUpdatedAt > 0`), never what its
status is right now. Those two fields survive the reset; `status`,
`error`, `data` and `fetchFailureCount` do not.

**And keep the last known value.** `info.data` empties during any
attempt, so anything derived from it flickers — which is how the
footer came to report "0 tasks" during an outage.

If a fifth bug appears in this file, check it against this list
before diagnosing it fresh. Three of the four were diagnosed as
unrelated at first.

## A recovery test passes on retry backoff, not on recovery

**Established 2026-08-29, by tracing every `/api/` fetch to its
dispatching frame.**

The ERR-2 spec kills the server, waits for the unreachable banner,
brings the server back, and asserts the banner clears unattended.
It passed with the recovery poll disabled entirely — which made the
poll look irrelevant and produced a written claim, in two files,
that "some render- or route-driven refetch gets there first". That
claim was false.

What actually happened: when the server returns while retry backoff
is still sleeping, the pending retries wake and succeed. The stack
under those fetches is the retryer's own
`sleep(delay).then(() => run())`, not a timer and not an observer.
Thirteen requests fire inside 790ms and none of them are evidence of
a recovery path — they are one already-in-flight attempt per query,
finally getting an answer.

**The fix is a quiesce.** Wait past the backoff before flipping the
server back on. With eight seconds of quiet first:

- poll disabled → banner still up at 20s (**fails**)
- poll restored → clears in ~2.7s, and the first request after the
  flip is dispatched from query-core's `#updateRefetchInterval`
  timer

So the poll *is* the mechanism, and everything else that fires in
that moment is downstream of it: once the poll heals `["info"]`,
`AppBootstrap`'s gate reopens and the components inside it mount,
each dispatching its own `onSubscribe` fetch.

The general rule, for any test that restores a broken dependency:
**an outage has a tail.** If the restore lands inside that tail, the
test measures the tail. Quiesce first, or the assertion is about
Playwright's timing rather than the app's behaviour.

## Agent worktrees are created from an old base, not from HEAD

**Established 2026-08-29, across six sweep agents.**

Every agent spawned with `isolation: "worktree"` landed on `58848c5`
— a commit predating the entire Phase 5 UI build. `tests/ui/`,
`apps/web/src/client/shell/` and `docs/dev/ui-test-cases/` do not
exist there, so a worktree agent asked to work on any of them finds
nothing and, if it is not careful, reports the absence as a finding.

All six were affected. It is a property of how the worktree is
created, not a race or a one-off.

Two consequences:

- **Tell a worktree agent which commit it should be on**, and have it
  verify with `git log --oneline -1` before it starts. Four of the six
  found and fixed this themselves; that they did is luck, not design.
- **Do not read a correct commit as evidence your setup worked.** The
  coordinator checked the worktrees, saw the right SHA, and concluded
  its pre-build step had landed. The reflogs show the agents had
  already reset themselves minutes earlier. The check confirmed the
  state, not the cause.

Worktrees also start without `node_modules` or `tests/workspace/`, and
both are needed before any UI test can run.

## LST-33: a deleted entity's filter chip shows a raw ULID

**Found 2026-08-29 by the vacuity sweep — a live defect, not a
test defect, though the test that should have caught it is vacuous
too.**

LST-33 requires that a filter referencing a since-deleted entity is
*honest about it*:

> the chip indicates the referenced milestone no longer exists, rather
> than rendering a chip with a blank label that reads as a normal empty
> result … This is distinguishable from a valid milestone that simply
> has no tasks.

`buildChips` in `apps/web/src/client/list/FilterBar.tsx:280`:

```ts
const labelOf = (opts: readonly FilterOption[], value: string): string =>
  opts.find(o => o.value === value)?.label ?? value;
```

The `?? value` fallback renders the raw ULID. So a deleted milestone
produces a chip reading `01M13T6YWDXHB52P65P2BNAV8D` — not blank, but
not honest either, and not distinguishable from a valid entity in any
way a user could act on.

The sweep found this while establishing that LST-33's *test* is
vacuous: making chips render a blank label — verbatim the defect the
case names — left the test green. So the case has been failing in
production behind a test that could not see it.

Fix is in `buildChips`: when a value does not resolve to an option,
mark the chip as dangling and render it as such, rather than falling
through to the raw value.
