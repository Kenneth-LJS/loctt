# Audit findings

Phase 4 of [`TEMP-BUILD-PLAN.md`](../../TEMP-BUILD-PLAN.md). Eight agents, one slice each, ~18,700 lines read in full rather than
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
[`TEMP-BUILD-PLAN.md`](../../TEMP-BUILD-PLAN.md)'s Phase 3 log rather than
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
- ~~`HistoryEntry` element shape.~~ **Closed 2026-08-17** (`4fb7e4b`).

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

**Not a catch, same failure — since fixed** (`4bb211b`):
`ListView.tsx` had no `isError` branch, so a failed `/api/tasks`
rendered as "No tasks match these filters." The error was on the query
and the UI never read it. Same gap in `Sidebar.tsx`.

**Structural root cause.** Every config loader (`workflow.ts:45`,
`queries.ts:114`, `calendar.ts:73`, `labels.ts:59`, `milestones.ts:57`,
`sprints.ts:60`, `projects.ts:62`, `state/sync.ts:52`) does a bare
`readFile` + parse, so ENOENT and a parse error reach callers
indistinguishable. Every *safe* catch narrows on `err.code` by hand; all
six unsafe ones skipped that step. **Decision V1 removes the root cause**
— if core owns validation and returns structured errors, the distinction
comes for free rather than being re-derived at each call site.

**Status: ALL SIX CLOSED, 2026-08-17.**

An earlier attempt fixed five in the working tree and was **reverted**:
written without being asked for, and one (`comments.ts`) threw on a
malformed file where P-11 requires keeping the entries. Redone properly
in P-11's shape rather than retrofitted.

**All six were re-probed against the built binary before any code was
written. None was a false positive** — the ~⅓ stale-premise rate seen in
Phase 3 did not repeat here. Two were worse than recorded:

- **Finding 6** said one config key printed blank. In fact **all five**
  did, exit 0 — while `config get` on the same file exits 1 with a
  proper `EACCES`. The binary contradicted itself in adjacent
  subcommands.
- **Finding 2 does not reproduce through the CLI.** `set milestone`
  resolves the entity name first and throws on the unreadable file
  before the guard's catch matters. It reproduces one layer down, in
  `loadArchivedGuardConfigs`. A CLI-level test would have passed while
  asserting nothing — so its tests are at the core layer.

| # | Where | Closed by |
|---|---|---|
| 1 | `task/comments.ts` | `149a07a` — P-11 both halves |
| 2 | `config/archived-guard.ts` | `de107eb` — fails closed (V7) |
| 3 | `git/git-mode.ts` | `689ef97` — `unreadable` on the status result |
| 4 | `users/profile.ts` | `de107eb` — `loadAllUsersDetailed` (V7) |
| 5 | `mcp/tools/views.ts` | `689ef97` — ENOENT only |
| 6 | `cli/commands/config.ts` | `689ef97` — `<unreadable: …>`, exit 1 |

The structural root cause is addressed by `utils/read-state.ts`
(`149a07a`): `readFileState` returns absent / loaded / unreadable, so
the distinction is made once rather than re-derived by hand at each
call site. **V1 should adopt this rather than replace it.**

**Found while fixing, and fixed in the same pass** (`f72461a`):
`loadJournal` returned an empty journal on an unreadable or malformed
file. The journal is the record of writes already in flight, so reading
it as "nothing pending" means recovery never runs and the caller writes
over a half-applied set — the precise failure it exists to prevent, and
directly undermining V6. Two green tests asserted that behaviour and
were rewritten; per `CLAUDE.md` they were asserting the bug.

**Two design faults in the V6 implementation, caught by its own tests**
and worth recording because both were silent:

- Backups were taken by *renaming* the original away, which made the
  destination briefly absent and silently consumed a directory sitting
  there. Now copied, and a non-file destination is refused.
- The refusal ran per file during backup, so a bad destination at the
  end of a set left the earlier ones already backed up. Every
  destination is now checked before any is touched.

**Closed 2026-08-17** (`4bb211b`): `ListView.tsx` and `Sidebar.tsx` had
no `isError` branch, so a failed `/api/tasks` rendered as "No tasks
match these filters." Both now render `ErrorState`, and the sidebar
marks each failed group. This entry stood as open for a day after the
fix landed — a stale record that would have sent whoever picked up M2
hunting a bug that was not there.

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

## V1 audit A — core validation survey, 2026-08-17

Read-only survey of what `packages/core` validates on its write paths,
run as input to V1. Two findings are live defects; the rest is the
factual picture V1 needs.

### 🔴 `setFields` does not resolve entity names — MSL-C1, reopened on the bulk path

`resolveEntityRef` (`task/update.ts:217`) converts a milestone / sprint /
assignee **name** to its ULID before writing. It has exactly one call
site — `update.ts:282`, inside `setField`. **`setFieldsLocked` does not
call it**, so `setFields` and `bulkSetFields` write the raw string.

Reproduced against the built binary. Same command, same field; the only
difference is how many task refs:

```
loctt set T1 milestone v1        -> milestone: 01M0SAA043ZZ1FQS1VFF8QRYM9
loctt set T1,T2 milestone v1     -> milestone: v1
```

`doctor` then reports `2 dangling reference(s) — unknown milestone "v1"`.

This is **MSL-C1 reopening**. That case was closed in Phase 3 (`48b2b57`)
because identity is a ULID and storing the name made milestone progress
read 0/0. The fix landed in `setField` only; `setFields` was not
covered, and `bulkSetFields` delegates straight to it (`bulk.ts:99`).

All three surfaces reach it: `apps/web/src/server/server.ts:2497`,
`apps/mcp/src/tools/task-crud.ts:408`, `apps/cli/src/commands/task-crud.ts:478`
and `:544`. The CLI routes to bulk whenever more than one ref is given
(`task-crud.ts:476`), so `loctt set T1,T2 …` is enough.

It also defeats two guards that match on id: the archived-reference
check, and `deleteUser`'s reference scan.

### 🔴 No write path checks that a referenced entity exists

`validateTaskAgainstWorkflow` (`config/validation.ts:33`) takes an
optional `aux` parameter that adds existence checks for project,
milestone, sprint and labels (`validation.ts:78-118`). Verified by
grep: the only caller passing it is `diagnostics/doctor.ts:357`. The
three write paths — `create.ts:128`, `update.ts:309`, `update.ts:629` —
all pass two arguments.

So a task can be written referencing a milestone, sprint, project or
label that does not exist. `assertLabelIdsRegistered`
(`labels/manage.ts:88`) documents itself as "used by createTask/setField"
and is called by neither.

### The V1 picture

- **52 error classes in core; 4 carry structured data.** Only
  `UnreadableFileError`, `SwapRollbackError`, the two attachment errors
  and `StaleBodyWriteError` have fields beyond a message. Every
  write-path error — `TaskUpdateError`, `RelationshipError`,
  `CommentError`, `ArchivedReferenceError`, the five entity errors — is
  message-only.
- **`ErrorResponse` is never constructed in core.** Its only
  construction site in the repo is `apps/web/src/server/server.ts:311`.
- **`ValidationError` is `{field, message}`** (`validation.ts:11`) —
  already half the envelope, missing `code`, `data_state`, `recovery`.
- **`createTask` throws a bare `Error`** (`create.ts:130`), the only
  surveyed entry point callers cannot `instanceof`.
- **Raw `z.ZodError` escapes** from `writeTask` (`task/io.ts:41`) and
  `bulk.ts:125`/`:195` — the one structured failure core produces, and
  it is thrown untranslated. ERR-16 bars it from user-facing copy.
- **`workflowConfig` and `archivedGuard` are optional everywhere.**
  Omitting them silently skips all enum and archived validation.
- **Sprint state is a hardcoded local set** (`sprints/manage.ts:28-32`),
  not read from config, unlike every other enum.
- **`bulkSetFields` flattens error classes to strings** (`bulk.ts:115`)
  in `BulkResult.failed`, losing the class before any surface sees it.

Agent-reported, not re-verified here: `linkTask` will write an edge to a
nonexistent task when `blockArchivedTarget: false` and no inverse is
defined; `postComment` creates the task directory for a nonexistent
task id rather than erroring. Both are plausible from the code but were
not reproduced.

## V1 audit B — surface-level validation survey, 2026-08-17

Which rules about the DATA live in the surfaces rather than in core.
Interface concerns — arity, usage strings, unknown-flag rejection,
CLI boolean-literal parsing, HTTP routing — are excluded by design.

### Diverging: the same rule, implemented differently

**Sprint `state` — four hand-maintained copies, and three different
messages for the same input.** Verified by running each:

```
CORE : state must be one of active|completed|future, got: bogus
CLI  : --state must be one of active|completed|future
MCP  : Invalid enum value. Expected 'active' | 'completed' | 'future', received 'bogus'
```

Only core names what was given. Copies at `apps/cli/src/commands/sprint.ts:65`
and `:96` (literal `!==` chains), `apps/mcp/src/tools/sprint.ts:43` and
`:68` (`z.enum`), core at `packages/core/src/sprints/manage.ts:28-32`.
The web has **no** check — its union is a TypeScript annotation on
`parseJsonBody`, erased at runtime — so it is the only surface already
doing the right thing.

Core's state-*transition* rule (`manage.ts:45-49`, reopening a completed
sprint needs `force`) is correctly centralised and duplicated nowhere.
Only membership is duplicated.

**status / priority / task_type** — `assertWorkflowEnumKey` exists twice
with near-identical bodies: `apps/cli/src/runtime/workflow-assert.ts:23`
(throws `UsageError`) and `apps/mcp/src/runtime/workflow-assert.ts:22`
(returns `errorResult`). Both re-derive the key list from `WorkflowConfig`
themselves. The web has none and delegates to core.

**Relationship type** — CLI only (`workflow-assert.ts:44`). MCP's copy of
the same file deliberately omits it, so a bad relationship key gets a
friendly key list on the CLI and core's raw message on MCP and web.

**Date shape** — MCP restates core's regex byte-for-byte
(`apps/mcp/src/runtime/fields.ts:33`, same pattern and message as
`packages/contracts/src/task.ts:13`). Its own comment admits the copy.
Net rejection is the same; the *ordering* differs — MCP rejects before
task lookup, the others at write time.

**Pagination bounds — three different rules.** CLI requires a
non-negative integer with no cap (`task-crud.ts:151`); web adds
`limit <= 1000` (`server.ts:570`, cap at `:541`); MCP has
`z.number().optional()` and checks nothing (`task-crud.ts:106`). So
`limit: -1` is rejected by two surfaces and accepted by one;
`limit: 100000` is rejected by one and accepted by two.

**Sort direction** — all three enforce it separately, with different
wording, and both CLI and web silently coerce anything not `desc` to
`asc` *after* the guard.

**Attachment source path** — a genuine behavioural fork. MCP rejects a
relative path outright (`task-files.ts:36`); the CLI resolves it against
cwd (`task-files.ts:35`); core resolves it too (`attachments.ts:99`).
MCP's rationale — the server's cwd is not the agent's — is defensible,
but it is expressed as a value-legality rejection of input core accepts.

### On one surface only, with no core home

- **User-settings nesting depth ≤ 8** — web only (`server.ts:2077`).
  Any other write path bypasses it.
- **Task-ref character class** `/^[A-Za-z0-9_-]+$/` — web only
  (`server.ts:625`), used by ~15 handlers. A ref with a dot is a 400 on
  the web and a not-found on CLI/MCP. Partly a traversal guard, so
  partly an interface concern.
- **Export format `csv|json`** — web only (`server.ts:2285`).
- **Milestone `target_date` format** — appears to be checked *nowhere*.
  `createSprint` calls `assertIsoDate` (`sprints/manage.ts:104`);
  `createMilestone` does not (`milestones/manage.ts:73-117`). Agent
  flagged this as uncertain and it is **not verified here.**

### Already correct — do not "fix" these

- **`handleSetField`** (`server.ts:2683`) does no value validation at
  all: it checks a field was named, then delegates entirely to core and
  translates three typed error classes. **This is the model** the other
  surfaces should converge on — noteworthy because an earlier audit
  entry listed its unvalidated `value` as a finding. The unvalidated
  `value` is the *correct* design; what was missing is core validating
  it, which is exactly V1.
- Every web entity create/edit handler delegates cleanly.
- `apps/cli/src/commands/config.ts` pulls its key vocabulary from core's
  `CONFIG_KEYS` rather than restating it.
- `assertSafeBasename` is now called from core at all three surfaces —
  the `includes("..")` regression is genuinely closed.
- Attachment and avatar size caps import core's constants rather than
  restating the numbers.

### Not verified

Agent-reported and not reproduced: core's rank module possibly not
re-checking before/after exclusivity; whether core rejects a negative or
fractional `limit` anywhere; whether `MilestoneDefSchema` brands
`target_date` as `IsoDate`; and a comment at `server.ts:1546` claiming a
hex-colour guard raising `LabelError` that the agent believes inaccurate.

## Status after the 2026-08-17 session

**Groups A–F closed. The six swallowed-error findings closed. All nine
recorded decisions implemented.**

Still open, deliberately:

- **Group G — now itemised**, in
  [`audit/group-g-itemised.md`](audit/group-g-itemised.md). The count
  was carried as "~79" with no list anywhere, so it could never be
  audited or closed. Extracting from the slice reports — which do carry
  a `Category` per finding — gives **55**, not 79. Still deferred until
  after the UI build for the original reason: much of it is in code
  M2–M4 rewrites. The difference is that it can now be checked off.

- **10 findings belonged to no group at all** — 6 `layering`, 4
  `doc-drift` — and the summary's category counts hid that, because
  A–F covered `bug` and G was described as "cosmetic". Neither is
  cosmetic. Reviewed 2026-08-17:
  - **Fixed**: the three query error classes extended bare `Error`, so
    a mistyped query reached a surface as `unknown` — the code ERR-31
    reserves for causes that genuinely cannot be determined. They now
    carry `validation_failed` and `field: "query"`. This was a V1 gap
    the V1 work missed.
  - **Already fixed by Phase 3's doc corrections**: the four
    `doc-drift` findings against `mcp/reference.md`.
  - **Left open, and named here rather than in an unenumerated group**:
    `reorderBoardRank` is O(all tasks) per call (`rank/reorder.ts:190`);
    `create_project` is not atomic when `make_default: true`
    (`mcp/tools/project.ts:53`); `info` re-reads config rather than
    using `getTrackerInfo` (`cli/commands/info.ts:24`);
    `findStructuralCycles` is not re-exported so `doctor` reaches past
    the barrel (`diagnostics/doctor.ts:19`); `PATCH /api/tasks/:ref` has
    no request schema (`contracts/src/service-schemas.ts:1`) — though
    that route is POST, so the finding may be stale in the same way an
    earlier one was.
- ~~**MCP comment tools' bare catches.**~~ **Closed 2026-08-17.** Three
  `catch (err) { return errorResult(err.message) }` blocks in
  `apps/mcp/src/tools/comments.ts` turned any throw into a routine
  domain error. The dispatcher in `index.ts:135` already classifies
  correctly — errorResult for a known domain error, rethrow for
  anything else, because masking a real bug hides the diagnosis — and
  these sat inside it and pre-empted it. Deleted; verified a domain
  error still reaches the agent as `isError` with its message.
- ~~**`HistoryEntry` element shape.**~~ **Closed 2026-08-17**
  (`4fb7e4b`). It was carried as "deserves its own design pass", which
  was true but became the reason it never happened. `kind` was checked
  only for being a *string*, so a hand-edited `not_a_real_kind` reached
  every reader — and M2.4's activity feed switches on `kind` to pick an
  icon, so it had to land before the UI.

  `HistoryKind` is now derived from `HISTORY_KINDS`, so the union and
  the schema cannot drift. The schema is `.passthrough()` and leaves
  `before`/`after` unconstrained: a row from a newer LocTT stays
  readable, and arbitrary field transitions are not rejected. P-11 is
  intact — a rejected row is still kept, still merged, and now reported
  by `doctor`, which was itself untested until `40be50c`.

**Closed since the last status:** `handleSetField`'s unvalidated
`value`. It was recorded as a finding and was not one — the handler
delegating everything to core is the *correct* design, and audit B
identified it as the model the other surfaces should converge on. What
was missing was core validating the value, which V1 (`e19964f`) does.
