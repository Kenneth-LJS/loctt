# Relationships and attachments

Links, inverse edges, cycle guards, ranked reorder, and file attachments.

Gaps only. See [README.md](README.md) for conventions.

---

## A. Inverse edges

### REL-C1 · blocker · P1 P10 · CLI MCP
**Unlinking leaves no orphan on any surface.** `apps/web/src/server/server.ts:1844`
calls `unlinkTask` **without** `workflowConfig`, so `findInverseType`
returns `undefined` and the inverse branch is skipped entirely — the web
removes `T-1.blocks→T-2` and strands `T-2.blocked_by→T-1` permanently. The
CLI (`apps/cli/src/commands/task-links.ts:50-56`) and MCP
(`apps/mcp/src/tools/task-links.ts:51-57`) both pass it; the fix mirrors
`handleLink` fourteen lines above.

- For the same tracker state and the same (ref, type, target), CLI, MCP,
  and `POST /api/tasks/:ref/unlink` leave both tasks' `relationships`
  arrays byte-identical.
- All three write the same two `link_removed` history entries.
- All three refuse an already-absent edge with an equivalent message.
- Unlinking from the inverse side (`loctt unlink T-2 blocked_by T-1`)
  clears both edges, same as from the forward side.

**Given** identical seeded trackers A, B, and C, **when** the edge is
removed via CLI in A, MCP in B, and HTTP in C, **then** all three trackers'
task files are identical afterwards.

### REL-C2 · minor · P10 · CLI MCP
**An unknown relationship type is refused with the same guidance.** The CLI
pre-validates via `assertWorkflowRelationshipKey`
(`apps/cli/src/commands/task-links.ts:21`); MCP relies on core
(`packages/core/src/task/relationships.ts:194-201`).

- Both list the valid relationship types in the failure.
- Both include every side of every kind — forward and inverse keys.
- Neither writes an edge.

**Given** a workflow declaring only `blocks`/`blocked_by`, **when**
`link_tasks` is called with `type: "blockz"`, **then** the error names
`blockz` and lists `blocks, blocked_by` — the same set the CLI prints.

### REL-C3 · major · P4 P9 · CLI MCP
**A structural graph past the walk cap refuses the link.** Guards
`packages/core/src/task/relationships.ts:129-138`, currently untested.

- With a `parent` chain longer than 1000 tasks, linking a new edge into
  that chain exits non-zero.
- The message says the graph is too large to verify cycles, and names the
  cap.
- No edge is written to either task.
- MCP `link_tasks` returns `isError` with the same message.

**Given** a `parent` chain of 1001 tasks, **when** the head is linked to a
task inside the chain, **then** the call fails naming the cap and neither
task's frontmatter changed.

---

## B. Attachments

### REL-C4 · minor · P10 · CLI MCP
**Attachment names are accepted or refused identically.** Guards
`apps/cli/src/commands/task-files.ts:62-64`.

- A file named `notes..txt` can be attached and then detached by name.
- A name containing `/` or `\` is refused with a message naming the rule.
- A name of exactly `..` is refused.
- MCP `detach_file` accepts and refuses the identical set.

**Given** an attachment named `notes..txt`, **when** it is detached on each
surface, **then** both remove it and both refuse the same invalid names.

### REL-C5 · minor · P4 P9 · CLI
**A filename too long for the filesystem fails with a named error.**

- Attaching a file whose basename exceeds the platform limit exits
  non-zero.
- The message names the file and states the length limit — not a raw
  `ENAMETOOLONG`.
- No zero-byte or partial file remains under `attachments/`.

**Given** a source file with a 300-character basename, **when**
`loctt attach T-1 <path>` runs, **then** it reports the filename and the
limit, leaving no partial file.

---

## C. Create with a parent, and the relationship repair

### REL-C6 · blocker · P1 P10 · CLI MCP UI
**Creating a task with a parent links it exactly as `link` would.**
`loctt create --parent <ref>`, MCP `create_task` with `parent`, and
`POST /api/tasks` with `parent`.

> **Amended (K140, Ken 2026-09-28).** A user of 0.2.1 reported:
> *"loctt create --parent GAME-4 writes the raw key into the task file
> instead of the task ID, and doesn't add the child link on the parent.
> doctor then reports 26 broken references, and unlink can't remove
> them."*

- The parent may be given as its key, a former key (`key_history`), or
  its id (CLI and MCP; K141: every surface stores the id).
- The new task stores the parent's **id** on the configured tree axis,
  and the parent gains the inverse (`child`) edge, with the `link_added`
  history entry `link` writes. The result is identical to `create`
  followed by `link <new> <tree axis> <parent>`.
- `loctt show` on both tasks names the other; `loctt doctor` reports no
  relationship finding; `loctt unlink` removes both sides.
- A parent that does not exist is refused with `link`'s sentence
  (`Task not found: "<ref>"`); on the web this is a 400
  `validation_failed` at the `parent` field. An archived parent is
  refused with `link`'s sentence. Nothing is written when refused: no
  task file, and no key used up.
- `loctt show` and MCP `get_task` list a task's relationships in the web
  task page's order (kinds in workflow order; within each kind by rank,
  then any edge without one in stored order — every kind is ordered
  since K143), and MCP returns each edge's `rank` (K141 6a).

**Given** tasks T-1..T-4, **when** `loctt create child --parent T-4`
runs, **then** the child stores T-4's id, T-4 lists the child, `doctor`
is clean and `loctt unlink <child> parent T-4` removes both sides.

### REL-C7 · blocker · P1 P5 P11 · CLI MCP UI
**`doctor` finds and repairs links a tracker cannot fix any other way.**
`loctt doctor --repair-relationships`, `loctt doctor --fix`, MCP
`doctor` with `repair_relationships` / `fix`, and the Diagnostics panel.
(K141, Ken's rulings 2a, 3a, 4a.)

- A link whose target is a task's key (or former key) rather than its id
  is reported by `doctor`, naming the task file, and the repair rewrites
  it to the id, keeping its rank.
- Every one-sided link is reported and the repair adds the missing side
  (with `link_added` on the task that gains it). When adding it would
  create a loop on an `acyclic` or `tree` kind, the repair refuses and
  `doctor` says so.
- Identical links on one task are merged into one.
- A target that resolves to no task, to a key more than one task has
  held, or to the task itself is reported and **never deleted**. A task
  whose links could not be read is left untouched.
- `doctor` tags the finding with the `repair-relationships` fix; the
  repair runs before the checks, so what `doctor` prints afterwards is
  what is left. A second run repairs nothing and changes no file.
- `--fix` runs every safe repair (key index rebuild and the relationship
  repair) and then reports what is left; restoring missing files is not
  one of them.

**Given** a tracker where three children store `parent: GAME-4` and
GAME-4 lists none of them, **when** `loctt doctor --repair-relationships`
runs, **then** each child stores GAME-4's id, GAME-4 lists all three,
`doctor` is clean, and running the repair again changes nothing.

### REL-C8 · blocker · P1 P7 · CLI MCP UI
**Deleting a task removes the other side of its links.** (K147, G4)
Delete removed only the task's directory, so every partner kept a link
to a task that no longer exists and `doctor` reported it.

- Deleting a task (one or many, on any surface) removes, from every task
  it was linked to, each link pointing at it, in the same operation.
- Each partner's history records a `link_removed` entry for each link
  removed (with the batch's `bulk_op_id` for a bulk delete).
- A partner deleted in the same batch is not written to.
- The partner's other links are untouched; afterwards `loctt doctor`
  reports no relationship finding.
- A task deleted out of band (by hand or a pull) still leaves dangling
  links, which REL-24 renders and `unlink` removes.

**Given** WEB-21 `relates_to` WEB-5, **when** `loctt delete WEB-21 --yes`
runs, **then** WEB-5 has no link to WEB-21, its log shows `link removed`,
and `doctor` is clean.

### REL-C9 · major · P1 P10 · CLI MCP UI
**A link stored as a key more than one task has held can be removed.** (G1)
The relationship repair keeps such a link (it can't tell which task was
meant) and `doctor` reports it, but every surface resolved the key to
one holder's id and `unlink` answered "does not exist".

- `loctt unlink`, MCP `unlink_tasks` and the web's remove action remove
  a link by the exact target it stores when no link to the resolved id
  exists.
- The holder that has the other side of that link loses it, unless the
  source also links to that holder by id.
- `doctor`'s finding for such a link says to remove it and link the
  right task (not to hand-edit the file).

**Given** T-1 stores `relates_to: T-2`, and T-2 and T-3 have both held
`T-2`, **when** `loctt unlink T-1 relates_to T-2` runs, **then** T-1 has
no relationships.

### REL-C10 · blocker · P1 P10 · CLI MCP UI
**Every link carries a rank, and `--before`/`--after` land exactly where
asked on every kind.** K143 (Ken 2026-09-28): every relationship kind is
ordered; the `ranked` setting is removed (B41).

- Every write that creates a link gives it a rank at the end of that
  type's group on that task: `link` (both sides), `create --parent` (both
  sides), the relationship repair (the side it adds), restore, and
  reconciliation (which links through `link`).
- `loctt rerank` / MCP `reorder_relationship` with `--before`/`--after`
  (`before`/`after`) put the link exactly there, on any kind and either
  side (`relates_to`, `is_blocked_by`, `child`), including among
  siblings that have no rank (it ranks them first, in listed order).
- No kind refuses a reorder for being "unranked"; only a kind
  `workflow.yaml` does not declare is refused.
- A link without a rank (a hand-edit, a merge from a branch written
  before 0.3.0) is still read and listed after the ranked ones; `doctor`
  reports it, and `doctor --repair-relationships` ranks it at the end of
  its group.
  → `packages/core/src/task/relationships.test.ts`,
  `rank/reorder.test.ts`, `task/traversal.test.ts`,
  `task/relationship-repair.test.ts`, `backup/backup.test.ts`, runthrough
  `links/rerank-after`, `links/rerank-across-kinds`

**Given** a task relating three others, **when** the third is reranked
`--before` the first and then `--after` the new second, **then** the
listing is exactly the order asked for each time.
