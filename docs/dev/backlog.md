# Backlog

Work Ken has decided to do. Each item came from `known-gaps.md` (an open
defect) or a ruling, and carries the decision it rests on. When an item
ships, delete it here; its record lives in `decisions.md` and git.

Status: **todo** · **deciding** (a PM/UI call is pending, not Ken's) ·
**in progress** · **needs Ken** (blocked on a question to Ken).

---

## B28 · Remove the red overdue due date on tasks (K135) — **in progress**

List and board (and any other surface) stop colouring an overdue task due
date; the date is shown plainly. Amend the cases that require it.

## B29 · MCP tool descriptions without em dashes (K135) — **in progress**

## B30 · Disabled toggles read as disabled in dark mode (K135) — **in progress**

## B31 · Each unreadable candidate file gets its own reason (K135) — **in progress**

`UnreadableTaskError`'s indeterminate case prints every candidate path
with its own reason, so no path appears twice.

## B32 · Zero lint warnings (K135) — **todo**

Fix all 65 warnings (hook dependencies, non-null assertions) without
changing behaviour.

## B33 · Release-gate audit (K135) — **in progress**

Check every item in `docs/dev/process/release-readiness.md` and the
UI-adoption blockers in `docs/dev/design/design-review.md` against the
code, and report which are resolved.
