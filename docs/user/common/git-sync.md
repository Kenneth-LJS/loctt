# Git Sync

LocTT can optionally sync task data across machines using Git. This is entirely opt-in — LocTT works fine as a purely local tracker.

## Enabling Git-Backed Mode

```
loctt git enable     # Enable git sync
loctt git disable    # Disable git sync
loctt git status     # Show sync status
```

Git-backed mode uses a dedicated `loctt` branch managed through a sparse worktree. Do not manually modify this branch.

## Operations

### Publish

```
loctt git publish
```

Pushes local `.loctt/` state into the canonical `loctt` branch. If both local and remote state changed since the last sync, reconciliation runs automatically before the push.

### Sync

```
loctt git sync
```

Pulls canonical `loctt` branch state into the local workspace. If the remote hasn't changed since the last sync, this is a no-op. If both sides changed, reconciliation runs automatically as part of the sync.

## How Sync Works

Both `publish` and `sync` use a 3-way comparison:

- **Base** — state at the last synced commit
- **Local** — current local `.loctt/` state
- **Remote** — current `loctt` branch state

### Conflict Resolution

Reconciliation runs automatically when both sides diverged. If only one side changed a field, that side wins. If both changed to the same value, the shared value wins. If both changed differently, it's a conflict — see below for the per-field handling.

**Auto-mergeable fields:**
- `relationships` — merged by union of `(type, target)` pairs
- `key_history` — merged by union
- Custom fields — merged when different field keys were changed

**Conflict fields** (when changed differently on both sides):
- `title`, `status`, `parent`, `task_type`, `priority`
- `start_date`, `due_date`
- Same custom field key changed to different values

When a true conflict exists, `publish` / `sync` exits with a clear error pointing at the conflicting tasks and fields. Resolve by editing the values on one side to match the other, then re-run.

### Rekeying

After reconciliation, if multiple tasks claim the same key, a rekey pass runs:

1. Tasks are grouped by conflicting key
2. The task with the earlier `created_at` keeps the key (ULID `id` breaks ties)
3. Remaining tasks get new keys from `state.yaml`
4. Old keys are preserved in `key_history` and remain searchable

Both `publish` and `sync` print a summary before rekeying or applying reconciled changes.

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
