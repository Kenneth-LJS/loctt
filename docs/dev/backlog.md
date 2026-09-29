# Backlog

Work Ken has decided to do. Each item came from `known-gaps.md` (an open
defect) or a ruling, and carries the decision it rests on. When an item
ships, delete it here; its record lives in `decisions.md` and git.

Status: **todo** · **deciding** (a PM/UI call is pending, not Ken's) ·
**in progress** · **needs Ken** (blocked on a question to Ken).

---

## B51 · SortableTree + TaskTree; aligned rows; drop line; child-progress meter (K156) — **in progress**

Replace `settings/ReorderableRows.tsx` and `relationships/Reorder.tsx`
with `ui/SortableTree` (nesting/maxDepth/startCollapsed, drop line for
drag and keyboard, within-level reorder only) and build
`relationships/TaskTree` on it for every relationship group; migrate
every Settings list (incl. the sidebar Filters group at depth 1);
delete the two old components; fix the child-progress meter; tests for
alignment, the drop line and every existing reorder flow.

## B52 · One "Views" sidebar section with counts and a shared count/⋯ slot (K158) — **todo** (after B51)

Merge the Filters and Saved views sections (and the stored sidebar order:
the `filters` and `saved-filters` groups become one `views` group, with
built-in and saved view ids in one ordered, hideable list; migrate
existing per-user settings); counts for saved views (broken → warning
mark); the count/⋯ slot (99+ cap, hover/focus swap, same width);
built-in ⋯ = Hide, saved ⋯ = Edit/Rename/Delete/Hide; Customize sidebar
lists the merged section on SortableTree; CLI/MCP sidebar-group tools
and docs follow the new ids; amend K125/A339-era cases.

Empty otherwise. B39–B50 shipped on `fix/parent-and-child-order`; records K140–K155, A357–A368.
