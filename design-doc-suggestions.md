# LocTT Design Doc Suggestions

This document contains unresolved LLM suggestions only.

Nothing here is confirmed product direction unless it is explicitly moved into `design-doc.md`.

This file is the implementation-readiness checklist for remaining design decisions.

## Blocking Decisions

These should be decided before implementation begins in earnest.

### 1. GUI Initial Product Slice

Confirmed:

- GUI should support search, navigation, and timeline/Gantt-style views

Still unresolved:

- what the first useful GUI surface actually includes
- which views are mandatory initially
- which editing actions belong in GUI initially

## Important But Not Strictly Blocking

These should be decided before broad implementation spreads too far, but do not need to block initial core work.

## Can Be Deferred

These should not block initial implementation.

### 6. Richer GUI Behavior

- advanced grouping and dashboards
- richer non-parent relationship tree views
- more advanced inline editing behavior

## Working Rule

Only move decisions from this file into `design-doc.md` after they are explicitly confirmed in discussion.
