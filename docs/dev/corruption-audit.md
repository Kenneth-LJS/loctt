# Corruption-handling audit (Phase 7, step 4)

> Measures the shipped corruption framework against
> `corruption-framework-proposal.md` §§ 3, 6, 7 (as amended by § 13 and
> K26/K27/A135). Every cell is **handled**, **defect**, or
> **unspecified** per the § 11.3 verdict rule. The matrix is enforced by
> `packages/core/src/task/corruption-audit.test.ts` (42 table-driven
> cells, `seedCorruptTask` writes each corrupt task.md by hand — the way
> the real world reaches the state, K21). Re-run it green before closing.

Written 2026-09-05, after building the framework. The framework is:
`readTask` is tolerant (a field-local corruption degrades into
`Task.health`, only `{id,key}`/YAML-syntax is object-fatal); the write
side routes through `assembleTaskFile(task)` + `assertWriteSafe`;
extrinsic kinds (`invalid_value`/`dangling`) are classified by
`classifyTaskHealth` where configs load; surfaces render `health`.

---

## The verdict rule (§ 11.3)

For each (row, column): run the op, then assert exactly one of

- **handled** — the op completes and `health(after) ⊆ health(before)`
  with every untouched `raw` value-identical on disk; OR it refuses with
  a `CorruptFieldError`/`CorruptWriteError` naming the field *and § 3.2
  says it should refuse*.
- **defect** — the op throws anything else, reports `not found` over a
  file on disk, silently drops or rewrites a `raw`, or refuses a cell §
  3.2 says must proceed (or proceeds where it says refuse).
- **unspecified** — §§ 3.2/6/7 have no row for it.

---

## Columns (kinds × representative fields)

| Column | Seed | Severity |
|---|---|---|
| `wrong_type:due_date` | `due_date: 42` | field-local |
| `wrong_type:priority` | `priority: [oops]` | field-local |
| `wrong_type:archived` | `archived: yes-please` (a string) | field-local |
| `wrong_type:labels` | `labels: urgent` (scalar, not array) | field-local |
| `wrong_type:relationships` | `relationships: not-a-list` | field-local (A135) |
| `wrong_type:fields` | `fields: 3` | field-local (A135) |
| `wrong_type:board_rank` | `board_rank: [1]` | field-local |
| `wrong_type:key_history` | `key_history: T-old` (scalar) | field-local (A135) |
| `missing_required:title` | `title` absent | field-local (K26) |
| `unrecognised:jira_id` | `jira_id: ABC-1` | field-local |
| `object_fatal:no_id` | `id` absent | object-fatal (K26) |
| `object_fatal:yaml` | unterminated quote | object-fatal |

## Rows (operations) × verdict

| Row (operation) | field-local columns | object-fatal columns |
|---|---|---|
| `readTask` / `lookupById` | **handled** — opens with `health`, never throws | **handled** — `TaskParseError` → `UnreadableTaskError` (path + line, recovery:none) |
| `lookupByKey` | **handled** — a corrupt task's key folds into the index from its healthy identity; by-key resolves (finding 2 fixed) | **handled** — `UnreadableTaskError` (indeterminate form when the key itself is the unparseable part) |
| `loadAllTasks` / list / sort / filter | **handled** — corrupt task appears in the list carrying `health`; a corrupt sort/filter field reads as absent (pushed to end / "not set") | **handled** — listed under `unreadable`, not dropped |
| `buildShowModel` | **handled** — intrinsic + extrinsic `health` merged onto the model task | n/a (the caller already resolved the task) |
| `setField(other)` | **handled** — writes the field, preserves every corrupt/unrecognised field's raw on disk (`assertWriteSafe` rule 2 + carried `health`) | n/a (task unreadable) |
| `setField(corrupt field)` = set-over | **handled** — validated write repairs it, `health` entry clears (override-on-direct-write) | n/a |
| `unsetField(corrupt/unrecognised field)` = remove | **handled** — drops the `health` entry, the raw stops being re-emitted; an unrecognised top-level key is removable (previously threw "custom field not set") | n/a |
| `linkTask` / `unlinkTask` over `wrong_type:relationships` | **handled** — refuses with a corrupt-field error (§ 3.2 must-read; A135 keeps the refusal) | **handled** — an object-fatal *target* still propagates (the shipped `relationships.ts:407-411` refusal is kept) |
| `archiveTask` / `unarchiveTask` over `wrong_type:archived` | **handled** (after fix) — proceeds and repairs the corrupt flag; never no-ops over a corrupt value | n/a |
| `bulkSetFields` | **handled** — per task; untouched corrupt fields preserved | member is `unreadable` → lands in `failed` |
| `bulkArchive` | **handled** — corrupt `archived` is repaired, not no-op'd | member `unreadable` → `failed` |
| `duplicateTask` | **handled** — copies healthy `frontmatter` only (corrupt values are off it); refuses when `project` itself is corrupt (it must read it to allocate a key) | n/a |
| `writeTaskBody` / `appendTaskBody` | **handled** — body write carries `health`, preserves frontmatter corruptions | object-fatal throws on read, as before |
| `doctor` / `checkDataIntegrity` | **handled** — each field-local finding is a non-blocking `malformed` row; object-fatal is `unreadable` (blocks publish) |
| `createTask` (new value malformed) | **handled** — `assertWriteSafe` refuses (`CorruptWriteError`, `validation_failed` → 400), so a bad new value never reaches disk as a corrupt task |
| write guard (`assertWriteSafe`) | **handled** — refuses a write that would introduce a new finding (rule 1, applies even to whole-record writers unless they *declare* the finding) or drop an untouched corrupt field (rule 2) |

Every field-local cell across the reads and the single/bulk writes above
is exercised in `corruption-audit.test.ts`; all pass.

---

## § 11.4 reconcile-against-shipped rows

| Row | Verdict | Note |
|---|---|---|
| **BAK restore** of a backup containing a corrupt task | **handled-by-design** | `toTask` parses tolerantly and carries `health`; the land phase's `assembleTaskFile(task)` re-emits the raw values. The value survives byte-for-byte (`backup.test.ts` "carries every field the CSV drops" now asserts `rank` survives via `health`). |
| **git merge / resolve-conflicts** over a corrupt side | **handled-by-design (§ 13.2 B2)** | `readTaskFile` populates `health`; `mergeTask` unions both sides' `health` (a healthy value on the winning side overrides that field's entry) and `assembleTaskFile(out.merged)` re-emits. This is a consequence of the framework, classified handled here rather than discovered as a new defect. |
| **PRU partial remap** (`users/lifecycle`) over a task whose `assignee` is `wrong_type` | **handled** | `assignee` wrong_type is lifted off `frontmatter`, so the id-based remap scan simply does not match it (it was never a real user id); the remap touches the fields it owns and preserves the corrupt `assignee` raw. No silent rewrite. |
| **bulk results** for an object-fatal member | **handled (pre-existing known-gap unchanged)** | An object-fatal member lands in `failed`. When the key was never indexed the message is still "task not found" — the pre-existing `known-gaps.md` "An unreadable task.md reports as task not found" entry, unchanged by this work; the framework does not regress it. |
| **queries.yaml broken-entry drop** (the sibling-store analogue) | **out of scope, unchanged** | Named in § 1.4/§ 11.4 as the first non-task application of the monotonic guard. This audit is task-scoped; the queries store keeps its shipped `known-gaps` behaviour. Recorded so it is not mistaken for handled here. |

---

## Defects found

### D1 — `unarchive`/`archive` no-op'd over a corrupt `archived`, leaving the corrupt value on disk (FOUND + FIXED)

A `wrong_type` `archived` (e.g. `archived: yes-please`) reads as
`undefined` (lifted into `health`), so the idempotency guard in
`unarchiveTask` (`!task.frontmatter.archived → return task`), and its
mirror in `archiveTask`/`bulkArchive`, treated the task as "already in
the target state" and wrote nothing — leaving the corrupt flag on disk
and every list showing the task as active. This is the review's S1
concern, made concrete by the audit.

**Fix.** The idempotency check is skipped when `archived` is in `health`;
the write then proceeds and clears/sets `archived` (the write's own
target — writing it is the repair, § 13.3 S1). `archiveTask`,
`unarchiveTask` (`lifecycle.ts`) and `bulkArchive` (`bulk.ts`) all
carry the fix, and each now threads the source `health` forward and
declares `touched = {archived, archived_at, updated_at}`. Covered by
`corruption-audit.test.ts` ("archive/unarchive over a wrong-typed
archived").

### D2 — CLI `show` health block leaked the full target ULID of a dangling relationship (INTRODUCED by this work + FIXED)

The new CLI `show` "Needs attention" block printed a dangling
`relationships[i].target` finding with its full 26-char ULID `rawText`,
which the Relationships section deliberately truncates (K22) — both a
duplicate row and a ULID leak, caught by
`tests/integration/cli/link.test.ts`.

**Fix.** The CLI `show` health block filters out dangling
relationship-target findings (already rendered, truncated, in the
Relationships section) and truncates any bare ULID in the remaining
`rawText`/`error` as defence-in-depth. `apps/cli/.../task-crud.ts`.

---

## Cells that were `unspecified` → decided

None required a new `decisions.md` § 8 entry: every cell the audit ran is
covered by §§ 3.2/6/7 as amended, or by A135/K26/K27 already recorded.
The two design calls the framework rests on (fatal set = `{id,key}`;
value-preserved P7) are Ken's rulings K26/K27; the four agent-settled
calls are A135. The `duplicateTask` "does not surface dropped fields in
its result" observation is recorded in `known-gaps.md` (it needs an API
shape change to fix, out of scope here).

---

## Coverage hole found in verification (coordinator, 2026-09-05)

The first cut of the write-guard section asserted only
`expect(CorruptWriteError).toBeDefined()` — a vacuous test that passed
even with `assertWriteSafe`'s rule 2 (the B1 fix, the framework's central
silent-loss guard) disabled. Mutation-checking the guard exposed this:
neutering rule 2 left the whole suite green. Replaced with three real
tests — rule 1 (a write introducing a new finding is refused), rule 2 (a
write dropping an untouched corrupt field is refused), and the
whole-record exemption (`touched = "*"`). Both rules are now
mutation-verified: disabling either reddens its dedicated test.

## Re-run

```
cd packages/core && npx vitest run src/task/corruption-audit.test.ts
# 44 passed
```
