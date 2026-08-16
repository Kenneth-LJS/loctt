# Audit findings

Phase 4 of [`autonomous-plan.md`](autonomous-plan.md). Eight agents, one slice each, ~18,700 lines read in full rather than
skimmed: `packages/core` in wave 1, then `contracts`, `cli` and `mcp`.

**This run was report-only.** No fix was applied — not even the
provable-only ones the plan permits — because Phase 3 has not run and the
plan orders the test net first. Everything below awaits triage.

**124 findings** across two waves. The counts below are the agents'; the *verified* section
is mine — I re-derived those independently before recording them, since an
agent's finding is a claim, not a fact.

| Slice | Scope | Findings |
|---|---|---|
| 1a | `core/task` writes — update, create, bulk, move, duplicate, io | 12 |
| 1b | `core/task` reads — comments, relationships, traversal, history | 14 |
| 2 | `core/git` — merge, three-way, publish-sync, reconcile | 19 |
| 3 | `core/config` + `core/schema` | 12 |
| 4 | `core/query` + `core/rank` | 24 |
| 7 | `packages/contracts` | 15 |
| 8 | `apps/cli` | 16 |
| 9 | `apps/mcp` | 12 |

---

## Verified independently

I reproduced these four myself rather than taking the report. Each is
stated with the evidence, so the next reader need not re-derive it.

### `evenlySpacedRanks` emits duplicate ranks from count 649

`packages/core/src/rank/lexorank.ts:209`. Executed:

```
count=  500  emitted=500  unique=500  ok
count=  649  emitted=649  unique=631  DUPLICATES: 18
count=  700  emitted=700  unique=680  DUPLICATES: 20
count= 1296  emitted=1296  unique=1260  DUPLICATES: 36
```

`reorderBoardRank` calls this with every ranked task in the tracker, so a
rebalance writes duplicate `board_rank` to disk; a later before/after drag
resolves its anchor by `indexOf` and positions against the wrong task.

**The existing test stops at 500.** It is green and cannot fail here.

### The body-edit coalescing window rolls instead of being fixed

`packages/core/src/task/history.ts:199` sets `timestamp: next.timestamp`,
and `withinCoalesceWindow` then measures the following gap from that rolled
value. The window restarts on every coalesce, with no upper bound.

Executed — five saves 14 minutes apart, spanning 56 minutes:

```
resulting entries: 1
  2026-08-15T09:56:00.000Z  before=v0 after=v5
```

Invariant Q18/D4 specifies a 15-minute window. States v1–v4 are
unrecoverable, and the entry is stamped 09:56 while claiming the 09:00
`before`.

**None of the five coalescing tests can catch this**: each measures a
single gap against the already-rolled timestamp. The burst test spans
14.5 minutes, inside the window under either reading.

### `assignProvisionalPrefixes` sorts on a field that does not exist

`packages/core/src/git/merge.ts:283` sorts on `created_at`.
`ProjectDefSchema` (`packages/contracts/src/projects.ts:20`) is `.strict()`
with `id`/`name`/`prefix`/`archived`; `created_at` appears **zero** times in
that file. So `(a.created_at ?? "")` is always `""` and the sort collapses
to the ULID tiebreak.

Executed — a project created in 2000 versus one created in 2099:

```
aaa (created 2000) : T-
bbb (created 2099) : T2-
```

The result follows the id alphabetically, not the date. Swap the ids and
the 2099 project wins. The documented "earlier project keeps the prefix"
rule never fires.

In practice ULIDs are time-ordered, so the outcome usually coincides with
the intent — which is why nothing surfaced it.

**All four tests at `merge.test.ts:257` pass an explicit `created_at`**,
constructing a shape that cannot occur. They are green because their
fixture ids sort the same way as their dates. That is a coincidence, not
an assertion.

### `list --project <name>` reports "No tasks found." and exits 0

The most damaging finding in the audit, because it **fails successfully**.
Reproduced against a temp tracker holding two tasks in project `Web`:

```
list                        → T2 task two / T1 task one
list --project Web          → No tasks found.        exit 0
list --project <ULID>       → T2 task two / T1 task one
list --project TotallyMadeUp → No tasks found.       exit 0
```

The raw string goes to the query layer, which matches on ULID per P-2, so
a name can never match. A real project with tasks and a project that does
not exist are **byte-identical** in output and exit code.

`duplicate` at least errors. This one hands back a confident empty answer,
so a script filtering by project name silently processes nothing, and a
user concludes the project is empty.

Second violation of P-3 in the same binary. `move` resolves names
correctly, so the CLI is inconsistent with itself in three places.

### `duplicate --project <name>` violates P-3; `move` in the same binary does not

Invariant P-3: "CLI and MCP accept a project **name** (erroring on
ambiguity) or a ULID." Reproduced against a temp tracker with projects
`Web` and `Backend`:

```
move T1 Backend                  → Moved T1 → B1                    exit 0
duplicate T2 --project Backend   → Error: no key allocation state
                                     for entity type "Backend"      exit 1
duplicate T2 --project <ULID>    → Created B2: second (copy)        exit 0
```

Two problems, not one:

- **The name is rejected**, so `duplicate` takes a ULID where every
  sibling command takes a name. P-4 says a ULID is never shown to a
  user — this command requires the user to supply one.
- **The error leaks key-allocation internals** instead of naming the
  problem. A user who typed a project that does not exist gets a
  byte-identical message, so "wrong format" and "no such project" are
  indistinguishable.

`core/task/duplicate.ts:87` writes `overrides.project` straight into the
slot that expects an id. `move.ts` takes an id too, but its CLI handler
resolves the name first; `duplicate`'s does not. So the fix is at the
surface, and the same gap exists on MCP's `duplicate_task`.

**Correction to an earlier reading in this session.** I first reported
that `move --project Web` failed too. It does — but `move` takes the
project as a *positional* argument (`loctt move <task> <project>`), so
that invocation was mine being wrong, not the CLI. `move` is correct.
I also briefly read both as exiting 0 while printing an error; that was
`head` in the pipeline capturing the exit code rather than the CLI. Exit
codes are right: 1 on failure, 0 on success.

### Unknown flags are silently ignored on every task command

Found in Phase 2, verified by running the built CLI:

```
list --bogus            → exit 0, lists normally
show T1 --bogus         → exit 0, shows normally
archive T1 --bogus      → exit 0, archives
delete T1 --bogus --yes → exit 0, DELETES
```

`init` rejects unknown options ("Error: unknown option --project.
Accepted: …"), so the CLI is inconsistent with itself. A typo'd flag on an
irreversible command is accepted and the command proceeds.

This is why `tests/e2e/03-cli-full-lifecycle.test.ts:55` passes `--hard` —
a flag `cli/reference.md:621` explicitly says does not exist — and stays
green.

---

## Reported but NOT independently confirmed

### `estimate`'s Zod transform is bypassed on the write path

`packages/contracts/src/task.ts:66` declares
`z.union([z.string(), z.number()]).transform(v => String(v))`, and the
slice-7 agent reports that `writeTask` parses purely as an assertion and
discards the result — so a numeric `estimate` reaches disk unnormalised
while `TaskFrontmatter["estimate"]` is typed `string`. It reports
reproducing this end-to-end through `PATCH /api/tasks/:ref`, whose
`value: unknown` has no Zod validator.

**I could not reproduce it.** Four attempts through `setField` failed in
my own harness (`getSchemaVersionPath` threw before any write), and the
CLI path takes a string, so it cannot exhibit the defect. The schema text
is confirmed by reading; the bypass is not.

Treat it as plausible and unverified. It is listed here rather than above
because the distinction matters: everything in the previous section I
re-derived myself.

## A pattern worth naming

Four findings above share one shape: **a green test whose bound, fixture,
or measurement sits just short of the failure.**

- the rank test stops at 500; duplicates start at 649
- the coalescing tests measure one gap; the bug needs a chain
- the prefix tests supply a field the schema forbids
- the `--hard` test passes an argument the parser ignores

`CLAUDE.md` records fourteen prior tests that encoded a bug as intended
behaviour. These are not those — they assert *something* true. They simply
cannot fail for the case that matters, which is harder to see and just as
load-bearing when someone refactors underneath them.

Per `CLAUDE.md`: a fix that requires editing a green test means that test
was asserting the bug, and the commit must say so.

---


## Fixed so far

Group A and E items, each with a test shown to fail first and killed by
mutation of the specific behaviour.

| Finding | Commit | Note |
|---|---|---|
| Coalescing window rolled unbounded | `71cdd78` | Decided rolling **capped at 60 min**; `invariants.md` Q18/D4 now states it |
| `evenlySpacedRanks` duplicate ranks ≥ 649 | `df54107` | Also widens past two digits instead of throwing; capacity is 1260, not the 1296 claimed |
| `list --project <name>` returned nothing | `dac7060` | P-3 |
| `duplicate --project <name>` leaked an allocator internal | `dac7060` | P-3 |
| Unknown flags ignored on every task command | `d1eb66e` | Removed `--hard` from 3 tests that were asserting the bug |
| Four query forms parsed, validated, then matched nothing | `50ebb21` | Also fixes the `[` message, the repo's most-repeated DSL mistake |
| `assignProvisionalPrefixes` sorted on a phantom field | `378bb4f` | One of its tests was asserting the bug |
| `type: enum` with no values accepted anything | `73af1d6` | Conditional requirement, matching `preset_values` |
| `applyWorkflowEdit` wrote tasks before validating the config | `eda711b` | Found while fixing the enum hole; a refused edit used to leave task rewrites on disk |
| `mergeTask` was whole-record LWW, not per-field | `62f6438` | Resolved from history; hand-edits scoped out by decision, `merge_resolved` records any fallback |
| Coalesced burst uncapped | `40569fa` | D20 priority renumbering landed in the same commit |
| Stale git worktree blocked the next sync | `40569fa` | `prune` before each `worktree add` |
| `applyWorkflowEdit` journaled before validating | `86f96f6` | Second ordering bug behind the first; a refused edit was replayed by the next operation |

**Phase 3 (surface cases) has since fixed more**, tracked in
[`autonomous-plan.md`](autonomous-plan.md)'s Phase 3 log rather than
duplicated here — including the burndown summing every sprint, the web
stranding inverse relationship edges, and milestone/sprint references
stored as names.

**Found while fixing, not yet addressed:** the non-interactive refusal
message is duplicated verbatim in `confirmInteractive` and
`confirmHardDelete` (`apps/cli/src/runtime/confirm.ts:32,61`). Mutating
one leaves the other masking it — which cost real time here, since a
mutation that appeared to survive had simply hit the wrong copy.

## Triage grouping

124 findings. The category tags the agents used (`bug` 57, `abstraction`
18, `duplication` 14, `comment` 13, `dead-code` 7, `layering` 6,
`doc-drift` 4, `naming` 3) sort by *shape*, which is not how you decide
what to fix. Below they are grouped by **what goes wrong for a user**.

### A · Silent wrong answers — 9 findings — **all fixed**

The tracker reports success and the result is wrong. Nothing errors,
nothing logs, no exit code changes. These cost the most to discover
later, because by then the wrong data is upstream of other decisions.

| Finding | Where |
|---|---|
| `list --project <name>` returns "No tasks found." with tasks present | cli |
| `evenlySpacedRanks` emits duplicate ranks ≥ 649 → drags anchor to the wrong card | rank |
| Coalescing window rolls, collapsing an unbounded edit chain into one entry | task/history |
| `assignProvisionalPrefixes` sorts on a field the schema forbids | git/merge |
| `mergeTask` is whole-record LWW, not the per-field merge M2 promises | git/merge |
| `rekeyCollisions`' `skipped` list is discarded by its only caller | git |
| Query: `NaN` literals, `link_count(…) in (…)`, empty `in ()`, `text =` all match nothing | query |
| A `type: enum` custom field with no `values` accepts anything | config |
| Priority `value` never recomputed 1..N (D20) — `order by priority` wrong | config |

**Fix these first.** Six are one-line-ish; the merge ones are not.

### B · Data at risk — 4 findings — **all closed**

Recoverable, but the recovery was manual and undocumented.

- ✅ A crashed publish/sync leaves a registered git worktree with no
  recovery path. **Already fixed during Phase 3** — `worktree prune`
  runs before each `add` on both the publish and sync paths.
- ✅ `projects.yaml` resolves its list and its scalars in opposite
  directions. **I closed this wrongly the first time** as "comment-only,
  no behaviour change" — I checked `resolveConflicts` (local-wins for
  scalars) and not `mergeById`, which set local then overwrote with
  incoming, making the *list* incoming-wins. One file, two opposite
  policies: a sync could repoint your default project and rewrite the
  project it now points at, each by a different rule. `mergeById` is now
  local-wins, matching the scalars and the 2026-08-16 ruling. A green
  test asserted the old direction and was rewritten.
- ✅ `mergeHistory` / `mergeComments` cast unvalidated YAML straight to
  their types. All six `as HistoryEntry[]` / `as MergeableComment[]`
  casts replaced with a checked parse that routes a non-list to
  `unresolved`. An empty file still reads as an empty list — that is a
  legitimate state, not corruption.
- ✅ The fatal `.schema-migration-in-progress` sentinel is bypassed on
  the only path that can reach it. Confirmed live: every ordinary
  command refused, but `loctt migrate` printed "already at v1, nothing
  to do" and exited 0 on a tracker holding the sentinel. The check now
  runs in **both** `planMigration` and `migrateToCurrent` — the CLI
  calls the former first and returned early on an empty plan, so
  guarding only the latter would have changed nothing.

### C · Invariant violations — 5 findings — **all closed**

Each contradicts a rule in `invariants.md` or `decisions.md`.

- ✅ **P-3** twice: `list --project <name>` and `duplicate --project
  <name>` — fixed in `dac7060`.
- ✅ **Q18/D4**: the coalescing window — fixed in `71cdd78`.
- ✅ **M2**: `mergeTask` now merges per field — fixed in `62f6438`.
- ✅ **D20**: priority `value` recomputed as 1..N. Implemented during
  Phase 3 as `renumberPriorities` in `workflow-write.ts`, called on
  every workflow edit; this entry was stale.

Overlaps A and B — listed separately because an invariant break is a
decision to revisit, not only a bug to fix.

### D · Bad errors — 8 findings — **all closed**

The operation fails correctly; the message does not help.

- ✅ `duplicate --project Backend` leaks `no key allocation state for
  entity type "Backend"`. **Fixed in Phase 3** — now `unknown project`.
- ✅ The tokenizer's catch-all names only the offending character.
  **Fixed in Phase 3** — `[` now names the parenthesised form.
- ✅ `readTask` surfaces a raw `ENOENT`. **Fixed in Phase 3** — now
  `task not found: "Q999"`.
- ✅ `UsageError` in an unwrapped command exits 1 where its wrapped
  siblings exit 2. **Worse than reported**: `info`, `views` and `schema`
  did not validate flags at all, so an unknown one was dropped and the
  command exited **0**. The dispatcher's comment claimed they "throw no
  UsageError today", which stopped being true when `doctor` gained
  validation in Phase 3. All four now validate and are wrapped; every
  command exits 2 on an unknown flag.
- ✅ `user current` prints its failure to stdout while exiting 1. Now
  stderr — `loctt user current | cut -f2` was reading the failure text
  as a user name.

### E · Missing validation — 6 findings — **5 closed, 1 reopened**

Input that should be rejected was accepted.

- ✅ Unknown flags ignored on every task command. **Fixed in Phase 3**
  (`rejectUnknownFlags`), and group D extended it to the last four
  commands that still ignored them.
- ⬜ `PATCH /api/tasks/:ref` has `value: unknown` and no Zod validator.
  **I closed this wrongly the first time.** I grepped for `PATCH`, found
  none, and called the finding stale. The route exists as **POST**
  (`handleSetField`, `server.ts:2684`, routed at `:3142`) and passes
  `request.value` to `setField` unvalidated. Reopened — belongs with the
  web work that owns that handler.
- ✅ `HistoryEntry` has no schema; `_history.yaml` is cast, never
  validated. Closed structurally in group B: the merge path now checks
  the parse rather than casting, and `readHistory` already threw on a
  non-array (CMT-C7).
- ✅ Duplicate `custom_fields[].values[].key` passes both layers. Now
  rejected — stored task values are keys, so a duplicate is ambiguous
  in the one way that cannot be resolved after the fact.
- ✅ `CalendarConfig.working_days` accepts empty arrays and duplicates.
  Both now rejected; an empty working week is a tracker where no date
  calculation lands anywhere.
- ✅ `ProjectsConfig.default` may point at an archived project.
  Existence was checked, archived was not — new tasks would land in a
  project hidden from every picker. Archiving a *non-default* project
  is still allowed.

### F · Tests that cannot fail — 6 findings — **all closed**

Green, and blind to the case that matters. Per `CLAUDE.md`, fixing the
behaviour under these means editing a green test, and the commit must say
that test was asserting the bug.

- ✅ `lexorank.test.ts` bounded counts at 500; duplicates start at 649 —
  now covers 648…46,656 (`df54107`).
- ✅ The five coalescing tests each measured one gap; two added that need
  a chain (`71cdd78`).
- ✅ All four `assignProvisionalPrefixes` tests passed a `created_at` the
  schema forbids — one was asserting the bug outright, since its ids
  sorted opposite to its claim (`378bb4f`).
- ✅ **Three** e2e tests passed `--hard`, not the two originally found;
  all removed, and `10-error-paths.test.ts` rewritten because it passed
  for entirely the wrong reason (`d1eb66e`).
- ✅ `list.test.ts:131` fixtures lack a `fields` object, so the
  prototype-chain hazard it covers is never reached. **It also found a
  live defect**: the custom-field branch of `getTaskFieldValue` still
  used a bare `field in fields`, one line below the `hasOwnProperty`
  narrowing that was added for exactly this. Sorting by `toString`
  returned a *function* as the sort value. Guarded, with a mixed fixture
  (one task with `fields`, one without) that tells the two
  implementations apart — an all-`fields` fixture cannot, because every
  task resolves the same function and the comparator calls them equal.
- ✅ `lexorank.test.ts:57` bounds growth at `< 120`. Actual is **21**,
  not ~101 as reported — looser still. Tightened to `<= 25`, verified by
  a midpoint mutation that increases growth without breaking ordering.

### Re-verification, 2026-08-16

After A–F were marked closed, an agent re-read all 124 slice-report
findings against current code. Two things came out of it.

**The slice reports are badly stale** — roughly a third of the
non-cosmetic findings were already fixed during Phase 3 and never
struck through. That is expected and not worth correcting entry by
entry; the group summaries above are the current record.

**Three of my own closures were wrong**, each now corrected in place:
`projects.yaml` (closed as comment-only; `mergeById` was genuinely
incoming-wins), the group-E PATCH validator (closed as stale; the route
exists as POST), and D20 (recorded open; it had been implemented).

Closed since that re-verification:

| Finding | Group | Commit |
|---|---|---|
| `completed_date` stamped in UTC, not the workspace zone | A | `c85efd7` |
| `mergeById` incoming-wins against local-wins scalars | C | `c85efd7` |
| `readHistory` `desc` reverses rather than sorts | A | `ac6cccb` |
| 8 more dispatchers exiting 0 or 1 on an unknown flag | D | `ac6cccb` |
| Rebalance stamping `updated_at` tracker-wide | A | closed by SPR-C2 |
| No-op `edit` on user/label/milestone/sprint reports success | E | this commit |
| `ui --port abc` starts on a random port | E | `863203d` |
| `gitSafe` reads a failed `ls-tree` as "branch is clean" | B | this commit |
| `pruneEmptyDirs` could delete `.loctt/tasks/` itself | B | this commit |
| `applyResolution` wrote without `mkdir`, unlike `applyPlan` | B | this commit |
| `deriveKeyState` could emit `prefix: ""` unvalidated | B | `cf3c81a` |
| Malformed `workflow.yaml` read as absent, disabling validation | D | this commit |
| MCP `duplicate_task` forwarded an unresolved project name (P-3) | C | `3e39393` |
| `&&` / `\|\|` / `!` got a bare "unexpected character" | D | this commit |
| Invalid dates passed the tokenizer's shape regex | E | `0197105` |
| `comment` silently dropped `--`-prefixed words from a body | E | `4d14dd3` |
| Board column naming a nonexistent status | E | this commit |
| Relationship inverse colliding with a declared relationship | E | this commit |
| `key_history` accepted empty-string entries (P-7) | E | `7d68ded` |
| `bulkMove` persisted allocator increments inconsistently | B | this commit |
| `list_config_values` reported unreadable config as `null` | D | this commit |

**Still open, and deliberately so** — each needs a decision or belongs
with unbuilt work rather than a sweep:

- `handleSetField` passes `value` to `setField` unvalidated
  (`server.ts:2684`). Belongs with the M2 task-detail work that owns it.
- Bare catches in the MCP comment tools. `list_config_values` is fixed;
  the comment tools' catches turn a real bug into a routine domain error
  for an agent, which is the same shape on a smaller surface and worth
  doing with the M2 comment work that touches them.
- `HistoryEntry` element shape. Deliberately left: history has no Zod
  schema at all, and adding one is a change to a hot write path that
  belongs with its own design pass, not a sweep. The array-level guard
  (CMT-C7) and the merge-path parse check (group B) cover the shapes
  that actually reached code.

### Swallowed-error audit, 2026-08-17

Prompted by three instances found and fixed by accident during Phase 4
(`loadOptionalConfigs`, `list_config_values`, `branchHasForeignContent`).
Three found that way means the population is larger, so it was audited
exhaustively: **273 catch sites plus 25 `.catch()` handlers** across
core, contracts, cli, mcp and web.

**Six unsafe.** The codebase is otherwise disciplined here — most
catches narrow on `err.code === "ENOENT"` and rethrow.

The shape: a catch turns "I could not read this" into a default value,
so the caller cannot tell "there is nothing here" from "something
failed". In every case below the loader already handled genuine absence
— via `fileExists`, or by returning a documented default — so the catch
could *only* fire on a real failure, and the default it produced was a
factual claim about a file nobody had read.

| # | Where | What goes wrong for a user |
|---|---|---|
| 1 | `task/comments.ts:130` | Returns `[]` on any read failure, and `postComment` writes `[...existing, comment]` straight back. **Reproduced:** three comments, file made unreadable, post reports success, one comment survives. Deletion is hard — no recovery. |
| 2 | `config/archived-guard.ts:51` | Three catches leave the configs undefined; `archivedIds(undefined)` is an empty set, so the check is skipped. A malformed `labels.yaml` lets an archived label attach and report success, on every create/update across all three surfaces. |
| 3 | `git/git-mode.ts:227` | Reports `enabled: false` for a `sync.yaml` it could not parse. The CLI prints `Enabled: false`; an agent may re-enable git mode or skip a publish. |
| 4 | `users/profile.ts:103` | A corrupt profile is skipped. Narrow — only bites if that user is *also* archived, dropping them from `archivedUserIds` so the guard fails open. |
| 5 | `mcp/tools/views.ts:38` | `"No saved views configured."` is a positive claim covering ENOENT, syntax error and EACCES alike. An agent may offer to recreate a catalog it could not read. |
| 6 | `cli/commands/config.ts:69` | Prints `git.enabled = ` (blank), which reads as "not set" — while `config get` on the same file errors loudly. |

**Not a catch, same failure:** `ListView.tsx:244` has no `isError`
branch, so a failed `/api/tasks` renders as "No tasks match these
filters." The error is on the query; the UI never reads it. Same gap in
`Sidebar.tsx`. M2 work, recorded here so it is not rediscovered.

**Structural root cause.** Every config loader (`workflow.ts:45`,
`queries.ts:114`, `calendar.ts:73`, `labels.ts:59`, `milestones.ts:57`,
`sprints.ts:60`, `projects.ts:62`, `state/sync.ts:52`) does a bare
`readFile` + parse, so ENOENT and a parse error reach callers
indistinguishable. Every *safe* catch narrows on `err.code` by hand; all
six unsafe ones skipped that step. **Decision V1 removes the root cause**
— if core owns validation and returns structured errors, the distinction
comes for free rather than being re-derived at each call site.

**Status: fixed but UNCOMMITTED, awaiting review.** Findings 1, 2, 3, 5
and 6 are fixed in the working tree with tests, each verified by
mutation; finding 4 was left as designed (skipping one bad profile beats
failing every command, and doctor reports it). These were written
without being asked for — the authorisation covered the audit, not the
fixes. They are held out of version control until reviewed.

### G · Cosmetic — 13 auto-fixable, ~79 remaining

13 findings are provable-no-behaviour-change (comment corrections, an
unused export, a single-line wrapper, dead code with zero references).
The plan permits an agent to apply exactly these, **after** Phase 3's
test net exists.

The rest are abstraction, duplication and naming: real, low-urgency,
and the right thing to fold into work that touches those files anyway
rather than a sweep of their own.

### Suggested order

1. **A**, highest first — the six cheap ones are a day's work
2. **F**, alongside A — the tests must change with the behaviour
3. **B** and **C** — need decisions, not just fixes
4. **E**, then **D**
5. **G** last, or opportunistically

## Slice reports

Full findings, with file:line, blast radius, size and confidence:

- [`audit-slice-1a.md`](audit/audit-slice-1a.md)
- [`audit-slice-1b.md`](audit/audit-slice-1b.md)
- [`audit-slice-2.md`](audit/audit-slice-2.md)
- [`audit-slice-3.md`](audit/audit-slice-3.md)
- [`audit-slice-4.md`](audit/audit-slice-4.md)

Each report also carries a "checked and found sound" section — things an
agent nearly reported and then disproved. Those are kept deliberately, so
a re-reader does not spend the same time reaching the same non-finding.

## Not yet triaged

Nothing here has been fixed or scheduled. The plan routes escalated
findings through a human, and the auto-fixable subset waits on Phase 3's
test net.
