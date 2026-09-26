# Backlog

Work Ken has decided to do. Each item came from `known-gaps.md` (an open
defect) or a ruling, and carries the decision it rests on. When an item
ships, delete it here; its record lives in `decisions.md` and git.

Status: **todo** · **deciding** (a PM/UI call is pending, not Ken's) ·
**in progress** · **needs Ken** (blocked on a question to Ken).

---

## B32 · Zero lint warnings (K135) — **todo**

Fix all 65 warnings (hook dependencies, non-null assertions) without
changing behaviour.

## B36 · How core reaches the three packages (K89 vs a published core) — **needs Ken**

Today (K89): core bundled into each of `@loctt/cli`, `@loctt/mcp`,
`@loctt/web`. Ken asked whether core could be its own versioned package
the three depend on, with an exact version pin. Waiting on his call:
keep bundled, or publish `@loctt/core` with exact pins (supersedes K89).

## B37 · CODE_OF_CONDUCT enforcement contact — **needs Ken**

`CODE_OF_CONDUCT.md` has a placeholder for the contact people use to
report conduct problems.

