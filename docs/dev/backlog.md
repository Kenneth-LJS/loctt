# Backlog

Work Ken has decided to do. Each item came from `known-gaps.md` (an open
defect) or a ruling, and carries the decision it rests on. When an item
ships, delete it here; its record lives in `decisions.md` and git.

Status: **todo** · **deciding** (a PM/UI call is pending, not Ken's) ·
**in progress** · **needs Ken** (blocked on a question to Ken).

---


## B56 · An unparseable settings.yaml degrades instead of failing (G12) — **todo**

Ken put it in the 0.4.0 stack (2026-09-29). Loading a user's settings
file that does not parse falls back to defaults (field-local), the
surfaces keep working, doctor keeps naming the file, and a settings write
does not overwrite the unreadable file silently.

Empty otherwise. B51–B55 shipped on `ui/sortable-tree`; records are K156–K161 and A369–A374 in `decisions.md`.
