# Runthrough tests

One YAML file per behaviour, run through the built `loctt` CLI and then
through its MCP server over stdio, each against a fresh copy of a
checked-in **seed tracker**. The checks read the tracker's files
directly, `loctt doctor` runs after every step, and an error case must
leave every file untouched. Designed by Ken in K144; built as B42.

```bash
npm run test:runthrough                          # builds, then runs every case
npx vitest run --config tests/vitest.runthrough.config.ts   # same, without the build
npm run test:runthrough -- -t create-plain       # one case (both surfaces)
npm run test:runthrough -- -t "#b39"             # every case tagged b39
npm run test:runthrough -- -t "\[cli\]"          # one surface
RT_KNOWN_BUGS=show npm run test:runthrough -- -t "known bug"   # see why known bugs fail
```

A full run is a few minutes (about 105 cases, most on both surfaces; the git journeys take longest). It is part of
every gate run: see `docs/dev/process/build-loop.md`.

## CLI first, then MCP

For every case the CLI run goes first, and the scripted MCP run starts
only once it has finished; the two never interleave. Different cases run
in parallel.

The CLI is the simplest, deterministic path over the same core, so it
runs first to separate core bugs from MCP ones. If the CLI run fails, the
MCP run still happens, and a failing MCP result then opens with
`AFTER CLI FAILURE — the CLI run of <id> failed first; read that one
before this.`, so one core bug reads as one bug rather than two
unrelated failures. (Ken, B42.)

## Layout

```
tests/runthrough/
  README.md               this file
  runthrough.test.ts      the runner: one test per case per surface
  global-setup.ts         the seed-version guard, and the temp sweep
  cases/<area>/<id>.yaml  the cases, one per file; file name = id
  lib/                    schema, loader, checks, surfaces, snapshot
  seed/build-seed.ts      npm run seed:build
  seed/upgrade-seed.ts    npm run seed:upgrade
tests/fixtures/trackers/seed/
  .loctt/                 the seed tracker (checked in)
  seed-index.json         slug → id / key / name, written by the generator
tests/fixtures/trackers/seed-0.1.0/
  .loctt/                 the same seed frozen at format 0.1.0 (B41), never
                          upgraded: the upgrade tests start from it
tests/vitest.runthrough.config.ts
```

Each test copies the seed into `tests/workspace/rt-<id>-<surface>-*`
(gitignored). A passing test deletes its copy; a failing one keeps it and
prints the path, so you can run `loctt` against it (`--root <path>`).
Copies older than an hour are swept at the next run.

## The seed

`tests/fixtures/trackers/seed/` is a tracker built by the real CLI (and
`loctt mcp` for three typed custom fields; see below): 3 projects (Web
App `WEB`, Mobile `MOB`, Platform Ops `OPS`), 40 tasks across every
status, priority and type, parent/child trees three levels deep, a
four-task `blocks` chain, `relates_to` (including across projects),
`duplicates` and `causes` links, 7 labels (one archived), 2 milestones,
2 sprints (one completed, one active), 3 users (Cy archived, with tasks
still assigned), 4 comments with mentions, one attachment, one custom
field of each type (string, number, boolean, date, enum, multi-enum),
3 saved views, dates, estimates, 2 archived tasks, one task moved between
projects (so a key sits in `key_history`), and one rerank.

`seed-index.json` names every seeded entity by slug. **Cases never
hard-code an id**: ids and timestamps are regenerated whenever the seed
is, because core has no clock or id override. Keys are deterministic
(creation order), but cases still go through the index.

- **`npm run seed:build`** regenerates the seed from
  `seed/build-seed.ts`. Change the seed only when its content must
  change, then re-run the whole suite: counts in cases depend on it.
  The generator fails unless the result is `doctor`-clean.
- **`npm run seed:upgrade`** brings the seed to the code's format
  version through the tracker's own upgrade path (`loctt migrate`),
  keeping its history, ids and timestamps. B41 produced the 0.3.0 seed
  this way from the 0.1.0 one (every link ranked in its shown order). It
  replaces the
  seed only when the upgraded copy is `doctor`-clean.
- **The runner refuses to start** when the seed's `.schema-version`
  differs from what this build writes (read from a tracker it initialises
  on the spot), and points at `npm run seed:upgrade`.

What a checkout cannot carry is stripped from the seed and restored per
test: `.loctt/.gitignore` ignores `.current-user`, so the runner writes
it from `seed-index.json`; the repo ignores `.loctt/local/`, so the key
index is absent on a fresh copy (doctor's "no index on disk" warning is
part of the pristine baseline, below). Per-user `settings.yaml` files are
left out for the same reason.

## A case file

```yaml
id: create-with-parent             # = the file name; lowercase slug
name: Create a task under a parent given by key
description: >
  What the case proves, and why.
tags: [create, b39]                # free-form; filter with -t "#b39"
surfaces: [cli, mcp]               # optional; default both
pre:                               # checks on the fresh copy
  - task_absent: WEB-26
cli: create "Refund flow" --parent ${task.checkout_payment.key}
mcp:
  call: { tool: create_task, args: { title: Refund flow, parent: "${task.checkout_payment.key}" } }
capture:
  t: { new_task: { title: Refund flow } }
post:
  - relationship: { task: "${var.t.id}", type: parent, target: "${task.checkout_payment.key}" }
```

- **`cli`** is one command line or a list. Each runs as
  `node apps/cli/dist/index.js <line>` with the temp tracker as its
  working directory. Quoting is shell-like (`'…'`, `"…"`, `\`), with no
  globbing or shell variables. Every command must exit 0, except the last
  one of an `expect_error` step.
- **`mcp.call`** is `{ tool, args }` or a list of them, sent over one
  stdio session per case (the session spans all steps of a scenario).
  Every call must succeed, except the last one of an `expect_error` step.
- **`expect_error`** replaces a successful action: `cli: { exit_code,
  message }` (exit code defaults to 1; `message` is a substring of
  stdout+stderr) and `mcp: { message }` (a substring of the error
  result). An error step automatically asserts **the tracker is
  unchanged**; add `post` checks only for anything else. Doctor does not
  run after an error step that changed nothing: the tracker is the one
  the previous step (or the seed) left, already judged. (A refused
  command on the 0.1.0 seed leaves it at 0.1.0, whose pending upgrade is
  not in the current seed's baseline, K154.) `cli: {
  partial: true }` is the exception: a bulk command that changed some
  tasks and exited non-zero for the rest (K153). Such a step must carry a
  `changed_only: { tasks: [refs], files: [paths] }` post check: nothing
  outside those tasks' folders and those files (relative to `.loctt/`)
  may change. `changed_only` works in any `post`.
- **`steps`** makes a scenario: a list of `{ name, cli, mcp, capture,
  post, expect_error }`, run in order on one tracker. A top-level `post`
  runs after the last step. A failing step stops the scenario.
- **`seed: empty`** starts from a tracker `loctt init` just made
  (prefix `T`, no tasks), and **`seed: none`** from an empty directory —
  for the user journeys (`cases/journeys/`, the old `tests/e2e`, B43),
  which name their own keys. **`git: local`** makes the temp root a git
  repository first; **`git: remote`** also gives it a bare `origin`
  (`${var.remote}`). Both only with `empty` / `none`.
- **`via: cli | mcp`** on a step runs it on that surface whatever run
  this is, so one scenario can write through one surface and read
  through the other (the interop journey); `via: mcp` opens the MCP
  session on the CLI run too.
- **`script: <file.ts>`** on a step is an action no loctt command can
  perform (a push from another clone): the module's default export
  `({ root, vars }) => string | void` runs instead of `cli` / `mcp`, and
  its return value is the step's output.
- **`seed: "0.1.0"`** starts the case from the frozen 0.1.0 seed
  (`tests/fixtures/trackers/seed-0.1.0/`) instead of the current one, for
  the upgrade cases. Ids, keys and the index are the same.
- **`setup_files`** (`path: content`) writes files under the temp root
  before `pre` — e.g. a file to attach. **`setup_patch`** (`file`,
  `find`, `replace`, relative to `.loctt/`, `find` must occur exactly
  once) edits the seed copy for states no command can produce, such as a
  one-sided link for the repair cases.
- **`check_script`** names a `.ts` module (relative to the case file)
  whose default export `(tracker, { vars, seed, root }) => void` runs
  after the last step and throws to fail — for anything the checks
  cannot express. `tracker` is `lib/tracker.ts`'s `TrackerView`.

Every file is validated on load against the zod schema in
`lib/schema.ts`; objects are strict, so a misspelt key is an error that
names the file and the path, and the whole run stops.

### References

Any string may carry `${…}`:

| Reference | Value |
|---|---|
| `${task.<slug>.key}` / `.id` / `.title` | a seed task (from `seed-index.json`) |
| `${user.<slug>.id}`, `${label.…}`, `${milestone.…}`, `${sprint.…}`, `${project.…}`, `${view.…}` | seed entities (`.id`, `.name`; projects also `.prefix`) |
| `${comment.<slug>.id}` | a seed comment |
| `${var.<name>}` / `${var.<name>.key}` / `.id` | a value captured by an earlier step |
| `${root}` | the temp tracker's root directory |

An unknown reference fails the check; it never becomes an empty string.

### Captures

`capture: { <name>: <how> }` runs after the action, before `post`:

| How | Captures |
|---|---|
| `new_task: { title? }` | the one task that did not exist before this step → `.key`, `.id` |
| `new_comment: { task }` | the one new comment on `task` → `.id` |
| `entity: { kind, name }` | a label / milestone / sprint / project / user / view by name → `.id` |
| `output: "<regex>"` | the first group of the regex over the action's output |
| `git_rev: <ref>` | the commit a git ref points at in the temp root's repository |

## Checks

Every check reads the tracker files directly with the `yaml` package —
no `@loctt/core` import — so a core bug cannot vouch for itself (K144).
A task reference is its id, its current key, or a key in its
`key_history`.

| Check | Passes when |
|---|---|
| `task_exists: <ref>` / `task_absent: <ref>` | a task matches / none does |
| `field: { task, field, equals \| contains \| absent: true \| matches }` | a frontmatter field (`status`, `fields.<key>` for a custom field, `body` for the body) compares. `contains` works on lists and strings; `matches` is a regex |
| `relationship: { task, type, target, present? }` | the edge is stored **with the target's id**. An edge stored by key fails with a message saying so |
| `relationship_order: { task, type, targets }` | the task's edges of `type`, in display order (by `rank`, unranked after ranked, then stored order), are exactly `targets` |
| `bilateral: <ref>` | every edge on the task has its inverse on the target, and every edge pointing at it has its inverse on it |
| `count: { where, archived?, equals }` | that many tasks match every `where` entry (`field: value`, list fields match on membership; `{in: […]}`, `{absent: true}`, `{present: true}`). `archived`: `exclude` (default), `include`, `only` |
| `comment: { task, id?, contains?, author?, mentions?, edited?, present? }` | a comment matching all given fields exists (or, with `present: false`, none does) |
| `comment_count: { task, equals }` | the task has that many comments |
| `attachment: { task, name, present?, content? }` | the file is in the task's `attachments/` (with that content) |
| `entity: { kind, name, present?, fields? }` | one project / label / milestone / sprint / user / view has that name, and each listed field equals (`null` = absent) |
| `yaml: { file, path, equals \| contains \| absent \| matches }` | a value in any YAML file under `.loctt/`. `path` is dotted; `[k=v]` picks a list element, `[n]` an index |
| `file_unchanged: <path>` | the file (relative to `.loctt/`) is byte-identical to before the step; a diff otherwise |
| `tracker_unchanged: true` | every file under `.loctt/` except `local/` is byte-identical to before the step; a diff otherwise |
| `path: { path, exists }` | a file or directory under the temp root (not `.loctt/`) exists, or not |
| `git: { ref, repo?, exists?, not_equals? }` | a ref resolves in the root's repository (`repo: local`, default) or its bare remote (`repo: remote`); `exists: false` for absent; `not_equals` = its commit differs from a captured one |
| `git_show: { spec, contains }` | `git show <spec>` in the root's repository contains the text |
| `output: { surface?, contains?, not_contains?, in_order?, keys?, line_count? }` | on the action's output. `keys` is the set of task keys a list result names (CLI rows or MCP JSON). `line_count: { matches, equals }` counts output lines matching a regex. `surface` limits the check to `cli` or `mcp`, whose outputs differ |

Two checks run **after every step without being asked for**:

- **Bilateral on touched links:** every task whose stored relationships
  changed in the step must pass `bilateral`.
- **Doctor:** `loctt doctor` runs against the temp tracker, and any
  warning or error that was not in doctor's output on the pristine seed
  fails the step.

`local/` (the key index and op journal) is excluded from "unchanged":
it is a per-checkout cache that a read is allowed to rebuild.

## Known bugs

A case the product cannot pass yet stays in the suite, marked so the
suite is green and turns red when the bug is fixed:

- **`known_bug: { cli?: "<reason>", mcp?: "<reason>" }`** — the case is
  expected to fail on that surface (`it.fails`). Once it passes, the test
  fails, telling you to remove the entry. `RT_KNOWN_BUGS=show` runs these
  as ordinary tests so you can see that they fail for the stated reason.
- **`known_doctor_findings: [{ match: "<regex>", bug: "<reason>" }]`** — a
  doctor finding a known bug produces does not fail the step, so the rest
  of the case still counts. A pattern that matches nothing in the whole
  case fails it ("no longer appears — remove the entry"), so the list
  cannot rot.

Report the bug (`docs/dev/known-gaps.md`) when you add either.

## Adding a case

1. Pick the area folder under `cases/` and a slug; the file name is the
   id.
2. Find the tasks you need in `seed-index.json` and reference them by
   slug. Prefer tasks no other case in the same area depends on.
3. Write `pre` checks for the state you rely on — they guard against a
   seed change silently invalidating the case.
4. Write the CLI line(s) and the MCP call(s) for the same behaviour, and
   `post` checks that name the stored result (ids, not names).
5. Run it: `npm run test:runthrough -- -t <id>`.
6. **Show it fails:** break the expectation (or the behaviour) and watch
   the case go red with a message that names the check, then restore.
