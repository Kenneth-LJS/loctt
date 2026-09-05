# Corruption-handling framework — proposal (Phase 7, step 2)

> **Status: PROPOSAL, awaiting Ken.** Written 2026-09-05 from a review of
> the Phase-7 spike. Nothing here is built. It answers
> `corruption-framework-brief.md` § "What the proposal must define" and
> its two open questions, against north-star principles 5–7. Step 4 (the
> audit) measures against this document once approved.

Every claim below cites the code that was read. Where the spike is
called wrong, the line it is wrong at is named.

---

## 0. The spine, in one paragraph

Corruption is classified **once, in core, at parse time**, by the same
function every read goes through — `readTask` itself becomes the
tolerant primitive; there is no `Tolerant` sibling API. A parse yields a
`Task` whose `frontmatter` holds **only the fields that passed**, plus a
`health` list naming every field that did not, with its raw stored value
and the reason. The serializer re-emits those raw values verbatim unless
the caller overwrote or removed the field, so every write path inherits
preserve-others and override-on-direct-write without knowing corruption
exists. The one write-side guard is **"a write may shrink `health`,
never grow it"** — checked at the single `writeTask`/`stagedSwap` choke
point. Surfaces render `health`; they never re-derive it. Severity is a
two-value axis (object-fatal / field-local) plus one derived rule:
*an operation that must read a field to compute its write refuses when
that field is corrupt; one that only overwrites it proceeds.*

---

## 1. Review of the spike — what to keep, what to throw away

The spike proved the cell (`corruption-spike.test.ts`, 7 mutation-verified
tests; `server.corruption-spike.test.ts`, 2). Its findings are correct.
Its *shape* is mostly a dead end, and finding 1 understates why.

### 1.1 Finding 1 undercounts the problem by an order of magnitude

The findings say strict parsing is embedded at "(at least) four
independent points on ONE read path". Grepping the write side and the
other read callers:

- `readTask` is imported by `update.ts:19` (used at 407, 580, 761),
  `bulk.ts:13` (179), `relationships.ts:8` (246, 255, 331, 394, 423),
  `lifecycle.ts:8` (59, 84, 120), `load-all.ts:4` (100), `lookup.ts:15`
  (147, 190, 283, 315), `doctor.ts:19` (504), and via `loadAllTasks` by
  `key-index.ts:69`, `traversal.ts:22`, `progress.ts:115`, plus
  `publish-sync.ts`, `restore.ts`, `reconcile-plan.ts`, and the manage
  modules under `labels/`, `milestones/`, `projects/`, `sprints/`,
  `users/`. `load-all.ts:88` itself says `loadAllTasks` has "48 callers".
- On the **write** side the same strict schema is applied again at
  `io.ts:61` (`writeTask`), `bulk.ts:128` (`bulkSetFields` before
  `stagedSwap`) and `bulk.ts:194` (`bulkArchive`).

So the count is not four; it is every reader and every writer. That
settles the central design question by elimination: **a parallel
`*Tolerant` API cannot be the framework**, because it asks each of ~50
call sites to choose, and the default stays strict. The spike's
`readTaskTolerant` / `writeTaskTolerant` / `lookupTaskTolerant`
(`io.ts:37`, `io.ts:81`, `lookup.ts:390`) are therefore **dead ends** —
useful as proof, to be deleted, not extended.

### 1.2 Dead ends (throw away)

| Spike element | Where | Why it does not generalize |
|---|---|---|
| The `*Tolerant` sibling functions | `io.ts:37,81`, `lookup.ts:390` | § 1.1. Two APIs = every caller picks; the strict one remains the default and finding 2 recurs at every unconverted site. |
| `SPIKE_DEGRADABLE_FIELDS = { due_date }` whitelist | `frontmatter.ts:137` | A whitelist of *fields* is the wrong axis. The framework needs a rule that classifies by *role* (does an operation need this field to address or compute?), § 3. A per-field list also has to be maintained as the schema grows, and the schema is already the authority for field lists everywhere else (`frontmatter.ts:16`, `task.ts:218`, `task.ts:243`). |
| Keeping the raw corrupt value **inside** `frontmatter` under its typed key | `frontmatter.ts:210` (`frontmatter[field] = raw_`) | `frontmatter.due_date` is typed `string` and holds `42`. Every consumer downstream — sort comparators, date formatting, the DSL evaluator, `datesInverted` in `MetaPanel.tsx:272` — now receives a typed lie. It is also what forced the projection-stripping hack at `server.ts:3601-3607`. The healthy object must contain only healthy values. |
| Projection-stripping in the route | `server.ts:3595-3607` | A symptom of the row above. Once corrupt values are not in `frontmatter`, `projectTaskFrontmatter` (`task.ts:205`) receives a clean object and needs no special-casing. |
| The strict-then-fallback double lookup in `handleGetTask` | `server.ts:3561-3580` | Two reads per corrupt task, and a fallback whose *only* reason to exist is that the primary path throws. Finding 4 (error-quality collapse) was a bug *in the fallback*; with one path there is nothing to collapse. |
| `resolveRefToId` as a corruption workaround | `lookup.ts:400` | Exists only because `rebuildKeyIndex → loadAllTasks → readTask` drops corrupt tasks (finding 2). With a tolerant `readTask`, the index folds them and `lookupTask` works unchanged. The by-id-only demonstration in the web test (`server.corruption-spike.test.ts:40-44`) is the spike admitting this. |
| `corruptions` name and `{ field, raw, error }` as the *whole* record | `task.ts:125` | Missing `kind` (so surfaces cannot tell wrong-typed from unrecognised — the brief's § 4 needs exactly that distinction to pick the X's behaviour) and missing a one-string display form (so three surfaces would each stringify `raw` differently — a parity leak). Extend, § 5. |

### 1.3 Seeds (keep)

| Spike element | Where | Why it is right |
|---|---|---|
| Strict `safeParse` first; degrade only on failure | `frontmatter.ts:168-171` | The clean path pays nothing. Keep verbatim. |
| Lift-out → reparse → verify the remainder parses, else fail closed | `frontmatter.ts:190-204` | This *is* the object-fatal / field-local decision procedure: whatever can be lifted out and still leave a valid object is field-local; if lifting does not help, the object is fatal. Generalize it from "issues on whitelisted fields" to "issues on non-identity fields" (§ 3). |
| "Every issue must be degradable or the whole parse fails" | `frontmatter.ts:183-185`, test at `corruption-spike.test.ts:126` | Correct as a *fail-closed* posture; the *membership* changes, the guard stays. |
| Recording the raw value so a write round-trips it | `corruption-spike.test.ts:77-98` | Preserve-others is the north star's central requirement (principle 7). Only the *location* of the raw value moves (§ 4.2). |
| Override-on-direct-write clears the corruption | `corruption-spike.test.ts:100-115` | Exactly principle 7's "a validated incoming write to the corrupted field itself overrides it". Keep; add provenance (§ 9). |
| Modelling on `BrokenSavedQuery` (VUE-22, A118) — a sibling collection, never serialized back as-is, omitted when empty | `queries.ts:38-98`, `query.ts:89-108` | The right precedent, and the framework should say so: `health` is to `Task` what `broken` is to `QueriesConfig`. A118's reasoning ("no runnable-path consumer can accidentally execute a broken query") is why corrupt values must not sit in `frontmatter`. |
| Preserving the well-attributed `UnreadableTaskError` for object-fatal | finding 4; `lookup.ts:58-140` | Non-negotiable. With one read path it is preserved by construction: `readTask` throws `TaskParseError` only for object-fatal, and `lookupById`/`lookupByKey` attribute it exactly as today (`lookup.ts:152-154`, `286-295`). |

### 1.4 What the spike could not see

- **The index is the tip.** Finding 2 is about `rebuildKeyIndex`. The
  same strictness in `foldUnknownTasks → readKeyHeader` (`lookup.ts:181-207`)
  means a corrupt task also cannot be *folded* on a cache miss, so its
  key resolves only after a full rebuild — and then not even. Both fall
  out once `readTask` is tolerant.
- **Write paths re-validate strictly and would refuse the preserved
  file.** `writeTask` at `io.ts:61` parses the in-memory frontmatter,
  and `bulk.ts:128/194` do the same. The spike worked around this with
  `writeTaskTolerant`; the framework has to replace the guard at those
  three points with one that is *safer than strict*, not looser (§ 4.4).
- **The same defect already exists for a sibling store.** `known-gaps.md`
  § "A UI view write drops a concurrently-present *broken* view from
  queries.yaml": `saveQueriesConfig` serializes `queries` only
  (`queries.ts:126-140`), so a write over a file holding a `broken` entry
  drops it. That is the preserve-others failure in another object, and
  the write-guard in § 4.4 is its fix too. The framework is not
  task-only; tasks are simply the first object.

---

## 2. Taxonomy

Named by **what a reader or writer can do about it**, not by cause.
Two levels: object-level (the record cannot be constituted) and
field-level (the record exists; one path in it is unusable).

### 2.1 Object-level kinds (always object-fatal)

| Kind | Definition | Where it is detected today |
|---|---|---|
| `unparseable` | The file has no `---` frontmatter block, or the YAML does not parse. | `splitTaskFile` (`frontmatter.ts:33-39`), `parseYaml` wrapped at `frontmatter.ts:108-112`. |
| `no_identity` | `id` or `key` is absent, `null`, or not a non-empty string. | Zod issues on `id`/`key` (`task.ts:51-52`); `coerceFrontmatter` keeps a `null` for required fields so the issue surfaces (`frontmatter.ts:71-76`). |

*Deliberately object-fatal for step 1, to be revisited (§ 3.3, and "Needs
Ken" § 12):* a wrong-typed or missing `title`, `created_at`,
`updated_at`. These are in `REQUIRED_FRONTMATTER_FIELDS`
(`frontmatter.ts:47-53`) and the spike treats them as fatal
(`corruption-spike.test.ts:117-124`).

### 2.2 Field-level kinds

| Kind | Definition | Needs config? | Example | Repair surface |
|---|---|---|---|---|
| `wrong_type` | A schema-known field whose stored value fails its Zod type/format. | No (intrinsic) | `due_date: 42`; `labels: "urgent"`; `relationships: {a: b}`; `archived: "yes"` | **Set-over** (validated write replaces) or **remove** (→ field absent). The UI X reverts to the field's proper entry mode (brief § 4). |
| `missing_required` | A required field absent/null. | No | `title: ~` | Set-over only (there is nothing to remove). *Step 1: object-fatal; see § 3.3.* |
| `unrecognised` | A top-level frontmatter key the schema does not declare. Preserved today by `.passthrough()` (`task.ts:101-105`) and re-emitted last by `serializeFrontmatter` (`frontmatter.ts:277-281`). | No | `estimate_points: 3`, `jira_id: ABC-1` | **Remove** only. The UI X removes it (brief § 4). Not settable — LocTT has no type for it. |
| `invalid_value` | A known field with the right type whose value the workflow does not define, or a custom field whose value fails its declared type, or an undeclared custom-field key under `fields:`. | Yes (workflow.yaml) | `status: in_review` after the status was deleted; `fields.points: "many"` for a number field; `fields.foo` with no `foo` declared | Set-over (pick a valid value) or remove. This is what `doctor` calls "workflow drift" (`doctor.ts:349-388`) and what `validateTaskAgainstWorkflow` reports (`validation.ts:46-65`, `133-140`). |
| `dangling` | A reference whose target does not exist: `project`, `milestone`, `sprint`, `labels[i]`, `assignee`, `reporter`, `relationships[i].target`. | Yes (aux configs, users, other tasks) | K21's out-of-band deleted user; `show.ts:164` `missing: true` | Set-over or remove. Removing a dangling *relationship edge* is allowed and goes through `unlinkTask` so the inverse is kept consistent (P-12) — but see § 7.3. |

### 2.3 Not corruption (explicitly excluded from the channel)

- **Optional field absent** (brief's "optional simply unspecified"),
  including YAML `~` on an optional field, which `coerceFrontmatter`
  drops (`frontmatter.ts:71-75`). Normal.
- **Body content.** Free markdown by design; `lossyConstructs`
  (`server.ts:3628`) is an editor concern, not corruption.
- **Sibling stores** — `_history.yaml`, `_comments.yaml`,
  `attachments/`. Already covered by P-11 (keep-and-merge, `history.ts:109`,
  `integrity.ts`) and REL-49 (`attachmentsError`, `server.ts:3620-3625`).
  The audit lists them as rows so their existing handling is *measured*,
  but they do not join the task field-health channel.
- **Config files** (`workflow.yaml` etc.). V9: a definition other data
  references is refused, never worked around (`integrity.ts` header;
  `invariants.md` P-11 row). Out of scope.
- **Identity/directory mismatch** (`frontmatter.id` ≠ directory name).
  Nothing checks it today (`lookupById` at `lookup.ts:145` reads by
  directory and never compares). Not classified here; listed as an audit
  cell to *discover* the behaviour, not a kind to assert.

### 2.4 Completeness argument

Any frontmatter value is either parseable or not (→ `unparseable`). If
parseable, each key is either known or not (→ `unrecognised`). A known
key's value either satisfies the schema or not (→ `wrong_type`, or
`missing_required` when the schema demands presence and it is absent).
A schema-valid value either makes sense against config or not (→
`invalid_value`) and either resolves or not (→ `dangling`). The two
object kinds are the cases where there is no record to attach a field
finding to. There is no fifth outcome for a scalar; for arrays/maps the
finding attaches to the element path (`labels[2]`, `fields.points`,
`relationships[1].target`), the same forms `validateTaskAgainstWorkflow`
already emits.

---

## 3. Severity — object-fatal vs field-local, and the derived operation rule

### 3.1 The rule

**A finding is object-fatal iff removing the offending field(s) does not
leave a record that can be addressed** — i.e. the file is `unparseable`
or `id`/`key` is bad. **Everything else is field-local.** This is the
spike's lift-out-and-reparse procedure (`frontmatter.ts:190-204`) with
the whitelist replaced by "anything except identity".

Operationally: `safeParse` the whole object; collect the set F of
top-level keys with issues; if F ∩ {id, key} ≠ ∅ → fatal; else lift F
out, reparse; if the remainder fails → fatal (fail closed, as the spike
does); else field-local with F as findings.

### 3.2 The derived operation rule (principle 7, made mechanical)

Field-local does not mean every operation proceeds. Principle 7: *do the
operation if it is still safe; if the thing the operation needs is
structurally broken, stop and warn.* Made mechanical:

> An operation declares the fields it must **read** to compute its
> result. If any declared field is in `health`, the operation refuses
> with a `CorruptFieldError` naming the field and its finding. A field
> the operation only **writes** is never a reason to refuse — writing it
> is the repair.

Concretely, from the code:

| Operation | Must read | Refuses when corrupt | Proceeds (and repairs) when corrupt |
|---|---|---|---|
| `setField(f)` (`update.ts:385`) | `id`, and for `f = status` the *old* `status` (`update.ts:437` `isCompletedStatus`) | — (a corrupt old `status` is treated as "not completed"; the write sets `status`, which is the repair) | `f` itself |
| `setField("labels")` with add/remove semantics | `labels` | `labels` wrong-typed (cannot merge into a non-array) | `labels` when the write is a full replacement |
| `unsetField(f)` (`update.ts:549`) | nothing | — | any `f` in `health` (this is the X) |
| `linkTask` / `unlinkTask` / reorder (`relationships.ts`) | `relationships` on source *and* target | `relationships` wrong-typed on either side (principle 7's own example) | — |
| archive / unarchive (`lifecycle.ts`) | `archived` for the no-op check (`bulk.ts:180`) | — (treat corrupt `archived` as "not in target state"; the write sets it) | `archived`, `archived_at` |
| `moveTask` (project) | `key`, `key_history` | `key_history` wrong-typed (it appends to it) | — |
| body write / append (`io.ts:116`) | `updated_at` for the stale-token check | — (see § 3.4) | `updated_at` |
| board/rank reorder | `board_rank` of siblings | — (corrupt rank sorts as "unranked", which is the documented behaviour for *missing* rank, `task.ts:87-89`) | `board_rank` of the moved card |
| `bulkSetFields` (`bulk.ts:66`) | per task, as `setField` | per task, reported in `failed` — principle 6's independent-items rule | per task |
| `bulkDelete` | `id` | — | n/a (removes the file; no field is interpreted) |
| `duplicateTask` | every field it copies | — | it must **not** copy raw corrupt values into the new task: copy `frontmatter` (healthy) only, and record the dropped fields in the result |
| list / query / sort | the sorted/filtered field | — (a corrupt value is treated as absent for filter/sort, and the row is still returned with its `health`) | — |

The audit (§ 11) turns this table into the columns of its matrix.

### 3.3 Why `title`/`created_at`/`updated_at` stay object-fatal in step 1

By § 3.1's rule they are field-local: a task without a title is still
addressable. Two costs argue for deferring:

1. `TaskFrontmatter.title: string` (`task.ts:54`) and the two timestamps
   are relied on as present by every list row, sort, export and the
   public projection (`task.ts:170-171`, `.strict()`). Making them
   optional in the contract ripples into every consumer at once.
2. A hand-edit that deletes `title` or breaks a system-written ISO
   timestamp is an order of magnitude rarer than a bad date or enum.

The spike already assumes the same boundary (`frontmatter.ts:130`). The
proposal keeps it for step 1 and puts the shrink to `{id, key}` in front
of Ken (§ 12) as a scope call, since it narrows principle 5 for three
fields.

### 3.4 System-managed fields

`updated_at` is rewritten by every write (`update.ts:431`, `io.ts:140`),
`status_updated_at`/`completed_date` by status changes, `archived_at` by
archive. If one of these is field-locally corrupt (step 2 only, given §
3.3), the write that would set it anyway sets it. This is not
corruption-specific behaviour and not a silent rewrite of something
"aimed elsewhere" — the field *is* the write's own. It is recorded in
history like any other repair (§ 9).

---

## 4. The single load/save abstraction

### 4.1 Where it lives

**No new module for the primitive.** The abstraction is the two files
that already are the primitive — `packages/core/src/task/frontmatter.ts`
(parse/classify/serialize) and `packages/core/src/task/io.ts`
(`readTask`/`writeTask`) — with the spike's duplicates folded into the
originals and deleted. One new small module,
`packages/core/src/task/health.ts`, holds the *extrinsic* classifier
(kinds that need config) and the `CorruptFieldError`.

Rationale: every one of the ~50 call sites in § 1.1 already imports
these names. Changing what the names return converts all of them at
once; adding a new name converts none.

### 4.2 The shapes

```ts
// packages/contracts/src/task.ts — replaces FieldCorruption
export type FieldHealthKind =
  | "wrong_type" | "missing_required" | "unrecognised"   // intrinsic
  | "invalid_value" | "dangling";                         // extrinsic

export interface FieldHealth {
  /** Path as the validator reports it: "due_date", "labels[2]", "fields.points", "relationships[1].target". */
  readonly field: string;
  readonly kind: FieldHealthKind;
  /** The stored value, JSON-safe (YAML Dates are already ISO strings via coerceFrontmatter). */
  readonly raw: unknown;
  /** One-line YAML rendering of `raw`, computed in core so all three surfaces print the same string. */
  readonly rawText: string;
  /** The validator's message — what was expected. */
  readonly error: string;
  /** What the user may do: set a valid value, remove the field, or both. */
  readonly repair: "set" | "remove" | "set_or_remove";
}

export interface Task {
  readonly frontmatter: TaskFrontmatter;   // HEALTHY fields only
  readonly body: string;
  /** Omitted (not []) when clean — same convention as QueriesConfig.broken. */
  readonly health?: readonly FieldHealth[];
}
```

`rawText` is the parity guard: `loctt show`, `get_task` and the UI all
print `rawText`; none of them stringify `raw` themselves.

### 4.3 Parse

`parseFrontmatter(rawYaml): { frontmatter, health }` — the spike's
`parseFrontmatterTolerant` algorithm (`frontmatter.ts:155-223`) becomes
`parseFrontmatter`, with three changes:

1. Degradable set = all top-level keys except `id`, `key` (and, step 1,
   the three fields in § 3.3) — not a whitelist.
2. The raw value goes into `health[i].raw`, **not** back into
   `frontmatter` (`frontmatter.ts:210` is the line that goes).
3. Unrecognised keys are moved from `frontmatter` (where `.passthrough()`
   put them) into `health` with `kind: "unrecognised"`, so `frontmatter`
   contains exactly the schema's keys. `KNOWN_FRONTMATTER_KEYS`
   (`frontmatter.ts:16`) already exists to make that split.

Object-fatal still throws `TaskParseError`, unchanged, so `lookup.ts`'s
attribution to `UnreadableTaskError` (`lookup.ts:152`, `286`, `317`,
`341`) and `loadAllTasksDetailed.unreadable` (`load-all.ts:100-107`)
keep working with no edits. Finding 4 is satisfied by not having a
fallback.

### 4.4 Serialize and the one write guard

`serializeFrontmatter(fm, health?)` (`frontmatter.ts:235`) gains the
second argument: after the known fields, emit each `health` entry's
`raw` under its `field` **unless `fm` now has that key** (override wins)
— known fields at their canonical slot, unrecognised ones last, exactly
where the passthrough loop puts them today (`frontmatter.ts:277-281`).
`assembleTaskFile(task)` passes both.

`writeTask` (`io.ts:56`) replaces `TaskFrontmatterSchema.parse(task.frontmatter)`
at `io.ts:61` with:

```ts
assertWriteSafe(before: Task | undefined, after: Task): void
```

which serializes `after`, re-parses it through `parseFrontmatter`
(object-fatal → refuse, as today), and then enforces **the monotonic
rule**: `health(after) ⊆ health(before)` by `(field, kind)`. A write
may repair findings; it may never introduce one or change one's kind.
This is `attributableErrors`' TSK-29 principle (`update.ts:250-269`:
"only what this write is answerable for") applied to shape rather than
to workflow values. `bulk.ts:128` and `bulk.ts:194` call the same
function before `stagedSwap`.

Why this is *safer* than the strict guard it replaces, not looser: strict
refused every write to a corrupt task, which is how the spike's "set
status on a task with a bad due_date" failed. Monotonic refuses exactly
the writes principle 1 cares about — the ones that make corruption worse
— and permits the ones principle 7 requires.

Value-preservation caveat, stated honestly: the serializer is
`stringifyYaml` (`frontmatter.ts:283`), so the round-trip is
YAML-equivalent, not byte-identical (`due_date: "42"` may come back as
`due_date: '42'`). That is already true of every field on every write
today; the spike's byte assertion (`corruption-spike.test.ts:97`) passes
because a bare number has one canonical form. The framework promises
*value* preservation. Byte preservation would need a CST-preserving
edit (the `yaml` package's `Document` API) and is out of scope.

### 4.5 How the four named strict sites (and the rest) route

| Site | Today | After |
|---|---|---|
| `readTask` (`io.ts:17`) | strict `parseFrontmatter`; throws on any issue | same call, now returns `{frontmatter, health}`; throws only object-fatal. **Every caller in § 1.1 converts by recompiling.** |
| `rebuildKeyIndex → loadAllTasks` (`key-index.ts:69`, `load-all.ts:100`) | corrupt task dropped → key 404s (finding 2) | folds `key`/`key_history` from a healthy identity; `unreadable` shrinks to object-fatal only. `foldUnknownTasks/readKeyHeader` (`lookup.ts:181`) likewise. |
| `projectTaskFrontmatter` (`task.ts:205`) | re-parses; throws on raw corrupt value (finding 3) | receives healthy-only `frontmatter`; unchanged code, no stripping. **Decision (finding 3):** corrupt fields are surfaced *only* through `health`, never as a frontmatter value. `TaskResponse.corruptions` (`service.ts:187`) becomes `health: FieldHealth[]` (with `raw` omitted from the wire — `rawText` suffices; `raw` can be an arbitrary object and the client never needs it). |
| `bodyToken` (`io.ts:204`) and `updateTaskBody` (`io.ts:126`) | spike-patched / strict | use `readTask` (or the same `parseFrontmatter`); tolerant by construction. |
| `writeTask` (`io.ts:61`), `bulk.ts:128`, `bulk.ts:194` | strict schema parse in memory | `assertWriteSafe` (§ 4.4). |
| `handleGetTask` (`server.ts:3552-3651`) | strict → catch → tolerant → strip | one `lookupTask`; response carries `health` when present. The whole SPIKE block deletes. |
| `readTaskTolerant`, `writeTaskTolerant`, `lookupTaskTolerant`, `resolveRefToId`, `SPIKE_DEGRADABLE_FIELDS`, `parseFrontmatterTolerant` | exist | **deleted.** Their tests fold into `frontmatter.test.ts` / `io.test.ts` / `lookup.test.ts` with the same assertions against the renamed primitives. |

### 4.6 Extrinsic classification (`health.ts`)

`classifyTaskHealth(task, workflow, aux, resolvers): FieldHealth[]`
appends `invalid_value` and `dangling` findings. It is a thin adapter
over what exists: `validateTaskAgainstWorkflow` (`validation.ts:33`) for
enum drift, custom-field type/declaration and project/milestone/sprint/
label existence; `resolveRelationships`' `missing` (`show.ts:121-166`)
for edges; the user-existence check PRU-25 built (A123) for
assignee/reporter. Kind mapping: `status|priority|task_type|
relationships[i].type|fields.*` errors → `invalid_value`;
`project|milestone|sprint|labels[i]|assignee|reporter|
relationships[i].target` → `dangling`. This runs where those configs
are already loaded — `buildShowModel` for detail, the list route's
`loadOptionalConfigs`, `doctor` — and its result is concatenated onto
the intrinsic `health` so a surface reads one list. It is **not** run
inside `readTask` (no config there) and **not** required for the write
guard (which is intrinsic-only; workflow validity is already
`attributableErrors`' job).

---

## 5. Cross-surface consistency

The classification is `Task.health`, produced by core (`parseFrontmatter`
+ `classifyTaskHealth`). Surfaces:

- **never** call Zod on a task,
- **never** stringify `raw`,
- **never** decide repairability (`FieldHealth.repair` says).

The repair actions are the existing core ops — `setField` for set-over,
`unsetField` for remove — extended so that `unsetField` consults `health`
(today an unrecognised top-level key falls into the custom-field branch
and throws `custom field "x" is not set`, `update.ts:593-595`). Parity
follows: CLI `loctt set` / `loctt unset`, MCP `set_field` / `unset_field`,
web `POST …/set` / `POST …/unset` (`server.ts:3937`, `4019`) all already
exist and gain the capability at once. **No new surface command is
needed for repair.**

---

## 6. Behaviour per kind × per surface

Legend: *carries* = includes `health` in output; *marks* = renders the
field as degraded with `rawText` and `error`.

| Kind | Core | CLI | MCP | Web API + UI |
|---|---|---|---|---|
| `unparseable` / `no_identity` (object-fatal) | `readTask` throws `TaskParseError`; lookup attributes as `UnreadableTaskError` (path, line, `recovery: none`); `loadAllTasksDetailed.unreadable` lists it. **Unchanged.** | `show`: the `UnreadableTaskError` message (TSK-54). `list`: rows + an "N files could not be read: <path>: <reason>" trailer. **Unchanged.** | `get_task`: error envelope as today. `list_tasks`: `unreadable[]`. **Unchanged.** | Detail: error page naming the path (exists). List: `unreadable` banner (exists). **Unchanged.** |
| `wrong_type` | Field absent from `frontmatter`; `health` entry `repair: set_or_remove`. Write guard: preserved unless overwritten/removed. Ops that must read it refuse (§ 3.2). | `show`: `⚠ due_date: 42 — must be YYYY-MM-DD or ISO (corrupt; set a value or unset to remove)`. `list`: the cell shows `rawText` with a marker; `--json` carries `health`. `set` repairs; `unset` removes. | `get_task`/`list_tasks` carry `health`. Tool descriptions say: *a field listed in `health` is not in the main object; its stored value is `rawText`; `set_field` replaces it, `unset_field` removes it.* | API: `TaskResponse.health`, list rows carry `health`. UI: § 8 state machine — string + X; **X reverts to the field's proper entry mode**. |
| `unrecognised` | In `health` with `repair: remove`. Preserved on every write (today's passthrough behaviour, now visible). | `show`: listed under a "Not recognised" group with `rawText`. `unset <key>` removes. | Carried. `unset_field` removes. `set_field` on an unrecognised key is refused ("LocTT has no type for `<key>`; unset it or edit the file"). | UI: read-only string row in a "Not recognised" group; **X removes** (brief § 4). No entry mode exists to revert to. |
| `missing_required` | Step 1: object-fatal (§ 3.3). Step 2: `repair: set`. | (step 2) `show` marks "(no title)". | (step 2) carried. | (step 2) string "(missing)" + X opens entry mode. |
| `invalid_value` | Extrinsic; in `health` where configs are loaded. Never refuses a write to *another* field (`attributableErrors`, `update.ts:250`). `set` to a valid value repairs; `unset` removes. | `show`: `⚠ status: in_review — unknown status; valid: todo, doing, done`. `doctor`: "workflow drift" (exists, `doctor.ts:380-388`). | Carried. | UI: the existing GIT-14 "drift" marker form (A122) — raw key with `⚠`; the picker offers valid options only; X clears. |
| `dangling` | Extrinsic. Relationship edges keep `missing: true` (shipped, `show.ts:164`) **and** appear in `health` as `relationships[i].target`. User refs: K22's truncated-ULID form (A123). | `show`: as today for relationships; user/milestone/sprint/project marked with the 6-char tail. `doctor`: "task references" (exists, `doctor.ts:389-394`). | Carried. | UI: existing `(deleted user)`/`missing` renderings; X on a dangling relationship = `unlinkTask` (keeps the inverse consistent, P-12); X on a dangling scalar = `unsetField`. |
| Operation refused (§ 3.2) | `CorruptFieldError extends LocttError`, code `validation_failed` (existing `ErrorCode`, `service.ts:580`), `data_state: "not_saved"`, `field` set, message names the field, its `rawText` and the two repairs. | Printed via `runtime/errors.ts` like any `LocttError`. | Error envelope. | `FieldFailureNotice` (`task/FieldFailureNotice.tsx`) under the *corrupt* field, not the one the user edited — the envelope's `field` is the corrupt one, same fix TSK-29 made for drift. |

Bulk (`bulkSetFields`, `bulkArchive`, `bulkLink`, `bulkDelete`): per task,
the row above applies; a refused task lands in `failed` with the
`CorruptFieldError` message, the rest proceed (principle 6, independent
items; `bulk.ts:114-120`). A task whose file is object-fatal lands in
`failed` as "could not be read: <path>" — today it says `task not found`
if the key was never indexed, which the audit will confirm as a defect
(this is known-gaps § "An unreadable task.md reports as task not found",
measured at the bulk entry).

---

## 7. The repair surface

### 7.1 Set-over

`setField(field, value)` on a field in `health`: value validated as for
any write (`update.ts:412-478`); `frontmatter[field] = value`; the
serializer sees the key present and does not re-emit `raw`; on reload
the finding is gone. This is the spike's test at
`corruption-spike.test.ts:100-115`, unchanged in behaviour.

### 7.2 Remove

`unsetField(field)` on a field in `health` (any kind): drop the `health`
entry (and, for `invalid_value`/`dangling` where the value *is* in
`frontmatter`, delete the key as today). `assertUnsettable`
(`update.ts:563`) still refuses required/auto-managed names, so the X is
never offered for `id`/`key`/`title`/`updated_at`/`completed_date`.

### 7.3 Which kinds are removable vs fixable-only

| Kind | Set | Remove | Note |
|---|---|---|---|
| `wrong_type` | yes | yes | |
| `unrecognised` | **no** | yes | No type to validate against. |
| `missing_required` | yes | **no** | Nothing to remove. |
| `invalid_value` | yes | yes | |
| `dangling` scalar (`project`, `assignee`…) | yes | yes | |
| `dangling` relationship edge | yes (re-target = unlink + link) | yes, via `unlinkTask` | Never by editing the array directly — the inverse on the target must go too (P-12). If the *target* file is object-fatal, unlink still succeeds on the source and reports that the inverse could not be removed (principle 7: do what is safe, report the rest). |

### 7.4 No confirm dialog on the X

`unset` has none today, and the removed value is recoverable from history
(§ 9 records `before`). Consistent with K15/K17's safe-default posture
because the default *is* safe (nothing is lost).

---

## 8. Field-level UI meta — the per-field state machine

Driven entirely by `FieldHealth.kind` and `repair`. Lives in
`MetaPanel.tsx`'s `Row`, which already takes an `error` prop and wraps
each editor (`MetaPanel.tsx:278-285`).

```
states:  healthy | corrupt_string | entering | removed

healthy ──(health has this field)──▶ corrupt_string
corrupt_string: shows label, rawText (monospace), error text, ⚠, and one X
   X when repair ∈ {set, set_or_remove}  ──▶ entering   (editor mounts empty, focused; Esc ──▶ corrupt_string)
   X when repair = remove                ──▶ removed    (POST …/unset; row disappears on refetch)
entering ──(commit; POST …/set OK)──▶ healthy
entering ──(commit; envelope validation_failed)──▶ entering + FieldFailureNotice
```

- **Wrong-typed known field → X reverts to entry mode** (brief § 4).
  "Entry mode" is the field's normal editor from `task/editors/`
  (`DateField`, `OptionPicker`, `LabelsField`, `TextField`,
  `customFieldRows`) with no initial value. The user can then also use
  that editor's existing clear control (`onClear` → `onUnset`,
  `MetaPanel.tsx:284`) if what they actually want is removal — so
  "remove" is one extra click, never hidden.
- **Unrecognised → X removes** (brief § 4). Rendered in a separate
  "Not recognised" group below the known rows, read-only string only.
- Client rule: **a field in `health` is rendered from `health`, never
  from `frontmatter`** (it is absent there). The list view applies the
  same rule per cell.

Data the API must carry (already decided § 4.5): `TaskResponse.health:
{ field, kind, rawText, error, repair }[]`, omitted when clean; list rows
carry the same per task. Nothing else — the client needs no `raw`, no
schema knowledge, and no per-field-type logic beyond "which editor
mounts for this field", which it already has.

---

## 9. Open question (b): repair provenance — DECIDED

**An ordinary history entry, not a new kind, with the corruption
recorded on it.** A set-over emits the `field_change` /
`custom_field_change` that `buildSetFieldHistory` (`update.ts:496-539`)
already produces, with `before` = the raw stored value (not `null`) and
`meta.was_corrupt = { kind, error }`. A removal emits the same entry with
`after: null`. For an unrecognised key, `field` is the key and `kind` is
`field_change` (the key is top-level, not under `fields:`).

Rationale, one line each:

- *Never silently change data* is satisfied by `before` carrying the
  exact stored value and `meta` saying it was corrupt: the change is
  auditable and reversible, which is what "not silent" means in this
  repo (M3, `history.ts` comment at `io.ts:144-149`).
- From the user's point of view it *is* a field change; a distinct kind
  forces every switch on `kind` (`loctt log`, the activity UI, the
  merge's field-history reader in M2) to grow a case for a rare event.
- `HISTORY_KINDS` is documented as "the complete set" (`history.ts:15-19`)
  and the `merge_resolved` precedent shows the cost of adding one late.
- `meta` is the existing extension point (`history.ts:40`, `meta`
  "carries kind-specific extras").

The spike's override-on-direct-write currently records `before: null`
for a lifted field (because the field was not in `frontmatter` as a
typed value, `readField` returns `undefined`, `update.ts:536-538`). That
**is** the silent case the brief worries about, and it is fixed by
having `buildSetFieldHistory` consult `health` for `before`.

To revert to a distinct kind later: add `"corruption_repaired"` to
`HISTORY_KINDS`, emit it instead, and teach the three readers. Nothing
in the data model prevents it.

---

## 10. Open question (a): detection point — DECIDED

**Both, with different jobs, and nothing else.**

1. **Lazy at read is the classification.** It is the only point every
   surface passes through, it costs nothing on a clean task (§ 1.3), and
   it is the only classification that can be *authoritative* for the
   write guard — a scan result can be stale by the time a write arrives.
2. **`doctor` is the enumeration.** `checkDataIntegrity` (`integrity.ts`)
   gains a task-frontmatter pass: for each task, `readTask` → each
   `health` entry becomes a finding with severity `malformed` (reported,
   never blocking a publish — the data is preserved, exactly the
   `malformed` definition in the `integrity.ts` header); object-fatal
   stays `unreadable` (blocks publish, as today). Extrinsic kinds join
   the existing "workflow drift" / "task references" checks
   (`doctor.ts:380-394`), which already do this enumeration for two
   kinds — the framework unifies their output shape, it does not add a
   scan.

Explicitly **not**: no auto-repair on read, no write-time "fixup" of
untouched fields, no background scan, no "repair all" command. Each is
a smart behaviour with no standing licence (principle 2, K19), and the
first two would violate principle 7's "never silently rewritten by an
operation aimed elsewhere".

Sync pre-flight consequence: field-local corruption does **not** block
publish (it is `malformed`, preserved); this matches the shipped
`integrity.ts` severities and needs no change.

---

## 11. Step 4 — the audit plan

The audit measures shipped code against §§ 3, 6, 7 and records every
cell as **handled / defect / unspecified**.

### 11.1 Rows: every operation that reads or writes a task

Enumerated from core's exports (`packages/core/src/task/index.ts` and the
modules in § 1.1), not from memory. Groups:

- *Single-task writes*: `setField`, `setFields`, `unsetField`, archive /
  unarchive / delete (`lifecycle.ts`), `linkTask` / `unlinkTask` /
  reorder (`relationships.ts`), `moveTask`, `duplicateTask`,
  `writeTaskBody` / `appendTaskBody`, attachment add/remove, comment
  add/edit/delete, board-rank move.
- *Bulk writes*: `bulkSetFields`, `bulkArchive`, `bulkLink`, `bulkDelete`
  (`bulk.ts`).
- *Entity-driven rewrites of many tasks*: label/milestone/sprint/project
  manage and rename, prefix rename (`projects/prefix.ts`), user delete
  with `--remap-to`/`--unassign` (`users/lifecycle.ts`), BAK restore
  (`backup/restore.ts`).
- *Reads*: `lookupTask` by key / by id, `loadAllTasks[Detailed]`,
  `rebuildKeyIndex`, list/query/sort/filter, `buildShowModel`, export,
  `computeProgress`, burndown, counts, `bodyToken`.
- *Git*: publish, sync/pull merge (`publish-sync.ts`), reconcile plan /
  apply (`reconcile-plan.ts:351` reads task files at two commits).

### 11.2 Columns: kinds × representative fields

`unparseable`; `no_identity`; `wrong_type` on each *shape class* — date
scalar (`due_date`), enum scalar (`priority`), boolean (`archived`),
string array (`labels`), object array (`relationships`), map (`fields`),
rank (`board_rank`), `key_history`; `unrecognised`; `invalid_value`
(`status`, `fields.<declared>`, `fields.<undeclared>`); `dangling`
(`project`, `assignee`, `relationships[i].target`, and *target file
object-fatal*). Plus the identity/directory-mismatch probe (§ 2.3).

### 11.3 Method: one fixture, one table-driven test, one verdict rule

- `seedCorruptTask(locttDir, kind, field)` in a shared test helper writes
  the file by hand — the way the real world reaches the state (K21's
  reasoning: "the test seeds the dangling state by hand-editing").
- For each (row, column): run the op; then assert **exactly one** of:
  - **handled** — op completes; reloaded `health(after) ⊆ health(before)`;
    every untouched `raw` is value-identical on disk; the op's own
    history entry exists; or the op refuses with `CorruptFieldError`
    naming the field *and § 3.2 says it should refuse*.
  - **defect** — op throws anything else, reports `not found` over a
    file on disk, silently drops or rewrites a `raw`, or refuses a cell
    § 3.2 says must proceed (or proceeds where it says refuse).
  - **unspecified** — §§ 3.2/6/7 have no row for it. Goes to
    `decisions.md` § 8 with a revert path, then the cell is re-run.
- Output: `docs/dev/corruption-audit.md` — the matrix with a verdict per
  cell and, for each defect, the `known-gaps.md` entry it created. Fixes
  flow from the defect list; the matrix is re-run green before Phase 7
  closes.

### 11.4 Reconcile-against-shipped rows (brief § "Reconcile")

Specific cells the brief names, pre-registered so they cannot be skipped:
PRU partial remap (`users/lifecycle.ts` over a task whose `assignee` is
`wrong_type`); bulk results (`bulk.ts` `failed` messages for an
object-fatal member — expected defect: "task not found" when unindexed);
BAK restore (`restore.ts` over a backup containing a corrupt task — must
restore it byte-for-byte, not refuse or drop). And the sibling store
already known: the `queries.yaml` broken-entry drop (known-gaps) as the
first non-task application of § 4.4's monotonic guard.

---

## 12. Design decisions that need Ken

Only genuine either/or calls the north star, brief and existing decisions
do not settle:

1. **Fatal set: `{id, key}` now, or `{id, key, title, created_at,
   updated_at}` first?** § 3.1's rule says only `id`/`key` are needed to
   address a task, so principle 5 wants `title` and the timestamps
   degradable. The cost is making `title`/`created_at`/`updated_at`
   optional in `TaskFrontmatter` and the public projection, which
   touches every consumer of those three fields at once. Recommendation:
   step 1 keeps the five (the spike's boundary), step 2 shrinks to two —
   but this narrows a principle for three fields and is Ken's to accept.

2. **Should `unrecognised` keys be surfaced to API clients at all?**
   `TaskFrontmatterPublicSchema` deliberately does not echo unknown keys
   ("the response shape stays a stable contract", `task.ts:149-158`),
   and `.passthrough()` treats them as legitimate "experimental or
   tool-specific metadata" (`task.ts:101-105`). The brief's § 4 wants
   them shown as read-only strings with an X. These are compatible
   (they travel in `health`, not `frontmatter`) but the second reframes
   tolerated metadata as something the UI invites the user to delete.
   Recommendation: surface them, with the group labelled "Not
   recognised" rather than "Corrupt" — but whether a tool-written key
   should get a delete affordance in the UI is a product call.

3. **Publish with field-local corruption present: allowed (current
   `malformed` = never blocking) or warned-and-confirmed?** § 10 keeps
   the shipped rule. Principle 4 (safe defaults, `--force` to skip)
   could argue for a warning gate on publishing a tracker with N corrupt
   fields. Recommendation: no gate — the data is preserved, so nothing
   is at risk, and a gate would make a tracker unpublishable over a bad
   date — but it changes nothing today only because Ken accepts that.

Nothing else in this proposal is an either/or a reviewer could not
settle from the north star, the brief, A118, K21, K22 and P-11/P-12.


---

## 13. Amendments (post-review, agent-applied)

The adversarial review (`corruption-framework-review.md`) returned
**PASS-WITH-FIXES**. The spine stands. These amendments correct the two
blocking defects and S1, and reclassify § 12. They are authoritative over
the sections they name.

### 13.1 B1 — the write guard takes `touched`

§ 4.4's monotonic rule `health(after) ⊆ health(before)` is **replaced**
by: a `(field, kind)` entry may leave `health` **only if `field` is in
the `touched` set the operation declares.** Signature becomes
`assertWriteSafe(before, after, touched: ReadonlySet<string>)`.

Rationale (review B1): the bare-subset rule passes when a merge-style
writer defaults a corrupt structure away and discards its raw value —
`setField("points",5)` does `fields ?? {}` (`update.ts:448`), dropping a
wrong-typed `fields` map; same at `relationships.ts:323` (`?? []`) and
`move.ts:98`. Those shrink `health` without the field being the write's
target, so the subset rule wrongly certifies silent loss. Threading
`touched` (which `attributableErrors` already computes,
`update.ts:250-269`) makes the guard forbid exactly that. Every writer
declares its `touched`: `setField(f)`→`{f, updated_at, ...auto}`, archive
→`{archived, archived_at, updated_at}`, link→`{relationships}`, bulk→per
task. §0's "write paths inherit preserve-others without knowing
corruption exists" is corrected: **merge-style writers must pass their
`touched`; the guard is what makes preserve-others safe, not free.**

### 13.2 B2 — the choke point is `assembleTaskFile(task)`, six writers

§ 4.4/§4.5's "single `writeTask`/`stagedSwap` choke point" is **wrong**:
task.md is assembled+written at six sites — `io.ts:64` (writeTask),
`io.ts:141` (updateTaskBody), `bulk.ts:133` and `bulk.ts:210` (the two
staged swaps), `backup/restore.ts:617` (restore), and
`git/resolve-conflicts.ts:169` (merged output). The **real** choke point
is `assembleTaskFile(task: Task)` — the one function all six already
call. It gains the `health` argument and re-emits raw values; making it
take a `Task` (carrying `health`) means the compiler flags every writer
that omits it.

Critical consequence (review B2): once unrecognised keys move out of
`frontmatter` into `health` (§4.3 change 3), **any writer that assembles
`{frontmatter, body}` without `health` drops every passthrough key** —
a regression on exactly the paths the brief's "Reconcile" section
protects (BAK restore, git merge). So restore (`restore.ts:252,360,406`)
and reconcile (`reconcile-plan.ts:351`, `resolve-conflicts.ts`) must
construct their `Task`s through the tolerant `readTask`/`parseFrontmatter`
that populates `health`, not bare parses. `mergeTask`
(`resolve-conflicts.ts`) merges two sides' `health`: **union of raw
values, a healthy value on the winning side overrides that field's
health entry.** This is a step-4 audit row, not deferrable — it is a
consequence of the framework, so the audit must classify it as
*handled-by-this-design*, not discover it as a new defect.

### 13.3 S1 — the operation rule, corrected

§ 3.2's table had three concrete errors; corrected:

- **A third read-category is needed.** An op reads a field either to
  **address/compute** (refuse if corrupt) or for a **no-op/idempotency
  check** (a corrupt value is treated as "not in the target state" and
  the write proceeds — it is the repair). `archive`/`unarchive` are the
  latter: `unarchiveTask` on `archived: "yes"` must NOT no-op (review S1
  — that "repairs nothing"); a corrupt `archived` reads as "not
  archived", so unarchive is a no-op that is *correct* (already
  unarchived from the user's view) and archive proceeds and repairs. The
  rule: **a corrupt field read only for an idempotency check never
  refuses and never silently persists the corrupt value.**
- **`duplicateTask` must read `project`** (`duplicate.ts:117`) and throws
  a bare `Error` today; it copies **healthy `frontmatter` only** (never
  raw corrupt values into the new task) and lists dropped fields in its
  result. If `project` itself is corrupt it refuses (it needs it to
  allocate a key).
- The **"labels add/remove"** row describes a mode that does not exist
  (`setField` replaces; there is no merge mode) — deleted. `setField`
  on any field is a full replacement and therefore always the repair for
  that field.
- **`setField(<custom>)` row added**: it reads `fields` to merge one key
  (`update.ts:448`), so a wrong-typed `fields` map is **refuse** (B1's
  case) unless the write replaces the whole map.

### 13.4 § 12 reclassified

- **Item 1 (fatal set) — GENUINE, goes to Ken.** Confirmed by review.
- **Item 2 (surface unrecognised keys with an X) — WITHDRAWN.** Already
  answered by the approved brief §1/§4 ("shown as string, with an 'X' to
  remove it"). Recorded in `decisions.md` § 8 (A135). Residual label
  choice ("Not recognised" vs "Corrupt") is an agent call: **use "Not
  recognised"** for the `unrecognised` kind, "Needs attention" for
  wrong-typed/invalid — corrupt-sounding language is for object-fatal.
- **Item 3 (publish gate) — WITHDRAWN.** Settled by `integrity.ts`
  (`malformed` is never blocking) and V2 (`decisions.md:268`). Recorded
  in `decisions.md` § 8 (A135); the revert path is a `--force`-skippable
  warning.
- **NEW — M1 (byte-preserved → value-preserved) GOES TO KEN.** The
  review caught that §4.4 narrows north-star P7's "byte-preserved"
  (`north-star.md:118`) to YAML-value preservation. Rewording a
  principle is Ken's (`north-star.md:166-169`). The argument for him:
  `stringifyYaml` already re-serializes every field on every write today
  (`frontmatter.ts:283`), so the literal "byte-preserved" wording is
  **already unmet** — the framework makes it honest, it does not make
  preservation worse. Still his to accept.

### 13.5 Recorded, not Ken (from review "Missed decisions")

- **Structural fields** (`relationships`, `fields`, `labels`,
  `key_history`) move from object-fatal (the spike's boundary,
  `frontmatter.ts:129-131`) to **field-local** — principle 7's own
  `relationships`-as-object example settles it (the object opens; the op
  that needs it refuses). `decisions.md` § 8 (A135) so the next agent
  does not re-derive the old boundary.
- **M2 / S5 — unlink over an object-fatal target**: §7.3 must NOT
  reverse the deliberate, commented refusal at `relationships.ts:407-411`.
  Keep the shipped refusal. `decisions.md` § 8 (A135).

### 13.6 Should-fixes S2–S6 (fold into step 4)

S2 (repair path for auto-managed wrong-typed fields), S3 (`before`
source for the guard = the on-disk read the write already did), S4
(`unset` address collision between top-level and `fields.<name>` — the
address is the full path, `fields.<name>` never collides with a
top-level key), S6 (`.passthrough()` stays; unrecognised keys travel in
`health` for the UI but are still round-tripped by the serializer) —
each becomes the audit's first pass on its cell, tracked as
*specified-here* rather than *unspecified*.
