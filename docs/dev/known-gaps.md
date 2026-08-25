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
