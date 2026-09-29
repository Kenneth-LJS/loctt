# Backlog

Work Ken has decided to do. Each item came from `known-gaps.md` (an open
defect) or a ruling, and carries the decision it rests on. When an item
ships, delete it here; its record lives in `decisions.md` and git.

Status: **todo** · **deciding** (a PM/UI call is pending, not Ken's) ·
**in progress** · **needs Ken** (blocked on a question to Ken).

---

## B52 · One "Views" sidebar section with counts and a shared count/⋯ slot (K158) — **in progress**

Merge the Filters and Saved views sections (and the stored sidebar order:
the `filters` and `saved-filters` groups become one `views` group, with
built-in and saved view ids in one ordered, hideable list; migrate
existing per-user settings); counts for saved views (broken → warning
mark); the count/⋯ slot (99+ cap, hover/focus swap, same width);
built-in ⋯ = Hide, saved ⋯ = Edit/Rename/Delete/Hide; Customize sidebar
lists the merged section on SortableTree; CLI/MCP sidebar-group tools
and docs follow the new ids; amend K125/A339-era cases.

## B53 · Retire pinned views (K159) — **todo** (after B52 lands)

Remove the Pinned views settings panel and route, `sidebar_pins` (contracts,
core, per-user settings write paths; a stored value is ignored and dropped
on the next write, with a doctor note if the corruption guide calls for one),
CLI `--sweep-pins`, MCP `sweep_sidebar_pins`, their docs and tests; keep the
one-time seeding of the K158 migration from existing pins. Retire SET-13 and
every pin case entirely (not commented out); close G10.

Empty otherwise. B39–B50 shipped on `fix/parent-and-child-order`; records K140–K155, A357–A368.
