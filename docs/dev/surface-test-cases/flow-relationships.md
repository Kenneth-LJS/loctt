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
