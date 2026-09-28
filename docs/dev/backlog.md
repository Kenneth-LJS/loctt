# Backlog

Work Ken has decided to do. Each item came from `known-gaps.md` (an open
defect) or a ruling, and carries the decision it rests on. When an item
ships, delete it here; its record lives in `decisions.md` and git.

Status: **todo** · **deciding** (a PM/UI call is pending, not Ken's) ·
**in progress** · **needs Ken** (blocked on a question to Ken).

---

## B48 · Intentional upgrades everywhere (K154) — **todo** (after the review fixes)

Remove the automatic upgrade (`upgradeIfSafe`) from CLI, MCP and web
entry points; every surface refuses an older tracker with K154's message;
doctor/info read-only everywhere; `loctt migrate` preview + confirm; web
Upgrade banner (UI design pass); MCP instructions and `migrate_schema`
description tell agents to ask the user first. Amend ONB-C11–C19 and the
K143-era cases; update docs (upgrading.md, CLI/MCP references, UI guide);
tests red-proven.

## B49 · Test-speed measurement (K146 follow-up) — **todo**

Measure: a smoke subset (blocker-case tests + runthrough smoke tags),
lint with `--cache`, and a unit-test time breakdown; report numbers to
Ken before changing anything.

Empty otherwise. B39–B47 shipped on `fix/parent-and-child-order` (2026-09-28); records are K140–K153 and A357–A365 in `decisions.md`.
