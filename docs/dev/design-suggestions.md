# LocTT Design Doc Suggestions

This document contains unresolved LLM suggestions only.

Nothing here is confirmed product direction unless it is explicitly moved into the relevant doc under `docs/`.

This file is the implementation-readiness checklist for remaining design decisions.

## Blocking Decisions

These should be decided before implementation begins in earnest.

### 1. GUI Initial Product Slice

Confirmed:

- GUI should support search, navigation, and timeline/Gantt-style views
- Frontend is being prototyped in `task-tracker` repo, then migrated into `apps/web`
- Design doc: `~/Documents/PDev/task-tracker/design-doc.md`

Still unresolved:

- what the first useful GUI surface actually includes
- which views are mandatory initially
- which editing actions belong in GUI initially

### 2. Relationship Ranking

The task-tracker frontend needs ordered relationships within a `(task, type)` group
(e.g. reorder children of a ticket via drag-and-drop). This requires a ranking mechanism
in the core data model.

Options:

- **Array position as implicit rank** — simplest; array order in YAML = display order.
  Fragile if multiple writers (git sync) touch the same list concurrently.
- **Explicit `rank` field on TaskRelationship** — matches task-tracker's lexorank design.
  More robust but changes the schema.

Decision needed before frontend migration.

## Important But Not Strictly Blocking

These should be decided before broad implementation spreads too far, but do not need to block initial core work.

## Can Be Deferred

These should not block initial implementation.

### 6. Richer GUI Behavior

- advanced grouping and dashboards
- richer non-parent relationship tree views
- more advanced inline editing behavior
- drag-to-reorder within relationship groups (depends on relationship ranking decision above)

## Working Rule

Only move decisions from this file into the relevant doc under `docs/` after they are explicitly confirmed in discussion.
