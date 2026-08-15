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
