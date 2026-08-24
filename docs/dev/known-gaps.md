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

## Code

### History records that something happened, not what it was

**Resolved 2026-08-15** (M3). `created` now carries the initial
frontmatter and body, `body_edited` carries before/after, and the comment
kinds carry their text — including `comment_deleted`, which previously
hard-deleted with no record anywhere.

This was the prerequisite for M2: "a lost merge race is recoverable from
history" is only true if history records what was lost.

### Two clones that both create a task cannot sync at all

**Resolved 2026-08-15.** Field-level merging is built
(`git/merge.ts`, `git/resolve-conflicts.ts`, and the normalise pass in
`publish-sync.ts`), implementing M1–M4 plus the per-file-type rules.

Two clones that each create a task now merge: both tasks survive, the
second project takes a provisional prefix (`T-` → `T2-`) so keys stay
unambiguous, and `rekeyCollisions` is finally called. Pinned by
`tests/integration/git/with-remote.test.ts`.

Files with no merge rule — `workflow.yaml` most notably — still abort,
naming the path.

### `rekeyCollisions` is also broken

**Resolved 2026-08-15.** It read `state.keys["task"]` while keys are
allocated per project under the project's ULID, so the lookup returned
`undefined` and the loop silently rekeyed nothing. It now allocates from
`task.frontmatter.project`, and its fixtures were rebuilt in the
post-migration shape — the old ones encoded a world that had not existed
since the key→id migration.

## Tests

### The integration suite is flaky under parallel load

**Observed 2026-08-17.** A full `npm run test:integration` reported
5 failures across `git/with-remote.test.ts` and
`mcp/list-truncation.test.ts`. Both files passed in isolation, and **four**
consecutive full runs afterwards were green (392/392 each) — so the failures are
contention, not a defect in the code under test.

Both files do real subprocess work: `with-remote` runs git against a
bare remote, `list-truncation` spawns the MCP server over stdio. Under
enough parallel load they exceed vitest's 5-second default.

The same shape was already hit and fixed once: `apps/web`'s two
git-error tests passed alone and timed out inside the full web run, and
now carry explicit 30s timeouts.

**Why this matters more than an ordinary flake:** a timeout renders as
`FAIL` in the summary line, indistinguishable from a real regression.
Anyone running the suite after a change will read it as their fault.
The fix is the same as before — an explicit timeout on the tests that
do real I/O — but it should be applied deliberately rather than by
raising the global default, which would hide genuinely slow tests.

**Before believing an integration failure: re-run the named file alone.**

## ✅ `publish-sync` key-collision test — diagnosed and fixed, 2026-08-17

`src/git/publish-sync.test.ts > reports a key collision it could not
resolve` failed deterministically, at `9dc84ca` and every commit since.
Recorded here first with two possibilities; the second was correct.

**The test's fixture never reached the code it asserted.** It built the
colliding task by copying the published one, so both carried an
identical `created_at`. The tiebreak then fell to the ULID `id`, and the
hardcoded `01M0COLLIDING…` sorts *before* a real ULID — so the colliding
task sorted first and kept the key, and the **local** task was rekeyed.
That rekey succeeded, because the local task's project does have a
counter. `skipped` was therefore empty and `unresolvedKeys` was empty,
which is exactly what the assertion caught.

The production code was correct throughout. Fixed by stamping the
colliding task with a later `created_at`, which is what GIT-C2
specifies: *"the task with the earlier `created_at` keeps the key."*
The later task is the one that must be rekeyed, and in this scenario it
is the one that cannot be.

**Both halves of GIT-C2 are now genuinely covered**, verified by
mutation: dropping `outcome.skipped` at the caller fails it, and gating
`normaliseAfterMerge` on merges only (excluding the copy path) fails it.
Neither could fail against the old fixture.

**A wrong turn worth recording.** I first "fixed" this by sorting
unrekeyable tasks first, so the task that cannot be rekeyed keeps the
key. That contradicts GIT-C2's stated rule, and the plan doc is explicit
that an agent never adjudicates against the spec. Reverted. The
reasoning was not unreasonable — letting the unrekeyable side win is
arguably the better outcome — but it is a **decision for the user**, not
something to implement while calling it a bug fix.

**I reported the core suite as green several times during 2026-08-17
while this was failing.** The summary line was read without checking for
`FAIL` lines above it. Corrected here rather than quietly.

