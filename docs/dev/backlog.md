# Backlog

Work Ken has decided to do. Each item came from `known-gaps.md` (an open
defect) or a ruling, and carries the decision it rests on. When an item
ships, delete it here; its record lives in `decisions.md` and git.

Status: **todo** · **deciding** (a PM/UI call is pending, not Ken's) ·
**in progress** · **needs Ken** (blocked on a question to Ken).

---

## B39 · `create --parent` stores the key and no inverse (K140) — **in progress**

`createTask` must resolve the parent (key or id → id), refuse a missing or
archived parent like `linkTask`, and write the forward and inverse tree
edges (with rank) under the same lock. CLI and MCP regression tests for
the exact report (create --parent KEY → child stores the id, the parent
lists the child, doctor is clean, unlink works). `doctor` detects
relationship targets stored as keys and missing inverses, and its repair
fixes them; CLI and MCP docs updated.

## B40 · Reorder a task's children on the task page (K140) — **in progress**

The Children group (`graph: tree`, `TreeGroup` in
`relationships/RelationshipsPanel.tsx`) gets drag handles and keyboard
reordering for the task's direct children, using the existing rerank
mutation (`reorderRelationship` on the `child` edges). The order shows
everywhere children are listed.
