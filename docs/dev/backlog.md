# Backlog

Work Ken has decided to do. Each item came from `known-gaps.md` (an open
defect) or a ruling, and carries the decision it rests on. When an item
ships, delete it here; its record lives in `decisions.md` and git.

Status: **todo** · **deciding** (a PM/UI call is pending, not Ken's) ·
**in progress** · **needs Ken** (blocked on a question to Ken).

---

## Product

---

## Tests and tooling

### B9. Bad `@verifies` tags and uncovered cases — in progress

K121 #9. 19 of 31 bad tags retagged (A323). Left: 12 tags naming behaviour
no case describes (N-4 ×6 in settings tests, CONFIG-5 ×4 in Header /
ShortcutHelpDialog tests, UI-16 ×2 in Sidebar tests) — write the cases,
then retag. CONFIG-5 done (case SHL-48). TML-51..59, XS-36/38/48 covered;
XS-3 rewritten (K122) with an e2e test; VUE-12, ERR-23, ERR-32 retired
(K122). Left: N-4 ×6 and UI-16 ×2 tags, TML-57's tag (Sidebar.test.tsx),
SET-15/25/31/37 tests — all in files B1 is editing; SET-52..54 (B1).

### B10. Investigate the three "flakes" — todo

K121 #10. BLK-24, BRD-4, GIT-12: run alone, repeatedly, at
`--workers=1`; fix the defect or the test.

### B14. Pair picker value assertions with option assertions — in progress

K121 #14. Helper `expectComboValueSelectable` added (A323), 4 call sites
switched. Left: 4 sites in `settings/` tests (SavedViewsPanel, TimelinePanel,
ViewFormDialog, EstimationPanel), blocked while another agent edits settings.

### B16. Delete the `FilterDropdown.tsx` alias — blocked (settings/)

K121 #16. Point callers at `list/FilterFacet.tsx` and remove the file.

---

## Housekeeping from this session

### B18. Full end-to-end pass against a clean build — todo

Every spec touched this session (toolbar TSK-72/18/61/59, spinner SHL-47
red-proof, VUE-22, GIT-1, CMT-2, BRD-39, SET-3, SET-25, ERR-5, LST-52,
SHL-42, A11Y-55, TSK-72's two-row layout, GIT-1/8/9/21/29 copy,
SET-3's default marker), then the whole suite at 2 workers.

### B19. Commit the working tree in themed commits — needs Ken

Two sessions of uncommitted work. Split into reviewable commits; no push
or PR without Ken. `stash@{0}` (the 16:40 stash) kept until Ken says to
drop it.
