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

### History records that something happened, not what it was

Only `field_change`, `custom_field_change`, and the link/attachment
kinds record content. These record a timestamp and nothing else:

| Kind | Missing |
|---|---|
| `created` | The initial frontmatter and body |
| `body_edited` | The body, before or after — `task/io.ts` appends the kind alone |
| `comment_added` | The comment text (`meta` carries only id and author) |
| `comment_edited` | Both old and new text |
| `comment_deleted` | The deleted text — a hard delete with no record anywhere |

So history cannot reconstruct a prior state, which makes "read the
history and put it back" false for bodies and comments. `comment_deleted`
is the sharpest: the text is unrecoverable by any means.

Decided as **M3** in [decisions.md](decisions.md); not built.

### Two clones that both create a task cannot sync at all

Sync aborts when any file changed on both sides since the last sync.
Two clones that each create a task both bump `state.yaml`, so sync stops
there — before task files are compared. Reproduced: the second clone to
sync gets `sync aborted: 3 file(s) changed both locally and on the
branch`, naming `projects.yaml`, `queries.yaml` and `state.yaml`.

Nothing is lost — the abort is the safe behaviour `planSync` was built
for after four reproduced data-loss paths. But the merge never happens.

This is why `rekeyCollisions` has no caller: there is no point in the
sync path where a merged task set exists for it to scan. **Wiring it up
alone would produce a function that still never fires.** What is needed
first is field-level merging — `state.yaml` counters, relationships and
disjoint fields merging rather than conflicting. The merge helpers
(`mergeRelationships`, `mergeKeyHistory`) exist and are unit-tested;
nothing calls them either.

Decided as **M1**–**M4** in [decisions.md](decisions.md); not built.

### `rekeyCollisions` is also broken

Separately from having no caller, it cannot work as written.
`reconcile.ts:43` reads `state.keys["task"]`, but keys are allocated per
project under the project's ULID — so the lookup returns `undefined` and
the loop's `continue` silently rekeys nothing.

Its unit tests pass because they build fixtures in the pre-migration
shape (`keys: { task: … }`), which no real tracker has had since the
key→id migration. Same failure mode as the fourteen tests the
2026-08-14 session found: green, thorough, and encoding a world that no
longer exists.
