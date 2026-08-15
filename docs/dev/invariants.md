# Invariants

Rules the code depends on. These are not decisions about what to build —
they are properties that must stay true. Violating one silently corrupts
data or breaks references, usually without a failing test.

**Check a change against this list when it touches project identity, task
keys, sprint state, or user settings.**

Keys (`P-1`, `Q10`, …) come from the v1 decision register; see
[decisions.md](decisions.md) for the decisions themselves.

## Project and task identity

| Key | Invariant | What breaks if violated |
|---|---|---|
| **P-1** | Projects are `{id (ULID), name, prefix}`. **There is no slug.** `ProjectDefSchema` is `.strict()`. | Adding a slug field silently fails validation; assuming one exists produces the stale key-era bugs already found across the reference docs. |
| **P-2** | Tasks reference their project by **ULID**, never by name or prefix. | `name` is mutable and non-unique. Referencing by name detaches every task the moment a project is renamed. |
| **P-3** | CLI and MCP accept a project **name** (erroring on ambiguity) or a ULID. | Accepting a name silently when two projects share it writes tasks to the wrong project. |
| **P-4** | The UI displays names; a ULID is never shown to a user. | ULIDs are internal identity, not user-facing vocabulary. |
| **P-5** | A project's `prefix` is **immutable** after creation. | Existing task keys embed the prefix. Changing it orphans every key already issued. |
| **P-7** | Moving a task reallocates its key in the destination project; the old key is preserved in `key_history` and keeps resolving. | Dropping `key_history` breaks every existing link, bookmark, and commit message referencing the old key. |
| **P-9** | A move is atomic: one `withStateLock`, one journal entry, one combined `project_changed` history entry. | A partial move leaves a task whose `project` and `key` disagree — unreachable by either. |

## Workflow and config

| Key | Invariant | What breaks if violated |
|---|---|---|
| **D20** | Priority drag-reorder recomputes `value` as 1..N. `value` is never displayed — it exists for DSL sorting. | Showing `value` leaks an implementation detail; failing to recompute makes `order by priority` wrong. |
| — | Stored enum values are config **keys**, never human labels. | A label is display text and can change; storing it breaks every query and every task referencing it. |

## Sprints

| Key | Invariant | What breaks if violated |
|---|---|---|
| **Q10** | Multiple simultaneously-`active` sprints are allowed. LocTT performs **no** automatic state transitions and **no** carryover. | "Helpfully" auto-completing a sprint past its end date mutates user data nobody asked to change. |
| — | Tasks reference sprints by **id**. A sprint's `name` is mutable and not unique. | Renaming a sprint would detach its tasks. |

## Local-only state

| Key | Invariant | What breaks if violated |
|---|---|---|
| **Q22** | Recents are machine-local and gitignored (`.loctt/users/<id>/recents.yaml`) — never published. | Publishing them leaks one machine's browsing history into a shared branch. |
| — | `.loctt/local/` and `.schema-version` are never mirrored by git sync. | Mirroring `.schema-version` lets a newer clone brick an older one with no recovery path. |
| — | A crash sentinel is either **resumable** (finish it at boot) or **fatal** (refuse to boot) — never ignored. `prefix-rename.yaml` is resumable; `.schema-migration-in-progress` is fatal, because completing a migration needs the backup it records. | A sentinel nothing acts on is worse than none: it records that the tracker is inconsistent and then lets every command run against it anyway. |
| — | Resumable recovery never throws out of the boot hook. Failure is reported and the command proceeds. | Throwing takes away the tools to diagnose the tracker — including `doctor`, whose job is to explain the very state that is failing. |

## Editor

| Key | Invariant | What breaks if violated |
|---|---|---|
| **Q18 / D4** | The body editor autosaves on idle + blur; `body_edited` history entries coalesce within a 15-minute same-actor window. **The window rolls** — each merged save advances it — **but an entry spans at most 60 minutes**, after which a fresh entry starts even if edits continue. | Under explicit-save the coalescing window would merge two deliberate saves minutes apart into one history entry. Without the 60-minute cap the rolling window never closes: sub-15-minute edits collapse indefinitely, and every intermediate body state inside that span is unrecoverable — which breaks the M2 guarantee that a lost merge race is recoverable from history. |
