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
