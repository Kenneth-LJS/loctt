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

What remains is client-side and needs the body editor, so it lands with
M2.3: both cases require the user's typed content to **stay in the
editor** when a save fails, so they can copy it out. Nothing may clear
the buffer on failure.

Cases: ERR-11, ERR-12 in
[`ui-test-cases/flow-error-handling.md`](ui-test-cases/flow-error-handling.md).

## Code

### Key collisions across clones are unhandled

`rekeyCollisions` in `packages/core/src/git/reconcile.ts` is implemented
and unit-tested but has no production caller. Two clones that
independently allocate the same key while offline will both keep it, and
sync does not detect the clash.

The rest of git sync's reconciliation is wired — `planSync` guards the
data-loss paths, and relationship and key-history merges run — so this
is a specific open case, not a missing subsystem.
