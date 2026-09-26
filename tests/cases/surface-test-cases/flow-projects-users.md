# Projects and users

Project and user CRUD, archive semantics, current-user identity, avatars,
and the recents list.

Zero integration coverage exists for either lifecycle on either surface —
`tests/integration/cli/` has no `project.test.ts` or `user.test.ts`, and none
of the 30 MCP integration files touch these tools. Core coverage is strong.

Gaps only. See [README.md](README.md) for conventions.

---

## A. Project lifecycle

### PRU-C1 · blocker · P10 P1 · CLI MCP
**Project create writes a ULID-keyed entry and seeds its counter.**

- Creating `Backend` with prefix `BACKEND-` exits 0 and returns an id.
- `projects.yaml` gains an entry whose `id` is a 26-char ULID, `name` is
  `Backend`, `prefix` is `BACKEND-`, and which contains **no** `key` and no
  `label` field — `ProjectDefSchema` is `.strict()` with exactly
  `{id, name, prefix, archived?}`.
- `state.yaml` gains `keys.<that-id>` with `prefix: BACKEND`,
  `next_number: 1`. (Stored bare; the `-` is inserted at key render — K88.)
- A second create reusing the same prefix is refused with
  `prefixes must be unique`, and writes nothing.
- MCP `list_projects` returns `{projects:[…], default: <id|null>}` where
  `default` is always an id, never a name.

**Given** an initialised tracker, **when** a project is created on each
surface, **then** both write a ULID-keyed entry with a matching seeded
counter, and both refuse a duplicate prefix.

### PRU-C2 · major · P10 · CLI MCP
**Archive and unarchive round-trip on every surface.** The web has no
archive route for projects at all, and `editProject` does not accept an
`archived` parameter — so a project archived elsewhere cannot be unarchived
from the web.

- After archiving, the entry has `archived: true`; after unarchiving, the
  key is **absent**, not `false`.
- `loctt project list` omits archived entries; `--all` includes them with
  an `(archived)` marker.
- Archiving the workspace `default` project clears the `default:` line.
- Re-archiving an already-archived project exits 0 and leaves the file
  byte-identical.
- The web exposes archive and unarchive, or documents their absence.

**Given** projects `Backend` (default) and `Web`, **when** `Backend` is
archived then unarchived, **then** the flag is set and then fully removed,
the default is cleared on archive, and re-archiving is idempotent.

### PRU-C3 · major · P4 · CLI MCP
**Delete resolves the ref before prompting or mutating.**

- Deleting a nonexistent project on a non-TTY without `--yes` exits
  non-zero **without** emitting `Permanently delete`.
- The message contains `unknown project: <ref>`.
- MCP `delete_project` without `confirm` returns an error naming the tool
  and modifies nothing.
- `loctt user delete` behaves the same way — a regression lock on the
  already-correct path.

**Given** a tracker with one project, **when** delete runs with a
nonexistent name, **then** it fails with an unknown-project error and never
presents a destructive prompt.

### PRU-C4 · major · P4 P5 · CLI MCP
**Hard delete enforces each precondition separately.** `DELETE /api/projects/:id`
never passes `hard:true`, so it soft-archives while responding
`200 {"deleted":…}` — and `?remap_to` returns the raw CLI string
`"--remap-to only applies to --hard delete"` over HTTP.

- Deleting the only project fails with `cannot delete the only project` —
  a guard that never fires over HTTP today.
- Deleting a project holding 2 tasks without a remap target fails and
  states the task count.
- With a remap target: exit 0, both tasks' `project` equals the target's
  **id**, and both tasks' `key` strings are unchanged.
- `projects.yaml` no longer holds the deleted id; `state.yaml` has it under
  `retired_keys`, not `keys`.
- MCP returns `{id, remappedTaskCount:N}` where N equals the number of
  tasks whose `project` changed.
- Any surface reporting `deleted` actually deleted.

**Given** a project holding two tasks and a remap target, **when** it is
hard-deleted with remap, **then** both tasks point at the target id with
original keys intact and the counter moves to `retired_keys`.

### PRU-C5 · major · P10 · MCP
**Name-addressing works when unique and fails loudly when not.**

- `edit_project {project:"Backend", name:"Backend Services"}` succeeds
  addressed by name, and the rename leaves the id unchanged.
- With two projects both named `Backend`, the same call fails with a
  message containing `ambiguous` and listing both ids.

**Given** two projects sharing a name, **when** an agent addresses one by
name, **then** the error lists both ids so it can retry unambiguously.

---

## B. User lifecycle and identity

### PRU-C6 · major · P10 · CLI MCP
**User create, switch, and archive guard the active user.**

- Creating a user with `--switch` writes
  `.loctt/users/<ulid>/profile.yaml` with the given name and email, and
  `.loctt/.current-user` contains exactly that ULID.
- `loctt user current` prints that ULID and name.
- Switching rewrites `.current-user` to the other user's id.
- Archiving the currently-active user is refused with
  `cannot archive the active user` on both surfaces.

**Given** a bootstrap user, **when** a second is created with `--switch`
then switched away from, **then** `.current-user` tracks each switch and
archiving whoever is active is refused.

### PRU-C7 · major · P5 P7 · MCP
**`delete_user` guards fire one at a time.**

- Without `confirm:true`: errors, removes nothing.
- With `confirm:true` on a user with references but neither `remap_to` nor
  `unassign`: errors and states the reference count.
- `remap_to` and `unassign` together: errors with `mutually exclusive`.
- With `unassign:true`: affected tasks' `assignee`/`reporter` become
  absent, and `.loctt/users/<id>/` no longer exists on disk.

**Given** a user who is assignee on one task and reporter on another,
**when** each incomplete call shape is attempted, **then** every guard fires
with its own message and only the complete call mutates anything.

### PRU-C8 · major · P4 P10 · MCP
**`set_user_setting` exists, or the docs stop naming it.** Documented at
`docs/user/mcp/reference.md:54`; exists nowhere in the codebase — so step 2
of the documented project-resolution chain has no writer.

- The tool list contains `set_user_setting`, or the reference no longer
  names it.
- If present, `{key:"default_project", value:<id>}` writes
  `.loctt/users/<current>/settings.yaml`, and a subsequent `create_task`
  with no `project` lands in that project.
- A schema-contract test (extending
  `tests/e2e/11-mcp-schema-contract.test.ts`) asserts every tool named in
  the reference is registered — preventing the two from diverging again.

**Given** the reference documents the tool, **when** an agent enumerates
tools, **then** it is present, or the documentation no longer claims it.

### PRU-C9 · minor · P4 P10 · CLI — **resolved**
**Documented-but-absent flags are rejected, not ignored.**
`docs/user/cli/reference.md:116-121` documents a `--label` flag the CLI
never reads, so the worked example silently creates a project named `web`
and discards the label.

- `loctt project create web --prefix WEB --label "Website"` either exits
  non-zero naming `--label` as unknown, or creates a project named
  `Website`.
- It must **not** create a project named `web` with the label discarded.
- Whichever is chosen, `docs/user/cli/reference.md:116` matches exactly.

**Given** the reference documents a `--label` flag, **when** a user copies
the example verbatim, **then** the flag is honoured or rejected explicitly.

Resolved by correcting the reference: the block documented `<key>` and
`--label` throughout, both pre-migration vocabulary. It now documents
`<name|id>` and `--name`, matching what the CLI reads.

### PRU-C10 · blocker · P1 P10 · CLI MCP
**Changing a prefix renames every task in the project, and nothing else.**
`set-prefix` rewrites `projects.yaml`, `state.yaml`, every task's `key`,
and the key index. A partial application leaves the tracker claiming one
prefix while its tasks carry another.

- A project with tasks `T-1`, `T-2`, `T-3` set to prefix `WEB-` yields
  `WEB-1`, `WEB-2`, `WEB-3` — **numbers preserved**, nothing renumbered.
- Each renamed task's `key_history` gains its previous key, so
  `loctt show T-2` still resolves after the change.
- `state.yaml`'s counter for that project carries the new prefix and the
  **same** `next_number` — the next task created is `WEB-4`, never
  `WEB-1`.
- Tasks in *other* projects are untouched: keys, `key_history` and
  `updated_at` all unchanged.
- Both surfaces report how many tasks were renamed.

**Given** a project with three tasks, **when** its prefix is changed,
**then** all three carry the new prefix at their original numbers and the
old keys still resolve.

### PRU-C11 · blocker · P4 P10 · CLI MCP
**A prefix already in use is rejected before anything is written.**
Prefix uniqueness is enforced at `createProject`
(`projects/manage.ts:199`), so it is an invariant the whole codebase may
rely on — a second door that bypasses it would break that assumption
silently.

- Setting project B's prefix to project A's exits non-zero (CLI) /
  returns `isError` (MCP), and the message names the prefix and the
  project already holding it.
- No task is renamed and `projects.yaml` is byte-identical afterwards.
- Setting a project's prefix to the one it already has is a no-op that
  succeeds without rewriting tasks — not an error.

**Given** two projects, **when** one is set to the other's prefix,
**then** the attempt is refused and no file changed.

### PRU-C12 · blocker · P1 · CLI MCP
**An interrupted prefix change is completed, not left half-applied.**
The rewrite spans every task in the project, so a crash partway leaves
some tasks renamed and some not. The state lock is released on process
exit and protects nothing here.

- A crash after some tasks are renamed leaves a sentinel recording the
  project and the from/to prefixes.
- The next LocTT command detects it and finishes the remaining tasks
  rather than reporting a healthy tracker.
- Completion is idempotent: a task already carrying the new prefix is
  skipped, never renamed twice or given a duplicate `key_history` entry.
- `loctt doctor` reports the interrupted state while the sentinel exists.

**Given** a prefix change interrupted mid-rewrite, **when** any command
next runs, **then** the change is completed and no task is left on the
old prefix.

### PRU-C13 · major · P10 P11 · CLI
**`loctt user shortcuts` reads and sets the single-key shortcut switches.**
The web Settings → Keyboard switches are a core capability (K133), so the
CLI reads and writes the same `keyboard_shortcuts` setting.

- With no flags it prints the master switch, then each shortcut's id,
  keys, `on`/`off` and action.
- `--single-key on|off`, `--off <id>` and `--on <id>` write the setting
  the web app reads; `--reset` removes it and keeps other settings.
- An unknown id is refused, naming it and the valid ids, and nothing is
  written.
- A hand-corrupted value reads back degraded (valid parts kept), not as
  a crash, and `loctt doctor` names the dropped part.

**Given** a fresh tracker, **when** `--single-key off --off goto` runs,
**then** `settings.yaml` holds `single_key: false` and `disabled: [goto]`
and the print shows both off.

### PRU-C14 · major · P10 P11 · MCP
**`get_keyboard_shortcuts` / `set_keyboard_shortcuts` read and set the switches.**
The MCP half of PRU-C13.

- `get_keyboard_shortcuts` returns `single_key` and each shortcut's keys,
  `on` and `active`.
- `set_keyboard_shortcuts` takes `single_key`, `off`, `on`, or `reset`
  alone, writes the same setting, and returns the resulting state.
- An unknown id is an error naming it, and nothing is written.

**Given** a fresh tracker, **when** `set_keyboard_shortcuts` turns
`cycle-theme` off, **then** it reads back inactive and every other
shortcut stays active.

