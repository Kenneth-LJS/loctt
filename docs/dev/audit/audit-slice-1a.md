# Phase 4 · Structural audit — slice 1a (`core/task` write paths)

Files read **in full**: `update.ts` (587), `create.ts` (147), `lifecycle.ts` (101),
`bulk.ts` (286), `move.ts` (178), `duplicate.ts` (118), `io.ts` (127),
`frontmatter.ts` (168). ~1,712 lines.

Supporting files read to verify findings (not part of the slice, not audited):
`mutable.ts`, `history.ts`, `state/keys.ts`, `projects/manage.ts` (createProject
only), `config/archived-guard.ts`, `utils/today.ts`, `apps/mcp/src/runtime/fields.ts`,
and the `setField`/`duplicate`/`move` call sites in `apps/cli`, `apps/mcp`,
`apps/web`.

Report-only. No file was edited.

---

### `completed_date` on create is stamped in UTC, unlike every other path that writes it
- **File**: `packages/core/src/task/create.ts:115`
- **Category**: bug
- **What is wrong**: `createTask` stamps `completed_date` with
  `now.slice(0, 10)` — the ISO instant truncated to a date, i.e. **UTC**. The two
  other code paths that write the same field, `setFieldLocked`
  (`update.ts:225`) and `setFieldsLocked` (`update.ts:522`), both resolve it via
  `todayDateString()` → `todayInZone(calendar.timezone)`, i.e. the workspace
  timezone from `calendar.yaml`.

  `utils/today.ts` exists specifically to kill this pattern. Its module comment
  names the exact defect: *"Resolving 'today' with
  `new Date().toISOString().slice(0, 10)` answers in UTC, so in a workspace
  configured Asia/Singapore (UTC+8) every query for the eight hours after local
  midnight used yesterday's boundary"*. `create.ts:115` is that line, still
  present, in a file that does not import `today.ts` at all.

  The adjacent comment claims the opposite of what the code does: *"auto-stamp
  completed_date so it matches the behavior of setField on a status transition.
  Same date format (YYYY-MM-DD)."* The format matches; the **value** does not.
- **Why it matters**: Reachable whenever a task is created directly into a
  completed-category status — `loctt create --status done`, MCP `create_task`
  with a completed status, and every `duplicateTask` of a source task that is
  already done (duplicate inherits `status`, so `createTask` re-stamps
  `completed_date` from scratch). In an ahead-of-UTC workspace this writes
  yesterday's date for the whole local morning. `completed_date` feeds burndown
  and "done this week" queries, so the off-by-one propagates into reporting
  rather than staying visible at the point of the write. Two tasks completed
  seconds apart — one by create, one by a status transition — can carry
  different `completed_date` values.
- **Blast radius**: `createTask` is the single funnel for task creation on all
  three surfaces (CLI, MCP, web) plus `duplicateTask`. The fix is confined to
  `create.ts`, but it changes an **on-disk value**, so per the plan's rule it
  escalates regardless of size. `createTask` is currently synchronous in its
  date handling; `todayDateString` is async, and `createTask` is already async,
  so no signature change is needed — but `todayDateString` is currently a
  *private* duplicate in both `update.ts:149` and `bulk.ts:51` (see the
  duplication finding below), so the fix and that finding should land together.
- **Size**: S
- **Auto-fixable**: no
- **Confidence**: high

---

### `updated_at` is user-writable through `setField` but rejected by `setFields`/`bulkSetFields` — same CLI command, opposite answers
- **File**: `packages/core/src/task/update.ts:208-212` vs `update.ts:434-438`
- **Category**: bug
- **What is wrong**: `setField` has an explicit `field === "updated_at"` branch
  that accepts any string and writes it verbatim to frontmatter. It is not in
  `USER_IMMUTABLE_FIELDS` and not in `AUTO_MANAGED_FIELDS`, so neither guard at
  the top of `setField` fires.

  `assertChangesWritable` — the shared validator for `setFields` and
  `bulkSetFields` — rejects the identical write with *"cannot set `updated_at`
  directly; it is stamped on every write"*. And `setFieldsLocked:486-490` still
  carries a `field === "updated_at"` branch that `assertChangesWritable` makes
  unreachable on both of its callers, so the file contains the permissive
  handling and the prohibition side by side.

  The divergence is reachable from a single CLI command. `loctt set` splits
  comma-separated refs (`apps/cli/src/commands/task-crud.ts:264-275`): one ref
  goes to `setField` and succeeds; two refs go to `bulkSetFields` and are
  rejected. `loctt set T-1 updated_at 2020-01-01` writes it;
  `loctt set T-1,T-2 updated_at 2020-01-01` errors. Web `handleSetField`
  (`apps/web/src/server/server.ts:2613`) forwards `request.field` unfiltered and
  is equally permissive. **MCP is the only surface that blocks it**, via
  `checkFieldWritability` in `apps/mcp/src/runtime/fields.ts:83-91` — and that
  guard's own comment shows it is compensating for core rather than mirroring it.

  Two further consequences of the branch, both verified by reading it: the write
  does **not** bump `updated_at` to now (it is the value being set), and no
  workflow validation or archived-guard check runs on the result — those run
  after the branch, but there is nothing for them to reject. `setField` does
  still emit a `field_change` history entry for it: `updated_at` is excluded
  from the custom-field branch at line 291 and falls through to the built-in
  branch at 298. So history records it; the value is simply arbitrary. Nothing
  validates the string is a timestamp at all.
- **Why it matters**: `updated_at` is the tiebreaker for git-sync merge rule
  **M2** — *"a contested frontmatter field takes the later `updated_at`"*
  (decisions.md §6). A caller that can set it to an arbitrary string can decide
  which side of a future merge wins, or write a value `Date.parse` cannot read,
  on a field the merge algorithm treats as authoritative. That is the reason
  `assertChangesWritable` refuses it; the refusal just is not on the path most
  callers take.
- **Blast radius**: `setField` is called from CLI (`task-crud.ts:278`), MCP
  (`tools/task-crud.ts:214`), and web (`server.ts:2613`). Closing the branch is
  an **error-message and accepted-input change** on a public export, so it
  escalates by rule. Note there is a legitimate-looking internal use to check
  before closing it: nothing in this slice calls `setField('updated_at')`, but
  the branch predates the `setFields` prohibition and may have an out-of-slice
  caller. It also interacts with `WRITABLE_BUILTIN_FIELDS`, which MCP consumes
  to build its error text — removing `updated_at` from the writable surface
  changes the MCP guard's meaning too.
- **Size**: M
- **Auto-fixable**: no
- **Confidence**: high

---

### `createTask`'s project parameter is documented as a project *key*; the code and every caller use the ULID *id*
- **File**: `packages/core/src/task/create.ts:18-21` and `create.ts:64-66`
- **Category**: comment
- **What is wrong**: The doc comment says *"Project the task belongs to
  (**matches `ProjectDef.key`**)"* and the inline comment at line 64-65 says
  *"The **project key** doubles as the entity-type for `allocateKey`."*

  **`ProjectDef` has no `key`.** Invariant **P-1**: *"Projects are
  `{id (ULID), name, prefix}`. **There is no slug.** `ProjectDefSchema` is
  `.strict()`."* Verified against the actual writer:
  `projects/manage.ts:205,216` generates `const id = ulid()` and calls
  `initKeyAllocation(state, id, ...)`, so `state.keys` is keyed by **ULID id**.
  `allocateKey(state, options.project)` therefore only resolves when
  `options.project` is a ULID. Every real caller complies — CLI
  `task-crud.ts:49` and MCP `task-crud.ts:151` both funnel through
  `resolveProjectIdForUser` first — so the code is correct and only the comments
  are wrong.

  `architecture.md:126-129` carries the same stale vocabulary (`key` (slug,
  immutable internal identifier)), which is presumably where it came from. Note
  the doc is out of an auditor's remit; the code comment is not.
- **Why it matters**: This is exactly the "stale key-era bug" P-1's *"what
  breaks"* column warns about. A reader implementing a fourth caller from this
  comment passes a project name or prefix, `allocateKey` throws
  *"no key allocation state for entity type X"*, and the error names neither the
  project nor the real cause. It also directly contradicts **P-2** (*"tasks
  reference their project by ULID, never by name or prefix"*) for anyone reading
  `create.ts` in isolation.

  Related, and the reason this is not merely cosmetic: `duplicateTask`'s
  `overrides.project` is typed `string` with no such note, and neither CLI
  `duplicate` (`apps/cli/src/commands/task-crud.ts:190`) nor MCP `duplicate_task`
  (`apps/mcp/src/tools/task-crud.ts:283`) runs `resolveProjectIdForUser` on it —
  unlike their own `create` and `move` handlers, which both do. So
  `loctt duplicate T-1 --project Backend` fails with the raw `allocateKey`
  error. That defect lives in the CLI and MCP slices, not this one; recorded here
  because it is the same missing contract, and a cross-slice pass should join
  them.
- **Blast radius**: Comment-only within this slice. Zero runtime effect. The
  related duplicate/project-resolution defect touches `apps/cli` (slice 8) and
  `apps/mcp` (slice 9).
- **Size**: S
- **Auto-fixable**: yes (comment fix) — *but not in this run; report-only.*
- **Confidence**: high

---

### `todayDateString` is copy-pasted between `update.ts` and `bulk.ts`, and a third path open-codes it wrong
- **File**: `packages/core/src/task/update.ts:149-155`, `packages/core/src/task/bulk.ts:51-57`
- **Category**: duplication
- **What is wrong**: The two functions are byte-identical, including the
  `try`/`catch` fallback to bare `todayInZone()`. `bulk.ts`'s doc comment even
  points at the other copy: *"See the same helper in update.ts"*. `create.ts:115`
  is the third site that needs this value and open-codes a different — and
  incorrect — computation (see the first finding).

  I checked whether the duplication is load-bearing before recommending
  collapse, per the audit rules: it is not. The two bodies do not diverge in any
  case, the inputs and outputs are identical, and neither is specialised. The
  only structural difference is *when* they are called — `bulk.ts` resolves once
  per batch and threads the result through `setFieldsLocked`'s `today` parameter,
  `update.ts` resolves per call — and that difference lives at the call sites,
  not in the helper.
- **Why it matters**: Three sites needing one date, two identical copies and one
  wrong. This is the shape that produced the `create.ts` defect: the helper was
  never somewhere `create.ts` would find it. Collapsing to one exported helper
  (`utils/today.ts` is the natural home — it already owns the timezone rule) makes
  the correct answer the reachable one for the next writer of this field.
- **Blast radius**: Both copies are module-private; moving them adds one export
  to `utils/today.ts` and changes two imports. No signature, on-disk shape, or
  error message changes — but the move is only worth doing **together with** the
  `create.ts` fix, which does change an on-disk value. Treat as one escalated
  change, not two.
- **Size**: S
- **Auto-fixable**: no (new export)
- **Confidence**: high

---

### `assertUnsettable`'s contract names `bulkUnsetField`, which was deliberately never built
- **File**: `packages/core/src/task/update.ts:320-325`
- **Category**: comment
- **What is wrong**: The doc reads *"Shared with {@link bulkUnsetField} so the
  two paths cannot drift — a field the single-task API refuses must not become
  clearable in bulk."* No `bulkUnsetField` exists. Grepped across
  `packages/core/src`, `packages/contracts/src`, and all three apps: zero
  matches outside this comment, tests included.

  This is a **deliberate omission**, not a gap, and I nearly filed it as one.
  decisions.md **CW-4** records it explicitly: *"`bulkUnsetField` was not needed —
  `bulkSetFields` already treats `value: undefined` as a clear; the gap was that
  no surface could express it, since JSON has no `undefined`. Each surface maps
  `null → undefined`."* So the absence is correct and the comment is the
  artifact — written against a planned function that the plan then dropped.

  The `{@link}` also resolves to nothing, so it renders as a dead reference in
  any generated docs or editor hover.

  Consequently `assertUnsettable` is **exported with no external consumer**: its
  only call site is `unsetField` at line 316, in the same file. The export was
  presumably for the bulk path that never arrived.
- **Why it matters**: The comment tells a reader that a second unset path exists
  and is kept in sync by this function. Someone auditing whether bulk-unset is
  guarded will look for `bulkUnsetField`, not find it, and reasonably conclude
  the guard is missing — inverting the actual situation. The real bulk-clear path
  is `bulkSetFields` with `value: undefined`, which is validated by
  `assertChangesWritable`, a *different* function with a *different* rule set
  (it permits clearing fields `assertUnsettable` refuses, and vice versa). The
  comment actively points away from the code that matters.
- **Blast radius**: Comment fix is zero-risk. Demoting the export to
  module-private is a **public-export change** on `@loctt/core` (re-exported at
  `core/src/index.ts:333` region via `task/index.ts:80-89`) and escalates by
  rule despite being a one-line edit — do not bundle it with the comment fix.
- **Size**: S
- **Auto-fixable**: yes for the comment; **no** for the export demotion
- **Confidence**: high

---

### Two exports on `@loctt/core` with zero consumers: `SYSTEM_MUTABLE_VIA` and the `IMMUTABLE_FIELDS` alias
- **File**: `packages/core/src/task/update.ts:51` and `update.ts:65-75`
- **Category**: dead-code
- **What is wrong**: Both are exported from `update.ts`, re-exported by
  `task/index.ts` (lines 82, 85) and again by `core/src/index.ts` (lines 327,
  330). Grepped the whole repo excluding `node_modules` and `dist`:

  - `SYSTEM_MUTABLE_VIA` — referenced only by its own definition and three
    `{@link}` mentions in neighbouring comments in this same file. **No code
    reads it, no test asserts on it.** It is a `Record<string, string>` of prose
    descriptions; its own doc admits as much: *"This is documentation that lives
    next to the type."*
  - `IMMUTABLE_FIELDS` — a `@deprecated` alias for `USER_IMMUTABLE_FIELDS`,
    *"kept as a re-export so existing external imports keep compiling."* There
    are no such imports. The three consumers of the real set
    (`apps/mcp/src/runtime/fields.ts:20,67`) all use `USER_IMMUTABLE_FIELDS`.
    Zero test references either.

  I am reporting these as one finding because the judgement is the same for
  both, but they are not equivalent risks — see below.
- **Why it matters**: `SYSTEM_MUTABLE_VIA` is a documentation table that
  typechecks but is never checked *against* anything: nothing asserts its keys
  match `USER_IMMUTABLE_FIELDS`, so it can silently drift from the set it claims
  to annotate. Reading it today, `status_updated_at: "setField('status', ...)
  auto-stamps it"` is already incomplete — `setFieldsLocked:500` stamps it too,
  and `move.ts` writes `key`/`key_history` outside the one path the `key` row
  names (it says `rekeyCollisions` only). So the table is *already* stale, which
  is the predictable failure mode for prose that nothing exercises. Either give
  it a contract test that pins its keys to the set, or fold it into the comment
  above `USER_IMMUTABLE_FIELDS` and stop exporting it.

  `IMMUTABLE_FIELDS` is the cheaper case — a deprecated alias whose stated
  justification ("existing external imports") is empirically false.
- **Blast radius**: `@loctt/core` is consumed by `apps/cli`, `apps/mcp`, and
  `apps/web` inside this monorepo, and I verified none of the three import
  either symbol. But **removing a public export escalates by rule** regardless of
  reference count, and the plan's "dead code with **zero** references" auto-fix
  category is about internal dead code, not package exports — a published entry
  point can have consumers the repo cannot see. Recommend escalating both rather
  than treating either as auto-fixable.
- **Size**: S
- **Auto-fixable**: no (public exports — the "unused export" auto-fix category
  does not safely cover a package's own entry point)
- **Confidence**: high

---

### `bulkArchive` reimplements `archiveTask`'s frontmatter mutation instead of sharing it
- **File**: `packages/core/src/task/bulk.ts:134-146`, vs `packages/core/src/task/lifecycle.ts:34-45,61-68`
- **Category**: duplication
- **What is wrong**: `bulkArchive` builds the archived/unarchived patch inline
  with a raw `Record<string, unknown>` cast, then writes with
  `frontmatter: patch as unknown as Task["frontmatter"]`. `archiveTask` and
  `unarchiveTask` do the same three mutations — set/delete `archived`, set/delete
  `archived_at`, bump `updated_at` — via the `toMutable`/`toFrontmatter` pair
  that `mutable.ts` exists to centralise.

  `mutable.ts`'s module doc states the intent directly: *"This module
  centralizes the unsafe shape conversion at one boundary so the rest of the
  task module never reaches for `as unknown as TaskFrontmatter` casts."*
  `bulk.ts:144` is that cast, in the module the rule is about.

  This one **is** partly load-bearing and I checked before recommending
  collapse. `bulkArchive` genuinely cannot call `archiveTask`: `withStateLock` is
  not re-entrant and the batch lock is already held — the same constraint
  `bulkDelete` and `bulkLink` document at length. It also deliberately diverges
  on behaviour: `archiveTask` **throws** on an already-archived task, whereas
  `bulkArchive:130-133` treats it as a no-op success. That divergence is correct
  for a partial-success batch and must survive any refactor.

  What is *not* load-bearing is the frontmatter mutation itself. The pattern the
  rest of the module uses is a `*Locked` extraction — exactly what
  `setFieldsLocked` is, and its doc explains why: *"Exported for
  `bulkSetFields`, which holds one lock across a whole batch and therefore
  cannot call `setFields`. Sharing this rather than reimplementing it is what
  keeps the two paths honest — they previously diverged on unsetting a missing
  custom field, on writing `updated_at`, and on how history entries were built."*
  The archive pair has no such `*Locked` form, so it took the copy instead.
- **Why it matters**: Three copies of "what archiving writes" (archive,
  unarchive, bulk) with no shared definition. They already differ in a way that
  is invisible from either site: `bulkArchive` skips the `toFrontmatter`
  boundary, so a future field added to the archive transition has three places
  to remember. The precedent in this very file (`setFieldsLocked`) shows the
  team's own answer to this, and cites a past drift incident as the reason.
- **Blast radius**: Extracting `archiveTaskLocked`/`unarchiveTaskLocked` adds
  package exports (escalates by rule) and must preserve the throw-vs-no-op
  divergence at the *callers*, not inside the extracted helper. Touches
  `lifecycle.ts` and `bulk.ts`; `archiveTask`/`unarchiveTask`'s own signatures
  and error messages must not move — CLI, MCP, and web all surface
  `TaskLifecycleError`'s exact text.
- **Size**: M
- **Auto-fixable**: no
- **Confidence**: high

---

### `bulkDelete` writes no history and `bulkArchive` does — divergence is correct, but the M3 recovery guarantee it breaks is not noted
- **File**: `packages/core/src/task/bulk.ts:171-215`
- **Category**: comment
- **What is wrong**: `bulkDelete`'s doc explains why it writes no history:
  *"The whole directory goes... so there is nothing to undo afterwards and no
  history entry to write (the file it would live in is being deleted)."* That
  reasoning is sound and I am **not** reporting the behaviour.

  What the comment misses is the interaction with decisions.md **M3** — *"every
  history entry records enough to reconstruct the state it changed"* — which
  decisions.md establishes as the prerequisite making merge rule **M2**
  survivable, and which it justifies partly by pointing at `comment_deleted` as
  *"the sharpest case: a hard delete with no record of the text, unrecoverable by
  any means."* A bulk task delete is the same shape at a larger granularity, and
  the comment presents the absence purely as a filesystem consequence rather
  than as an accepted limit on the reconstruction guarantee.

  The same applies to `deleteTask` (`lifecycle.ts:81-101`), which says nothing
  about history at all.

  This is a documentation finding only. Recording deletions in a sibling location
  would be a **behaviour change and a new on-disk shape**, squarely outside this
  audit's remit, and may well be a deliberate omission — decisions.md does not
  say either way for tasks.
- **Why it matters**: The audit's job here is to stop the next reader concluding
  either (a) that history is a complete recovery path for tasks, or (b) that the
  missing entry is an oversight to "fix". One comment sentence naming M3 and
  stating that hard delete is outside its guarantee settles both.
- **Blast radius**: None — comment only.
- **Size**: S
- **Auto-fixable**: yes (comment fix) — *but not in this run; report-only.*
- **Confidence**: medium — the *behaviour* is near-certainly intentional; the
  judgement that the comment is worth extending is mine.

---

### `duplicateTask` calls `inherit()` twice per field across eleven fields
- **File**: `packages/core/src/task/duplicate.ts:88-97`
- **Category**: abstraction
- **What is wrong**: Each of ten inherited scalar fields is written as
  `...(inherit(a, b) !== undefined ? { f: inherit(a, b) as string } : {})` —
  calling `inherit` twice with identical arguments, once to test and once to
  use, then casting the result to `string` because TypeScript cannot narrow
  through the second call. Ten near-identical 80-column lines.

  `inherit` is pure and cheap, so the double call costs nothing at runtime. The
  cost is the `as string` on every line: the cast is what makes the double call
  typecheck, and it defeats the narrowing that would otherwise catch a field
  whose source type is not `string`. `estimate` is the live example — the MCP
  schema types it `z.union([z.string(), z.number()])`
  (`apps/mcp/src/runtime/fields.ts:48`) and `CreateTaskOptions.estimate` is
  `string`, so line 95's `as string` is silently asserting something the wider
  system does not guarantee.

  A local loop over a `[overrideValue, sourceValue, fieldName]` table, or a small
  `assignInherited` helper, removes both the repetition and all ten casts.
- **Why it matters**: Adding a twelfth inheritable field means copying an
  86-character line and changing three occurrences of the field name; getting one
  of the three wrong produces a copy that silently inherits the *wrong* field,
  and no type error fires because every line already ends in a cast. The
  surrounding contract doc (lines 49-70) is unusually careful about exactly what
  is and is not copied — the implementation should be as legible as that list.
- **Blast radius**: Internal to one function. No signature, on-disk shape, or
  error message changes. `duplicateTask` is called from CLI
  (`task-crud.ts:195`) and MCP (`tools/task-crud.ts:294`) only. The refactor is
  behaviour-preserving *if* the `null`/`undefined` distinction is kept exactly —
  that distinction is the whole point of `inherit` and is the one thing a
  careless table-driven rewrite would flatten.
- **Size**: M
- **Auto-fixable**: no
- **Confidence**: high

---

### `frontmatter.ts` re-derives the known-key set but `serializeFrontmatter` still enumerates every field by hand
- **File**: `packages/core/src/task/frontmatter.ts:16-18` and `113-161`
- **Category**: abstraction
- **What is wrong**: `KNOWN_FRONTMATTER_KEYS` is derived from
  `TaskFrontmatterSchema.shape` precisely *"so this list can't drift if a new
  field is added to the schema"* — a good instinct. But the function it serves,
  `serializeFrontmatter`, hand-writes 22 `if (fm.x !== undefined) obj["x"] = ...`
  lines that **do** drift, and are the actual source of truth for what reaches
  disk.

  The failure mode is asymmetric and quiet. A field added to
  `TaskFrontmatterSchema` but not to `serializeFrontmatter` enters
  `KNOWN_FRONTMATTER_KEYS`, so the pass-through loop at 155-159 skips it
  (`continue` on a known key) *and* the explicit block never emits it — the field
  is **silently dropped on the next write**. Had it not been in the schema, the
  pass-through loop would have preserved it. So adding a field to the schema
  without touching this function is strictly worse than not adding it at all.

  I checked whether the hand-ordering is load-bearing before suggesting this: it
  is. The doc states the ordering is deliberate (*"required identity first, then
  state, then dates, then arrays/maps"*), it is what makes on-disk diffs stable
  and reviewable, and `Object.keys(schema.shape)` order is not a contract to
  lean on. So the fix is **not** "replace with a loop over the schema" — it is a
  contract test asserting every key in `TaskFrontmatterSchema.shape` is emitted
  by a round-trip, leaving the explicit ordering intact.

  Two smaller notes in the same function, both correct as written and recorded
  only so a future reader does not re-derive them: `relationships` is emitted
  only when non-empty (`length > 0`) while `labels` and `key_history` are
  emitted whenever defined, so an empty `labels: []` round-trips and an empty
  `relationships: []` does not; and the pass-through loop's `undefined` skip is
  justified by a comment that correctly traces why `null` cannot reach it
  (`coerceFrontmatter` drops it upstream).
- **Why it matters**: This is a **silent data-loss path for on-disk content**,
  triggered by the most ordinary change anyone would make to the task
  model — adding a field to the schema. Nothing fails loudly: no type error (the
  field is optional), no test unless one happens to cover the new field's
  persistence, no runtime warning. The `.passthrough()` safety net that protects
  *unknown* fields specifically does not protect *newly-known* ones.
- **Blast radius**: `serializeFrontmatter` → `assembleTaskFile` → `writeTask` is
  the single write path for every task file in the tracker. The recommended fix
  is a **new test only**, which is zero-risk to behaviour; per the repo's testing
  rules it must be shown to fail first (add a field to the schema, watch it go
  red, revert). Changing the function itself is not recommended.
- **Size**: S (as a test); L if anyone attempts to make the emission
  schema-driven, which they should not
- **Auto-fixable**: no
- **Confidence**: high

---

### `bulkMoveTasksToProject` allocates keys against a `state` it may never save
- **File**: `packages/core/src/task/move.ts:145,157-158,172-175`
- **Category**: bug
- **What is wrong**: The batch loads `state` once, then for each task calls
  `performMove`, which calls `allocateKey(state, targetProjectId)` — and
  `allocateKey` **mutates `state` in place**, incrementing `next_number`
  (`state/keys.ts:27-30`). `saveState` is called once at the end, guarded by
  `if (mutated)`.

  The guard is correct for the case it was written for: if *every* ref is a
  same-project no-op (line 149-156, `continue` before `performMove`), nothing was
  allocated and nothing needs saving. But `mutated` is set at line 163, **after**
  `writeTask` and `appendHistory`. If `writeTask` throws for task 3 of 5, the
  `catch` records a failure and the loop continues — while `state` has already
  been incremented for task 3's allocated-but-unused key. Tasks 4 and 5 then
  allocate from the bumped counter, and the final `saveState` persists a counter
  that skips a number.

  A skipped key number is **harmless** — the counter is a high-water mark, keys
  need not be dense, and `retired_keys` semantics do not depend on density. I am
  not reporting a data-corruption bug.

  The real defect is the narrower window: if the **first** task's `writeTask`
  throws and every subsequent ref also fails, `mutated` stays `false`, `saveState`
  is skipped, and the in-memory increments are discarded — which is the *correct*
  outcome, reached by accident rather than by design. The two outcomes for the
  same class of failure differ only by whether a later task happened to succeed.
  `mutated` is tracking "did any write land", but it is being used to decide
  "was the counter touched", and those are not the same predicate. The counter
  was touched at line 54, before either.
- **Why it matters**: The single-task `moveTaskToProject` has no equivalent
  hazard — it saves state unconditionally after one write (line 111). The bulk
  variant's doc claims it is the *"bulk variant of moveTaskToProject"* with
  *"per-task failures captured rather than aborting"*, implying the same
  state-handling. It is not the same, and the difference is invisible at the call
  site. Anyone reasoning about key allocation from `moveTaskToProject` will get
  the bulk path wrong.

  Note this is **not** a P-9 violation. P-9 governs a *single* move being atomic
  — one `withStateLock`, one journal entry, one combined history entry — and
  the single-task path satisfies it. The bulk path holds one lock for the batch
  and writes per task, which is the documented and intended trade.
- **Blast radius**: `bulkMoveTasksToProject` is the CLI's `loctt move` with
  comma-separated refs and the web bulk-move route. The clean fix — set
  `mutated = true` immediately after `performMove` returns, or drop the flag and
  track allocation directly — is a **behaviour change to key allocation state**
  and escalates by rule despite being one line. It also warrants a test, and per
  the repo's rules that test must be shown to fail first, which requires
  injecting a `writeTask` failure mid-batch.
- **Size**: S
- **Auto-fixable**: no
- **Confidence**: medium — the mechanism is verified by reading; the judgement
  that the inconsistency is worth changing (rather than documenting) is a call
  for the triage pass, since neither outcome corrupts data.

---

### `readTask` has no error translation, so a missing task surfaces a raw ENOENT
- **File**: `packages/core/src/task/io.ts:16-22`
- **Category**: abstraction
- **What is wrong**: `readTask` calls `readFile` and lets the raw Node error
  propagate. Its own doc says *"Throws if the file doesn't exist or is
  malformed"* — accurate, but the two cases surface very differently:
  malformed content produces a `TaskParseError` with a formatted Zod message
  (`frontmatter.ts:91-101`), while a missing task produces
  `ENOENT: no such file or directory, open '.../tasks/<ulid>/task.md'`.

  The module has a sibling that does this properly: `lookup.ts` exports
  `TaskNotFoundError`, and every bulk path in this slice catches it specifically
  to produce the clean `"task not found"` string (`bulk.ts:98,154,201,278`,
  `move.ts:165`). Those paths get the good error only because they call
  `lookupTask` first. Paths that call `readTask` directly with an id do not:
  `setFieldLocked:198`, `unsetFieldLocked:342`, `setFieldsLocked:474`,
  `archiveTask:28`, `unarchiveTask:55`, `deleteTask:92`.

  In practice the surfaces resolve a ref through `lookupTask` before calling
  these, so the ENOENT is mostly unreachable from the CLI and MCP — which is why
  this is an abstraction finding rather than a bug. The exception worth noting is
  the TOCTOU gap: `lookupTask` succeeds, another process deletes the directory,
  `readTask` then throws ENOENT from inside a path whose callers are all written
  to expect `TaskNotFoundError`. `bulkSetFields` would report that task's failure
  as the raw ENOENT string rather than `"task not found"` — the one place the
  inconsistency reaches a user.
- **Why it matters**: The error taxonomy is otherwise carefully built —
  `TaskUpdateError`, `TaskLifecycleError`, `MoveTaskError`, `TaskParseError`,
  `TaskNotFoundError`, `KeyAllocationError`, `ArchivedReferenceError` — and every
  bulk caller in this slice branches on `err instanceof TaskNotFoundError`. One
  unconverted `readFile` puts a filesystem path into a user-facing string and
  makes that branch incomplete.
- **Blast radius**: Wrapping ENOENT in `TaskNotFoundError` changes an
  **error message and error type** on a core read path used by every write
  function in this slice — escalates by rule, and is genuinely riskier than it
  looks: any caller currently catching by `err.code === "ENOENT"` would break.
  Worth grepping for that pattern across all four packages before acting.
- **Size**: S
- **Auto-fixable**: no
- **Confidence**: medium

---

## Files with no findings

- **`lifecycle.ts`** — no findings of its own. Its three functions are small,
  each takes the state lock, each pairs the write with its history append inside
  the lock, and the comments explaining *why* the lock is held (concurrent
  `setField` clobbering, `writeTask` recreating an orphan directory mid-delete)
  are accurate against the code. It appears above only as the *other half* of
  the `bulkArchive` duplication finding and the `deleteTask` history comment
  note; neither is a defect in this file.

## Checked and deliberately not reported

Recorded so the next pass does not re-derive them.

- **`unsetField` runs neither `validateTaskAgainstWorkflow` nor the archived
  guard**, unlike `setField`. Correct: removing a value cannot introduce an
  invalid enum or a new archived reference. The asymmetry is sound.
- **`setFieldsLocked` exported for `bulkSetFields`** rather than `bulkSetFields`
  calling `setFields`. Deliberate, documented, and forced by `withStateLock`
  being non-re-entrant. The doc even names the three drifts that sharing fixed.
- **`bulkLink` is not atomic** while the other bulk ops are. Documented at
  length with the trade stated (`bulk.ts:226-239`); reimplementing `linkTask`'s
  cycle check inside a batch lock would duplicate the logic most likely to drift.
  Correct call.
- **`bulkDelete`'s `clearLookupCaches` is untestable today** — the comment says
  so outright (`bulk.ts:208-212`) and explains it is present for shape-parity if
  the cache ever gains a positive side. Not dead code; a deliberate consistency
  choice with its reasoning recorded.
- **`coerceFrontmatter` drops `null` for optional fields but keeps it for
  required ones** (`frontmatter.ts:62-88`). Looks arbitrary; is not. The comment
  explains it produces *"must be a string"* from Zod rather than the misleading
  *"field is required"*. Verified against `REQUIRED_FRONTMATTER_FIELDS`.
- **`writeTask` validates via `TaskFrontmatterSchema.parse` rather than a
  serialize/parse round-trip** (`io.ts:36-40`). The comment records this as a
  deliberate simplification. It does mean serialization itself is unvalidated —
  which is the gap the `serializeFrontmatter` finding above proposes covering
  with a test.
- **`appendTaskBody`'s four-branch spacing logic** (`io.ts:116-126`) looks like a
  candidate for simplification. It is the documented single source of truth for
  append spacing across CLI and MCP, and each branch produces a distinct result.
  Left alone.
- **`updateTaskBody` writing `body_edited` with full before/after bodies** is
  decisions.md **M3**, with the size cost explicitly accepted and snapshot
  capping explicitly *rejected*. Not a finding.
- **Stored enum values are config keys, never labels** — checked across every
  write path in the slice. `setField`, `setFieldsLocked`, and `createTask` all
  store the caller's value verbatim and validate it against
  `validateTaskAgainstWorkflow`, which matches on `key`. No path in this slice
  resolves or stores a display label. **No violation found.**
- **Crash-sentinel rules** — nothing in this slice reads or writes a sentinel.
  Out of scope for these eight files.
