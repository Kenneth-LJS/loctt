# Backlog

Work Ken has decided to do. Each item came from `known-gaps.md` (an open
defect) or a ruling, and carries the decision it rests on. When an item
ships, delete it here; its record lives in `decisions.md` and git.

Status: **todo** · **deciding** (a PM/UI call is pending, not Ken's) ·
**in progress** · **needs Ken** (blocked on a question to Ken).

---

## B53 · Retire pinned views (K159) — **in progress**

Remove the Pinned views settings panel and route, `sidebar_pins` (contracts,
core, per-user settings write paths; a stored value is ignored and dropped
on the next write, with a doctor note if the corruption guide calls for one),
CLI `--sweep-pins`, MCP `sweep_sidebar_pins`, their docs and tests; keep the
one-time seeding of the K158 migration from existing pins. Retire SET-13 and
every pin case entirely (not commented out); close G10.

Empty otherwise. B39–B50 shipped on `fix/parent-and-child-order`; records K140–K155, A357–A368.
