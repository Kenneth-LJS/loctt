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

### `loctt link` rejects the inverse side of a relationship; the web API accepts it

**Measured 2026-08-29** while building M2.5a.

```
loctt link T-1 child T-4
  → exit 2: unknown relationship 'child'.
    Known: blocks, parent, clones, duplicates, causes, relates_to

POST /api/tasks/T-1/link {"type":"child","target":"T-4"}
  → 200
```

Core's `linkTask` builds its valid-type set from
`relationshipTypeKeys`, which yields **both** sides of a directional
definition — so core accepts `child`, and so does the web route, which
passes the user's type straight through. The CLI narrows it somewhere
before that, to `r.key` only.

**The stored result is identical either way** (`A child B` is the same
edge as `B parent A`), so this is a usability and P10 divergence rather
than a data problem: the same statement is expressible on two surfaces
and not on the third. The UI's link picker offers all eleven sides, so
a user who learns the vocabulary there finds half of it rejected at the
command line.

**Where the fix belongs:** wherever `apps/cli` validates the
relationship argument — it should use `relationshipTypeKeys` like core
and the web route do, rather than a narrower set. Not fixed in M2.5a
because it is a CLI change and the ticket is the web relationships
panel.

**Reproduce:** `loctt init && loctt create A && loctt create B &&
loctt link T-1 child T-2`.

**Worked around in the specs**, deliberately visibly:
`tests/ui/flow-relationships.spec.ts`'s `seedLink` helper states the
forward link from the other end when the CLI will not take the inverse
side, and says why in its docstring.

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

## SHL-41's "no reload" case has no UI test, and three attempts failed

**Established 2026-08-29 while fixing the M1 round-6 F1 blocker.**

The blocker: with the page open and the server killed, the banner
never appeared — the state every real outage produces, because with
the app loaded every query already has data. Fixed in
`ServerUnreachableBanner.tsx`, and **proved by the unit test**
"speaks when an answered query then fails", which goes red when either
half of the fix is reverted.

What does *not* exist is a Playwright test for it. Three attempts, all
vacuous, all confirmed vacuous by mutation rather than assumed:

1. **Sidebar link click.** Navigates to `?project=…` — a *new* query
   key with no cached data. Such a query reaches `status: "error"`
   normally, so the broken code caught it too. Passed with both halves
   of the fix reverted.
2. **Column-header sort click.** Fires no request at all; the banner
   never appeared, with or without the fix.
3. **Synthetic `visibilitychange`.** Does not trigger a refetch under
   Playwright — the banner never appeared even *with* the fix, so it
   would have been a false failure rather than a false pass.

The difficulty is specific: the test must make the app re-issue a
query that **already holds data**, without reloading (which clears the
cache and destroys the condition) and without navigating (which
creates a fresh key). Nothing tried does that reliably.

This is why the original blocker survived seven outage specs. All
seven use `page.route()` plus `page.reload()`, and the reload empties
the cache — so they test the one state a real outage never reaches.

**If you write this test:** mutate it both ways before believing it.
Revert `errorUpdatedAt === 0` back to `status !== "error"`, and
restore the `continue` after `lastSuccess`. If it still passes, it is
measuring a fresh query, not this case.

## A gate agent can stash the main tree out from under you

**Established 2026-08-29, after nearly losing an hour of test repairs.**

The round-7 gate agent runs in the **main working tree** (unlike the
sweep agents, which get their own worktrees). It needs a clean tree to
run the suites, so it ran `git stash` — silently taking the
coordinator's uncommitted work with it.

The symptom is confusing rather than obvious: edits vanish, but
`git status` reports clean and the reflog shows no checkout, because a
stash is neither. The work is in `git stash list`, on your branch, at
your commit — but nothing points you there.

It looked, briefly, as though tests had been passing against code that
no longer existed. They had not; the runs happened before the stash.
That is a worse failure than losing the work, because it would have
been reported as a verified result.

Two rules:

- **Commit before dispatching an agent that runs in the main tree.**
  Uncommitted work is not safe there.
- **If edits disappear, check `git stash list` before re-doing them.**
  It is the first place to look, not the last.

Better still, give a gate agent its own worktree — but note the base
commit is wrong by default (see the worktree entry above), so it must
be told which commit to use.

## An unreadable `task.md` reports as "task not found" — in every surface

**Found 2026-08-29 by the M2.1 review, then measured wider.**

Corrupt a task's frontmatter (an unclosed quote is enough) and ask for
that task by key. Two different wrong answers, depending on whether
the key was in the index when it was built:

| Path | Answer |
|---|---|
| key **is** indexed → `readTask` throws the parse error | **500** `{"code":"unknown","message":"The server failed while handling GET /api/tasks/T-1"}`, parse detail buried in `detail` |
| key **not** indexed (the file was already bad) | **404** `"task not found: \"T-1\""` |

Both from `lookupByKey`, `packages/core/src/task/lookup.ts:120`.

**The 404 is the worse one: it says the task does not exist while the
file is on disk.** That is ERR-1's exact prohibition — a failure and an
absence must not look alike — and the same shape as the M1 gate's F1
blocker.

**This is core, not web.** Measured against the same corrupt tracker:

```
$ loctt show T-1
Error: task not found: "T-1"
```

So the CLI says it too, and MCP shares the same lookup. Under
`TEMP-RUN-WORKFLOW.md` § "Which layer", the fix owes all three
surfaces.

**The capability already exists one route away.** `GET /api/tasks`
returns `unreadable[{id, path, reason}]` for the identical file, with
the full path and the line and column of the parse error. The list
route degrades correctly; the detail path does not.

Fails **TSK-54** and **XS-51**, which require the surface to say the
file could not be parsed, name the path under `.loctt/tasks/<id>/`,
and give the line or field. Recorded as *failing*, not uncovered — a
"not covered" note would hand the next ticket a false baseline.

## ~~A8's two guards in `useTask` exist but are unasserted~~ — CLOSED 2026-08-29

**Established 2026-08-29**, fixing the M2.1 review's MAJOR 3.

`useTask` (`apps/web/src/client/api/hooks/useTask.ts`) invalidates
`["recents"]` when a task fetch lands, so the sidebar's Recently
viewed group gains the task without a reload (TSK-3). Decision A8
argues for two properties of that effect:

```ts
useEffect(() => {
  if (!isSuccess) return;                       // (1) success path only
  void qc.invalidateQueries({ queryKey: ["recents"] });
}, [isSuccess, dataUpdatedAt, qc]);             // (2) once per fetch
```

The effect's **existence** is covered — delete it and TSK-3 and XS-58
both go red. Neither guard is.

**Measured, not assumed.** A probe counting `/api/recents` requests
over a 404 deep link and over a normal open, with a settle window:

| Build | 404 path | success path |
|---|---|---|
| both guards present | 1 | 2 |
| `isSuccess` removed | 1 | 2 |
| dependency array removed | 1 | 2 |
| both removed | 2 | 2 |

Each figure stable across repeated runs.

So neither guard has an observable network signature on its own.
React Query will not refetch a query that is fresh and already
observed, however many times it is invalidated, which makes "once per
fetch" and "on every render" network-identical. The single moved
number — 2 on the 404 path — appears only when **both** guards are
removed together, so it cannot attribute a failure to either one, and
a test keyed on it would go green again the moment one guard was
restored.

**A test was written for guard (1) and then deleted.** It asserted
`recentsRequests === 1` on a 404 and passed with the guard removed —
the first reading of 2 had come from the combined mutation, not from
the guard alone. It is recorded here rather than left in the suite
because a green that implies a guard it cannot see is the exact
failure mode the M1 vacuity sweep exists to catch.

**Closed by taking that advice.** The assertion has to observe the
invalidation itself, not its network consequence — the request count
is the wrong instrument. `apps/web/src/client/api/hooks/useTask.test.tsx`
renders the hook with a `QueryClient` whose `invalidateQueries` is
spied, and counts the calls keyed on `["recents"]` directly.

Mutated **separately**, which is what the Playwright attempt could not
do:

| Mutation | Result |
|---|---|
| `isSuccess` guard removed | 3 of 3 fail |
| dependency array removed | exactly the re-render test fails |

So each guard now has a test that fails when *it alone* is broken —
the distinction the network layer could not make, because React Query
will not refetch a fresh observed query however often it is
invalidated.

The absence assertion ("does not invalidate on a 404") is paired with
a positive one ("invalidates once on success") on purpose: an absence
alone is satisfied by a hook that never invalidates at all, which is
vacuity shape 3 from the M1 sweep.

**The lesson worth keeping:** the deleted Playwright test was not
badly written, it was written at the wrong layer. A number that moves
only under a *double* mutation proves nothing about either half —
and that is what made it look like a signal.

## TSK-3's "once per mount" bullet is unfalsifiable at the UI layer

**Established 2026-08-29** (M2.1 review, MINOR 5).

`pushRecent` (`packages/core/src/users/recents.ts:63`) filters the
list by id and then unshifts, so a duplicate push is idempotent by
construction: pushing the same id twice yields one row, not two.
`toHaveCount(1)` in TSK-3 therefore holds even against a client that
pushes on every render — the defect the bullet is about cannot produce
a visible second row.

Not a defect and not a bad test: a bullet the data structure makes
untestable from the browser. The re-ordering half of the same test
*is* real — it reads index order out of the rendered list, which a
build that appended rather than moved-to-front would fail. This is
stated in a comment in the test itself so a reader does not take the
count assertions for more than they are.

## ~~An orphaned enum value freezes every other field on the task~~ — FIXED `46507e8`

**Found 2026-08-29 probing M2.2b, before building it.**

Set a task's `status` to `in_progress`, then delete `in_progress` from
`workflow.yaml`. The task still loads — the server preserves the
stored value, which is what P1 requires. But **every subsequent write
to that task is refused**, including to unrelated fields:

```
POST /api/tasks/T-1/set  {"field":"priority","value":"high"}
→ 400 validation_failed
  "invalid value: status: unknown status \"in_progress\";
   valid: backlog, done, wont_do"
```

`loctt set T-1 priority high` fails identically, so this is **core**,
and MCP inherits it. Under `TEMP-RUN-WORKFLOW.md` § "Which layer" the
fix owes all three surfaces.

**It contradicts TSK-29's final bullet** (blocker, P7 P3): "Editing an
unrelated field (e.g. priority) does not clobber the unknown status as
a side effect." It cannot clobber it — nothing can be written at all,
so the task is frozen until the status is repaired by hand.

The mechanism is whole-frontmatter validation on write: setting one
field re-validates every field, and a value that was legal when it was
written is now illegal. A stored value config no longer recognises is
a **display** problem (TSK-29's first three bullets are all about
rendering it as unknown); it is not a reason to refuse unrelated
writes.

**A second defect in the same response:** the envelope carries
`"field": "priority"` while the message is about **status**. A UI
highlighting `envelope.field` marks the field the user just edited
rather than the one that is wrong — and it makes this look like a bug
in the priority picker.

Worth noting what still works, so a fix does not overreach: `GET`
returns the orphaned value unchanged, and the CLI shows it. Only the
write path is broken.

## Parallel build agents make the integration suite fail at random

**Established 2026-08-29, at load average 437.**

Running the integration suite while a build agent runs the Playwright
UI suite produces failures that are pure contention:

| run | failures |
|---|---|
| first | 5, mostly git |
| second, same commit | **26**, a different set |
| the same tests in isolation, both commits | 5/5 pass |

A *different* set each time is the tell. A real break is
deterministic; this moves.

The cause is arithmetic. Both suites spawn real subprocesses — the
integration tests spawn the CLI binary and MCP over stdio, the UI
fixture spawns a `loctt ui` server per spec. Two of those at once on
one machine is not a test failure, it is oversubscription.

**Do not diagnose an integration failure without checking `uptime`
first.** This nearly cost a wrong revert: five git tests failed right
after a core change to `update.ts`, which looked exactly like a
regression. They passed in isolation at both the parent commit and the
child — so the change was innocent and the machine was not.

Two rules:

- **One agent runs a suite at a time.** Worktree isolation prevents
  agents corrupting each other's *files*; it does nothing about CPU.
- **Kill stray servers when a worktree is removed.** A `loctt ui` from
  a deleted `build-m21` worktree was still running and still holding a
  port — `git worktree remove` does not stop what the agent started.

  **This recurs, and it is the coordinator's own probes that leak.**
  Measured 2026-08-30: three `loctt ui` servers had been running for
  3, 4 and 7.5 hours, all from `curl` probes whose `pkill` was written
  into a *later* command that never ran, or ran from a shell whose
  `cd` had reset. Load was 43 with one Playwright suite in flight; it
  fell to 31 the moment they were killed, and a run that normally
  takes 14 minutes was at 37.

  So: `pkill -f "port <n>"` belongs in the **same** command that
  started the server, not the next one. And when a UI suite looks
  slow, count the servers before blaming the suite —
  `pgrep -f "loctt.*ui --port" | wc -l` should be 1 during a
  `--workers=1` run.

### The same defect for custom fields — found independently

The M2.2a build agent hit this from the other side, and its
reproduction is worth keeping because it is a *different* trigger:

```
loctt set T-1 status in_progress
Error: invalid value: fields.component: unknown custom field
       "component"; declared: (none)
```

and for a removed enum value on a custom field:

```
Error: invalid value: fields.team: invalid enum value "platform";
       valid: frontend
```

So it was never only about statuses: **any** stored value the config
no longer declares froze the whole task. Two agents found it
independently within an hour, from opposite directions — one probing
M2.2b's cases, one building M2.2a's pickers.

The fix at `46507e8` is field-scoped rather than status-scoped, so it
covers both. **Verified against the agent's own reproduction**, on the
CLI:

| | before | after |
|---|---|---|
| declare `component`, set it, then undeclare it | — | — |
| `loctt set T-1 status in_progress` | refused | **succeeds** |
| `fields.component: api` still on disk | — | **yes** |
| `loctt set T-1 component newvalue` | refused | **still refused** |

So an orphaned value no longer freezes the task, the user's data is
left alone, and writing *to* the undeclared field is still an error —
which it should be, since config no longer knows what it means.


## ~~`bulk_op_id` is reported in the response but never written to history~~ — **WRONG, retracted 2026-08-29**

**Found 2026-08-29 probing M2.4, before building it.**

A bulk write answers `{bulk_op_id, succeeded, failed}` and the id is
real in that response. It is **not** recorded on the entries the write
creates:

```
POST /api/tasks/bulk/set {"refs":["T-1","T-2"],
                          "changes":[{"field":"status",...}]}
→ 200, bulk_op_id present

.loctt/tasks/<id>/_history.yaml:
  kind: field_change
  field: status
  before: backlog
  after: in_progress          ← no bulk_op_id
```

Everything else is in place, which is what makes this a gap rather
than a feature:

- `HistoryEntry.bulk_op_id` is in the contract
  (`packages/contracts/src/history.ts:53`)
- core's coalescing already special-cases it — *"bulk-op entries never
  coalesce — each stays its own row"* (`task/history.ts:339`)
- `move.ts` **does** stamp it (`:110`, `:118`)

So one bulk operation records the id and the others do not.
`handleBulkSet` never passes one down.

**This blocks CW-11**, which M2.4 owes: "consecutive `bulk_op_id`
entries collapse to one expandable row". There is nothing to group on,
so a bulk edit of forty tasks renders forty separate rows in each
task's feed — the noise the case exists to prevent.

## The retraction

**All of the above is wrong.** `bulk_op_id` is written, and it always
was. Re-measured:

```
POST /api/tasks/bulk/set {"refs":["T-1","T-2"],
                          "changes":[{"field":"status",...}]}

.loctt/tasks/<id>/_history.yaml:
  kind: field_change
  field: status
  before: backlog
  after: in_progress
  bulk_op_id: 01M1637HMD7Y3Q5QPZ9M86FN1Y   ← present
```

The chain is complete and was all along: `bulk.ts:72` mints the id,
`:114` passes it to `setFieldsLocked`, and `update.ts:838` stamps it
onto every entry. The API exposes it as a **top-level** field on the
activity entry.

**Two mistakes produced the false finding, and both are worth naming:**

1. **I inspected the result of a request that failed.** The first
   probe sent `{field, value}` when `bulk/set` takes
   `changes: [{field, value}]`. It returned 400. I then read
   `_history.yaml`, saw no bulk entry — because no bulk write had
   happened — and concluded the id was never written.
2. **I looked in the wrong place.** The second probe printed
   `meta keys: []` and I read that as absence. `bulk_op_id` is a
   top-level field on the entry, not inside `meta`.

So **CW-11 is not blocked**, and M2.4 can build the collapse against
data that is already there.

The general lesson is the one this repo keeps relearning in new
disguises: *check the write succeeded before drawing conclusions from
what it left behind.* A 400 followed by an empty read looks exactly
like a feature that does not exist.

## ~~The body precondition is web-only; CLI and MCP still last-write-wins~~ — CLOSED

**Found:** M2.3, 2026-08-29. **Closed:** K10, 2026-08-31.

Core had `bodyToken()`, `BodyWriteOptions.expectedToken` and
`StaleBodyWriteError` with no caller outside the web app, so the guard
K2 required protected the web editor from the two surfaces it was
written about, while those surfaces wrote unguarded.

The open question this entry named — *what would a CLI or MCP caller
pass?* — was Ken's to answer, and K10 (`decisions.md` § 9) answers it,
splitting the surfaces rather than picking one default:

| Surface | State after K10 |
|---|---|
| web | unchanged: always sends a token, `StaleBodyWriteError` → 409 |
| `apps/cli` | **last-write-wins by default** (Ken's ruling). `loctt body --token` prints a token; `--expect <token>` opts in per command; `cli.require_body_token` in `workflow.yaml` opts in a whole tracker |
| `apps/mcp` | `get_task` returns `body_token`; `replace_task_body` and `append_task_body` take `expected_token` and enforce it when supplied |

Also closed in passing: `appendTaskBody` accepted no options at all, so
the token was enforced on replace and silently ignored on append — the
more dangerous half, since an append reads the existing text in order
to add to it.

**The residual risk, stated because Ken accepted it explicitly and it
is not a defect.** With last-write-wins as the CLI default, a
`loctt body --set` that races a browser autosave still destroys the
browser's edit silently. K10 records this as the accepted cost:
protection is on for the surface most likely to race a human (MCP
agents) and off for the surface least likely to (a person at their own
terminal), and a tracker that disagrees can set
`cli.require_body_token: true`.

See decisions A56 (how MCP obtains a token), A57 (how the CLI does),
A58 (where the config lives).

## A UI spec asserting a timezone must pin the browser's

**Found 2026-08-29 while mutation-testing M2.4b's CMT-31.**

Playwright's config here sets no `timezoneId`, so every spec inherits
**the host machine's zone**. The developer machine is `Asia/Singapore`
(UTC+8) and `loctt init` writes that same zone into `calendar.yaml`, so
by default the browser and the workspace agree — and a spec asserting
that the app follows the *workspace* zone cannot tell that from an app
that follows the *browser*.

Measured: CMT-31's first draft used a workspace on `Pacific/Kiritimati`
(UTC+14) and two instants 14 hours apart. Replacing the workspace
timezone with `Intl.DateTimeFormat().resolvedOptions().timeZone` — the
whole mechanism deleted — **left the spec green**, because on a UTC+8
host those instants fall on the same two calendar days either way.

The fix is per-spec, not global: `flow-activity.spec.ts` wraps CMT-31
in its own `test.describe` with
`test.use({ timezoneId: "America/Los_Angeles" })`, 21 hours from the
workspace zone, so every fixture instant lands on a different day in
each. The mutation now turns it red.

**The general rule:** a spec whose subject is "which clock does the app
read" must fix *both* clocks. Leaving one to the host makes the test's
verdict a property of whoever ran it. Anything asserting relative
dates, "Today"/"Yesterday", or day boundaries is in scope.

## The UI suite flakes under ambient load, with a different set each time

**Measured 2026-08-29 during M2.4a, at load average 24–29.**

Three consecutive full-suite runs on the **same commit**, one worker:

| run | result | failures |
|---|---|---|
| first | 267/276 | 9, all `flow-task-body` |
| second | 271/276 | 5 — 4 `flow-task-body`, 1 `flow-list` (MSL-6) |
| third | **276/276** | none |

The first run's 9 were a *real* defect (a `getByTestId("rich-editor")`
that stopped being unique once M2.4a put a second editor on the task
page) and were fixed by scoping the locators. **The second run's 5
were not.** Every one of them passed in isolation at that same commit,
and the third full run — same commit, same code — was clean.

This is the "different set each time" signature the parallel-agent
entry above describes, reproduced here **without** a competing suite:
the machine was carrying ~25 load from an editor and a dozen MCP
servers, and the UI fixture spawns a `loctt ui` server per spec.

MSL-6 is the useful tell. It touches nothing M2.4a changed, so a run
where it fails alongside four body specs is reporting on the machine
rather than on the diff.

**Practical rule, unchanged but now evidenced at ordinary load:** check
`uptime` before believing a UI failure, and re-run the named specs in
isolation before concluding anything. A green isolated run plus a
green full re-run is the standard of proof; one red full run is not.

### The ambient load has a name

**Measured 2026-08-30**, after four runs on one commit each failed a
*different* pair (SHL-9; then none; then SHL-28 + XS-6):

```
92.7%  TrendMicroSecurity.app/…/iCoreService
58.1%  Google Chrome
```

**A real-time antivirus is scanning every file the fixtures create** —
and the UI fixture creates a whole `.loctt/` tracker per spec, with a
`loctt ui` server per spec on top. That is the flake, and it is not
something this repo can fix.

Two consequences worth knowing:

- **A different failing pair each run is the signature.** A real break
  is the same test every time. If the set moves, check `ps aux | sort
  -k3 -rn | head` before anything else.
- **Leaked `loctt ui` servers make it much worse** and *are* ours —
  see above. Three had been running 3–7 hours; killing them dropped
  load from 43 to 31 immediately.

## `multipart.ts`'s basename guard is inert; core's is the only one

**Found 2026-08-29 while mutation-testing M2.5b's REL-36.**

`apps/web/src/server/multipart.ts` takes `basename(filename)` of the
declared multipart filename, with a comment calling it a defence
against injected directory components. **It defends nothing on its
own.** Neutralising it — leaving the declared name intact — left
REL-36 green: an upload named `../../etc/passwd` still landed as
`passwd` inside the task's own `attachments/`.

The reason is that `attachFile` in `packages/core/src/task/attachments.ts`
derives the destination name from `basename(absSource)` itself, and
`absSource` is the temp path the route wrote to. Neutralising *that*
one turns REL-36 red immediately, with nothing written at all.

So the traversal guard is core's, and it is doing its job. The web
layer's copy is redundant — which is fine as defence in depth, but the
comment overstates it, and anyone reading `multipart.ts` alone would
conclude the route is the thing keeping uploads inside the directory.

**Not a defect and not fixed:** removing the redundant call would make
`multipart.ts` depend on core's guarantee across a package boundary
for a security property, which is worse than a redundant line. The
gap is the comment, not the code.

## An attachment name that differs only by case aliases on macOS

**Found 2026-08-29 while mutation-testing M2.5b's removal path.**

`DELETE /api/tasks/:ref/attachments/DROP.TXT` deletes `drop.txt` on a
default macOS volume, because APFS is case-insensitive. `unlink`
resolves the alias and core's `detachFile` reports success, writing an
`attachment_removed` history entry naming `DROP.TXT` — a name that was
never on disk.

The same upload path can therefore also overwrite `readme.md` with a
file named `README.md` **without** triggering the collision check:
`stat(dest)` for `README.md` finds `readme.md`, so it does throw
`AttachmentExistsError` on macOS — but on a case-sensitive Linux
volume the two are distinct files and both are kept. The behaviour
differs by filesystem, which is the actual problem.

**Not in scope for M2.5b** (no REL case covers case-folding), and not
fixed: the honest fix is core normalising or refusing names that
collide case-insensitively with an existing attachment, which changes
what the CLI and MCP accept too.

## ~~BRD-12 cannot be satisfied~~ — FIXED by K8 (2026-08-30)

**Resolved.** Ken's K8 ruling made a board column a *group of tickets*
rather than a status, and the fix landed with it.

`deriveColumns` moved from `apps/web/src/client/board/columns.ts` into
`packages/core/src/board/columns.ts`, and `reorderBoardRank` now scopes
its peer set and its anchor check by **column** (via
`rank/column-scope.ts`) instead of by `moved.frontmatter.status`. A
`blocked` card can be dragged above an `in_progress` card in the same
configured column; the rank lands and the status is untouched.

The two SPR-C2 tests still pass — their fixture has no `boards` block,
so the 1:1 fallback keeps `backlog` and `in_progress` in separate
columns and the refusal is still correct there. Only the error
*message* changed (it now names columns rather than prescribing "move
the task to that status first").

`tests/ui/flow-board.spec.ts`'s BRD-12 test is no longer `test.fixme`.

## `workflow.boards` is undocumented in schema-reference.md

**Found:** M3.3a · **Not fixed:** out of the ticket's scope.

`docs/dev/schema-reference.md`'s `workflow.yaml` "Top-level fields"
table listed neither `boards` nor `timeline`, though both are in
`WorkflowConfigSchema` and both are read by shipped code
(`board/columns.ts` derives its columns from `workflow.boards.columns`;
BRD-2, BRD-6, BRD-17 and BRD-24 all depend on the shape).

M3.3a added the `timeline` row and a `### timeline` section, because
that block is this ticket's subject. **`boards` is listed in the
table but still has no section of its own** — its `columns[]` entries
(`key`, `label`, `statuses[]`, `wip`) are documented nowhere.

**To reproduce:** `grep -n '^### ' docs/dev/schema-reference.md` between
the `workflow.yaml` and `queries.yaml` headings — there is no `boards`
entry. Compare with `BoardsConfigSchema` in
`packages/contracts/src/workflow.ts`.

**To fix:** add a `### boards` section next to `### timeline`, taking
the field list from `BoardsConfigSchema` and the semantics from the
`board/columns.ts` docstring (which is accurate and thorough).

## The non-working-day predicate exists twice

**Found:** M3.3a · **Not fixed:** would require editing `DateField`,
which M3.3a had no other reason to touch.

`nonWorkingReason` in `apps/web/src/client/timeline/geometry.ts` and
`nonWorkingNote` in `apps/web/src/client/task/editors/DateField.tsx`
both decide whether a date is a non-working day, and both do it the
same way: look for a holiday whose `date` matches, else parse the day
as UTC and test `calendar.working_days.includes(weekday)`.

They differ only in what they return — `nonWorkingNote` gives an
English sentence for the task panel ("Saturday is not a working day"),
`nonWorkingReason` gives the bare holiday label or `""` for a chart
tooltip. The *decision* is duplicated; the formatting is not.

**Why it matters.** TML-13 and TSK-8 must agree: a day shaded in the
timeline should be marked in the date editor. Nothing enforces that
today. A change to one — say, honouring a per-project calendar — would
silently leave the other behind, and only the calendar tests on each
side would notice.

**To reproduce:** compare the bodies of the two functions; the holiday
lookup and the `working_days` test are line-for-line equivalent.

**To fix:** extract `isNonWorkingDay(date, calendar): { holiday?: string }
| undefined` (in `geometry.ts`, or a shared `calendar.ts` if the
timeline should not own it), and have both format its result.
`DateField` is currently byte-for-byte unchanged from before M3.3a, so
this is a pure refactor whose regression surface is TSK-8/TSK-28 in
`tests/ui/flow-task-meta.spec.ts` plus TML-13 in
`tests/ui/flow-timeline.spec.ts`.

## The timeline has no virtualization: TML-21, TML-26, TML-27, TML-30, TML-32 are unmet

**Found:** M3.3b (2026-08-30). **Not fixed.**

Five section-B cases ask the timeline to stay usable at scale, and each
names a mechanism that does not exist:

- **TML-21** — a 1970→2099 span at day zoom must not render ~47,000 day
  columns at once: "the header and the grid virtualize". `headerCells`
  builds one cell per day and `eachDay` materializes the whole range,
  so both arrays are ~47,000 long. Measured: the view *does* load and
  stay interactive within a couple of seconds, and the bar's width is
  correct (>1,000,000px) rather than an overflow artefact — so the
  case's first, third and fourth bullets hold. The second bullet, the
  virtualization itself, does not. The passing test asserts only what
  was measured.
- **TML-26** — 3,000 dated tasks with vertical row virtualization.
  `buildLayout` places every row and `TimelineChart` renders every one.
- **TML-27** — 40 assignee bands with *sticky* band headers. The band
  header is `absolute`, not `sticky`, so it scrolls away.
- **TML-30** — 60 overlapping bars: each already gets its own row (that
  part holds), but the vertical extent is not virtualized.
- **TML-32** — 50 outgoing arrows with hover-highlighting of a source
  bar's arrows. No hover-highlight behaviour exists.

**Why it matters.** These are the cases that decide whether the
timeline survives a real tracker rather than a seeded one. They were
scoped to M3.3b but each needs a windowing layer (horizontal for the
header/grid, vertical for rows) that is a build of its own, plus a
sticky-header change and an arrow-hover interaction. Building any of
them by halves would produce a virtualized view whose band counts,
`centreById` map and arrow anchors disagree with what is rendered —
the arrows are positioned from `layout.centreById` *before* paint
precisely so they do not lag, and a windowed layout has to keep
supplying centres for rows that are not mounted.

**To reproduce:** seed 3,000 dated tasks and open `/timeline?zoom=month`;
count the rendered `[data-testid^="timeline-bar-"]` nodes — it equals
the task count, not the visible-window count. For TML-27, scroll inside
a long band and watch the band header leave the viewport.

**To fix:** a windowing layer over `eachDay`/`headerCells` (horizontal)
and `buildLayout` (vertical) that keeps `centreById` answering for
off-window rows, `position: sticky` on the band header, and an
`onPointerEnter` on the bar that marks its edges for a highlight class.

## `XS-12/TSK-35` (body-editor conflict) is timing-flaky under full-suite load

**Found:** M3.3b (2026-08-30), while running the full UI suite. **Not
fixed — and not caused by that ticket**, which touches no body-editor
file (`git diff --name-only` lists none under `task-body`).

`tests/ui/flow-task-body.spec.ts:385` — "a genuine conflict shows both
versions and each choice does what it promised" — failed once in a
438-test run and passed on every isolated run.

**Measured, and the timing is the tell:** it took **8.1s** in the
failing full-suite run, **3.1s** in an earlier full-suite run where it
passed, and **3.3s** run alone. The test stages a real write conflict
between a stale editor buffer and an out-of-band change, so it depends
on two writes landing in a particular order; under a loaded machine
the margin closes.

**Why it matters.** It is a false red on a gate that is supposed to be
trustworthy, and a suite with one known flake trains agents to explain
failures away — which is how a real regression gets waved through.

**To reproduce:** run the whole UI suite on a loaded machine
(`npx playwright test --config tests/ui/playwright.config.ts
--workers=1`) and watch that test's duration. It does not reproduce
with `-g "XS-12/TSK-35"`.

**To fix:** replace whatever fixed wait stages the conflict with a
condition on the observable state — poll the file on disk, or wait for
the conflict banner — rather than on elapsed time.

## The full UI suite's load-sensitivity is wider than `flow-relationships`

**Measured 2026-08-31 during M3.5's verification, with the suite grown
to 500 tests.** One full single-worker run produced **six** failures;
every one of them passed at *file* level immediately afterwards, on the
same build, with no code change in between:

| failing test | file | file-level result |
|---|---|---|
| XS-18 | `flow-list.spec.ts` | 168/168 passed |
| MSL-6 | `flow-list.spec.ts` | 168/168 passed |
| REL-5 | `flow-relationships.spec.ts` | 30/30 passed |
| REL-28 | `flow-relationships.spec.ts` | 30/30 passed |
| REL-46 | `flow-relationships.spec.ts` | 30/30 passed |
| schema-mismatch banner | `flow-schema-mismatch.spec.ts` | 1/1 passed |

MSL-6 was additionally run 4× in its `-g "MSL-"` group (9/9 each time)
because M3.5 refactored the component under it (`LabelsCell` →
`LabelPill` + `LabelOverflow`); it did not fail once.

**What this changes.** The existing entry above names REL-28, REL-30 and
REL-32 as *the* load-sensitive tests. That list is too short: REL-5,
REL-46, XS-18 and the schema-mismatch banner join it, so the pattern is
not specific to `flow-relationships`. The suite now takes ~25 minutes at
one worker, and tests near their budget fail somewhere in that window
rather than in a fixed place.

**Why it matters more than the individual flakes.** Six red tests in a
gate run is indistinguishable, at a glance, from six regressions. The
only thing separating them here was re-running each *file* — and an
agent that trusts the full-suite result alone will either chase
phantoms or, worse, learn to dismiss real failures as "probably the
known flake".

**To reproduce:** `npx playwright test --config
tests/ui/playwright.config.ts --workers=1` on a machine also running
other work, then re-run each failing file on its own.

**To fix:** raise the per-test timeout for the seed-heavy tests (the
budget is 30s globally, and several seed dozens of tasks through the
CLI at ~250ms per spawn), or move fixture seeding off the CLI and onto
`seedBulk`-style direct writes wherever the case is not about the CLI.
Neither is M3.5's to do.

## `flow-relationships.spec.ts` has three load-sensitive tests

**Measured 2026-08-31 during M3.4's verification.** Across four full UI
runs on the same code, this one file produced a different single failure
each time, while passing **30/30 at file level every time**:

| run | failing test | failure mode | clean-run time |
|---|---|---|---|
| 1 | REL-28 | `locator.hover` timeout at 30s | 28.9s |
| 2 | — | (clean) | — |
| 3 | REL-30 | `loctt link T-1 blocks T-2 exited 1` | — |
| 4 | REL-32 | convergence assertion, wrong rank order | 4.9s |

**REL-28 is fixed** — it seeds 51 tasks and 50 links through the CLI,
costing 28.9s against a 30s budget, i.e. a 1.1s margin on a *quiet*
machine. `test.slow()` (scoped to the test, not the file) gives it 90s.
Shrinking the fixture was rejected: the case is *about* fifty
relationships.

**REL-30 and REL-32 are NOT fixed, and `test.slow()` will not help
REL-32.** It completes in 4.9s clean — three orders of magnitude inside
its budget — so its full-suite failure is the two-tab race *resolving
differently* under load, not a timeout. The assertion picks a winner
between two concurrent writes; under contention the loser can win.

`TEMP-BUILD-PLAN.md`'s M2.5a row already records that REL-32 was
timing-fragile when written: "REL-32's first two mutations were
rejected, not scored — both turned it red on a `waitForResponse`
timeout rather than on the convergence assertion, which is a red for the
wrong reason."

**Why this is logged rather than fixed here:** a race test that asserts
*which* writer wins is asserting something the system does not
guarantee. The honest fix is to assert what the case actually requires —
that the two tabs **converge** and that the loser **is told** — without
pinning which order they converge on. That is a rewrite of the
assertion, on a case (REL-32) owned by M2.5a, during M3.4's
verification. Out of scope here; it needs its own look.

**Do not read a green full run as evidence these are fixed.** One in
four runs was clean with all three still fragile.

## `projects.yaml`'s ghost-default message says "default default"

**Found:** M3.4 (2026-08-30), while measuring NEW-20. **Not fixed** —
cosmetic, and fixing it means touching the shared config-error
formatter, which is out of this ticket's scope.

A `projects.yaml` whose `default:` names no existing project produces:

    {"code":"config_invalid",
     "message":"projects.yaml is not valid: default default project
                'ghost' is not in the projects list"}

"default default" — the formatter prepends the failing key's path
(`default`) to an issue message that already begins with the word.

**To reproduce:**

    loctt init
    loctt project create "Backend" --prefix "BE-"
    # edit .loctt/config/projects.yaml: set `default: ghost`
    loctt ui --port 7799 --no-open &
    curl -s localhost:7799/api/projects

**To fix:** the path prefix should be omitted when the issue message
already starts with the key name, or the `superRefine` message in
`packages/contracts/src/projects.ts` should not lead with "default".
P4 asks for a legible reason and this is still legible — it just reads
like a bug, which erodes trust in the rest of the message.


## Config pickers break past 1000 entries

**Found:** M3.4 (2026-08-30). **Not fixed** — bounded, and the fix is a
paged picker, which is its own ticket.

See `decisions.md` A43: the picker hooks now request
`limit=1000`, the server's `MAX_PAGE_LIMIT`. A workspace with more than
a thousand labels, milestones, sprints, users or projects is back to
the original defect — the list is silently truncated, and the create
modal's label field will offer to create a duplicate of an existing
label that fell outside the window.

**Why it matters.** It fails silently and it *writes* — a duplicate
label in `labels.yaml`, not just a missing row.

**To reproduce:** seed 1100 labels, open the create modal, search for
`lbl-1050`, and watch it offer "Create «lbl-1050»".

**To fix:** server-side search on the list endpoints (`?q=`), and an
incremental picker that queries rather than filtering a
fully-fetched array. NEW-25 already asks for "filters as you type and
shows a bounded number of results", which is that design.


## The query language cannot ask whether a field is unset

**Found:** M3.5 (2026-08-31). **Not fixed** — adding an operator is a
language change, well outside a view ticket.

There is no way to write "tasks with no sprint" (or no milestone, no
assignee, no due date). Measured against a scratch tracker built from
this worktree, one task assigned to a sprint and one not:

```
sprint = null    → No tasks found.   (matches nothing; not an error)
sprint is null   → Error: expected operator but got "is" at position 7
sprint = empty   → No tasks found.
sprint is empty  → Error: expected operator but got "is" at position 7
```

Positive control, same tracker, same session — the field and the
filter both work, so this is a missing operator and not a broken
filter:

```
sprint = "<ULID>"  → T-1   (the assigned task)
sprint != "<ULID>" → T-2   (the unassigned one)
```

`grep -n -i "null\|unset\|absent\|empty" docs/user/common/query-language.md`
finds nothing on the subject — it is undocumented because it does not
exist, not because it was overlooked.

**Why it matters.** "What is not yet scheduled?" is one of the more
natural questions to ask a tracker, and the workaround only exists
when there is something to negate against. With N sprints the user
must write `sprint != "id1" and sprint != "id2" and …`, and with
**zero** sprints defined there is no expression at all. `sprint = null`
silently matching nothing is the worse half: it looks like an answer.

**Related.** The sprint filter takes the **ULID**, and it must be
quoted — a bare ULID is `Error: unexpected token`, and the sprint
*name* matches nothing. Same shape as the known project-filter
behaviour.

**To reproduce:** `loctt init`; `loctt sprint create S1 --start
2026-01-01 --end 2026-01-14 --state active`; create two tasks; `loctt
set T-1 sprint S1`; then run the queries above.

**To fix:** an `is null` / `is not null` (or `= none`) operator in the
query parser, applied to every optional field rather than to `sprint`
alone. SPR-6's spec asserts the negation in the meantime — see
`decisions.md` A55.

## `toBeDisabled()` silently checks the wrong element inside a `<label>`

**Measured 2026-08-31, Playwright 1.62.1, isolated from this app.**

Playwright's `elementState('disabled')` calls `retarget(node,
'follow-label')` first. An element that does **not** match
`a, input, textarea, button, select, [role=link|button|checkbox|radio]`
and sits inside a `<label>` is retargeted to `enclosingLabel.control`.
`<option>` is not on that list.

So for markup like `MoveTaskDialog.tsx`'s —

    <label>Destination project<select><option disabled>…</option></select></label>

— `expect(option).toBeDisabled()` evaluates the parent **`<select>`**,
which is enabled, and reports "enabled" while its own call log shows it
resolved to `<option disabled value="…">`. Isolated repro: identical
markup **without** the `<label>` wrapper returns `disabled=true`.

**Use `toHaveJSProperty("disabled", true)`** (or `toHaveAttribute`) for a
disabled `<option>`, or for any non-control element inside a label.
Property and attribute assertions skip retargeting.

**Why this is worth recording rather than just fixing:** the assertion
does not error. It fails with a plausible message naming the right
locator, so it reads as an application defect. It cost a Fable
investigation to distinguish from one.

## A stale `apps/web/dist` makes UI tests assert code that is not the source

**Measured 2026-08-31 during TSK-21.**

The Playwright fixture serves the built SPA from `apps/web/dist/client`.
When that bundle predates the source, the browser renders old code while
`git diff` shows the new. TSK-21's picker test failed against *correct*
source: the browser received `{"name":"Retired","archived":true}` and
rendered it anyway, because the bundle it was running had neither the
filter nor the `disabled` attribute.

This is the same shape as running a suite in the wrong worktree —
verifying against something other than the code being read — and it
produced a confident, wrong "shipping bug" report before it was caught.

**Rebuild before trusting a UI failure that contradicts the source.**
Never mid-suite: that empties `apps/cli/dist/` and fails unrelated specs
with ENOENT.

## A rekey elsewhere can show a stale key in the link picker for 30s

**Measured 2026-09-01 while adding REL-8's bullet-3 assertion.**

The link-target search is `useQuery({queryKey: ["task-search", trimmed,
selfId]})` under the app-wide `staleTime: 30_000`
(`apps/web/src/client/api/queryClient.ts:129`). Retyping a string
searched seconds earlier is served from cache with **no request**.

So a user who searches a key, sees the task, and then has it rekeyed
from another surface can be offered the old key for up to 30 seconds.
Not REL-8's bullet — a user typing a key retired *before* they opened
the picker is typing that string into this query for the first time,
which always fetches — but the same mechanism.

This is the deliberate freshness policy, recorded here because it bit
the test that was written to cover the bullet: the first draft retyped
a string an earlier assertion had already searched, so react-query
replayed the pre-move result and the new key could never appear. The
test now moves a *third* task and types a key never searched before.

**Not fixed.** Lowering `staleTime` for this one query would trade a
30s window for a request per keystroke; the case does not ask for it.

## ~~A resolved body conflict can re-open its own dialog~~ — CLOSED 2026-09-01

**Measured 2026-09-01 while adding XS-11's bullet-3 assertion.
Reproduces in roughly 1–2 of 10 runs.**

Clicking a choice in the conflict dialog **blurs the editor**, and both
editor modes flush on blur (`BodyEditor.tsx:158` and `:162`). That
fires a second write carrying the *stale* token, which the server
correctly refuses with a 409 — visible in every single run.

If that 409's response lands **after** Apply, `write()`'s catch calls
`setConflict(...)` and re-opens the dialog over a conflict the user has
already resolved. The merge write itself still succeeds (200 observed
in the same run), so **no data is lost** — but the user is left facing
a stale conflict dialog that nothing will close.

Measured in one failing run: 409 at `…308336`, resolve 200 at
`…308358`, dialog still present.

**CLOSED 2026-09-01 by A59** (`decisions.md` § 8): `flush()` now
returns without writing while the conflict dialog is open — XS-12's
"The UI does not write" bullet, enforced in the hook — so the doomed
blur-flush never leaves and nothing can re-open a resolved dialog.
`resolve()` clears the guard synchronously before its own write, which
still carries the conflicting version's token. Covered by the "A59"
describe block in `useBodyAutosave.test.ts` (deterministic, scripted
response ordering) and XS-11's spec, which now asserts the dialog
stays closed (pre-fix: 4 failures in 10 repeats; post-fix: 0).

## REL-16's PNG thumbnail is not built, and the reason was never written down

**Found by the M2 gate's tag-to-case audit, 2026-09-01.**

REL-16 (`flow-relationships.md:174`, an M2 **blocker**) bullet 1: "The
PNG shows an inline image thumbnail." The build renders the image
*family glyph* instead. Its test says so in a comment — "not satisfied
by this build; see known-gaps" — and forwards to an entry that does not
exist. Measured: `grep -ci thumbnail docs/dev/known-gaps.md` → 0, with
43 `##` entries in the file as a positive control. So a blocker shipped
knowingly unmet with its justification recorded nowhere, and the
coverage tool scored the case green because the *other three* bullets
are asserted.

**It is not blocked by anything.** `TASK_ATTACHMENT_ITEM_RE`
(`server.ts:833`) already serves individual attachment bytes, which is
what an `<img src>` needs. This is unbuilt, not impossible.

**Why it is not being built here:** the audit that found it was
checking tag-to-case fidelity during M2's gate, and building an image
thumbnail — with its own loading, error and oversized-file states — is
a feature, not a test repair. It also raises questions no case answers:
whether to render the full file inline (a 3 MB PNG per tile) or add a
server-side resize, and what a corrupt image shows.

**What the test asserts today is honest**: the family glyph, the
filename, the human-readable size, and the MIME dispatch — bullets 2, 3
and 4. Bullet 1 is the only gap, and it is now written down where the
test's comment claimed it already was.

## Fifteen M2 cases are uncovered, and were documented nowhere

**Found by the M2 gate round 7, 2026-09-01. No blockers among them:
11 majors, 5 minors** (severities read from the flow docs, not assumed).

Uncovered and, until this entry, absent from known-gaps, `decisions.md`
and `TEMP-RUN-WORKFLOW.md`'s "cannot be satisfied yet" section:

CMT-18, CMT-20, CMT-23, CMT-24, CMT-25, ERR-23, REL-14, REL-47,
TSK-27, TSK-39, TSK-43, TSK-55, TSK-56, XS-10, XS-65.

**CMT-35 was on this list and is now closed** — a *tagging* gap, not a
build gap. Its `editors` mechanism is fully built in core and was
already covered by four tests there; dropping the appended editor from
`recordEditor` reddens all four. Only the `@verifies` tag was missing,
so the tool scored a case uncovered whose behaviour was verified.

**TSK-39 is partial and must not be bare-tagged.** Its first bullet is
exercised by the XS-58/ERR-7 test; its other two are not. Tagging it
would overstate coverage — the same failure that hid TSK-51, in
reverse.

**Why this matters more than the count.** Round 6 reported "70/70
blockers audited — every one", while its own skip list held five
blockers (XS-4, XS-7, XS-8, XS-13, XS-57 — all verified `blocker`
severity). Round 7 audited those five and they hold. So coverage
**understates** verification where a mechanism is tested but untagged,
and a gate report can **overstate** completeness where its summary and
its skip list disagree. Both directions were live in M2 at the same
time.

**Not built here.** These are real gaps in test coverage, not known
defects: the features may work. What is recorded is that nobody has
checked, which is the honest state — and it is now written down rather
than implied by a number.

## TML-48's unreadable notice names neither the task nor the bad value

**Measured 2026-09-01 during the M3 gate, against a live server.**

TML-48's third bullet: "The message names the task and the offending
field value." A hand-edited `start_date: "next tuesday"` produces:

    {"id": "01M1CJZ…", "path": "/…/tasks/01M1CJZ…/task.md",
     "reason": "start_date must be YYYY-MM-DD or full ISO-8601 timestamp"}

`TimelineView.tsx:546` renders exactly `{u.path}: {u.reason}` — a ULID
file path and a generic schema constraint. **No title, no key, and the
offending value `"next tuesday"` appears nowhere.** So bullet 3 is unmet
on both halves. Bullet 2 holds (no `Invalid Date` leaks) and bullet 1
holds under the case's "or flagged in place" reading.

**A41 asserted the opposite** — "the task is named, the offending field
is named" — which made a partial case read as met. That sentence has
been corrected in place rather than deleted, with this measurement.
It is the same failure as REL-16's forward reference to a known-gaps
entry that was never written: a claim in a document standing in for a
check.

**Why it is not fixed here.** Naming the task means the server must
carry a display name for a file it could not parse — the title may
itself be unreadable — and naming the value means the ZodError's
received input has to survive into the envelope. Neither is hard, but
both are server work on a payload the CLI and MCP share, found during a
gate rather than a build.
