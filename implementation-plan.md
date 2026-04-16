# LocTT Implementation Plan

This document breaks implementation into 35 tickets.

The tickets are intentionally small and roughly ordered by dependency.

Implementation language/runtime:

- Node/TypeScript

## Core Files / Schema

1. Scaffold project/runtime and top-level CLI entrypoint.
2. Define `.loctt/` path layout and path helper utilities.
3. Implement `.loctt/config/workflow.yaml` loading.
4. Implement `.loctt/config/queries.yaml` loading.
5. Implement `.loctt/state.yaml` loading and writing.
6. Implement `.loctt/local/sync.yaml` and `.loctt/local/reconcile.yaml` loading/writing.
7. Implement `task.md` frontmatter parsing and writing.
8. Implement markdown body reading/writing for tasks.
9. Implement workflow/config validation.
10. Implement key allocation, `next_number`, and `key_history`.

## Task Model / CRUD

11. Implement task lookup by `id` and `key`.
12. Implement task creation with required fields and optional initial fields.
13. Implement task read/show model.
14. Implement `set` / `unset` for built-in fields.
15. Implement `set` / `unset` for custom fields.
16. Implement archive / unarchive behavior.
17. Implement hard delete with `--force`.
18. Implement attachment discovery from task folders.

## Relationships

19. Implement relationship add/remove (`link` / `unlink`).
20. Implement relationship validation and traversal helpers.

## Query Engine

21. Implement query tokenizer/parser.
22. Implement query evaluation over task metadata.
23. Implement `text` alias behavior.
24. Implement `parent` alias behavior.
25. Implement relationship-based query filtering.
26. Implement saved views from `queries.yaml`.
27. Implement list defaults, sorting, limit, `--query`, and `--view`.

## CLI

28. Implement `loctt init`, including sane-defaults mode and docs generation.
29. Implement `loctt info` and `loctt doctor`.
30. Implement the main CLI command surface on top of the domain layer.

## Git-Backed Mode

31. Implement `loctt git enable` / `disable` / `status`.
32. Implement sparse worktree setup plus `publish` / `sync` happy path.
33. Implement reconciliation, conflict handling, and rekeying.

## MCP

34. Implement MCP read and structured write surface.
35. Implement MCP body-edit tools plus MCP `publish` / `sync` wrappers and guardrails.
