# LocTT Implementation Plan

This document breaks implementation into 39 tickets.

The tickets are intentionally small and roughly ordered by dependency.

Implementation language/runtime:

- Node/TypeScript
- monorepo with:
  - `apps/cli`
  - `apps/mcp`
  - `apps/service`
  - `apps/web`
  - `packages/core`
  - `packages/contracts`

## Core Files / Schema

1. ~~Scaffold the monorepo, workspace config, and shared TypeScript tooling.~~ **DONE**
2. ~~Scaffold `packages/core` and `packages/contracts`.~~ **DONE**
3. ~~Scaffold `apps/cli`, `apps/mcp`, `apps/service`, and `apps/web`.~~ **DONE**
4. ~~Define `.loctt/` path layout and path helper utilities in `packages/core`.~~ **DONE**
5. ~~Implement `.loctt/config/workflow.yaml` loading.~~ **DONE**
6. ~~Implement `.loctt/config/queries.yaml` loading.~~ **DONE**
7. ~~Implement `.loctt/state.yaml` loading and writing.~~ **DONE**
8. ~~Implement `.loctt/local/sync.yaml` and `.loctt/local/reconcile.yaml` loading/writing.~~ **DONE**
9. Implement `task.md` frontmatter parsing and writing.
10. Implement markdown body reading/writing for tasks.
11. Implement workflow/config validation.
12. Implement key allocation, `next_number`, and `key_history`.

## Task Model / CRUD

13. Implement task lookup by `id` and `key`.
14. Implement task creation with required fields and optional initial fields.
15. Implement task read/show model.
16. Implement `set` / `unset` for built-in fields.
17. Implement `set` / `unset` for custom fields.
18. Implement archive / unarchive behavior.
19. Implement hard delete with `--force`.
20. Implement attachment discovery from task folders.

## Relationships

21. Implement relationship add/remove (`link` / `unlink`).
22. Implement relationship validation and traversal helpers.

## Query Engine

23. Implement query tokenizer/parser.
24. Implement query evaluation over task metadata.
25. Implement `text` alias behavior.
26. Implement `parent` alias behavior.
27. Implement relationship-based query filtering.
28. Implement saved views from `queries.yaml`.
29. Implement list defaults, sorting, limit, `--query`, and `--view`.

## CLI

30. Implement `loctt init`, including sane-defaults mode and docs generation.
31. Implement `loctt info` and `loctt doctor`.
32. Implement the main CLI command surface on top of `packages/core`.

## Git-Backed Mode

33. Implement `loctt git enable` / `disable` / `status`.
34. Implement sparse worktree setup plus `publish` / `sync` happy path.
35. Implement reconciliation, conflict handling, and rekeying.

## Service / Web

36. Implement `packages/contracts` shapes for service/web data exchange.
37. Implement the local service layer on top of `packages/core`.
38. Implement the web app shell and service integration.

## MCP

39. Implement MCP read/write/body-edit surface plus `publish` / `sync` wrappers and guardrails.
