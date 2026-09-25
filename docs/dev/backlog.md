# Backlog

Work Ken has decided to do. Each item came from `known-gaps.md` (an open
defect) or a ruling, and carries the decision it rests on. When an item
ships, delete it here; its record lives in `decisions.md` and git.

Status: **todo** · **deciding** (a PM/UI call is pending, not Ken's) ·
**in progress** · **needs Ken** (blocked on a question to Ken).

---

## B25 · Last fixes before merge — **in progress**

Found by the branch review and the B20 close-out; each must land before
`ui/polish-wave-3` merges (Ken: *"once all done, and all reviewed by
another agent (and fix the issues), then you may push, merge"*).

- TSK-22 and A11Y-50 e2e specs still expect "cannot be undone"; the
  delete dialogs say "Deleting … is irreversible. Continue?" (K129).
- A11Y-55: the Customize-sidebar switches measure ~14px tall, under the
  24px target (introduced with the K125 switches).
- `shell/InterruptedMigration.tsx` still has the sentence K129 dropped
  ("Nothing here can be opened or changed until this is resolved.").
- About 60 user-visible strings still contain em dashes
  (messaging.md bans them), most older than this branch.
