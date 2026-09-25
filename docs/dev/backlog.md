# Backlog

Work Ken has decided to do. Each item came from `known-gaps.md` (an open
defect) or a ruling, and carries the decision it rests on. When an item
ships, delete it here; its record lives in `decisions.md` and git.

Status: **todo** · **deciding** (a PM/UI call is pending, not Ken's) ·
**in progress** · **needs Ken** (blocked on a question to Ken).

---

## B20 · Apply the message audit — **in progress** (main pass committed)

The approved wordings (K123, K126, K127, K129, K130) are applied across
the web client, Settings and the shared core (A343). Left to do:

- **C110, 5 sites:** user-profile (`users/profile.ts` ×3) and task
  frontmatter (`task/frontmatter.ts` ×2) schema failures must name the
  file, like every other config file ("{file} is not valid: {field}
  {problem}."). Needs the file path available where the error is built.
- **Two approved cuts not yet applied:** the init wizard's "skip starter
  docs" explainer (B-69; amend ONB-4) and the shortcut dialog's footnote
  (A-110; amend A11Y-43). Ken approved both cuts ("rest of the 'needs
  your call' looks okay").
- **One approved cut reverted:** the unreadable-files banner's "A
  hand-edit is the usual cause." (A-7) was put back for ERR-9/XS-51; Ken
  approved cutting it. Cut it and amend the cases.
- **Dead code:** the unreachable `updated_at must be a string` branches
  in `task/update.ts` (see known-gaps) are deleted.
- Tests loosened to case-insensitive patterns during the pass are
  tightened back to the exact new strings.
