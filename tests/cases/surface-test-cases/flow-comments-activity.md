# Comments, body, and activity

Comment lifecycle, task-body edits, and the history/activity journal.

Gaps only. See [README.md](README.md) for conventions.

---

## A. Comments reach no surface

`packages/core/src/task/comments.ts` implements post, list, edit, delete,
`editors` provenance, and mention extraction — and has **zero production
callers**. No CLI command, no MCP tool, no HTTP route. Meanwhile
`docs/user/ui/features.md:33-43` describes comments as shipped and
`../ui-test-cases/flow-comments-activity.md` has 38 cases with no backend.

### CMT-C1 · blocker · P10 P8 · CLI MCP
**The comment lifecycle is reachable from both surfaces.**

- Listing a task's comments returns them oldest-first, matching
  `_comments.yaml` order, with id, author, body, and timestamps.
- Posting a comment authors it as the current user and returns its id.
- Editing by id updates the body and marks the comment edited.
- Deleting by id removes it — from the CLI behind a confirmation.
- Each CLI subcommand appears in `loctt --help`; each MCP tool appears in
  `docs/user/mcp/reference.md` with its parameter table.

**Given** task T-1 with no comments, **when** a comment is posted and then
listed on each surface, **then** each listing contains exactly one entry
with the posted body and the current user as author.

### CMT-C2 · blocker · P4 · CLI
**Posting with no current user is refused with a route out.** `postComment`
throws `CommentError("no current user set; pass an explicit author")`
(`packages/core/src/task/comments.ts:149`); no surface renders it.

- The command exits non-zero.
- The message names the missing current user as the cause.
- The message names the command that sets one.
- The typed comment text is echoed back so it is not lost.

**Given** a tracker whose `.loctt/.current-user` is absent, **when** a
comment is posted, **then** the process exits non-zero naming both the
missing user and the command to set one, with the text preserved in the
output.

---

## B. Concurrent body edits

### CMT-C3 · blocker · P1 · CLI MCP
**A body write based on a stale read is refused.** `replace_task_body` and
`POST /api/tasks/:ref/body` (`apps/web/src/server/server.ts:1380-1388`)
both overwrite unconditionally — no ETag, no `If-Match`, no version stamp
anywhere in the server. `withStateLock` guards one call's
read-modify-write; it cannot detect a stale client buffer. This is verbatim
the P1 violation named in `../ui-test-cases/README.md:82`.

- The write path accepts an optional concurrency token obtained from a
  prior read.
- A token that no longer matches the task's current state is refused with
  an error naming the conflict.
- The refusal states plainly that nothing was written.
- Omitting the token still works, so existing callers do not break.

**Given** agents A and B both read T-1 and capture its token, and A writes
successfully, **when** B writes with its now-stale token, **then** B is
refused, the stored body is A's, and B's error says B's text was not
written.

---

## C. History and activity

### CMT-C4 · major · P9 · CLI MCP
**Long histories are reachable past the newest page.** All three surfaces
ignore `readHistory`'s paginating overload and re-implement read-all →
reverse → slice. MCP has no `offset` at all
(`apps/mcp/src/tools/task-crud.ts:257-269`), so an agent can read the
newest N and nothing older.

- An offset skips that many entries from the newest end on both surfaces.
- `limit` and `offset` compose into a partition — no repeats, no gaps at
  the boundary.
- Both report the total so the caller knows how much remains.

**Given** a task with 120 history entries, **when** each surface is asked
for `limit 50` then `limit 50, offset 50`, **then** the two pages share no
entry, cover 100 distinct entries, and each response states 120.

### CMT-C5 · major · P3 · CLI
**`loctt log` renders labels and display names, not raw keys and ULIDs.**
`formatHistoryEntry` prints stored workflow keys and raw ULIDs, and never
renders `actor` at all — so the log shows what changed but never who.

- A `field_change` on `status` renders configured labels on both sides,
  not `not_started` / `in_progress`.
- A `custom_field_change` names the field by its `label`, not its key.
- Every entry shows the acting user's display name when `actor` is set.
- An entry with no `actor` renders a stated placeholder, not a blank.
- A `before` value whose key was since removed from `workflow.yaml`
  renders the raw key with a drift marker rather than blank.

**Given** a status change from `not_started` to `in_progress` under a
workflow labelling those `Not started` and `In progress`, by a user named
`Ken`, **when** `loctt log T-1` runs, **then** the line contains
`Not started`, `In progress`, and `Ken`, and neither `not_started` nor the
raw ULID.

### CMT-C6 · major · P1 · CLI MCP
**Every mutating operation writes a history entry.** Rank and rerank paths
write frontmatter with no `appendHistory` call, and `HistoryKind` has no
kind for it — so a card moved across a board leaves no audit trail. The
board rebalance path additionally rewrites `updated_at` on every ranked
task in the tracker, silently.

- Reordering a task within a board column appends a history entry naming
  the move.
- Reordering a ranked relationship does the same.
- A rebalance that touches other tasks either records why, or does not
  bump their `updated_at`.
- `HistoryKind` has a value covering rank changes.

**Given** a task reordered on a board, **when** its history is read,
**then** an entry describes the reorder and names the actor.

### CMT-C7 · minor · P4 P6 · CLI
**A corrupt history file is reported, not silently emptied.** `readHistory`
swallows parse failure into `[]` (`packages/core/src/task/history.ts:68-76`)
and the next append overwrites the file with only the new entry —
the same swallow-and-overwrite exists for `_comments.yaml`.

- `loctt log` on a task with malformed history reports a parse error
  naming the file path, and exits non-zero rather than printing "No
  history entries."
- A subsequent mutating command does not overwrite the malformed file with
  a single fresh entry.
- The same holds for a malformed `_comments.yaml` on the comment path.

**Given** a task whose `_history.yaml` contains `[- kind: :::`, **when**
`loctt log T-1` runs and then a `set`, **then** the log exits non-zero
naming the file, and the file still holds its original bytes afterwards.

### CMT-C8 · minor · P10 · MCP
**`get_task_history` does not mutate core's returned array.** The handler
calls `entries.reverse()` in place on the array `readHistory` returned
(`apps/mcp/src/tools/task-crud.ts:266`).

- Two consecutive calls return the same ordering.
- The ordering is newest-first on both.

**Given** a task with three history entries, **when** `get_task_history` is
called twice, **then** both responses list the entries newest-first in
identical order.
