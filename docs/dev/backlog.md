# Backlog

Work Ken has decided to do. Each item came from `known-gaps.md` (an open
defect) or a ruling, and carries the decision it rests on. When an item
ships, delete it here; its record lives in `decisions.md` and git.

Status: **todo** · **deciding** (a PM/UI call is pending, not Ken's) ·
**in progress** · **needs Ken** (blocked on a question to Ken).

---

## B44 · Fix the runthrough's bugs and the name/ID rule (K147, K148) — **in progress**

Ken: *"fix all, unless a design decision is needed"*.
- G1 unlink a link stored as an ambiguous key; G2 `loctt set` typed custom
  fields; G3 `loctt set` labels; G5/G6 the key index after delete and
  create; G7 `show` prints names.
- G4 (K147): delete removes the other side of every link, recorded in the
  partners' history.
- K148: IDs recognised by shape; ID-shaped names refused on create and
  rename; names or IDs accepted by CLI, MCP and queries; CLI prints names,
  MCP returns both; ambiguous and unmatched names refused with a message.
- Each fixed gap leaves known-gaps.md; its runthrough case drops
  `known_bug` and passes.

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

## B43 · Consolidate test suites (K145) — **todo**

- Rewrite each `tests/e2e` journey as a runthrough scenario (same steps,
  same assertions, plus the automatic checks); move the MCP tool-list
  snapshot and em-dash guard to `tests/integration`; delete `tests/e2e`,
  its vitest config and the `test:e2e` script; update CONTRIBUTING,
  build-loop.md and any gate lists.
- A shared integration helper runs `loctt doctor` after each writing test
  and fails on any finding the starting tracker did not have; red-prove it.
- Document the split: integration = surface mechanics, runthrough = data
  behaviour.

