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
- **stops with a conflict** when both sides changed the same file differently

`.schema-version` is never taken from the branch. Schema changes travel
through `loctt migrate`, so a machine running a newer LocTT cannot push a
version bump onto one running an older release.

### Conflict Resolution

When both sides changed the same file since the last sync, `sync` **aborts
without writing anything** and names the conflicting files. Your local files
are left exactly as they were.

Resolve by making one side match the other — edit locally, or check out the
`loctt` branch and edit there — then re-run `loctt git sync`.

> **Field-level merging is not implemented yet.** The plan is for two edits
> to *different fields of the same task* to merge automatically
> (`relationships` and `key_history` by union, disjoint custom fields
> side-by-side), with only same-field disagreements reported as conflicts.
> Today any two edits to the same file conflict, even when they touch
> unrelated fields. The merge helpers exist in `packages/core/src/git/reconcile.ts`
> but are not yet wired into the sync path.

### Rekeying

> **Not implemented yet.** `rekeyCollisions` exists in
> `packages/core/src/git/reconcile.ts` and is unit-tested, but no sync path
> calls it. Until it is wired up, two clones that each create a task while
> offline can both claim the same key; the second one to sync will hit a
> conflict on `state.yaml` rather than being rekeyed automatically.

The intended behaviour, once reconciliation lands: if multiple tasks claim
the same key after a merge, a rekey pass runs.

1. Tasks are grouped by conflicting key
2. The task with the earlier `created_at` keeps the key (ULID `id` breaks ties)
3. Remaining tasks get new keys from `state.yaml`
4. Old keys are preserved in `key_history` and remain searchable

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
