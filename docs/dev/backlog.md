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

## B46 · Git sync: refuse `1`, order incoming links (K151) — **todo** (fix round)

- Remove A361's git-sync exception for an integer `1` schema version on
  the remote branch; refuse it like any non-semver version.
- Sync ranks unranked incoming links with the upgrade's ranking step;
  close G8 in known-gaps.md; tests red-proven.

## B45 · Add/remove for multi-value fields; open choice fields (K150) — **todo** (after B41)

- Core list add/remove under the lock for labels and every `multi` custom
  field; CLI `--add`/`--remove` on `loctt set`; MCP `update_task`
  `add`/`remove`; web unchanged (pickers already edit the list).
- `allow_new_values` on enum custom fields (default false): workflow
  schema, Settings → Custom fields toggle, CLI/MCP config tools, docs.
- Creating a value on the fly: web picker "Create 'x'" row for labels and
  open fields; CLI `--create`; MCP `create_missing: true`; refused
  otherwise. New values are appended to the field's `values` (key from
  the label, collision-safe); labels created as today.
- Cases, runthrough cases, CLI/MCP reference docs.

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

