# Git Sync

LocTT can optionally sync task data across machines using Git. This is entirely opt-in — LocTT works fine as a purely local tracker.

## Enabling Git-Backed Mode

```
loctt git enable     # Enable git sync
loctt git disable    # Disable git sync
loctt git status     # Show sync status
```

Git-backed mode uses a dedicated `loctt` branch, managed through a temporary
worktree under `.loctt/local/`. Your own branch, working tree, and checked-out
files are never touched. Do not manually modify the `loctt` branch.

## Operations

### Publish

```
loctt git publish
```

Mirrors local `.loctt/` state onto the `loctt` branch — local is canonical,
so anything on the branch that is not in `.loctt/` is removed.

If the branch already exists and holds content LocTT did not write, the first
publish **refuses** rather than overwriting it, and tells you which files are
in the way. Either pick a different branch:

```
loctt config set git.branch loctt-tasks
```

…or delete the existing branch if it is no longer needed.

### Sync

```
loctt git sync
```

Pulls canonical `loctt` branch state into the local workspace. If the remote hasn't changed since the last sync, this is a no-op. If both sides changed, reconciliation runs automatically as part of the sync.

## How Sync Works

`sync` uses a 3-way comparison, per file:

- **Base** — state at the last synced commit (`last_synced_commit`)
- **Local** — current local `.loctt/` state
- **Remote** — current `loctt` branch state

The base is what makes the difference between "the branch deleted this file"
and "I created this file locally" — the two look identical without it. When
no base is available (a first sync, or rewritten history), sync will not
delete anything it cannot prove was deleted deliberately.

Per file, sync:

- **takes the branch version** when only the branch changed it, or when the
  file is new on the branch
- **keeps the local version** when only you changed it, when you created it
  since the last sync, or when it is identical either way
- **deletes it locally** when the branch deleted it since the base
- **merges it** when both sides changed the same file and LocTT has a rule
  for that file type (see below)
- **stops with a conflict** when both sides changed the same file and there
  is no rule for it

`.schema-version` is never taken from the branch. Schema changes travel
through `loctt migrate`, so a machine running a newer LocTT cannot push a
version bump onto one running an older release.

### Merging and conflicts

When both sides changed the same file since the last sync, LocTT merges it
where it can:

| File | How it merges |
|---|---|
| A task's `task.md` | Field by field. The version with the later `updated_at` wins any field the two disagree on. `relationships` and `key_history` are **unioned** instead — each entry was added deliberately, so neither side's is dropped. |
| `_history.yaml` | Unioned. Both sides' entries are kept and ordered into one timeline. |
| `_comments.yaml` | Unioned by comment id. A **deletion beats a concurrent edit** — if one clone deleted a comment and another edited it, it stays deleted. |
| `config/projects.yaml`, `config/queries.yaml` | Unioned by entry id, so neither side's additions are lost. |
| `state.yaml` | Key counters are recomputed from the tasks that exist after the merge, rather than being merged arithmetically. |

**The losing body is never thrown away.** When two clones edited the same
task's markdown, the newer one becomes the task body and the older is
written beside it as `task.local.md` or `task.incoming.md`. Delete that
file once you have taken what you need from it.

Anything without a rule — `config/workflow.yaml` most notably — still
**aborts without writing anything** and names the file. Your local files
are left exactly as they were. Resolve by making one side match the other,
then re-run `loctt git sync`.

Workflow config is deliberately not merged: statuses and priorities are
referenced by every task, so combining two divergent vocabularies could
leave tasks pointing at a status the merged config does not define.

### Delete versus edit

When one side **deleted** a task and the other **edited** it since the last
sync, LocTT does not let either side win silently — a blind sync would
otherwise either propagate the deletion over your edit, or resurrect the
edited task over the deletion. Instead it is surfaced as a reconciliation
decision naming the task and stating which side deleted it and which edited
it, with two choices:

- **Keep the deletion** — the task is removed.
- **Keep the task** — the edited version stands.

In the web UI this appears as a keep-deletion / keep-task row in the
reconcile panel. On the CLI it is listed by `loctt git reconcile status`
under "delete-vs-edit" and decided in the `apply` JSON via the reserved
field `__delete_vs_edit__` (see the CLI reference); the outcome is reported
by key. Keeping a task whose key would then collide with another is routed
through the normal rekey confirmation — it is never resurrected with a
colliding key silently.

### Duplicate keys and prefixes

Two trackers that were `loctt init`ed separately both mint `T-` keys, so
merging them would otherwise produce two projects claiming the same key
space and two tasks answering to `T-1`.

After a merge LocTT repairs both automatically:

- One project keeps its prefix (the one created first); the others get a
  **provisional prefix** — `T-` becomes `T2-`, and so on.
- Every task in a re-prefixed project is renamed, keeping its number:
  `T-3` becomes `T2-3`. The old key is kept in `key_history`, so
  `loctt show T-3` still resolves.
- If two tasks in the *same* project still share a key, the one created
  later is renumbered.

Provisional prefixes are meant to be replaced, not lived with:

```
loctt project set-prefix "Design work" DESIGN-
```

The rekey pass, in detail:

1. Tasks are grouped by conflicting key
2. The task with the earlier `created_at` keeps the key (ULID `id` breaks ties)
3. Remaining tasks get new keys from `state.yaml`
4. Old keys are preserved in `key_history` and remain searchable

Every step is derived from what is on disk, so two clones running the same
sync reach the same result rather than diverging.

### Confirming a rekey

Because a rekey renumbers a task — changing a user-facing key — it is
surfaced differently on each surface:

- **In the web UI**, the reconcile panel shows a **rekey preview** before
  anything is renumbered: for each collision, which key collided, which
  task keeps it and which is renumbered, both tasks' `created_at` and
  ULIDs, the tiebreak rule that decided the keeper, and the planned new
  key. Nothing is written until you click **Confirm rekey**. If a sync also
  needs per-field reconciliation, you resolve those fields first and the
  rekey preview is the final step of the same panel.
- **On the CLI and MCP**, the rekey is applied automatically (they stay
  scriptable — there is no interactive pause) and the result reports each
  renumber, old key → new key:

  ```
  Renumbered 1 task(s) to resolve key collisions:
    T-2 → T-3
  ```

If a collision cannot be renumbered — a task whose project has no key
counter yet, because its `projects.yaml` has not merged — it is reported as
an **unresolved key**, never silently dropped:

```
Warning: 1 key collision(s) remain unresolved: T-2. Run 'loctt doctor'.
```

Run `loctt doctor` for the detail, and the collision also shows in
Diagnostics.

## Local Sync State

Machine-local sync metadata is stored in `.loctt/local/` (never published):

**`.loctt/local/sync.yaml`:**
```yaml
git:
  enabled: true
  branch: loctt
  last_synced_commit: abc123
```

**`.loctt/local/reconcile.yaml`** (only present during an in-progress reconciliation; cleared on success):
```yaml
mode: publish
base_commit: abc123
remote_commit: def456
started_at: 2026-04-16T14:30:00Z
```

### If a sync is interrupted

A sync writes many files and has no single moment where it is atomically
"done". If it dies partway — a kill, a crash, a power loss — this file is
left behind, and your workspace holds some of the incoming changes but
not all of them.

The next `loctt git sync` will refuse to run, and say so:

```
a previous 'sync' reconciliation was interrupted (started ..., syncing abc12345 → def45678).
```

It refuses rather than retrying because the commit it would plan against
no longer describes your files, so a fresh sync could overwrite local
edits. `loctt doctor` reports the same thing if you want to check later.

To recover: compare your `.loctt/` against the `loctt` branch, make it
whole, then delete `.loctt/local/reconcile.yaml`. The next sync re-plans
from scratch.
