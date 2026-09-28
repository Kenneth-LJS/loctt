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

## G2 · `loctt set` cannot write number, boolean or multi-enum custom fields (B42)

**What is wrong.** CLI `set` passes the value through as a string and
core's `setField` stores it as given, so the custom-field validator
refuses it: `expected finite number, got string` (number),
`expected boolean, got string` (boolean), `multi enum field must be an
array` (multi enum, which has no list syntax at all). MCP `update_task`
takes typed JSON and works. String, date and single enum fields work
on both.

**Reproduce.** On the runthrough seed: `loctt set WEB-16 risk 5`,
`loctt set WEB-13 signed_off true`, `loctt set MOB-5 platforms ios,android`.
Cases `edit-custom-number`, `edit-custom-boolean`,
`edit-custom-multi-enum` (`known_bug: cli`).

**Possible fix.** Coerce the CLI value by the declared field type
(number, `true`/`false`, comma list for `multi`) before calling core.

## G3 · The CLI cannot change a task's labels after create (B42)

**What is wrong.** `loctt create --label` works, but `loctt set <task>
labels <anything>` fails with `labels must be an array, got: string`,
and there is no other CLI command that adds or removes a label. MCP
`update_task` with `value: [..]` works.

**Reproduce.** `loctt set WEB-20 labels frontend,infra`. Case
`label-add-to-task` (`known_bug: cli`).

**Possible fix.** Split a comma list for `labels` in `set` (as the bulk
ref list already is), or add label add/remove flags. Which one is a
CLI-shape call.

## G4 · Deleting a linked task leaves its partners' inverse edges dangling (B42)

**What is wrong.** `deleteTask` / `bulkDelete` remove only the task's
directory. Every task linked to it keeps an edge whose target no longer
exists, and doctor then reports `relationships: 1 issue(s) found` and a
`data integrity` finding for the partner. A19 made such an edge
removable with `unlink`, which suggests dangling edges after a delete
were expected; K21 says a delete never creates a dangling *user*
reference. Whether delete should drop the partners' edges is Ken's call.

**Reproduce.** `loctt delete WEB-21 --yes` on the seed (WEB-21
`relates_to` WEB-5), then `loctt doctor`. Case `delete-linked-task`
(`known_bug` on both surfaces); `clean-up` carries the doctor findings
as `known_doctor_findings`.

## G5 · Delete leaves the deleted keys in the on-disk key index (B42)

**What is wrong.** After any delete, `.loctt/local/key-index.yaml` still
maps the deleted keys, and doctor warns `key index: N stale
entry/entries … Run loctt doctor --rebuild-index`. The in-memory lookup
cache is cleared; the file is not.

**Reproduce.** `loctt delete MOB-8,OPS-5 --yes`, then `loctt doctor`.
Cases `bulk-delete`, `clean-up` (`known_doctor_findings`).

## G6 · Create does not add its key to an existing on-disk key index (B42)

**What is wrong.** When `key-index.yaml` already exists (any earlier
lookup writes it — including `create --parent` resolving the parent),
a create does not add the new key, and doctor warns `key index: 1 task
dir(s) not in index`. On a tracker whose index was never built the
warning does not appear, which is why it went unseen.

**Reproduce.** `loctt show WEB-1`, `loctt create "x"`, `loctt doctor`.
Case `create-updates-key-index` (`known_bug` on both surfaces); cases
`create-with-parent` and `plan-an-epic` carry it as a
`known_doctor_findings` entry.

## G7 · `loctt show` prints assignee and reporter as user ids (B42)

**What is wrong.** `show` prints milestone, sprint and labels by name
but `Assignee:` and `Reporter:` as raw user ids. The CLI reference's
example shows `Assignee: Jordan`.

**Reproduce.** `loctt show WEB-13` on the seed. Case `show-task-fields`
(`known_bug: cli`).
