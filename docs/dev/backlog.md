# Backlog

Work Ken has decided to do. Each item came from `known-gaps.md` (an open
defect) or a ruling, and carries the decision it rests on. When an item
ships, delete it here; its record lives in `decisions.md` and git.

Status: **todo** · **deciding** (a PM/UI call is pending, not Ken's) ·
**in progress** · **needs Ken** (blocked on a question to Ken).

---

## B39 · `create --parent` and a comprehensive relationship repair (K140, K141) — **in progress**

- `createTask` resolves the parent (CLI and MCP accept a key or an ID;
  every surface stores the ID), refuses a missing or archived parent with
  `link`'s message before writing anything, and writes both sides through
  the same code as `linkTask`.
- `repairRelationships`: key-valued targets rewritten to the ID; every
  one-sided link completed unless that would create a loop (reported);
  unresolvable or ambiguous targets reported, never deleted; identical
  duplicates merged; idempotent.
- `loctt doctor --repair-relationships`, the MCP doctor option, a
  Diagnostics button; `loctt doctor --fix` runs every safe repair then
  reports what is left.
- `loctt show` and MCP `get_task` list relationships in rank order; MCP
  returns the order.
- The two tests that encoded the bug are rewritten.

## B41 · Semver format versions, ordered links everywhere, automatic upgrades (K142, K143) — **todo** (after B39)

- `.loctt/.schema-version` holds a semver (`0.1.0`); the code's format
  constant is the release that introduced the format; newer is refused
  naming the release to install; non-semver (incl. `1`) is refused.
- Every link of every kind carries a rank; every write assigns one; the
  `ranked` setting is removed from workflow.yaml and the config schema.
- Upgrade step 0.1.0 → 0.3.0 ranks existing links in their displayed
  order; non-risky steps run automatically with a backup and one line.
- Full versioning tests across core, CLI, MCP, web and the installed
  package.

## B40 · Reorder links on the task page (K140, K141, K143) — **todo** (after B41)

Every relationship group, including the Children tree's direct children,
gets the same 24px drag/keyboard handle; grandchildren sort by rank;
ancestor pages refresh after a reorder.
