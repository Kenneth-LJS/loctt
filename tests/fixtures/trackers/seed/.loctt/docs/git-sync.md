# Git Sync

LocTT supports optional Git-backed mode using a `.loctt` branch with sparse worktree.

## Commands
- `loctt git enable` — Enable Git-backed mode
- `loctt git disable` — Disable Git-backed mode
- `loctt publish` — Push local state to the canonical branch
- `loctt sync` — Pull canonical state into local workspace

## Rules
- Do not manually edit the `.loctt` branch
- Conflicts are resolved through the reconcile flow
