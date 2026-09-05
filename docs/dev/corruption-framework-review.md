# Corruption-handling framework — adversarial review

> Review of `corruption-framework-proposal.md` (687 lines) against
> `corruption-framework-brief.md`, `north-star.md` principles 4–7,
> `corruption-spike-findings.md`, and the code the proposal cites.
> Written 2026-09-05. The reviewer did not write the proposal and edits
> nothing but this file. Every claim below names the line it rests on.

## Verdict

**PASS-WITH-FIXES.** The spine holds; the write-side guarantee as written
does not. Two blocking spec fixes (B1, B2) and one correction to the
operation table (S1) must land in the proposal before Step 4 measures
against it. One rewording of a principle must be put to Ken (M1).

---

## Soundness

The architecture — `readTask` becomes the tolerant primitive; `frontmatter`
holds healthy values only; a sibling `health` list carries `{field, kind,
raw, rawText, error, repair}`; the serializer re-emits `raw` unless the key
is present (override wins); classification lazy-at-read plus `doctor`
enumeration; repair provenance as an ordinary history entry with
`meta.was_corrupt` — is coherent, matches the `BrokenSavedQuery` precedent
(A118, `config/queries.ts:38-98`), and is the right answer to spike
finding 1. It satisfies every item in the brief's "What the proposal must
define" (taxonomy §2 with a completeness argument §2.4; per-kind ×
per-surface §6; the abstraction and where it lives §4; UI state machine
§8; severity §3; cross-surface §5) and *decides* both open questions
(§9, §10) rather than dodging them.

Checks run:

1. **Caller count (§1.1).** `readTask(` has 19 non-test call sites outside
   `io.ts` across `relationships.ts`, `lifecycle.ts`, `load-all.ts`,
   `lookup.ts`, `bulk.ts`, `update.ts`, `diagnostics/doctor.ts`,
   `git/reconcile-apply.ts`; `loadAllTasks(` has 31. Total 50 — the
   "~50" and `load-all.ts:88`'s "48 callers" are accurate. The three
   strict write-side parses are exactly `io.ts:61`, `bulk.ts:128`,
   `bulk.ts:194`; the only other `TaskFrontmatterSchema.parse` sites are
   the two parsers in `frontmatter.ts` and the public projection at
   `contracts/task.ts:221`. Confirmed.

2. **"Healthy object contains only healthy values" is safe for readers.**
   Every non-identity field in `TaskFrontmatterSchema`
   (`contracts/task.ts:51-97`) is `.optional()`, so dropping a corrupt
   value to `undefined` is type-correct, and the consumers I checked
   already take the `undefined` branch as "unset":
   - sort comparator `query/list.ts:404-406` pushes `undefined` to the
     end regardless of direction;
   - DSL evaluator `query/evaluator.ts:178-179` treats `undefined`/`null`
     left operand as "field not set";
   - `progress.ts:126` skips a non-string `milestone`/`sprint`;
   - `traversal.ts:32` uses `relationships ?? []`;
   - `board/columns.ts:236` already treats a non-lexorank `board_rank`
     as unranked;
   - `MetaPanel.tsx:272,285` `datesInverted(undefined, …)` is the
     shipped "no date" path.
   No reader assumes an optional field is present. The **one semantic
   hazard** of "corrupt = absent" is the boolean `archived`, where absent
   means *active* — see S1.

3. **Object-fatal attribution survives (finding 4).** `lookupById`
   (`lookup.ts:148-158`), `lookupByKey` (`lookup.ts:283-295`, `317-325`),
   `readKeyHeader` (`lookup.ts:181-207`) and `loadAllTasksDetailed`
   (`load-all.ts:96-107`) all branch on `TaskParseError`; a `readTask`
   that throws only for object-fatal keeps them unchanged. Confirmed.

4. **Spike dead-ends are correctly identified.** `frontmatter.ts:210`
   (raw back into `frontmatter`), `server/server.ts:3595-3607`
   (projection stripping), `server/server.ts:3561-3580` (double lookup),
   `lookup.ts:400` (`resolveRefToId`) all exist and do what §1.2 says.

5. **The write side — where the design is wrong.** See B1 and B2.

---

## Defects found

### Blocking

**B1. The monotonic write guard (§4.4) does not forbid the accidental
loss it claims to forbid.** `health(after) ⊆ health(before)` permits any
write that *shrinks* health, and shrink-by-override is the intended
repair path — so the guard cannot tell a deliberate set-over from an
operation that merged into a defaulted structure and silently discarded
the raw value. Concrete case: `fields: 3` (wrong_type) is dropped from
`frontmatter`; `setField("points", 5)` at `update.ts:448` does
`task.frontmatter.fields ?? {}` → `{ points: 5 }`; the serializer sees
`fields` present, override wins, the raw map is gone; `health` shrank;
the guard passes. Same pattern at `relationships.ts:323` (`?? []`) and
`move.ts:98` (`appendKeyHistory(source.frontmatter.key_history, …)`).
§3.2's table catches `relationships` and `key_history` by an op-level
`CorruptFieldError`, but has **no row for `setField(<custom>)` reading
`fields`**, and §0 claims write paths "inherit preserve-others … without
knowing corruption exists" — false for every merge-style writer.
*Fix:* `assertWriteSafe(before, after, touched)`: a `(field, kind)` may
leave `health` only if `field ∈ touched`. `attributableErrors`
(`update.ts:250-269`) already threads exactly this `touched` set; bulk,
archive (`{archived, archived_at, updated_at}`) and link
(`{relationships}`) can declare theirs. This makes the guard the thing
§0 says it is, and makes the missing table row unnecessary as a safety
measure (it stays necessary for the *message*).

**B2. "The single `writeTask`/`stagedSwap` choke point" does not exist;
task.md is written at six places.** Besides `io.ts:64` and the two
`bulk.ts` swaps (`:133`, `:210`) the proposal names, `assembleTaskFile`
+ a direct file write occurs at `io.ts:141` (`updateTaskBody`),
`backup/restore.ts:617` (restore's `stagedSwap`) and
`git/resolve-conflicts.ts:169` (merged conflict output). Restore
(`restore.ts:252,360,406`), reconcile-plan (`reconcile-plan.ts:351`)
and resolve-conflicts also construct `Task`s from bare
`parseFrontmatter`, not `readTask`. This interacts fatally with §4.3
change 3 (unrecognised keys leave `frontmatter` for `health`): today
those keys survive every writer via `.passthrough()` and
`frontmatter.ts:277-281`; after the change, any writer that assembles
`{frontmatter, body}` without `health` **drops every unrecognised key**
— a regression of shipped preservation on exactly the paths the brief's
§ "Reconcile" names (BAK restore must be byte-for-byte; git merge).
`mergeTask` in `resolve-conflicts.ts` also has no rule for merging two
sides' `health`.
*Fix:* make the choke point `assembleTaskFile(task: Task)` — the only
function every writer already calls — so the compiler finds all six;
enumerate them in §4.5; specify `mergeTask`'s treatment of `health`
(union of raw values, override by the winning side's healthy value).

### Should-fix

**S1. The "derived operation rule" (§3.2) is not mechanical, and the
table contradicts it.** The rule says an op *refuses* when any field it
must read is in `health`. The table then lets four ops read a corrupt
field and proceed with a default: `setField(status)` reads the old
`status` (`update.ts:437`); archive reads `archived` (`lifecycle.ts:61`,
`:85`; `bulk.ts:180`); `linkTask` reads the target's `archived`
(`relationships.ts:256`); board move reads `board_rank`/`status`
(`rank/board-move.ts:86-87`). Those are judgement calls the rule does
not produce. Three are also wrong or unstated:
- **`unarchiveTask` with `archived: "yes"`** — dropped to `undefined`,
  `if (!task.frontmatter.archived) return task` (`lifecycle.ts:85`;
  mirror `bulk.ts:181`) → no-op success, nothing written, the file
  still carries the corrupt flag, and every list shows the task as
  active. Table says "proceeds (and repairs) `archived`". Repairing
  here requires the op to consult `health`, which §0 says ops never do.
- **`duplicateTask`** reads `project` to allocate the key
  (`duplicate.ts:83`, `:117`) — with `project: 5` it throws a bare
  `Error`, not `CorruptFieldError`. Table says it never refuses. It
  also cannot "record the dropped fields in the result": it returns a
  plain `Task` from `createTask` (`duplicate.ts:120`).
- **"`setField("labels")` with add/remove semantics"** — no such mode
  exists; `update.ts:426` is a full replacement. Invented row.
*Fix:* add a third category — *guard reads with a safe default*, defined
as "a read whose `undefined` branch is the conservative outcome" — and
list which reads qualify; correct the three rows; add `setField(<custom>)`
/ `unsetField(<custom>)` (both read `fields`, `update.ts:448`, `:592`).
The audit's handled/defect verdict (§11.3) depends on this table being
right.

**S2. No repair surface for `wrong_type` on auto-managed fields.**
`completed_date`, `status_updated_at`, `archived_at`, `board_rank` are
refused by `setField` (`update.ts:392-397`) and `assertUnsettable`
(`update.ts:563-572`); §7.2 confirms the X is never offered for
`completed_date`. So `completed_date: "yesterday"` is reported with
`repair: set_or_remove` and neither repair is reachable; §3.4's
"the write that would set it anyway" fires only on a status change that
crosses the completed boundary. Define it: either `unset` is permitted
on an auto-managed field *when it is in `health`* (removing a corrupt
value is always safe), or `repair` gains a value that says so and §8
renders it.

**S3. `assertWriteSafe(before, after)` — where `before` comes from is
unspecified.** `writeTask(locttDir, taskId, task)` has 21 callers and no
`before`; either it re-reads the file (one extra read per write, n per
`stagedSwap` batch — acceptable under the lock, but say so) or the
signature changes at 21 sites. `before` must be the on-disk state, not
the caller's copy.

**S4. Address collision on `unset`.** Today `unset <name>` for a
non-builtin name means `fields.<name>` (`update.ts:590-595`). §5 routes
an unrecognised top-level `<name>` through the same verb. Define
precedence and the address (the `health.field` path — `jira_id` vs
`fields.points` — is the natural one), and carry it to CLI/MCP/web
alike. Note also that `set <unknown>` today *writes* `fields.<unknown>`
(refused only when a workflow is loaded and the field is undeclared,
`config/validation.ts:131-137`); §6's refusal message is a change to
that path.

**S5. §7.3 reverses a deliberate, commented refusal.**
`relationships.ts:407-411`: "a permission failure or a corrupt file must
still propagate rather than be silently treated as 'target gone'". The
proposal makes unlink succeed on the source when the target is
object-fatal — leaving a one-sided edge P-12 forbids once the target is
repaired. Defensible under principle 7, but it is a shipped-behaviour
change presented as settled; needs a `decisions.md` § 8 entry with a
revert path (see M2).

**S6. Schema change unstated.** Moving unrecognised keys out of
`frontmatter` implies `TaskFrontmatterSchema` stops being
`.passthrough()` (`contracts/task.ts:101-105`) — otherwise an unknown
key is not a Zod issue and the split must be done by hand before
parsing. The inferred type also loses its index signature, which
`readField`/`toMutable` rely on (`task/mutable.ts:47`). Say whether it
becomes `.strict()` (unknown key = issue = `unrecognised`) and what
`readField` does.

### Nits

- **N1. Path citations.** `server.ts` → `apps/web/src/server/server.ts`
  (line numbers correct); `service.ts:187/580` →
  `packages/contracts/src/service.ts:187/581`; `history.ts:15-19` and
  `:40` → `packages/contracts/src/history.ts:19` and `:40-42` (core's
  `task/history.ts:15-19` is the coalesce window); `validation.ts` is
  `packages/core/src/config/validation.ts`; the `.strict()` cited as
  `task.ts:170-171` is at `contracts/task.ts:~194`.
- **N2. `missing_required` via `title: ~`.** `coerceFrontmatter` keeps
  the `null` (`frontmatter.ts:71-76`) so Zod reports "expected string" —
  mechanically a `wrong_type`. The classifier must map null-on-required
  to `missing_required` explicitly or the kind table lies.
- **N3. `raw` on the wire.** §4.5 drops `raw` from the web response;
  §6 says MCP "carries `health`" without saying whether `raw` is
  included. Parity says one answer for both.

---

## The three Ken-decisions (§12)

1. **Fatal set `{id,key}` vs `{id,key,title,created_at,updated_at}`** —
   **genuine**, borderline. Brief §5 and principle 5 both point at
   `{id,key}`; what makes it Ken's is the load-bearing contract change
   (`title: string` at `contracts/task.ts:54` becomes optional in
   `TaskFrontmatter` *and* the `.strict()` public projection, touching
   every consumer). The recommendation (five now, two later) is the
   safe default; the question could be put as "confirm phasing" rather
   than as an open either/or.

2. **Surface `unrecognised` keys with a delete affordance?** — **not
   genuine; settled by the approved brief.** Brief §1: "Extra — an
   unrecognised field. Still rendered, but as a read-only string of its
   contents." Brief §4: "An unrecognised field → shown as string, with
   an 'X' to remove it." Those are Ken's words, approved 2026-09-04. The
   proposal is re-asking an answered question. The residual (group label
   "Not recognised" vs "Corrupt") is an agent call for § 8.

3. **Publish gate on field-local corruption?** — **not genuine; settled
   by existing decisions.** `integrity.ts` header: `malformed` is
   "reported, never blocking — a malformed entry must not make a tracker
   unpublishable, which would be destruction by another route"; V2
   (`decisions.md:268`) says the same for history. The proposal itself
   says the answer "changes nothing today". Record in § 8 with a revert
   path (a `--force`-skippable warning is the revert), and move on.

## Missed decisions

- **M1. Value-preservation replaces "byte-preserved".** North-star
  principle 7 says other fields are left "expected, unexpected, or
  wrong-typed, **byte-preserved**" (`north-star.md:118`). §4.4 narrows
  this to YAML-value preservation and then asserts nothing else needs
  Ken. Rewording a principle is Ken's (`north-star.md:166-169`). The
  argument Ken needs in front of him: `stringifyYaml`
  (`frontmatter.ts:283`) already re-serializes every healthy field on
  every write today, so the literal wording is unmet now; the proposal
  is making that honest, not making it worse. Still his to accept.
- **M2. Unlink over an object-fatal target** (S5) — a shipped-behaviour
  reversal that also tolerates a P-12 violation. § 8 entry at minimum;
  flag to Ken if the P-12 tension is judged load-bearing.
- **Record, not Ken:** structural fields (`relationships`, `fields`,
  `labels`, `key_history`) move from object-fatal — the spike's
  documented boundary, `frontmatter.ts:129-131` — to field-local.
  Principle 7's own `relationships`-as-object example settles it
  (the object opens; the link refuses), but the reversal of the spike's
  reasoning should be a § 8 entry so the next agent does not re-derive
  the old boundary.

---

## Bottom line for the coordinator

Step 4 can proceed on this framework **after** the proposal text is
amended for **B1** (guard takes `touched`; a health entry may leave only
for a touched field), **B2** (choke point is `assembleTaskFile(task)`;
all six writers enumerated; `mergeTask` handles `health`), and **S1**
(third read-category defined; the `unarchive`, `duplicateTask` and
`labels` rows corrected; `setField(<custom>)` added). Without B1 the
audit's "handled" cells would certify a guard that lets `setField` on a
custom field discard a corrupt `fields` map; without B2 the audit would
find restore and git-merge dropping unrecognised keys and file them as
new defects when they are a consequence of the framework itself. M1
goes to Ken alongside § 12's item 1; items 2 and 3 should be withdrawn
from § 12 and recorded in `decisions.md` § 8. S2–S6 and the nits can be
fixed in the same pass or picked up as the audit's first "unspecified"
cells — they do not block starting.
