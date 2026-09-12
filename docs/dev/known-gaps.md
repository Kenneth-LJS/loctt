# Known gaps

Defects and documentation holes that are real, understood, and not yet
fixed. Each says what is wrong and where the fix belongs, so it can be
picked up without rediscovering it.

This file is not a feature backlog, and not a place for things that
merely might be wrong. Delete an entry when it is fixed.

## Code

### DS-A11Y40 — the checkbox/radio resting border does not clear 3:1 vs bg-surface

**Found 2026-09-06 building the B1 design-system primitives.** The
design-system spec (§1.5) asserts `--border-strong` "is the correct
token; verify 3:1 on build." It does not clear 3:1: measured with the
WCAG formula, `--border-strong` vs `--bg-surface` is **2.16:1** (light
`#A7B1C2` on `#FFFFFF`) and **1.88:1** (dark `#43434A` on `#141416`).
A11Y-40 wants the control boundary at ≥3:1.

`ui/Checkbox.tsx` and `ui/Radio.tsx` use `border-border-strong` as spec'd
— it is the darkest border token the theme has, and going darker to reach
3:1 (`--border-strong` is used app-wide for other boundaries too) would
change every strong border, a semantics call, not a primitive fix. The
checked/focus states are unambiguous; only the *resting, unchecked*
boundary is below 3:1. Fix belongs in `styles/tokens.css` (a dedicated
`--border-control` token at ≥3:1, or deepening `--border-strong` after
checking its other uses), out of scope for the additive B1 build.

### DS-BORDER-SUBTLE — subtle divider still below 3:1 (a semantics fork left for Ken)

**Found 2026-09-06 building the B1 contrast-token fixes.** The
responsive review's T5 says `--border-subtle` is invisible (1.19:1 light
/ 1.16:1 dark vs `bg-surface`). B1 nudged it stronger (light `#DCE2EC`
→ 1.30:1, dark `#2A2A30` → 1.29:1, both kept below `--border-default`'s
1.39/1.36 so the subtle<default ordering holds), but **did not** take it
to the 3:1 a real divider needs: no hairline that still reads as
"decorative" reaches 3:1 without becoming as heavy as `--border-default`.

Spec §2.4 open decision #5 frames this as a genuine fork, not a value
tweak, and it is **escalated to Ken** (see spec, updated): either (a)
strengthen `--border-subtle` to ≥3:1 and accept it reads as a full
border everywhere it is used decoratively, or (b) keep it decorative and
migrate the real-divider call sites (`ListView.tsx:778`, `BulkBar.tsx:110`,
section separators) to `--border-default`. B1 chose neither; it only made
the hairline visible.

### CMT-20 — the comments list has none of the four scale affordances (declined)

**Found 2026-09-04 while covering the CMT batch.** CMT-20 (major, P9)
— "80 comments render without collapsing the page" — is **declined,
not tagged**. `@verifies` has no partial marker, so tagging it would
claim a major case satisfied when most of it is unbuilt (see
decisions.md § 8 A114).

`CommentsPanel` (`apps/web/src/client/comments/CommentsPanel.tsx`)
renders the whole thread in one flat `<ul>` (`list.map`), composer
below. Measured against the four bullets:

| bullet | state |
|---|---|
| list scrollable/paginated, composer reachable without scrolling all 80 | **absent** — no own scroll container, no pagination; the composer sits after all rows in document flow |
| paginated list states the remaining count | **absent** — `useComments` is a plain `useQuery`, not `useInfiniteQuery`; no "Load more" |
| posting scrolls to the new comment | **absent** — `onSuccess` only bumps a reset token; no `scrollIntoView`, no ref |
| a very long single comment truncated with "Show more" | **absent** — `CommentItem` renders the full body via `renderCommentBody` with no clamp |

**The contrast is the activity feed**, which *does* paginate
(`useActivity` / `useInfiniteQuery`, `activity-load-more`,
`activity-scope`) — so the pattern to copy exists one directory over.

**To close:** build a scroll container + post-scroll at minimum
(plausibly a "Show more" clamp in `CommentItem` and pagination in
`CommentsPanel`/`useComments`), then add a CMT-20 spec to
`tests/ui/flow-comments.spec.ts` and delete this entry.

### GIT-30 — Sync against an unreachable remote is a 200 warning, not the error surface the case needs (declined)

**Found 2026-09-04 while covering the git-sync UI batch.** GIT-30
(blocker, P4) — "Sync fails because the remote is unreachable" — is
**declined, not tagged**, correcting A69, which omitted it, and
`GitSyncPanel.tsx`'s header comment, which lists it as covered.

**Measured, not inferred.** With `origin` set to `/nonexistent/path.git`,
`POST /api/git/sync` returns **HTTP 200**
`{updated:false, fetched:false, fetchError:"and the repository exists."}`.
The panel renders its *success* branch (`git-sync-result`,
`data-git-sync="no-op"`) with a warning span, not `git-sync-error`.

Against GIT-30's bullets:

| bullet | state |
|---|---|
| names the remote, says it could not be reached, distinct from "nothing to sync" | **partial/wrong** — the warning does not name the remote, and the `fetchError` is a truncated git-stderr fragment ("and the repository exists.") |
| local state untouched and the panel says so explicitly | **absent** — the success branch has no "local state untouched" line (only the `git-sync-error` branch does) |
| Retry is offered | **absent** — Retry lives on the error branch, which a 200 never reaches |

The `git-sync-error` block is only reachable on a non-2xx (a reconcile
block, or a thrown git error) — the network-down case produces neither.

**To close:** either have core's `sync` raise on an unreachable remote
(so `handleGitSync` hits `gitErrorResponse` and the panel's error branch,
with a message naming the remote), or add a dedicated fetch-unreachable
render to the panel's success branch that names the remote, states local
state is untouched, and offers Retry. Then add a GIT-30 spec and delete
this entry.

### GIT-9/16/19/22/23/25/29/33/34/35/36 — git-sync cases with no engine behind them (declined)

**Confirmed 2026-09-04 during the git-sync UI batch**, re-verifying the
A69 declines that fell in this batch rather than trusting them:

- **GIT-9, GIT-19, GIT-33** — rekey summary + confirm. `RekeyOutcome` is
  flattened to `rekeyed: number` before it leaves `sync`; there is no
  summary surface, no confirm step, no per-key old/new reporting.
- **GIT-16** — delete-vs-edit reconciliation row. No reconciliation data
  model (`ReconcileState` is a 4-field crash sentinel; A69).
- **GIT-22** — advisory-lock warning by filesystem class. No fstype
  detection exists anywhere in `packages`/`apps` (grep with positive
  control, decisions.md A69).
- **GIT-23** — 500-task sync with progress + honest counts. `SyncOutcome`
  is one file-count bucket, and there is no progress channel (no SSE /
  generator / callback in the sync path).
- **GIT-25** — adopt-existing-branch prompt. `enableGit` silently adopts
  a LocTT-written branch (or throws on a foreign one); it neither shows
  the branch head nor asks adopt-or-stop, and the panel has no UI for it.
- **GIT-29** — non-fast-forward vs auth distinction. `gitErrorResponse`
  maps everything non-conflict to one generic 500, and `PushResult.error`
  is an opaque string — the two causes cannot be told apart.
- **GIT-34, GIT-35, GIT-36** — malformed-remote-file, newer-schema-version,
  and missing-worktree surfaces. Each needs task-and-field-granularity
  reporting or a schema-version/worktree guard that the file-count sync
  model does not carry.

Each is a real product requirement whose engine does not exist; full
reasoning in decisions.md A69. **To close:** build the missing engine (a
ticket, not a wire-up), then tag the case.

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

### `initLoctt` accepts any non-empty prefix — no format validation

**Noted 2026-09-06** during the Phase Z web-server error-mapping fix
(see decisions.md A140). The adversarial verifier observed that
`POST /api/init {"prefix":"bad prefix!!"}` — spaces and punctuation —
was accepted end-to-end and created a tracker with that prefix (201).

The only prefix check anywhere is `initLoctt`'s non-emptiness test
(`packages/core/src/init/init.ts:182`); `InitRequestSchema`
(`packages/contracts/src/service-schemas.ts`) declares
`prefix: z.string().optional()` with no pattern. So a prefix with
characters that later collide with key parsing or display can be
committed at init time.

**Reproduce:** `POST /api/init {"prefix":"bad prefix!!"}` against an
empty `.loctt/`, or `initLoctt(root, { prefix: "bad prefix!!" })`.

**Where the fix belongs / open question:** whether a prefix-format rule
should live in core `initLoctt` (so every surface enforces it), in the
web wizard, or in `InitRequestSchema` is unsettled — and what the rule
is (letters + `-`? uppercase? a max length?) has no decision on record.
Deliberately not added inside the A140 error-mapping fix to avoid
scope-creeping a mapping change into a new validation requirement. Needs
a decision, then a core-level test that a malformed prefix is refused
before anything is staged.

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
depend on — an escalate-by-rule change (see `lessons.md` § Process),
not something a UI ticket decides.

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

So the CLI says it too, and MCP shares the same lookup. By the
which-layer rule (`lessons.md` § Core / surface parity), the fix owes
all three surfaces.

**The capability already exists one route away.** `GET /api/tasks`
returns `unreadable[{id, path, reason}]` for the identical file, with
the full path and the line and column of the parse error. The list
route degrades correctly; the detail path does not.

Fails **TSK-54** and **XS-51**, which require the surface to say the
file could not be parsed, name the path under `.loctt/tasks/<id>/`,
and give the line or field. Recorded as *failing*, not uncovered — a
"not covered" note would hand the next ticket a false baseline.

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

## The timeline has no virtualization: TML-21, TML-26, TML-32 unmet (TML-27, TML-30 covered for their satisfiable bullets)

**Found:** M3.3b (2026-08-30). **Not fixed.**

**Update 2026-09-04:** TML-27 and TML-30 are now **tagged and
mutation-verified** for the bullets that hold. TML-27's case says
"sticky *(or otherwise identifiable)*" — identifiable headers, per-band
collapse and the `(archived)` marker all hold, so the case is satisfied
without the sticky mechanism (verified: dropping the `(archived)` suffix
reddens the test). TML-30's "each overlapping bar gets its own row"
holds (the part this entry always said held). What remains genuinely
unmet is the **windowing/virtualization** layer, which TML-21, TML-26
and TML-32 depend on and which is a build of its own — those three stay
uncovered. This entry previously listed all five as unmet, which was
true when written but conflated "no virtualization" with "case not
satisfiable".

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

REL-32 was already noted as timing-fragile when written: its first two
mutations were rejected, not scored — both turned it red on a
`waitForResponse` timeout rather than on the convergence assertion,
which is a red for the wrong reason.

**Why this is logged rather than fixed here:** a race test that asserts
*which* writer wins is asserting something the system does not
guarantee. The honest fix is to assert what the case actually requires —
that the two tabs **converge** and that the loser **is told** — without
pinning which order they converge on. That is a rewrite of the
assertion, on a case (REL-32) owned by M2.5a, during M3.4's
verification. Out of scope here; it needs its own look.

**Do not read a green full run as evidence these are fixed.** One in
four runs was clean with all three still fragile.

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

## `npx tsc --noEmit -p apps/web` typechecks nothing and always exits 0

**Measured 2026-09-01 during M4.3.**

`apps/web/tsconfig.json` is a **solution-style** config:

    { "files": [], "references": [
        { "path": "./tsconfig.server.json" },
        { "path": "./tsconfig.client.json" } ] }

`"files": []` with `--noEmit` means the project has no input files, so
`tsc` compiles nothing and exits **0** — regardless of how broken the
source is. Project references are only followed under `--build`.

This is a trap for the mutation protocol, which requires proving a
mutation compiles before trusting that it reddened a test. During M4.3
a mutation that put an out-of-scope identifier into
`DiagnosticsPanel.tsx` was reported as compiling cleanly by
`npx tsc --noEmit -p apps/web`. The same tree under `npm run typecheck`
gave:

    src/client/settings/DiagnosticsPanel.tsx(53,22):
      error TS2304: Cannot find name 'check'.

**Use `npm run typecheck`** (or `npx tsc --build`) to typecheck the web
app. A per-project `-p apps/web` invocation is silently vacuous, and
its exit code is worthless.

**To reproduce:** introduce any type error under `apps/web/src`, then
run `npx tsc --noEmit -p apps/web; echo $?` — it prints `0`.

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

Uncovered and, until this entry, absent from known-gaps and
`decisions.md`:

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

## NEW-3's status pre-fill is unenactable, and `initialStatus` is dead plumbing

**Found by the M3 gate round 2, 2026-09-01.**

NEW-3's first bullet needs "+ Add task" **on a board column** to
pre-select that column's status. Only a **board-level** button exists
(BRD-40's, which is a different control on a different case).

**M3.1 built per-column controls and removed them**: a column still
rendering for a status deleted from `workflow.yaml` since page load
then carried a create control,
and that is what broke BRD-42. The call is sound. **Its consequence
for NEW-3 was never recorded**, and NEW-3 stayed counted among M3.4's
satisfied cases.

**`initialStatus` is plumbed and unreachable.** It threads through
`CreateTaskProvider` and `CreateTaskModal`, and both call sites are
`createTask.open()` with no argument (`Header.tsx:102`,
`BoardView.tsx:392`). Measured: neutering the pre-fill
(`&& false as boolean`) built clean and left **all 44** create tests
green — the tenth built-but-uncalled capability found in this run.

**What the test actually covers**, now that its title says so: bullets
2 and 3 — the status is editable before submit, and the card lands in
the column chosen. Bullet 1 is not covered because it cannot be
reached.

**Not fixed.** Restoring per-column controls means re-opening BRD-42's
regression, which needs the stale-column case handled first. That is a
build decision, not a test repair, and it was found during a gate.

## PRU-17's "clear the project field" option has no core support

**Found building M4.1, 2026-09-01.**

PRU-17 requires the delete-with-references dialog to offer **either** a
remap target **or** an explicit "clear the project field on these
tasks" choice, so that "there is no default that silently orphans the
12 tasks".

**Only remap exists.** `deleteProject` (`packages/core/src/projects/
manage.ts`) takes `{hard?, remapTo?}` and nothing else; with tasks
present and no `remapTo` it throws. Measured: `grep -rn
"clear_project\|clearProject" packages/core/src apps/web/src/server`
returns nothing, while the positive control `bulkMoveTasksToProject`
is found in `packages/core/src/task/move.ts:173`.

`TaskFrontmatterSchema.project` **is** `.optional()`
(`packages/contracts/src/task.ts:53`), so a cleared project is
representable on disk. The work is not the field, it is the
transaction: the remap runs through a journal entry
(`kind: "remap_project"`) with an idempotent replay handler, and a
clear-instead-of-remap needs its own journal kind and recovery path or
a crash mid-clear leaves tasks half-updated with no way to finish.

**The dialog therefore offers remap only**, and the no-silent-orphan
half of the case *is* satisfied — the server rejects the delete when
tasks exist and no target is given, so confirming without a choice is
impossible. What is missing is the second option, not the guard.

**To reproduce:** Settings → Projects → delete a project holding
tasks. The dialog offers a remap select and no "clear" alternative.

## `DELETE /api/projects/:id` archived instead of deleting

**Found and FIXED in M4.1, 2026-09-01** — recorded because it was
silent, untested, and shipped.

`handleDeleteProject` called `deleteProject(locttDir, id, {remapTo})`
and **never passed `hard: true`**, so every DELETE took core's
soft-delete branch and merely archived the project. `remap_to` was
accepted and then ignored, because the archive branch rejects it.
Measured before the fix: `grep -n "hard" apps/web/src/server/server.ts`
returned nothing, against a positive control of two `deleteProject`
hits.

No test caught it: all 232 server tests passed both before and after
the fix. PRU-17, PRU-18, PRU-33 and PRU-34 all depend on a real
delete, and none of them had a working endpoint to build on.

**Fixed** by passing `hard: true` unless `?soft=true` is given.
Archive keeps its own route (`PUT` with `archived: true`), so DELETE
now means delete.

## `PUT /api/projects/:id` silently ignored `archived`

**Found and FIXED in M4.1, 2026-09-01.**

The handler parsed `{name?, default?}` only. A client sending
`{archived: true}` got a 200 and an unchanged project — the field was
dropped without comment, and there was no project archive/unarchive
route anywhere (unlike users, which have both). Core's
`archiveProject` / `unarchiveProject` were exported and called by
**nothing on any surface** — two more of the built-but-uncalled
capabilities this run keeps finding.

Caught by the PRU-7 UI test, which archived a project and found the
row still active.

**Fixed** by handling `archived` in `handleUpdateProject`.

## SET-22's "every day non-working" state cannot be reached, so its other bullets are untestable

**Found in M4.2, 2026-09-01. NOT fixed — see decisions.md A67.**

SET-22 describes a tracker whose calendar has no working days, and
asks what date pickers, working-day arithmetic, and Diagnostics do in
that state. `CalendarConfigSchema` rejects `working_days: []`, so no
supported path produces it: the panel blocks before the request (A67),
the API returns 400, and a file hand-edited that way makes
`loadCalendarConfig` throw rather than yielding an empty week.

The bullet that *is* satisfied is the one about the user being told:
the panel names the consequence ("working-day computations … cannot
resolve") and disables Save. The other three describe behaviour of a
state the schema forbids.

**To reproduce.** Uncheck all seven days on `/settings/calendar`, or
write `working_days: []` into `calendar.yaml`.

## Deleting an in-use workflow key with no remap can surface a developer-facing message

**Found in M4.2, 2026-09-01. Guarded by a test; the message path still exists.**

`applyWorkflowEdit` refuses such an edit twice over. The intended
refusal is `validateRemapCoversDeletions`, which names the key and what
is missing. If that check is ever bypassed or its coverage narrows, the
edit proceeds into `executeWorkflowRemap` and `applyScalarRemap` throws
`internal: missing status remap for "in_review" on task T-1` — which the
web route surfaces **verbatim** in the 400 envelope's `message`, the
field the UI shows the user.

Measured: disabling `validateRemapCoversDeletions` leaves the write
correctly refused with nothing written, and the user-visible message
becomes that `internal:` string. Both paths return 400 and write
nothing, so a status-code assertion cannot tell them apart.

`apps/web/src/server/server.workflow-panels.test.ts` now asserts the
message does **not** start with `internal:` and does name the key, so
the ordering is held in place. The underlying shape — a deliberately
developer-facing exception reaching `message` rather than `detail` —
is untouched, and is a candidate for K13's error-vocabulary audit.

## SET-13's third bullet still reads as the opposite of SET-27

**Found in M4.4, 2026-09-01. Documentation drift, not a code defect.**

`flow-settings.md` SET-13 says a pin whose view was deleted is "dropped
**silently** from both the panel and the sidebar". SET-27, 115 lines
below in the same file and carrying the same P7 tag, says the panel
"**says** the pins were removed because their views no longer exist,
rather than silently emptying".

`docs/dev/ui-test-cases/README.md:191-198` already resolves this: "No
carve-out for per-user preference drift … This resolves the SHL-32 /
SET-13 / SET-27 / XS-28 disagreement in favour of the explaining
cases." SET-13 is named explicitly as one of the corrected cases; its
bullet text was simply never updated.

M4.4 built to SET-27 and did **not** edit SET-13 — the flow docs are
the specification and are read-only. The risk is that the next agent
reads SET-13 first, treats the contradiction as unresolved, and either
stops or builds the silent behaviour. Recorded as A71.

**To reproduce.** Read `flow-settings.md` SET-13 and SET-27 without the
README's P7 section.

## `system` theme following a live OS change is not covered by a test

**Found in M4.4, 2026-09-01. Behaviour exists; the assertion does not.**

SET-11's fourth bullet: "`system` follows the OS preference live —
toggling the OS theme repaints without a reload." `useTheme` installs a
`prefers-color-scheme` listener while the preference is `system`, and
`useTheme.test.tsx` covers the listener in isolation.

What is *not* asserted is the bullet end-to-end after M4.4's change:
that a user whose `settings.yaml` says `theme: system` still tracks the
OS. Playwright can emulate `prefers-color-scheme`, so this is testable;
it was left out because the three other SET-11 bullets carry the case
and the fourth needs a fixture-level colour-scheme override the UI
suite does not currently set up.

**To reproduce.** Set `theme: system` in `settings.yaml`, load the app,
and toggle the OS appearance.

## SET-2's "no unimplemented placeholder" is only verified for the Personal group

**Found in M4.4, 2026-09-01. Not a defect — a case that spans tickets.**

SET-2's last bullet is "Every panel reachable from the nav resolves —
no nav item routes to a 404 or an unimplemented placeholder **at M4
close**". M4.4 built the four Personal panels and asserts those four
resolve.

Nine sections still render `settings-not-built`: General, Labels,
Milestones, Sprints, Saved views, Board columns, Timeline defaults,
Sync, Diagnostics. They belong to M4.3 and M4.5–M4.8, so the bullet
cannot be satisfied until the last of those lands.

The existing SET-2 test (`flow-settings-projects-users.spec.ts`) covers
the grouping and active-marking bullets; M4.4's adds the Personal
resolution check. **Whichever ticket closes M4 owes the full sweep** —
assert every entry in `SETTINGS_SECTIONS` renders a real panel, and
delete the `built` flag if it has no remaining false values.

**To reproduce.** `grep 'built: false' apps/web/src/client/settings/sections.ts`.

## A saved view on a deleted custom field returns zero rows with no warning

**Found in M4.5, 2026-09-01. Blocks VUE-21.**

`listTasks` accepts an `onWarning` callback
(`packages/core/src/query/list.ts:72`) and calls it when a *saved view*
references something `validateQuery` rejects — the deliberate asymmetry
noted in VUE-32's core resolution: an ad hoc query throws, but a view
that used to work warns and still runs.

The web server never passes it. `grep -n onWarning
apps/web/src/server/server.ts` returns nothing, against three
`listTasks(` call sites as a positive control. So the warning is
raised in core and dropped on the floor, and the request returns **200
with zero rows** — precisely VUE-21's stated failure mode, "it does not
return zero rows presented as a legitimate empty result".

Fixing this is a route change (thread `onWarning` into the response as
a non-fatal `warnings` field, the way `unreadable` already reports
per-file parse failures), plus a UI banner. The CLI and MCP surfaces
need the same channel, so the response shape should be settled once.

**To reproduce.** In a fresh tracker, write a view whose query is
`fields.squad = platform` with no `squad` custom field in
`workflow.yaml`, then `GET /api/tasks?view=<name>` → 200, `items: []`,
no warning anywhere in the body.

## `PUT /api/user-settings` takes no state lock

**Found:** M4.8 · 2026-09-01 · **Severity:** low

`handlePutUserSettings` (`apps/web/src/server/server.ts:2567`) calls
`saveUserSettings` directly, with no `withStateLock`. Every other
mutating path takes the lock first.

**To reproduce.** Hold the state lock from another process (core's
`withStateLock`), then `PUT /api/user-settings`. It returns 200 and
writes, where a task write in the same window correctly returns a
`conflict` envelope.

**Why it may not be a defect.** User settings are machine-local,
per-checkout state — XS-52 explicitly calls them caches rather than
tracker data, and says their absence must not surface an error. Two
processes on the same checkout writing the same user's settings is a
last-writer-wins situation with nothing to corrupt.

**Why it is recorded anyway.** The asymmetry is undocumented, and the
next person to add a settings field that *is* tracker-scoped will
inherit an unlocked write path without noticing. If it is deliberate,
it deserves a comment at the handler saying so.

SET-39's spec was pointed at `PUT /api/workflow` (genuinely
tracker-scoped and genuinely locked) rather than at this path.

## The coverage gate reads case IDs out of prose, not only out of tags

**Found:** M4.8 · 2026-09-01 · **Severity:** medium (it inflates the gate)

`tools/coverage/main.ts` counts a case as covered when the token
appears near `@verifies` anywhere in a scanned file — including inside
a comment that is *explaining why the case is not covered*.

**To reproduce.** Write, in a comment:

    // Deliberately NOT tagged `@verifies A11Y-2`. …

then run `npx tsx tools/coverage/main.ts --require A11Y-2`. It reports
the case covered. Rewording the comment to avoid the literal token
flips it back to uncovered — measured both ways during M4.8, a swing
of one case.

**Why it matters.** The failure direction is the bad one: prose that
argues a case is *unmet* makes the gate believe it is met. Any comment
quoting a tag — a TODO, a decision note, a review remark — silently
inflates the count, and nothing in the output distinguishes a real tag
from a mention.

**Workaround used in M4.8.** Comments that discuss an untagged case
refer to it as "that case" rather than repeating the ID next to the
word `@verifies`. This is fragile: the next person to quote a tag in a
comment will re-introduce it without knowing.

**A fix would be** to require the tag to be the first non-space content
of its comment line — `// @verifies X` — and ignore occurrences
elsewhere. That is a change to the tooling, not to any ticket's cases,
which is why it was recorded rather than done inside M4.8.

## `field != null` does not filter — it returns everything

**Measured 2026-09-02 during M4.9, on a live server with a seeded
tracker (1 task with a milestone, 2 without).**

    ?query=milestone != null   → 3 tasks  (T-1 milestone=<id>,
                                           T-2 milestone=None,
                                           T-3 milestone=None)

The predicate matches rows whose field is *absent*, which is the exact
opposite of what it asks. Not milestone-specific — measured the same
for `assignee`, `sprint` and `project`, all returning 3 of 3.

**Positive control:** `?query=milestone = "<ulid>"` returns exactly 1,
so the query path works; only the `!= null` comparison is wrong.

The request answers **200 with an empty `warnings` array** — so nothing
anywhere signals that the predicate did not apply. Independently found
twice on the same day, by me and by the M4.9 build agent.

**Why it matters beyond a wrong result.** It fails *silently and in the
permissive direction*: a user filtering for "has a milestone" gets
their whole task list back and nothing says the filter did not apply.
A predicate that returns too much reads as "no matches were excluded"
rather than as an error.

**Not fixed here.** It is a core query-evaluator defect on a path the
CLI, MCP and web all share, and no M4.9 case asks for it — M4.9's
orphan hook filters client-side instead. Fixing it means deciding what
`!= null` should mean for an optional field (never-set vs explicitly
cleared), which is a semantics call, not a patch.

**To reproduce:** seed at least one task *with* the field and one
*without*. A tracker where every task has the field, or none does,
cannot discriminate — my own first probe had a single task and showed
the correct-looking answer.

## MSL-35 · Milestone progress cannot fail per row, so a per-row error is unrenderable

**Found:** M4.9 · 2026-09-02 · **Status:** open, case left uncovered

MSL-35 requires a failed progress computation to show an error
affordance **in place of the numbers**, **naming the milestone**, with
a retry, **while other milestones' rows continue to render their own
progress**. The last bullet cannot be satisfied as the server stands.

**Measured, not assumed:**

- `withProgress` (`apps/web/src/server/server.ts`) calls
  `milestoneProgress` **once for the whole list**, and
  `referenceProgress` (`packages/core/src/task/progress.ts`) does a
  single corpus scan by design. It succeeds for every milestone or
  throws for all of them — there is no per-milestone failure.
- `handleListMilestones` does not catch, so a throw becomes a
  whole-response 500 (`server.ts` ~4408). Nothing partial reaches the
  client.
- `withProgress` fills any id missing from the map with
  `{done:0,total:0,discarded:0,fraction:0}`, so a missing computation
  is indistinguishable from a real zero — producing exactly the `0 / 0`
  the case forbids. Verified against a live server: every item in a
  `?progress=true` response carries a `progress` object; it is never
  `undefined`.

**To reproduce.** Seed a milestone, request
`GET /api/milestones?progress=true`, and confirm every item has
`progress`. Then corrupt a task file — the response still answers 200
with full progress, because a malformed task is skipped rather than
thrown on, so even that does not produce a per-row failure.

**What M4.9 built anyway.** The client half exists and is unit-tested:
`progressState(undefined)` returns `kind: "unavailable"`, and
`ProgressReadout` renders a named, retryable error in place of the
numbers rather than `0 / 0`. It is unreachable from the current server.
The UI spec covers the whole-list failure (a named error state with a
working retry, never `0 / 0`) under a test that deliberately carries no
tag for that case.

**A fix needs server work:** either a per-milestone progress endpoint,
or a partial-success shape (`progress | {error}` per item) from
`handleListMilestones`, plus removing the silent zero fallback in
`withProgress` so a missing computation arrives as `undefined`.

## MSL-29 · A hand-edited `workflow.yaml` is not seen until a page refresh

**Found:** M4.9 · 2026-09-02 · **Status:** open, case covered for the
behaviour it actually specifies

MSL-29 says "**on refresh**, milestones containing tasks in that status
show an increased numerator", and that is what M4.9 built and tests:
recategorising `backlog` from `pending` to `completed` takes the
worked example from `4 / 8` to `8 / 8` after a reload.

The gap is the case's second bullet, "no cached progress figure
survives the config change", read strictly. A hand-edit of
`workflow.yaml` fires no mutation, so nothing invalidates the query,
and the 30s stale window legitimately serves the old figure to a
client-side navigation away and back.

**To reproduce.** Open `/milestones`, hand-edit a status's `category`
in `workflow.yaml`, then navigate to a milestone detail and back
(without reloading) inside 30 seconds. The old numerator is still
shown. Measured — a navigate-and-return version of the MSL-29 spec
fails against correct code.

**Note on what the query key does and does not buy.** The progress
query key is `["workflow", "milestones-progress"]` (A92), so a workflow
edit made *through the settings panel* drops the figure with no reload.
That is a real invalidation path and worth having. It does not help a
hand-edit, and it is not what the reload-based spec proves — a reload
drops the whole cache, so removing `"workflow"` from the key survives
that test. The spec says so in a comment rather than implying otherwise.

**A fix would be** a config file-watcher pushing an invalidation, or
polling `workflow.yaml`'s mtime. Both are app-wide mechanisms, not
milestone-specific, which is why this was recorded rather than built
inside M4.9.


## SET-8's weight sorting is not built, and its test cannot see that

**Found:** M4 gate round 2 · 2026-09-02 · **Status:** open, case
partially covered.

SET-8 bullet 2: "Setting weights XS=1, S=2, M=3, L=5 and sorting the
list by that field orders rows by weight, not alphabetically."

**Measured, two ways.**

1. **The schema does not accept a per-value weight.** Adding
   `weight: 1` to a custom enum's values gives
   `custom_fields[0].values[0] has unrecognized key(s): "weight"`, and
   the tracker will not load. The `weights` map that *does* exist
   (`contracts/src/workflow.ts:302`) is an **estimation** feature —
   its own docstring says "for `custom_enum` estimation" and "Burndown
   uses `sum(weights)`" — not a sort key.

2. **`compareTasks` applies the weight map only to `priority`**
   (`core/src/query/list.ts:397-410`: `if (field === "priority")`).
   Every other field, weighted or not, falls through to a string
   compare on the raw key. So even if the schema accepted weights,
   sorting would ignore them.

**Why the test does not catch it.** SET-8's test asserts a
`data-sort-basis` attribute on the *settings panel* and never sorts a
list. The panel correctly reports which basis it *would* use; nothing
checks that a sorted list honours it. Bullets 1 and 3 hold; bullet 2
is untested and unmet.

**Not fixed.** This is a schema addition plus a core sort change on a
path the CLI, MCP and web share — a feature, not a repair, and no
other case depends on it. Building it inside a section gate would be
inventing scope.

**To satisfy it later:** add an optional numeric `weight` to the enum
value schema, extend `compareTasks` to consult a per-field weight map
rather than only `priorityMap`, and assert a **sorted list's row
order** — not the panel's attribute.

## PRU-46's pending-rename banner is unreachable dead code

**Found:** M4 gate round 2 · 2026-09-02 · **Status:** open, needs
Ken's ruling. Measured end to end, not argued.

PRU-46 asks for an interrupted prefix rename to be **surfaced**: the
panel shows the project mid-rename, names the prefix it was moving
from and to, and offers a control to complete it.

**The web server auto-heals before any handler runs.**
`server.ts:4290-4295` calls `recoverInterruptedPrefixRename` on
**every** `/api/*` request, with the comment "Finish an interrupted
prefix rename before any handler reads a task key … every key the
request would go on to return could be stale."

So there are exactly two outcomes: recovery completes and deletes the
sentinel, or it errors and the request 500s. A sentinel can never
survive to `handleListProjects`.

**Measured** with a schema-correct `.loctt/local/prefix-rename.yaml`
written *after* server boot, then one `GET /api/projects`:

    pending_prefix_rename present: False
    Web App prefix now: SITE-        (flipped by the request itself)
    sentinel on disk: gone

So `pending !== undefined` in `ProjectsPanel.tsx:288` can never be
true, and `handleCompletePrefixRename` (`server.ts:1481`) can never
find anything to complete. Both were built for a boot-only-recovery
design the middleware forecloses.

**Why this needs a ruling rather than a patch.** Auto-recovery
satisfies PRU-46's headline — the rename is never *silently
half-applied*, because it is never half-applied — and its fourth
bullet, "a control completes the change; it does not require dropping
to the CLI", is satisfied more completely than the case imagined: no
control is needed. But bullets 1-3 are physically unreachable from a
browser. The two candidate reconciliations are:

**(a) Keep auto-recovery.** Retag PRU-46 as satisfied-by-auto-heal,
delete the banner and the completion endpoint as dead code, and assert
the healed outcome instead. Cost: the case's wording no longer
describes the product, and a user whose rename was interrupted is
never told it happened.

**(b) Make recovery boot-only or GET-exempt** so the panel surface
works. Cost: a handler could then return stale keys — precisely what
the middleware comment says it exists to prevent — and the CLI and MCP
use the same auto-recover pattern, so they would diverge.

**A test bug found alongside, and fixed:** the sentinel's on-disk shape
is `PrefixRenameStateSchema` (`contracts/src/state.ts:64`) — snake_case,
`.strict()`, and `started_at` is required. A malformed sentinel does
not fail silently: `readPrefixRenameState` throws, and **every** `/api/*`
request then 500s.

## The coverage gate's truncation notice is easy to grep away (not a defect)

**Recorded because I got this wrong and the wrong version was committed
first.** `tools/coverage/main.ts` caps its scoped listing at 40 cases —
and it *does* announce the truncation, `… and N more` at line 112. The
tool is honest.

What is not obvious is how easily that notice disappears. Filtering the
output through a case-ID pattern (`grep -oE "^    [A-Z]+-[0-9]+"`, the
natural way to collect the list) discards the one line that says the
list is partial. At M4 that turns 112 uncovered cases into 40 with no
visible sign, and the count above still reads 112 — so the output looks
self-contradictory when it is merely filtered.

I concluded twice from that filtered output that the gate was
inconsistent with itself, and wrote it up as a tooling defect before
reading line 112. **The count is authoritative; a filtered list is not.**

**To get the full list reliably**: `--require <ids>` prints every
untagged case with no cap, so a chunked `--require` over the whole index
works, as does calling `report()` from `scan.ts` and reading
`result.uncovered` directly.

## Uncovered cases are accounted for by group, not by case

Every one of the 136 uncovered cases appears somewhere in the run's
records. But 54 of them appear **only in their ticket's `Cases:`
roster** — no per-case reason anywhere. Their tickets' Status rows
explain them collectively (M4.3: "26 of them cannot be built" because
core has no `reconcile`; M4.1: "26 listed uncovered, honestly"), which
is real accounting, not silence.

The failure mode this permits is specific: a case can be absorbed into
an aggregate and never individually named, and nothing then flags it.
That is exactly what happened to **A11Y-10, A11Y-11, A11Y-29 and
A11Y-39** — three of them blockers — which M4.8's row described as
"25 itemised by what each needs" while itemising 21. All four turned
out to be *built and merely untested*, so the aggregate concealed
finished work rather than missing work.

**Check that matters**: for each uncovered case, does a reason exist
outside its ticket's roster? Where the answer is a group reason, that
is fine — but the group must name its members, or the next audit
cannot tell a deliberate decline from an omission.

## Escape does not cancel a keyboard relationship reorder (REL-15)

`RelationshipsPanel.tsx:509` — the Escape branch sets `grabbed` to null
and announces "Move cancelled". **It performs no move.** The row stays
wherever the arrow keys left it, and the writes have already landed.

Two things make this wrong, and both are contradicted by comments
sitting directly above the code:

1. Line 440 says `grabbed` holds "where it started, so Escape can put it
   back (REL-15's third bullet) **without a write ever leaving**". But
   `keyboardMove` (line 449) calls `onMove(from, to)` on *every* arrow
   press, so each keystroke is a real rerank write. There is no pickup
   buffer.
2. `keyboardMove` then does `setGrabbed(to)` — overwriting `grabbed`
   with the **current** position on every step. Even if Escape did move,
   the origin it needs was destroyed by the first arrow press.

REL-15's third bullet is therefore unmet.

**Not an A11Y-29 bullet — I got that wrong.** I first filed this against
A11Y-29 and told the build agent so. A11Y-29 has exactly three bullets
(reorder + announce, timeline both edges, neither pointer-only) and none
mentions cancelling. The "cancelling restores the original position"
wording is **A11Y-28**, the board's keyboard drag alternative, which is
a different case on a different surface. The agent caught this and
tagged A11Y-29 on its own three bullets, correctly.

**Reproduce**: open a task with three ranked relationships, focus a
reorder handle, press ArrowDown twice, then Escape. Expected: the row
returns to position 1. Actual: it stays at position 3, and the file on
disk has two rerank writes.

**The trap for whoever fixes this**: a test that asserts only the
"Move cancelled" announcement passes against the broken code. Assert
the row's position — and read the task file, since the writes are the
half that actually escaped.

**Shape**: same as A11Y-45 — a comment describing behaviour the code
never implemented, which reads as done to a reviewer.

**The existing REL-15 test is not vacuous — it is partial.**
`tests/ui/flow-relationships.spec.ts:738` asserts the row moved, the
announcement text, *and* the rank on disk. It is a good test. It simply
never presses Escape, so it covers bullets 1 and 2 and claims all three.
That is the `@verifies`-has-no-partial-marker problem again, not a test
asserting the bug: nothing needs deleting, only extending.

## Test runs leak temp trackers until the disk fills (tooling)

The integration and UI fixtures create trackers under `$TMPDIR` as
`loctt-<name>-<random>` and do not always remove them. After one long
session this machine held **5,521** such directories totalling 516 MB,
and free space reached 1.0 GiB of 460 GiB.

**How it presents — and why it is worth writing down**: not as "disk
full", but as ordinary-looking test failures.

```
fatal: Unable to create '…/T/loctt-unreadable-9c8yLO/.git/index.lock':
No space left on device
```

14 integration tests across `git/`, `cli/` and `mcp/` went red at once,
including several whose names suggest a real defect ("refuses to adopt a
configured branch holding unrelated work", "unreachable remote: publish
fails loudly"). Re-running after freeing space: **exit 0, 457 tests.**
Nothing was wrong with the code.

**Check this before diagnosing a broad, unfamiliar failure**, especially
one spanning unrelated suites or mentioning locks, writes, or `ENOSPC`:

```bash
df -h ~ ; ls -d "${TMPDIR}"loctt-* 2>/dev/null | wc -l
```

**Cleanup** (age filter so a live run's fixtures survive):

```bash
find "${TMPDIR}" -maxdepth 1 -name 'loctt-*' -type d -mmin +5 -exec rm -rf {} +
```

**Where it comes from, measured**: `tests/README.md` documents a global
`afterAll` that sweeps stale workspaces — but that sweep is scoped to
`tests/workspace/`, and 60 core test files instead call
`mkdtemp(join(tmpdir(), "loctt-…"))`, outside its reach. All 60 do call
`rm` on the happy path, so what accumulates is the residue of runs that
failed, were interrupted, or were killed mid-suite — and this session
killed several.

**Real fix**: either widen the documented sweep to `$TMPDIR/loctt-*`
(with an age filter, so a concurrent run's fixtures survive), or move
core's fixtures under `tests/workspace/` where the existing sweep
already reaches. The second is smaller and removes the discrepancy
between the README and the code rather than adding a second mechanism.

**Also note**: each build worktree carries its own `node_modules`
(~293 MB), because a shared one breaks the vite config resolution.
Three concurrent worktrees is most of a gigabyte before any test runs.
## Removing a worktree leaves its `loctt ui` server running (tooling)

`git worktree remove` deletes the directory; it does not stop anything
the worktree started. The UI fixture spawns
`apps/cli/dist/index.js ui --port <n> --no-open` as a child, and when a
run is killed — or the worktree is harvested while a server is up — that
process survives with no parent and no directory.

Measured on this machine after a day of building: **three orphaned
servers**, from `.claude/build-m47` (two) and `.claude/fix-cmt31` (one),
the oldest alive **over 25 hours**, all pointing at worktree paths that
no longer exist.

**Why it is worth a gap entry rather than a shrug.** They are not idle.
Each holds a port, a node heap, and file watches against a deleted tree,
and they compete with a live suite for the same machine. A build agent
spent a substantial part of its budget diagnosing disk and timing
pressure before finding these were part of the picture — and the
symptom, again, was test failures that looked like defects.

**Find and clear them** (check the worktree still exists before killing,
so a live run is not taken down):

```bash
ps -eo pid,etime,command | grep 'cli/dist/index.js ui' | grep -v grep
```

**FIXED 2026-09-12.** `server-harness.ts` now has a `registerServerChild`
that both the plain and git fixtures call right after spawning `loctt ui`.
It keeps a live-children set and, on the runner's own `SIGINT`/`SIGTERM`/
`exit`, SIGKILLs every still-running child — so a run killed mid-suite
takes its servers with it, the exact moment the orphan used to be created.
Per-fixture `finally` teardown still runs on the happy path and calls the
returned `unregister`. (A server started outside the test harness — a bare
`loctt ui` whose worktree is then removed — is still the user's to stop;
this fix covers the test-suite orphans that were the measured problem.)

**Related**: `git worktree remove --force` on a tree whose suite is still
running will orphan the server every time. Stop the run first.

## A displaced body is not carried by a later backup (M5.1)

**Found:** 2026-09-02, building M5.1 · **Case:** BAK-C13 / K17 ruling 6

`--overwrite` preserves the body it displaces as
`.loctt/tasks/<id>/displaced-body-<ulid>.md`, named in the report. That
file is **not** picked up by a subsequent `loctt backup`: the export
carries `task.md`, `_comments.yaml`, `_history.yaml` and the contents
of `attachments/`, and a displaced body is none of those.

So the sequence "overwrite-restore, then back up, then restore
elsewhere" loses the preserved text — while the report that named it
has long scrolled away.

**Not fixed here, deliberately.** The alternatives each cost something
that needs a decision rather than an agent's preference:

- Carrying every loose `.md` in a task directory makes the backup
  format depend on whatever anyone drops there.
- Writing displaced bodies into `attachments/` would make them show up
  in the task's attachment list in every UI, which is a product change.
- A dedicated record kind in the format is the clean fix, and is the
  one I would propose — but the format is now specified by 24 cases and
  adding a record kind mid-build is scope no case describes.

**To reproduce:** restore with `--overwrite` over a task whose body
differs, confirm `displaced-body-*.md` exists and is named in the
report, then `loctt backup` and grep the JSONL for its text — absent.

**Mitigation today:** the path is in the restore report, and the file
stays on disk in the tracker, so it survives everything except a
round-trip through a backup.

## Long UI runs get killed with exit 144, and it is not the code (tooling, 2026-09-02)

**Not a product defect — recorded so the next agent does not debug it as one.**

The UI suite (`playwright test --config tests/ui/playwright.config.ts
--workers=1`) ran to completion once during M5.1: **657 passed, 1
skipped, 0 failed, exit 0**, in 26.7 minutes.

Two later attempts were both killed with **exit code 144** (`SIGXFSZ`,
signal 16):

| Attempt | Killed at | Free disk at kill |
|---|---|---|
| Full suite re-run | test 147, mid-run | ~155-320 MiB |
| Per-spec-file slices | slice 3 of 22, test 11 | **1.2 GiB** |

Both logs end on a **passing** test with no error text, no `ENOSPC`,
and no failed assertion. Every test that ran, passed.

**Disk was my first diagnosis and it was wrong.** The slices were
killed with 1.2 GiB free — four to eight times the headroom of the
first kill — and the two jobs died within about a minute of each other
in wall-clock terms regardless of what each was doing. That is an
external, time-based termination of long-running **background** jobs,
not resource exhaustion. Disk pressure is real on this machine and
worth checking, but it does not explain exit 144.

**What to do:**

- Run the UI suite in the **foreground** with a generous timeout, not
  as a background task, if the run needs to exceed ~10 minutes.
- Per-spec-file slicing is still the right shape when space is tight
  (each slice's artifacts are freed before the next starts — free disk
  went 302 MiB → 712 MiB → 1.2 GiB across three slices), but it does
  not survive the background-job kill either.
- `df -h ~` before diagnosing is still worth doing; just do not stop
  there when the number looks fine.

**A second trap, independent of the above.** A sliced run reported 2
failures with `ENOENT: apps/cli/dist/index.js` and "server did not
become ready". That is **not** disk and **not** a defect:
`playwright test --config` bypasses the `pretest:ui` npm hook, so it
never rebuilds — and any mutation-testing cycle (edit → build → revert)
leaves `dist/` mid-write. The spec files spawn the real CLI binary, so
they fail on a partially written `index.js`. **Run `npm run build`
before any sliced UI run**; after rebuilding, the same slice passed
16/16, exit 0.

**Related:** the orphaned-`loctt ui`-server entry above is a separate
issue, but check for orphans after any such kill — each holds a port, a
heap and file watches. Checked after both kills here: none were left.

## Rebuilding while a UI suite runs corrupts it (tooling, 2026-09-02)

**Not a product defect. I did this to myself, having written the rule
into the build agent's brief an hour earlier.**

The UI specs spawn the real CLI binary from `apps/cli/dist/index.js`.
A `npm run build` while the suite is in flight rewrites that file, and
any spec that shells out during the rewrite window fails with:

```
Error: ENOENT: no such file or directory, lstat '.../apps/cli/dist/index.js'
Error: Cannot find module '.../apps/cli/dist/index.js'
Error: loctt create Ranked B exited 1
```

Measured: the run started 13:44; `dist/index.js` has mtime 13:50, from
my own restore-and-rebuild after a mutation. **3 failed, 654 passed.**
Re-running the same three after the build settled: **12 passed, exit
0** — the three plus their neighbours.

**Why it is worth an entry.** The failures do not look environmental.
They read as a genuine defect in whatever the spec was doing, and two of
the three were tests I had personally mutation-verified hours before,
which is exactly the evidence that makes "it must be a real regression"
feel safe. The third named `settings.yaml` — a file M5.1 had just
changed the handling of — so the most plausible story was a real
regression in the ticket under test. It was not.

**The rule, which already existed**: one suite at a time, and no build
while a suite runs. Mutation testing makes this easy to break, because
restore-and-rebuild is the correct end of every mutation cycle and it
is tempting to do it while a long run is "just finishing".

**Check first**: `ls -la apps/cli/dist/index.js` against the run's start
time. An mtime inside the run window explains the failure, and no
amount of reading the spec will.

## No `eslint-plugin-react-hooks`, and it cost a real bug (2026-09-02)

`eslint-plugin-react-hooks` is **neither installed nor configured**
(`eslint.config.js` has no `react-hooks` rules; the package is absent
from `node_modules`). So the two rules that catch the most common React
defect class — Rules of Hooks and the exhaustive-deps warning — do not
run on this repo at all.

**What it let through, measured.** Implementing K16 I added
`const info = useInfoFresh();` to `ProjectsPanel.tsx` *below* its
`isError` / `isLoading` early returns. First render: projects loading,
component returns early, the hook never runs. Second render: it does.
React throws **error #310** — "rendered more hooks than during the
previous render" — and the entire panel subtree fails to mount.

`npm run build` exited 0. `npm run typecheck` exited 0. `npm run lint`
exited 0. The Playwright test failed with "element(s) not found", which
reads as a missing feature rather than a crashed component, and I
misdiagnosed it **twice** — first as a read-and-clear bug, then as a
TanStack `staleTime` cache issue — before escalating. The Fable agent
found it in one pass by attaching `page.on("pageerror")`.

**The lesson that generalises**: a React component that crashes on
render produces exactly the same Playwright failure as one that renders
nothing. `page.on("pageerror")` separates them in seconds; reasoning
about the data flow does not.

**Fix**: add the plugin and enable `react-hooks/rules-of-hooks` as an
error. Not done here because adding a dependency is a scope call, and
enabling `exhaustive-deps` across an existing codebase will surface a
backlog that wants its own ticket.

## System sleep during a long UI run looks like 13 defects (tooling)

**Not a product defect.** A Group G batch-2 UI run reported **13 failed,
645 passed** over a **2.5-hour** wall clock — against the suite's usual
~32 minutes. Re-running the three affected spec files with
`caffeinate -dimsu`: **95 passed, exit 0, 3.9 minutes.**

`pmset -g log` shows the cause:

```
21:00:07  Entering Sleep state due to 'Maintenance Sleep'
21:01:36  Entering Sleep state due to 'Notification Wake Back to Sleep'
21:04:08  Wake from Deep Idle
```

**How it presents.** Not as "the machine slept" — as ordinary test
failures spread across nine timeline specs and four others, which reads
as a clustered regression in whatever the batch touched. The tells are
in the error text, and they are worth memorising:

- `net::ERR_NETWORK_IO_SUSPENDED` — the network stack was suspended.
  This cannot be caused by application code.
- `loctt create Beta task exited undefined` — **undefined**, not a
  number. A process that never returned an exit code was killed by the
  OS, not by a failing assertion.
- A wall clock several times the suite's normal duration.

**Check first**, before reading a single spec:

```bash
pmset -g log | grep -E "^[0-9]{4}-" | grep -iE "Entering Sleep|Wake from"
```

**Prevent it** on any run expected to exceed a few minutes:

```bash
caffeinate -dimsu npx playwright test --config tests/ui/playwright.config.ts --workers=1
```

**Why this belongs beside the stale-`dist` and ENOSPC entries.** All
three produce failures that look like defects in the code under test,
and all three are diagnosed in seconds by one command that has nothing
to do with the code. This session lost time to each in turn.

## REL-32 failed once under full-suite load with a lost write (open)

**Under investigation, 2026-09-02. Not caused by the change it surfaced
in.** Recorded now so the next full run does not re-diagnose it.

`tests/ui/flow-relationships.spec.ts:1058` — two tabs reordering the
same ranked group. It failed once in a 658-test run, with the final
order equal to the **original** `[a, b, c]`: neither tab's move landed.
The test names that outcome as the forbidden one — "`[a, b,
c]`-with-a-lost-write" — and its `acceptable` list deliberately
enumerates the three orders the case permits rather than pinning one.

**What is ruled out:**

- **Not flake in the usual sense.** 3/3 in isolation and 5/5 in file
  context (18 tests each) — but it is a *behavioural* mismatch, not a
  strict-mode locator violation or a timeout, so a file-level pass is
  not sufficient evidence either way.
- **Not the environment.** The run was under `caffeinate`, took 28.5
  min (normal), and had 11.6 GB free — so neither the system-sleep nor
  the ENOSPC pattern recorded above.
- **Not the batch that surfaced it.** That change touched
  `config/projects.ts`, `config/workflow-write.ts` and
  `schema/migrate.ts` only — nothing relationships, rank or lexorank
  code reads.

**Why it matters more than a flaky test.** If it is real, it is a lost
write in relationship reordering: a read-modify-write racing another.
This repo has already had exactly that shape once — the interrupted
prefix rename read its sentinel *outside* `withStateLock`, so two
concurrent callers both passed the check and the second overwrote a
true count with zero (fixed 2026-09-02). One occurrence of that shape
is a bug; two is a pattern worth a sweep of every read-modify-write.

**Next step**: reproduce under load rather than reason about it. A
diagnosis is running; this entry stands until it lands.

## Two ArrowUp presses before the refetch silently drop the second (REL-32 area)

**App-side, minor, found while diagnosing a test failure 2026-09-02.**

The relationships panel is deliberately **not** optimistic: `onSettled`
invalidates and the rows move only after the `GET /api/tasks/:key`
refetch renders. A user who presses ArrowUp twice inside that window
has their second press computed against the **old** rendered index, so
it re-sends the first move verbatim — same `before`, same resulting
rank, a no-op on disk — and nothing tells them.

**Measured** in a Playwright trace under CPU load: both POSTs carried
`{"before":"T-3"}` and both were answered `{"rank":"v"}`, with
identical response hashes. The second press did nothing and said
nothing.

**Not a data-integrity bug.** No write is lost in the sense that
matters — `reorderRelationship` reads and writes entirely inside
`withStateLock` (`rank/reorder.ts:65`), and the route adds nothing
outside it. The server applied every request it received, correctly.
What is lost is a *keystroke*, because the client re-derived a stale
move.

**Fix options, none taken:** make the reorder optimistic; or disable
the handles until the refetch settles; or key the move off the last
known rank rather than the rendered index. The third is smallest but
needs care — that is what `keyboardMove(i, -1)` uses today.

**Related and already fixed**: the test helper had the same blind spot
and it is what made REL-32 fail ~30% of the time under load. See the
entry below.

## REL-32's helper read the DOM before the re-render (fixed)

`moveUp` in `tests/ui/flow-relationships.spec.ts` waited for the write's
**response**, then immediately read the DOM for the next step. The panel
moves rows only after the invalidation refetch, so under load the second
press was computed against the pre-move order and re-sent the first move.

**The reproduction is the evidence, and it was worth doing twice.**
Under 9 busy-loop processes on a 10-core box, `-g "REL-32"
--repeat-each 15`:

| | ordering failures | setup timeouts |
|---|---|---|
| before the fix | **5 / 15** | 0 |
| after the fix | **0 / 15** | 1 |

The one post-fix failure is `Test timeout exceeded while setting up
"tracker"` — the fixture buckling under deliberately punishing load, not
the assertion under test. **Reading the count alone said "1/15 still
fails" and that reading was wrong**; the failure mode is what
separated them.

`moveUp` now waits for the rendered order to change before returning.
Bounded at 5 s and **non-asserting** on purpose: a refused write leaves
the order unchanged, and judging that is the caller's job, not the
helper's — so a genuinely lost write still fails at the caller's
assertion rather than being masked here.

## The integration and e2e flakiness: over-parallelisation (diagnosed, fixed)

**Phase 6's second item, open since the plan was written. Diagnosed
2026-09-02 by provoking it rather than waiting for it.**

The plan recorded "one run reported 5 failures; eight consecutive runs
since have been green" and asked that the output be captured on the
next occurrence. It never occurred on its own. Running the suite under
9 busy-loop processes reproduced it immediately — **30 failed, 432
passed** — and from there it reproduced without any load at all.

**The output, which nobody had:**

- **27 of 30 were `Test timed out in 15000ms`.** Not assertions.
- The summed `import` time was **194 s against a 213 s wall clock** —
  the tell. Workers were contending for the machine, not running slow
  tests.

**The cause.** Neither `tests/vitest.integration.config.ts` nor
`tests/vitest.e2e.config.ts` set `maxWorkers`, so vitest defaults to
one worker per core. These are not compute tests: each spawns the real
`loctt` binary and, for the MCP cases, a stdio server. On a 10-core box
that is ~10 processes each fanning out more, and the timeout fires on
tests that were merely starved.

**Measured, `npm run test:integration` on a 10-core box:**

| workers | result |
|---|---|
| default (10) | 5, 8, 9 and 30 failures across four runs |
| **2** | **462 passed, exit 0**, twice consecutively |

**e2e had it too**, found while gating this fix: 2 of 21 failed in
isolation, 1 of 21 alongside the integration run, always `Test timed
out in 30000ms`, never an assertion. At two workers: 21 passed.

**The earlier recorded diagnosis was wrong and the plan said so.** It
blamed vitest's 5 s default; both configs have carried explicit
timeouts since they were written. The plan's instruction — do not raise
a timeout that may not be the cause — was right: raising it would have
masked the contention. The fix is fewer workers, not longer waits.

**Why it looked intermittent.** Whether a starved test crosses its
timeout depends on what else the machine is doing, which is why it went
eight runs green and then failed five at once. Anything else running —
another suite, a build, a browser — changes the outcome.

## A11Y Group 3/4 pass, 2026-09-03 — four cases declined, one contrast defect

Sixteen a11y cases were transcribed. Twelve are tagged. **Four are
deliberately untagged**, each because a bullet the case states is
unimplemented rather than untested. `@verifies` has no partial marker,
so tagging any of them would claim a blocker as satisfied.

Each has a `(partial)` test in `tests/ui/flow-accessibility.spec.ts`
that asserts the working half **and asserts the gap**, so these notes
invert rather than going stale: the day the gap is fixed, that test
fails and names this file.

### A11Y-9 — the keyboard cycle is broken in three named places

Three of five bullets fail. All are implementation gaps.

1. **Rows are click-only.** `apps/web/src/client/list/ListView.tsx`
   renders a task row as a bare `<tr>` with an `onClick` — no `role`,
   no `tabIndex`, no key handler. The key cell's `<a>` is the only
   keyboard route into a task. The case calls a click-only row "a
   blocker" by name.
2. **The status dropdown has no arrow traversal.**
   `apps/web/src/client/task/editors/OptionPicker.tsx` listens for
   Escape and nothing else — no `ArrowDown`/`ArrowUp`/`Home`/`End`, no
   `aria-activedescendant`, and opening the listbox does not move
   focus into it. Options are reachable by Tab, which is not what the
   bullet says.
3. **Nothing restores focus to the opened row.** Task detail is a
   route (`router/index.tsx`, `/tasks/$key`); no module records which
   row was opened, so "returning to the list restores focus at or near
   the row" has nothing to restore from.

Also in this cycle, though it belongs to A11Y-24: `MetaPanel` has no
live region, so a successful field save is silent to a screen reader.

**Reproduce:** `/list`, Tab through a row — only the key link stops.
Open a task, Tab to Status, Enter, ArrowDown — focus stays on the
trigger. Browser Back — focus is on `document.body`.

### Contrast: `--text-tertiary` is 3.67:1 on white (A11Y-40, not in this pass)

Found by axe while scoping A11Y-16, and left unfixed because it
belongs to **A11Y-40** ("Contrast holds in both light and dark
themes"), which was not in this pass's sixteen.

`--text-tertiary` is `#7b8699` (`styles/tokens.css`). Measured on
`/list`:

| element | ratio | required |
|---|---|---|
| task key link (`.hover\:text-accent`) | 3.67:1 | 4.5:1 |
| relative timestamp ("just now") | 3.67:1 | 4.5:1 |
| result count ("Showing 1–1 of 1") on `--bg-surface` | 3.45:1 | 4.5:1 |

All three are body text below the WCAG AA minimum. One root cause: the
token. **Reproduce:** scan `main` on `/list` with axe's
`color-contrast` rule, either theme — the values are the same, because
these all resolve against light backgrounds.


## A third test helper read state before the re-render (SPR-6, fixed)

**The same defect as REL-32's `moveUp`, in a different file. Two is a
coincidence; the pattern is worth naming.**

`dragCard` in `tests/ui/flow-sprints.spec.ts` ended at `mouse.up()` and
waited for nothing — not the write's response, not the refetch. The
sprints board is not optimistic: the drop POSTs, `onSettled`
invalidates, and the counts move only once the refetch renders. A
caller asserting immediately after the gesture was racing that round
trip.

Measured under nine busy-loop processes, `-g "SPR-6" --repeat-each 12`:

| | result |
|---|---|
| before | **2 / 12 failed** — always `Expected: "1" / Received: "0"` |
| after | **12 / 12 passed** |

Never a timeout, never a locator error: a **behavioural** mismatch,
which is why a file-level pass (3 × 44 green) was not sufficient
evidence either way and the load reproduction was.

**The shape to watch for**, now seen three times in this repo:

> A helper drives a gesture, waits for the *write*, and then reads the
> DOM. Any panel that re-renders from an invalidation refetch rather
> than optimistically will fail that read under load.

`moveUp` (REL-32), `dragCard` (SPR-6), and the K16 notice — where the
same blind spot lived in the **app**, not the test: `/api/info` was
read-and-clear, so a notice was consumed by whichever parallel request
arrived first.

**Both fixes are bounded and non-asserting on purpose.** A refused
write leaves the state unchanged, and judging that belongs to the
caller — verified by mutation here: disabling `setField.mutate` still
reddens SPR-6, so the wait cannot swallow a drop that genuinely failed
to land.

## PRU-42's user-delete spec flakes under `--workers=5` (helper, open)

**Feature RESOLVED 2026-09-05 (K21)** — the `UserDeleteDialog` is built,
covered, and out of known-gaps. What remains open is a **test-helper
flake**: the PRU-42 spec "choosing archive from the delete dialog …
leaves references intact" (`flow-settings-projects-users.spec.ts:~1276`)
intermittently fails at `userIdByName(tracker, "Dave")` returning
`undefined`. `userIdByName` parses `loctt user list --all` stdout with a
tab-anchored regex; under parallel Playwright load the lookup sometimes
returns undefined — a list-parse/timing issue in the spec helper, not the
feature. Passes in isolation; reproduce under `--workers=5`. Also tracked
in TEMP-TODO under tooling flakes.

## A PRU-34 fix silently regressed four sibling deletes (found and fixed 2026-09-04)

**Introduced by the PRU build agent, which stalled before I could
review it, and caught only by tracing every caller of the function it
changed.**

`replayTaskRemap` (`state/journal.ts`) was rewritten for PRU-34 from
throw-on-first-failure to collect-every-outcome, returning a
`TaskRemapResult` so `deleteProject` could report a partial remap. The
project delete inspects `result.failed` and raises `PartialRemapError`.

But `replayTaskRemap` is called from **five** entity managers —
sprints, labels, users, milestones, projects — and their recovery
handlers. The other four call it and **discard the result**, then
delete their config and clear the journal unconditionally. The old
version threw on a failed task write, aborting before the config
deletion; the new version swallowed it. So a sprint/label/user/
milestone hard-delete where one task could not be rewritten would
**remove the config entry and clear the journal while tasks still
referenced it** — the exact stranding PRU-34 fixed for projects,
reintroduced for the other four.

**How it was found.** Not by a failing test — the four had no
partial-failure test. By reading every call site of a signature that
changed from `Promise<void>` to `Promise<TaskRemapResult>` and noticing
eight of them dropped the result on the floor.

**Fix.** `replayTaskRemapStrict` wraps `replayTaskRemap` and throws when
`failed.length > 0`, restoring the all-or-nothing contract for callers
that have not opted into the split. The four siblings use it; the
project delete keeps the collecting version because it reports the
split itself.

**Guarded.** A new sprint partial-failure test (`chmod 0o500` on one
task's dir) asserts the delete throws and the sprint survives.
Mutation-proven: reverting sprints to the collecting `replayTaskRemap`
reddens it — the sprint is deleted despite the failed write.

**The lesson.** A stalled agent's diff is not safe to land on the
verified subset alone. A change can be correct for the case it targets
and a regression for four cases it never mentions. The tell was a
changed function signature with more callers than the agent touched.

## SHL-9 flaked when the temp path contained "v1" (fixed 2026-09-04)

**A pre-existing test-locator defect, not a regression — fixed
opportunistically after it failed twice in PRU-batch full runs.**

`SHL-9` asserted `aside.getByText("v1")` for a milestone named "v1".
The sidebar footer renders the workspace path (`text-text-tertiary`,
inside `aside`) as an abbreviated `~/…` string. When the fixture's
random temp directory happened to contain "v1" as a substring, the
`getByText` matched two elements — the milestone link and the path —
and Playwright's strict mode failed it. It passed whenever the random
suffix did not contain "v1", which is why it was intermittent and
passed in isolation.

Not caused by the PRU batch: `git` confirms it passed on `main` in one
run and failed in the worktree in another, with identical test logic —
the difference was the temp path, not the code.

**Fix**: assert `aside.getByRole("link", { name: /v1/ })` instead of
`getByText`, so only the sidebar entry matches and the path div cannot
collide. Same for the "bug" and archived-"old" assertions and the
click.

**The lesson, already recorded elsewhere but earned again here**: a
strict-mode "resolved to N elements" violation is a locator defect and
can *never* be load- or timing-dependent — so a file-level pass in
isolation is not evidence it is fixed. The tell was the error naming
the second element (the path div), which pointed straight at the cause.

## MCP swallowed a partial-remap report on label AND project delete (found and fixed 2026-09-04)

**Found while building MSL-33, which needed the label delete to report
a partial remap. The project side had the same gap since PRU-34.**

`PartialRemapError` (`projects/manage.ts`) extends `LocttError`
**directly**, not `ProjectError`/`LabelError`. MCP's dispatcher
(`apps/mcp/src/index.ts`) surfaces only errors that
`isKnownDomainError` (`apps/mcp/src/runtime/errors.ts`) recognises as
an `errorResult` carrying the message; everything else is **rethrown as
a server fault**. `PartialRemapError` was not in that allow-list, so an
agent's `delete_project` (since PRU-34) or `delete_label` (as of
MSL-33) whose remap only partly landed got an opaque server error
instead of the honest "N moved, M failed by key, entry NOT removed,
retry is safe" the error was built to carry — the exact report the
whole partial-remap design exists to deliver.

**Fixed** by adding `PartialRemapError` to `isKnownDomainError`. Both
the label and project delete tools now surface the split. Asserted in
`apps/mcp/src/runtime/stale-body-error.test.ts` beside the K10 case,
because the classification is only observable at that layer — over
stdio the SDK renders a rethrow as `isError: true` too, so an
end-to-end test cannot distinguish the two paths (the K10 comment in
that file explains this at length). Mutation-proven: removing
`PartialRemapError` from the allow-list reddens the classification
test.

**How it was found.** Not by a failing test — no MCP test exercised a
partial remap. By tracing which surfaces `PartialRemapError` reaches
when wiring MSL-33's label path: the web route had a branch, the CLI
prints `err.message` generically, but MCP's allow-list did not name the
class. See decisions.md A111.

## TML-26 timeline rows do not virtualise — the 3,000-task case is unbuildable

**Measured 2026-09-04 while covering the M3 scale cases.**

TML-26 bullet 1: "Rows virtualize vertically; scrolling to the 2,900th
row shows the right task, and its bar is at the right horizontal
offset." The timeline renders **every** row unconditionally —
`TimelineChart.tsx` maps `band.rows.map(...)` with no windowing, and
`layout.ts` places all rows top-to-bottom into one absolutely-positioned
body. There is no `virtual`, `overscan`, or visible-range slice anywhere
in `apps/web/src/client/timeline/` (grepped: only `today.slice` in
`TimelineView.tsx`, unrelated).

So the case's central mechanism does not exist. The other two bullets
(true group-header counts; a drag far down the list writes the right
task) are testable and largely covered elsewhere (TML-6/7 counts,
TML-9..12 drag), but bullet 1 is the point of TML-26 and `@verifies`
has no partial marker — tagging it would claim virtualisation is built.

**Not built here:** virtualising the timeline is a feature (a windowing
layer with its own scroll math, drag-hit-testing across the window
boundary, and arrow anchoring for off-window targets), not a test
repair. It also raises design questions no case answers — whether to
virtualise bands as well as rows, and how arrows to an un-rendered row
interact with TML-31's off-screen-dependency badge.

**Reproduce:** seed 3,000 dated tasks (the `seedDatedTasks` helper in
`tests/ui/flow-timeline.spec.ts` does this without subprocess cost),
open `/timeline`, count `[data-testid^="timeline-bar-"]` — all 3,000
render, and the DOM node count, not a spinner, is what a slow tracker
would feel.

## TML-32 the timeline has no arrow hover-highlight

**Measured 2026-09-04, same pass.**

TML-32 bullet 2: "Hovering the source bar highlights its arrows so an
individual dependency can be traced." The bar carries a CSS
`hover:bg-accent/30` on itself, but nothing changes the **arrows** on
hover: `TimelineChart.tsx` has no `hovered`/`highlight` state, no
`onMouseEnter`/`onPointerEnter` on a bar that touches the arrow
`<path>`s, and the arrows render at a fixed `stroke-text-secondary`
`strokeWidth={1}` regardless of any bar being hovered.

Bullets 1 (arrows drawn without hiding labels — arrows are a
`pointer-events:none` SVG overlay above the bars, labels live inside the
bars) and 3 (turning arrows off removes them — the toggle exists,
covered by TML-15) are met. But bullet 2 is unbuilt, and it is the one
that makes a 50-arrow fan *traceable* rather than merely drawn, which is
what the case is named for. Not tagged: `@verifies` cannot say "two of
three".

**Not built here:** arrow-highlight-on-hover is a feature (a hovered-bar
state threaded from the bar's pointer events into the arrow layer's
per-edge styling, plus deciding whether highlight follows the source,
the target, or both ends). No case specifies that shape.

**Reproduce:** seed one task with 50 `blocks` targets, open
`/timeline`, hover the source bar, observe every `timeline-arrow`
`<path>` keeps its stroke — nothing distinguishes the hovered task's
arrows from the rest.

## ERR-23 has no multi-step create flow to fail in

**Measured 2026-09-04.**

ERR-23: "Interrupt a create-task submit after the task is created but
before a subsequent link/label write lands." The web create modal makes
**one** atomic `POST /api/tasks` carrying every field — title, status,
assignee, and labels — via `toCreateRequest` (`create/formState.ts`).
There is no subsequent link or label write: `CreateTaskModal.submit`
awaits the single POST and, on failure, `describeFailure` reports the
task as *not created* (a request that never returns created nothing).
So the partial state ERR-23 describes — task written, follow-up write
lost — cannot arise: creation is all-or-nothing on this surface.

The nearest two-step flow is `LabelsField` on an **existing** task
(`POST /api/labels` then `POST /api/tasks/:ref/set`), but that is not a
create and is not what ERR-23 names.

**Not tagged, and not a defect:** the guarantee ERR-23 wants (no
orphaned task from a half-applied create) is provided *more* strongly
here than the case assumes — by never splitting the create into steps.
Verifying ERR-23 as written would require either inventing a multi-step
create (a scope change) or asserting against a flow the case does not
describe. If a future create flow does gain a distinct follow-up write,
ERR-23 becomes live and should assert the step-named message then.

**Reproduce:** open the create modal, fill a title and labels, and watch
the network — one request to `/api/tasks`, no follow-up.

## SET-29 diagnostics do not stream — they arrive in one batched response

**Measured 2026-09-04.**

SET-29 bullet 1: "Checks stream in individually as they complete rather
than the whole panel sitting on one spinner." The `DiagnosticsPanel`
runs a single `GET /api/doctor` that returns the whole
`DiagnosticCheck[]` at once; while it is in flight the panel shows one
`diagnostics-loading` spinner, then renders every check together. There
is no streaming endpoint (`/api/doctor` is the only route;
`grep` for `text/event-stream`/`res.write`/`EventSource` in the doctor
path returns nothing) and no per-check "still running" state (bullet 2)
because all checks land in the same tick.

Bullet 3 (a way to leave without wedging; navigating away and back
leaves no permanently-spinning check) IS met — the query is passed the
request `signal`, so navigation aborts it and a return refetches. But
bullets 1 and 2 are the substance of SET-29 and are unbuilt.

**Not built here:** streaming diagnostics is a feature (a chunked or SSE
`/api/doctor` that emits each check as it completes, core's `runDoctor`
refactored to yield incrementally, and a panel that renders a per-check
pending→result transition). No case beyond SET-29 asks for it, and it
touches core, the web route, and the panel at once — an escalate-by-rule
data-shape change, not a UI test.

**Reproduce:** seed 5,000 tasks, open Settings → Diagnostics, click Run
— one spinner, then all checks appear together; the Network panel shows
a single `/api/doctor` request, not a stream.

## A11Y remainder assessment (2026-09-04): 2 buildable, 8 feature-gaps

Of the 10 uncovered A11Y cases, only two are cleanly buildable now:

- **A11Y-38** (browser zoom 200% keeps flows usable) — testable via
  Playwright viewport scaling + a horizontal-scroll / reachability
  assertion. Fresh, buildable.
- **A11Y-49** (crashed-migration screen readable by screen reader) —
  `InterruptedMigration.tsx` exists; assert its heading is an alert, the
  from/to versions and backup path are selectable text, and the steps
  are a list. Fresh, buildable.

The other eight are recorded feature-gaps, not test-repairs, and tagging
them would be a tag that cannot fail:
- **A11Y-2** — `/` focuses a search box that does not exist (no search
  box is built; the binding is registered but disabled).
- **A11Y-9** — full keyboard operation still partly blocked by table
  rows being click-only (row focusability unbuilt); the `ui/Menu.tsx`
  arrow-key/type-ahead half is now built.
- **A11Y-10** — RESOLVED 2026-09-12: filter dropdowns are arrow-navigable
  now that `Menu`'s roving nav includes `menuitemcheckbox` (A94 completed);
  `@verifies A11Y-10` spec drives the whole flow by keyboard.
- **A11Y-12** — RESOLVED 2026-09-12: the project switcher's truncation
  control is now a two-way toggle carrying `aria-expanded`, toggling on
  Enter/Space (Sidebar.tsx); the inert "Mentions me" entry was already
  `aria-disabled` and out of tab order. `@verifies A11Y-12` spec; the old
  untagged "no group is collapsible" gap test removed.
- **A11Y-17** — RESOLVED 2026-09-12: a refetch that *keeps* the focused
  row preserves focus natively (React keyed reconciliation); for the
  unmount/remount case a MutationObserver in `ListView` restores focus to
  the equivalent row's key-link anchor (`data-task-key`) when a re-render
  dropped it to body. `@verifies A11Y-17` spec, red-proven by a positive
  control (without the effect, detach/reattach leaves focus on body).
- **A11Y-39** — RESOLVED 2026-09-12: the type scale moved to rem anchored
  to the browser root (`html { font-size: 87.5% }`); text-only zoom now
  scales the text. `@verifies A11Y-39` spec, red-proven. (A95 DONE note.)
- **A11Y-40** — full contrast audit (needs the axe-contrast harness across
  every themed surface; partly built in the token work).
- **A11Y-51** — RESOLVED 2026-09-12: the bulk result now announces through
  the assertive live region (accurate numbers, `aria-atomic` so untruncated)
  and `BulkResult` renders each failure as a focusable `<li tabIndex={0}>`
  (`bulk-failure-item`), keyboard-reachable and naming its task. `@verifies
  A11Y-51` spec, red-proven; the old untagged not-focusable gap test removed.

So the A11Y remainder narrows further — the rest wait on the features named
above.

## Where the uncovered feature-gap cases get picked up (phase map, 2026-09-04)

The uncovered cases that are neither built-but-untested nor blocked on a
Ken ruling are genuine feature-gaps — a capability does not exist. They
are NOT orphaned; each has a phase:

- **Degradation / corruption cases** → **Phase 7** (corruption
  framework). PRU-25/42 (dangling user reference, K21), and any case of
  the "one bad row never blanks a view" family. Phase 7's audit step
  explicitly reconciles north-star principles 5–7 against shipped code
  and classifies every CRUD × corruption kind — these fall out of that.
- **Git-engine cases** → **Phase Z**, strict-parity slice. GIT-8
  (rekey summary), GIT-21 (force-push), GIT-9/19/33 (rekey confirm),
  GIT-22 (fstype), GIT-23 (progress channel), GIT-25 (adopt-branch),
  GIT-29 (error-class): each is a core capability that does not exist on
  any surface. Phase Z's strict-parity cross-cut is where capability
  gaps are surfaced on purpose (the pattern that found `unarchiveView`
  by accident).
- **A11Y feature-gaps** → **Phase Z**, a11y aspect slice. A11Y-2 (no
  search box), A11Y-9/10/12 (no Menu arrow-nav / click-only rows),
  A11Y-39/40 (absolute type scale, contrast harness).
- **Migration-schema cases** → become testable **for free** when
  `CURRENT_SCHEMA_VERSION` first advances past 1 (a real migration to
  run). Not a phase item — a natural unblock. SET-15/31/37,
  XS-36/43/44/45/48/56.
- **Avatar cases** → buildable **now** once PRU-13's 256→500 bullet is
  reworded (K20). PRU-13, 27, 28, 29, 31, 39, 40.

**Frontier update, 2026-09-05.** The frontier this paragraph once
described is built: the 2 A11Y cases (A11Y-38, A11Y-49), the reconcile
batch, PRU-25/42 (K21/K22), and all 7 avatar cases (K18/K20) are landed
and covered. NEW-20 landed too (K23). Coverage is now 920/961. What
remains uncovered is exactly the 41 cases enumerated by
`cases:coverage --severity <sev>`: all are either a **Phase 7**
degradation case, a **Phase Z** git-engine or a11y slice, or a
**schema-bump** unblock — none is orphaned (each is named somewhere in
this file). The only open spec *decisions* are the residual
case-audit items now tracked in `TEMP-TODO.md` (§ "From the v1
case-audit + proposed-cases queue").
## Reconcile batch declines: GIT-8 (rekey summary) and GIT-21 (force-push)

Recorded 2026-09-04 by the git-reconcile batch. The 18 conflict cases
built the per-field conflict-detail model, reporting, write-back and the
resolution panel (GIT-5/6/7/10/11/12/13/14/15/17/18/26/31/32/37/38). Two
of the batch's cases are declined here because they are genuine separate
features with no existing core support — not reconciliation-detail work:

- **GIT-8 · rekey summary before applying.** When reconciliation leaves
  two tasks sharing a key with different ULIDs, the case wants a summary
  shown *before* any write: which key collided, which task keeps it (the
  earlier `created_at`, with both timestamps shown and the rule stated),
  which is renumbered and to what, then an explicit confirm — no
  auto-apply. `rekeyCollisions` (`git/reconcile.ts`) picks the keeper and
  allocates the new key, but it runs *inside* `normaliseAfterMerge`
  during the sync write with no summary and no confirm step, and the
  panel has no rekey-summary UI or its `/api/git/reconcile/rekey-preview`
  channel. Building GIT-8 (and GIT-9's ULID tiebreak display, GIT-33's
  partial-rekey report) needs: a preview that returns the planned
  renumbers without applying, a confirm gate, and the panel surface. To
  reproduce the gap: sync two clones that each created a task offline
  under the same key — the rekey happens silently, no summary is shown.

- **GIT-21 · force-pushed branch no longer contains the last synced
  commit.** The case wants sync to detect that `last_synced_commit` is
  not an ancestor of the remote head, stop, say the history was
  rewritten (naming the missing commit), refuse to silently re-base, and
  offer concrete next actions (inspect in git, or re-establish a base).
  There is no ancestry check anywhere: `planSync` treats a missing base
  as "no base available" and classifies conflicts, and `pullFromLocttBranch`
  has no "is last_synced an ancestor of remote head" guard. Building
  GIT-21 needs a `git merge-base --is-ancestor` check before planning,
  a dedicated `GitHistoryRewrittenError` carrying the missing commit,
  and the two recovery actions on the panel. To reproduce: publish, then
  `git push --force` a rewritten `loctt` history to the remote, then
  sync — it currently proceeds as an ordinary divergence rather than
  naming the rewrite.

Both are scoped as their own tickets. The reconciliation feature does not
depend on either.

## Re-audit 2026-09-05: some "blocked" cases were mis-filed built-but-untested

The stop-gate pushed back on "everything achievable is done" and it was
right to. Re-checking the uncovered set against the CODE (not the
collective M4.1 "22-case group" note, which is the aggregate-hiding
pattern that lost cases twice before) found several I had filed as
blocked that are actually buildable:

- **PRU-25/42** — I recorded K21 (delete semantics) but the cases had a
  SECOND, separate conflict: P-4 (no ULID in UI) vs PRU-25's required
  "truncated ULID + (deleted user)". That was a Ken decision I could
  have surfaced sooner, not a feature-gap. Ken ruled K22 (P-4 softens
  for error states); now building.
- **XS-10** (optimistic reconciliation), **XS-55** (current-user
  reflected cross-surface), **SHL-33** (10 statuses don't distort the
  shell), **NEW-20** (ghost default → ask state) — mechanisms exist;
  these read as built-but-untested, swept into the M4.1 group note
  rather than checked individually. Queued for a scattered batch.

Genuinely still blocked, re-confirmed: XS-38 (needs migration path),
CMT-20 / TML-26 / TML-32 (no virtualization/pagination), ERR-23 (create
is atomic), SET-29 (diagnostics don't stream), MSL-35 / ONB-18
(unreachable). XS-65 (conflict-write-fails) — worth re-checking now that
reconcile exists.

The lesson, again: a collective "N cases uncovered, honestly" note is
not per-case verification. Each uncovered case needs checking against
the code before it is called blocked — the aggregate is where buildable
work hides.

### Scattered batch outcome (2026-09-05): 4 built-but-untested, NEW-20 genuinely blocked

Ran the five as a scattered batch, each verified against the code first.

- **XS-10, XS-55, SHL-33, XS-65** — confirmed built, now covered by
  mutation-proven UI tests (`flow-task-meta.spec.ts`,
  `flow-cross-surface.spec.ts`, `flow-app-shell.spec.ts`,
  `flow-task-body.spec.ts`). XS-65 in particular is buildable now that
  the body-precondition path landed: a resolution write that hits a
  real filesystem failure (task dir made read-only) returns 500
  `io_failed` and `writeFileAtomically`'s temp-file+rename leaves
  `task.md` byte-for-byte unchanged — verified, and the mutation
  (non-atomic direct write) turns the byte-unchanged assertion red.

- **NEW-20 — genuinely blocked, NOT built-but-untested.** The re-audit
  guessed "mechanism exists"; it does not, for the case as written.

  NEW-20 requires `projects.yaml#default: ghost` (a hand-edited drift
  naming a project that does not exist) to **degrade to the NEW-19 ask
  state** — the create modal shows the empty/required project picker,
  not an error, not a silent pick of ghost.

  What actually happens: `ProjectsConfigSchema.superRefine`
  (`packages/contracts/src/projects.ts:95-100`) **hard-rejects** a
  `default` not in the projects list at *parse* time —
  `"default project 'ghost' is not in the projects list"`. So
  `loadProjectsConfig` throws before any resolution runs. The
  unguarded `const cfg = await loadProjectsConfig(locttDir)` in
  `handleListProjects` (`apps/web/src/server/server.ts:1490`) means
  `GET /api/projects` returns **400 `config_invalid`**, and the create
  modal degrades to a *config-error* surface, never the ask state.
  (Verified against a live server: GET /api/projects → 400
  config_invalid with that message.)

  The client-side `resolveProjectChoice`
  (`apps/web/src/client/create/projectChoice.ts`) *does* correctly fall
  through to `ask` when `effective_default` names a non-selectable
  project — but that path is for a default pointing at a *deleted or
  archived* project (still a valid ULID reference the schema accepts).
  It is never reached for a ghost default, because the config never
  parses.

  This is a design decision the case predates, and it belongs to Ken,
  not an agent: **should a `default` naming a nonexistent project be a
  hard config error (current behaviour), or a tolerated drift that the
  resolution chain skips over (what NEW-20 assumes)?** NEW-19 (no
  default → ask) is built and satisfiable; NEW-20 (broken default →
  ask) is not, until that call is made. Making the schema lenient here
  would also change what the CLI/MCP do with a ghost default, so it is
  a cross-surface decision, not a UI-only tweak. Recorded as blocked on
  that decision; no spec written that asserts a weaker claim to pass.

## Final coverage accounting, per-case verified (2026-09-05)

Coverage 912/961; 49 uncovered. Every one checked against the code
individually (not a group note). None is built-but-untested — the
buildable frontier is genuinely reached. Breakdown:

- **7 AVATAR** (PRU-13/27/28/29/31/39/40) — buildable the moment Ken
  rewords PRU-13's "256×256" bullet to 500px (K20). The cropper UI +
  the existing 500px copyAvatar pipeline. **Only Ken's one-line spec
  edit blocks these.**
- **10 SCHEMA** (SET-15/31/37, XS-36/38/43/44/45/48/56) — need
  CURRENT_SCHEMA_VERSION > 1 to have a real migration to test. Unblock
  FREE when the first post-release schema change ships.
- **14 GIT-engine** (the GIT declines) — rekey-summary, progress
  channel, fstype detection, adopt-branch, force-push ancestry, error-
  class distinction. Each a core capability that does not exist. Phase Z
  strict-parity slice.
- **8 A11Y feature-gaps** — no search box (A11Y-2), no Menu arrow-nav
  (A11Y-9/10/12), absolute type scale + contrast harness (A11Y-39/40),
  and A11Y-17/51's positive-control/keyboard-reachability needs. Phase Z
  a11y slice.
- **9 OTHER, all confirmed feature-gaps or process** — CMT-20 (no
  comment pagination), MSL-35/TML-26/TML-32 (no virtualization), SET-29
  (diagnostics don't stream), ERR-23 (create is atomic — the multi-step
  state can't arise), XS-50 (no proactive fstype detection; lock.ts's
  text is advice in a contention error, not a load-time warning), ONB-18
  (unreachable from the wizard), ERR-32 (an AUDIT process, not a
  @verifies test — Phase Z).
- **1 NEW-20** — ghost `default:` hard-rejects at schema parse
  (config_invalid), never reaching the ask state. Whether that should be
  a hard error or tolerated drift is a cross-surface Ken decision.

So: 7 wait on one Ken spec edit, 10 on a schema bump, 1 on a Ken
ruling, and 31 are Phase 7/Z feature work. Zero are "built but I didn't
test them" — that was verified case by case, which is the check the
aggregate notes kept failing.


## K28-WF · workflow.yaml does not preserve a broken sub-entry on write

**Found:** 2026-09-06 (K28 config-preserve-others sweep) · **Status:**
RESOLVED 2026-09-06 — fixed per Ken's ruling (decisions.md K28, Part 3).
`saveWorkflowConfig` now re-reads the on-disk broken sub-entries and
merges them at write time (`mergeBrokenIntoPlain`), sticky until the
file is fixed. Test: `workflow-write.test.ts` "keeps a broken status on
disk after an unrelated valid edit", mutation-verified. The description
below is retained as the historical analysis.

K28 made every list-shaped config writer re-emit the degraded siblings it
did not touch (`brokenEntriesToPlain`, `config/health.ts`), so a
`broken` entry another process left survives an unrelated write. Six
writers (labels/milestones/sprints/projects/calendar/list-view) plus
queries now do this and are gated by a preserve test each.

`workflow.yaml` is the exception. Its `broken` is not a flat
`BrokenEntry[]` but a **keyed record** — `WorkflowBroken`
(`packages/contracts/src/workflow.ts`): `{ statuses?, priorities?,
task_types?, relationships?, custom_fields? }`, each a `BrokenEntry[]`
belonging to a distinct sub-list. Preserving it on write means routing
each broken entry back into its correct sub-section through
`saveWorkflowConfig`, not the single-array append the six writers use.

**Consequence.** If a `workflow.yaml` is hand-edited to contain one
corrupt status (say) alongside valid ones, the loader degrades it to
`broken.statuses` and the rest load (A138) — but a subsequent write
through `saveWorkflowConfig` (e.g. adding a priority via Settings)
re-serializes only the valid statuses, silently dropping the corrupt
one from disk. Same P1 data-loss shape K28 closed elsewhere.

**To fix.** Give `saveWorkflowConfig` a per-sub-section merge: for each
of the five keyed sub-lists, append `brokenEntriesToPlain(broken.<key>)`
to that section's written array (statuses/priorities/task_types/
relationships/custom_fields). One preserve test per sub-section,
mutation-verified. Canonicalized under DEG-24 (config preserve-others);
this is the workflow slice of that case.

## K31 · Web task export ignores `archived=true`; backup upload capped at 50 MB/attachment

**Found:** 2026-09-06 (Phase Z Batch-2 fix-review) · **Status:** open, out of scope of the Batch-2 commit.

Two quality notes the fix-review surfaced while checking the new parity surfaces — neither a regression from Phase Z, both recorded rather than fixed under K30's scope:

1. **Web task export cannot include archived tasks.** The new CLI/MCP
   `export`/`export_tasks` (K30 F4) pass `includeArchived` into
   `listTasks`; the pre-existing web `handleExportTasks` does not, so
   `GET /api/tasks/export?archived=true` still excludes archived tasks.
   A pre-existing web defect that the new surfaces now make visible by
   contrast. Fix: thread the archived filter into the web export handler
   to match CLI/MCP.
2. **Backup restore upload is capped at the multipart default (~50 MB
   per attachment).** A legitimate large backup (a task with a big
   attachment) is refused by the web restore endpoint (K30 F3) with an
   unhelpful parser message. Fix: raise/limit the multipart cap for the
   restore route deliberately, with a clear over-limit message, or
   document the ceiling.

## SPR-6 flakes under full-file parallel load (passes isolated / --workers=2)

**Found:** 2026-09-06 · **Status:** OPEN (test flake, not a product bug).

Running the whole `flow-sprints.spec.ts` file, `SPR-6: dropping on No
sprint removes the field rather than writing an empty value` (line ~414,
board drag/drop) intermittently fails — but **passes in isolation and
under `--workers=2`**, so it is a parallelism/ordering flake under the
full-file run, not a real failure. The rest of the file (including every
SPR-33/SPR-37 metadata and detail-header case) passes. Left as-is; a
candidate for `test.slow()` or moving its seeding to a direct write. Also
tracked in TEMP-TODO under tooling flakes.

*(SPR-31, formerly failing beside SPR-6 here, was resolved 2026-09-09 —
B4, decisions.md §8 A167 — by rewriting its spec to assert the
`sprints-broken-config` alert. It is no longer a gap.)*

## Demo/seed data can store parent/child edges in the reverse direction (UX-8 root cause)

**Found:** 2026-09-08 (B3 Relationships) · **Status:** OPEN (data-side, not a code bug)

UX-8 (from the B3 UX review) reported the relationship group
headers reading backwards: on epic DEMO-10 its 3 children showed under a
**"PARENT · 3"** header, and on child DEMO-11 its parent under
**"CHILD · 1"**. Investigating it for REL-51 showed the *code* is correct:
core `linkTask` stores `link T-3 parent T-1` as a `parent` edge on T-3
whose target is the parent (matching the evaluator's `parent` alias, the
CLI docs, README and configuration.md), and `group.ts` labels a `parent`
group "Parent" and a `child` group "Child" accordingly. Measured:
`groupRelationships([{type:"child",…}])` → header "Child";
`groupRelationships([{type:"parent",…}])` → header "Parent".

The only way DEMO-10 could head its children with "Parent" is if the demo
tracker stored the epic's children as `parent` edges (target = child) —
i.e. the seed data was written against the reverse convention. So the
symptom is real but its cause is **demo/seed data**, not the client.

**Reproduce:** hand-write (or seed) an epic task with
`relationships: [{ type: parent, target: <child-id> }]` and open it — the
children render under "Parent". A tracker built through `loctt link`
(which all the flow-relationships specs use via `seedLink`) never
reproduces it.

**Fix (not done here):** regenerate any demo/seed tracker's parent/child
edges through `loctt link` so the direction matches core, or add a
`doctor`/migration that flips reversed structural edges. Out of B3's
scope (it is data, and REL-51's required property is met by correct code).
See `decisions.md` A161 for the full reasoning and the revert path if the
intended convention is ever the reverse.

## REL-33 · A stale-page rerank is not refused — `reorderRelationship` never checks whether the kind is still ranked

**Found:** v1 run (M2.5a) · **Status:** OPEN (core, deliberate decline)

REL-33's second bullet — "a drag attempt against a stale page is refused
with a message that the kind is no longer ranked" — needs a check that
exists at no layer. `reorderRelationship`
(`packages/core/src/rank/reorder.ts`) never loads the workflow config and
never reads `ranked`. Measured: switch `blocks` to `ranked: false`, then
`POST /api/tasks/T-1/relationships/blocks/T-3/rerank {"before":"T-2"}`
answers **200 `{"rank":"f","rebalanced":false}`** and writes the rank.

The other two bullets are built and tested (drag handles come from
`group.ranked` read from live config, so they disappear on refresh;
existing `rank` values are untouched — both asserted in
`flow-relationships.spec.ts`, handles-present asserted first so absence is
a change).

**Why not built.** Adding the guard means `reorder.ts` starts loading and
enforcing workflow config — a *new refusal* on a shared core path the
CLI's `loctt rerank` and any future MCP tool inherit (scope change,
stopped rather than invented).

**Where the fix belongs.** `reorderRelationship` should take the
`workflowConfig` its sibling `linkTask` already takes and throw a
`ReorderError` naming the kind when the definition is absent or `ranked`
is not true. The web route already maps `ReorderError` to a 400 with
`field: "relationships"`, so only core and the route's
`loadWorkflowConfig` call are missing. The spec is `test.fixme` — it runs,
is expected to fail, and starts passing loudly when core is fixed.

## CMT-10 · No way to query on comment mentions — the "Mentions me" filter cannot match

**Found:** v1 run (M2.4a) · **Status:** OPEN (feature, exists nowhere)

CMT-10 bullet 4 — "the 'Mentions me' saved filter still matches the
comment for that user after the rename" — has no mechanism behind it.
The query DSL has no `mentions` field (nothing in
`packages/core/src/query/` references one), and there is no comment-scan
endpoint on the web server. The "Mentions me" built-in in
`builtinFilters.ts` already resolves to `null` for this reason, with a
comment that it "needs a comment-scan endpoint that lands with the
comments feature".

**Why not built.** Matching tasks by comment mentions means indexing every
`_comments.yaml` at query time — a core capability with CLI/MCP
consequences (a feature existing nowhere; scope change, stopped).

The other three bullets are satisfied and tested (the stored `mentions`
array is unchanged by a rename, the chip reads the current name on the
next render, and the stored body still holds the old token) — the
mechanism the fourth would build on, so nothing has to be undone when it
lands.

## TSK-12 · Custom fields have no task-type scope

**Found:** v1 run (M2.2a) · **Status:** OPEN (feature, contract change)

TSK-12 bullet 4 — "fields scoped to a task type appear only for tasks of
that type, and changing the type updates the visible field set without a
reload" — needs a scope field on `CustomFieldDef` that does not exist.
`CustomFieldDefSchema` (`packages/contracts/src/workflow.ts`) is
`.strict()` with `key`, `label`, `type`, `multi`, `searchable`, `values`
and nothing else, so every declared field applies to every task type.

**Why not built.** Adding task-type scope is a contract change with
CLI/MCP/settings-UI consequences (a feature existing nowhere; scope
change, stopped). The seam is marked `scopedCustomFields()` in
`MetaPanel.tsx`.

The other half of the bullet — the visible set updates without a reload —
is already satisfied, since the set is derived from `fm.task_type` on
every render.

*(Related core defect, tracked separately above: a stale custom-field
value makes `setField` reject every subsequent write to that task from
every surface, because `setField` validates the whole task.)*

## The 44 uncovered v1 cases that had only a group reason

**Recorded 2026-09-02, after a full per-ticket gate sweep** (migrated here
from the since-deleted run-workflow doc).

Running every v1 ticket's `--require` roster individually showed 15 of 25
tickets failing, on 110 cases — every one already inside the known
uncovered set, **zero new gaps**. But 44 of them had no reason findable
outside their ticket's own `Cases:` line. A group reason is fine — but the
group must name its members, or a decline and an omission look identical
(exactly how four A11Y cases were once lost inside a "25 itemised" summary
that itemised 21). So they are named here.

**M4.3 (22) — the git-sync surface:** `GIT-10 GIT-2 GIT-20 GIT-24 GIT-27
GIT-28 GIT-3 GIT-30 MSL-14 MSL-28 MSL-33 MSL-9 SET-31 SET-37 SET-38 VUE-26
VUE-27 XS-38 XS-43 XS-44 XS-45 XS-48`. Cause: core has no `reconcile`,
`GitConflictError` carries a flat array of file paths, and the CLI has no
reconcile command by explicit design. (38 GIT cases are uncovered in
total; these 22 are the ones with no individual note — the rest are
detailed in the git-reconcile entries above.)

**M4.1 (22) — the projects-and-users surface:** `PRU-10 PRU-12 PRU-13
PRU-15 PRU-16 PRU-21 PRU-22 PRU-24 PRU-25 PRU-27 PRU-28 PRU-29 PRU-31
PRU-37 PRU-39 PRU-40 PRU-41 PRU-42 PRU-43 PRU-8 PRU-9 XS-55`. M4.1 shipped
20 of 46.

**What would close them:** a ticket that builds `reconcile` in core (the
M4.3 set) and the remaining project/user management surface (the M4.1
set). Neither was in v1's 23-ticket scope, so neither is a defect in that
run.
