# Backlog

Work Ken has decided to do. Each item came from `known-gaps.md` (an open
defect) or a ruling, and carries the decision it rests on. When an item
ships, delete it here; its record lives in `decisions.md` and git.

Status: **todo** · **deciding** (a PM/UI call is pending, not Ken's) ·
**in progress** · **needs Ken** (blocked on a question to Ken).

---


## B54 · Sidebar settings upgrade step 0.3.0 → 0.4.0 (K160) — **in progress**

Format 0.4.0: an upgrade step converting every `users/*/settings.yaml`
from the pre-K158 `sidebar_groups` (+ legacy `sidebar_pins`) to the K158
version-2 layout, then deleting the old keys; remove the read-time
migration (B52) and the pins-kept exception (B53); an old shape after the
step degrades to the default with a doctor finding; seeds and fixtures
upgraded; `loctt` 0.4.0.

Empty otherwise. B51–B53 shipped on `ui/sortable-tree`; records are K156–K159 and A369–A371 in `decisions.md`.
