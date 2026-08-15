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

## Documentation

### Two live file formats are unspecified

`list-view.yaml` and `_comments.yaml` both ship and are both absent from
[`schema-reference.md`](schema-reference.md), including its directory
layout block. A user hand-editing either has nothing to check against.

### `architecture.md`'s git section understates the subsystem

[`architecture.md`](architecture.md) gives git integration three lines
covering publish only, for a ten-module subsystem. `three-way.ts` and
the reconciliation lifecycle go unmentioned. Both `README.md` and
[`git-sync.md`](../user/common/git-sync.md) are ahead of it, so a
contributor reading the architecture doc gets the least accurate
picture.
