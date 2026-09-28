# Known gaps

Defects that are real, understood, and not yet fixed. Each says what is
wrong, how to reproduce it, and what (if anything) Ken has to decide
before it can be built.

**Check here before reporting a defect as new.** Delete an entry the
moment it is fixed. Nothing here is "deferred" (K117): an item stays
open until it is fixed or Ken rules on it. Fixed and accepted items live
in `decisions.md` and git history, not here. Process lessons live in
`docs/dev/process/build-loop.md`.

---

## G1 · A link stored as an ambiguous key can't be unlinked (B39, A357)

**What is wrong.** Every surface's `unlink` resolves the target ref to a
task id before calling `unlinkTask`, so an edge whose *stored* target is
a key never matches when that key resolves to a live task. The
relationship repair (K141) rewrites every key that belongs to exactly
one task, which clears the reported case. What is left is a key more
than one task has held (reconciliation can leave `T-5` current on one
task and in another's `key_history`): the repair reports it and keeps
it, doctor says to replace it with the right task's id, but `unlink`
still can't remove it from any surface.

**Reproduce.** Task A has key `T-9`; task B has `key_history: [T-9]`;
task C stores `relationships: [{type: relates_to, target: T-9}]`.
`loctt unlink C relates_to T-9` resolves `T-9` to A's id and fails with
`Relationship "relates_to" to <A id> does not exist on task <C id>`.

**Possible fix (no ruling needed to try it).** When the resolved-id
edge is absent, fall back to an edge whose stored target equals the ref
as typed, in CLI `unlink`, MCP `unlink_tasks` and the web unlink route.
