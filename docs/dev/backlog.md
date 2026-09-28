# Backlog

Work Ken has decided to do. Each item came from `known-gaps.md` (an open
defect) or a ruling, and carries the decision it rests on. When an item
ships, delete it here; its record lives in `decisions.md` and git.

Status: **todo** · **deciding** (a PM/UI call is pending, not Ken's) ·
**in progress** · **needs Ken** (blocked on a question to Ken).

---

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

## B42 · Runthrough tests over a seed tracker (K144) — **in progress**

- A checked-in seed tracker (`tests/fixtures/trackers/seed/`) with
  realistic data across every entity, pinned to the current format;
  `npm run seed:upgrade`.
- One YAML file per test (`tests/runthrough/cases/<slug>.yaml`): id, name,
  description, pre, CLI command(s), MCP call,
  post (or expected error + "nothing changed"); plus scenario tests.
- A runner (`npm run test:runthrough`): fresh seed copy per test, CLI and
  scripted MCP, pre/post checks that read files directly, doctor after
  every test, failure names the step and the diff. Part of every gate.
- Initial coverage: create (incl. with parent), edit fields, link/unlink,
  rerank, bulk set/archive/delete, move project, archive/unarchive,
  comments, attachments, views, search/list queries, sprints, milestones,
  labels, users, settings, doctor repairs, and error cases.

## B43 · Consolidate test suites (K145) — **todo** (after B42)

- Rewrite each `tests/e2e` journey as a runthrough scenario (same steps,
  same assertions, plus the automatic checks); move the MCP tool-list
  snapshot and em-dash guard to `tests/integration`; delete `tests/e2e`,
  its vitest config and the `test:e2e` script; update CONTRIBUTING,
  build-loop.md and any gate lists.
- A shared integration helper runs `loctt doctor` after each writing test
  and fails on any finding the starting tracker did not have; red-prove it.
- Document the split: integration = surface mechanics, runthrough = data
  behaviour.

