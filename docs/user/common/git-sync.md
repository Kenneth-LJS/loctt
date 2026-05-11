# Git Sync

LocTT can optionally sync task data across machines using Git. This is entirely opt-in — LocTT works fine as a purely local tracker.

## Enabling Git-Backed Mode

```
loctt git enable     # Enable git sync
loctt git disable    # Disable git sync
loctt git status     # Show sync status
```

Git-backed mode uses a dedicated `.loctt` branch managed through a sparse worktree. Do not manually modify this branch.

## Operations

### Publish

```
loctt publish
```

Pushes local `.loctt/` state into the canonical `.loctt` branch. If both local and remote state changed since the last sync, reconciliation runs automatically.

### Sync

```
loctt sync
```

Pulls canonical `.loctt` branch state into the local workspace. If the remote hasn't changed since the last sync, this is a no-op. If both sides changed, reconciliation runs.

### Reconcile

When publish or sync detects conflicting changes, reconciliation is needed:

```
loctt reconcile status     # Show what conflicts exist
loctt reconcile continue   # Apply resolved conflicts
loctt reconcile abort      # Discard reconciliation and revert
```

## How Sync Works

Both `publish` and `sync` use a 3-way comparison:

- **Base** — state at the last synced commit
- **Local** — current local `.loctt/` state
- **Remote** — current `.loctt` branch state

### Conflict Resolution

If only one side changed a field, that side wins. If both changed to the same value, the shared value wins. If both changed differently, it's a conflict.

**Auto-mergeable fields:**
- `relationships` — merged by union of `(type, target)` pairs
- `key_history` — merged by union
- Custom fields — merged when different field keys were changed

**Conflict fields** (when changed differently on both sides):
- `title`, `status`, `parent`, `task_type`, `priority`
- `start_date`, `due_date`
- Same custom field key changed to different values

### Rekeying

After reconciliation, if multiple tasks claim the same key, a rekey pass runs:

1. Tasks are grouped by conflicting key
2. The task with the earlier `created_at` keeps the key (ULID `id` breaks ties)
3. Remaining tasks get new keys from `state.yaml`
4. Old keys are preserved in `key_history` and remain searchable

Both `publish` and `sync` warn before rekeying or applying reconciled changes.

## Local Sync State

Machine-local sync metadata is stored in `.loctt/local/` (never published):

**`.loctt/local/sync.yaml`:**
```yaml
git:
  enabled: true
  branch: .loctt
  last_synced_commit: abc123
```

**`.loctt/local/reconcile.yaml`** (only exists during active reconciliation):
```yaml
mode: publish
base_commit: abc123
remote_commit: def456
started_at: 2026-04-16T14:30:00Z
```
