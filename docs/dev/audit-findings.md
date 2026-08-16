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
  directions, and the comment describes the opposite of the code. **The
  code was right and the comment was wrong**: `{ ...b, ...a }` is
  local-wins, which is the rule the user decided on 2026-08-16. Comment
  corrected; no behaviour change.
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

### C · Invariant violations — 5 findings — **4 fixed, 1 open**

Each contradicts a rule in `invariants.md` or `decisions.md`.

- ✅ **P-3** twice: `list --project <name>` and `duplicate --project
  <name>` — fixed in `dac7060`.
- ✅ **Q18/D4**: the coalescing window — fixed in `71cdd78`.
- ✅ **M2**: `mergeTask` now merges per field — fixed in `62f6438`.
- ⬜ **D20**: priority `value` is still never recomputed as 1..N.
  Verified open: no recomputation exists in core, cli, mcp or web, and
  the schema still permits duplicate, zero, negative and fractional
  values. **Latent, not live** — the drag-reorder UI that would produce
  a bad `value` is M4.2 and unbuilt, so the fix belongs with that
  ticket.

Overlaps A and B — listed separately because an invariant break is a
decision to revisit, not only a bug to fix.

### D · Bad errors — 8 findings

The operation fails correctly; the message does not help.

- `duplicate --project Backend` leaks `no key allocation state for
  entity type "Backend"`, and a nonexistent project gives the identical
  message.
- The tokenizer's catch-all names only the offending character, so
  `status in [a, b]` says `unexpected character "["` with no hint that
  lists use parentheses.
- `readTask` surfaces a raw `ENOENT` for a missing task.
- `UsageError` in an unwrapped command exits 1 where its wrapped
  siblings exit 2, for identical error text.
- `user current` prints its failure to stdout while exiting 1.

### E · Missing validation — 6 findings

Input that should be rejected is accepted.

- Unknown flags ignored on every task command, `delete` included.
- `PATCH /api/tasks/:ref` has `value: unknown` and no Zod validator.
- `HistoryEntry` has no schema; `_history.yaml` is cast, never validated.
- Duplicate `custom_fields[].values[].key` passes both layers.
- `CalendarConfig.working_days` accepts empty arrays and duplicates.
- `ProjectsConfig.default` may point at an archived project.

### F · Tests that cannot fail — 6 findings — **4 fixed, 2 open**

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
- ⬜ `list.test.ts:131` fixtures lack a `fields` object, so the
  prototype-chain hazard it covers is never reached. Verified still
  open.
- ⬜ `lexorank.test.ts:57` bounds growth at `< 120` where actual is
  ~101 — a bound loose enough to pass under real regressions.

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
