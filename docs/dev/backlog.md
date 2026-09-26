# Backlog

Work Ken has decided to do. Each item came from `known-gaps.md` (an open
defect) or a ruling, and carries the decision it rests on. When an item
ships, delete it here; its record lives in `decisions.md` and git.

Status: **todo** · **deciding** (a PM/UI call is pending, not Ken's) ·
**in progress** · **needs Ken** (blocked on a question to Ken).

---

## B26 · Single-key shortcuts: off switch and remapping (K133, A11Y-43) — **in progress**

Ken chose "Build remapping too" (WCAG 2.1.4). Settings → Keyboard gets
a switch that turns every single-key shortcut off, and each shortcut
can be rebound. Stored per user, so the CLI and MCP user-settings tools
read and write it too. Lands before `ui/polish-wave-3` merges.
