# Known gaps

Defects that are real, understood, and not yet fixed. Each says what is
wrong, how to reproduce it, and what (if anything) Ken has to decide
before it can be built.

**Check here before reporting a defect as new.** Delete an entry the
moment it is fixed. Nothing here is "deferred" (K117): an item stays
open until it is fixed or Ken rules on it. Fixed and accepted items live
in `decisions.md` and git history, not here. Process lessons live in
`docs/dev/process/build-loop.md`.

---

(G1–G7, found by the B42 runthrough, were fixed by B44.)

(G8, unranked links from a git sync, was fixed by B46: sync ranks them as
it applies the branch, K151. G9, the git specs' sync waits sitting on
Playwright's 5 s default, was fixed by `SYNC_SETTLE_MS` in
`tests/ui/fixtures/git-tracker.ts`, A365.)

## G10 · Pinned views no longer order the sidebar once the Views layout is saved (K158, needs Ken)

K158 (B52, A370) made the Views section's order the per-user
`sidebar_groups` setting, with built-in and saved views in one list, and
removed Pin from the sidebar row's ⋯ (Ken's list: Edit, Rename, Delete,
Hide). `sidebar_pins` still exists: it sets a saved view's *default*
place (pinned first) until the user places the view, and seeds the order
an older setting migrates to. But as soon as Customize sidebar or a Hide
writes the layout, every saved view has a stored place, and reordering
Settings → Pinned views changes nothing in the sidebar. SET-13's second
bullet ("Reordering the list reorders the sidebar group immediately")
cannot be satisfied for that user.

Reproduce: pin two views in Settings → Pinned views; hide any built-in
from its ⋯ in the sidebar; reorder the two pins; the sidebar order does
not change.

Needs Ken: retire pins (the Pinned views panel, `loctt user settings
--sweep-pins`, MCP `sweep_sidebar_pins`, the `sidebar_pins` setting;
SET-13/SET-27/VUE-38 amended), or keep pins with a new meaning (e.g.
"pinned views lead the Views list"). Nothing was removed pending that
ruling.
