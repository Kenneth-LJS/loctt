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

(G11, a 0.3.0 backup refused by 0.4.0, was fixed by B55: restoring an
older backup upgrades it, K161.)

(G12, an unparseable `settings.yaml` making every settings read throw,
was fixed by B56: it loads as no settings and a settings write refuses to
overwrite it, A375.)
