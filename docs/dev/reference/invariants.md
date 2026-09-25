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
| **P-1** | Projects are `{id (ULID), name, slug?, prefix}`. `ProjectDefSchema` is `.strict()`, so any *other* field silently fails validation. **`slug` is optional** — pre-K3 trackers have none — and is **fixed at creation**, never rewritten by a rename. | **Amended 2026-09-01 by Ken's ruling K3** (§ 9), which reintroduced the slug; this row previously read "There is no slug". Treating the slug as mutable breaks every saved URL and bookmark (A60); treating it as required makes every pre-K3 `projects.yaml` fail to load (A61). Assuming any *further* field exists still produces the stale key-era bugs found across the reference docs. |
| **P-2** | Tasks reference their project by **ULID**, never by name or prefix. | `name` is mutable and non-unique. Referencing by name detaches every task the moment a project is renamed. |
| **P-3** | CLI and MCP accept a project **slug**, a **name** (erroring on ambiguity), or a ULID — resolved in that order, so the unambiguous handle wins. | Accepting a name silently when two projects share it writes tasks to the wrong project. The slug is checked first because it is unique and immutable where a name is neither (K3, A60). |
| **P-4** | The UI displays names; a ULID is never shown in UI **content** — labels, pickers, prose, error messages. **Exception (K22, 2026-09-05): a dangling reference in an error/degraded state** — a task referencing a deleted user, a broken saved view — MAY show a truncated ULID alongside the degraded label (e.g. "a1b2c3d4 (deleted user)"), because there it is diagnostic information helping the user debug, not vocabulary. Route segments are outside this rule (decisions.md V3): a URL is an addressing mechanism, not something LocTT displays. | ULIDs are internal identity, not user-facing vocabulary — **except when the vocabulary failed and the id is the only thing left to identify the referent.** A URL needs a stable identifier, and names are neither unique nor immutable. |
| **P-5** | A project's `prefix` is **not editable as a config field**, but it *can* be changed by `setProjectPrefix`, which renames every task in the project as one transaction and preserves old keys in `key_history`. | Existing task keys embed the prefix, so rewriting it anywhere else orphans every key already issued. **This row said "immutable" until 2026-09-01**; that has been false since `setProjectPrefix` landed, and PRU-5/PRU-44 both depend on the change being possible and stated. |
| **P-7** | Moving a task reallocates its key in the destination project; the old key is preserved in `key_history` and keeps resolving. | Dropping `key_history` breaks every existing link, bookmark, and commit message referencing the old key. |
| **P-9** | A move is atomic: one `withStateLock`, one journal entry, one combined `project_changed` history entry. | A partial move leaves a task whose `project` and `key` disagree — unreachable by either. |

## Data integrity

| Key | Invariant | What breaks if violated |
|---|---|---|
| **P-11** | **Leniency means keeping, never destroying.** When LocTT meets data it cannot parse or read, it preserves it. It never discards content to keep running, and never writes over something it failed to read. A malformed **entry** in a list — a comment, a history entry — is *kept and merged*, positioned by its neighbours when its own sort key is unusable: after whatever preceded it in the original file, or first if it was first. Malformed data is surfaced (sync pre-flight, `doctor`) and excluded only from *reads* that genuinely depend on the broken field. | `return []` on a read failure is destruction wearing leniency's clothes whenever the next step is a write: `postComment` reads `[]` from an unreadable `_comments.yaml`, writes `[...existing, comment]` back, and a three-comment thread becomes one — reported as success, with no recovery since deletion is hard. Reproduced 2026-08-17; closed the same day. **Implemented for comment threads** (`149a07a`) **and history entries** (`e379de8`) — a malformed entry is kept at its index and survives a post, an edit, or a deletion of either neighbour, and an unreadable file is never written over. Config is deliberately different — V9: a definition other data references is refused rather than kept around, though the file is still never overwritten. `diagnostics/integrity.ts` is where each new store gets reported. |
| **P-12** | **Validate at the boundary.** Data entering through a LocTT command is validated before it lands, including cross-file dependencies — a relationship implies its inverse on the target. Hand-edits and `git pull` bypass this by definition; those are **unsupported**, LocTT warns where it can do so cheaply, and the user owns the outcome. **The boundary is the gate; P-11 is the floor** for whatever gets past it. | Without the second half, "we validate at sync" reads as "downstream is safe" — and it is not: a hand-edit followed by a local command, a `git pull`, or a crash all reach the tracker with no LocTT code in the path. **Partly implemented:** V4's sync pre-flight (`f72461a`) is the gate's hook, and V6 (`f72461a`) closes the crash half. Cross-file dependency validation — a relationship implying its inverse on the target — is **implemented** (`17fae3f`), reported by `doctor` and sync pre-flight as `inconsistent`, blocking neither. |

## Workflow and config

| Key | Invariant | What breaks if violated |
|---|---|---|
| **D20** | Priority drag-reorder recomputes `value` as 1..N. `value` is never displayed — it exists for DSL sorting. | Showing `value` leaks an implementation detail; failing to recompute makes `order by priority` wrong. |
| — | Stored enum values are config **keys**, never human labels. | A label is display text and can change; storing it breaks every query and every task referencing it. |
| **WF-KEY** | A workflow entity's `key` is **immutable** — statuses, priorities, task_types, relationships, custom_fields, and custom-field enum values are all identified by `key`, and stored task frontmatter holds those keys. No edit path may change a `key`; a "rename" is delete+create. Enforced in core: `applyWorkflowEdit`'s `validateRemapCoversDeletions` treats a vanished in-use key as a deletion needing a remap, and the per-entity `edit*` functions (`workflow-entities.ts`) construct the updated def with `key: existing.key` and expose no `key` field. Custom-field `type` and `multi` are immutable too (SET-16) — `editCustomField` copies both from `existing`. | Task frontmatter stores keys, not defs. Rewriting a key in `workflow.yaml` without rewriting every task orphans every task pointing at the old key: the value no longer resolves to a def and reads as broken/degraded. Mutating `type`/`multi` in place can make already-stored task values invalid against the new shape. |
| **WF-DELETE** | Deleting a workflow entity that is **in use** must **remap or refuse**, never silently orphan. Where the op matrix allows it, the delete takes a `remapTo` key (or `null` to clear the value from tasks) and builds the `WorkflowRemap` directive `applyWorkflowEdit` rewrites tasks with; with neither, and the key in use, the delete throws. In-use is computed by `computeWorkflowKeyUsage`. **Exception:** a whole custom-field delete is **clear-only** (no remap target) — the field and its stored values are cleared from every task, matching the write path's field-level sweep. | An in-use status/priority/task_type/relationship/enum-value deleted with no remap leaves tasks referencing a key with no def — the same orphan WF-KEY guards against, reached by deletion instead of rename. Refusing (or requiring an explicit clear) forces the caller to decide where the affected tasks go before the def disappears. |

## Sprints

| Key | Invariant | What breaks if violated |
|---|---|---|
| **Q10** | Multiple simultaneously-`active` sprints are allowed. LocTT performs **no** automatic state transitions and **no** carryover. | "Helpfully" auto-completing a sprint past its end date mutates user data nobody asked to change. |
| — | Sprint `state` moves freely: any state to any state, on every surface, with no force flag. **K130 removed the transition guard** (completed could not be reopened without CLI `--force` / MCP `force`) under P11. The one refusal is an `end_date` before `start_date` ("End date is before the start date."), a storage rule, not policy. | Reinstating a guard, a warning or a confirmation on a state change polices the user's process (P11). |
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
| **Q18 / D4** | The body editor writes only on Save (K124, 2026-09-24). **Every body write, from any surface (web Save, CLI, MCP), records its own `body_edited` history entry** with that write's `before` and `after` (K128, 2026-09-24). No entry is merged into another. | Merging deliberate Saves into one entry loses every body state between them, which breaks the M2 guarantee that a lost merge race is recoverable from history. The 15-minute same-actor merge (with its 60-minute cap) existed only for the old 1.5s autosave and was removed by K128. Entries written by the old rule keep their `meta.coalesce_started_at` and stay readable. |
