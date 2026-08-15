# Known gaps

Defects and documentation holes that are real, understood, and not yet
fixed. Each says what is wrong and where the fix belongs, so it can be
picked up without rediscovering it.

This file is not a backlog for features — that is
[`TEMP-WEB-TICKETS.md`](../../TEMP-WEB-TICKETS.md) — and not a place for
things that merely might be wrong. Delete an entry when it is fixed.

## Code

### Filesystem errors are reported as unknown

`EACCES` (unwritable `.loctt/`) and `ENOSPC` (disk full) reach the web
server as generic errors and land in the ERR-30 handler, which states
the data state and a recovery but names the cause as unknown.

ERR-31 says a cause the app *knows* must never be reported as unknown,
and this one is knowable — the errno is right there. It is also the case
where naming it matters most, since only the user can fix a permission
or a full disk.

The fix belongs in `packages/core`, where those errnos surface, not in
`apps/web/src/server/server.ts`: the CLI and MCP have the same blind
spot, and mapping it once serves all three. Map to `io_failed` with copy
naming the path.

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
