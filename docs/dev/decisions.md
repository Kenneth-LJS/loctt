# Design decisions

Locked decisions for LocTT, extracted from the v1 UI planning docs before
those were retired. Keys (`D1`, `Q4`, `CW-3`, …) are preserved so existing
cross-references keep resolving.

**What's here and what isn't.** Decisions whose outcome is visible in the
code are *not* repeated — the code is the record, and duplicating it here
would just create another thing to drift. What survives is the material
that leaves no trace:

1. **Deliberately not built** — the "we decided against X" calls. Nothing
   in the codebase distinguishes these from oversights, so without this
   list someone eventually "fixes" them.
2. **Decided but unbuilt and unticketed** — real decisions that fell out
   of the plan. These need converting to tickets or dropping on purpose.
3. **Superseded** — where the shipped behaviour diverged from the locked
   decision. Recorded so the old decision isn't re-applied.

---

## 1. Deliberately not built

Each of these is a considered "no". Re-opening any of them is a product
decision, not a bug fix.

### Scope boundaries for v1

| Key | Decision | What not to "fix" |
|---|---|---|
| **Q21** | **No notifications.** | Absence of any notification system is intentional. |
| **Q23** | **English only.** No i18n framework. | Don't add a translation layer speculatively. |
| **Q25** | **No roles or permissions.** | LocTT is single-user-per-machine; there is no authorization model to complete. |
| **Q27** | **No time tracking.** | `estimate` is a planning number, not a timer. |
| **Q29** | **No print stylesheets.** | |
| **Q16** | **Empty states are text-only.** | No illustrations. |
| **B7** | **No workflow preset selector.** The canonical default workflow (CW-10) is the only starting point. | The absence of "choose a template on init" is deliberate. |
| **B8** | **No workspace name field.** Display uses the directory basename. | Grep confirms zero trace of `workspace_name` anywhere — without this row it reads as an oversight. |

### Capabilities kept out of the UI on purpose

| Key | Decision | Why it matters |
|---|---|---|
| **C2** | **`rebuild key index` is CLI-only.** | A recovery operation, not a routine one. Unlike C1, this one stands. |

### Interaction calls that leave no artifact

| Key | Decision |
|---|---|
| **Q4** | **No websockets and no manual refresh button.** Cross-tab freshness is TanStack Query `staleTime` plus focus refetch. |
| **Q6** | **Card layout is visibility + ordering only — no 2D positioning.** |
| **Q7** | **Broken sidebar pins are silently dropped** *and* removed from config on next render. |
| **Q15** | **Sort-only saved views are allowed** (a view need not filter). |
| **Q20** | **Tasks in archived projects stay editable.** Archiving a project is a list-hygiene action, not a freeze. |
| **SV-6** | **Duplicate saved-view names warn, don't block.** |
| **SV-7** | **Built-in filters are not editable in place.** Editing one opens a Create dialog pre-populated from it. |
| **D19** | **Timezone is editable in two places and last-write-wins.** The duplication is intentional, not a bug to consolidate. |
| **D13 / B18** | **No "hide discarded" board toggle** — superseded by per-status filter chips before it was built. |
| **Q1** | **"No default — force picker" is a valid workspace state.** Don't assume a default project always exists. |

---

## 2. Resolved — scheduled for build

Every item here was decided, then fell out of the plan. **Status column
updated 2026-08-15**: six of the eight are now built. The two that
remain are blocked on UI routes that render stubs, not on any further
decision.

| Key | Decision | Disposition |
|---|---|---|
| **D2 / B2** | **Global search** in the header — `text ~ q` DSL, no full-text index. | ✅ **Built** (`216698b`). `GET /api/search`. Exposed two live bugs: body search matched nothing on any surface (no caller supplied `getBody`), and `searchable: false` was ignored. The header box itself still needs the shell. |
| **B5** | **Lossy-content guardrail** — detect constructs WYSIWYG cannot represent, warn, and force source mode for that task. | ✅ **Detection, API field and TipTap nodes built** (`83c5b82`). The banner and mode-forcing need the body editor, which does not exist. |
| **CW-4** | Bulk ops: `bulkLink`, `bulkUnsetField`, CLI `loctt set T-1,T-2 …`, MCP `bulk_update_tasks`. | ✅ **Built** (`b0ef10a`). Four HTTP routes, CLI comma-refs, MCP tool. **`bulkUnsetField` was not needed** — `bulkSetFields` already treats `value: undefined` as a clear; the gap was that no surface could express it, since JSON has no `undefined`. Each surface maps `null → undefined`. |
| **SV-2** | Saved-view editor reachable from list/board/timeline filter bars, sidebar, view pickers, and Settings. | ⛔ **Blocked on UI.** Needs the editor to have entry points to. |
| **SV-3** | Basic mode covers **all** DSL fields, including custom fields and link predicates. | ⛔ **Blocked on UI.** The named dependency is gone: `relationship.*` was replaced wholesale by `has_link()` / `link_count()` (`1a2b77d`), and saved-view queries are now validated before persisting (`6536462`). What remains is the chip builder, and `/settings/$section` is a stub. |
| **SV-4** | Sort rows inline below filter rows, drag-reorderable for sort priority. | ⛔ **Blocked on UI.** |
| **B14** | Relationship rows show each target's live status. | ⛔ **Blocked on UI.** Its dependency is done: `TaskResponse` now carries resolved relationships including each target's live title and status (`e376634`). What remains is the panel, and `/tasks/$key` is a stub. |
| **D17** | Editor mode (WYSIWYG vs source) persists per user via `UserSettings`. | ✅ **Schema built** (`e25b4bc`), alongside CW-17. UI wiring needs the editor. |

## 3. Superseded — do not re-apply

The locked decision no longer matches what shipped.

| Key | Was decided | What shipped |
|---|---|---|
| **Q19** | Relationship symmetry via a **`symmetric: true`** boolean on `RelationshipDef`. | Shipped as **`kind: "symmetric"`** (`packages/contracts/src/workflow.ts:64,126`). The old form is now **actively rejected** — `workflow.ts:110` errors when `inverse` equals `key`. Any doc or fixture still showing `symmetric: true` is a copy-pasteable bug. |
| **CW-17** | `UserSettings.card_layout` as an **ordered array** (visibility + order). | **Resolved — now implemented.** Was ticked done while only the older boolean-map shape existed in a test fixture. See §5. |
| **CW-20** | Frontend compresses **all** attachment uploads to JPG/WebP. | Narrowed to **avatars only**. |
| **Q24** | Three responsive breakpoints — desktop, tablet, phone — **from day one**. | Phone breakpoint deferred. |
| **Q26** | Comments with **1-level threading**, `@mentions`, and a "Mentions me" filter. | Threading dropped. Note that comments reach **no surface at all** today — the storage layer exists with zero callers. |
| **Q11** | No per-file attachment cap. | A size cap is enforced server-side. |

---

## 4. Still-binding invariants

Moved to **[invariants.md](invariants.md)** — different audience and
lifecycle. Decisions are history; invariants are rules you check a change
against.

---

## 5. Recently resolved

| Key | Resolution |
|---|---|
| **C1** | **Migration is no longer CLI-only.** The UI gets `POST /api/migrate` and a working "Migrate now" button on the schema banner, gated behind a preview-then-confirm flow showing what will change, how many files, and where the backup lands. MCP gains a migrate tool so agents are not stuck either. The "migration is CLI-only" comment in `packages/contracts/src/service.ts` is now wrong and must be updated when this lands. |
| **CW-17** | **`card_layout` is an ordered array** — `[priority, assignee, due_date]` — carrying visibility *and* order, satisfying Q6's drag-to-reorder. Now defined in `UserSettingsSchema` with contract tests. |

## 6. Git-sync merge semantics (decided and built 2026-08-15)

Sync used to abort on any file changed on both sides since the last sync.
Nothing was lost, but two clones that each created a task could not merge
at all — they both bump `state.yaml`, so sync stopped before task files
were even compared. That was why `rekeyCollisions` had no caller: no
merged task set existed for it to scan. It is called now, from the
normalise pass in `publish-sync.ts`.

These decisions define what replaces the blanket abort. **All four are
built** (`packages/core/src/git/merge.ts`, `resolve-conflicts.ts`, and
the normalise pass in `publish-sync.ts`).

The four file-type rules approved alongside them, now implemented:

| File | Rule |
|---|---|
| `_history.yaml` | Union on `(timestamp, kind, actor, field)`. Content is deliberately not part of the identity — re-serialization changes formatting, which would duplicate entries. |
| `_comments.yaml` | Union by comment id. **A deletion beats a concurrent edit**: someone removed it deliberately, and the text is still recoverable from history (M3) if that was the mistake. |
| `projects.yaml` / `queries.yaml` | Union by entry id. Projects additionally get provisional prefixes where two collide, *before* writing — `ProjectsConfigSchema` rejects a duplicate on read, so an invalid file could never be loaded to repair. |
| `state.yaml` | Not unioned. Counters are derived from the merged task set per M1. |

**Anything without a rule still aborts**, naming the path —
`workflow.yaml` most notably, because unioning two divergent status
vocabularies could leave tasks pointing at a status the merged config
does not define.

| # | Decision | Rationale |
|---|---|---|
| **M1** ✅ | **Key counters are not merged arithmetically.** After a merge, collect the tasks that exist, renumber only those whose keys collide — ordered by `created_at`, ULID `id` breaking ties — and derive the counter from the result. | Merging counters by `max` under-reserves: base 5, A creates 3, B creates 8 gives 11 new tasks but a counter of 13, so the rekey pass reissues keys that already exist. Deriving from the tasks cannot disagree with what is on disk, and needs no base commit. Non-colliding keys are left alone — renumbering a key someone already referenced is gratuitous churn. |
| **M2** ✅ | **A contested frontmatter field should be resolved per field, not per record.** Whole-record last-write-wins drops an uncontested field because a *different* field was contested — the common case when two people work one task. Frontmatter has no per-field timestamps (`updated_at` is stamped per write), but **history does**: `field_change` / `custom_field_change` name their field and carry `before`/`after`, `created` carries the whole initial frontmatter (M3), and `_history.yaml` is unioned on merge. Where a field cannot be resolved from history — a hand-edit, or a task predating M3 — it falls back to whole-record recency **for that field alone**, recording a `merge_resolved` entry naming the field, both values and the side taken, so the fallback is auditable. Hand-edits are explicitly out of scope; see below. | Shipped behaviour today is whole-record LWW (`merge.ts` `mergeTask`), which is what the rationale for M3 already assumed was not the case. Clock skew can still order two edits wrongly: accepted as a nuisance, not a loss, as before — both values remain in history. |
| **M3** ✅ | **Every history entry records enough to reconstruct the state it changed.** Not just `body_edited` — `created` carries the initial frontmatter and body; `body_edited` carries before/after body (one snapshot per coalesced burst, not per keystroke); `comment_added`/`_edited`/`_deleted` carry the comment text. `archived`/`unarchived` are exempt: the kind fully describes the transition. | Today only `field_change`, `custom_field_change`, and the link/attachment kinds record content. The rest store a timestamp and nothing else, so history says *that* something happened and never *what it was*. This is the prerequisite for M2 — without it "history is the recovery path" is false. `comment_deleted` is the sharpest case: a hard delete with no record of the text, unrecoverable by any means. Independently this is what makes a body diff in the activity feed, and version restore, possible at all. |
| **M4** ✅ | **The body is last-write-wins for the live value, but the losing version is written to a sibling file** rather than silently dropped. | Even with M3, silently replacing someone's paragraphs is a bad experience — they may not notice for days, and history is a place you have to think to look. The body is the field where not noticing costs most. |

**Size, decided:** recording content makes `_history.yaml` grow with
content rather than event count, and it is read in full on every append
and every activity-feed render. Accepted as-is for now — bodies are
usually small and git compresses them well. **Capping the snapshot was
rejected**: a truncated entry cannot reconstruct, which is the guarantee
being added. If it bites, the escape hatch is splitting content into
`_history/<entry-id>.yaml` loaded on demand, keeping the feed fast and
reconstruction exact.

### M2 scope: history is the record, hand-edits are not covered

**Decided.** Merge resolution trusts `_history.yaml`. A frontmatter value
that no history entry explains is not a case the merge owes a correct
answer to.

Hand-editing a `task.md` on disk is still supported for everything else —
LocTT is file-first and always will be — but a hand-edit writes no
history entry, so a *merge* has no evidence it happened. Someone who
edits by hand and then syncs a divergent clone should expect that field
to resolve by whole-record recency, and may lose the edit. The
`merge_resolved` entry records it when that happens.

This is what makes the rule tractable: with hand-edits out of scope, the
winning value for a field is simply the latest entry naming it, and
`created` (which M3 makes carry the whole initial frontmatter) is
legitimate evidence for a field never edited since.

An earlier attempt tried to detect hand-edits by comparing each side's
frontmatter against what its own history predicted. That is a two-signal
rule and it was more machinery than the guarantee is worth.

**Two consequences, both intended:**

- A hand-edit to a field the task was **born with** (anything in
  `created`'s frontmatter) is reverted to the last value history knows,
  **with no `merge_resolved` entry** — history *can* explain the field,
  just not with the hand-edited value.
- A hand-edit to a field **added later** and never written structurally
  is genuinely unexplained, so it falls back to whole-record recency and
  *does* record a `merge_resolved` entry.

Both only apply to a task being merged, i.e. changed on both sides since
the last sync. A hand-edit that never meets a conflicting change is
untouched.

**Not a decision, recorded because it was checked:** history coalescing
is already actor-scoped (`coalesceHistory` compares `last.actor ===
next.actor`) and tested. A burst only collapses within one user's own
edits; two users' edits never merge into one entry.

---

## 7. Validation and error handling (decided 2026-08-17)

### V1 · Core owns validation; surfaces do not re-implement it

**✅ Implemented 2026-08-17 (`e19964f`).** `LocttError` carries `code`,
`field`, `dataState`, `recovery` and `detail`; ten error classes
migrated keeping their names, so `instanceof` still works. The web's
three hand-written translation branches are gone, and the CLI's two
sprint-state copies with them. MCP's `z.enum` stays: it is the tool
schema an agent reads, not only a runtime check.


**Every validation rule lives in core.** CLI and MCP call into it and
surface what it returns; neither carries its own copy of a rule about the
data.

The reason is arithmetic: a rule in core is enforced on three surfaces, a
rule in the CLI is enforced on one. Today several rules live at a single
surface — `--state must be one of active|completed|future` in
`sprint.ts`, `--archived must be exactly "true" or "false"` in
`milestone.ts` — so MCP and the web either duplicate them or lack them.

This is not hypothetical drift. The CLI's hand-rolled attachment-name
check used `includes("..")` and rejected the legal name `notes..txt`,
while core's `assertSafeBasename` (which tests for a `..` path
*segment*) accepted it. A file could be attached and never detached. The
CLI now delegates; the duplicated rule was simply wrong.

**Consequences accepted:**

- An audit of what core's entry points actually validate today
  (`setField`, `createTask`, `bulkSetFields`, the entity create/edit
  functions). This is an unknown, not a known gap.
- An audit of which surface-level rules must migrate.
- Structured errors from core, so CLI and MCP can report cause rather
  than prose. The web already has this contract in `service.ts`
  (`code`, `message`, `data_state`, `recovery`); CLI and MCP have exit
  codes and an `isError` boolean respectively, and an agent cannot
  branch on cause without matching message text.

**Two cautions were recorded at the time of the decision. Both are now
resolved (2026-08-17):**

1. ~~Changing MCP's error output is a breaking change with no version
   negotiation.~~ **Settled: proceed.** The user's ruling — *"we're not
   published yet. we can break existing behaviour for cleanliness."*
   There are no existing trackers to break.
2. ~~Whether the code set is the *right* set is only answerable once a
   UI renders it.~~ **Settled by V8**, which removes the dependency: the
   shape describes the error rather than its rendering, so it is
   decidable without a UI. The concern was only ever real for a
   presentation-shaped taxonomy.

**Sequencing, agreed 2026-08-17.** V1 lands before M2, but only needs to
land its *server* half first. M2's editable fields all go through
`handleSetField` (`server.ts:2684`), which today takes an unvalidated
`value` — the open audit finding. Whatever V1 produces is what M2
renders in every inline error, so building M2 first means inventing an
error contract and then reworking it.

Codes accrete rather than being designed up front: start from what the
surfaces already distinguish, add one when a consumer genuinely needs to
branch on it.

**Start with the two audits.** They are read-only and they size the rest
of the work; do them before writing anything.

**Adopt `utils/read-state.ts`, do not replace it.** It already makes the
absent / loaded / unreadable distinction V1's structured errors depend
on, and six call sites use it (`149a07a`).

### V2 · Malformed history degrades; it never blocks

A hand-edited `_history.yaml` is the user's mistake to own. LocTT does
its best with what is there and never refuses the file.

- An entry missing `timestamp` is **kept**, placed so it preserves the
  relative order it already had in the file — not dropped, not sorted to
  the end, not cause for an error.
- It must also survive the **merge**. `mergeHistory` builds an identity
  key from `timestamp` + `kind` + `field`; with no timestamp, distinct
  entries collapse to one identity and all but one are dropped. That is
  the real data loss, and it happens before any ordering question. A
  timestamp-less entry is therefore treated as never equal to anything,
  so it is always kept.

This supersedes the earlier plan to add `HistoryEntrySchema` and reject
malformed entries. Rejecting is the wrong direction for a file the user
may have edited: the recovery path for a bad edit should not be a
tracker that will not open.

### V3 · Route segments carry the ULID; P-4 is scoped to UI content

`/milestones/<ulid>` and `/sprints/<ulid>`. The address bar is **not**
the UI for P-4's purposes.

The alternatives were weighed and rejected:

- **A slug from `name`** — readable, but names are neither unique nor
  immutable, so every saved link breaks on a rename and two milestones
  sharing a name are indistinguishable.
- **A new user-chosen `key` field** — consistent with how project
  prefixes work, and the most expensive: schema change, migration, a new
  uniqueness rule, and a rename command that rewrites references.
- **Slug + id** — stable and readable, but the ULID is still on screen
  and the URL is ugly.

P-4 is unchanged in wording and now explicitly scoped: it governs UI
*content* — labels, pickers, prose, error messages. A URL is an
addressing mechanism, not something LocTT displays.

Applies to M4.7's existing `/sprints/$key` as well as the new M3.5 and
M4.9 routes. `$key` in the flow docs means "the ULID" wherever it
appears on a milestone or sprint route.

### V4 · Sync pre-flight runs under both `--dry-run` and a real sync

`loctt git sync --dry-run` runs the full pre-flight: validate every
touched file, check cross-file dependencies, and report what would merge
and what would conflict — without applying anything.

**The same pre-flight runs on a real sync, which refuses on failure.**
Advisory-only would mean nothing stops a sync pushing a broken
relationship; `--dry-run` is "show me, don't do it", not "the only time
we check".

A sync can now fail for a reason it previously did not. Given P-12 that
is the point, not a regression.

This also replaces `doctor` as the primary place malformed data is
surfaced for the sync path. `doctor` remains the reporter for a locally
broken file with no sync pending.

### V5 · The validator is maintained by a test, not by an instruction

**✅ Implemented 2026-08-17 (`761df3e`).** `schema-coverage.test.ts`,
plus the instruction in `build-loop.md`. Verified in both directions:
adding a schema field, and removing a guard, each fail naming the field.


Four deliverables, and the fourth is load-bearing:

1. **Specs** — the flow docs state the cross-file rules the validator
   enforces.
2. **Implementation** — the validator itself.
3. **Agent and build-loop instructions** — adding a feature requires
   updating the validator.
4. **A schema-coverage test that fails when (3) is ignored.**

(3) alone is a rule nobody enforces. This repo has shipped fourteen
tests that encoded a bug as intended behaviour precisely because
"someone will remember" is not a mechanism.

**How (4) works.** Enumerate the contracts schemas at runtime — Zod
exposes `.shape` — and assert every field is either reachable by the
validator or on an explicit exemption list carrying a one-line reason.
Add a field without teaching the validator and the test fails naming it.
A second test asserts every exemption still names a real field, so the
list cannot rot.

**Its limit, stated honestly:** this proves *coverage*, not
*correctness*. It cannot tell you the rule is right — only that the
field is looked at. The failure mode it targets is forgetting entirely,
which is the one that actually happens.

### V6 · Multi-file operations get stage-then-swap plus a journal

A bulk operation writing 50 tasks and killed at 30 leaves each file
individually intact and the set half-applied. Atomic rename covers a
single file; three sentinels cover schema migration, prefix rename and
sync; nothing covered this.

**Both mechanisms, layered — this is write-ahead log plus atomic
commit:**

- **Stage-then-swap** writes every file to a temp location, then renames
  them all. This shrinks the failure window from "50 write cycles" to
  "50 renames with no I/O between them". It is the more robust of the
  two: a staged file is invisible until its rename, so there is no
  moment where a partial write is observable.
- **A journal entry** naming the affected ids and the intent. Multi-file
  atomicity does not exist on POSIX, so a crash mid-swap still leaves a
  partial set — and stage-then-swap alone leaves *no record of what was
  intended*. The journal is what survives to say so.

**Why not sentinel + backup:** it is the coarsest option — copy
everything, and on failure hand the user a directory and an apology.
Right for schema migration, which rewrites everything and cannot be
reasoned about item by item. Wrong for a bulk op whose items are
independent.

**What makes the journal cheap here:** LocTT's bulk operations are
already idempotent — a task carrying the new key is skipped — so replay
is safe and the journal's own write window stops mattering. An entry for
work that never started replays harmlessly.

`state/journal.ts` already provides `recoverPendingJournal`,
`replayTaskRemap` and `removeJournalEntry`, wired into `withStateLock`
so recovery runs before any locked operation. Extending it is the
implementation path, but the decision rests on the merits above, not on
what happens to exist.

### V7 · An unreadable user profile is kept, not skipped

`loadAllUsers` skipped any `profile.yaml` it could not parse. A corrupt
profile therefore made that user cease to exist for every caller: absent
from `loctt user list`, absent from pickers, and absent from
`archivedUserIds` — so if that user was archived, the guard that stops
assignments to archived users silently let them through.

Skipping *is* discarding, which P-11 forbids. Rather than carve an
exemption into an invariant agreed the same day, the shape changes:

```
loadAllUsers → { profiles: UserProfile[], unreadable: Array<{ id, reason }> }
```

Each caller then decides what unreadable means for its own job, which is
what P-11's "excluded only from reads that genuinely depend on the broken
field" requires:

| Caller | Behaviour |
|---|---|
| `loctt user list` | Show the entry as `<id> (unreadable: <reason>)`. The user exists; only their name is unrenderable, and vanishing from the list is what hides the problem. |
| **Archived-reference guard** | **Refuse the assignment.** The guard exists to stop assignments to archived users; if we cannot tell whether they are archived, allowing it is the exact failure it guards against. Refusing is annoying and reversible — allowing is silent and is not. |
| `getCurrentUser` self-heal | Never select an unreadable profile as the fallback. It decides who the user is attributed as. |
| History actor rendering | Fall back to the id, which it already does for an unknown actor. No change. |

**Cost, stated plainly:** every `loadAllUsers` caller now decides rather
than receiving a clean list, and there are several. The current code is
simpler because it decided — wrongly — for all of them at once.

**Rejected alternative:** leave the skip and write a P-11 exemption for
user profiles. Defensible on cost, but an invariant that acquires a hole
on its first day is worth less than the hole saves.

### V8 · Error shape describes the error, not its presentation

**✅ Implemented 2026-08-17 (`e19964f`)**, in the shape V10 settled.


**Decided 2026-08-17, after a proposal was rejected.**

I proposed four categories — field-level, operation-level, state-level,
conflict — named by where the UI should render each. The user rejected
the premise:

> "the shape shouldnt be 'oh i want this to show error, i want this to
> be a popup'; i.e. we shouldnt define error codes based on what we want
> the ui to be -> we should define this on something meaningful to the
> error type itself"

That is right, and the mistake it corrects is the same one the enum rule
already forbids elsewhere: storing display intent instead of meaning.
Encoding "this is a toast" into core makes core guess at a UI, and spends
the taxonomy on one consumer's layout — so a second consumer, or a
redesign, finds the vocabulary already committed to somebody else's
rendering.

**The rule.** Core describes *what went wrong*. Each surface decides
*what to do about it*.

An error carries:

- **the kind of failure** — a value did not validate, the thing does not
  exist, the current state forbids it, two writers collided, a file could
  not be read
- **what it is about** — which field, which entity, which file
- **what was expected** — the valid statuses, the conflicting versions

**Consequence: the payload carries the weight, not the code.**
`UNKNOWN_ENUM_VALUE` with `{field, given, valid}` beats five codes that
differ only in which field they concern. Fewer codes, richer data.

A UI may still derive its layout from this — an error carrying a field
name is evidently field-level — but that inference belongs to the UI. It
is not something core declares, and it does not collapse when the next
consumer wants something different.

**Open until checked against the spec.** The failure kinds above are
derived from the code, not from the case docs.
[`flow-error-handling.md`](ui-test-cases/flow-error-handling.md) — the
ERR-* cases — is the specification for error behaviour and must be read
before the set is fixed. If it names different kinds, those win; an
agent does not adjudicate against the spec.

### V9 · P-11 applies per store, and config is not a log

**✅ Implemented 2026-08-17 (`e379de8`).**


**Decided 2026-08-17 while extending P-11 past comments.**

P-11 says a malformed entry is kept and merged. That is right for a
**list of entries** — comments, history — where each row is an
independent record of something that happened, and dropping one destroys
a fact.

It is wrong for **config**. A malformed status in `workflow.yaml` is not
a record of an event; it is a definition other data points at. Keeping a
broken one means tasks referencing a status that cannot render, and the
damage spreads to every task that used it.

So:

- **Entry lists** (comments, history) — keep the malformed entry,
  position it by its neighbours, merge it, report it. Never blocking.
- **Config** — refuse to write, report the file. The content stays on
  disk untouched, which is what P-11 protects; what changes is that
  LocTT will not build on top of a definition it could not read.

Both halves are still P-11: nothing is destroyed in either case. The
difference is only whether LocTT proceeds around the damage or stops.

### V10 · The error contract already exists; V1 adopts it

**✅ Implemented 2026-08-17 (`e19964f`).**


**Decided 2026-08-17, after reading
[`flow-error-handling.md`](ui-test-cases/flow-error-handling.md).**

V8 sketched the failure kinds from the code and flagged that the spec
had to be read before fixing them. It has been. **The spec does not
contradict V8 — it supersedes the sketch with something more precise,
already implemented in `packages/contracts/src/service.ts`:**

```
ErrorResponse { code, message, field?, data_state?, recovery?, failures?, detail? }
ErrorCode = validation_failed | not_found | conflict | archived_reference
          | config_invalid | schema_mismatch | git_failed | io_failed
          | partial_failure | unknown
```

Ten codes, derived from the ERR-* cases rather than from the code's
shape. V1 **adopts this envelope**; it does not invent a parallel one.

**What the spec settles that V8 left open:**

- **Core owns the wording.** ERR-6: *"Whatever core says — e.g. 'cannot
  assign an archived user' — reaches the user in words core chose,
  because core's error text is already user-facing."* So the migration
  is not "core throws codes and each surface writes copy". Core writes
  the sentence; surfaces place it.
- **`field` decides placement, not a category.** ERR-14 puts a
  field-level rejection *at the field*. The UI derives that from
  `field` being present — exactly the inference V8 said belongs to the
  UI, and the reason a presentation-shaped taxonomy was the wrong idea.
- **`data_state` is mandatory on writes.** ERR-18: every write-path
  failure states saved / not saved / unknown. ERR-3 calls this *"the
  single most important error behaviour in the app"*.
- **`recovery` is a control, never prose.** ERR-15: "Please try again"
  with no button is a failing result.
- **`detail` is the only place jargon may appear.** ERR-16 bars
  ZodError, ENOENT, EACCES, stack traces and raw ULIDs from the
  headline — but `.loctt/` paths are explicitly *wanted*, because they
  are the user's own files.
- **`unknown` is permitted exactly once.** ERR-30: only when the cause
  genuinely cannot be determined, and still carrying `data_state` and a
  recovery. ERR-31 forbids using it to avoid enumerating causes.

**Consequence for the work.** V1's remaining job is mechanical rather
than a design question: move the surface rules into core, and have core
throw errors that carry the envelope's fields instead of bare prose.
The taxonomy question that made V1 look undecidable before a UI existed
was answered in the case docs the whole time.

### V11 · Bulk undo is in-memory and dies with the page

**Decided 2026-08-24 by Ken.** BLK-10 requires an Undo affordance in
the success message after a bulk archive. The list of just-archived
task ids lives **in memory only** — no store, no persistence.

Reloading or navigating away loses the undo. That is accepted: archive
is reversible by other routes (toggle "Show archived", unarchive), so
the undo is a convenience over the immediately-preceding action, not a
recovery mechanism.

**What this settles for M1.4.** BLK-10 is not only an addition. It also
*removes* the typed-confirmation dialog currently shipped on bulk
Archive — the case is explicit that demanding one is itself a
violation, because archive is reversible. At most a lightweight
"Archive 6 tasks?" with **cancel focused by default**.

Nothing persists, so there is no expiry to configure and no journal
entry. The undo affordance disappears with the success message.

### V12 · Per-user UI state lives in `localStorage`

**Decided 2026-08-24 by Ken.** SPR-3 requires a sprint column's
expand/collapse to survive a reload, per-user, explicitly *not* written
to `sprints.yaml`. No per-user UI-state store existed:

- `sprints.yaml` — shared config; the case forbids it.
- `list-view.yaml` — committed and shared across the team, so it is the
  wrong scope even though it is the closest existing thing.
- `.loctt/local/` — right scope (never mirrored to git), but everything
  there is machine state (`sync.yaml`, `journal.yaml`,
  `key-index.yaml`); there is no UI-preferences file.

**`localStorage`.** No server work, no contract, no route pair.

**The cost, accepted:** it is per-browser, not per-user. The same
person on a second machine gets the defaults back. SPR-3 is a `major`
case, not a blocker, and the state it holds is a column being open —
losing it costs one click.

**Consequence.** M3.5 needs no server work of any kind. An earlier
build-plan claim that M3.5 and M4.9 "carry server work" was wrong on
both counts.

---

## 8. Agent-made decisions (Phase 5 run) — REVIEWABLE, REVERTIBLE

**Every entry here was decided by an agent, not by Ken.** They are
recorded so they can be reviewed in a batch and reverted individually.
Nothing in this section carries the authority of sections 1–7.

An agent records here when a flow doc was silent or ambiguous and it
had to pick a reading in order to keep building. It records here
**instead of stopping** — the run does not block on these.

An agent does NOT record here, and stops instead, when the call:

1. **changes scope** — adds or removes a view, route, or feature
2. **invents a requirement** — no case covers it and the agent would
   be authoring one
3. **violates a P-principle** (`ui-test-cases/README.md` P1–P10) or
   contradicts a decision in sections 1–7
4. **is load-bearing** — later work will build directly on top of it,
   so being wrong means rework rather than a tweak

Rule 4 is the judgment call, and it is the one that matters. A
contained decision — one behaviour, one place, cheap to reverse — is
made and recorded. A decision that becomes a foundation is Ken's, and
the run stops for it.

### The format

Each entry MUST carry all six fields. A verdict without its context
cannot be reverted from, which defeats the purpose of recording it.

```
### A<n> · <one-line title>

**Ticket:** M2.1 · **Date:** YYYY-MM-DD · **Commit:** <sha>

**The situation.** What was being built, and what the code or the
docs actually did. Include the case ID and quote the case text if it
is the ambiguous thing.

**What had to be decided.** Stated as a question.

**Options considered.** At least two, each with what it costs.

**Decided.** Which one, in one sentence.

**Why.** The reasoning — including any principle or existing decision
it leans on.

**To revert.** The files and symbols that change if Ken decides
otherwise. This is what makes the entry actionable rather than
archival.
```


### A1 · An unknown `sort` field stays a 200, not a 400

**Ticket:** 🚦 M1 gate round 6 · **Date:** 2026-08-29 · **Commit:** (this one)

**The situation.** The gate's F3 (minor) reports an API inconsistency:
`?dir=sideways` returns 400 "Sort direction must be ascending or
descending", while `?sort=nonexistent_field` returns 200. A direct API
consumer gets a signal for a bad `dir`, `status` or `limit`, and
silence for a bad `sort`.

The gate also claimed the bogus sort produced "different ordering".
**That does not reproduce.** Measured against three seeded tasks:
default order and `?sort=nonexistent_field` both return
`['Mango', 'Alpha', 'Zebra']` — identical. The fallback works.

**What had to be decided.** Should the API reject an unknown `sort`
field with a 400, for consistency with its other parameters?

**Options considered.**

1. **400 on an unknown sort.** Consistent with `dir`, `status` and
   `limit`. Costs: LST-29 (major, P2 P6) says a pasted
   `/list?sort=nonexistent_field` must render "with the default sort
   rather than an empty table **or an error page**". A 400 would have
   to be swallowed by the client to avoid violating that — so the
   consistency is bought by adding a special case, not removing one.
2. **Leave it.** The 200-with-fallback is what LST-29 asks for and
   what the code comment already cites. Costs: the API asymmetry the
   gate names is real and stays.
3. **Warn without failing** — 200 plus a header or envelope field
   naming the dropped parameter. Costs: no case describes this, and it
   is a new API surface.

**Decided.** Option 2 — leave it.

**Why.** No case requires the API to reject an unknown sort, and
LST-29 explicitly requires the UI not to error on one. Choosing
option 1 or 3 would be **authoring a requirement**, which is stop
condition 2 (see `lessons.md` § Process). The gate identified a genuine
asymmetry but did not identify a case it violates, and its supporting
measurement ("different ordering") is wrong.

Recorded rather than stopping the run because it is contained: it
changes nothing, nothing builds on it, and reversing it is a small
server-side edit.

**To revert.** `apps/web/src/server/server.ts:2306` — the
`isSortableTaskField(rawSort)` ternary. To adopt option 1, reject
instead of falling back, and give `ListView` a client-side guard so
LST-29 still renders. To adopt option 3, add the warning to the
response envelope. Either way LST-29's spec test must stay green.

### A2 · One failed request is enough to say the server is not responding

**Ticket:** 🚦 M1 gate round 6 (F1) · **Date:** 2026-08-29 · **Commit:** `20cdf85`

**The situation.** The gate raised this as **PC-18**: no case says how
much evidence "the server is not responding" requires, and the two
defensible readings differ on the most common outage.

SHL-41 says "**the next failed request** produces a persistent,
visible state" — one request. The implementation demanded a query that
had **never** succeeded, and the guard's own comment argued for that
stricter reading: one aborted page-2 request is "a failed request, not
a stopped process", and telling a user to restart a healthy terminal
is worse than saying nothing.

Fixing F1 forced the question, because the two readings are not
distinguishable in the cache. A dead server and a failed "Load more"
both leave a query with data plus a later error, and both retry, so
neither `errorUpdatedAt` nor `fetchFailureCount` separates them.

**What had to be decided.** Does the banner require a query that has
never been answered, or does any failure more recent than the last
success count?

**Options considered.**

1. **Never-answered only** (the old behaviour). No false alarm from a
   single failed request. Costs: **the banner cannot fire at all in a
   real outage**, because with the page open every query has been
   answered. That is F1 — measured as fifty stale rows under an
   authoritative "Showing 1–50 of 63", with nothing on screen saying
   the server was gone.
2. **Most recent evidence wins** — any failure later than the last
   success. Costs: a failed "Load more" raises the banner for as long
   as it stands. LST-49's own error still appears beside the control,
   so the user is over-informed rather than misinformed.
3. **A threshold** — N failures, or a time window. Costs: no case
   names a number, so picking one is authoring a requirement.

**Decided.** Option 2.

**Why.** SHL-41's text says "the next failed request", and it is a
**blocker**; LST-49 is a major, asks for an error near the control,
and never asks the banner to stay silent. Option 1 makes a blocker
case unimplementable. Option 3 would author a requirement.

The costs are asymmetric: option 2's failure mode is a banner that is
briefly too loud about a real failed request, and option 1's is a dead
server that says nothing at all.

**Recorded rather than stopping the run** because SHL-41's own words
settle it — this is reading the spec, not extending it. But it is the
answer to a question the gate says the spec does not ask, so it is
here to be overruled.

**To revert.** `apps/web/src/client/shell/ServerUnreachableBanner.tsx`
— the loop in `recompute`. Option 1 is restoring the `continue` after
`lastSuccess`. Note that doing so re-opens F1, so it needs a different
answer to "how does the banner ever fire mid-session". The unit test
"speaks when an answered query then fails" pins the current choice and
would need to invert.

### A3 · A transient wrong claim during a retry counts as making it

**Ticket:** 🚦 M1 gate round 6 (F2) · **Date:** 2026-08-29 · **Commit:** `9a21b22`, `bb6b9fc`

**The situation.** The gate raised this as **PC-19**: no case
constrains what may be shown *during* a retry. Every surface derived
from live query status flickers through a data-less `pending` on every
refetch — `fetchState` resets it — and no case says whether a claim
that is wrong for one second counts as being made.

This is the general form of four `AppBootstrap` bugs, F2's sidebar
flash, and F1.

**What had to be decided.** Is a wrong claim shown for ~1s during a
retry a defect, or acceptable transient state?

**Options considered.**

1. **It counts.** Every surface must ask what a query has *ever* done
   (`errorUpdatedAt`, `dataUpdatedAt`) rather than what it is doing
   now. Costs: more state to track at every site; five call sites in
   `Sidebar.tsx` alone.
2. **It does not count** below some duration. Costs: no case names a
   threshold, and the measured windows are not short — 1089–2098ms for
   the sidebar's cold-outage claim. A second of being told your
   tracker is empty is not a flicker.
3. **Case by case.** Costs: this is what produced four separate
   `AppBootstrap` bugs diagnosed as unrelated.

**Decided.** Option 1.

**Why.** P6 says empty, loading, partial and broken are **four
designed states**, and a surface that renders "empty" while it means
"still asking" has collapsed two of them — the duration does not
change which state it is claiming. ERR-1 says a failure and an absence
must not look alike, with no exemption for brief ones.

The measured windows also defeat option 2 on its own terms.

**To revert.** The `hasFailed` and `hasAnswered` helpers in
`apps/web/src/client/shell/Sidebar.tsx`, and `stillWaiting` in
`AppBootstrap.tsx`. Both are small and local; the tests pinning them
are named in their commits.

### A60 · A project's slug is fixed at creation and does not follow a rename

**Ticket:** M4.1 · **Date:** 2026-09-01 · **Commit:** (uncommitted)

**The situation.** Ken's ruling K3 (§ 9) reintroduces a `slug` on
`ProjectDefSchema` and puts it in URLs instead of the ULID. K3 names
three things it does not settle and hands them to the M-ticket: slug
generation, uniqueness, and — "the real design question" — **what
happens to the slug when a project is renamed**. PRU-6 says renaming a
project "changes only its label" and that "a URL containing
`?project=backend` still resolves after the rename — the URL carries
the key, not the label", but no case states whether the slug itself is
rewritten.

**What had to be decided.** When a project is renamed, does its slug
follow the new name (staying readable, breaking every saved URL and
bookmark) or stay as generated (surviving links, drifting from a
project renamed "Web" → "Website")?

**Options considered.**

1. **Slug follows the name.** Always readable and never stale-looking.
   Costs: every existing URL, bookmark, and shared link to that
   project breaks silently — the old slug resolves to nothing, and
   under K3's own requirement that must be an error, so the user is
   shown a failure for a link that was valid a moment ago. A rename is
   a cheap, frequent, reversible edit; making it a breaking change to
   every address is disproportionate.
2. **Slug fixed at creation.** Links survive every rename. Costs: a
   project renamed "Web" → "Website" keeps `?project=web`, so the URL
   and the display name can disagree.
3. **Slug follows, with the old slug kept as an alias.** Best of both,
   at the cost of an alias list on disk, a second uniqueness domain to
   enforce, and a `key_history`-shaped feature that no case asks for —
   inventing a requirement.

**Decided.** Option 2: the slug is generated from the name at creation
and is immutable thereafter. `editProject` does not touch it.

**Why.** Measured, not inferred: **nothing on disk stores a slug except
the project's own definition.** Tasks reference their project by ULID
(invariant P-2); the query DSL's `project` field is read generically
off frontmatter (`packages/core/src/query/evaluator.ts:142` via
`readField`), so a saved view stores a ULID too. The slug therefore
lives only in URLs and in CLI/MCP input. That is what makes this
decision contained rather than load-bearing — K3 said the rename
answer "stops the run" if it is load-bearing for saved views or shared
links, and for saved views it measurably is not. Only shared links
are affected, and option 2 is the one that preserves them.

It also matches how the rest of the tracker already treats identity:
a task key survives a project move via `key_history` (P-7), and a
prefix change preserves old keys rather than invalidating them
(`setProjectPrefix`). A stable address that drifts from a display name
is the pattern this codebase already chose.

Drift is recoverable and cheap: a user who wants the URL to match the
new name deletes and re-creates, or we add an explicit "change slug"
control later — an additive change this decision does not foreclose.

**To revert.** Make `editProject` in
`packages/core/src/projects/manage.ts` recompute the slug via
`allocateSlug` when `name` changes, and decide there whether the old
slug becomes an alias. `allocateSlug`/`slugifyName` in
`packages/core/src/projects/slug.ts` are unchanged either way. The
tests that pin the current behaviour are in
`packages/core/src/projects/slug.test.ts` (the rename case) and
`tests/integration/mcp/project-slug.test.ts`.

### A61 · The slug is optional on disk, and a nameless-in-ASCII project has none

**Ticket:** M4.1 · **Date:** 2026-09-01 · **Commit:** (uncommitted)

**The situation.** K3 owes "migration for existing trackers, which
have no slug on disk". `ProjectDefSchema` is `.strict()`, so a
required `slug` would make every pre-K3 `projects.yaml` fail
validation on load — the tracker would refuse to open rather than
migrate. Separately, a project named "日本語" or "!!!" has no
meaningful ASCII slug.

**What had to be decided.** Is `slug` required (with a migration that
rewrites every existing `projects.yaml`) or optional (with resolution
falling back to the ULID)?

**Options considered.**

1. **Required, with an eager migration on load.** Uniform data. Costs:
   a schema-version bump and a rewrite of a config file on read, which
   is a write the user did not ask for; and it still has no answer for
   a name that yields no slug.
2. **Optional, with the ULID as the fallback handle.** No migration
   step, no forced write, and pre-K3 trackers keep working untouched —
   their URLs already carry ULIDs, which K3 requires to keep
   resolving anyway. Costs: two shapes of project on disk, and
   `projectSlug()` has to be used rather than reading `.slug` directly.

**Decided.** Option 2. `slug` is `SlugKey.optional()`. New projects
get one at `createProject` and at `initLoctt`; existing ones acquire
none until re-created, and resolve by ULID as they always have.

**Why.** K3 requires resolution to accept "**both** slug and ULID, so
existing URLs keep working" — which means the ULID path must exist
regardless. Given that, a forced migration buys uniformity and nothing
functional, while costing a write to a file the user did not ask us to
touch. P-11's spirit ("leniency means keeping") points the same way:
read what is there, do not rewrite it to suit us.

The nameless case follows from the same reasoning — `slugifyName`
returns `undefined` rather than inventing `project-1`, because an
invented handle is less honest than no handle, and the ULID still
addresses the project.

**To revert.** Make `slug` non-optional in
`packages/contracts/src/projects.ts`, add a schema migration that
backfills via `allocateSlug`, and drop the `?? p.id` fallback in
`projectSlug()` (`packages/core/src/projects/slug.ts`). The tests
pinning the optional shape are the "pre-K3 project" and "omits the
slug" cases in `packages/core/src/projects/slug.test.ts`.

### A62 · Slug collisions in a git merge are de-duplicated like prefix collisions

**Ticket:** M4.1 · **Date:** 2026-09-01 · **Commit:** (uncommitted)

**The situation.** Adding slug uniqueness to `ProjectsConfigSchema`
broke `tests/integration/git/with-remote.test.ts` ("two clones that
both create a task"): `git sync` began exiting 1. Two clones that each
ran `loctt init` both mint a project named "Tasks", so both derive the
slug `tasks` with different ULIDs; `mergeById` unions them and the
merged `projects.yaml` then holds one slug twice, which the schema
rejects — leaving a file that cannot be loaded at all. Confirmed by
measurement: disabling only the slug branch of the `superRefine` made
the test pass again.

**What had to be decided.** How a merge should resolve two projects
that legitimately claim the same slug.

**Options considered.**

1. **Drop slug uniqueness.** Restores the merge, but then a URL does
   not name one project, which is the entire point of K3.
2. **Fail the sync and make the user fix it.** Honest, but it strands
   the user in a state where every command that loads
   `projects.yaml` fails, including `doctor` — and the two clones did
   nothing wrong.
3. **De-duplicate deterministically during the merge**, exactly as
   `assignProvisionalPrefixes` already does for the identical prefix
   collision.

**Decided.** Option 3: `assignProvisionalSlugs` in
`packages/core/src/git/merge.ts`, applied in the same pass as the
prefix assignment.

**Why.** This is not a new problem; it is the existing one with a
different field. `assignProvisionalPrefixes` was written for precisely
"two independently-init'ed trackers both mint `T-`", and its rules —
smaller ULID keeps the value, others get a suffix, ordering by id so
two clones converge rather than diverge — transfer unchanged. Solving
the same problem two different ways in one function would be the
inconsistency worth avoiding. A project with no slug (pre-K3, A61) is
skipped, having nothing to collide with.

**To revert.** Delete `assignProvisionalSlugs` from
`packages/core/src/git/merge.ts`, its export in
`packages/core/src/index.ts`, and its use in
`packages/core/src/git/resolve-conflicts.ts`. The tests pinning it are
the `assignProvisionalSlugs` block in
`packages/core/src/git/merge.test.ts`. Note that reverting this
without also relaxing the schema re-breaks `git sync`.

### A63 · Settings lists every section; unbuilt panels say so rather than 404

**Ticket:** M4.1 · **Date:** 2026-09-01 · **Commit:** (uncommitted)

**The situation.** M4.1 builds the settings shell and two panels
(Projects, Users); the other nineteen sections land in M4.2–M4.4.
SET-2's last bullet says "every panel reachable from the nav resolves
— no nav item routes to a 404 or an unimplemented placeholder **at M4
close**", and SET-32 forbids "a blank pane under a valid-looking URL".
Between now and M4 close, those two pull in opposite directions.

**What had to be decided.** Whether the nav lists sections whose
panels do not exist yet.

**Options considered.**

1. **List only the two built sections.** Nothing unresolved, but the
   nav then misrepresents the shape of settings, and each later ticket
   has to edit the nav as well as add its panel.
2. **List all sections; unbuilt ones render a stated "not built yet"
   pane** naming the files and the CLI that do change those settings.

**Decided.** Option 2, with a `built` flag on each entry in
`apps/web/src/client/settings/sections.ts`.

**Why.** SET-2's constraint is explicitly dated to *M4 close*, and at
that point every flag flips to `built: true` and the case is
satisfied. Until then the choice is between hiding sections that exist
in the product and showing an honest interim state; SET-32's actual
prohibition is a *blank* pane, not an explanatory one. Keeping the
section list in one data module also means a later ticket adds a panel
and flips one boolean, rather than editing nav markup — and it is what
lets the nav, the route resolution, and the not-found state read from
the same list, which is the drift SET-2's bullet is really about.

**To revert.** Filter `SETTINGS_SECTIONS` to `built` entries in
`SectionNav` and `UnknownSection`
(`apps/web/src/client/settings/SettingsShell.tsx`); the `built` field
can then be dropped. The SET-2 test in
`tests/ui/flow-settings-projects-users.spec.ts` asserts the five group
headings, not the unbuilt entries, so it survives either way.

### A64 · The create form marks a duplicate project name without blocking it

**Ticket:** M4.1 · **Date:** 2026-09-01 · **Commit:** (uncommitted)

**The situation.** PRU-35 covers "creating a project with a key that
already exists" and PRU-23 establishes that duplicate *display names*
are legal and get disambiguated rather than refused. Core agrees:
`createProject` enforces uniqueness on prefix and slug, never on name.
No case says what the create form should do when the typed name
matches an existing project.

**What had to be decided.** Whether a duplicate name is an error, a
warning, or silent.

**Options considered.**

1. **Silent.** Matches core exactly. But the user gets two
   indistinguishable rows in every picker and finds out later.
2. **Block it.** Contradicts PRU-23, which requires the app never to
   imply names must be unique.
3. **Show the problem text, leave submit enabled.**

**Decided.** Option 3: the name field shows "Another project is
already called X. Names do not have to be unique, but they will be
hard to tell apart", and submit stays enabled.

**Why.** PRU-23's "nothing in the UI implies names must be unique"
rules out blocking, and P4's preference for telling the user what they
are walking into rules out silence. Saying so without preventing it is
the only reading that satisfies both.

**To revert.** Delete the `problems.name` branch in
`validateNewProject`
(`apps/web/src/client/settings/projectForm.ts`) and the
`project-create-name-problem` element in `ProjectsPanel.tsx`. Note
that `blocked` already ignores `problems.name` for submit purposes,
so no gating logic changes.

---

### A65 · The workflow panels re-read `workflow.yaml` before every write

**Ticket:** M4.2 · **Date:** 2026-09-01 · **Commit:** (uncommitted)

**The situation.** `PUT /api/workflow` takes the **whole document**. A
panel that edits one collection is therefore implicitly re-asserting
every other collection from the copy it fetched when it mounted.

Measured, before this existed: with `/settings/statuses` open, adding
a status to `workflow.yaml` by hand and then dragging a row **deleted
the hand-added status**. No error, no warning — the panel's stale
`statuses` array simply won, and the server accepted it because
nothing on disk referenced the deleted key. SET-28 forbids exactly
this ("the panel does not save a stale copy over the new file").

**What had to be decided.** How a panel avoids clobbering a file that
changed underneath it, given a whole-document PUT and no `If-Match`
anywhere in the config write path.

**Options considered.**

1. **Add a version/ETag precondition to `PUT /api/workflow`**, the way
   K2/K10 did for task bodies. Correct and general, but it is a new
   concurrency primitive on the config path, needs a token derived
   from the file, and would have to be plumbed through CLI and MCP to
   avoid being a web-only guard. Out of proportion to this ticket.
2. **Poll and warn.** Detects the change only if the panel happens to
   refetch; the race is still open at the moment of the write.
3. **Re-read immediately before the PUT and apply the edit to what was
   read.** Chosen.

**Decided.** Option 3, as `useSaveWorkflowCollection`
(`apps/web/src/client/api/hooks/useWorkflowMutations.ts`). The panel
describes its edit as a *function of the fresh document* — by key, not
by index — rather than handing over a whole document built from its
own copy. Rows the panel never saw are appended rather than dropped;
rows it deleted stay deleted, because those deletions came from the
remap dialog and are intentional.

**Why.** SET-28 admits either answer ("either it re-reads before
writing or it detects the change and says so"), and this is the one
that does not invent a concurrency protocol the other two surfaces
would then lack. The remaining window is the request round-trip, not
the whole time the panel sat open, and `applyWorkflowEdit` holds the
state lock across the write itself.

**Known limit, deliberately accepted.** Two people reordering the
*same* collection simultaneously still last-write-wins. Merging two
orderings has no correct answer, and no case asks for one. A
precondition (option 1) is what would close it, and that is a decision
about the whole config write path rather than about these panels.

**To revert.** Delete `useSaveWorkflowCollection` and
`ConcurrentWorkflowEditError` from `useWorkflowMutations.ts` and point
the four panels back at `useSaveWorkflow`, passing
`{workflow: {...workflow, [collection]: next}}`. `useSaveWorkflow` is
still exported and unchanged.

**Test.** `tests/ui/flow-settings-workflow.spec.ts` — "SET-28: a
hand-rewrite under an open panel is not overwritten by a stale copy".
Shown to fail: replacing the re-read with
`qc.getQueryData(["workflow"])` (the pre-fix behaviour) reddens it.

---

### A66 · Reference counts are a separate endpoint, not part of `GET /api/workflow`

**Ticket:** M4.2 · **Date:** 2026-09-01 · **Commit:** (uncommitted)

**The situation.** SET-17 and SET-19 need the number of tasks holding
a key *before* the delete is confirmed. Core had
`computeWorkflowKeyUsage`, which returns `Set`s — presence, which is
all `validateRemapCoversDeletions` needs and which cannot answer "how
many".

**What had to be decided.** Where counts come from, and whether to
widen the existing usage function.

**Options considered.**

1. **Widen `computeWorkflowKeyUsage` to return Maps.** Its membership
   checks are on the hot path of every workflow write and gain nothing
   from carrying counts.
2. **Fold counts into `GET /api/workflow`.** That response is the
   config document itself, read on nearly every render by the list
   view and every status dropdown. Counting requires walking every task
   on disk, which would put a full tracker scan behind a config fetch.
3. **A separate `computeWorkflowKeyCounts` in core, behind
   `GET /api/workflow/usage`.** Chosen.

**Decided.** Option 3. The response also carries `path` — the absolute
path of `workflow.yaml`, which SET-3 wants shown — because it comes
from the same read and two requests could disagree.

A relationship is counted **once per task**, not once per link: the
number means "tasks a remap would rewrite", and a task with three
`blocks` links is one task.

**Why.** The two questions have different costs and different callers.
Keeping them apart means the panels pay for the scan and nothing else
does.

**Surfaces.** Per the standing rule that a core capability is not done
until CLI and MCP have it: `loctt config usage` and the MCP
`get_workflow_key_usage` tool, both documented in the reference docs
and covered by integration tests that assert the two agree.

**To revert.** Delete `computeWorkflowKeyCounts` from
`packages/core/src/config/workflow-write.ts` and its two barrel
exports, the `/api/workflow/usage` route and `WorkflowUsageResponse`
contract, `useWorkflowUsage`, the `usage` branch of
`apps/cli/src/commands/config.ts`, and the `get_workflow_key_usage`
MCP tool. The panels then render `0` for every count, and
`WorkflowPanelFrame` falls back to the relative config path.

**Test.** `packages/core/src/config/workflow-key-counts.test.ts` (6),
`apps/web/src/server/server.workflow-panels.test.ts`,
`tests/integration/cli/config-usage.test.ts`,
`tests/integration/mcp/get-workflow-key-usage.test.ts`. Shown to fail:
`bump` assigning `1` instead of incrementing reddens four core tests;
counting per link rather than per task reddens the relationship test;
pooling custom-field values under one key reddens two more.

---

### A67 · SET-22's "the panel accepts it" is implemented as "the panel refuses it, and says why"

**Ticket:** M4.2 · **Date:** 2026-09-01 · **Commit:** (uncommitted)

**The situation.** SET-22's first bullet: "The panel accepts it but
warns explicitly that no working days remain." `CalendarConfigSchema`
(`packages/contracts/src/calendar.ts`) has a `superRefine` that
**rejects** an empty `working_days` outright — "working_days must name
at least one day" — and `loadCalendarConfig` would refuse to read the
file back. A panel that "accepted" it would send a request the server
returns 400 for, and a file written by hand that way would make the
whole calendar unreadable.

**What had to be decided.** Whether to change the schema so the panel
can accept it, or change the panel's behaviour.

**Options considered.**

1. **Relax the schema.** Every consumer of `working_days` would then
   have to decide what an empty week means — which is the reason the
   schema's own comment gives for rejecting it. It would also make an
   existing invariant weaker to satisfy one bullet of one case.
2. **Let the panel send it and surface the 400.** The user gets a
   server error for something the panel could have told them, and
   ERR-16 wants the cause named where it is known.
3. **Block before the request, with the case's own explanation.**
   Chosen.

**Decided.** Option 3. The panel disables Save and shows
`calendar-no-working-days`: "No working days are left. Working-day
computations — 'due this week', 'N working days from today' — cannot
resolve against an empty week, and calendar.yaml will not accept one."

**Why.** The substance of SET-22 is that the user is told
working-day computations will not resolve and is not left with a
silently broken calendar. That holds. Only the mechanism differs, and
the alternative weakens a schema invariant to make a worse outcome
possible.

**Not satisfied by this.** SET-22's other three bullets — date pickers
rendering every day non-working, "N working days from today" returning
a designed state, Diagnostics flagging it — describe a tracker that
*is* in that state, which this config cannot reach through any
supported path. Recorded in `known-gaps.md`.

**To revert.** Drop `noWorkingDays` from `blocked` in
`apps/web/src/client/settings/CalendarPanel.tsx` and delete the
`calendar-no-working-days` alert.

---

### A68 · The web's data deletes are hard-by-default, with `?soft=true` for archive

**Ticket:** M4.3 · **Date:** 2026-09-01 · **Commit:** (uncommitted)

**The situation.** `DELETE /api/labels/:id`, `/api/milestones/:id` and
`/api/views/:ref` all called core's delete with no `hard` option. Core
defaults `hard` to `false`, which **archives**. So all three answered
`200 {"deleted": <id>}` while leaving the entry on disk with
`archived: true` — a user who deleted a label still had it. Measured,
not inferred: a probe against a real tracker returned
`{"deleted":"01M1D6…","affectedTaskCount":0}` with the id still in
`labels.yaml`.

Worse, `?remap_to=` was **unreachable over HTTP**. Core's soft path
throws when `remapTo` is set, so MSL-12's remap came back as
`400 --remap-to only applies to --hard delete` — a CLI flag name
leaked into an HTTP response, for the one operation MSL-12 exists to
require.

This is the third instance of the defect M4.1 fixed for
`DELETE /api/projects/:id`.

**What had to be decided.** Which of hard or soft is the default for
the web, given the CLI passes `hard: true` explicitly and the flow
docs demand a working remap.

**Options considered.**

1. **Keep archiving, expose `?hard=true`.** The verb DELETE would keep
   meaning "archive" by default, and every existing caller would keep
   getting the wrong behaviour silently. It also leaves the remap
   unreachable unless the flag is passed, so MSL-12 stays broken for
   anyone who does not know about it.
2. **Hard by default, `?soft=true` to archive.** Chosen.

**Decided.** Option 2, for all three routes. `hard: !soft` where
`soft = searchParams.get("soft") === "true"`. This matches the
contract M4.1 landed for projects, matches what `loctt label delete`
does, and makes `remap_to` reachable.

**Why.** DELETE meaning "archive" is a lie the response body actively
tells. The archive intent still has a route — for labels it is now the
dedicated `/archive` and `/unarchive` endpoints (MSL-10), and for
views and milestones it is `?soft=true`.

**Not satisfied by this.** Nothing regresses; archive stays reachable
by an explicit opt-in.

**To revert.** In `apps/web/src/server/server.ts`, drop the `soft`
const and the `hard: !soft` argument from `handleDeleteLabel`,
`handleDeleteMilestone` and `handleDeleteView`, and delete
`apps/web/src/server/server.data-delete.test.ts` plus the
`saved-view delete and unarchive` block in
`server.views-invalid.test.ts`.

---

### A69 · The Git panel ships without a reconciliation UI, because there is no reconciliation model

**Ticket:** M4.3 · **Date:** 2026-09-01 · **Commit:** (uncommitted)

**The situation.** M4.3 owes GIT-1..GIT-38. Twenty-four of those cases
describe a reconciliation surface: per-task rows, per-field local vs
remote values, keep-local / keep-remote / pick-value, an Apply that
writes the chosen values and reports partial failure, and a rekey
summary confirmed before it applies.

**Measured, with a positive control.** `ReconcileState` in
`packages/contracts/src/state.ts:43-49` is a `.strict()` object with
exactly four fields — `mode`, `base_commit`, `remote_commit`,
`started_at`. There are no per-task entries, no per-field decisions and
no chosen sides. `packages/core/src/state/reconcile.ts` exports only
load / save / clear / parse / serialize. A grep for any decision-apply
function (`applyReconcil|resolveReconcil|reconcileDecision|keepLocal|
keepRemote|pickValue`) across `packages/core/src`, `apps/cli/src` and
`apps/web/src` returns **0 hits**; the same grep technique returns
real hits for `GitConflictError` in the same tree. `GitConflictError`
itself carries a flat `readonly string[]` of file **paths**, not
fields. And the CLI has no reconcile command at all — `git.ts:14-21`
states that is deliberate.

So `reconcile.yaml` is a crash sentinel, not a decision model, and the
data those 24 cases render does not exist anywhere to be rendered.

**What had to be decided.** Whether to build a reconciliation engine
in core to satisfy them, or ship the panel that the existing model
supports and say plainly which cases are not met.

**Options considered.**

1. **Build the engine.** A three-way per-field decision model,
   persistence of partial decisions, a resumable apply with partial-
   failure reporting, and a confirmed rekey pass. That is a core
   subsystem — it changes `ReconcileStateSchema`, `GitConflictError`,
   `sync`/`publish` return types, and owes CLI and MCP surfaces too
   (CLAUDE.md: a capability in core is not done until both have it).
   It is a ticket, not a panel, and it would change M4.3's scope.
2. **Render a fake panel over the sentinel.** The rows would have to
   be invented from file paths. Shape (a) vacuity by construction, and
   worse than nothing: it would claim to have resolved conflicts it
   never saw.
3. **Ship what the model supports; report the rest.** Chosen.

**Decided.** Option 3. `GitSyncPanel.tsx` covers enable/disable with
their pre-run disclosures, status (branch, remote, short commit, the
two drift readouts), publish, sync, the no-remote and not-a-repo
refusals, the unreadable-`sync.yaml` state, and GIT-18's first duty —
detecting an in-progress reconciliation and **blocking** publish and
sync rather than starting a second one. The 24 reconciliation cases
are reported unmet rather than tagged.

**Why.** Building the engine changes the ticket's scope, which is a
stop-the-run condition. Faking the panel is the vacuity this run has
been finding all along.

**Not satisfied by this.** GIT-5, GIT-6, GIT-7, GIT-8, GIT-9, GIT-11,
GIT-12, GIT-13, GIT-14, GIT-15, GIT-16, GIT-17, GIT-19, GIT-21,
GIT-22, GIT-23, GIT-25, GIT-26, GIT-29, GIT-31, GIT-32, GIT-33,
GIT-34, GIT-35, GIT-36, GIT-37. Listed in `known-gaps.md`
under the git-reconcile entries.

**To revert.** Delete `apps/web/src/client/settings/GitSyncPanel.tsx`
and `apps/web/src/client/api/hooks/useGit.ts`, and set `sync` back to
`built: false` in `sections.ts`.

---

### A70 · GIT-4's remote drift is rendered as a boolean, because core does not count it

**Ticket:** M4.3 · **Date:** 2026-09-01 · **Commit:** (uncommitted)

**The situation.** GIT-4 asks for local drift and remote drift "as two
separate counts, not one combined 'out of sync'".
`GitStatusResult` (`packages/core/src/git/git-mode.ts:17-65`) gives
`localChanges?: number` but `remoteChanges?: boolean` — computed as
`branchCommit !== state.git.last_synced_commit`. Core knows *that* the
branch moved, not by how much.

**What had to be decided.** Whether to compute a remote count in the
web layer, or render the boolean core actually has.

**Options considered.**

1. **Count remote changes in the web server.** It would mean diffing
   the branch against the last synced commit in a second place, with
   its own answer, which is exactly the drift CLAUDE.md warns about —
   two surfaces answering the same question differently.
2. **Render the boolean, keep the two readouts separate.** Chosen.

**Decided.** Option 2. The panel shows two distinct rows with distinct
`data-` attributes (`data-git-local-drift`, `data-git-remote-drift`),
never one combined "out of sync". Local is a count; remote reads "the
branch has moved since the last sync". Both distinguish `undefined`
("could not determine") from zero/false, which core's docstring is
emphatic about.

**Why.** GIT-4's substance is that the two directions are reported
separately and a stale zero is not mistaken for a fresh one — both
hold. Only the remote side's granularity differs, and inventing a
count in a second place would be worse than reporting honestly.

**Not satisfied by this.** GIT-4's literal "two counts". The remote
side is a boolean.

**To revert.** In `GitSyncPanel.tsx`, replace the remote-drift row's
boolean rendering with a computed count, which requires a new core
function to produce it.

### A119 · GIT-2/GIT-3 are tagged for their no-op distinction and far-end, not their task-and-field granularity; GIT-30 is re-classified as unmet

**Ticket:** M4.3 (git-sync UI test batch) · **Date:** 2026-09-04 · **Commit:** (uncommitted)

**The situation.** The git-sync UI test batch owed 20 non-conflict
cases (GIT-1, 2, 3, 4, 9, 16, 19, 20, 22, 23, 24, 25, 27, 28, 29, 30,
33, 34, 35, 36). A69 had already recorded that the reconciliation /
rekey / granularity engine does not exist, listing most of these as
unmet — but two facts needed settling before tagging:

1. **GIT-2 and GIT-3 are partly unmet, yet A69 did not list them.**
   GIT-2's second/third bullets ask Publish to "name the three tasks by
   key ... at field granularity" and "report the new
   `last_synced_commit`" *in the result*. GIT-3's second bullet asks
   Sync to "distinguish created from updated". `SyncOutcome` reports
   file counts (`copied`/`merged`/`deleted`) in one bucket and the
   publish result carries no commit — the exact granularity A69's own
   "task-and-field granularity" paragraph records as absent. So GIT-2
   and GIT-3 are *partially* satisfiable, not fully.

2. **GIT-30 is not satisfiable, though A69 omitted it and
   `GitSyncPanel.tsx`'s header comment claims it.** Measured: with
   `origin` pointed at a nonexistent path, `POST /api/git/sync` returns
   **HTTP 200** with `{updated:false, fetched:false, fetchError:"…"}` —
   the panel's *success* branch with a soft warning, not an error
   surface. GIT-30 requires the message to "name the remote", say
   "could not be reached" as distinct from "nothing to sync", state
   local state is untouched, and *offer Retry*. The 200-with-warning
   path names none of these, the `fetchError` string is a truncated git
   stderr fragment ("and the repository exists."), and no Retry control
   renders because it is not the error branch. The `git-sync-error`
   block is only reachable on a non-2xx (reconcile-block or a thrown git
   error), which the network-down case is not.

**What had to be decided.** Whether to tag GIT-2/GIT-3 at all given the
unmet bullets, and whether to trust A69's implicit "GIT-30 is met".

**Options considered.**

1. **Decline GIT-2 and GIT-3 entirely.** They each carry a real,
   far-end-verifiable behaviour the panel *does* implement — the
   no-op-vs-success distinction (`data-git-publish`
   committed/nothing-to-publish; `data-git-sync` updated/no-op) and, for
   GIT-2, a commit that actually lands on the bare remote. Declining
   them would leave that genuine behaviour untested.
2. **Tag GIT-2/GIT-3 for the bullets the model supports, and record the
   unmet bullets here.** Chosen. Tag GIT-30 nowhere — it is unmet.

**Decided.** Option 2.
- **GIT-2** is tagged asserting: the first publish's commit reaches the
  bare remote's `loctt` ref and equals `last_synced_commit`; the second
  publish renders the *distinct* "nothing to publish" outcome and moves
  no ref. **Not** asserting per-task/per-field naming or a commit in the
  result — those have no data.
- **GIT-3** is tagged asserting: the remote's two new tasks land on disk
  and appear in the list without a forced reload; `last_synced_commit`
  advances to the remote head; a second sync renders the *distinct*
  no-op. **Not** asserting created-vs-updated — one file-count bucket.
- **GIT-30** is left untagged and recorded in known-gaps.md.

**Why.** The build-loop bar is that a tag asserts the case's substance,
not that the case ID appears in a comment. GIT-2/GIT-3 have substance
the panel meets and far-end state that proves it; tagging them for that,
with the gaps recorded, is honest. GIT-30 has no branch that meets its
requirement, so tagging it would be the "green hides a gap" failure the
loop exists to catch.

**Not satisfied by this.** GIT-2's task/field-granularity and
commit-in-result bullets; GIT-3's created-vs-updated bullet; GIT-30
entirely; and the pre-existing A69 declines that fell in this batch
(GIT-9, 16, 19, 22, 23, 25, 29, 33, 34, 35, 36).

**To revert.** Delete the `GIT-2`, `GIT-3` and (if added later) `GIT-30`
tags in `tests/ui/flow-git-sync.spec.ts`. The fixture and the other
tags stand independently.

### A128 · `theme` and `sidebar_pins` become typed fields on `UserSettingsSchema`

**Ticket:** M4.4 · **Date:** 2026-09-01 · **Commit:** (uncommitted)

**The situation.** `UserSettingsSchema` is `.passthrough()`, and both
`theme` and `sidebar_pins` already round-tripped as unknown keys — the
schema's own test names them as examples of UI-only keys. SET-11 and
SET-13 make both load-bearing: the theme must survive a user switch,
and the pins carry sidebar order.

**What had to be decided.** Whether to keep them as passthrough keys or
model them.

**Options considered.**

1. **Leave them untyped.** A hand-edited `theme: solarized` or a
   repeated pin reaches the client and has to be defended against at
   every read site. `card_layout` was modelled for exactly this reason.
2. **Model them in contracts.** Chosen. `ThemePreferenceSchema` is the
   three-value enum the UI already implements; `SidebarPinsSchema`
   rejects repeats, mirroring `CardLayoutSchema`'s no-repeat refine.

**Decided.** Option 2. Both are optional fields on
`UserSettingsSchema`; `.passthrough()` is retained, so every *other*
UI-only key still survives a round trip (P7).

**Why.** Typing a key that two cases depend on moves the check to the
one place both surfaces read through, rather than each consumer
guessing. It does not narrow the passthrough policy for anything else.

**To revert.** Delete `ThemePreferenceSchema` and `SidebarPinsSchema`
from `packages/contracts/src/users.ts` and remove `theme` /
`sidebar_pins` from `UserSettingsSchema`'s object shape. Both keys keep
working as passthrough values.

---

### A129 · The pin sweep lives in core and ships to CLI and MCP

**Ticket:** M4.4 · **Date:** 2026-09-01 · **Commit:** (uncommitted)

**The situation.** SET-13 and SET-27 need "which of these pins point at
views that no longer exist". Nothing in `packages/core` answered it —
`grep`ed `packages/core/src/index.ts` first, per the run workflow.

**What had to be decided.** Whether the sweep is web-only UI logic or a
core capability, given the layer rule's cost: core means CLI and MCP
get it too.

**Options considered.**

1. **Put it in `apps/web`.** Cheapest. But `loctt doctor` already
   reports dangling references of other kinds, and a user who hand-edits
   `queries.yaml` from a terminal has no way to repair their pins
   without opening the web UI.
2. **Put it in core, with all three surfaces.** Chosen.

**Decided.** Option 2. `packages/core/src/users/pins.ts` exports
`readSidebarPins` and `sweepSidebarPins`; the CLI gains
`loctt user settings [--sweep-pins]` and MCP gains `get_user_settings`
and `sweep_sidebar_pins`.

**Why.** The layer test is "would two surfaces have to answer the same
question?" — and three do. Building it in `apps/web` would have made it
the eleventh core-adjacent capability reachable from exactly one place.
`users/pins.js` is also added as a package subpath export so the client
can import it without pulling `node:path` through core's barrel, which
is the precedent `board/columns.js` already set.

**Not satisfied by this.** The sweep is not wired into `loctt doctor`
as a reported check; PRU-14's `doctor` bullet concerns
`default_project`, not pins, and no case in M4.4 asks for a pins check
there.

**To revert.** Delete `packages/core/src/users/pins.ts` and its
exports, the `settings` case in `apps/cli/src/commands/user.ts`, and
the two MCP tools; inline the partition in `SidebarPinsPanel.tsx`.

---

### A72 · `DELETE /api/views/:ref` hard-deletes, matching the projects route

**Ticket:** M4.4 · **Date:** 2026-09-01 · **Commit:** (uncommitted)

**The situation.** `handleDeleteView` called `deleteView(locttDir, ref)`
with no options. `deleteView`'s default is the **archive** branch, so a
DELETE left the view in `queries.yaml` with `archived: true`. VUE-38's
third bullet requires the opposite: "Deletion removes the entry from
`queries.yaml`; `loctt list --view <name>` then reports an unknown
view."

**What had to be decided.** Whether this is a defect to fix or the
intended contract to build around.

**Options considered.**

1. **Treat archive as intended and satisfy VUE-38 elsewhere.** There is
   nowhere else — the case is about what DELETE does to the file.
2. **Make DELETE hard-delete unless `?soft=true`.** Chosen. This is the
   exact shape `handleDeleteProject` already uses, and its comment
   records the identical defect being fixed under PRU-17.

**Decided.** Option 2. `const hard = url.searchParams.get("soft") !== "true"`,
passed through to `deleteView`. Archive keeps its own route (`PUT` with
`archived: true`).

**Why.** Two sibling routes disagreeing about what DELETE means is
drift, and the projects route already settled which way. No existing
test asserted the archive behaviour — verified by grep — so nothing was
encoding it as intended.

**To revert.** Restore `await deleteView(locttDir, ref);` in
`apps/web/src/server/server.ts`. Note that VUE-38 then fails.

---


**CORRECTION, 2026-09-01 — the defect this records does not reproduce.**
Measured against a real tracker on **both** binaries: baseline and
fixed each return HTTP 200 and each leave `queries: []` — the view is
genuinely removed either way. Core's archive branch is real
(`views/manage.ts:166`, and `archiveView` sets `archived: true` while
keeping the entry), so the reading of the code was right; the route's
*observable* behaviour was already correct. Passing `hard` explicitly
is kept because it matches the other three delete routes and removes
the ambiguity, but **this was not a live bug** and must not be cited
as one. The PRU-17/M4.1 project-delete defect and M4.3's label and
milestone defects DID reproduce; this one did not.
### A71 · SET-13's "dropped silently" is treated as superseded by SET-27

**Ticket:** M4.4 · **Date:** 2026-09-01 · **Commit:** (uncommitted)

**The situation.** SET-13's third bullet says a stale pin is "dropped
**silently** from both the panel and the sidebar". SET-27's second
bullet says the panel "**says** the pins were removed because their
views no longer exist, rather than silently emptying". Same file, same
P7 tag, opposite requirements, 115 lines apart.

**What had to be decided.** Nothing, on inspection — but it was carried
into the ticket as a possible stop-and-ask, so the resolution is
recorded rather than left to be re-derived.

**Decided.** SET-27 governs. `docs/dev/ui-test-cases/README.md:191-198`
already settles it: "No carve-out for per-user preference drift ...
This resolves the SHL-32 / SET-13 / SET-27 / XS-28 disagreement in
favour of the explaining cases." SET-13's other three bullets — the
drag list, the persisted order, and not sweeping views that merely
match zero tasks — are implemented as written.

**Why.** The amendment names SET-13 explicitly as one of the cases it
corrects. Its bullet text was simply never updated to match.

**Not satisfied by this.** The spec text still reads as a
contradiction for the next agent. The flow docs are read-only, so
SET-13 was not edited; the stale wording is reported instead.

**To revert.** Nothing to revert in code without also reverting
SET-27's coverage. If the amendment is ever withdrawn, delete the
`pins-swept-notice` block in `SidebarPinsPanel.tsx`.

---

### A100 · A modal defers Escape to any open layer inside it, detected by `aria-expanded`

**Ticket:** a11y Group 3/4 · **Date:** 2026-09-03 · **Commit:** (uncommitted)

**The situation.** A11Y-5 requires "`Esc` closes the topmost dismissible
layer, one at a time": a dropdown open inside the create modal must take
the first Escape and leave the modal open. Measured: one Escape closed
both. `OptionPicker` calls `e.stopPropagation()` on its own document
listener, but `CreateTaskModal` also listens on `document` in the
capture phase and mounts first, so capture order — which is registration
order — gave the modal the keystroke first.

**What had to be decided.** How should the modal know a layer above it
is open, so it can decline the keystroke?

**Options considered.**
1. *Move the pickers' listeners to capture with higher priority.* Not
   expressible: the DOM offers no priority within a phase, only
   registration order, which the modal wins by construction.
2. *A layer-registry context that dialogs and pickers both push to.*
   Correct in the general case, but a new cross-cutting mechanism for
   one keystroke, and every future layer must remember to register.
3. *The modal checks its own panel for `[aria-expanded="true"]` before
   claiming Escape.* Costs nothing structurally and works for any layer
   that already marks itself expanded — but it is a convention, not an
   enforced contract, so a future layer that opens without setting
   `aria-expanded` would not be protected.

**Decided.** Option 3: `CreateTaskModal`'s Escape branch returns early
when `panelRef.current.querySelector('[aria-expanded="true"]')` matches
and the discard confirmation is not showing.

**Why.** `aria-expanded` is not an ad-hoc marker invented for this — it
is already required on every disclosure the app builds, by A11Y-31 and
by the pickers' own cases, so the convention is one the codebase must
hold anyway. That makes option 3 free where option 2 adds a mechanism.
The discard confirmation is checked first because it renders above
everything else in the modal and must keep its own Escape (NEW-31).

**To revert.** `apps/web/src/client/create/CreateTaskModal.tsx`, the
`if (e.key === "Escape")` branch of the `useEffect` keydown handler —
delete the early return. `tests/ui/flow-accessibility.spec.ts`'s
"A11Y-5" test then fails, which is the intended signal.

### A101 · A global `:focus-visible` ring, coloured `--text-primary` at a 2px offset

**Ticket:** a11y Group 3/4 · **Date:** 2026-09-03 · **Commit:** (uncommitted)

**The situation.** A11Y-16's second bullet requires the focus indicator
to be "visible against the element's own background in both themes,
including on coloured elements (status chips, label pills, primary
buttons)". The app defined no focus style at all, so every control used
Chrome's default `outline: auto`, painted in Chrome's own accent blue.
Measured against the header's primary button, itself `bg-accent`: the
ring came out at **1.05:1** in light and **1.71:1** in dark. The button
gave no visible sign of being focused.

**What had to be decided.** What focus indicator should the app paint,
given it must clear 3:1 against both the page and every accent surface,
in both themes?

**Options considered.**
1. *Per-component rings.* Precise, but the case is "every focusable
   element" and one component added later without the class is a silent
   regression — the same argument `index.css` already records for the
   reduced-motion block.
2. *A global ring in the accent colour.* Matches the app's palette and
   fails the case: accent-on-accent is the defect being fixed.
3. *A global ring in `--text-primary` at a positive offset.* Near-black
   in light and near-white in dark, so it clears 3:1 against the page
   and every accent surface; the offset puts it outside the control so
   a dark ring on a dark button still reads. Costs a ring that is
   monochrome rather than brand-coloured.

**Decided.** Option 3: `:focus-visible { outline: 2px solid
var(--text-primary); outline-offset: 2px; }` in `index.css`'s base
layer.

**Why.** Same reasoning the file already applies to reduced motion — a
global rule because the requirement is universal and a per-component
opt-in regresses silently. `:focus-visible` rather than `:focus` keeps
the ring off mouse clicks while still satisfying the case's third
bullet, since a control focused by keyboard after being clicked matches
`:focus-visible`. The monochrome ring is a deliberate trade: it is the
only colour that clears the bar against every surface the app paints in
both themes.

**To revert.** `apps/web/src/client/styles/index.css`, the
`:focus-visible` rule in `@layer base` — delete it. Both A11Y-16 tests
in `tests/ui/flow-accessibility.spec.ts` then fail.

### A102 · The active sidebar route is marked with `aria-current` and a weight change

**Ticket:** a11y Group 3/4 · **Date:** 2026-09-03 · **Commit:** (uncommitted)

**The situation.** A11Y-30's fourth bullet: "the active sidebar route is
marked by more than a colour change — a persistent indicator bar, bolder
weight, or the current-page state exposed to assistive tech".
`ItemShell` marked it with `bg-accent-muted text-accent` and nothing
else: colour and background only, with `font-medium` unconditional.

**What had to be decided.** Which of the bullet's three alternatives to
build.

**Options considered.**
1. *An indicator bar.* A visual change only — a screen reader still
   learns nothing about which route is current.
2. *`aria-current="page"` alone.* Satisfies the bullet as written (the
   three are offered as alternatives) but leaves a greyscale screenshot
   unchanged, which is the section's framing.
3. *Both `aria-current` and a weight change.* Covers the assistive-tech
   half and the greyscale half. Costs a slight visual change to the
   sidebar.

**Decided.** Option 3: `aria-current="page"` on the active `ItemShell`,
plus `font-semibold` for active against `font-medium` for inactive.

**Why.** The case's own heading is "Colour is never the sole carrier of
meaning" and it asks for the state to be inspectable "in greyscale", so
an assistive-tech-only fix satisfies the letter and not the case. The
weight change is the smallest visual signal that survives greyscale.

**To revert.** `apps/web/src/client/shell/Sidebar.tsx`, `ItemShell` —
remove the `aria-current` prop and restore the unconditional
`font-medium`. The A11Y-30 sidebar assertions then fail.

### A103 · An over-cap board column carries a named warning glyph

**Ticket:** a11y Group 3/4 · **Date:** 2026-09-03 · **Commit:** (uncommitted)

**The situation.** A11Y-30's second bullet asks that an over-cap column
be "identifiable without colour (a count like `6 / 4` **and** a warning
glyph with an accessible name), not by a red header alone". The column
header showed the count, which is half of it; over-cap and at-cap were
otherwise distinguished only by `text-danger-fg` versus
`text-warning-fg`, plus a `data-wip-state` attribute that neither a
greyscale screenshot nor a screen reader can see.

**What had to be decided.** Whether the existing "6 / 4" count already
satisfies the bullet, and if not, what to add.

**Options considered.**
1. *Treat the count as sufficient.* Defensible reading — the numbers are
   readable in greyscale. But the bullet says "and a warning glyph",
   and the numbers alone do not say that 6/4 is a violation rather than
   a target.
2. *A glyph marked `aria-hidden`, as decoration beside the count.*
   Restores the greyscale signal and leaves a screen reader with only
   the numbers, which the bullet's "with an accessible name" rules out.
3. *A glyph with `role="img"` and a name stating the state.*

**Decided.** Option 3: a `⚠` with `role="img"` and
`aria-label="Over WIP limit: N of M"`, rendered only in the `over`
state.

**Why.** The bullet names both parts explicitly with "and", and the
accessible name is what makes the glyph carry meaning rather than
repeat colour in another form. Rendered only when over-cap so at-cap
keeps its quieter treatment, which BRD-6 distinguishes.

**To revert.** `apps/web/src/client/board/BoardView.tsx`, the `{over &&
(...)}` block in the column header's count `<span>` — delete it. The
A11Y-30 over-cap test then fails.

### A112 · Editing a comment deleted elsewhere gets the delete path's "already gone" message

**Ticket:** M2.4 (CMT batch) · **Date:** 2026-09-04 · **Commit:** (this one)

**The situation.** CMT-24 (major, P1): "Editing a comment that was
deleted elsewhere fails cleanly", first bullet "The save reports that
the comment no longer exists." `handleDeleteComment` already translates
core's `unknown comment id: <ulid>` into "That comment is already gone
— someone else deleted it…" (citing CMT-34). `handleEditComment` did
**not**: it relayed the raw core message verbatim as a generic 400,
leaking a ULID the user never typed and reading as malformed input.
Edit text was already preserved (the composer stays open on error), so
only bullet one failed.

**What had to be decided.** Fix the edit path to match the delete
path's translation, or decline CMT-24 as unimplemented?

**Options considered.**

1. **Fix — mirror the delete handler.** Small, follows an established
   in-repo pattern two functions down. Costs: a server behaviour
   change (an envelope's code/message/recovery for one error case).
2. **Decline.** Costs: leaves a major P1 case unsatisfied over a
   one-branch omission the delete path already showed how to handle;
   the "report that the comment no longer exists" bullet stays failed.

**Decided.** Option 1 — added a `unknown comment id` branch to
`handleEditComment` returning "That comment is already gone — someone
else deleted it. Your edit was not saved; refreshing will bring this
list up to date." with `REJECTED_WRITE_NO_RETRY` + `recovery: reload`.

**Why.** The translation already exists for the identical core error on
the delete path (CMT-34); not doing it on edit was an inconsistency,
not a design choice — the delete handler's own comment says the raw
message "reads as a malformed-input error, and the id it names is one
the user never typed and cannot act on."

**To revert.** `apps/web/src/server/server.ts`, `handleEditComment`'s
catch — remove the `if (/unknown comment id/i.test(raw))` block so it
falls through to `error(res, raw, 400, { ...REJECTED_WRITE, field:
"body" })`. The CMT-24 UI test (`tests/ui/flow-comments.spec.ts`) and
the server unit test (`server.comments.test.ts`, "editing a comment
deleted elsewhere…") then fail.

### A113 · A field write blocked by the migration lock is a `schema_mismatch`, not a generic 500

**Ticket:** M2.2 (TSK batch) · **Date:** 2026-09-04 · **Commit:** (this one)

**The situation.** TSK-56 (minor, P4): "A save blocked by an
in-progress schema migration is explained" — the failure must state
the tracker is being migrated, the change was not saved, and the user
should wait, "rather than being shown a generic error". A field write
during a held migration lock is refused inside `withStateLock` (which
checks `isMigrationLocked` both sides of acquiring the state lock),
throwing `SchemaVersionError` **before** any mutation. But
`handleSetField` caught only `LocttError` and `ZodError`;
`SchemaVersionError` is a plain `Error`, so it fell through to the
top-level fallback and returned HTTP 500 `code: "unknown"` with the
real cause buried in `detail`. The optimistic value already rolls back
(second bullet held); bullets one and three failed. This is a distinct
state from the boot-guard version mismatch handled far above — the
on-disk version is fine, a concurrent `loctt migrate` merely holds the
lock — so the guard never fires and the request reaches `handleSetField`.

**What had to be decided.** Where and how to classify the
migration-lock error so the surface can explain it, without a
schema-version bump?

**Options considered.**

1. **Catch `SchemaVersionError` in `handleSetField`** and emit a
   `schema_mismatch` envelope (`data_state: not_saved`, `recovery:
   retry`), carrying core's own "A schema migration is in progress…
   Wait…" message. The client's generic `fieldFailure` branch already
   renders a `not_saved` message with Retry, so no client change is
   needed. Costs: one server branch.
2. **Make `SchemaVersionError` a `LocttError`** so `toEnvelope` carries
   it. Costs: changes an error class used across CLI/MCP/core with its
   own tests; far wider blast radius for a web-only symptom.
3. **Decline.** Costs: a stated, buildable case left unsatisfied.

**Decided.** Option 1 — a `SchemaVersionError` branch in
`handleSetField` returning 409 `schema_mismatch`, `not_saved`, `recovery:
retry`, message = core's migration text.

**Why.** Smallest correct change, and it reuses the existing
`schema_mismatch` ErrorCode (a first-class cause designed for schema
states) and the existing client `not_saved`+retry rendering. `retry`
is right because the block is transient: once the migration finishes,
the same edit succeeds. Option 2's broader reclassification is not
warranted by a web-surface bullet.

**To revert.** `apps/web/src/server/server.ts`, `handleSetField`'s
catch — remove the `if (err instanceof SchemaVersionError)` block so it
falls through to `throw err` (the generic 500). The TSK-56 UI test
(`tests/ui/flow-task-failure.spec.ts`) and the server unit test
(`server.migration-lock.test.ts`) then fail.

### A114 · CMT-20 is declined — comments render flat, with none of the four scale affordances

**Ticket:** M2.4 (CMT batch) · **Date:** 2026-09-04 · **Commit:** (this one)

**The situation.** CMT-20 (major, P9): "80 comments render without
collapsing the page", with four bullets — the list is scrollable or
progressively loaded and the composer stays reachable without
scrolling past all 80; a paginated list states the remaining count;
posting scrolls to the new comment; a very long single comment is
truncated with "Show more". `CommentsPanel` renders the entire thread
in one flat `<ul>` (`list.map`) with the composer below it: **no**
pagination, **no** virtualization, **no** own scroll container, **no**
`scrollIntoView` on post, and **no** per-comment "Show more" (verified
in `CommentsPanel.tsx` / `CommentItem.tsx`).

**What had to be decided.** Tag CMT-20, or decline it?

**Options considered.**

1. **Tag it.** Costs: three of the four bullets have no subject in the
   code; a test could only assert the composer exists and rows render,
   which passes on a build that fails the case (the tag-that-cannot-
   fail shape). Dishonest.
2. **Build the missing affordances.** Costs: this is net-new
   feature work (a scroll container + post-scroll at minimum, plausibly
   a "Show more" clamp and pagination), well beyond verifying a
   built-but-untested case, and beyond this batch's remit.
3. **Decline, with a written gap.** Costs: a major case stays
   unsatisfied and visible in the coverage report.

**Decided.** Option 3 — declined and recorded in `known-gaps.md`. Not
tagged.

**Why.** `@verifies` has no partial marker; tagging would claim a major
case satisfied when three of four bullets are unimplemented. The build
loop's rule is to escalate/record an unbuildable case rather than write
a weaker spec that can pass. The absence is a feature gap, not a test
gap.

**To revert.** When the affordances are built in
`apps/web/src/client/comments/CommentsPanel.tsx` (and `CommentItem.tsx`
for "Show more"), add a CMT-20 spec to `tests/ui/flow-comments.spec.ts`
and delete the known-gaps entry.

### A152 · Email is validated on the server write path; the client gate is only a courtesy

**Ticket:** B2 fix-review (Users/Projects/Milestones lane) · **Date:** 2026-09-06 · **Commit:** (this one)

**The situation.** B2 bug 1: `UsersPanel` Edit → email `"bob"` → Save
returned 200, the dialog closed, and the row went blank. `z.email()`
guards only the *read* path (`UserProfileSchema.email`), so a bad value
was persisted by core, degraded into `health` on the next load, and read
back blank — silent data loss reported as success. The write handlers
(`handleCreateUser` / `handleUpdateUser`) did no email validation.

**What had to be decided.** Where does the email get rejected, and with
what shape, so the field is never silently cleared?

**Options considered.**

1. **Client-only check.** Cheapest. Costs: the CLI/MCP and any direct
   API caller still corrupt the field; the guarantee is cosmetic.
2. **Server write-path validation, client gate as courtesy.** The server
   rejects a malformed non-null email with a 400 `field: "email"` before
   core can persist it; the client adds a light `looksLikeEmail` gate so
   the obvious case never round-trips, and renders the server's 400 in
   the existing Callout. Costs: a new `EmailSchema` export in contracts;
   two guards in the server user region.
3. **Fix core `updateUser`/`createUser` to reject.** Most central.
   Costs: crosses into core + CLI/MCP `updateUser`, owned by another
   lane this wave; larger blast radius than the bug needs.

**Decided.** Option 2 as the first step, then Option 3 folded in at the
B2 merge reconciliation — the final state is **both**: core validates
(the shared authority) and the server keeps its field-attributed 400.

**Correction (merge reconciliation).** The original "Why" claimed the
server "is the authority every surface shares, so validating there fixes
the CLI/MCP paths too". **That was false** — the CLI and MCP do not go
through the web server's HTTP handlers; they call core (`createUser`/
`updateUser`) directly, so `loctt user edit --email bob` still corrupted
the field. The authority the three surfaces actually share is **core**.
Validating only in the server was drift with a good address, exactly what
the parity rule forbids ("a capability in core is not done until CLI and
MCP have it"). Option 3 was therefore added: `assertValidEmail` in
`packages/core/src/users/lifecycle.ts` rejects a malformed non-null email
in both write functions, which covers web/CLI/MCP at once. The server's
400 pre-check and the client `looksLikeEmail` courtesy gate are kept
because they give the field-attributed error shape before core is
reached; `null` still clears the email (a valid operation). See the
(now FIXED) email known-gap entry.

**To revert.** Remove `EmailSchema` from
`packages/contracts/src/users.ts` (and its `index.ts` re-export), drop
the two `EmailSchema.safeParse` guards in `handleCreateUser` /
`handleUpdateUser` in `apps/web/src/server/server.ts`, remove
`looksLikeEmail` + the `emailOk` blocks in
`apps/web/src/client/settings/UsersPanel.tsx`, and remove
`assertValidEmail` (and its two call sites + the `EmailSchema` import) in
`packages/core/src/users/lifecycle.ts` plus the two email tests in
`packages/core/src/users/manage.test.ts`.

### A153 · The user Edit dialog drops the "(none)" timezone option rather than making the zone clearable

**Ticket:** B2 fix-review (Users/Projects/Milestones lane) · **Date:** 2026-09-06 · **Commit:** (this one)

**The situation.** B2 bug 2: the Edit-user dialog offered a `(none)`
timezone option. Selecting it and saving reported success but kept the
old zone — `save()` omits an empty timezone, and core's `updateUser`
does `timezone: changes.timezone ?? existing.timezone`, so an omitted or
empty value preserves the existing zone. The option therefore lied.

**What had to be decided.** Make `(none)` actually clear the timezone, or
remove the option because the zone is effectively required?

**Options considered.**

1. **Make `(none)` clear it.** `saveUserProfile` already omits an
   undefined timezone, so the *storage* supports a cleared zone. Costs:
   core's `updateUser` has no "clear timezone" signal — `EditUserOptions`
   makes only `email` nullable. Adding one means changing core
   `updateUser` + its `EditUserOptions` and the CLI/MCP `updateUser`
   twins, all owned by other lanes this wave. Cross-lane, load-bearing.
2. **Remove the option; treat the zone as required in the UI.** The
   create form already defaults the zone to the resolved system zone, so
   a user almost always has one; a blank-zone user (degraded/hand-edited)
   sees a disabled placeholder and must pick a real zone before Save.
   Costs: a user genuinely cannot blank their zone from this dialog —
   but nothing in PRU-47 asks for that, and the previous option did not
   deliver it either (it silently kept the old value).

**Decided.** Option 2 — remove the `(none)` option; Save is blocked
until a real zone is chosen.

**Why.** Option 1's only honest form crosses three other lanes' code for
a capability no case requires. Option 2 removes a control that lied and
matches the effective contract (create always sets a zone). This is the
choice the fix-review's task explicitly permitted ("remove the '(none)'
option if tz is required").

**To revert.** In `apps/web/src/client/settings/UsersPanel.tsx`
`EditUserDialog`: restore `<option value="">(none)</option>`, drop the
`tzOk` gate and the disabled-placeholder branch. To instead adopt option
1, thread a nullable `timezone` through core `updateUser`
(`EditUserOptions` + `lifecycle.ts`) and its CLI/MCP callers, and have
`save()` send `timezone: null` on `(none)`.

### A161 · REL-51's group-header direction was already correct; the reported bug was demo-data, not code

**Ticket:** B3 Relationships · **Date:** 2026-09-08 · **Commit:** (staged)

**The situation.** REL-51 (UX-8) asks that each relationship group
header name the side it shows — "children under the child-side label
('Child'), the parent under the parent-side label ('Parent')" — and
states the bug as "the structural group picks the label from the wrong
side, so children show under 'Parent' and the parent under 'Child'". The
UX review (UX-8) was grounded in DEMO-10/DEMO-11: an epic whose 3
children appeared under a "PARENT · 3" header.

I could not reproduce a bug in `group.ts`. Traced the whole chain: core
`linkTask` (`packages/core/src/task/relationships.ts:245`) writes
`link T-3 parent T-1` as a `parent` edge on T-3 (target = the parent)
and a `child` edge on T-1 (target = the child); the evaluator's
`parent` alias (`packages/core/src/query/evaluator.ts:410`) reads
`parentRel.target` as the parent's id; the CLI/README/configuration docs
all agree (`loctt link T-3 parent T-1` = "T-3's parent is T-1"). Under
that convention `group.ts`'s mechanical `def.label`/`inverse_label`
mapping is already right: a task holding `child` edges lists its children
under "Child", a task holding a `parent` edge lists its parent under
"Parent". Measured directly: `groupRelationships([child→kid])` →
`child=Child`, `groupRelationships([parent→epic])` → `parent=Parent`.
The DEMO-10 header "PARENT · 3" over children can only arise if the demo
tracker stored the epic's children as `parent` edges — i.e. the seed data
was written with the direction reversed, contradicting `linkTask`.

**What had to be decided.** Satisfy REL-51 by *swapping* the tree def's
labels (the fix its "bug being fixed" bullet imagines), or by *locking
the already-correct behavior* and recording that the premise was a
data artifact?

**Options considered.**
  1. Swap forward/inverse labels for `graph: tree` defs in `sidesOf`.
     Cost: it *breaks* the code, which is already correct per every code
     source — children would move to "Parent". It also reddens the
     already-green REL-1 flow assertion (`["Blocks","Parent","Child"]`)
     and group.test.ts REL-1, and diverges the header from the picker
     (which still offers "Parent"→`parent`). This "fix" makes the app
     wrong to match backwards demo data.
  2. Keep `group.ts` as is; add a REL-51 test (unit + e2e) that locks
     the correct behavior (children under "Child", parent under
     "Parent", `blocks` control unchanged), proven red-first by
     demonstrating the label-swap turns it red. Cost: the case's "bug
     being fixed" bullet describes a code bug that does not exist; this
     entry records that.

**Decided.** Option 2 — REL-51's *required property* ("the side is
correct and consistent across all relationship types") is already
satisfied by the shipped code; I added tests that lock it and prove
red-first via the swap mutation, and did not change `sidesOf`'s mapping.

**Why.** The code convention is unambiguous and consistent across core,
the evaluator, the CLI and three docs; the only source implying a code
bug is a screenshot of demo data seeded against that convention. CLAUDE.md
forbids rewriting the spec to match code, but it equally forbids breaking
correct code to match a false premise — and REL-51's normative
requirement is met. The demo-data direction error is a separate,
data-side issue (any demo/seed that wrote children as `parent` edges
should be regenerated through `loctt link`); logged in known-gaps.

**To revert.** If Ken decides the *intended* convention is the reverse
(a `parent` edge means "target is my child", making the demo data
canonical and the CLI/evaluator the bug), the header fix is a swap in
`apps/web/src/client/relationships/group.ts` `sidesOf`:
`label: tree ? effectiveInverseLabel(def) : def.label` for the forward
side and `tree ? def.label : effectiveInverseLabel(def)` for the inverse
side — but that is a much larger change touching core `linkTask`, the
`parent` alias, the CLI `link` direction and the picker in
`group.ts` `linkKindOptions`, and must be decided as a convention, not a
UI patch. The REL-51 tests in `group.test.ts` and
`tests/ui/flow-relationships.spec.ts` and REL-1's expected labels would
flip accordingly.

### A162 · REL-12's remove affordance is a persistent kebab + confirm (implements Ken's ruling)

**Ticket:** B3 Relationships · **Date:** 2026-09-08 · **Commit:** (staged)

**The situation.** REL-12 was revised (Ken's ruling, batch spec "Batch 3
→ Relationships") from a hover-only `✕` that removed on one click to a
**persistent kebab (⋯) in a fixed slot → dropdown Remove → brief
confirm**. The old shape lived in `RelationshipRow.tsx` as an
`opacity-0 group-hover` button with `data-testid="relationship-remove"`,
and the old REL-12 test asserted one-click removal with
`getByRole("dialog")` count 0.

**What had to be decided.** How to signal "not this task's edge to
remove" (`onRemove === undefined`, a tree descendant) while keeping the
K-4 alignment the fixed slot buys.

**Options considered.** (a) Render the kebab always, but with an empty
menu for non-removable rows — implies an action exists here and is
unavailable, the false claim the old disabled-control note warned
against. (b) Render no kebab for non-removable rows, but reserve the same
fixed-width slot (`h-7 w-7`) so labels/pills still align.

**Decided.** (b): no kebab when `onRemove` is undefined, but a
same-width reserved span, so alignment holds and no phantom action is
implied.

**Why.** K-4 is satisfied by the *slot* being fixed, not by the control
always existing; a menu that opens to nothing is worse than no menu.

**To revert.** In `apps/web/src/client/relationships/RelationshipRow.tsx`,
restore the single `opacity-0 group-hover` `<button
data-testid="relationship-remove">` calling `onRemove` directly, and drop
the `Menu`/`IconButton`/`Dialog` imports and the `confirming` state. The
REL-12 test in `RelationshipRow.test.tsx` and `flow-relationships.spec.ts`
(and the `removeLink` helper + call sites) would revert with it.

### A163 · The activity lane's Comments/Activity/All tabs default to Activity and mount comments on activation (transitional)

**Ticket:** B3 · Activity/comments lane (K-5) · **Date:** 2026-09-08 · **Commit:** (this one)

**The situation.** K-5 splits the stacked Comments + Activity sections
into a tabbed control (Comments / Activity / All) inside the
self-contained activity component (`activity/ActivityPanel.tsx`). But the
Activity lane owns ONLY `activity/*`; `task/TaskDetail.tsx` is owned by
the Relationships lane, which (per the B3 batch plan) holds "K-5's tab
state + URL param". At this commit `TaskDetail` still
renders a SEPARATE standalone Comments `<Section>` (`<CommentsPanel>`)
beside the tabbed lane. If the lane also mounts a `<CommentsPanel>` on
load, the page has two comment composers/lists sharing the same
`data-testid`s — breaking 16 existing comment e2e tests (`comment`,
`comment-composer`, `comments-list` resolve to 2×).

**What had to be decided.** How does the self-contained tabbed lane
render a Comments tab without introducing a second, ambiguous comments
home while `TaskDetail` still owns the standalone Comments section — and
which tab is the default?

**Options considered.**

1. **Default to Comments; always-render all panels (hidden).** Matches
   the "Comments first" UX. Costs: mounts a second `<CommentsPanel>` on
   load → 16 comment specs go red until the Relationships lane removes
   `TaskDetail`'s section. Ships a real double-mount bug in the meantime.
2. **Scope the 16 comment specs to the standalone section.** Costs:
   couples them to `TaskDetail`'s transient structure and asserts the
   duplicate-comments state as acceptable — the "test asserting the bug"
   anti-pattern CLAUDE.md warns against.
3. **Default to Activity; mount each tab's content on activation.** The
   lane shows the feed on load and mounts `<CommentsPanel>` only when the
   Comments/All tab is opened, so load-time has exactly one comments home
   (the standalone section). CMT-18/CMT-39 scope to the lane's own tab
   panels. Costs: default is Activity, not Comments, until the standalone
   section is removed. CMT-18 permits "whichever is a tab" as the default,
   so no case is violated.

**Decided.** Option 3 — default tab is Activity, tab content is
mount-on-activate.

**Why.** It is the only option that keeps a genuine double-mount off the
page AND leaves every existing comment spec green, without asserting the
transitional duplication as correct. It is forward-compatible: when the
Relationships lane removes `TaskDetail`'s standalone Comments `<Section>`
(and wires the URL param), the default can move to Comments with a
one-line change here and nothing else. See the companion `known-gaps.md`
entry for the pending integration.

**To revert / advance.** In `activity/ActivityPanel.tsx`: change
`useState<Tab>("activity")` to `"comments"` and, if desired, restore
always-render (drop the `tab === "…" &&` guards) once `TaskDetail` mounts
only the tabbed lane. The default-tab assertions in
`activity/ActivityPanel.test.tsx` ("renders three tabs…") and
`tests/ui/flow-comments.spec.ts` CMT-18 move with it.

**ADVANCED at the B3 merge (2026-09-07).** The transitional state above is
resolved: the merge coordinator removed `TaskDetail`'s standalone Comments
`<Section>` (the Relationships lane's TaskDetail edits had landed, so the
integration was now safe to complete rather than defer) and flipped the
default tab to **Comments**. The tabbed `ActivityPanel` is the single
comments home; mount-on-activation stays (only the active tab's
`<CommentsPanel>` is in the DOM, so exactly one composer exists at a time,
which is what keeps the 16 comment e2e tests unambiguous — all 19
flow-comments tests pass with the new default). The `CommentsPanel` import
was dropped from `TaskDetail.tsx`. CMT-18 (both the unit test and the e2e)
now assert default-Comments. This makes K-5 complete rather than shipped
behind a workaround default.

**Test blast radius of the default flip (reconciled at the B4 merge).**
Defaulting to Comments put the activity FEED behind the Activity tab
(mount-on-activation), so every spec that read feed elements
(`activity-entry`/`activity-actor`/`activity-day`/…) on load had to open
the Activity tab first. Exactly three spec files reference those elements:
`flow-comments.spec.ts` (adapted in B3, green), `flow-activity.spec.ts`
(~16 tests, adapted at the B4 merge — a `showActivity`/`showAll` helper,
per-test tab choice since some assert the composer AND the feed), and
`flow-settings-projects-users.spec.ts` (PRU-10, one Activity-tab click
added). A repo-wide grep confirmed no other spec reads the feed on load,
so the blast radius is fully bounded to those three. These are
"editing a green test because the behaviour legitimately changed" edits
(the feed still works; it is tab-gated now), named in the B4 commit.

### A168 · The Milestones-view residual (MSL-39/40/41/42): shapes chosen without a doc

**Ticket:** B4 · Milestones overview lane · **Date:** 2026-09-09 · **Commit:** (staged)

**The situation.** B4's milestones lane owed four cases whose prose
leaves the *shape* to the builder. MSL-39 wants "the whole card
clickable"; MSL-40 wants "target date + countdown/overdue"; MSL-41 wants
"a task-count breakdown by status/category"; MSL-42 (UX-15, narrowed)
wants discoverability copy. The flow doc gives examples ("in 5 days",
"3 days overdue") but no data contract, and core's `Progress` publishes
only `done`/`total`/`discarded`/`fraction` — no per-status-key split.

**What had to be decided.** (a) How does the whole card open the
milestone without swallowing clicks on the name link / Retry button?
(b) What breakdown does MSL-41 show, given core exposes only category
totals? (c) Where does MSL-42's copy live, given this lane owns only
`MilestonesView.tsx`, not the settings panel?

**Options considered.**
- (a) *Wrap the card in a `<Link>`* — inner controls need
  `stopPropagation` and nested `<a>` is invalid HTML. *vs.* *`role="link"`
  on the `<li>` with a click/keydown handler that ignores clicks whose
  target `.closest("a,button,input,…")` is an interactive descendant* —
  keeps the name a real link (middle-click / open-in-new-tab survive),
  no nested-anchor, and the guard is control-agnostic.
- (b) *Add a per-status breakdown to core* — correct long-term but is a
  core change owing CLI+MCP+doctor parity, out of this lane's scope and
  a second progress path MSL-3 forbids. *vs.* *derive three category
  buckets from the existing payload*: `done`, `remaining = total - done`,
  `discarded` — no new core field, no second scan.
- (c) *Edit the settings panel's copy* — not this lane's file. *vs.* *a
  subhead + empty-state copy on the Milestones view itself* naming and
  linking Settings → Milestones.

**Decided.** (a) `role="link"` + `closest`-guarded handler; (b) the
three category buckets (done / remaining / discarded), discarded chip
suppressed at zero; (c) a `milestones-subhead` on the view plus reworded
empty state.

**Why.** Each avoids a scope breach (core change, settings-panel edit)
and each reuses the numbers core already computes, so MSL-3's
one-implementation guarantee holds. The `closest` guard is the standard
way to make a container clickable without stealing its children's clicks.
A category breakdown is what MSL-41 literally asks for ("status/category")
and is honest about what the data supports — a per-status-key split would
be a fabricated precision.

**To revert.** All in `apps/web/src/client/milestones/MilestonesView.tsx`:
remove `milestoneCountdown`, `breakdown`, the `role="link"`/`onClick`/
`onKeyDown` block and `INTERACTIVE_WITHIN_CARD` on the `<li>`, the
`milestones-subhead`, and the breakdown/countdown JSX. Tests to drop:
the MSL-39/40/41 blocks in `MilestonesView.test.tsx` and the MSL-39/40/41/42
tests in `tests/ui/flow-milestones.spec.ts`. A per-status breakdown, if
wanted later, is a core `Progress` extension (with CLI/MCP parity), not a
view change.

## 9. Ken's rulings, 2026-08-29

**These are Ken's, not an agent's.** Unlike § 8, they carry the
authority of sections 1–7 and are not revertible on an agent's
judgment. Recorded here because several were open in the v1
proposed-cases queue and were blocking M2.

### K1 · SET-3 is dropped; workflow panels are editable

SET-3 asserted workflow panels are read-only ("no inline text inputs,
no delete buttons"). SET-6, SET-17 and SET-19 assert drag-reorder and
in-panel deletion with remap. Both cannot hold.

**Ruling: drop SET-3, keep the editable reading.** `PUT /api/workflow`
supports it and `workflow-write.ts` (822 lines, full per-collection
remap) was built for it.

### K2 · Body save is autosave, and the precondition ships with it

`markdown-extensions.md` mandates explicit-Save; TSK-15 mandates 1.5s
idle autosave.

**Ruling: autosave**, and `markdown-extensions.md` is corrected.

**And the precondition is built with the body editor, not after it.**
The objection put to Ken: there is no concurrency control anywhere —
no `If-Match`, no `412`, no version on any write path, verified by
grep. Autosave without one silently overwrites a concurrent CLI or MCP
edit every 1.5 idle seconds, unattended, which is exactly what P1
forbids ("never silently overwrite a change it didn't make"). Ken
ruled the precondition ships with the editor rather than as a
follow-up.

So M2's body-editor ticket owes: the editor sends the `updated_at` it
loaded, the server refuses a stale write with 412, and the UI reports
that the task changed underneath the user.

Note: the v1 proposed-cases queue attributed this gap to "B5". **That
is the wrong ID** — B5 is the lossy-content guardrail. The concurrency
gap has no B-number.

### K3 · Project URLs carry a slug

`flow-projects-users.md` PRU-2/PRU-6 assume `?project=web`.
`ProjectDefSchema` is `.strict()` with `{id, name, prefix, archived?}`
— no slug — and `state.keys` is indexed by ULID.

**Ruling: reintroduce a slug field to the schema.** URLs carry the
slug, not the ULID.

This is a core change (the schema is shared), and it needs: slug
generation on create, uniqueness, and a decision on what happens when
a project is renamed. Those are M-ticket work, not settled here.

### K4 · The CSV export is a report; JSONL is the backup

**Asked as a product question**: what is the export *for*? Ken's
answer was "a backup or archive" — which the measurement then
contradicted.

**The CSV cannot be a backup.** 18 columns against 27 frontmatter
fields, and the omissions are the substance: the **body** (the whole
markdown content), **relationships** (every link between tasks),
custom `fields`, `key_history`, `archived`/`archived_at`, and
`rank`/`board_rank`. Comments are stored separately and not exported
at all. A restore from it would be a pile of disconnected, bodyless
tasks.

**Rulings:**

1. **CSV is a report for a human in a spreadsheet.** So it shows what
   a human recognises: `project`, `assignee`, `reporter`, `milestone`
   and `sprint` resolve to **names**. This closes the M1 gate's F7 as
   a plain bug rather than a decision.
2. **`id` stays.** One opaque column a reader can ignore, and nothing
   scripted against the current export breaks. BLK-36's pinned column
   count is unchanged — the smallest correct change. `key` remains the
   stable identifier, and it survives project moves via `key_history`.
3. **A structured export (JSON/YAML, JSONL, size-split) is the
   backup**, and it is **its own ticket after M4**. Not folded into an
   existing one, because no case describes it and the gate would
   rightly flag behaviour no case covers.

**Superseded reasoning, recorded so it is not re-derived.** The
earlier argument for keeping raw ULIDs was that "an id round-trips and
a name does not". **There is no CSV import anywhere in the codebase** —
nothing parses CSV back in — so that defended a round-trip that does
not exist. The four options the proposed-cases queue raised are closed
by this entry.

### K5 · Robustness is a standing rule, not a one-off

Ken, on the ~25 cases that fail as written: *"make sure this stays
robust (this is a general rule, should this go into our workflow)"*.

Recorded in `known-gaps.md` (the unsatisfiable-case entries), and
distilled as a rule in `lessons.md` § Process ("never reword a case to
fit the code").

### K6 · BLK-30's threshold is 10, two tiers, not configurable

BLK-30 (major, P5 P9) requires the delete confirmation to be
*"proportionate — deleting 1,280 tasks must not require the same
keystroke as deleting 2"*. It names no threshold. An agent picked
10, which was **authoring a requirement** and is why it went to Ken.

**Ruling: keep two tiers at 10.** At or below 10, type `DELETE`;
above 10, type the count.

**Why the count rather than a longer word.** A fixed string is muscle
memory by the third use, and muscle memory is what must not carry
someone through deleting a thousand tasks. Typing `1280` cannot be
done without reading the number that matters.

**Not configurable.** Ken raised it as an option ("we can also make
this configurable somewhere if we're worried") and the objection was
put before he settled: a config key lets a user set the threshold to
10,000 and never meet the harder confirmation, which turns P5's
guarantee into an opt-out. It also costs a `workflow.yaml` field, its
validation, its migration and a settings panel — for a number nobody
has complained about. The escape hatch is cheaper without it: the
constant is exported and the tests import it, so changing it is one
edit. Configurable later is easy; unconfigurable again after shipping
is not.

**Bullet 3 stays unimplemented, deliberately.** It permits the app to
*refuse* beyond a size ("**if** the app refuses"), and it does not
refuse. A local file-backed tracker has no server to protect and no
other users to affect; declining to delete the user's own files would
be paternalism. Nothing is owed unless a cap is later wanted.

**To revert.** `LARGE_DELETE_THRESHOLD` and `deleteConfirmWord()` in
`apps/web/src/client/list/DeleteConfirmDialog.tsx`. The constant is
exported so the surface and its tests agree by construction — change
it in one place and the tests follow. A third tier would change
`deleteConfirmWord`'s return, not its call sites.

### A4 · An unresolvable ref alongside an unreadable file is reported as undetermined, not as either answer

**Ticket:** core lookup / TSK-54 · **Date:** 2026-08-29 · **Commit:** (this one)

**The situation.** Fixing TSK-54 — an unparseable `task.md` reported as
`task not found: "T-1"` — turned up a third case the case text does not
cover. A key lives *inside* its own `task.md`. When that file will not
parse, `readKeyHeader` cannot harvest the key, so the key never enters
the index and the lookup misses. But a lookup for a key that simply
does not exist misses in exactly the same way, through the same code
path. Once some file in the tracker is unreadable, `lookupByKey` cannot
tell the two apart.

TSK-54 covers "the task the user asked for is corrupt". ERR-1 covers
"a failure and an absence must not look alike". Neither says what to do
when LocTT cannot establish which of the two it is looking at.

**What had to be decided.** When a key does not resolve and some task
file could not be read, does LocTT report it as not-found, as
unreadable, or as neither?

**Options considered.**

1. **Report `task not found`.** Simple, and correct whenever the
   corrupt file is an unrelated neighbour. Costs: it reproduces the
   original bug exactly in the case that matters most — the user asks
   for T-1, T-1's own file is the corrupt one, and LocTT tells them the
   task does not exist. That is the ERR-1 violation being fixed.
2. **Report the ref as unreadable, naming the corrupt files.** Never
   claims a task is gone. Costs: it asserts something false in the
   common case. Asking for a key that does not exist while one
   unrelated file happens to be corrupt would answer "T-99 could not be
   read", blaming a file with nothing to do with T-99 — the same
   conflation pointed the other way, and measured during this work as a
   regression I introduced before catching it.
3. **Report that the outcome is undetermined**, naming every unreadable
   candidate and the repair. Costs: a third message shape to render,
   and a longer sentence than either alternative.

**Decided.** Option 3. `UnreadableTaskError` carries an `indeterminate`
flag; the message says no task matched the ref, that LocTT could not
read every task file, that it therefore cannot confirm the task does
not exist, and which files to repair.

**Why.** P-4's stated exception is exactly this shape: an undetermined
cause is permitted *only* when the cause genuinely cannot be
determined, and must still name what was attempted and what to do next.
Here it genuinely cannot — the key that would settle it is the
unreadable bytes. Options 1 and 2 both resolve the ambiguity by
guessing, and each is wrong in the case the other handles. This is also
why the negative-lookup cache is not written on this path: caching an
answer derived from a file the user is about to repair would pin it for
the rest of the process.

**To revert.** `UnreadableTaskError.indeterminate` and
`UnreadableTaskError.indeterminateRef` in
`packages/core/src/task/lookup.ts`, plus the `fold.unreadable.length > 0`
branch at the end of `lookupByKey`. Reverting to option 1 means deleting
that branch (the `TaskNotFoundError` below it already handles it);
reverting to option 2 means dropping the `indeterminate` flag and
calling the plain constructor. Tests:
`packages/core/src/task/lookup-unreadable.test.ts` — "does not report a
corrupt task as absent when the key never reached the index" and "does
not claim a missing key was found when an unrelated file is corrupt".

### A7 · The task detail query always revalidates on mount

**Ticket:** M2.1 · **Date:** 2026-08-29 · **Commit:** (uncommitted)

**The situation.** `queryClient.ts` sets a shared `staleTime` of 30
seconds for every query. The task detail page renders entirely from
one `GET /api/tasks/:ref`. Measured on a real tracker at this commit:
open `/tasks/T-1`, run `loctt delete T-1 --yes`, navigate away in-app
and back to the task — **the full detail page rendered from cache**:
title, breadcrumb, meta panel, and a live-looking More menu, for a
task with no directory on disk.

XS-58 (blocker, P1 P4) forbids exactly this: *"The detail page shows a
not-found state naming `T-12`, not a page of stale fields with
live-looking edit controls."* ERR-7 turns on the same read.

**What had to be decided.** Should the task detail query opt out of
the shared 30-second `staleTime`, or should XS-58 be satisfied some
other way (a shorter global window, an invalidation on route change,
or accepting the stale window)?

**Options considered.**

- **`refetchOnMount: "always"` on this one query.** Costs one request
  per mount of a route the user navigated to deliberately, against a
  local server reading one file. Contained to `useTask.ts`.
- **Shorten the global `staleTime`.** Fixes this page and changes
  every other query's behaviour with it, including the sidebar config
  lists the window was chosen for. A wide blast radius for one page's
  problem, and it would still leave a window in which the page lies.
- **Invalidate `["task", …]` on every route change.** Same effect,
  more machinery, and it puts the rule somewhere no one reading
  `useTask.ts` would find it.
- **Accept the stale window.** Rejected: it is not a stale *value*, it
  is a whole page of controls for a file that does not exist.

**Decided.** `useTask` sets `refetchOnMount: "always"`, opting this
query alone out of the shared window.

**Why.** P-1 — "the UI must never present a stale view as
authoritative" — and the tracker has three concurrent writers, so a
task vanishing underneath the UI is a normal way to use it rather than
an exotic race. Mounting the detail route is the moment the user
asserts they are looking at *this* task, which makes it the moment to
check. The cost is one local file read.

**To revert.** Delete `refetchOnMount: "always"` from
`useTask()` in `apps/web/src/client/api/hooks/useTask.ts`; the query
inherits the 30-second window again. `tests/ui/flow-tasks.spec.ts`'s
XS-58/ERR-7 case goes red, which is the intended alarm.

### A8 · Opening a task invalidates the recents query

**Ticket:** M2.1 · **Date:** 2026-08-29 · **Commit:** (uncommitted)

**The situation.** `pushRecent` fires server-side inside
`handleGetTask` (`server.ts:2579`), so opening a task records it
without the client doing anything. But `/api/recents` is a separate
query under the same 30-second `staleTime`, so the sidebar kept
rendering "No recent tasks — this fills in as you open them" after a
task had been opened and the recents file had been written.

TSK-3 (major, P1 P8) requires: *"The sidebar's Recently viewed group
gains this task **without a page reload**."*

**What had to be decided.** Where does the client learn that the read
it just performed changed a different resource?

**Options considered.**

- **Invalidate `["recents"]` from `useTask` on a successful fetch.**
  One extra request per task open. The knowledge lives next to the
  fetch that causes the push, which is where a reader would look for
  it.
- **Have the detail component invalidate.** Same request count, but
  puts a server-side side-effect's compensation in a view component,
  where the next person to render `useTask` elsewhere will not repeat
  it.
- **Poll recents more often.** Costs a request on a timer forever to
  fix a thing that happens on a known event.

**Decided.** `useTask` invalidates `["recents"]` in an effect keyed on
`dataUpdatedAt`, on success only.

**Why.** The invalidation belongs to the call that caused the write.
On success only, because a 404 pushes nothing and re-reading recents
on every dead deep link is work for an answer that cannot have
changed.

**To revert.** Delete the `useEffect` in `useTask()`
(`apps/web/src/client/api/hooks/useTask.ts`). TSK-3 goes red.

### A9 · Single-task Move goes through the bulk endpoint

**Ticket:** M2.1 · **Date:** 2026-08-29 · **Commit:** (uncommitted)

**The situation.** The More menu owes "Move to project" (CW-13). The
server exposes no single-task move route — `POST
/api/tasks/bulk/move` is the only one, and it answers 200 with a
`succeeded`/`failed` split rather than an error envelope.

**What had to be decided.** Add a single-task move route to the
server, or send a one-element batch to the existing bulk one?

**Options considered.**

- **One-element batch to `bulk/move`.** No server change. A failure
  arrives as `failed[0].error` inside a 200, so the hook has to
  inspect the body and reject, or every call site has to remember to.
- **New `POST /api/tasks/:ref/move` route.** A cleaner client contract
  and a real error envelope — but it is a new API surface, which is a
  scope change no ticket plans, and it duplicates logic that already
  works.

**Decided.** `useMoveTask` sends a one-element batch to
`/api/tasks/bulk/move` and throws on a non-empty `failed`, so callers
see a normal rejected mutation.

**Why.** Adding a route is scope the run stops for; reusing the
endpoint is not. The 200-with-failures shape is contained inside one
hook rather than leaking to the dialog.

**To revert.** `useMoveTask` in
`apps/web/src/client/api/hooks/useTaskMutations.ts`.

### A10 · TSK-8's non-working days are marked on the chosen date, not shaded in a grid

**Ticket:** M2.2a · **Date:** 2026-08-29 · **Commit:** (this one)

**The situation.** TSK-8's first bullet: "Each opens a date input;
non-working days per `calendar.yaml` are visually marked." A browser's
native `<input type="date">` popup is not styleable — no page CSS
reaches inside it — so shading weekends and holidays *within the
picker* requires replacing the native control with a hand-built month
grid.

**What had to be decided.** Does "visually marked" require shading
every non-working day inside an open picker, or is marking the
selected date enough?

**Options considered.**

- *Hand-built month grid.* Literal reading of the bullet. Costs the
  native control's keyboard support, locale-correct parsing, and its
  year range — TSK-28 needs 1970 and 2099 both accepted without
  clamping, which a hand-rolled grid has to reimplement and can get
  wrong. A large new surface with its own defects, for shading two
  columns.
- *Native input, marker beside it.* The panel states whether the
  chosen date is a non-working day and why ("Saturday is not a working
  day", "New Year's Day — not a working day"). Costs the at-a-glance
  scan of a month; a user picking a Saturday learns so after picking
  rather than before.

**Decided.** Native input with a marker on the chosen date.

**Why.** It answers the question the shading exists to answer at the
moment it matters, and it covers **holidays** — which weekend shading
alone would miss, since a holiday looks like any other weekday in a
grid. P8 ("frequent paths are fast and keyboard-reachable") argues
against replacing a control that is already both. The literal reading
is not abandoned so much as deferred: if Ken wants the grid, this is
where it goes.

**To revert.** `apps/web/src/client/task/editors/DateField.tsx` —
replace the `<input type="date">` and `DateNotes` with a month grid;
`nonWorkingNote()` already computes the per-date answer the grid would
need, so it is reusable as the cell predicate. The test that pins the
current behaviour is `TSK-8/TSK-28` in
`tests/ui/flow-task-meta.spec.ts`, which asserts
`meta-nonworking-due`.

### A11 · Rejection messages are resolved to configured labels in the web client, not in core

**Ticket:** M2.2b · **Date:** 2026-08-29 · **Commit:** (this one)

**The situation.** ERR-43 (major, P4 P3) requires an error about a
config value show "the configured **label** ("In Progress"), not the
stored key (`in_progress`), wherever the label is available". Measured
against a live server, core's messages carry raw identifiers on both
paths:

```
status:   invalid value: status: unknown status "nonesuch";
          valid: backlog, in_progress, done, wont_do
assignee: cannot assign archived user "01M15ZCHKHK534CBPCQS5FQ30S"
          to assignee; unarchive it first
```

The archived one is worse than a key — it is a ULID, which names
nothing to a reader. TSK-46 (blocker, P4 P7) requires that same
message "names the user".

**What had to be decided.** Which layer turns a stored key or ULID
into the name the user configured?

**Options considered.**

1. **Core resolves it.** Messages come out label-shaped for every
   surface at once. Costs: core's validator holds *keys* by
   construction — the set it compares against is
   `config.statuses.map(s => s.key)` — so it would have to carry a
   second, parallel label index through every error path. And the CLI
   and MCP would inherit the change without a case asking for it:
   MCP's consumer is an agent, for which the stored key is the more
   useful string.
2. **The web client resolves it.** The panel already holds
   `workflow`, `users`, `labels`, `milestones` and `sprints` as live
   queries — it renders every picker from them. Costs: the
   translation is a string transform over a message, so it is
   matching text rather than reading structure; and it is one
   surface's fix, so a later CLI case wanting the same would repeat it.
3. **The server envelope carries both**, e.g. a `label` beside
   `field`. Costs: a contract change, and no case describes it.

**Decided.** Option 2 — `apps/web/src/client/task/fieldFailure.ts`
resolves quoted identifiers and core's `valid:` list against an index
built from the panel's own queries.

**Why.** The layer that has both halves is the client: core has the
message and the keys, the client has the message *and the names*. It
is deliberately conservative about the text-matching cost — only
quoted tokens and the `valid:` suffix are rewritten, never bare words,
so a message saying "the write was done" is left alone. A token with
no entry in the index is left exactly as it stands, which is ERR-43's
own stated exception; `markUnknownValues` then marks it as
unrecognized so it is not read as a label.

**To revert.** Delete `resolveLabels` / `markUnknownValues` /
`buildLabelIndex` from
`apps/web/src/client/task/fieldFailure.ts` and stop calling them in
`toFieldFailure`; drop `labelIndex` from
`apps/web/src/client/task/TaskDetail.tsx`. ERR-43 and TSK-46's second
bullet go unmet, and their tests in
`tests/ui/flow-task-failure.spec.ts` and
`apps/web/src/client/task/fieldFailure.test.ts` go red.

### A12 · A write that finds the task deleted keeps the detail page up rather than swapping to the not-found page

**Ticket:** M2.2b · **Date:** 2026-08-29 · **Commit:** (this one)

**The situation.** XS-57 (blocker, P1 P4): delete `T-12` from the CLI,
then submit a field edit from the still-open detail page. The server
half already worked — 404, `not_found`, `data_state: "not_saved"`,
naming the key.

The client did not. `useSetField`'s `onSettled` invalidates the task
query; its refetch 404s; `TaskDetail` saw `task.isError` with
`code === "not_found"` and returned `<TaskNotFound>`. Measured: the
field notice never rendered at all — the page swapped before it could.

`TaskNotFound` answers one of the case's four bullets (a route back)
and none of the other three. It does not say the edit failed, does not
say the task was deleted *while the page was open*, and cannot show
the field snapping back because the field is gone with the page.

**What had to be decided.** When a *write* discovers the task is gone,
does the page become the generic not-found screen, or stay up with the
failure reported at the control?

**Options considered.**

1. **Swap to `TaskNotFound`** (what it did). Costs: three of XS-57's
   four bullets unmet, and the user is told the key resolves to
   nothing rather than that their edit did not land.
2. **Keep the detail page on its last-known data while a `not_found`
   field failure stands.** Costs: the page is briefly showing a task
   that no longer exists on disk — which XS-58 warns about for a
   *cold* load ("not a page of stale fields with live-looking edit
   controls").
3. **Navigate to the list automatically.** Costs: a silent redirect
   hides that the edit failed, which is the failure SHL-44 names in
   the neighbouring case.

**Decided.** Option 2, narrowly: the swap is suppressed **only** when
`fieldError.code === "not_found"` and a previous success is still in
cache.

**Why.** XS-58's concern is a user arriving at a page for a task that
is gone and believing it live. This is the opposite situation — the
user was *just told* their write failed because the task is gone, at
the control they used, with the route back offered in the same notice.
A cold navigation to a key that never existed is untouched:
`fieldError` is null there and the branch is not taken.

**To revert.** In `apps/web/src/client/task/TaskDetail.tsx`, restore
the unconditional `return <TaskNotFound taskKey={taskRef} />` in the
`not_found` branch. XS-57's first three bullets go unmet and its test
goes red.

### A13 · The detail footer's timestamps are relative, not short dates

**Ticket:** M2.2b · **Date:** 2026-08-29 · **Commit:** (this one)

**The situation.** XS-4's third bullet (blocker, P1): "The detail
footer's `updated_at` relative time reflects the CLI write, so the
user can see something changed **and when**."

The footer rendered `shortDate(fm.updated_at, today)` — "Aug 29". That
is day-granularity, so a `loctt set` and the page load beside it
produce the *identical string*: the user cannot see that anything
changed, and the bullet is unsatisfiable for any same-day write.

The block's own doc comment, written in M2.1, already said "Relative
times with the absolute timestamp on `title`". The comment described
relative; the code rendered absolute.

**What had to be decided.** Is this a bug to fix or existing M2.1
behaviour to leave alone?

**Options considered.**

1. **Leave it and report XS-4's third bullet unmet.** Costs: a
   blocker bullet unmet for a one-line fix, and the doc comment stays
   wrong.
2. **Render `relativeTime`.** `relativeTime` already exists in
   `apps/web/src/client/list/format.ts` and is what the list's own
   Updated column uses, so this is reuse rather than new code. Costs:
   it changes what an M2.1 ticket shipped, and the exact date is no
   longer on screen — though it stays on `title`, as the comment
   always said.

**Decided.** Option 2.

**Why.** The comment is the intent and the code was the deviation; the
case names "relative time" explicitly; and the formatter was already
in the codebase being used for the same field elsewhere. Judged a
defect rather than a scope change on that basis.

**To revert.** In `apps/web/src/client/task/MetaPanel.tsx`'s `Footer`,
swap `relativeTime(fm.updated_at, now)` back to
`shortDate(fm.updated_at, today)`. XS-4's third bullet goes unmet and
the relative-form assertion in `tests/ui/flow-task-failure.spec.ts`
goes red.

### A14 · The rich↔raw toggle does not serialize; markdown is the buffer

**Ticket:** M2.3 · **Date:** 2026-08-29 · **Commit:** (this one)

**The situation.** TSK-17's third bullet (blocker, P10): "Round-tripping
rich → raw → rich without edits leaves the stored body **byte-identical**
— the toggle must not silently reformat or reorder markdown", and its
fourth: "the editor does not normalize the user's markdown against their
will."

**No markdown→AST→markdown pipeline can satisfy that**, and the reason is
structural rather than a matter of choosing a better library. Markdown is
many-to-one: `*em*` and `_em_` are one node, so are `# H` and its setext
form, `-`/`*`/`+` bullets, `1.`/`1)` ordinals, backtick and tilde fences,
and any number of blank lines. A serializer must pick one spelling per
node, so every body written in the other spelling is rewritten the first
time the user *glances* at the rich tab. There is also no serializer in
the tree to reach for — no `prosemirror-markdown`, no `tiptap-markdown`,
and TipTap 3 has no markdown I/O of its own.

**What had to be decided.** How the toggle preserves bytes.

**Options considered.**

1. **Add a serializer dependency and round-trip through it.** Costs:
   fails the case's own third and fourth bullets by construction, and
   fails them *invisibly* — a round-trip test written from
   already-canonical markdown passes against it while every user body in
   a different spelling is silently rewritten.
2. **Markdown text is the buffer; the rich view is a projection.**
   `RichBuffer` holds the loaded bytes and returns them unchanged until
   the visual editor reports a real document change (`transaction
   .docChanged`, not a selection move). Toggling therefore performs no
   operation at all — byte-identical is the *absence* of a step rather
   than something achieved. Costs: once the user does edit in rich mode,
   the whole body is serialized to this module's spellings, not just the
   paragraph they touched.

**Decided.** Option 2.

**Why.** The cost of option 2 is unavoidable for any WYSIWYG surface over
markdown — the ProseMirror document has no memory of which bytes produced
which node — while the cost of option 1 is avoidable and is what the case
forbids. What option 2 buys is that *looking* is free, which is the common
case and the one the user cannot anticipate or opt out of. The residual
cost is real and is stated in `markdown.ts`'s header rather than claimed
away.

**To revert.** Delete the `dirty` check in `RichBuffer.text`
(`apps/web/src/client/editor/markdown.ts`) so it always returns
`toMarkdown(fromMarkdown(...))`. Eleven assertions in
`markdown.test.ts` go red, and TSK-17's blocker bullets go unmet.

### A15 · The idle editor does not poll for a fresher body token

**Ticket:** M2.3 · **Date:** 2026-08-29 · **Commit:** (this one)

**The situation.** XS-14's third bullet: an editor whose body changed
underneath it "either adopts the CLI's empty body or raises the conflict
surface; it does not silently restore the old text."

The editor holds the `bodyToken` from its last read. A body write
invalidates it and the response carries a fresh one, so an *active*
editing session stays current. But when the CLI writes and the user is
merely idle, nothing refetches until the shared 60s poll — so the user's
next keystroke is refused and they meet a conflict dialog they did
nothing to cause.

**What had to be decided.** Adopt the change, or let it conflict.

**Options considered.**

1. **Adopt: refetch on a short interval while the editor is clean.**
   Costs: a second polling loop for one component; and adoption while the
   user is mid-thought silently changes text under their cursor, which is
   the failure P1 exists to prevent, just in the other direction.
2. **Conflict: let the stale token refuse the next write.** The user is
   shown both versions and chooses. Costs: a conflict dialog for a user
   who was not competing with anyone, on their first keystroke after an
   unrelated CLI edit.

**Decided.** Option 2.

**Why.** XS-14 names both as acceptable, and option 2 is the branch that
cannot lose text: the refusal happens *before* the write, both versions
are shown, and the user picks. Option 1's failure mode is silent, which
is the one thing P1 rules out. Closing the window properly needs a read
on the write path, which is XS-13's residual-race question and larger
than this ticket.

**To revert.** Add a `refetchInterval` to `useTask` gated on the body
editor being clean. The XS-14 UI spec's second half — which asserts the
conflict surface appears — would need rewriting to assert adoption
instead.

### A16 · An edit opens in Markdown source; the composer opens rich

**Ticket:** M2.4a · **Date:** 2026-08-29 · **Commit:** (this one)

**The situation.** CMT-3's second bullet: "The raw markdown is what's
stored — reopening the comment for edit shows **the source the user
typed, not the rendered HTML**." CMT-7 requires the `@mention` picker
in the composer, and that picker is a ProseMirror affordance —
`MentionMenu` reads the editor's selection and inserts a node. The
plain CodeMirror surface has no picker.

Built rich-first, both surfaces the same, the CMT-3 spec failed with
the editor showing `bold and italic and code — see docs` where the
case asks for `**bold**`. So the two bullets pull opposite ways on one
surface.

**What had to be decided.** Which surface does a comment edit open in?

**Options considered.**

1. **Rich for both.** The picker is available everywhere. Costs:
   CMT-3's second bullet is simply unmet — the user reopening a
   comment sees rendered output, which is what the case names as the
   wrong thing. A blocker-adjacent major fails outright.
2. **Raw for both.** CMT-3 satisfied everywhere. Costs: CMT-7's picker
   disappears from the composer, which is a **blocker** case. Worse
   trade than option 1.
3. **Composer rich, edit raw, with the toggle `BodyEditor` already
   ships on both.** Costs: the two surfaces open differently, which a
   user could find surprising; and the picker is one click rather
   than zero away during an edit.

**Decided.** Option 3.

**Why.** It is the only option that satisfies both cases, and the
split follows what each case is *about*: CMT-7 is written about
composing a new comment ("Type `@` in the composer"), CMT-3 about
*reopening* an existing one. Writing is where a picker earns its
place; revisiting is where seeing what you actually stored does.

The mechanism is already built and already reviewed — `BodyEditor`'s
Rich/Markdown toggle over one `RichBuffer` (A14). This reuses it
rather than adding a surface, so neither mode is a dead end: flipping
to Rich during an edit restores the picker, and `RichBuffer` means
merely looking at the other tab does not reformat anything.

**Recorded rather than stopping the run** because it is contained —
one prop, one component, and reversing it is changing that prop back.
Nothing else builds on it.

**To revert.** `apps/web/src/client/comments/CommentItem.tsx` — the
`initialMode="raw"` prop on the edit `CommentComposer`. Removing it
restores option 1 and CMT-3's spec assertion on
`comment-edit-composer-mode-raw` inverts with it.

### A17 · The activity response reports how many history rows it could not read

**Ticket:** M2.4b · **Date:** 2026-08-29 · **Commit:** (this one)

**The situation.** CMT-37's second bullet has two clauses: "if some
entries parsed, **they render** and **the feed says the list is
incomplete** rather than presenting a partial log as complete." The
M2.4b probe verified the first — a malformed row is dropped and the
other 21 of 22 still render at HTTP 200 — and recorded the bullet as
already satisfied.

It is not. `readHistory` returns `validHistory(rows)`, which drops
what it cannot interpret and says nothing about it, and the route
computed `total` from that same filtered list. So a file with one
hand-broken entry read back as a **complete, shorter history**: the
response carried `total: 21` for a file holding 22 rows, and no client
could tell that from a file that genuinely held 21. The second clause
is unsatisfiable client-side, because the datum does not exist.

**What had to be decided.** Whether M2.4b — whose brief is "rendering,
not data" — changes the activity response.

**Options considered.**

1. **Leave it.** The bullet stays unmet and goes into
   `known-gaps.md`. Costs: a blocker case ships knowingly incomplete,
   and the failure mode is the silent one — a reader is shown a
   truncated audit log with nothing saying so. History is M2's only
   merge-recovery evidence, so "the log looks complete but isn't" is
   the worst shape this can take.
2. **Compare `total` against the raw row count in the client.** Costs:
   the client has neither number. It sees only what the server chose
   to send.
3. **Have the route read rows rather than entries, and report the
   count it dropped.** Costs: it is a server change inside a
   rendering ticket, and it adds a field to a response shape.

**Decided.** Option 3.

**Why.** The bullet cannot be satisfied any other way, and the change
is four lines in the handler plus three re-exports from core —
`readHistoryRows`, `validHistory` and `isMalformedHistoryEntry` all
already existed in `packages/core/src/task/index.ts` and were simply
not surfaced at the package root. Nothing about how history is read,
written or merged changed; the route now asks the reader a question it
could already answer.

The field is a **count**, not the rows. The feed's job is to say
*that* the log is incomplete and how much of it is missing; shipping
malformed YAML to the client would invite rendering it, and P-11 keeps
those rows in the file precisely so nobody has to interpret them.

`unreadable` is optional on the client type and tested as `> 0`, so a
response without it reads as "nothing was dropped" rather than as a
false alarm.

**To revert.** In `handleTaskActivity` (`apps/web/src/server/server.ts`)
restore `const entries = await readHistory(locttDir, task.frontmatter.id)`
and drop `unreadable` from the `json(...)` call; drop the three
re-exports from `packages/core/src/index.ts`; delete `unreadable` from
`ActivityPage` and the `IncompleteNotice` from `ActivityPanel.tsx`.
The UI spec "CMT-37: a partially readable history renders what parsed
and says it is incomplete" then fails, which is the point.

### A18 · The activity feed never sorts; it renders the server's order

**Ticket:** M2.4b · **Date:** 2026-08-29 · **Commit:** (this one)

**The situation.** CMT-30 asks that entries sharing a timestamp "render
in a deterministic order and do not reshuffle between renders or across
'Load more'". `_history.yaml` is append order, `/api/tasks/:ref/activity`
returns it reversed, and the timestamps are stamped per entry — so a
bulk operation writes several entries on the same millisecond.

**What had to be decided.** Whether the client sorts the entries it
renders.

**Options considered.**

1. **Sort by `timestamp` descending in the client.** Costs: a sort is
   applied to page 1, then to page 1+2, then to page 1+2+3 — a
   *different input each time*. `Array.sort` is stable, so this is
   harmless as long as the comparator is a pure timestamp compare; but
   the invariant it rests on is "the input was already sorted", which
   makes the sort a no-op that looks like a guarantee. Anything later
   added to the comparator — a tiebreak, a secondary key — silently
   becomes a reshuffle across a page boundary.
2. **Render the server's order, and never compare timestamps.** Costs:
   the feed inherits whatever order the file has, including after a
   git merge, where `mergeHistory` concatenates two timelines and the
   result is not globally chronological.

**Decided.** Option 2.

**Why.** Option 1's correctness is conditional on something the client
cannot check, and the condition is invisible in the code. Option 2's
correctness is structural: with no comparator there is nothing to be
unstable. It is also what core already decided for the same reason —
`readHistory`'s ascending path is documented as "left as the stored
order ... re-sorting it would reorder the one thing a reader can
currently rely on for ties".

Option 2's cost is real but small, and it lands on the *day grouping*
rather than on the entries: a merged file can revisit a day it already
left. That is handled by keying day sections in a `Map` rather than
closing a section when the day changes, so a recurring day joins its
existing heading — which CMT-17's last bullet requires anyway, for
pagination.

**Honest limit, measured.** Inserting a *stable descending* sort leaves
every ordering test green. That is correct rather than vacuous: the
input is already descending and `Array.sort` is stable, so such a sort
genuinely changes nothing. What the tests do catch is a comparator
whose tiebreak is not the input order — adding `|| Math.random() - 0.5`
turns both the unit test and the UI spec red on every run. This is
recorded in `group.test.ts`'s header so the next reader does not
mistake the first result for a hole.

**To revert.** Add a `.sort((a, b) => b.timestamp.localeCompare(a.timestamp))`
over `entries` in `groupActivity` (`apps/web/src/client/activity/group.ts`).
Nothing else depends on the absence.

### A19 · A relationship whose target no longer exists can be unlinked

**Ticket:** M2.5a · **Date:** 2026-08-29 · **Commit:** (this one)

**The situation.** REL-24 (blocker) requires a dangling edge — one
whose target ULID has no task directory — to render as a broken row
that "offers 'Remove this link' so the user can clean it up".

**It could not be cleaned up from anywhere.** Measured against a live
tracker before any change: `POST /api/tasks/T-1/unlink` with the
deleted target answered **404** ("task not found"), and
`loctt unlink T-1 blocks <deleted-id>` exited **1** with the same
message. The web route resolved the target with `lookupTask` before
calling core, and core's `unlinkTask` then read the target's file
unguarded for the inverse edge — a raw `ENOENT`, which surfaced as a
500 with the file path in `detail`.

So the one operation whose entire purpose is cleaning up after a
deleted task was the one operation a deleted task made impossible.

**What had to be decided.** Whether to fix it here, and how far.

**Options considered.**

1. **Leave it, drop REL-24's third bullet.** Costs: a blocker case
   fails on a bullet it states outright, and the user has no route to
   remove the row except editing YAML by hand — which is the thing the
   UI exists to avoid.
2. **Fix it in the web route only**, catching the lookup failure and
   passing the raw ref through. Costs: the CLI and MCP keep the defect,
   so `loctt unlink` still cannot clean up what the UI can. That is
   drift with a good address, which the "which layer" rule rules out
   (see `lessons.md` § Core / surface parity).
3. **Fix it in core, and stop the route resolving the target first.**
   Costs: it changes shared behaviour, so every surface's `unlink`
   becomes more tolerant than it was.

**Decided.** Option 3.

**Why.** The tolerance is narrow and provably correct rather than
merely convenient: there is no inverse edge to remove on a task that
does not exist, so skipping the inverse side is the right answer, not
a shortcut. The refusal path is untouched — `unlinkTask` still throws
when *neither* side holds the edge, which is what REL-44's "already
gone" message renders — so "any unlink now succeeds" is not what this
does, and a test pins that (`still refuses when the target is missing
AND the edge does not exist`).

Only two error shapes are swallowed, and only these two: core's
`TaskNotFoundError` and the platform's `ENOENT`. An `EACCES` or a
corrupt target file still propagates, because reporting an unreadable
task as a deleted one would be a different and worse lie.

**Recorded rather than stopping the run** because it repairs a defect
the case names rather than adding a requirement, and because it is
contained: one guarded read in core, one guarded lookup in the route.

**To revert.** `packages/core/src/task/relationships.ts` — drop the
`try`/`catch` around the inverse `readTask` in `unlinkTask` and the
`isMissingTask` helper; `apps/web/src/server/server.ts` — restore
`handleUnlink`'s unguarded `lookupTask(locttDir, request.target)`.
REL-24's removal half and REL-44 go red with it, and the two core
tests named above fail.

### A20 · The relationships panel renders no optimistic rows

**Ticket:** M2.5a · **Date:** 2026-08-29 · **Commit:** (this one)

**The situation.** P1 permits optimistic rendering with two
conditions, and the meta panel (`useSetField`) takes that permission:
a status change paints before the server answers. The relationships
panel does not.

**What had to be decided.** Whether link/unlink render optimistically.

**Options considered.**

1. **Optimistic, visually distinct while pending**, as P1 allows and
   as the board's drag does. Costs: REL-42 is the case where the
   forward write lands and the inverse does not, and its second bullet
   forbids "an optimistic UI showing a link that only half exists".
   Satisfying it would mean the optimistic row had to know *which
   half* failed — which the response shape does not say — or be rolled
   back on a failure that partially succeeded, which would then show
   less than is on disk.
2. **No optimistic rows; every write invalidates and the panel
   re-renders from the refetched file.** Costs: one local round-trip
   of latency per link, and the row does not appear under the
   pointer the instant it is clicked.

**Decided.** Option 2.

**Why.** A link is two file writes with five server-side guards
(self-link, cycle, archived target, duplicate, unknown type), and
every one of them can refuse *after* the click. A field edit is one
write with a value the client already knows. The two are not the same
bet, and P1's permission is a permission rather than an obligation.

The reorder keeps a visual exception, and only a visual one: the row
follows the pointer during a drag, because that is what dragging is —
but the committed order comes from the refetch, which is what REL-46's
"the UI never leaves a position on screen that isn't on disk" asks
for.

**Recorded rather than stopping the run** because it is contained to
this panel and reversible per mutation.

**To revert.** Add `onMutate`/`onError` optimistic bookkeeping to the
hooks in `apps/web/src/client/api/hooks/useRelationships.ts`, mirroring
`useSetField`. REL-42's row-count assertion is what goes red.

### A21 · The link picker's target search falls back to a direct lookup for retired keys

**Ticket:** M2.5a · **Date:** 2026-08-29 · **Commit:** (this one)

**The situation.** REL-8's third bullet: "Typing a former key from a
task's `key_history` resolves to the task it now belongs to."

`GET /api/search` runs core's `text ~`, whose searchable fields are
`["title", "key", "id"]` (`query/evaluator.ts`) — **`key_history` is
not among them**, so a retired key finds nothing there.
`GET /api/tasks/:ref` *does* resolve retired keys, via the key index.

**What had to be decided.** Where the retired-key resolution happens.

**Options considered.**

1. **Add `key_history` to core's `text` alias.** One request, and the
   behaviour would be consistent everywhere. Costs: `text` is the
   shared query language, so this changes what
   `loctt list "text ~ WEB-3"` matches on every surface and what every
   saved view using `text` returns. That is a P10 decision about the
   query language, which this ticket has no mandate to make.
2. **A second request from the picker**, to `GET /api/tasks/:ref`,
   merged in when the search missed it. Costs: two requests per
   keystroke that looks like a key, and the fallback is confined to
   this picker rather than being available to the CLI.

**Decided.** Option 2.

**Why.** Option 1 is the larger change wearing the smaller change's
clothes: it alters a language three surfaces share, in order to fix
one picker. The second request is cheap against a local server, is
already deduplicated against the search's own hits so a live key never
yields two rows, and can be replaced by option 1 later without the
picker noticing.

**Recorded rather than stopping the run** because it adds no
requirement and changes nothing outside the picker.

**To revert.** Delete `lookupExact` and its merge block in
`apps/web/src/client/api/hooks/useTaskSearch.ts`. REL-8's third
bullet becomes unmet.

### A22 · The attachment size cap is enforced on the client as well as the server

**Ticket:** M2.5b · **Date:** 2026-08-29 · **Commit:** (this one)

**The situation.** REL-35's second bullet wants the refusal to name
the file, its size and the cap in the user's units — "video.mp4 is
200 MB; the limit is 50 MB". The server's envelope says
`upload exceeds maximum size of 52428800 bytes`, which names one of
the three and in bytes.

**What had to be decided.** Where that message is composed.

**Options considered.**

1. **Rewrite the server's message.** One place, and every surface
   benefits. Costs: `multipart.ts` knows the declared filename but
   composes its message from `maxBytes` alone, and the envelope is
   read by the CLI and by anything else that POSTs — `52428800` is the
   right register for a developer reading a response body. Formatting
   bytes into "50 MB" for a machine-facing envelope is a worse
   message, not a better one.
2. **Refuse on the client, before the upload leaves.** The browser has
   `File.name` and `File.size` before it sends anything, so all three
   values are in hand. Costs: the cap is duplicated as a constant in
   `useAttachments.ts` (`@loctt/core` is a Node package and cannot be
   imported into the bundle for one integer), so it can drift from
   `DEFAULT_MAX_ATTACHMENT_BYTES`.

**Decided.** Option 2. The server check stays exactly as it is.

**Why.** It also satisfies REL-35's *first* bullet more strongly than
the server can: nothing is sent at all, so "the rejection happens at
the size check, not after a long upload" is not a claim about
streaming behaviour but about a request that never existed. The
duplication fails safe in the only direction that matters — a drifted
client constant rejects a file the server would have taken, which is
visible, rather than accepting one it will not.

**Recorded rather than stopping the run** because it adds no
requirement and changes no server behaviour.

**To revert.** Delete the `file.size > MAX_ATTACHMENT_BYTES` branch in
`send` in `apps/web/src/client/attachments/AttachmentsPanel.tsx`.
REL-35's message assertions go red, and the panel falls back to the
server's byte-count envelope.

### A23 · A twenty-file drop is twenty sequential requests, not a batch endpoint

**Ticket:** M2.5b · **Date:** 2026-08-29 · **Commit:** (this one)

**The situation.** REL-40 drops 20 files at once. An earlier audit
recorded this as a server gap because `multipart.ts` takes one file
per request.

**What had to be decided.** Whether to add a batch upload endpoint.

**Options considered.**

1. **A batch endpoint.** One request for the drop. Costs: it would
   have to invent a partial-failure response shape, and re-derive
   per-file errors — the size cap, the basename sanitisation, the
   collision 409 — that the single-file route already returns
   correctly. It also changes a documented surface the CLI and MCP do
   not share.
2. **Twenty sequential POSTs from the client.** Costs: twenty
   round-trips instead of one, and the panel owns the loop.

**Decided.** Option 2. `multipart.ts` is unchanged.

**Why.** Re-reading the case: it asks for *per-file outcome* — "each
file gets its own tile or its own failure line", "one failure does not
abort the remaining uploads" — and never for one request. Sequential
POSTs give exactly that, and each one takes the tracker lock anyway,
so concurrency would serialise regardless. The batch endpoint is the
harder path wearing the simpler path's clothes.

**Recorded rather than stopping the run** because it changes no
server code and no documented contract.

**To revert.** Replace the loop in `send` in
`AttachmentsPanel.tsx` with a single multi-file request, and give
`parseMultipartFile` a multi-part mode. REL-40's per-row assertions
are what would need rewriting.

### A24 · The web's Duplicate keeps core's `(copy)` title suffix

**Ticket:** M2.6 · **Date:** 2026-08-30 · **Commit:** (this one)

**The situation.** TSK-20 says "title, body, and metadata are copied"
and says nothing about a suffix. `loctt duplicate T-1` produces
`Original (copy)`.

The ticket brief and the M2.6 probe both attribute that suffix to the
CLI's own `overrides`. **That is wrong, and it inverts the decision.**
`duplicateTask` in `packages/core/src/task/duplicate.ts` reads
`title: overrides.title ?? \`${fm.title} (copy)\``. The suffix is
core's default; the CLI and the MCP `duplicate` tool both pass `title`
only when the user supplied one, and otherwise inherit it. It is also
documented in `duplicateTask`'s own contract comment.

**What had to be decided.** Whether the web route passes an
`overrides.title` to suppress the suffix and title the copy
identically — what TSK-20 says literally — or passes no override and
inherits core's.

**Options considered.**

1. **Pass `overrides: { title: fm.title }`.** The copy reads exactly
   as the case's words do. Costs: the web would be the only one of
   three surfaces actively overriding a documented core default, so
   the same action would produce two different titles depending on
   where it was invoked — the drift `CLAUDE.md` names as the reason
   core exists. It also leaves two rows with byte-identical titles and
   nothing but the key to tell them apart, which is worse in the list
   than in the case text.
2. **Pass no `overrides`.** The copy is `<title> (copy)`, matching CLI
   and MCP. Costs: a suffix TSK-20 does not mention.

**Decided.** Option 2. `handleDuplicate` passes no `overrides`.

**Why.** TSK-20's bullet is about *what is carried over* — it lists
title alongside body and metadata to say none of them is dropped, and
contrasts them with `created_at`/`key_history`, which are not. Reading
it as a prohibition on a suffix makes it also a prohibition core, the
CLI and the MCP already violate, and would make the web the odd one
out. Option 1 is the reading that requires the most new behaviour to
satisfy the fewest words.

**Recorded rather than stopping the run** because it changes no core
code and no documented contract: it declines to add a web-only
override. If the literal reading is preferred, the revert is one
argument.

**To revert.** Add `overrides: { title: <source title> }` to the
`duplicateTask` call in `handleDuplicate` in
`apps/web/src/server/server.ts`. Two assertions change: the
`^title:\s*Duplicable task \(copy\)$` match in
`apps/web/src/server/server.duplicate.test.ts` and the pair of
`(copy)` row assertions in `tests/ui/flow-tasks.spec.ts`'s TSK-20
specs. Nothing else reads the copy's title.

### K7 · TSK-20 gets its own ticket before M3

**Raised by the M2 gate at round 2 (F6) · Date: 2026-08-30**

**The situation.** TSK-20 (Duplicate) is a **blocker**, declared in
M2.1's `Cases:` line, and there is no Duplicate anywhere in the web
client — no route, no control. M2.1's run-log row lists what it closed
and omits it.

Core already has `duplicateTask`, and both the CLI and MCP call it.
Only the web layer does not.

It survived the whole of M2 because **`cases:coverage` cannot tell an
untagged case from an unbuilt one** — it reported TSK-20 alongside
genuine tagging gaps, which reads as bookkeeping. Round 2's gate found
it by reading the panel and probing the app.

**What had to be decided.** Build it retroactively into M2.1, give it
its own ticket, defer it to a named milestone, or drop it from M2's
declared cases?

**Options considered.**

1. **Its own ticket, before M3.** Core is ready and the CLI shows the
   shape, so it is a route, a menu item and the navigation path — a
   short subsection rather than a full ticket. M2's gate stays honest
   because the blocker closes before the milestone is signed off.
   Costs: one build cycle before M3 starts.
2. **Fold into M2.1 and re-gate.** Same code; the difference is
   whether the run log shows M2.1 eventually delivering what it
   declared. Costs: rewrites a shipped ticket's history.
3. **Defer to a named milestone.** Fastest to M3. Costs: a gate
   passing with a declared blocker open makes the verdict mean
   "passed except what we agreed to ignore" — which is precisely the
   ✅-before-cases failure M1 spent eight rounds undoing.
4. **Drop it from M2's cases.** Only right if Duplicate is genuinely
   unwanted in the web UI, and it would resurface at the next audit
   unless the flow doc changed too.

**Decided.** Option 1 — **its own ticket, M2.6, before M3.**

**Why.** Ken's call. It keeps the gate's verdict meaning what it says:
a milestone does not pass with a declared blocker unbuilt.

**To revert.** M2.6 (task Duplicate, TSK-20) has since shipped, so this
decision is spent: to change it now, remove the Duplicate feature and
choose one of options 2–4.

### A25 · The attachments read failure renders in the panel, not the page

**Ticket:** M2 gate round 3 · **Date:** 2026-08-30 · **Commit:** (this one)

**The situation.** Round 2's F5 fix made `buildShowModel` return
`attachmentsError` instead of rejecting, so one unreadable directory
stopped taking down the whole task read. The CLI renders it
(`task-crud.ts:358`), MCP renders it, and the web server serialises it
(`server.ts:2672`) — but the web *client* read it nowhere. Measured: the
Attachments section rendered "No attachments on this task yet." while
the activity feed said a file had been attached. That is a false claim
about the disk, not a missing feature.

REL-49 looked covered — four `@verifies REL-49` tags — but all four are
in core, and no UI test `chmod`s a directory.

**What had to be decided.** Where the failure surfaces in the web UI.

**Options considered.**

1. **A page-level error state.** Consistent with how a task that cannot
   be read at all is handled. Rejected: REL-49's second bullet requires
   relationships, comments, activity and meta to still render, and F5
   exists precisely so one unreadable directory does not take the page
   down. A page-level state would undo it.
2. **The panel renders the error in place of the empty state, with a
   retry.** Chosen. Satisfies all three bullets: names the reason,
   degrades only the section, offers a retry (`task.refetch()`).
3. **Reuse the per-tile `removeError` channel.** Rejected: that is keyed
   by attachment name, and here there are no tiles to key by.

**Why.** The empty state and the error state are the two readings of an
empty list, and the whole point of `attachmentsError` is telling them
apart. The panel is where the distinction is visible.

**To revert.** Drop the `attachmentsError`/`onRetry` props from
`AttachmentsPanel` and the two lines passing them in `TaskDetail.tsx`.
The server field can stay; CLI and MCP already use it.

**Test.** `flow-attachments.spec.ts` "REL-49: an unreadable attachments
directory degrades only that section" — `chmod 000` on a directory
holding a real attachment. Shown to fail: dropping the
`attachmentsError` prop at the call site turns it red on the
empty-state assertion, which is the exact shape of the bug that shipped.

### A26 · Board chip visibility is stored as the columns turned *off*

**Ticket:** M3.1 · **Date:** 2026-08-30 · **Commit:** (uncommitted)

**The situation.** BRD-3 and BRD-4 require the status chips bar to
toggle a column's visibility and persist that per user in
`users/<id>/settings.yaml`. BRD-4 adds that a user who has never
toggled sees **all** columns. Neither case says what the stored shape
is, and `UserSettings` has no key for it — the schema is
`.passthrough()` and the server stores settings schema-lessly, so
either shape is storable.

**What had to be decided.** Should the setting record the columns the
user has hidden, or the columns the user can see?

**Options considered.**

1. **Store the visible set.** Reads naturally ("these are your
   columns"). Costs: a status added to `workflow.yaml` afterwards is
   absent from every existing user's stored list, so it renders
   **hidden** for everyone who has ever touched a chip — a new column
   nobody can see and no message explains. That is the silent-omission
   shape P7 rules out, and it contradicts BRD-4's "all columns visible
   for a user who has never toggled" the moment a user toggles once.
2. **Store the hidden set.** Chosen. A column not mentioned is
   visible, so a newly configured column appears by default and the
   never-toggled user's empty setting means "show everything" without
   a special case. Costs: the stored value is a negation, which reads
   less directly in the file.

**Decided.** Option 2 — `board_hidden_columns` lists the columns
turned off.

**Why.** Option 1's failure is invisible and data-shaped: it makes a
config change silently subtract from what the user sees, which is
exactly what BRD-18 and BRD-24 exist to prevent elsewhere on this same
view. Option 2's cost is only legibility of a file the user rarely
opens.

**To revert.** `apps/web/src/client/board/chipSettings.ts` —
`HIDDEN_COLUMNS_KEY`, `hiddenColumnsOf`, `withHiddenColumns` — plus the
`hidden`/`visible` derivation in `BoardView.tsx`. Any stored
`board_hidden_columns` key becomes inert rather than harmful, since an
unknown settings key is ignored.

**Test.** `apps/web/src/client/board/cardLayout.test.ts` "reports
nothing hidden for a user who has never toggled" and "round-trips
hidden columns through the settings object"; `flow-board.spec.ts`
BRD-4 reads `settings.yaml` off disk. Shown to fail: making
`hiddenColumnsOf` always return `[]` reddens both unit tests, and
neutering the `visible` filter reddens BRD-3 and BRD-4.

### A27 · The board pages the task feed to 200 rather than the list's 50

**Ticket:** M3.1 · **Date:** 2026-08-30 · **Commit:** (uncommitted)

**The situation.** The board reuses `useTasksFeed`, whose default page
size is `DEFAULT_LIST_LIMIT` (50) because the list view paginates
visibly. A board does not: BRD-21 requires a column header to read the
**true total** (`900`), "not a page size", and BRD-14 requires a WIP
indicator's number to match the cards actually rendered. At 50 the
first paint would show truncated columns and counts that disagree with
the list view for the same filter — which BRD-24 explicitly forbids.

**What had to be decided.** What page size should the board request?

**Options considered.**

1. **Keep 50.** No change. Costs: every column is truncated until the
   feed exhausts itself, and the header count is briefly a lie. The
   case names that exact failure.
2. **Request everything in one call (no limit).** Costs: the server
   clamps `limit` to 200 (`urlInt(1, 200)`), so this is not actually
   available; asking for more silently yields 200 anyway.
3. **200, the server's ceiling.** Chosen. One request per 200 tasks,
   the fewest round trips the API allows, with the infinite feed
   continuing underneath for larger trackers.

**Decided.** Option 3 — `BOARD_PAGE_SIZE = 200`.

**Why.** It is the largest page the server will honour, so it
minimises the window in which a count is wrong without inventing a new
endpoint or changing the server's clamp. Virtualization and the
900-card scrolling behaviour BRD-21 also asks for are **not** built
here — see the gap noted in the M3.1 report.

**To revert.** `BOARD_PAGE_SIZE` in
`apps/web/src/client/board/BoardView.tsx`; deleting the `limit`
override returns the board to the list's 50.

**Test.** Not directly asserted — BRD-21 (900 cards) is not in M3.1's
owed set and no spec seeds past 200. The constant is exercised
indirectly by every board spec.

### A28 · `reorderBoardRank` writes nothing when the rank is unchanged

**Ticket:** M3.2 · **Date:** 2026-08-30 · **Commit:** (uncommitted)

**The situation.** BRD-31 requires that dropping a card into the exact
position it already occupies be a no-op: "`board_rank` on disk is
unchanged, and no history entry is written … `updated_at` is not
bumped." `reorderBoardRank` had no same-position guard. Measured on
the CLI before the fix:

```
board-rerank T1 --after T2  → rank u, history 2 entries
board-rerank T1 --after T2  → rank u (UNCHANGED), history 3, updated_at ADVANCED
```

The field path already behaves correctly — `buildSetFieldHistory`
returns no entries when `before === value`, and `set T1 priority high`
twice leaves history untouched (measured, 4 entries both times). So
this was an inconsistency *inside* core, not a design choice.

**What had to be decided.** Whether to guard in core (shared by CLI,
MCP and web) or only suppress the request in the web client.

**Options considered.**

1. **Client-side only.** The board would not send the request, and
   BRD-31 would pass. Costs: `loctt board-rerank` and the MCP tool keep
   writing a phantom history entry and bumping `updated_at`, so the
   audit trail still claims moves that never happened — and the two
   surfaces disagree about what the same operation does, which is the
   drift CLAUDE.md names.
2. **Guard in core.** Chosen. An early return when the computed rank
   equals the prior one, before the write and before `appendHistory`.
   Every surface inherits it. Costs: a caller that *wanted* an
   idempotent touch to bump `updated_at` no longer gets one — no caller
   does, and `updated_at` is documented as "stamped on every write",
   not every call.

**Decided.** Option 2 — the guard lives in `reorderBoardRank`.

**Why.** The defect is in core's behaviour, not in the board's use of
it; fixing it at the caller would leave the CLI and MCP wrong and make
BRD-31 true only of the web. The client *also* declines to send the
request (see A29), but that is about not making a pointless round trip,
not about correctness of the write.

**To revert.** `packages/core/src/rank/reorder.ts` — the
`newRank === priorBoardRank` early return. Removing it restores the
prior behaviour exactly.

**Test.** `packages/core/src/rank/reorder.test.ts` — "writes nothing
when the computed rank equals the current one" (asserts rank,
`updated_at` and history length off disk) and "still writes when the
drop actually changes position", which is what stops the guard being
widened into "never write". Shown to fail: deleting the guard reddens
the first test only (12 others stay green); typecheck exits 0 with the
mutation in place.

### A29 · A cross-column drop is one `setFields` write, reached by a new `board-move` route

**Ticket:** M3.2 · **Date:** 2026-08-30 · **Commit:** (uncommitted)

**The situation.** BRD-9, XS-9 and CW-5 all require a cross-column drag
to write `status` and `board_rank` in **one** request — "two sequential
single-field calls is a failure of this case". BRD-41 adds that a
failed drop must leave *neither* field written. The web server had
`POST /api/tasks/:ref/set` (one field per request) and
`POST /api/tasks/:ref/board-rerank` (rank only, and it derives peers
from the task's *current* status, so it cannot rank against the
destination column's cards). `setFields` existed in core, exported,
with no caller anywhere.

**What had to be decided.** How the web reaches an atomic two-field
write, given `board_rank` is in `AUTO_MANAGED_FIELDS` and `setFields`
therefore refuses it.

**Options considered.**

1. **Two requests (set status, then rerank).** Costs: the exact shape
   the cases forbid. A crash between them leaves a card in a column its
   status contradicts, which is unrecoverable without a manual file fix.
2. **Remove `board_rank` from `AUTO_MANAGED_FIELDS`.** One line, and
   `setFields` would take it. Costs: `loctt set <task> board_rank u`
   becomes legal on every surface, so a user can hand-write a rank that
   collides with a peer's or sits outside the alphabet — the guard
   exists precisely to keep rank computation in `reorderBoardRank`.
3. **A per-call grant.** Chosen. `setFields` takes an optional
   `allowAutoManaged` set, empty by default; the new
   `POST /api/tasks/:ref/board-move` route passes `{"board_rank"}`. The
   refusal stays the default on every existing path.

**Decided.** Option 3 — `allowAutoManaged`, plus a `board-move` route
calling `setFields`.

**Why.** It gets the atomic write the cases require without widening
what users can write. The grant is per-field and per-call, so
`completed_date` — the other auto-managed field, computed from the
workspace timezone — stays refused even on this path.

Two supporting changes were needed and are part of this decision:
`setFieldsLocked` now writes a granted auto-managed field at the **top
level** of frontmatter (it would otherwise fall through to the
custom-field branch and nest `board_rank` under `fields:`, where
nothing reads it), and `buildSetFieldHistory` records it as a
`field_change` rather than a `custom_field_change` naming a `fields:`
key that does not exist.

**To revert.** Delete `handleBoardMove`, `TASK_BOARD_MOVE_RE`,
`BOARD_MOVE_GRANT` and the route-table entry in
`apps/web/src/server/server.ts`; drop `allowAutoManaged` from
`SetFieldsOptions` / `assertChangesWritable` / `setFields` and the
`AUTO_MANAGED_FIELDS` branch in `setFieldsLocked` and
`buildSetFieldHistory` in `packages/core/src/task/update.ts`; point
`useBoardMove` at the old two-call shape. The CLI and MCP are
untouched by this decision and need no revert.

**Test.** `packages/core/src/task/update.test.ts` — "writes status and
board_rank together when board_rank is granted" (asserts both fields
off disk, that `board_rank` is *not* under `fields:`, and that both
history entries share one timestamp), "still refuses an auto-managed
field the caller was not granted", "refuses board_rank when no grant is
passed". `tests/ui/flow-board.spec.ts` BRD-9 counts the POSTs (exactly
one) and reads the resulting rank off disk, asserting it falls strictly
between the two neighbours. Shown to fail: routing `board_rank` down
the custom-field branch reddens the first test only; ignoring the grant
reddens the other two. Both mutations typecheck.

### A30 · The board's drag is built on pointer events, and a no-op drop is decided by neighbours

**Ticket:** M3.2 · **Date:** 2026-08-30 · **Commit:** (uncommitted)

**The situation.** `apps/web` has no drag-and-drop dependency. M3.2
needs a drag threshold (BRD-37: a 2px move stays a click), `Esc` and
external cancellation (BRD-36), and a drop computed against the
neighbours the user saw at release rather than whatever a mid-drag
refetch re-sorted (BRD-32).

**What had to be decided.** Whether to add a drag library, use HTML5
drag-and-drop, or hand-roll on pointer events; and how to decide that a
drop is a no-op.

**Options considered.**

1. **Add `@dnd-kit` or similar.** Costs: a new runtime dependency this
   ticket has no mandate to add, and its own cancellation semantics to
   fight for BRD-36.
2. **HTML5 drag-and-drop.** Costs: `dragstart` fires on the browser's
   threshold, not ours, so BRD-37's 2px bullet is not expressible; it
   also suppresses the click that BRD-8 needs.
3. **Pointer events.** Chosen. ~230 lines in `useBoardDrag.ts`, with the
   pure geometry in `dragModel.ts` so it is unit-testable without
   synthesizing pointer events.

**Decided.** Option 3.

**Why.** Two of the owed cases are specifically about gesture
thresholds and cancellation, which are exactly what a library
abstracts away.

The second half of this decision was forced by measurement. `isNoOpDrop`
first compared the drop's index against the card's original index; the
BRD-31 spec caught it. While a card is held it is lifted out of the
flow, so the cards below shift up and a pointer held perfectly still
resolves one slot *lower* than the drag began — measured: origin index
1, resolved index 2, and a write BRD-31 forbids. Two changes fix it
together: the dragged card keeps its box in the column (rendered as a
dimmed placeholder, which BRD-11 wants anyway) so the geometry matches
the screen, and `isNoOpDrop` compares the **pair of neighbours** rather
than indices, since neighbours are stable under renumbering.

**To revert.** Delete `apps/web/src/client/board/useBoardDrag.ts` and
`dragModel.ts`, the `drag` / `onCardPointerDown` / `onKeyboardMove`
props on `Column` and `BoardCard`, and `useBoardMove`. `BoardView`
returns to rendering static cards.

**Test.** `apps/web/src/client/board/dragModel.test.ts` (18 tests) for
the geometry and the no-op rule; `tests/ui/flow-board.spec.ts` for the
gestures end-to-end. Shown to fail: `statusForColumn` picking the last
status reddens both BRD-13 tests; `insertionIndex` comparing top edges
instead of midpoints reddens two; comparing only one neighbour in
`isNoOpDrop` reddens "requires both neighbours to match" — that
mutation initially **survived**, which is why that test exists.

### A31 · A dangling `timeline.dependency_relationship` survives the write instead of being silently deleted

**Ticket:** M3.3a · **Date:** 2026-08-30 · **Commit:** (this one)

**The situation.** `autoClearTimelineDependency`
(`packages/core/src/config/workflow-write.ts:152`) deleted
`timeline.dependency_relationship` from the config on every write
whose value was not a key in `relationships`. Its docstring called
this deliberate: "a dangling timeline ref would just render zero
arrows anyway, so we silently drop the field rather than failing the
write or leaving a misleading config on disk."

Measured before the change: with `dependency_relationship: blocks`
set and `blocks` removed from `relationships`, `saveWorkflowConfig`
wrote a `workflow.yaml` with the line **gone**, and
`loadWorkflowConfig` returned `timeline: undefined`.

TML-34's third bullet requires the opposite: "Setting
`dependency_relationship` to a key that does not exist in
`relationships` results in no arrows plus a visible configuration
notice naming the missing key — **not a silent no-op** and not a
crash."

The two cannot both hold. A notice cannot name a key that the writer
has erased from the file.

**What had to be decided.** When a workflow write carries a
`dependency_relationship` naming a relationship that does not exist,
should the field be deleted, rejected, or preserved?

**Options considered.**

1. **Keep the auto-clear.** No code changes. Costs: TML-34's third
   bullet is unsatisfiable — there is nothing left to name. Worse, a
   user who typos `dpends_on` has the line removed from a file they
   hand-authored, sees no arrows, and has no way to discover why: the
   evidence of the mistake is destroyed by the tool. This is the
   silent pruning P7's amendment closed the last carve-out for.
2. **Reject the write.** `assertWorkflowConfigValid` throws on a
   dangling ref. Costs: deleting a relationship would then fail the
   *whole* workflow write — including remaps that are otherwise valid
   — until the user separately fixes the timeline block. It turns a
   cosmetic dangling reference into a hard blocker on an unrelated
   edit, and TML-34 says "not a crash".
3. **Preserve the value.** The write passes the field through
   untouched; consumers resolve it against `relationships` and report
   a miss. Costs: `workflow.yaml` can now hold a reference that does
   not resolve, so every consumer must treat the field as
   possibly-dangling rather than assuming validity. That obligation is
   documented on both the schema and the writer.

**Decided.** Option 3 — the field is preserved, and resolution moves
to the consumer.

**Why.** It is the only option that satisfies TML-34's third bullet,
and the only one that keeps the user's own configuration intact. P7
forbids silently dropping data the user can see; a line in a
hand-edited YAML file is exactly that. Option 2 was rejected because
the case explicitly rules out a crash and because it couples an
unrelated edit to a cosmetic problem.

The consumer-side half is `dependencyRelationshipStatus` in
`apps/web/src/client/timeline/settings.ts`, which returns
`{kind: "none" | "ok" | "missing", key}`. M3.3a draws no arrows in the
`missing` case; **rendering the notice is M3.3b's TML-34** — this
decision only makes the fact and the key's name reachable.

**Two green tests were editing to make this pass, and both were
asserting the bug** (CLAUDE.md: "if a fix requires editing a green
test, that test was asserting the bug"):
`packages/core/src/config/workflow-write.test.ts` — "drops
timeline.dependency_relationship when the referenced key is gone"
(asserted `final.timeline` was `undefined`) and "preserves new
timeline fields when dependency_relationship is auto-cleared"
(asserted the field was `undefined`). Both now assert the value
survives, and the first also reads `workflow.yaml` off disk, because
the notice is only possible if the *file* still says so.

Verified sane on the other two surfaces with the dangling value on
disk: `loctt doctor` reports `workflow.yaml: valid` and passes every
check; `loctt create` / `list` / `link` behave normally (`link`
rejects the removed relationship with "unknown relationship 'blocks'.
Known: parent, clones, …" rather than crashing); the MCP
`get_workflow_config` returns the config with the dangling string
intact, and `tests/integration/mcp/config-parity.test.ts` passes.

**To revert.** Restore `autoClearTimelineDependency` in
`packages/core/src/config/workflow-write.ts` and re-add its call
inside `assertWorkflowConfigValid` (it was the inner call of
`renumberPriorities(autoClearTimelineDependency(config))`). Revert the
docstrings on `saveWorkflowConfig` and on `TimelineConfigSchema` in
`packages/contracts/src/workflow.ts`. Flip the two tests named above
back to `toBeUndefined()` and drop the on-disk assertion. In the web
client, `dependencyRelationshipStatus` collapses to `none` vs `ok`,
and its "missing" test in
`apps/web/src/client/timeline/settings.test.ts` goes with it — as does
TML-34's third bullet.

### A32 · The timeline's zoom, grouping and arrows live in the URL; collapsed bands do not

**Ticket:** M3.3a · **Date:** 2026-08-30 · **Commit:** (this one)

**The situation.** The timeline has four pieces of view state: zoom,
grouping, the arrows toggle, and which bands are collapsed. The cases
are explicit about the first three and silent about the fourth.

TML-1: "The URL reflects the effective zoom so the view is shareable."
TML-8: "Changing to `none` … updates the URL." TML-15: "The toggle
state is reflected in the URL (or the saved view's
`display.show_arrows`) so the state is shareable."

TML-6, on collapse, says only: "Bands are collapsible and the
collapsed state does not change the URL's task scope."

**What had to be decided.** Does the collapsed state belong in the URL
alongside the other three?

**Options considered.**

- *Collapse in the URL too.* Consistent with the other three, and a
  shared link reproduces the exact screen. Costs: TML-6 requires that
  collapsing not change "the URL's task scope", so a collapse param
  would have to be provably scope-free — a guarantee maintained by
  care rather than by construction. It also puts a transient
  affordance into the shareable identity of a view, so every collapse
  becomes a history entry that back/forward walks through.
- *Collapse as local component state.* TML-6's guarantee holds
  trivially — the URL cannot change task scope if it does not change
  at all. Costs: a shared link does not reproduce which bands the
  sender had collapsed.

**Decided.** Collapse is local state in `TimelineChart`; zoom,
grouping and arrows are URL search params in `timelineSearch.ts`.

**Why.** The three the cases name as shareable are shareable; the one
they do not name is the one whose only stated requirement is a
negative ("does not change the URL's task scope"), which local state
satisfies by construction. A collapsed band is a display affordance,
not a description of what is being looked at.

`timelineSearchSchema` *extends* `listSearchSchema` rather than
redefining it, for the same reason the board shares it outright
(BRD-1, BRD-14): a filter must mean the same thing in every view, and
`/timeline?assignee=…` must select what `/list?assignee=…` selects.

**To revert.** Add a `collapsed` CSV param to
`apps/web/src/client/router/timelineSearch.ts`, lift the `collapsed`
`useState` out of `TimelineChart.tsx` into `TimelineView.tsx`, and
pass it down. The band-collapse assertions in TML-6 in
`tests/ui/flow-timeline.spec.ts` — which currently assert
`page.url()` is *unchanged* after a collapse — would need inverting.

### A33 · Weekend and holiday shading is drawn at day and week zoom, not at month

**Ticket:** M3.3a · **Date:** 2026-08-30 · **Commit:** (this one)

**The situation.** TML-13's first bullet: "Saturday and Sunday columns
are faintly shaded **at day and week zoom**." The case names two of the
three zoom levels and says nothing about the third.

At month zoom a day column is 4px wide, so a weekend is an 8px band
repeating every 28px across the whole chart.

**What had to be decided.** Should the shading also be drawn at month
zoom, where the case does not ask for it?

**Options considered.**

- *Shade at all three zooms.* Uniform behaviour, one less branch.
  Costs: a year-wide month view becomes a striped background of ~104
  shaded bands, which is visual noise on a chart nobody reads
  day-by-day, and it competes with the bars for contrast.
- *Shade at day and week only.* Exactly what the bullet lists. Costs:
  the shading "disappears" when zooming out, which a user could read
  as a bug rather than a choice.

**Decided.** Day and week only — the literal reading of the bullet.

**Why.** The case enumerates the levels, and enumeration in these
docs has been deliberate elsewhere (TML-3 enumerates the header
labelling per level too). The decorative purpose stated in
`calendar.ts` ("No business-day math — purely cosmetic") does not
survive contact with 104 stripes.

**To revert.** In `apps/web/src/client/timeline/TimelineView.tsx`,
remove the `zoom === "month" ? [] :` guard on `shaded`. No geometry
changes — `nonWorkingReason` already answers per-day at every zoom.

### A34 · Tasks with no status form their own pseudo-column

**Ticket:** K8 · **Date:** 2026-08-30 · **Commit:** (this one)

**The situation.** K8 scopes `board_rank` by column, derived through
`deriveColumns`. But `deriveColumns` gives a status-less task **no
column**: `bucketTasks` drops it and the orphan bucket explicitly skips
`status === undefined`, so the board never renders it. Core's own
fixtures create exactly such tasks — `makeTasks` in `reorder.test.ts`
makes tasks with no status at all, and the BRD-28/BRD-49 rebalance
tests rank them.

**What had to be decided.** What column a status-less task belongs to,
given `deriveColumns` has no answer.

**Options considered.**

- *Treat them as one pseudo-column.* Status-less tasks are peers of
  each other and of nothing else. Costs: a concept that exists in the
  ranking layer and nowhere in the rendering layer.
- *Put them in every column / rank them against all tasks.* Costs: a
  status-less task's rank would be interpolated against cards it never
  renders beside — the exact SPR-C2 defect, reintroduced.
- *Refuse to rank them.* Costs: breaks the existing rebalance tests and
  removes a capability the CLI has today.

**Decided.** A pseudo-column: tasks sharing an absent status form their
own sequence.

**Why.** It preserves pre-K8 behaviour for these tasks *exactly* —
before K8 the scope was `moved.frontmatter.status`, which for a
status-less task was `undefined` and matched only other status-less
tasks. So this is not a new rule, it is the old rule stated honestly
now that "column" and "status" have come apart. Inventing an answer
where `deriveColumns` has none was the alternative the review warned
about.

**To revert.** In `packages/core/src/rank/column-scope.ts`, delete the
`STATUSLESS_COLUMN` symbol and have `columnStatusesFor` return an empty
set for `status === undefined`. The BRD-28/BRD-49 rebalance tests in
`reorder.test.ts` will fail, which is the signal that this decision was
load-bearing.

### A35 · A column-membership config change yields an arbitrary-but-stable interleave

**Ticket:** K8 · **Date:** 2026-08-30 · **Commit:** (this one)

**The situation.** `board_rank` is one string per task, scoped to
nothing on disk; column membership is a function of config at read
time. Editing `workflow.boards` to merge two columns brings two
independently-dense sequences together, and they interleave by raw
string comparison.

**What had to be decided.** Whether to repair ranks when a config
change alters column membership.

**Options considered.**

- *Renumber the merged column on config save.* Costs: a config edit
  becomes a bulk write across every task in the affected columns,
  bumping `updated_at` and writing history for cards nobody touched —
  and it would have to run on every surface that can save workflow
  config.
- *Leave it; the interleave is arbitrary but stable.* Costs: after a
  merge, the first render's order is not meaningful.

**Decided.** Leave it. No repair pass.

**Why.** `sortColumn` tiebreaks equal ranks by `created_at` then `id`,
so the result is deterministic across reloads (BRD-29) — arbitrary is
not the same as unstable. The first drag repairs positions locally, and
no invariant breaks. Splitting a column is even cleaner: a subsequence
of a total order is still a total order, so relative order of
same-status cards is preserved exactly.

**To revert.** Add a normalization pass to `saveWorkflowConfig` that
re-spaces `board_rank` per column when `boards` changed. Note it would
need the archived guard and a history policy for the tasks it rewrites.

### A36 · `reorderBoardRank` now loads workflow config, so a malformed `boards` block fails the reorder

**Ticket:** K8 · **Date:** 2026-08-30 · **Commit:** (this one)

**The situation.** To scope by column, `reorderBoardRank` calls
`loadWorkflowConfig`, which throws on an absent or invalid
`workflow.yaml`. The `boards` cross-column duplicate-status check lives
in the zod schema itself, so it runs on every parse. A CLI
`board-rerank` in a tracker with a malformed `boards` block goes from
"works, status-scoped" to "config error".

**What had to be decided.** Whether to swallow the config error and
fall back to status scoping.

**Options considered.**

- *Catch and fall back to 1:1 status columns.* The reorder keeps
  working. Costs: it silently writes a rank under a column model that
  is not the one the user configured — and the board, which does
  surface the config error (BRD-45), and the CLI would then disagree
  about what happened.
- *Let it throw.* Costs: a previously-working command now fails on a
  file the user may not realise is broken.

**Decided.** Let it throw.

**Why.** Consistent with BRD-45's spirit: a malformed `boards` block is
surfaced, not worked around. Ranking against a column model the user
did not configure is the drift K8 exists to remove. The error names the
file and the offending keys, which is actionable.

**To revert.** In `packages/core/src/rank/reorder.ts`, wrap the
`loadWorkflowConfig` call in a try/catch returning `undefined`, and
have `columnStatusesFor` fall back to `new Set([status])` when the
workflow is absent.

### A37 · The web client imports core's column module by subpath, not through the barrel

**Ticket:** K8 · **Date:** 2026-08-30 · **Commit:** (this one)

**The situation.** Moving `deriveColumns` into core and re-exporting it
from `@loctt/core` broke the client bundle: `vite build` failed with
`"resolve" is not exported by "__vite-browser-external"`. Core's barrel
pulls in `paths/index.js`, which imports `node:path` — no browser
build.

**What had to be decided.** How the browser reaches a pure-logic module
that lives inside a node-flavoured package.

**Options considered.**

- *Add a `node:path` browser shim / alias in vite config.* Costs:
  pulls all of core into the client bundle to use one pure function,
  and hides the next accidental node import behind a stub.
- *Add a narrow subpath export for the one module.* Costs: a second
  entry in `exports`, and the discipline that this module must stay
  free of node imports.
- *Keep a copy in the client.* Costs: the drift K8 exists to remove.

**Decided.** A subpath export: `@loctt/core/board/columns.js`.

**Why.** It is the narrowest thing that works and it fails loudly —
if someone adds a node import to `board/columns.ts`, the client build
breaks immediately rather than silently bundling a shim. The module is
pure logic over types by construction, which is the premise K8's move
rests on anyway.

**To revert.** Remove the `./board/columns.js` entry from
`packages/core/package.json`'s `exports` and point
`apps/web/src/client/board/columns.ts` at `@loctt/core`. The client
build will then fail until a `node:path` shim is configured in vite.

### A38 · K9's status field is prepended to the card layout, per column

**Ticket:** K9 · **Date:** 2026-08-30 · **Commit:** (this one)

**The situation.** K9 requires a card's status to be visible in a
multi-status column regardless of `card_layout`, while single-status
columns honour `card_layout` as configured. K9 does not say *where* in
the card the status goes.

**What had to be decided.** Position of the forced status field, and
the layer that applies the rule.

**Options considered.**

- *Append it after the configured fields.* Costs: it trails behind the
  due date, which is the least scannable position for the one field
  that disambiguates the pile.
- *Prepend it.* Costs: it displaces the user's chosen first field in
  those columns only.

**Decided.** Prepend, resolved per column in
`resolveColumnCardLayout`, applied inside the `Column` component.

**Why.** The status is the disambiguator the user is scanning for in
exactly the columns where the rule fires, so it leads. Resolving per
column rather than per board is required, not stylistic: one board can
hold both single- and multi-status columns, and K9 scopes the override
to the latter only. A layout that already lists `status` is left
untouched, so the field never doubles.

**To revert.** In `apps/web/src/client/board/cardLayout.ts`, change
`return ["status", ...layout]` to `return [...layout, "status"]`, or
delete `resolveColumnCardLayout` and pass `layout` straight through in
`BoardView.tsx`'s `Column`.

### A39 · A dedicated `set-dates` route, not a general multi-field write endpoint

**Ticket:** M3.3b · **Date:** 2026-08-30 · **Commit:** (this one)

**The situation.** TML-11 requires a body drag to send both dates "in a
**single** atomic multi-field write, not two sequential calls". The web
server's task route was singular — `TASK_SET_RE` → `handleSetField` →
core's `setField`, one field per request. No existing web route could
satisfy the case. Core's `setFields` (plural, atomic) was already
exported and already had callers (`task/update.ts`, `task/bulk.ts`,
`rank/board-move.ts`); what was missing was a web caller.

**What had to be decided.** The shape of the new route: a general
`POST /api/tasks/:ref/set-fields` taking a `changes[]` array, or a
narrow `set-dates` taking `{ start_date?, due_date? }`.

**Options considered.**

- *A general `changes[]` endpoint.* Costs: it is a much larger surface
  than any case asks for, and it lets a client push `status`, `title`
  or a custom field through a path whose error envelopes, validation
  and recovery hints are written about dates. Every future field
  becomes reachable through it by default rather than by decision.
- *A narrow `set-dates` endpoint.* Costs: a third field that must move
  atomically with the dates would need the route widened or a sibling
  added.

**Chosen:** the narrow `set-dates`, mirroring `board-move`'s precedent
— that route is likewise named for the operation (`status` +
`board_rank`) rather than being a generic writer.

**Why.** Each of TML-9/10/11 is exactly one of the three shapes this
accepts (due only, start only, both), so the route's surface is the
case's surface. It also lets the start-after-due guard (TML-45) live in
the handler against the *effective* pair — the stored value of whichever
date the request does not carry — which a generic endpoint could not do
without knowing dates were special anyway.

No `allowAutoManaged` grant is passed, and that was checked rather than
assumed: `board_rank` needed one because it is in `AUTO_MANAGED_FIELDS`,
whereas `start_date` and `due_date` are `BUILTIN_OPTIONAL_FIELDS` — the
same user fields `loctt set` writes — so the default refusal does not
apply to them. Passing a grant that is not needed would widen the route
to fields it has no business writing.

**To revert.** Delete `TASK_SET_DATES_RE`, its route-table entry and
`handleSetDates` from `apps/web/src/server/server.ts`, and delete
`apps/web/src/client/api/hooks/useTaskDates.ts`. The drag layer would
then need two sequential `/set` calls, which fails TML-11 and TML-43.

### A40 · Edge-resize handles get a 6px minimum hit area, raised above the bar label

**Ticket:** M3.3b · **Date:** 2026-08-30 · **Commit:** (this one)

**The situation.** M3.3a left the two resize handles as 1px strips
(`w-1`) with no explicit stacking. Measured with
`document.elementFromPoint` at the bar's own right edge, the element
returned was the **BUTTON**, not the handle — so an end-edge drag was
dispatched as a *body* drag and the request carried `{start_date,
due_date}` where TML-9 requires `{due_date}` alone. This was a real
defect reachable by a user, not only by a test.

**What had to be decided.** Whether to enforce a minimum hit area or to
disable edge-resize at narrow scales. TML-36's first bullet explicitly
offers both: "either the edge handles remain grabbable (a minimum hit
area is enforced), or edge-resize is disabled at that scale with an
explanation on hover."

**Options considered.**

- *Disable edge-resize below some bar width.* Costs: it removes a
  capability at exactly the zoom where a user is most likely to be
  adjusting a deadline, and it needs a hover explanation and a
  threshold, both of which are new invented behaviour.
- *Enforce a minimum hit area.* Costs: on a bar narrower than
  `2 × EDGE_HIT_PX` the two handles overlap, and one of them wins.

**Chosen:** a 6px minimum hit area (`EDGE_HIT_PX`), with `z-10` so the
handle sits above the truncating title span, and `cursor-ew-resize`.
The start handle wins on an overlapping narrow bar.

**Why.** The alternative removes a capability; this one keeps it and
costs only an ambiguity on bars a few pixels wide, where the start
handle winning is a defined outcome rather than a coin-toss between
"resize" and "move". Six pixels rather than one because a 1px strip is
not a target a pointer can reliably find — which is what the measured
`elementFromPoint` result showed.

**To revert.** In `apps/web/src/client/timeline/TimelineChart.tsx`,
restore the handles to `className="absolute inset-y-0 left-0 w-1"` /
`right-0 w-1` and delete `EDGE_HIT_PX`. TML-9's payload assertion goes
red immediately, which is the intended alarm.

### A41 · TML-48's invalid date surfaces through the unreadable notice, not the Unscheduled lane

**Ticket:** M3.3b · **Date:** 2026-08-30 · **Commit:** (this one)

**The situation.** TML-48 hand-edits a task to `start_date: "next
tuesday"` and requires it to appear "in Unscheduled (**or flagged in
place**) with the invalid value shown verbatim", with no `Invalid Date`
leaking anywhere and a message naming the task and the field.

**Measured against the real server:** such a task fails the task schema
on read, so `GET /api/tasks` returns it not in `items` but in
`unreadable`, with `reason: "start_date must be YYYY-MM-DD or full
ISO-8601 timestamp"`. The client is never handed a task carrying the
bad value, so it *cannot* place one in the lane.

**What had to be decided.** Whether to change the server so invalid
dates pass through as ordinary tasks (making the lane branch
reachable), or to treat the unreadable notice as the "flagged" branch
the case permits.

**Options considered.**

- *Relax the task schema so a bad date parses through.* Costs: it
  changes core read behaviour for every surface — CLI, MCP and web —
  to satisfy one web case, and it weakens a validation that currently
  catches corruption at the boundary. That is a scope change, not a
  build decision.
- *Treat the unreadable notice as the flag.* Costs: the verbatim value
  reaches the user as part of the parse reason rather than as a
  standalone field value.

**Chosen:** the unreadable notice.

**Why.** The case offers "or flagged in place" explicitly, so routing
through the unreadable notice is a legitimate reading of bullet 1.

**CORRECTION, 2026-09-01 (M3 gate round 1).** The sentence that stood
here — "the task is named, the offending field is named" — was **false**,
and it made a partial case read as met. Measured against a live server
with a hand-edited `start_date: "next tuesday"`:

    {"id": "01M1CJZ…", "path": "/…/tasks/01M1CJZ…/task.md",
     "reason": "start_date must be YYYY-MM-DD or full ISO-8601 timestamp"}

The payload carries a **ULID file path** and a generic schema
constraint. It does not carry the task's title, its key, or the
offending value. `TimelineView.tsx:546` renders exactly `{u.path}:
{u.reason}`, so the screen shows both and neither.

So **bullet 3 — "the message names the task and the offending field
value" — is unmet**, on both halves. Bullet 2 holds (no `Invalid Date`
leaks). Bullet 1 holds under the "flagged in place" reading.

Naming the task requires the server to carry a display name for a file
it could not parse — the title may itself be unreadable — and naming
the value requires the ZodError's received input to survive into the
envelope. Neither is hard, but both are server work on a payload the
CLI and MCP share, and this was found during a gate rather than a
build. Recorded here and in known-gaps as unmet rather than left
overstated. The
client-side lane path still exists and is unit-tested
(`dateProblem.test.ts`, kind `invalid`) — it is what renders this if
the API ever starts passing such tasks through, so the behaviour is
built, not merely deferred.

**To revert.** If the task schema is later relaxed to admit unparseable
dates, no client change is needed: `dateProblem` already classifies
them as `{kind: "invalid", field, value}` and `UnscheduledLane` already
renders the reason. Only the UI test's expectation would move from
`timeline-unreadable` back to
`timeline-unscheduled-reason-<key>`.


### A42 · `createTask` throws a typed error, so a rejected value is a 400 and not a 500

**Ticket:** M3.4 · **Date:** 2026-08-30 · **Commit:** (this one)

**The situation.** `createTask` threw a bare `Error` for anything
`validateTaskAgainstWorkflow` rejected. The web route's catch has
branches for `ArchivedReferenceError`, `ZodError` and
`TaskUpdateError`; a bare `Error` matched none and escaped through the
generic handler.

**Measured at SHA 610ae29**, against a real tracker with a `number`
custom field `points`, value `"not-a-number"`:

    POST /api/tasks   -> HTTP 500
      {"code":"unknown","data_state":"unknown",
       "detail":"invalid task: fields.points: expected finite number,
                 got string"}

    POST /api/tasks/T-1/set (same value, same validator message)
                      -> HTTP 400
      {"code":"validation_failed","field":"fields.points",
       "data_state":"not_saved"}

Two write paths giving two different answers about the same rejected
value. The create side breaks P4 (the cause was in `detail`, which the
client's envelope does not render), ERR-18 (`data_state: "unknown"` was
false — nothing was written), and made NEW-40 unsatisfiable, since the
form can only place a message at a field if `field` is in the envelope.

**What had to be decided.** Whether to add a `catch`-all branch in the
web server that reinterprets bare errors, or to fix the throw in core.

**Options considered.**

- *Pattern-match the message in `handleCreateTask`.* Costs: it puts a
  string-matching rule in one surface for a defect in core, so the CLI
  and MCP keep the untyped throw, and the next surface repeats the
  work. It is also the kind of match that breaks silently when the
  message is reworded.
- *Throw a typed `TaskUpdateError` from `createTask`.* Costs: it
  changes an error type every caller of core sees.

**Decision.** The second. `invalidValueError` — the helper `setField`
has always used — is now exported and called from `createTask` with an
`"invalid task"` prefix, so both write paths share the message rule and
the single-error `field` rule and cannot drift. The web route forwards
`err.field` into the envelope.

The CLI and MCP inherit the improvement: both surface `LocttError`'s
fields, so a rejected create now reports `validation_failed` there too
rather than an untyped crash.

**To revert.** Restore the bare `throw new Error(...)` in
`packages/core/src/task/create.ts` and drop the `field` spread in
`handleCreateTask`. `apps/web/src/server/server.create-validation.test.ts`
goes red immediately, which is the intended alarm.


### A43 · Every picker fetches at `limit=1000`, not the server's default page

**Ticket:** M3.4 · **Date:** 2026-08-30 · **Commit:** (this one)

**The situation.** The sidebar hooks (`useProjects`, `useLabels`,
`useMilestones`, `useSprints`, `useUsers`) sent no `limit`, and
`GET /api/*` paginates at `DEFAULT_PAGE_LIMIT = 100` when none is
given.

**Measured** against a tracker seeded with 150 labels:

    GET /api/labels            -> { total: 150, items: 100 }
    GET /api/labels?limit=1000 -> { total: 150, items: 150 }

The damage is not a short list, it is a wrong one. `LabelsField`
decides whether to offer "Create «name»" by searching the list it was
handed, so `lbl-140` — present on disk, outside the first hundred —
was invisible and the form offered to create a duplicate of it. That
defeats NEW-7's inline-create branch and NEW-25's searchable picker,
and the same reasoning applies to the milestone, sprint, assignee and
reporter pickers.

**What had to be decided.** Whether to paginate the pickers properly
or to raise the request size.

**Options considered.**

- *Build paging/incremental search into every picker.* Costs: five
  components and a server-side search parameter, for a workspace size
  no one has yet. It is the right answer eventually and the wrong one
  to bundle into this ticket.
- *Request `limit=1000` (the server's `MAX_PAGE_LIMIT`).* Costs: a
  workspace with more than a thousand labels is still wrong, and
  silently so.

**Decision.** The second, as `PICKER_PAGE_LIMIT` in `sidebarData.ts`.
These are config lists, not the task table. A workspace past a
thousand of any of them needs a paged picker, which is its own ticket —
noted in `known-gaps.md`.

**To revert.** Drop the `?limit=` from the five query functions.
`sidebarData.test.tsx` goes red on all five.


### A44 · NEW-20's "ask" state is unreachable; a ghost default is a config error

**Ticket:** M3.4 · **Date:** 2026-08-30 · **Commit:** (this one)

**The situation.** NEW-20 sets `projects.yaml#default: ghost` naming no
such project, and requires resolution to "fall through to the
unique-single-project rung, and failing that, to the ask state of
NEW-19".

**Measured:** it cannot. `ProjectsConfigSchema.superRefine`
(`packages/contracts/src/projects.ts`) rejects a `default` that is not
in the projects list *at parse time*, so:

    GET /api/projects -> HTTP 400
      {"code":"config_invalid",
       "message":"projects.yaml is not valid: default default project
                  'ghost' is not in the projects list"}

There is no project list for the modal to fall through *to*. The
workspace is in a config-error state before resolution is reached.

**What had to be decided.** Whether to relax the schema so a ghost
default parses and resolution can degrade, or to treat the config error
as the answer.

**Options considered.**

- *Relax `ProjectsConfigSchema` to warn rather than reject.* Costs: it
  changes config validation for every surface — CLI, MCP and web — to
  satisfy one web case, and it weakens a check that currently catches
  the drift at the boundary, where it is cheapest to explain. That is a
  scope change, not an implementation choice.
- *Treat the 400 as NEW-20's "surfaced somewhere actionable".* Costs:
  the case's first two bullets are not exercised, because the states
  they describe do not exist.

**Decision.** The second. NEW-20's third bullet — "the config drift is
surfaced somewhere actionable" — is satisfied, and strictly better than
the modal quietly degrading: the user is told the file is wrong and
which key is at fault. The first two bullets are recorded as
unsatisfiable in `known-gaps.md` rather than faked with a test
that asserts something else.

**A real defect found while measuring this**, logged separately in
`known-gaps.md`: the message reads "default default project 'ghost'",
doubling the word.

**To revert.** If the schema is later relaxed, `resolveProjectChoice`
already returns `{kind: "ask"}` for an `effective_default` that names
no live project — that path is built and unit-tested
(`projectChoice.test.ts`, "falls through silently…"). Only a browser
test for the ghost case would need adding.


### A45 · NEW-41 is verified against `future`, because `outdated` cannot exist

**Ticket:** M3.4 · **Date:** 2026-08-30 · **Commit:** (this one)

**The situation.** NEW-41 requires the modal not to offer a broken
create "with `.schema-version` behind `CURRENT_SCHEMA_VERSION`".

**Measured:** there is no such state. `CURRENT_SCHEMA_VERSION` is 1,
and `readSchemaVersion` rejects anything below 1 as malformed
(`n < 1` throws `SchemaUnmigratableError`). So:

    .schema-version = 0 -> schema_status.kind = "unknown"
                           (".schema-version must be a positive
                             integer, got: 0")
    .schema-version = 2 -> schema_status.kind = "future"

The `outdated` branch in `packages/core/src/diagnostics/info.ts:137` is
unreachable at this schema version — the repo's own migrate test skips
itself with "can't go below 1" for the same reason.

**What had to be decided.** Whether to leave the case untested or to
verify the reachable equivalent.

**Options considered.**

- *Mark it unsatisfiable and test nothing.* Costs: the behaviour the
  case is really about — a mismatched schema must not offer a create
  that would write under the wrong one — goes unverified, when a
  reachable state exercising the identical guard exists.
- *Verify against `future`.* Costs: the literal word "outdated" is not
  what is tested, so a future schema v2 should revisit this.

**Decision.** The second. Both states go through the same server gate:
every route returns 409 `schema_mismatch`, so the shell never mounts
and the modal cannot open — NEW-41's first branch ("either does not
open"), satisfied structurally rather than by a disabled button. This
is covered by the existing `flow-schema-mismatch.spec.ts`, which
already asserts the app is gated; no create-specific test is added,
because there is no create surface to test in that state.

**To revert.** When `CURRENT_SCHEMA_VERSION` moves past 1, the
`outdated` state becomes reachable and NEW-41 should be re-verified
against it directly.


### A46 · The double-submit guard is a ref, not state and not `disabled`

**Ticket:** M3.4 · **Date:** 2026-08-30 · **Commit:** (this one)

**The situation.** NEW-29 requires two rapid submits to create exactly
one task. The obvious implementations both fail, and both fail
*silently green*.

**Measured**, all three variants, with two clicks dispatched in one
tick from the first press:

    disabled attribute only    -> 2 POSTs, 2 tasks on disk
    `submitting` state check   -> 2 POSTs, 2 tasks on disk
    `inFlight` ref             -> 1 POST,  1 task

`disabled` only appears after React re-renders, which is after the
second click. The state check is worse than it looks: every click
handler closes over its render's value of `submitting`, so two clicks
in the same tick both read `false` and both proceed.

**What had to be decided.** Nothing about the fix once measured — a ref
is the only variant that works. What had to be decided was **how the
test drives it**, because the first version of the test passed with the
guard deleted.

**Options considered.**

- *`click({force: true})` on the disabled button.* Asserts only that
  the attribute is set; the browser swallows the click.
- *Dispatch after a real Playwright click.* That click lets React
  re-render, so later handlers already see `submitting === true` — the
  test passed with the guard removed. Measured.
- *Dispatch both clicks in one tick, from the first press.* Reproduces
  the real race.

**Decision.** The ref, plus the third test shape. The `disabled`
attribute is kept as well — it is the visible pending state NEW-29's
second bullet asks for — but it is not the guard.

**To revert.** Delete `inFlight` and its two assignments in
`CreateTaskModal.tsx`. NEW-29 goes red with "Expected length: 1,
Received length: 2".


### A47 · An archived-reference rejection names the entity, not its ULID

**SUPERSEDED IN PART — see K13.** A47's core finding stands: the
message named a ULID the user never chose, and resolving the name in
core's guard (not the web client) was right, because the CLI and MCP
print the same string. What did **not** stand was the `name (id)`
format: it broke TSK-46, whose test asserts the ULID is absent. The
shipped format is the **name alone**, which satisfies ERR-43 and TSK-46
as written. Ken has ruled (K13) that label-vs-key is not settled
per-site and gets a project-wide audit after M4, across all 35 core
error sites that interpolate a raw id. This site is in that scope.

**Ticket:** M3.4 · **Date:** 2026-08-30 · **Commit:** (this one)

**The situation.** Found by writing NEW-35's test, which requires the
message to name the milestone "by its label". Measured against a real
tracker, archiving a milestone the modal had selected:

    Couldn't create the task: cannot assign archived milestone
    "01M19KQKWHX80KPY0WQ4B2Z067" to milestone; unarchive it first

A ULID is not something the user chose, typed, or can recognise — they
picked "v1.0 launch" from a picker. The message names the right thing
in the wrong vocabulary, which is a P4 failure (a message must name its
cause in terms the user can act on), and it made NEW-35's first bullet
unsatisfiable on every surface at once: the same string is what the CLI
and MCP print.

**What had to be decided.** Whether to resolve the name in the web
client (which has the milestone list already) or in core's guard.

**Options considered.**

- *Resolve it client-side, in the modal.* Costs: the CLI and MCP keep
  printing the ULID, so the same rejection reads differently depending
  on where you hit it — and the surface that has the *least* context
  about the config would be the only one that explains itself. It also
  means parsing an id back out of a message string, which breaks the
  moment the wording changes.
- *Resolve it in `assertNotArchivedReferences`.* Costs: it changes an
  error string every surface and three existing tests depend on.

**Decision.** The second. `displayNameFor` resolves id → `"name (id)"`
from the config slices the guard already loads, so all three surfaces
improve together. **The id is kept alongside the name**, deliberately:
identity is the ULID (P-2), and a user grepping `task.md` or
`milestones.yaml` needs the id the message is actually about. Two
milestones may also share a name.

**Three green tests were asserting the old message** — each pinned
`archived <kind> "<bare id>"` — and were updated to require both halves.
Flagged here per CLAUDE.md: they were encoding the defect, not
protecting behaviour.

**To revert.** Make `displayNameFor` return `id` unchanged. The three
`archived-guard.test.ts` assertions go red immediately, which is the
intended alarm.


### K8 · A board column is a group of tickets, and reordering inside one works across statuses

**Date:** 2026-08-30 · **Ken's ruling — an agent may not revert this.**

**The situation.** `reorderBoardRank` sets `const column =
moved.frontmatter.status` (`reorder.ts:212`) and drops every task whose
status differs. The variable is named `column` and holds a *status*.
When a column was one status those meant the same thing;
`workflow.boards` made them different, and this line was never updated.

So dragging a `blocked` card above an `in_progress` card in the same
column is refused: core looks for the anchor among cards sharing the
dragged card's status, does not find it, and declines. The optimistic
UI has already moved the card, so **the user sees the card move and the
write never lands** — the board silently discards the action.

**Ken's model, stated in his own words:** "if each column = a status, i
want people to be able to drag cards across columns to update their
status. then i want to allow re-ordering within the column (even across
status) ... its just a group of tickets, no?" And on being shown the
mechanism: "that sounds like a bug we need to fix then."

**Ruling: it is a bug and it gets fixed.** A column is a group of
tickets. Reordering within a column ranks against every card in that
column regardless of status.

**How — Ken corrected my framing twice, and both corrections matter.**

*First correction.* I proposed *widening* the status filter (pass a status
set, or have core read `workflow.boards`). Ken: "im telling you to think
outside, that we may need to refactor: the multi-label column needs to
allow tickets to be in any order, even interleaving different statuses."

*Second correction — I then overshot.* I concluded the ordering must be
**global**, with a column as a filter over it. Ken: "uh, i was thinking a
column is its own sequence. new tickets added just gets put at the bottom
of the column. i dont think we need a global ordering."

He is right, and a global ordering breaks the case he names.
`computeNewRank`'s `{kind: "end"}` returns `between(last, MAX)` where
`last` is the greatest rank **in the peer set**
(`reorder.ts:352-355`). Under one global sequence, "the bottom of my
column" and "the bottom of the tracker" collapse to the same position, so
a new ticket lands after every task in every column. A per-column
sequence is what actually gives "new tickets go to the bottom of their
column".

**The model: each column is its own sequence.**

- A column has its own ordering; ranks are only ever compared within one.
- Inside a column, cards of different statuses interleave freely — the
  ordering knows nothing about status. That is the first correction.
- "End of the column" means the end of *that column's* sequence, not of
  everything. That is the second.

**What this means for `reorder.ts`.** The status filter at
`reorder.ts:213-218` is still wrong and still goes — it scopes by
`status`, which is not the column. But it is replaced by a filter on
**the column**, not deleted outright: `peers` must be the cards of the
column being reordered, which is what both `{kind: "end"}` and the
rebalance need.

**Ken: do it the clean way — no local duplicate.** "we havent published
yet, nobody is using this model yet." So this is not a
backwards-compatible parameter bolted onto a shipped API; it is a
correction to a model that no user depends on.

**Two implementations of rank interpolation exist today, and one goes.**
`handleBoardMove` (`server.ts:2307`) computes the rank *itself*, in the
server, with its own comment explaining why: "`reorderBoardRank` derives
a card's peers from the status the task *currently* has — correct for an
intra-column reorder, wrong for this one." The M3.2 agent hit exactly the
wall this ruling is about and routed around it rather than fixing core.

That left the board with two paths — cross-column drops computing rank in
the server, intra-column reorders calling core — and two implementations
of "interpolate between two ranks" that will drift: one gets a rebalance
or boundary fix the other does not. Ken's ruling is to consolidate: fix
core, then **delete** the server's local computation and route both paths
through `reorderBoardRank`. A net simplification, reachable only because
core is being fixed rather than worked around a second time.

**Where the column grouping comes from.** `deriveColumns`
(`apps/web/src/client/board/columns.ts:70`) takes a `WorkflowConfig` and
tasks and returns the columns. Measured: it imports **only types** from
`@loctt/contracts` and touches no React, `window` or `document`. It is
pure logic that happens to live in the client because that is where it
was first needed — not a presentation concern.

So it moves to core rather than becoming a parameter the caller must
thread through. `reorderBoardRank` derives the moved task's column the
same way the board renders it, and every surface — web, CLI, MCP — agrees
on what a column is without any of them passing extra arguments. This
also answers the objection recorded earlier against core reading
`workflow.boards`: the concern was presentation config reaching a write
path, but column grouping is not presentation, and a CLI user reordering
a card *should* get the same column semantics the board shows.

**Consequence.** SPR-C2's premise comment ("A board column is a status")
is false and its two tests assert the narrow rule. Per CLAUDE.md, a fix
that requires editing a green test means that test was asserting the
bug — to be said plainly in the commit message.

**The SPR-C2 defect stays fixed, by a better mechanism.** Its real
symptom was a rank interpolated against cards *not adjacent on screen*,
so the card did not land where the user dropped it. Ranking between the
caller's two anchors fixes that directly, and more precisely than a
status filter ever did. The filter was never what made it correct.

**Amended after an independent (Fable) review, before any build.** The
review is at `.claude/k8-model-review.md`. It confirmed the model — each
column its own sequence, columns derived in core — and found three things
wrong with the *mechanism* I specified. All three verified independently:

1. **"Route both paths through `reorderBoardRank`" cannot be executed as
   written.** That function throws when given `before` *and* `after`
   (`reorder.ts:198-200`), but `handleBoardMove` deliberately passes both
   — BRD-32 requires the two neighbours the user actually saw at release
   — and interpolates between them as bounds (`server.ts:2377-2388`).
   It also writes only `board_rank`, so routing a cross-column drop
   through it would lose the atomic status+rank write BRD-41 and XS-9
   mandate.

   **The consolidation target is therefore a new core operation**, not
   the existing one: a `boardMove` that takes an optional destination
   status, accepts both anchors, validates them against the *destination*
   column, and writes atomically through the `setFields` mechanism. A
   mechanism change, not a model change — the duplication still goes.

2. **Duplicate ranks become normal, and the write path crashes on them.**
   Every column's first card gets `INITIAL = "u"` (`lexorank.ts:33`), so
   under per-column sequences two columns' first cards share a rank.
   `between("u","u")` throws a **plain `Error`** (`lexorank.ts:75-78`),
   not a `ReorderError` — and the server's catch tests
   `instanceof ReorderError` (`server.ts:2411`), so it escapes as a 500.
   Rendering already tolerates duplicates (BRD-29's tiebreak chain); the
   write path must too. **This would fire in ordinary use**, not at an
   edge.

3. **The SPR-C2 tests will probably stay green, which is a trap.** Their
   fixture has no `boards` block, so the 1:1 fallback still refuses
   cross-status anchors and the tests pass unchanged. The actual
   behaviour change — cross-status anchors accepted *inside one
   configured column* — has no core test today. One must be written and
   **shown to fail** before the fix, or the change ships unverified.

Also: a task with **no status** belongs to no column under
`deriveColumns`, yet core's rebalance tests rank exactly such tasks. The
build must define a pseudo-column for them or those tests break. And
`columns.ts`'s header comment records an explicit rationale *against*
living in core — it must be rewritten in the same commit, not left
contradicting the code.

**Unblocks** BRD-12, currently `test.fixme` in `flow-board.spec.ts`.

### K9 · A card's status is always visible in a multi-status column

**Date:** 2026-08-30 · **Ken's ruling — an agent may not revert this.**

**Ruling: "always show status in the card."** Where a board column
collapses several statuses, the card's status is shown regardless of
whether `card_layout` lists it. A column that mixes statuses is
otherwise an undifferentiated pile, and reordering across statuses is
guesswork without it.

Scope: this overrides `card_layout` only for columns that actually
collapse more than one status. A single-status column honours
`card_layout` as configured, since the column header already states the
status.

**Note.** BRD-13 is unaffected and already built: a card dropped into a
multi-status column adopts the column's **first** listed status,
deterministically — the user controls the default by ordering the
`statuses` array.

### K10 · The body-write precondition is available everywhere, opt-in on the CLI, token-passing on MCP

**Date:** 2026-08-30 · **Ken's ruling — an agent may not revert this.**
**Supersedes an earlier draft of K10 that made the guard safe-by-default.**

**The situation.** K2 ruled the body-write precondition ships with the
editor, because autosave without one "silently overwrites a concurrent
CLI or MCP edit every 1.5 idle seconds, unattended". It was built
**web-only**: `bodyToken` / `expectedToken` appear in
`apps/web/src/server/server.ts` and in neither `apps/cli/src` nor
`apps/mcp/src` (grep, with positive control). Core's docstring: "Omit
for last-write-wins, which is what every existing caller gets." The M2
gate raised this as a blocker, correctly.

**How the ruling was reached, including my error.** Ken first ruled
safe-by-default with a `--force` escape hatch. He then proposed two
modes with the unsafe one as the default. I put the reversal back to him
rather than silently recording it, with my objection stated: the people
who would think to pass a `--safe` flag are the ones already being
careful, and the asymmetry favours the safe default (a wrong refusal
costs seconds; a wrong overwrite costs body text, silently, often
noticed much later).

Ken's answer refined the design rather than simply picking (b):
**"unsafe default, can configure, and agents via mcp and existing
scripts should pass it if its provided in params."**

That is not "MCP is unsafe too". It splits the two surfaces:

- **CLI: last-write-wins by default**, configurable. Existing scripts and
  existing habits are unchanged; a user who wants the check turns it on.
- **MCP: the write tools take the token as a parameter**, and an agent
  that holds one passes it. An MCP agent typically reads a task before
  writing it, so it has the token in hand and passing it costs nothing.

This addresses my objection at its actual root. The failure I was
worried about — an agent silently clobbering a human's edit — is handled
by *the agent having the token*, not by a global default that punishes
solo CLI use.

**Implementation consequence, measured.** `bodyToken`
(`packages/core/src/task/io.ts:161`) is `sha256(updated_at + "\0" + body)`
truncated to 16 hex chars. **An agent cannot construct it from an ordinary
read** — the MCP read path must return it explicitly, or the write tools
must accept `updated_at` and derive it server-side. Whichever is chosen,
the token has to become reachable through MCP; today it is not exported
to any tool.

**What is still true from the earlier draft.** `--force` is not a new
convention (`sprint.ts:34`, `task-files.ts:20`, and MCP's
`force: z.boolean()`), so whichever direction the flag runs, the
vocabulary already exists.

**The accepted cost, stated plainly.** With last-write-wins as the CLI
default, a `loctt body --set` that races a browser autosave still
destroys the browser's edit silently. Ken has this in front of him: the
protection exists, and it is on for the surface most likely to race a
human (MCP agents), off for the surface least likely to (a person at
their own terminal).

**Unblocks** the M2 section gate's second blocker.

### K11 · `boardMove` gets CLI and MCP surfaces inside M3

**Date:** 2026-08-30 · **Ken's ruling.**

K8 added `boardMove` to core with only the web calling it — the
`unarchiveView` pattern CLAUDE.md names, and the eighth built-but-uncalled
capability found in this run.

**Ruling: build the surfaces into M3's remaining work**, not as a
follow-up after M4. M3 closes with no drift.

A CLI user moving a card between columns today needs two separate
writes, which is precisely the non-atomicity `boardMove` exists to fix —
so the surfaces are a real capability, not bookkeeping.

### K12 · MSL-20's `+N` reveal is built

**Date:** 2026-08-30 · **Ken's ruling.**

**Why two agents declined it, for the record:** not difficulty. MSL-20's
second bullet wants the `+N` affordance to reveal the remaining labels
"on click/hover and each remains individually clickable to filter".
Today it is a `<span>` with a `title`. Closing that needs a **popover
component that exists nowhere in the app** — focus management,
click-outside dismissal, escape handling, viewport-edge positioning, a11y
semantics — shared by the list row and the board card. Both agents
correctly read that as inventing scope, one of the four conditions that
stop the run, and both flagged rather than built.

**Ruling: build it.** Ken asked for it explicitly.

Scope note: MSL-20's other bullets already pass — pills wrap, trailing
columns stay on screen, row height is bounded. The reveal is the single
unmet bullet, and MSL-20 is `major`, not `blocker`. The component is
shared surface: one hover-card used by both the list row and the board
card, not two implementations.

### K13 · Error-message vocabulary gets its own audit, across all functionality

**Date:** 2026-08-31 · **Ken's ruling.**

**How this came up.** M3.4 fixed an archived-reference error that named a
ULID the user never chose:

    cannot assign archived milestone "01M19KQKWHX80KPY0WQ4B2Z067" to milestone

It became `"v1.0 launch (01M19KQK…)"` — name **and** id — recorded as
A47, arguing the id keeps the message "actionable against the file,
where identity is the ULID (P-2)". That broke TSK-46, whose test asserts
`not.toContainText(userId)`.

Three sources disagree:

- **ERR-43**: the message shows "the configured **label** … not the
  stored key".
- **TSK-46's test**: `not.toContainText(userId)` — no id at all.
- **A47**: name *and* id, so the user can find the thing on disk.

**Ken's position:** "feels like error messages could be more helpful
with keys rather than just labels" — a lean toward A47's reasoning, but
**not a ruling on this site**. He asked instead for an audit, and then
clarified: "by audit i mean, across all the functionality, not just this
one."

**Ruling: a dedicated audit ticket, project-wide, after M4.** Not folded
into M3.4 — it spans CLI, MCP and web equally and is not a web-UI
concern.

**Scope, measured before writing this:**

- **317** `throw new` sites in `packages/core/src` (excluding tests).
- **35** of them interpolate a raw id into an error/message string.
- **15** UI tests assert `not.toContainText(...)` on something
  id-shaped; exactly **one** (TSK-46) pins a ULID specifically.

The audit must decide one rule and apply it everywhere, rather than
per-site: when does a message carry a label, an id, or both — and in
what order. It should also reconcile ERR-43's wording with whatever is
chosen, since the case as written forbids the key outright.

**Interim state for M3.4** (revisit in the audit, not before): recorded
separately below.

### A48 · `sprints.yaml` parsing stays all-or-nothing, and the page says so

**Ticket:** M3.5 · **Date:** 2026-08-31

**Recorded twice, deduplicated.** I committed this ruling to `main`,
then told the M3.5 agent to "read A48 before building" — but its
worktree was pinned at an earlier SHA, so A48 genuinely was not in the
tree it could see. It flagged that rather than pretending to read it,
and wrote its own A48 from the reasoning in my message. Both versions
reached the same conclusion by the same argument; the duplicate was
removed and this one kept. Telling an agent to read a decision that is
not in its tree is how invented content enters a record.

**The situation.** SPR-31's third bullet: "Other, valid sprints still
render **if the loader can partially recover**; if it cannot, the page
says the whole file failed to parse rather than showing an empty state
that reads as 'no sprints'." The ticket required this be decided
explicitly: either add a lenient parse, or state that it cannot recover
and always show the whole-file error — **not left implied.**

**What had to be decided.** Whether `parseSprintsConfig` gains a lenient
mode.

**Options considered.**

1. **Lenient parse — drop invalid entries, render the rest.** Rejected.
   `SprintsConfigSchema` validates the file as a unit, with a
   `superRefine` enforcing id uniqueness *across* entries
   (`sprints.ts:48`), so "the valid ones" is not a well-defined subset —
   uniqueness is a property of the whole. Worse, a silently dropped
   sprint leaves every task whose `sprint` field names it dangling into
   SPR-27's "unknown sprint" path, converting one legible file error into
   N scattered ones. That trades a clear failure for a confusing one.
2. **All-or-nothing, with an honest message.** Chosen. The parse keeps
   throwing for the whole file; the view says the file failed to parse,
   names the file, the offending sprint and the broken rule.

**Why.** SPR-31's bullet is conditional, not a mandate — it permits
all-or-nothing provided the page is honest about it. P7 forbids the
silent pruning that option 1 requires.

**To revert.** Add a lenient branch to `parseSprintsConfig` returning
`{ sprints, errors }`, and have the sprints view render both. The case
allows it; nothing else depends on the strictness.

**Note.** This is only reachable once `handleListSprints` catches
`SprintsConfigError` at all — today it calls `loadSprintsConfig` bare
(`server.ts:1476`), so the ZodError's text never reaches the client and
SPR-31 and SPR-32 receive byte-identical 500s.

---

### A49 · SPR-36's drop guard already exists in core; the client half is all that is new

**Ticket:** M3.5 · **Date:** 2026-08-31 · **Commit:** (this one)

**The situation.** The SPR-36 ticket stated it "needs an existence
check on the drop write", reasoning that the archived-reference guard
covers archived entities and not deleted ones, so a
write naming a deleted sprint id "likely succeeds silently today". It
asked that this be verified before building. It was a guess, flagged
as one.

**The measurement.** Against a real scratch tracker, CLI binary built
from this worktree:
- Positive control — assign an existing sprint: exit 0,
  `Set sprint = 01M1AQ6K...`, and `loctt show T-1` reports `Sprint: S1`.
- Delete the sprint (`sprints: []` in `sprints.yaml`), then assign that
  now-dangling id to a *different* task: **exit 1**,
  `Error: unknown sprint: 01M1AQ6K96WRM6WNESPCN4WQEP`, and no `sprint`
  key on that task's `task.md`.

**The finding.** The guess was wrong. The guard is not the archived-
reference guard at all — it is `resolveSprintIdFromInput`
(`packages/core/src/sprints/manage.ts:86-103`), reached from
`setField`'s reference resolution (`task/update.ts:371-374`), which
throws `SprintError("unknown sprint: …")` when the id matches neither
an id nor a name. The web PATCH path routes through the same
`setFields`, and `SprintError extends LocttError`, so it surfaces as a
400 carrying the message.

**The decision.** No core or server existence check is added for
SPR-36. Only the client half is built: rejecting the drop, returning
the card, and phrasing the error as "no longer exists — refresh".

**To revert.** Nothing to revert in core. If a future change makes
sprint resolution lenient, SPR-36 regresses silently — its spec test
is the guard, and it asserts the rejection end-to-end rather than
trusting this note.

---

### A50 · `handleListSprints` needs no catch: the dispatcher already attributes `SprintsConfigError`

**Ticket:** M3.5 · **Date:** 2026-08-31 · **Commit:** (this one)

**The situation.** The M3.5 ticket (flagged as server work, not
frontend-only) stated that `handleListSprints` does not catch
`SprintsConfigError`, so a malformed `sprints.yaml` "currently
returns a generic 500 with `code: io_failed` + retry — the exact shape
SPR-32 reserves for a *failed fetch*, making the two
indistinguishable". The run coordinator independently confirmed the
missing try/catch and directed that the caught, named response be
built. It was built, and then measured.

**The measurement.** The bare-handler claim is true; the *consequence*
is not. Against the pristine handler at 688d5d7, with no fix applied,
`GET /api/sprints` over a backwards-dated sprint returns:

    status=400
    {"code":"config_invalid",
     "message":"sprints.yaml is not valid: sprints[0].end_date end_date
                (2026-01-01) must not be before start_date (2026-02-01)",
     "data_state":"not_saved","recovery":{"kind":"command"}}

Not a 500, not `io_failed`, not `retry`. The file, the offending
sprint (`sprints[0]`) and the broken rule are all present — SPR-31's
three requirements, met by code that already shipped.

**Why the guess was wrong.** The catch is real but redundant. The
request dispatcher (`server.ts:4000`) already maps any uncaught
`LocttError` through `err.toEnvelope()` + `statusForCode(err.code)`.
`SprintsConfigError` sets `config_invalid` with
`recovery: { kind: "command" }` in its own constructor
(`config/sprints.ts:16-28`), and `statusForCode` sends
`config_invalid` to the 400 default — never the 500 branch. A
per-route catch re-derives what core already states, which is exactly
the V1/V8 duplication the dispatcher comment warns against.

**How it was caught.** The added test passed with the fix *disabled*
(`if (false as boolean && ...)`, typecheck exit 0). Under the repo's
rule that a test which stays green with its behaviour removed asserts
nothing, that green was the signal — the behaviour was upstream, not
absent. Had the mutation step been skipped, a redundant catch would
have shipped as a fix for a bug that did not exist.

**The decision.** No server change. `handleListSprints` stays as it is.
The two SPR-31/SPR-32 tests are kept: they are now **regression
guards** on the dispatcher's attribution, not on a new catch, and they
pin the distinction SPR-32 needs.

**To revert.** Nothing to revert. If a future change makes the
dispatcher flatten `LocttError` to `unknown`/500, or drops
`config_invalid` from `statusForCode`'s 400 default, these tests go
red and a per-route catch becomes the right fix at that point.

**Supersedes.** A48's premise is unaffected (the all-or-nothing parse
still stands), but its framing assumed a server fix would accompany
it. It does not.

---

### A51 · `useBoardDrag` is generalized in place, not forked for `/sprints`

**Ticket:** M3.5 · **Date:** 2026-08-31

**The situation.** The ticket reported a previous agent's *impression*
— explicitly flagged as untested — that the board's drag primitives
were reusable for sprint columns, and asked that it be verified rather
than assumed.

**The measurement.** Read end to end. `useBoardDrag` is column-agnostic
in everything that matters: the 5px threshold, the mid-drag snapshot
(BRD-32), `elementFromPoint` → `[data-column-id]` resolution, the
`Esc` cancel, the vanished-column cancel (BRD-36) and `isNoOpDrop` all
work from a column `id` and the bucket map. Exactly **two** things were
status-specific: the `columns: readonly BoardColumn[]` parameter type,
and one call to `statusForColumn(targetColumn)` on a cross-column drop.

**What had to be decided.** Fork the hook, or widen it.

**Options considered.**

1. **A second `useSprintDrag`.** Rejected. It would duplicate ~200
   lines whose comments record two geometry bugs that were measured
   and fixed once; the copy would not carry the fixes forward, and the
   next change to either would drift.
2. **Widen the hook.** Chosen. A `DraggableColumn` interface (`{ id }`)
   as the generic bound, and a `fieldForColumn` callback for the one
   status-specific line, defaulting to the board's existing rule so
   `BoardView` is byte-for-byte unchanged in behaviour.

**Why.** The guidance is against a *divergent* second implementation.
One parameter is a smaller change than a fork, and `BoardColumn`
structurally satisfies `DraggableColumn`, so the board needed no edit
at all — its 30 existing tests pass untouched.

**To revert.** Delete `fieldForColumn` and `DraggableColumn`, restore
the `BoardColumn` parameter type and the direct `statusForColumn` call.
`/sprints` would then need its own hook.

---

### A52 · The sprint drop writes through `useSetField`, not `boardMove`

**Ticket:** M3.5 · **Date:** 2026-08-31

**The situation.** The board's drop is one atomic `boardMove` writing
`status` + `board_rank`. The obvious symmetry would route a sprint
drop through the same op.

**What had to be decided.** Which write verb a sprint reassignment uses.

**Options considered.**

1. **Extend `boardMove` to take a sprint.** Rejected. `board_rank` is
   ranked *within a board column*, and a sprint column is not one — so
   this would rewrite `board_rank` as a side effect of a sprint change,
   silently reordering the board a user was not looking at. It would
   also mean a second grant in `BOARD_MOVE_GRANT`.
2. **`useSetField` with `field: "sprint"`.** Chosen. One field, the
   same verb the meta panel uses, which brings the optimistic rollback
   SPR-5 needs and routes through `setFields` — and therefore through
   `resolveSprintIdFromInput`, which is the guard A49 measured as
   already satisfying SPR-36's server half.

**Why.** `/sprints` has no ordering of its own. SPR-4 asks for the
`sprint` field to be written and says nothing about rank; writing one
anyway is scope the case does not carry.

**Consequence, recorded honestly.** An intra-column drop on `/sprints`
issues no write and reorders nothing — there is no per-sprint sequence
to reorder into. SPR-4's last bullet only requires that a drop back
where it started writes nothing, which holds.

**To revert.** Replace the `SprintWriter` component with a `boardMove`
call carrying a sprint id, and add `sprint` to the auto-managed grant.

---

### A53 · SPR-17 is a bounded render window, not a measuring virtualizer

**Ticket:** M3.5 · **Date:** 2026-08-31

**The situation.** SPR-17 asks that a 400-task column "virtualize or
paginate" while the header still reads the true total.

**What had to be decided.** Which of the two the case allows.

**Options considered.**

1. **A measuring virtualizer** (absolute positioning off a scroll
   offset). Rejected. The drag resolves its drop slot from
   `elementFromPoint` and each card's real `getBoundingClientRect`, and
   SPR-4's drop must land between the neighbours the user *saw*. Cards
   lifted into a transformed container make that geometry disagree with
   the screen — the exact bug class `BoardView`'s own comments record
   being measured and fixed twice.
2. **A bounded window with an explicit "show more".** Chosen. The
   column renders 50 cards in ordinary flow and names how many are
   hidden.

**Why.** The case says "virtualizes **or** paginates" — this is the
second, and it keeps the drag geometry honest. The header count comes
from the bucket, not from what is rendered, so 400 reads 400.

**Consequence, recorded honestly.** A card beyond the window is not a
drop neighbour until revealed. It is not on screen, so this is the
bargain any windowing makes.

**To revert.** Replace `VirtualCards` with a virtualizer and re-verify
every SPR-4 / SPR-24 drop case against it.

---

### A54 · The `+N` reveal is a portalled fixed-position popover

**Ticket:** M3.5 (K12) · **Date:** 2026-08-31

**The situation.** K12 authorises MSL-20's reveal. The app already has
`Menu`, a popover with outside-click and Escape handling.

**The measurement.** `Menu` positions its panel with CSS
(`absolute`, anchored to the trigger's wrapper). Both of MSL-20's call
sites clip: the list table is inside
`overflow-x-auto overflow-y-hidden` (`ListView.tsx:467`) and a board
column inside `overflow-y-auto`. An absolutely-positioned panel is cut
off by whichever ancestor scrolls. No `createPortal` existed anywhere
in the client (`grep createPortal apps/web/src/client` → 0 hits).

**The decision.** `LabelOverflow` renders its panel through
`createPortal` to `document.body` with `position: fixed`, placed from
the trigger's measured rect in a `useLayoutEffect` so it can flip at
the viewport edges. `Menu` is left alone.

**Why not widen `Menu`.** It is used by the header menu and the filter
and bulk dropdowns, none of which clip. Changing its positioning model
would re-open three working surfaces to satisfy a fourth.

**Consequence.** A fixed panel does not follow its trigger when an
ancestor scrolls, so it closes on scroll and resize rather than
drifting away from the pill it belongs to.

**One component, both surfaces.** K12 requires it, and it was already
true: `LabelsCell` is imported by both `ListView` and `BoardCard`. The
pill was extracted to `LabelPill` so the revealed labels are the *same*
control as the visible ones rather than a lookalike.

**To revert.** Replace `LabelOverflow` with the previous
`<span title={…}>+N</span>` and delete `LabelPill`, inlining it back.
MSL-20's second bullet then fails again.

---

### A55 · The query language has no "field is unset" operator, so SPR-6 asserts the negation

**Ticket:** M3.5 · **Date:** 2026-08-31

**The situation.** SPR-6's third bullet: a task whose sprint was
cleared "subsequently matches `sprint` being unset in the query
language, consistently with what the CLI reports".

**The measurement.** Against a scratch tracker with the CLI built from
this worktree, one task assigned and one not:

    sprint = null    → No tasks found.   (matches nothing, not an error)
    sprint is null   → Error: expected operator but got "is"
    sprint = empty   → No tasks found.
    sprint is empty  → Error: expected operator but got "is"

Positive control, same tracker, same session:

    sprint = "<ULID>"  → T-1        (the assigned task)
    sprint != "<ULID>" → T-2        (the unassigned one)

`grep -n -i "null\|unset\|absent" docs/user/common/query-language.md`
returns nothing relevant. The sprint filter also takes the **ULID**,
quoted — a bare ULID is a parse error, and the sprint *name* matches
nothing.

**The decision.** SPR-6's spec asserts the negation
(`sprint != "<id>"` matches the cleared task, `sprint = "<id>"` does
not), which is what the CLI actually offers. No query-language change
is made — adding an `is null` operator is a language change well
outside a view ticket.

**Why this still satisfies the bullet.** The bullet's substance is
that the cleared task is *findable* and that the browser and the CLI
agree. Both hold. What does not exist is a dedicated operator.

**To revert.** If an `is null` / `is unset` operator is added to the
query language, tighten the SPR-6 spec to use it directly.

**Logged as a gap.** See `known-gaps.md` — the absence is a real
usability hole beyond this ticket.

### A56 · MCP gets the body token by having `get_task` return it, not by deriving it from `updated_at`

**Ticket:** K10 · **Date:** 2026-08-31 · **Commit:** (uncommitted)

**The situation.** K10 requires MCP's write tools to "take the token as
a parameter", and states the implementation consequence measured: the
token is `sha256(updated_at + "\0" + body)` truncated to 16 hex chars
(`packages/core/src/task/io.ts:161-171`), so **an agent cannot construct
it from an ordinary read**. K10 names two ways to make it reachable and
leaves the choice open.

**What had to be decided.** Does the token reach an MCP agent as an
explicit field on the read path, or do the write tools accept
`updated_at` and derive the token server-side?

**Options considered.**

(a) `get_task` returns `body_token` alongside the body; the write tools
take `expected_token`. Costs: adds a field to a published read schema,
and the agent must carry two values instead of reusing one it already
has.

(b) The write tools accept `updated_at`; the server re-reads the body
and derives the token. Costs: couples the tool schema to a frontmatter
field, **and — decisive — it is a weaker guard wearing the same name.**
`updated_at` is only half the hash. Deriving server-side means hashing
the caller's `updated_at` against *whatever body is on disk now*, so the
check passes whenever `updated_at` matches regardless of what body the
agent actually read. Core's docstring says the token deliberately covers
both, because "a token that survived an unrelated frontmatter change
could let a body write through that was composed against different
metadata"; (b) inverts exactly that property.

**Decided.** (a) — `get_task` returns `body_token` when the body is
included; `replace_task_body` and `append_task_body` take an optional
`expected_token`.

**Why.** (b) does not implement the guard K2 and K10 asked for, it
implements a laxer one that would report success in a case the real
token refuses. Beyond that, (a) mirrors the web exactly — the web's task
detail response already carries `bodyToken`
(`apps/web/src/server/server.ts:2935`) and its body write already takes
`expectedToken` — so all three surfaces now name the same concept the
same way, which is the drift CLAUDE.md's "core is not done until CLI and
MCP have it" rule exists to prevent. The added field is additive and
sits behind `include_body`, so a caller that does not want it does not
pay for it.

**To revert.** Drop `result["body_token"]` and the `bodyToken` import
from `apps/mcp/src/tools/task-crud.ts`, drop `expected_token` and
`tokenOpts` from `apps/mcp/src/tools/task-body.ts`, and delete
`tests/integration/mcp/body-token.test.ts`. The `get_task` and
body-tool sections of `docs/user/mcp/reference.md` revert with them.

### A57 · The CLI hands out a token via `loctt body --token`, not via `show`

**Ticket:** K10 · **Date:** 2026-08-31 · **Commit:** (uncommitted)

**The situation.** K10 makes the CLI's precondition opt-in. A user who
opts in needs some way to obtain a token, and — as with MCP — cannot
compute one. K10 leaves the mechanism open.

**What had to be decided.** Where does a CLI user get a body token?

**Options considered.**

(a) `loctt body <task> --token` prints the token alone. Costs: one more
flag on `body`, and a mutual exclusion to enforce against `--set` /
`--append`.

(b) `loctt show <task>` prints it as another field. Costs: taxes every
reader of `show` — the most-used command — with a 16-hex string that
almost none of them will ever use, to serve an opt-in feature.

(c) A separate `loctt body-token <task>` command. Costs: a new top-level
command for one line of output, in a CLI that already groups body
operations under `body`.

**Decided.** (a), printing the bare token with no label so
`--expect "$(loctt body T-1 --token)"` substitutes directly.

**Why.** `show` is a human-readable display and a token is machine
input; putting one in the other makes the common path worse to serve the
rare one. Keeping the read next to the write it feeds means the two
cannot drift apart, matching the reason `appendTaskBody` is already
described in core as a single source of truth for its own surface pair.
The bare-token output is the load-bearing half — a label would break the
substitution, and it is pinned by a test.

**To revert.** Remove `--token` from `TASK_BODY_FLAGS` and the
`wantToken` branch in `apps/cli/src/commands/task-crud.ts`, and drop the
token helper in `tests/integration/cli/body-token.test.ts`.

### A58 · The CLI's opt-in is a `cli:` block in `workflow.yaml`

**Ticket:** K10 · **Date:** 2026-08-31 · **Commit:** (uncommitted)

**The situation.** K10 says the CLI default is last-write-wins and Ken
added "can configure", so the flag needs a workspace-level counterpart.
There is no general workspace-settings store: `users/settings.ts` is
per-user and gitignored, which is the wrong scope for a rule meant to
apply to everyone in a tracker.

**What had to be decided.** Where does `require_body_token` live, and
what is it called?

**Options considered.**

(a) A new `cli:` block in `workflow.yaml`. Costs: extends a `.strict()`
schema shared by all three surfaces for a setting only one of them
reads.

(b) A new top-level config file (e.g. `cli.yaml`). Costs: a whole file,
loader, and error path for one boolean.

(c) A per-user setting in `users/<id>/settings.yaml`. Costs: gitignored
and per-checkout, so it cannot express "this tracker requires the
check", which is the thing worth configuring.

**Decided.** (a), named `cli` rather than something surface-neutral, with
`require_body_token: boolean` as its only field.

**Why.** `workflow.yaml` is already the workspace-level, checked-in,
hand-editable config the CLI loads, so (a) adds a field where (b) adds a
subsystem. Naming it `cli` is the honest name and not an accident: after
K10 only the CLI *has* a default to configure — the web always sends a
token and MCP enforces one whenever the agent supplies it — so a
neutral name like `body_writes:` would imply a workspace-wide policy
that does not exist. A refusal under this setting is a `UsageError`
(exit 2), not a stale-token failure, because nothing was compared: the
user simply did not supply what the tracker requires, and the message
names the setting so it is findable.

**To revert.** Remove `CliConfigSchema` and the `cli` field from
`packages/contracts/src/workflow.ts`, its two export lines in
`packages/contracts/src/index.ts`, the `require_body_token` branch in
`apps/cli/src/commands/task-crud.ts`, the `cli` rows in
`docs/dev/schema-reference.md`, and the config paragraph in
`docs/user/cli/reference.md`.

### A59 · No write leaves while the body-conflict dialog is open

**Ticket:** known-gaps, "A resolved body conflict can re-open its own
dialog" · **Date:** 2026-09-01 · **Commit:** (uncommitted)

**The situation.** Clicking a choice radio in the conflict dialog blurs
the editor, and both editor modes flush on blur. That flush carries the
token the server has already refused, so it 409s in every run; when that
409's response landed after Apply, `write()`'s catch re-opened the
dialog over a conflict the user had just resolved. Measured at 4 in 10
runs once XS-11's spec asserted dialog closure directly. No data was
lost — the merge write succeeded — but the stale dialog nothing would
close is a P4 violation in the one surface built to protect P1.

**What had to be decided.** Which layer stops the stale 409 from
re-opening a resolved conflict, on the state machine K2 and K10 govern.

**Options considered.**

(a) Suppress every non-resolving flush while a conflict is open, inside
the hook. Costs: keystrokes typed just before the blur stay unflushed
until the conflict is closed — but they were unflushable anyway (any
flush would 409 against the same stale token), so nothing that was
being saved stops being saved.

(b) A generation counter: ignore a 409 whose request predates the last
resolve. Costs: the doomed write still fires every run (guaranteed-409
network noise), more state-machine surface, and it cannot fix the
success-path hole below.

(c) `resolve()` awaits in-flight writes before clearing the conflict.
Costs: the dialog close lags the network, the doomed write still fires,
and it reorders the race rather than removing it.

**Decided.** (a) — `flush()` returns without writing while
`conflictRef` (a synchronous mirror of the conflict state) is non-null;
`resolve()` clears the mirror before it flushes, so the resolution
write is the one write that passes.

**Why.** XS-12's first bullet already states the invariant: while the
conflict surface is up, "The UI does not write." The blur-flush was a
case violation before it was a race trigger. And it was not always
harmless noise: the refetch effect adopts a fresh `loadedToken` even
while the buffer is dirty, so a same-task refetch during an open
conflict could have let the blur-flush *succeed* — silently overwriting
`theirs` while the dialog was still asking which side to keep, exactly
what P1 forbids. (a) closes both with one guard and no new state
machine; (b) and (c) each close only the measured race. K2/K10 are
untouched: every write that does leave still carries its precondition.

**To revert.** In `apps/web/src/client/editor/useBodyAutosave.ts`,
remove the `if (conflictRef.current !== null) return;` guard in
`flush()` and the `conflictRef`/`setConflict` wrapper above it (rename
`setConflictState` back to `setConflict`). Delete the "A59" describe
block in `useBodyAutosave.test.ts`, the closure assertion at the end of
XS-11's test in `tests/ui/flow-task-body.spec.ts`, and re-open the
known-gaps entry.

### K14 · Image attachments are validated and re-encoded on upload, with a cropper

**Date:** 2026-09-01 · **Ken's ruling — an agent may not revert this.**

**The situation.** REL-16 bullet 1 ("the PNG shows an inline image
thumbnail") is unbuilt; the tile renders a family glyph. Its test says
"see known-gaps" and forwarded to an entry that was never written. The
open questions were: render a 3 MB PNG inline per tile or resize
server-side, and what a corrupt image shows.

**Ken's ruling, in his words:** "show proper error messages for corrupt
images BEFORE it even gets saved. then if cannot load (e.g. the user
corrupts the image by hand-writing files or replacing files in file
system), then we show a fallback as if the image wasnt there. but if
you use the normal upload flow, we should check for valid image files,
crop and compress (we should also provide a cropper tool for users to
crop images)."

So, four parts:

1. **Validate on upload, refuse before writing.** A corrupt or
   non-image file claiming to be an image is rejected with a message,
   and nothing is stored. Not stored-then-flagged.
2. **Crop and compress on the way in.** The stored file is the
   processed one, so a tile renders a small image rather than a 3 MB
   original. This answers the resize question: server-side, at upload,
   once — not per render.
3. **A cropper tool** so the user chooses the crop rather than
   accepting a centre-crop.
4. **A fallback for a file corrupted after storage** — hand-edited or
   replaced on disk. It renders "as if the image wasn't there", i.e.
   the existing family glyph, not a broken-image icon.

**Most of this exists already.** `copyAvatar`
(`packages/core/src/users/avatar.ts:115`) validates, honours EXIF
orientation, resizes to a longest-edge bound and re-encodes as JPEG via
`sharp` — already a core dependency. The work is generalising that
pipeline from avatars to image attachments, not building it.

**Scope note.** Point 3 (a cropper) is a UI component no existing case
describes, and points 1–2 change what `POST /api/tasks/:ref/attachments`
stores — REL-18 currently asserts stored bytes are **byte-identical** to
the source, which is true for non-images and must stay true for them.
That tension needs settling when this is built: re-encoding an image
attachment means REL-18's guarantee no longer holds for images.

**Not built here.** Recorded during M2's gate; belongs in its own
ticket, and REL-16's known-gaps entry now points at this decision
instead of at nothing.

### K15 · Data deletes are hard by default; archive-by-default stays for projects and sprints

**Date:** 2026-09-01 · **Ken's ruling — an agent may not revert this.**

**The situation.** Ken first ruled "archive by default, hard-delete
with a flag" for label deletion, answering the v1 case audit's
label-delete contradiction. That
answer was never written into `decisions.md` — measured: `grep
MSL-12|MSL-32 docs/dev/decisions.md` returned **0**, against a positive
control of 15 for `K10` in the same file. My M4.3 brief then cited it
as a recorded decision, and the build agent correctly reported the
citation as unfindable rather than inventing one or ignoring it.

Meanwhile MSL-12 is an **M4 blocker** whose bullets read:

> On confirm, all 12 tasks are updated on disk and **the entry is
> removed from `labels.yaml`**. The same delete via CLI produces the
> same end state — the UI invents no extra remap mode.

"Removed from `labels.yaml`", matching the CLI, is a hard delete. An
archived label is still in the file, so archive-by-default cannot
satisfy that bullet.

**Ruling: hard by default**, as M4.3 built it (`?soft=true` archives).

**The UX reasoning Ken ruled on.**

1. **Deletion already cannot happen by accident.** Every delete routes
   through `RemapDeleteDialog`, and for a referenced item the confirm
   button is `disabled` until the user explicitly chooses remap-to or
   clear-the-reference. The protection archive-by-default would add is
   already present, one step earlier and more visibly.
2. **Archive-by-default preserves a lie.** Today's shipped behaviour
   returns `{"deleted": id}` with HTTP 200 while the entry stays in
   `labels.yaml` with `archived: true` — measured against a real
   tracker. A destructive action that reports success and does not act
   is worse than either honest option.
3. **It would need a home that does not exist.** An archived label the
   user cannot see or restore is a leak, not safety: it vanishes from
   pickers while still holding its name, so a replacement collides
   with something invisible. Making it real means an archived-labels
   view, an unarchive control, and an answer to "why can't I reuse
   this name?" — a ticket, not a flag.
4. **A label is cheap to recreate.** Archive-over-delete is right for
   things expensive to reconstruct; a label is a name and a colour,
   and the tasks that referenced it were explicitly remapped or
   cleared before anything was written.

**Scope, explicitly.** This governs labels, milestones and saved views
— the three routes M4.3 fixed. **Archive-by-default stands for
projects and sprints**, where it is already the behaviour and where
the entity carries history that is expensive to reconstruct.

**The accepted cost, stated before the ruling.** After the remap
prompt, a mis-click is unrecoverable except from git. Ken accepted
that with the alternative in front of him.

**To revert.** Flip the default in the three `handleDelete*` routes
and drop `?soft=true`; MSL-12 would then need rewording and the CLI
would have to archive too, or MSL-12's fourth bullet breaks.

**Supersedes** the unrecorded archive-by-default answer. A68 stands.


### A73 · `POST /api/query/validate` is a new route, not a reuse of the list or save paths

**Ticket:** M4.5 · **Date:** 2026-09-01 · **Commit:** (uncommitted)

**The situation.** VUE-8 needs a parse-error marker that updates *while
typing*, and VUE-31/32/33/34 need four distinguishable failures, each
carrying the offending token's position. Two existing routes touch
query validity, and neither can serve this: `GET /api/tasks` **runs**
the query (wrong side effects, wrong cost per keystroke) and `POST
/api/views` **writes** it. Both also flatten the error into a message
string via `error(res, err.message, …)`, discarding the `position` and
`suggestions` that `validate.ts` builds deliberately — which is
exactly LST-44/LST-45.

**What had to be decided.** Where validation-without-execution lives.

**Options considered.**

1. **Parse in the client with core's `parseQuery`/`validateQuery`.**
   Rejected: `validateQuery` needs the *workspace* `workflow.yaml` to
   know the enum keys and custom fields, so the client would need the
   whole config and would drift from what the server enforces on save.
2. **Add `?dry_run=1` to `POST /api/views`.** Rejected: overloads a
   write route with a read, and the CSRF/write semantics come along
   with it.
3. **A dedicated `POST /api/query/validate`.** Chosen.

**Decided.** Option 3. It returns **200 with a body**, not a 4xx: an
invalid *draft* is not a failed request, and the editor asks about
every keystroke. The body carries `valid`, plus `kind`, `message`,
`position` and `suggestions` when invalid. `kind` is derived from the
error **class** (`TokenizeError`/`ParseError` → `syntax`;
`QueryValidationError` → `unknown_field` or `unknown_value`), so
rewording core's copy cannot change which UI state renders.

**Side effect.** This closes LST-44/LST-45 for the editor's path:
position and suggestions now reach a surface intact for the first
time. The generic-500 behaviour on `GET /api/tasks` is unchanged and
still open.

**To revert.** Delete `handleValidateQuery`, its route entry, and
`ValidateQueryRequestSchema`; the editor then loses live markers and
VUE-8/31/32/33/34 regress. No stored data depends on it.

### A74 · Advanced → Basic refuses conversion rather than approximating it

**Ticket:** M4.5 · **Date:** 2026-09-01 · **Commit:** (uncommitted)

**The situation.** VUE-11 requires the Basic toggle to be disabled,
with a reason, when a query is not visually expressible — and is
explicit that "the query is never rewritten or truncated to fit".
`buildDsl.ts` already goes Basic → Advanced; nothing went back.

**What had to be decided.** How much of the DSL the reverse direction
should attempt.

**Options considered.**

1. **Best-effort conversion, dropping what does not fit.** Rejected —
   it is the P10 failure the case exists to catch: the basic filter
   would return different rows than the query the user wrote, silently.
2. **Convert only the exact shape `buildDslFromSearch` emits, and
   refuse everything else with a named reason.** Chosen.

**Decided.** Option 2. `dslToSearch` accepts a flat `and` of
`field = v` / `field in (a, b)` clauses over facet fields and
`fields.*`, and returns `{ expressible: false, reason }` for anything
else — a disjunction, a negation, any comparison operator, a
relationship call, a repeated field, a `today` value, or a field with
no basic control. The reason names the construct, which is what the
disabled control displays.

**Deliberate conservatism.** A query a human could see is expressible
may still be refused (`status = a and status = b`). A false refusal
costs the user a toggle; a false conversion costs them wrong rows with
no signal. The asymmetry is the point.

**One special case.** `archived != true` is the default scope
`buildDslFromSearch` always appends, so it maps back to the *absence*
of an `archived` filter rather than to a chip the user never set.

**To revert.** Delete `dslToSearch.ts` and the toggle in
`AdvancedQueryEditor`; VUE-10's return leg and VUE-11 regress.

### A75 · The saved-view name-collision warning lives in the client

**Ticket:** M4.5 · **Date:** 2026-09-01 · **Commit:** (uncommitted)

**The situation.** VUE-20 requires that saving a second view named
`overdue` **warns before writing**. Measured: `POST /api/views` twice
with the same name returns 201 both times and `queries.yaml` ends up
with two `overdue` entries. Ids stay distinct (the case's third
bullet holds), but `resolveView` then throws `multiple views named
'overdue'; refer by id instead` — a failure discovered later, from the
CLI.

**What had to be decided.** Whether core should refuse the duplicate.

**Options considered.**

1. **Make `createView` reject a duplicate name.** Rejected as
   out-of-scope and load-bearing: it changes an existing core contract
   that the CLI and MCP also use, and VUE-20's own wording ("the user
   can rename or explicitly confirm") requires the duplicate to remain
   *possible*.
2. **Warn in the client, ahead of the request.** Chosen.

**Decided.** Option 2. `checkViewNameCollision` compares
case-insensitively after trimming — "Overdue " and "overdue" read as
the same name — and returns a message stating how `loctt list --view
<name>` will resolve the ambiguity. Built-in filter labels are checked
too, per the case's fourth bullet.

**Not done.** The warning is a pure function with unit tests; wiring
it into a save dialog is not part of this ticket's surface, since
M4.5's editor does not own the save flow. Recorded so the next
saved-view ticket does not re-derive it.

**To revert.** Delete `viewNameCollision.ts`; VUE-20 has no other
implementation.

### A76 · The web surfaces `onWarning` as a `warnings` array on the tasks response

**Ticket:** M4.5 · **Date:** 2026-09-01 · **Commit:** (uncommitted)

**The situation.** VUE-21 requires a saved view referencing a deleted
custom field to degrade *visibly* — "it does not return zero rows
presented as a legitimate empty result". `listTasks` has always
reported this through `onWarning` rather than throwing, deliberately:
a view that used to work must keep working, so it runs and returns
what it matches.

**Measured.** The CLI passes `onWarning` (`task-crud.ts:225`, to
stderr) and MCP passes it (`task-crud.ts:163`, into a `warnings`
array). The web passed nothing — `grep -n onWarning
apps/web/src/server/server.ts` returned zero against three
`listTasks(` call sites as a positive control. So core raised the
warning and the web dropped it, returning 200 with an empty list.

**What had to be decided.** How the web surfaces it, given the other
two surfaces already had shapes.

**Options considered.**

1. **Promote it to an error.** Rejected: it would break views that
   used to work, which is the regression core avoids by design.
2. **A `warnings` array on the 200 response.** Chosen — it mirrors
   MCP's shape and sits beside `unreadable` and `missing_view`, which
   are the same idea (the rows are honest; this says what else the
   user needs to know).

**Decided.** Option 2. Entries carry `field`, `message`, `position`
and `suggestions` — the same structured fields A73's validation route
returns, so a client renders both the same way. Omitted entirely when
there are no warnings, so its presence is meaningful.

**Not a new capability.** This is web reaching parity with CLI and
MCP, so the reference docs are unchanged: the behaviour they describe
already existed on both surfaces they cover.

**Sibling, since resolved.** VUE-21's sibling VUE-22 (a view that no
longer *parses*) needed `parseQueriesConfig` to tolerate a bad entry on
load — a core contract change that was out of this ticket's scope when
this was written. It was subsequently resolved under **A118**
(2026-09-04): a broken view is now collected into a `broken` sibling
collection and surfaced on every surface.

**To revert.** Drop the `onWarning` callback and the `warnings` spread
in `handleListTasks`; VUE-21 regresses to a silent empty result.

### A77 · `TrackerInfoResponse` carries the timezone `today` was resolved in

**Ticket:** M4.5 · **Date:** 2026-09-01 · **Commit:** (uncommitted)

**The situation.** VUE-19's remaining UI-side criterion is that the
resolved date is discoverable — "the UI states the resolved date (and
which timezone it used) rather than leaving an off-by-one-day result
unexplained". Core already resolves `today` in the workspace zone on
every surface, and `/api/info` already sent the date. It did not send
the zone, so a user seeing a date one day off their wall clock could
not tell a correctly-configured workspace from a bug.

**What had to be decided.** Where the zone comes from, given the date
was already being computed.

**Decided.** `workspaceTodayWithZone()` returns both from **one**
`loadCalendarConfig` read, and `/api/info` spreads the pair. Resolving
the zone in a second read could straddle workspace midnight and report
a date and a zone that never went together — a rare bug, but exactly
the class VUE-19 is about.

`timezone` is **required** on `TrackerInfoResponse`, not optional: an
optional field would let a caller render the date with no zone, which
is the state the case is trying to eliminate. The three existing
placeholder fixtures (`AppBootstrap`'s two unknown-state objects and
the sidebar tests) declare `"UTC"`, matching the server's own fallback
rather than the viewer's browser zone.

**To revert.** Drop `timezone` from the interface and the response,
restore `workspaceToday`, and remove it from the three fixtures.
VUE-19's first bullet then has no data behind it.

### A78 · `initState` splits an empty `.loctt/` from a damaged one, because `exists` cannot

**Ticket:** M4.6 · **Date:** 2026-09-01 · **Commit:** (uncommitted)

**The situation.** Two cases ask the same boolean for opposite
answers. ONB-16 requires an **empty** `.loctt/` be treated as
uninitialized, routed to the wizard, with copy acknowledging the
folder already exists. SET-30 requires a `.loctt/` **holding tasks**
but missing `.schema-version` be treated as damaged and never offered
init — its own words: "a `.loctt/` holding tasks but no version file
is damaged, not empty."

Measured at `packages/core/src/diagnostics/info.ts`: `exists` was set
purely from `access(locttDir)`, so both states were `exists: true`.
Worse, measured over HTTP: both answered `409 schema_mismatch` on
**every** route including `/api/info`, because `requireSupportedSchema`
fails on a missing `.schema-version` and the guard's precondition was
`trackerDirExists` — the directory being present. An empty `.loctt/`
therefore got the schema banner, which ONB-16 explicitly forbids.

**What had to be decided.** What signal separates them, given
`taskCount`, `workflowConfig`, `queriesConfig` and `state` were
already computed and none alone discriminates.

**Decided.** A four-state `InitState` (`ready` / `absent` / `empty` /
`damaged`) on `TrackerInfo`, mirrored in contracts the way
`SchemaStatusResponse` mirrors `SchemaStatus`. `empty` requires *all*
of: no core files, zero tasks, and no config or state that loaded —
so a surviving `workflow.yaml` with no tasks is still `damaged`,
because that is someone's configuration and initializing would discard
it. The discriminator is the one SET-30 itself names, not an invented
one.

`missingCoreFiles` moved from `init.ts` into `init/core-files.ts` and
is now shared with `info.ts`. One definition rather than two: a
directory that init calls "empty" and the info read calls "damaged"
leaves the user on a screen whose only button cannot work.

The guard's precondition became "is there a tracker here worth
enforcing a version on" rather than "does the directory exist", via
`isEmptyTracker` — `access` calls only, short-circuiting on the first
sign of content. **Not** `getTrackerInfo`: the first cut called it
there and put a full task-directory scan plus three YAML parses in
front of *every* API request. SPR-6 caught it, failing
deterministically where it had passed; it passes again with the cheap
check. The expensive `empty`-vs-`damaged` split is drawn once, in
`/api/info`, where it is actually rendered.

A `damaged` tracker stays guarded — its data is real and SET-30 requires
it keep saying so, verified by a test that asserts the 409 *and* that
`state.yaml` is byte-identical after a refused init.

Reaches CLI and MCP for free: all three surfaces call `getTrackerInfo`.

**To revert.** Drop `initState` from `TrackerInfo` and
`TrackerInfoResponse`, restore `trackerDirExists` to the `fsStat`-only
form, inline `missingCoreFiles` back into `init.ts`, delete
`core-files.ts` (with `isEmptyTracker`) and `info.init-state.test.ts`. ONB-16 then fails as it did before: an
empty `.loctt/` shows the schema banner.

### A79 · An **empty** `.loctt/` is initialized via core's `repair` path

**Ticket:** M4.6 · **Date:** 2026-09-01 · **Commit:** (uncommitted)

**The situation.** With A78 routing an empty `.loctt/` to the wizard,
the wizard's submit still failed: `initLoctt` refuses any existing
`.loctt/` and throws `InitRepairNeededError` — measured as `Error:
.loctt directory at … exists but is incomplete — missing:
config/workflow.yaml, config/projects.yaml, state.yaml`. The screen
ONB-16 requires was offering a button that could not work.

**What had to be decided.** Whether to relax core's refusal, or have
the web pass the `repair` flag core already has.

**Decided.** `handleInit` reads `getTrackerInfo(root)` and passes
`repair: true` **only** when `initState === "empty"`. Core is not
relaxed: its refusal is right for every other state.

Passing it only for `empty` is the entire safety argument. `repairLoctt`
rebuilds `state.yaml` with `next_number: 1`, which on a tracker with
surviving tasks reissues keys already in use — the CLI says so and
points at `doctor --rebuild-index`. An empty directory has no keys to
reissue and no `projects.yaml` to inherit a prefix from, so the user's
typed prefix and project name are used verbatim. Asserted at the far
end: the test reads `projects.yaml` and `state.yaml` off disk and
checks both carry `WEB-` and `Website`, not a default a layer
substituted.

**To revert.** Drop the `initState === "empty"` spread in
`handleInit`. Init into an empty `.loctt/` then 400s, and ONB-16's
last bullet fails while its first two still pass — the wizard renders
and the button does nothing.

### A80 · The wizard's prefix rule rejects only what breaks a key, and ONB-19's two bullets conflict

**Ticket:** M4.6 · **Date:** 2026-09-01 · **Commit:** (uncommitted)

**The situation.** ONB-19 asks for two things that cannot both hold
against the shipped CLI. It wants the wizard to reject "a space, a
slash, or a lowercase/unicode character the CLI would reject", and it
wants the rule to match the CLI exactly: "a value the CLI would take
is not rejected here, and vice versa".

Measured against the built CLI at this SHA — `loctt init --prefix`
with `"a b"`, `"web/x"`, `"lowercase-"`, `"Ünicode-"`, `"NODASH"`:
**all five exit 0 and initialize**. Core validates only non-emptiness
(`init.ts:199`). `setProjectPrefix` likewise checks only emptiness and
uniqueness. So there is no CLI rule to match; matching it exactly
means rejecting nothing, and the first bullet fails.

This is a real defect on the CLI side, not only a doc problem:
`--prefix "web/x"` allocates keys like `web/x1`, and the web UI routes
tasks at `/tasks/$key`, so those keys break their own task URLs.
Verified: `loctt create` returns `Created web/x1`.

**What had to be decided.** Which bullet to honour, given both cannot
be.

**Decided.** The **narrow** rule: reject only characters that
demonstrably break something — whitespace, and the punctuation that
cannot survive a URL path segment — and accept everything else,
including lowercase, unicode, and a prefix with no trailing dash. The
message states the allowed set and the trailing-`-` convention, so the
"states the actual rule" bullet holds; the preview is withdrawn on a
rejected prefix rather than promising a key that cannot be allocated.

This keeps ONB-19's compatibility bullet true for every prefix the CLI
takes *except* those containing the broken characters, and honours the
spirit of the first bullet for the cases that matter. The wider
reading (uppercase-only, trailing `-` required) would reject prefixes
the CLI accepts today, failing the compatibility bullet outright.

**Not decided here, and deliberately not done:** tightening core's own
prefix validation so the CLI and UI agree by construction. That
changes what an existing command accepts and could reject prefixes in
trackers already on disk — Ken's call, not an agent's. Recorded in
`known-gaps.md`.

**To revert.** Delete `apps/web/src/client/init/prefix.ts` and its
test, and let the field accept anything non-empty. ONB-19 then fails
on its first, second and fourth bullets.

### A81 · The burndown's "nothing to burn down" keys off the task list, not the series

**Ticket:** M4.7 · **Date:** 2026-09-01 · **Commit:** (uncommitted)

**The situation.** SPR-16 wants a sprint with zero tasks to state
"nothing to burn down" rather than draw empty axes. The obvious test
is the series itself: `initialTotal === 0` and every day's
`incompleteTaskCount === 0`.

Measured, that test is wrong. A sprint whose every task was
*completed* produces exactly the same response — `initialTotal: 0`,
`incompleteTaskCount: 0` on every day:

    [('2026-08-30', 0, 0), ('2026-08-31', 0, 0), ('2026-09-01', 0, 0)]

byte-identical to a sprint that never held anything. The first version
of this component used that test and suppressed the chart for a
finished sprint, which hid the burn-down-to-zero SPR-30 requires to be
*visible*. The SPR-30 spec caught it.

**What had to be decided.** What distinguishes "empty" from "finished"
when the wire cannot.

**Decided.** The sprint's **current task list** — which the detail page
already loads for its table — is the discriminator. `nothingToBurn` is
`tasks.length === 0 && every incompleteTaskCount === 0`. No tasks
assigned means the empty state; any assigned task means a real sprint
with a real (possibly flat-at-zero) line.

**Why not the alternative.** Adding a `hadAnyTask` flag to the
burndown response would put the answer on the wire, but it is a core
contract change for a question the client can already answer from data
it holds, and M4.7 owns no core change.

**To revert.** In `apps/web/src/client/sprints/BurndownChart.tsx`,
restore `nothingToBurn` to `series.initialTotal === 0 && …`. SPR-30's
"completing then reopening" spec will fail, which is the signal that
the fix mattered.

### A82 · The shared `FilterBar` gains `from` / `hiddenFacets`, rather than the sprint page forking it

**Ticket:** M4.7 · **Date:** 2026-09-01 · **Commit:** (uncommitted)

**The situation.** SPR-13 requires the sprint detail's task list to use
the **shared** filter bar — "the filters offered and the query
semantics match flow-list.md — no sprint-only filter dialect".
`FilterBar` was hardcoded to `useSearch({ from: "/list" })` /
`useNavigate({ from: "/list" })`, so it could not mount on
`/sprints/$key` at all.

**What had to be decided.** Parameterize the shared component, or give
the sprint page its own bar.

**Decided.** Parameterize. `FilterBar` takes an optional `from`
(defaulting to `/list`, so every existing call site is unchanged), a
`hiddenFacets` list, and `showSaveView`. The sprint detail passes
`from="/sprints/$key"` and `hiddenFacets={["sprint"]}`.

Two facts made a fork the worse option: a second bar is exactly the
"filter dialect" SPR-13 rules out, and the facet list, option
building, chip row and clear-all would be duplicated — the drift this
repo has been bitten by repeatedly. The route also shares
`listSearchSchema`, so the URL vocabulary is literally the same
schema, not a matching one.

**Why `sprint` is hidden rather than shown-and-locked.** The route
param *is* the scope. A visible sprint control could clear or change
it, leaving the header naming one sprint while the list showed
another. The scope is applied after the URL's filters
(`{ ...tasksParamsFromSearch(search), sprint: [sprintId] }`), so even a
hand-edited `?sprint=<other>` cannot retarget the page — there is a
spec for exactly that.

**To revert.** Drop the three props and restore the two `from: "/list"`
literals; the sprint detail then needs its own bar, and SPR-13's
"shared filter bar" bullet is no longer satisfied by construction.

### A83 · The burndown's unit *reason* is derived client-side from `workflow.yaml`

**Ticket:** M4.7 · **Date:** 2026-09-01 · **Commit:** (uncommitted)

**The situation.** SPR-11 requires the page to state, near the chart,
that a `custom_enum` estimation with no `weights` is being *counted as
tasks* rather than summed, with a pointer to adding `weights`.

Core's `determineUnit` collapses two different configurations onto
`unit: "tasks"` — estimation switched off (SPR-10), and `custom_enum`
without weights (SPR-11) — and the burndown response carries only the
result. The wire genuinely cannot tell them apart.

**What had to be decided.** Where the distinction comes from.

**Decided.** `resolveAxis` in
`apps/web/src/client/sprints/burndownModel.ts` re-derives it from the
workflow config the client already loads: estimation enabled + unit
`custom_enum` + no `weights` ⇒ `enum-without-weights`, otherwise
`estimation-disabled`. The chart renders the explanatory note only for
the first.

**Why not add a `unitReason` to the response.** It is the better long-
term shape and belongs in core with CLI and MCP surfacing it too —
which is precisely why it is not being done inside M4.7's UI ticket.
Recorded here rather than done.

**To revert.** Delete the `UnitReason` type and the
`burndown-enum-fallback` block; SPR-11's "states the fallback" bullet
then has nothing satisfying it.

### A84 · A11Y-2 is left uncovered: the `/` shortcut is built, its target is disabled

**Ticket:** M4.8 · **Date:** 2026-09-01 · **Commit:** (uncommitted)

**The situation.** A11Y-2 requires `/` to move focus to "the
filter/search input" and to not insert the character. The `/` binding
is built and registered in `shell/shortcuts.ts`, and the shell's
handler focuses `input[type="search"]`.

But at M4.8 the app's only global search box — the header's — was
rendered `disabled`, with `title="Search arrives in a later milestone"`.
A disabled input cannot receive focus, so the case's first bullet could
not be satisfied, and no M4 ticket built search.

> **Superseded (B2, `52b2e69`).** Search shipped: `Header.tsx` now
> renders a real `HeaderSearch` combobox and `/` focuses it, so A11Y-2 is
> claimed. The reasoning below is kept as the record of why it was
> deferred at M4.8.

**What had to be decided.** Whether to build a global search box so
A11Y-2 could be claimed.

**Decided.** No. Building full-text search is a feature no ticket owns
and would be inventing scope. A11Y-2 is left **uncovered** and no test
carries its `@verifies` tag.

**Why not tag it anyway.** A test asserting the `/` handler runs would
be vacuity shape (b) — the label asserted rather than the effect. The
gate would read A11Y-2 as covered while a keyboard user still cannot
reach a search box. The third bullet ("`/` inside a text field inserts
a literal `/`") *is* covered, in
`shell/useShortcuts.test.tsx`, but under A11Y-1's and A11Y-43's tags
where it genuinely belongs rather than as a stand-in for the case.

`tests/ui/flow-accessibility.spec.ts` carries a deliberately untagged
test, "A11Y-2 (partial)", asserting the box is disabled. It fails the
day search is built, which is the signal to restore the real
assertions and the tag.

**To revert.** Build the header search box, then replace that test
with the two focus assertions and tag it `@verifies A11Y-2`.

**RESOLVED (B2, 2026-09-06, staged).** SHL-46 built the header search box
(no longer disabled), so A11Y-2 now has a focusable target. The
"A11Y-2 (partial)" placeholder in `flow-accessibility.spec.ts` was
replaced by a real "A11Y-2 / A11Y-8" test (`/` focuses the enabled box,
does not type a literal slash, typing lands a single caret) and tagged
`@verifies A11Y-2`. The test also guards the B2 duplicate-`/`-binding fix
(one owner: the global shortcut registry; Header's own `/` listener
removed — see A151). A11Y-2 is no longer uncovered.

### A85 · The global shortcut table is one registry that both dispatches and documents

**Ticket:** M4.8 · **Date:** 2026-09-01 · **Commit:** (uncommitted)

**The situation.** A11Y-4's second bullet: "the list matches the
shortcuts actually bound — a shortcut that exists but isn't listed, or
listed but not bound, is a defect."

Before this ticket the bindings were scattered — `[` in
`useSidebarCollapse`, `n` in `CreateTaskProvider` — and the reference
in `settings/KeyboardPanel.tsx` was a hand-maintained array with source
line numbers in its comments. That makes the bullet unassertable by
construction: the only way to check the list against the bindings is
for a human to re-read both.

**What had to be decided.** Whether to add the new keys as more ad-hoc
listeners, or to centralise.

**Decided.** One exported table, `GLOBAL_SHORTCUTS` in
`apps/web/src/client/shell/shortcuts.ts`. `useShortcuts` dispatches
from it; `ShortcutHelpDialog` renders from it. The `[` and `n`
listeners were **removed** from their components and re-bound through
the registry.

This also fixed a real defect found on the way: `[` carried only the
typing guard, not the dialog guard, so `[` collapsed the sidebar
underneath an open create modal — an A11Y-8 violation. Centralising
applies all three suppression rules (typing, dialog, modifier)
uniformly.

**What is deliberately not in it.** Context-scoped keys — `Ctrl+←` on a
board card, `Esc` inside a modal, `↑`/`↓` on a reorder handle. Those
are bound by the component that owns focus and only mean anything while
it is focused. `Esc` in particular must stay per-layer: A11Y-5 and
A11Y-34 require it to close *the topmost* layer, which only the layers
know.

**Consequence for existing tests.** Two tests in
`useSidebarCollapse.test.tsx` asserted the `[` listener that no longer
lives there. They were removed, not weakened — the behaviour is now
covered more strongly by `useShortcuts.test.tsx` (dispatch plus both
suppression rules) and end to end by A11Y-6 in
`flow-accessibility.spec.ts`. `settings/KeyboardPanel.tsx` still holds
its own hand-maintained table for the context-scoped keys, which the
registry does not cover.

**To revert.** Re-add the `keydown` effects to `useSidebarCollapse` and
`CreateTaskProvider` and delete `shortcuts.ts` / `useShortcuts.ts`;
A11Y-1..8 lose their coverage and the `?` dialog has no source.

### A86 · Modals mark the shell chrome `inert`, and focus recovery is centralised there

**Ticket:** M4.8 · **Date:** 2026-09-01 · **Commit:** (uncommitted)

**The situation.** A11Y-14's third bullet requires content behind a
modal to be "inert to assistive tech, not merely visually dimmed — a
screen reader's virtual cursor cannot browse the list underneath". A
focus trap does not deliver that, because a virtual cursor does not
follow focus.

**What had to be decided.** What to mark, and how to keep A11Y-15's
focus-return working once it was marked.

**Decided.** `useInertBackground` in `ui/Modal.tsx` sets `inert` on the
element carrying `data-app-chrome` (the shell's chrome div), guarded by
a depth counter so stacked layers (A11Y-34) unwind correctly.

**Two wrong implementations, both measured, both worth recording
because each looked right.**

1. `aria-hidden` on `#root`. These modals are **not** portalled — they
   render inside `#root` — so this hides the dialog along with the page
   behind it. Worse than the defect it fixes, and invisible to a test
   that only checks the attribute landed.

2. Marking the chrome inert without touching focus. `focus()` on an
   element inside an `inert` subtree is silently ignored, so the create
   modal's own focus-restore ran while the chrome was still inert and
   left `document.activeElement === body` — exactly A11Y-15's named
   failure. Verified by isolation: with `useInertBackground()` commented
   out of `CreateTaskModal`, A11Y-15 passed; with it in, it failed.

So `useInertBackground`'s cleanup also restores focus, to the last
element focused *within the chrome*. That element is tracked by a
capturing `focusin` listener installed at **module load**, not from
inside the effect — installing it in the effect means it starts
existing only once a dialog is already opening, by which point the
trigger's own `focusin` has been missed and there is nothing to restore
to. That mistake cost three failed fixes before isolation found it.

**A third wrong version, found by the full suite.** Marking the chrome
inert unconditionally broke every dialog that renders *from inside*
the chrome. `SaveViewDialog` mounts in `FilterBar` → `<main>` →
chrome, so inerting the chrome disabled the dialog's own Save button:
VUE-6, VUE-7 and XS-17 each hung 30s clicking a control that would
never enable. The same `#root` mistake in a different hat, and this
time invisible until a spec three files away timed out.

`useInertBackground` now takes the dialog's panel ref and **refuses to
inert a chrome that contains it**. Focus recovery is deliberately
*not* skipped in that case — it is a separate concern, and A11Y-34's
chain (⋯ menu → delete dialog) lives inside the chrome and depends on
it. So a chrome-nested dialog keeps its focus trap and its focus
return, and forgoes only the virtual-cursor isolation.

**What that costs, stated plainly.** A11Y-14's third bullet is fully
met only for dialogs mounted as siblings of the chrome — today the
create modal and the `?` dialog. `SaveViewDialog`, `DeleteTaskDialog`
and the settings dialogs get the trap but not the inert background.
Moving them to a portal would fix it and is the right long-term shape;
it is not an a11y-polish ticket's change to make across six
components, so it is recorded here rather than done.

**To revert.** Delete `useInertBackground` and its call sites in
`ui/Modal.tsx`, `create/CreateTaskModal.tsx`,
`task/DeleteTaskDialog.tsx` and `shell/ShortcutHelpDialog.tsx`.
A11Y-14's inert bullet loses its coverage; A11Y-15 keeps working, since
the modal's own restore is sufficient once nothing is inert.

### A87 · `PUT /api/workflow` surfaces core's error envelope instead of flattening it to `config_invalid`

**Ticket:** M4.8 · **Date:** 2026-09-01 · **Commit:** (uncommitted)

**The situation.** Writing SET-39's spec — a tracker settings write
under a held state lock — surfaced a real defect. `handlePutWorkflow`
caught *everything* from `applyWorkflowEdit` and reported
`config_invalid` with a 400.

So a lock conflict, which is a transient condition nothing about the
user's input caused, was reported as "the config is invalid". Measured:
with another process holding the state lock, the envelope came back
`{code: "config_invalid"}` and a 400.

That is three violations at once — ERR-31 (the cause was knowable and
was reported as something else), ERR-32 (a routine failure landing in a
generic handler), and SET-39's own first bullet (the failure must name
the lock).

**What had to be decided.** Whether to fix the handler inside an a11y
polish ticket.

**Decided.** Fixed. The handler now re-raises core's envelope for any
`LocttError` before falling back to `config_invalid`:

```ts
if (err instanceof LocttError) {
  const env = err.toEnvelope();
  error(res, env.message, statusForCode(err.code), env);
  return;
}
```

This is the pattern `bulkAborted` already uses a few hundred lines
above (V1, V8: the envelope comes from the error rather than being
re-derived), so it is applying an existing convention to a handler that
had missed it, not introducing one.

**Scope.** One handler, and only the branch that was mis-attributing.
The `config_invalid` fallback is untouched and still catches a genuinely
invalid document, which is what it was written for.

**To revert.** Delete the `LocttError` branch in `handlePutWorkflow`;
SET-39's test in `apps/web/src/server/server.errors.test.ts` goes red
with `expected 'config_invalid' to be 'conflict'`, which is exactly how
it was found.

### A88 · Focus return walks back to the nearest *surviving* chrome focus, not the newest one

**Ticket:** M4.8 · **Date:** 2026-09-01 · **Commit:** (uncommitted)

**The situation.** A11Y-34 opens three layers — task detail → ⋯ menu →
delete confirmation — and requires focus to "return correctly at each
step". A11Y-15 says the same thing for one layer, and adds the escape
clause that matters here: focus lands on the trigger "or its nearest
surviving equivalent when the trigger is gone".

Two problems showed up, both measured:

1. `DeleteTaskDialog` focused its input on open and did **nothing** on
   close. Dismissing it left `document.activeElement === body`, so the
   next Tab restarted at the top of the page.
2. Once that was fixed with `useFocusTrap`, focus still landed on
   `body` — because the ⋯ menu *closes as its item is chosen*, and the
   dialog mounts afterwards. At trap-mount time there was nothing
   focused to remember, and the single-slot chrome-focus tracker held
   the menu item, which was already detached.

**What had to be decided.** What "the trigger" means when the thing
that opened the dialog no longer exists.

**Decided.** `ui/Modal.tsx` keeps a bounded history (4) of elements
focused inside the app chrome, and the restore walks back to the most
recent one still `isConnected`. For A11Y-34 that is the menu's own
trigger — measured: focus lands on the "More" button.

The history is re-resolved at cleanup rather than reused from open
time, because the element recorded when the dialog opened can itself
unmount while it is open (a row deleted underneath a confirmation is
the ordinary case).

**Why bounded.** An unbounded history retains detached DOM for the
session. Four covers trigger → menu → item → dialog with room spare.

**To revert.** Replace `lastSurvivingChromeFocus()` with a single
`lastChromeFocus` slot and drop `useFocusTrap`/`useInertBackground`
from `task/DeleteTaskDialog.tsx`. A11Y-34 then fails with focus on
`BODY`, which is how it was found.

### A89 · Settings → Keyboard derives its global rows from the registry

**Ticket:** M4.8 · **Date:** 2026-09-01 · **Commit:** (uncommitted)

**The situation.** `settings/KeyboardPanel.tsx` held a hand-maintained
`SHORTCUTS` array with source line numbers in its comments. Its
docblock said shortcuts "specified but not yet wired (A11Y-1's `n`,
for one) are deliberately absent" — correct when written.

M4.8 built `n`, `/`, the `g` chords, `t` and `?`. That left the panel
listing exactly one global key (`[`) and silently omitting six that
were bound — a reference that is wrong in the direction A11Y-4 names:
bound but not listed.

**What had to be decided.** Whether to add six rows by hand or derive
them.

**Decided.** The panel's "Global" group is `GLOBAL_SHORTCUTS.map(...)`
— the same table `useShortcuts` dispatches from and `ShortcutHelpDialog`
renders. Adding a global key now updates the dispatcher, the `?`
dialog and this page together.

**What stayed hand-maintained, and why.** The context-scoped groups —
board cards, reorder handles, the body editor, dialogs. Those keys are
bound by whichever component owns focus, there is no single table to
derive them from, and hoisting them into one would mean the global
dispatcher needs to know what is focused (see A85). They keep their
source-line comments, and the docblock now says which half is derived
and which is not.

**To revert.** Replace the `Global` group with a literal array. The
panel then re-acquires the drift A11Y-4 forbids, silently.

### A90 · The milestone drill-in carries a DSL predicate excluding discarded tasks

**Ticket:** M4.9 · **Date:** 2026-09-02 · **Commit:** (uncommitted)

**The situation.** MSL-4 requires the drill-in row count to equal the
milestone's `total` from the progress readout, under MSL-3's discarded
rule. `/api/tasks?milestone=<id>` does not satisfy that: it returns
discarded tasks, while `progress.total` excludes them. Measured on a
live server against MSL-3's own worked example (10 tasks, 2 discarded):
the milestones endpoint answers `{"done":4,"total":8,"discarded":2}`
while `/api/tasks?milestone=<id>` answers `total: 10`. The case's `4 / 8`
readout would sit above 10 rows.

**What had to be decided.** `STRUCTURED_FILTER_FIELDS` has no category
negation, so the exclusion could not ride as a structured filter. The
ticket named two options: a DSL `query` on the drill-in, or renegotiating
the equality with the case.

**Decided.** The drill-in sends both — the `milestone` structured filter
*and* a DSL `query` of `status.category != discarded`. Measured:
`?milestone=<id>&query=status.category%20!%3D%20discarded` returns
exactly 8, matching `total`. The predicate is `EXCLUDE_DISCARDED_QUERY`
in `milestones/model.ts`, so the view and its spec build the same string
rather than two that can drift.

A user's own `?q=` from the URL is **and**-ed with it rather than
replaced, so a filter typed on the detail page still applies and the
count still matches.

**Why not renegotiate the case.** The equality is the case's point: it
is what catches a drill-in that quietly shows a different task set than
the number above it. Dropping it would leave the two free to disagree.

**To revert.** Remove the `query` composition in `MilestoneDetail`'s
`params` memo and pass `{ ...base, milestone: [milestoneId] }`. The row
count then reads 10 under a `4 / 8` heading — measured: doing exactly
that reddens the MSL-4 and MSL-25 specs.

### A91 · The milestone detail resolves from the list; no `GET /api/milestones/:id` is added

**Ticket:** M4.9 · **Date:** 2026-09-02 · **Commit:** (uncommitted)

**The situation.** No per-id milestone route exists. The detail needs
the milestone's name, target date and progress.

**What had to be decided.** Add the endpoint, or resolve client-side
out of the list the view already fetches.

**Decided.** Resolve from the list. Beyond avoiding server work the
ticket does not own, it is what makes MSL-38 correct: a 404 from a
detail endpoint arrives as a query *error*, so the not-found state
would have to be told apart from a genuine load failure by inspecting
an envelope. Resolving from the list makes "the fetch succeeded and no
milestone has this id" a plain fact, and the load-failure branch stays
separate with its own retry — which is exactly the distinction MSL-38
asks for.

**Cost.** The detail pays for the whole milestones list. These are
config lists, fetched at the shared 1000-item picker limit and shared
with the view via the query cache, so the detail usually reads a warm
entry rather than issuing a request.

**To revert.** Add `GET /api/milestones/:id` and a `useMilestone(id)`
hook, and give the detail an explicit 404-vs-error discrimination on
the envelope's `code`.

### A92 · Progress rides a `["workflow", …]` query key, and the orphan count is computed client-side

**Ticket:** M4.9 · **Date:** 2026-09-02 · **Commit:** (uncommitted)

**The situation.** Two gaps, both in `withProgress`/`referenceProgress`.

MSL-29: progress is computed from status **categories** in
`workflow.yaml`, so a settings edit changes every number without
touching a milestone or a task. `invalidateWorkflowConsumers`
invalidates `workflow`, `workflow-usage`, `config`, `tasks` and `task`
— not milestones.

MSL-24: `referenceProgress` seeds its map with the requested ids only
and silently drops tasks pointing at a deleted milestone. Measured —
with one such task the milestones response is byte-identical to the
response without it, so "that exclusion is visible somewhere" has
nothing on the wire to render.

**What had to be decided.** Whether to add milestones to
`invalidateWorkflowConsumers` and an orphan counter to the response
(both server/shared changes), or handle each on the client.

**Decided.** Both on the client.

The progress query key is `["workflow", "milestones-progress"]`, so the
existing `["workflow"]`-prefix invalidation drops it as a matter of key
structure rather than because someone remembered to add it to a list.

Orphans are found by difference: read the tasks and keep those whose
`milestone` names an id the fetched milestone list does not contain. It
is a *diagnosis* and never feeds a count.

**The narrowing is client-side, and that was measured rather than
assumed.** A `milestone != null` DSL predicate was tried first to make
the server do it. It does not filter: on a two-task tracker where only
one task has a milestone, `GET /api/tasks?query=milestone != null`
returns **both**, the unset one included as `milestone: null`. So no
predicate is sent, and the `t.milestone !== undefined` guard in the
hook is what excludes unassigned tasks — without it, every task with no
milestone would be reported as an orphan.

**To revert.** Rename the query key to `["milestones-progress"]` and add
it explicitly to `invalidateWorkflowConsumers`; replace
`useOrphanedMilestoneTasks` with an orphan counter in the milestones
response.

### A93 · A shared workspace-calendar date formatter, pinned to noon UTC

**Ticket:** M4.9 · **Date:** 2026-09-02 · **Commit:** (uncommitted)

**The situation.** MSL-1 wants `target_date` "formatted per the
workspace locale/calendar". `GET /api/calendar` carries the workspace
`timezone`, but no ticket built a formatter bound to it — M4.2 built
the Calendar settings *panel*, not this. `list/format.ts`'s `shortDate`
drops the year within the current year and ignores the calendar
entirely.

**What had to be decided.** A local helper in the milestones view, or a
shared utility.

**Decided.** A shared utility, `client/dates/workspaceDate.ts`. The
timeline and the task detail need the same thing, and three private
copies is how one date renders two ways on two surfaces.

The date-only string is pinned to **noon** UTC, not midnight. Midnight
UTC lands on the previous calendar day once shifted into any western
zone, so a milestone due Jan 1 renders as Dec 31 — measured: switching
to `T00:00:00Z` reddens the formatter spec.

An unparseable value is returned verbatim rather than becoming "No
target date": config drift must stay visible (P7), and swallowing it
would hide a value that really is on disk.

**To revert.** Inline `formatWorkspaceDate` into `MilestonesView` and
delete `client/dates/`. The timeline and task detail then each need
their own, which is the drift this avoids.

### K16 · An interrupted prefix rename is auto-completed and then *reported*, not surfaced mid-flight

**Date:** 2026-09-02 · **Ken's ruling — an agent may not revert this.**

**The situation.** PRU-46 asks for an interrupted prefix rename to be
surfaced: the panel shows the project mid-rename, names the prefix it
was moving from and to, and offers a control to complete it.

`server.ts:4290` calls `recoverInterruptedPrefixRename` before **any**
handler runs, with the comment: "Finish an interrupted prefix rename
before any handler reads a task key … every key the request would go
on to return could be stale." So a sentinel either heals or the
request 500s. **Measured**: writing a valid sentinel after boot and
issuing one `GET /api/projects` flipped the prefix, deleted the
sentinel, and returned no `pending_prefix_rename`. The banner in
`ProjectsPanel.tsx:288` and `handleCompletePrefixRename`
(`server.ts:1481`) are unreachable dead code, built for a
boot-only-recovery design the middleware forecloses.

**Two options were put to Ken, and he took neither as written.**

- *(a) Keep auto-recovery, delete the banner.* Robust, but the user is
  never told their keys changed.
- *(b) Make recovery boot-only or GET-exempt so the panel works.*
  Reintroduces a window in which a handler serves stale keys — the
  exact failure the middleware exists to prevent — and diverges from
  the CLI and MCP, which use the same auto-recover pattern.

**Ruling: keep the middleware exactly as it is, and stop discarding the
success value.**

`recoverInterruptedPrefixRename` already returns
`{recovered?: SetPrefixResult, error?: Error}` (`prefix.ts:200-205`),
and `SetPrefixResult` carries `from`, `to` and `renamed`
(`prefix.ts:35-39`). The server handles the error branch and **throws
the success branch away**. So today a user's primary identifiers change
under them — `WEB-1` becomes `SITE-1` on reload — with nothing said.
That is a silent mutation of the thing every link, filter and CLI
cross-reference depends on, which is the P1 shape this project treats
most seriously.

Surface it **once, after the fact**: "A prefix rename that was
interrupted has been completed: WEB- → SITE-, 3 tasks renamed. Old
keys still resolve." Delivered through the same notice channel other
post-hoc facts use — not a dialog, because there is nothing to decide.

**Why this beats both options.** It keeps (a)'s correctness guarantee —
no handler can ever serve a stale key — while giving better UX than
(b) offered, because the user is *told what happened* rather than asked
to do work the system has already done.

**Consequence for the case.** PRU-46's first three bullets describe a
mid-rename state that cannot exist and must be reworded; its headline,
"surfaced, not silently half-applied", is served better by this than by
either option. The case is **not** edited by an agent — flag it for
Ken. The quarantined `test.fixme` stays until the notice is built, then
asserts the notice rather than the banner.

**To revert.** Drop the notice and delete the banner and
`handleCompletePrefixRename`; that is option (a).

### K17 · M5.1's backup covers attachments; history is opt-out; the cases are drafted and reviewed before building

**Asked 2026-09-02**, because M5.1's ticket left three things unstated
and its cases are Ken's to approve.

**Rulings, in his words:**

1. **Scope.** "frontmatter + body + Comments + attachments are
   critical. history is optional, but allow opt out."

   So attachments are **in**, and `_history.yaml` is in **by default
   with a flag to exclude it** — "optional… allow opt out" means the
   history ships unless the user says otherwise, not the reverse.

   This overrides the recommendation put to him, which was to exclude
   attachments because they are binary and would either inflate the
   file with base64 or stop it being a single portable file. He chose
   completeness over that constraint, so the format must now solve it
   rather than dodge it.

2. **Restore semantics.** Not settled — he asked for a proposal:
   "what would a complete version look like? propose to me." **Still
   open.** Nothing may be built that assumes an answer here.

3. **Authorship.** "you write, you review the cases with another
   agent, iterating until good. then you may implement."

   This **supersedes the ticket's** "they are Ken's to approve, not an
   agent's to author" and the condition-2 stop that followed from it.
   The bar he set in its place is a drafting loop with an independent
   reviewing agent, iterated to convergence, before any implementation.

**Ruling 2, answered 2026-09-02.** The proposal was put to him with the
config question flagged as the hard one. He took the harder half.

- **Restore shape: "Yes — build this shape."** One command, three
  modes: bare `restore` refuses a non-empty tracker and names what is
  in the way; `--merge` adds absent ids and never edits an existing
  task; `--overwrite` replaces any id the backup carries. All three
  atomic under one `withStateLock`, all with `--dry-run`, all reporting
  per-outcome counts rather than "OK". Key collisions on merge reuse
  the **existing** `move.ts:92` path — reallocate from the destination
  project's counter and append the old key to `key_history`, so links
  keep resolving (P-7). Verified that path exists before proposing it.

- **Config scope: "Tasks + config."** Against the recommendation, which
  was tasks-only. So the backup is a whole-tracker backup, restorable
  onto a bare machine — and the config-merge collision the
  recommendation was trying to avoid is now **in scope and must be
  answered by a case**: two trackers each holding a label named "bug"
  with different ids is the worked example. Picking a winner silently
  is how data quietly goes wrong, so the cases must say what happens.

**What remains an agent's call**: the split threshold (a number no
case names — decided at step 1 and recorded with a revert path, as
BLK-30's was), and the attachment encoding, proposed as base64 in each
task's own JSONL line under `{name, bytes}` since a sidecar directory
would stop the deliverable being one portable file.

**Rulings 4 and 5, 2026-09-02.**

4. **Collision rule — "default to keep both, and rename the imported
   one as Bug (2) or whatever that's non-colliding."** A user-selectable
   flag, defaulting to keep-both-with-rename.

   Asked whether the user could pick, he said yes and then chose the
   default himself. Note what he did *not* pick: the unrenamed variant.
   The schema permits duplicate names — `LabelsConfigSchema`'s
   `superRefine` dedupes on **`id`** (`packages/contracts/src/labels.ts:32`),
   not on name — and that fact was put to him explicitly. He still
   wanted the rename, so the rename is a **deliberate UX choice, not a
   schema requirement**, and must not be justified as the latter.

   The suffix is "non-colliding", so a second merge produces `(3)`, not
   a second `(2)`. `remap` remains available as a non-default option —
   and if it is built it must be **per entity type**: remapping two
   same-named sprints onto one id silently discards a `start_date`,
   `end_date` and `state`, which labels do not have.

5. **`state.yaml` and `.loctt/local/` — "some should be merged, some
   project counters need to be re-calculated. case by case, pick the
   more intuitive option."**

   This is a **principle, not an enumeration**, and it is recorded as
   such deliberately: he did not name which counters merge and which
   recompute. The agent judgment it delegates is per-field, and each
   call belongs in § 8 with its reasoning, not here.

   The correctness problem behind the question is real and measured:
   `LocttStateSchema` is `{keys, retired_keys}`
   (`packages/contracts/src/state.ts:19`), the per-project key
   allocation counters. A restore that omits them leaves a restored
   tracker reissuing keys already in use, so the first `task create`
   after a bare-machine restore collides — breaking P-1 invisibly until
   then.

   Not settled by this ruling, and needing its own answer before build:
   whether `.loctt/local/` travels. It holds machine-local data (git
   remote config, recents), and carrying it would move one machine's
   sync remote onto another's.

**Ruling 6, 2026-09-02 — `--overwrite` preserves displaced bodies.**

Found while reviewing the cases, not while writing them: `mergeTask`
(`git/merge.ts:73`) deliberately returns the **losing** body when two
versions differ, so the caller can preserve it. Its comment says why —
"a silently replaced body is the failure mode that costs most; people
do not re-read their own paragraphs to check they survived" — and
`merge.test.ts:186` asserts it.

`--overwrite`, as approved in ruling 2, discards the destination's
version outright. Same failure, chosen deliberately, and the only path
in the product where a user's own writing could vanish without trace.

Put to Ken with that framing. **His answer: preserve them, the same way
sync does.** `--overwrite` still replaces the task; any displaced body
is written somewhere recoverable and named in the report.

So `mergeTask` is used by `--overwrite` for its displaced-body half
**only** — its field-level last-writer-wins resolution does not apply,
because restore's three modes are deliberately not last-writer-wins.

**Ruling 7, 2026-09-02 — a dangling relationship does not block a
restore.**

BAK-C18 as I wrote it said a relationship whose target is in neither
backup nor destination must fail the restore with nothing written. The
build agent hit that, saw it contradicted the invariants, and escalated
rather than adjudicating — which is what `build-loop.md` asks for.

It was right, and the case was wrong. **P-12** says cross-file
dependency validation is "reported by `doctor` and sync pre-flight as
`inconsistent`, **blocking neither**". **P-11** says leniency keeps
rather than destroys. My wording would have let one stale reference —
from a task deleted months ago on another machine — cost someone their
entire restore.

**Ken's answer: restore the task, report the dangling reference.** The
edge is kept, not stripped: dropping it to leave a tidy tracker is what
P-11 calls "destruction wearing leniency's clothes".

The case has been corrected to match, and the correction is stated in
the case itself so the next reader sees that a case was wrong against
an invariant rather than an invariant bending to a case.

**To revert.** Rulings 1, 2, 4, 5, 6 and 7 are Ken's. Ruling 5 delegates
per-field calls to the agent; those are § 8 decisions and revertible,
the delegation itself is not.
### A94 · A11Y-10 is left uncovered: filter dropdowns have no arrow navigation

**Ticket:** M4.8 follow-up (four unaccounted cases) · **Date:** 2026-09-02 · **Commit:** `6336592`

**The situation.** A11Y-10's first bullet requires each filter
dropdown to be "reachable, open on `Enter`/`Space`, and its options
[to be] arrow-navigable with type-ahead". Measured against the built
app, on `/list`:

- Reachable by `Tab` and opens on `Enter` — both hold.
- Options are reachable by continuing to `Tab`, and activating one
  narrows the result set.
- **Arrow navigation does not exist.** With the Status menu open,
  `ArrowDown`, `ArrowUp`, `Home` and `End` all leave focus on the
  trigger button. Typing a letter does not jump to a matching option.

The cause is `client/ui/Menu.tsx`, the shared popover behind every
`FilterDropdown`: it implements outside-click, `Escape` and item
selection, but no roving focus and no type-ahead. `client/editor/
MentionMenu.tsx` does implement `ArrowDown`, so the gap is specific to
`Menu`, not a house style.

The dropdown's *search box* is a separate thing and does exist, above
`TYPEAHEAD_THRESHOLD` (12) options — that threshold is a deliberate
MSL-19 decision and is not what this bullet is about.

**What had to be decided.** Whether to add roving focus and type-ahead
to `Menu` so A11Y-10 could be claimed.

**Decided.** No. `Menu` is the shared popover behind three surfaces —
`list/FilterDropdown.tsx`, `shell/Header.tsx` and
`task/TaskDetail.tsx` — so giving it
roving focus is a keyboard-interaction model change across all of
them, with its own cases (focus wrap, `Escape` restoring focus to the
trigger, `aria-activedescendant` vs. real focus). No ticket in this run
owns it, and building it inside a coverage-gap ticket is inventing
scope.

**Why not tag it anyway.** Two of the case's three bullets do hold. A
test that walked the options by `Tab` and tagged `@verifies A11Y-10`
would report the gate green while a keyboard user still cannot arrow
through a filter list — the case's own first bullet. `@verifies` has no
partial marker, so a tag would claim all three.

`tests/ui/flow-accessibility.spec.ts` carries a deliberately untagged
test, "A11Y-10 (partial)", which asserts the parts that work (Tab
reachability, `Enter` opens, options apply and narrow the list, the
chip's accessible name is "Remove Status In progress", the count is
announced, and the chip removes by keyboard) **and** asserts the gap
positively: after `ArrowDown`, focus is still on the trigger. That last
assertion inverts the day roving focus lands, which is the signal to
restore the full transcription and the tag.

Mutation-proven: replacing the chip's `aria-label` with a bare
"Remove" turns that test red.

**To revert.** Add roving focus and type-ahead to `Menu`, then replace
the partial test with the full transcription and tag it
`@verifies A11Y-10`.

### A95 · A11Y-39 is left uncovered: the type scale is absolute, so text-only zoom is a no-op

**Ticket:** M4.8 follow-up (four unaccounted cases) · **Date:** 2026-09-02 · **Commit:** `6336592`

**The situation.** A11Y-39 asks that text-only zoom to 200% — the user
agent scaling text while leaving page zoom alone — reflow rather than
clip. Text-only zoom scales the *root* font size; a layout in
`rem`/`em` grows with it, one in absolute `px` does not move.

`client/styles/index.css` sets `html, body { font-size: 14px }`, and
the component tree sizes type with absolute Tailwind arbitrary values
(`text-[13px]`, `text-[12px]`, …). Measured on `/list`: all 233
rendered elements resolve to an absolute px font-size, and forcing
`html { font-size: 200% }` moves the root to 32px while `body` stays at
14px, because body's own absolute rule overrides the inherited value.

**What had to be decided.** Whether to tag A11Y-39, since its three
bullets are all *satisfied* — no text is clipped, nothing becomes
invisible — and whether to convert the type scale to relative units.

**Decided.** Leave it uncovered, and do not convert the type scale.

The bullets are satisfied **vacuously**: text cannot overflow a
fixed-height box when the text never grows. A test asserting "no text
is clipped at 200% text zoom" passes against an app with no text-zoom
support at all, which is the tag-that-cannot-fail this run has found
most often. Passing for the reason the case is trying to prevent is not
coverage.

Converting the scale is a global restyle — every `text-[Npx]`, every
`h-N` on a control sized to its text, and the 123 fixed-height
utilities that would then need to become min-heights. That is a visual
regression surface across every view, owned by no ticket here.

**Why this is a decision and not a known gap alone.** The gap is
recorded in `known-gaps.md` too; what is decided here is the *coverage*
call — that a green test would have been misleading.

`tests/ui/flow-accessibility.spec.ts` carries a deliberately untagged
test, "A11Y-39 (partial)", asserting the cause rather than the
symptom: the root font-size does scale (the positive control, proving
the simulation works) and `body` does not follow. Mutation-proven:
changing body to `font-size: 1rem` turns it red — which is exactly the
day the tag should be added.

**To revert.** Move the type scale to relative units, then replace the
partial test with the real transcription (assert reflow and no
clipping at 200%) and tag it `@verifies A11Y-39`.

### A96 · `.loctt/local/` is excluded from the backup; `state.yaml` travels

**Ticket:** M5.1 · **Date:** 2026-09-02 · **Commit:** (this one)

**The situation.** K17 ruling 5 delegates the state question per field —
"some should be merged, some project counters need to be re-calculated.
case by case, pick the more intuitive option." This is one of those
calls. It was put to Ken as a question and he gave the principle rather
than the answer, so it is an agent decision under his delegation.

**Measured — and I got the count wrong first time.** I wrote "exactly
four things" from a partial grep and committed it. `local/` holds
**five**; the fifth is the crash-recovery journal, whose own doc comment
says "Local only; not shared across machines via git"
(`paths/index.ts:176`). The conclusion held, but a list asserted as
exhaustive and checked afterwards is the failure this run keeps
repeating.

| File | What it is |
|---|---|
| `key-index.yaml` | a **derived cache** of key → id |
| `sync.yaml` | this checkout's git sync state |
| `reconcile.yaml` | an in-flight reconcile |
| `prefix-rename.yaml` | a sentinel for a rename **in progress here** |
| `journal.yaml` | crash-recovery journal for multi-step writes |

**Decided.** `local/` is excluded; `state.yaml` is included.

**Why, and the argument is the codebase's own.** `paths/index.ts:149`
already says why `prefix-rename.yaml` lives there: it "describes an
operation on this checkout, not shared tracker state: publishing a
half-finished rename to the branch would hand the sentinel to every
other clone." A backup carried to another machine is that same act.
Restoring one person's `sync.yaml` onto a colleague's machine points
their tracker at the first person's git remote — a correctness and
privacy failure, not an inconvenience.

`key-index.yaml` is excluded for a different reason: it is **derived**,
so carrying it risks restoring a stale index that disagrees with the
tasks. It must be **rebuilt** from the restored tasks instead, which is
also the reviewer's point that BAK-C9's "the old key still resolves"
could pass via a `key_history` scan while the index is silently wrong.

`state.yaml` is the opposite case and is why the question was worth
asking: `{keys, retired_keys}` are the per-project **allocation
counters**, not a cache and not machine-local. Dropping them leaves a
restored tracker reissuing keys already in use, breaking P-1 invisibly
until the first `task create` after the restore.

**The nuance Ken's "re-calculated" points at.** On `--merge` into a
non-empty tracker the counters must not simply be overwritten by the
backup's — the destination may have allocated further. The intuitive
option, and the one taken: **each project's counter becomes the max of
the two**, so no key is ever reissued from either side. On a bare
restore there is nothing to merge and the backup's counters are used
as-is.

**Two more exclusions, added after review round 2 found them.**

- **`users/<id>/recents.yaml`** — invariant **Q22**: "machine-local and
  gitignored — never published." The obvious implementation (copy the
  user directory, skip `settings.yaml`) ships it and violates Q22 while
  passing every other assertion, so BAK-C16 asserts its **absence after
  restore** rather than describing the rule in prose.
- **`.schema-migration-in-progress`** — restoring it would hand the
  destination a tracker presenting as mid-migration. Same argument as
  `prefix-rename.yaml`.

**And the counter rule is not mine — it already exists.** Review round 2
found `deriveKeyState` (`git/merge.ts:332`), which sync uses and which
does more than this decision first specified: `max(local, incoming,
highest key actually in use + 1)`. A max-of-counters-only rule still
corrupts when **both** counters are stale — hand-edited or restored from
an older backup — because it never looks at the tasks. `retired_keys` is
merged there too (`merge.ts:383`), which matters because it is the
high-water mark that stops a deleted project's keys being reissued while
they are still live in some task's `key_history`.

So restore **calls `deriveKeyState`** rather than implementing a third
key-merge path. Sync solved this; restore is the same problem, and two
paths are how they drift.

**To revert.** Include `local/` in the export and write a bespoke
counter merge instead of calling `deriveKeyState`. Doing so reintroduces
the cross-machine sync-remote leak, the Q22 recents leak, and — on any
tracker whose counters have fallen behind its tasks — reissued keys.

### A97 · The backup's split threshold is 100 MB

**Ticket:** M5.1 · **Date:** 2026-09-02 · **Commit:** (this one)

**The situation.** BAK-C7 requires a tracker above a threshold to split
into numbered parts, and says explicitly that the number is "an agent
call recorded at step 1 with a revert path (as BLK-30's was)" — because
otherwise whatever number the implementer picks satisfies the case by
construction. K17 also lists the threshold among what remains an
agent's call.

**Decided.** `DEFAULT_SPLIT_THRESHOLD_BYTES = 100 * 1024 * 1024`
(`packages/core/src/backup/format.ts`), measured against the bytes
written to a part, and overridable per call via
`ExportBackupOptions.splitThresholdBytes`.

**Why 100 MB.**

- Comfortably under Node's ~512 MB string limit even for a consumer
  that buffers a whole part, which is the failure BAK-C19 names.
- Large enough that an ordinary tracker is one file, so the common case
  keeps the "single portable file" property K17 ruling 1 chose
  attachments in order to preserve.
- A round number a human recognises in a directory listing, which
  matters because BAK-C8 asks the user to notice a part is missing.

The threshold is deliberately a *byte* count of output, not a task
count: one task with a 200 MB attachment is the case that motivates
splitting, and a task-count rule would never fire on it.

**The override exists for tests.** BAK-C7 and BAK-C8 have to force a
split without seeding 100 MB of fixture, and a test that could only
exercise splitting by writing 100 MB would not be written.

**To revert.** Change the constant. Nothing branches on the specific
value; the split logic reads it from one place, and both cases pass
their own value in.

### A98 · A backup from an older schema is refused, not migrated

**Ticket:** M5.1 · **Date:** 2026-09-02 · **Commit:** (this one)

**The situation.** BAK-C21 requires that restoring from an **older**
schema "either migrates or refuses; which one is a decision to record,
not an implementation detail to leave to whoever writes it first."

**Decided.** Refuse, naming both versions and what to do instead.
Nothing is written.

**Why.** The migration framework (`schema/migrate.ts`) operates on a
`.loctt/` **directory** — it takes a backup of the directory, holds a
migration lock, and runs steps that read and write tracker files. A
JSONL backup is not a directory, so "migrate the backup" would mean a
second migration path that reimplements every step against a different
input shape. That is precisely the drift argument BAK-C24 makes about
the merge engine, and this run has already found fifteen capabilities
built twice.

The user has a better route that uses the existing, tested path:
restore with the matching LocTT version and migrate afterwards, or
migrate a copy of the original tracker and re-export. The error names
both versions and says so.

**What this does not cover.** `CURRENT_SCHEMA_VERSION` is 1, so there
is no older version to carry today. The refusal is implemented and
tested, but the test hand-edits a header to v0 and Zod's `min(1)`
rejects it as a malformed header before the version comparison is
reached — so what is proven is "refused, nothing written", not the
specific message. The test says so in a comment. When a v2 lands, that
test should be tightened to assert both versions are named.

**To revert.** Add a migration path that operates on backup records
rather than a directory, and call it instead of throwing. Doing so
creates a second migration implementation whose steps must be kept in
lockstep with the directory one.

### A99 · `SprintKey` is removed, tests and all

**Ticket:** Group G batch 2 (contracts) · **Date:** 2026-09-02 · **Commit:** (this one)

**The situation.** `brands.ts` exported `SprintKey`, a regex validating
dotted sprint keys, with three tests exercising it in
`brands.test.ts`. The Phase 4 audit filed it as dead code alongside
`SlugKey`.

**Measured.** `SlugKey` is alive — `projects.ts:32` uses it, so that
half of the finding is wrong. `SprintKey` has **zero consumers**:
`sprints.ts` imports only `IsoDate`, and sprints are referenced by
**id**, never by key (`sprints.ts:11`, `:49`). There is no field
anywhere for it to validate.

**Decided.** Remove the export and its tests.

**Why the tests are the argument, not an obstacle.** Three green tests
asserted the regex behaves as written. None asserted anything about
LocTT, because nothing calls it — they validate a validator. That is
the shape this project treats most seriously in reverse: a passing test
that makes dead code look maintained.

**Why this is safe.** `@loctt/contracts` is `private: true`, so no
external consumer can be depending on the export.

**To revert.** Restore the `SprintKey` const, its type alias, the
`index.ts` re-export and the `describe("SprintKey")` block. Only do so
alongside a field that actually uses it — a sprint `key` in
`SprintDefSchema` — or it returns to validating nothing.

### A130 · A retired key counter is reclaimed by **prefix**, not by id or slug

**Ticket:** M4.1 (PRU-18) · **Date:** 2026-09-03 · **Commit:** (this one)

**The situation.** PRU-18 requires that re-creating a hard-deleted
project resumes its numbering — "the first task created in it gets
`BACKEND-48`, not `BACKEND-1`". Two sources disagreed about whether
that was already true:

- `contracts/state.ts:13-16` says it is: "Re-creating a project with
  the same key restores numbering from where it left off, avoiding key
  collisions with surviving tasks."
- `projects/manage.ts:216-224` said the opposite, in a comment
  explaining that retired counters "are NOT auto-restored under this
  code path", with recovery left to "an admin recovery script".

The code matched the second. `createProject` called
`initKeyAllocation(state, id, prefix, 1)` — hardcoded 1 — so a
re-created project restarted at 1 and could mint a key that a
surviving task still answers to via `key_history`.

**The problem with the case's own wording.** PRU-18 says
"`state.retired_keys.backend` holds 47", i.e. keyed by slug.
`retired_keys` is keyed by **project ULID**, and a re-created project
gets a *fresh* ULID — so no id-based or slug-based lookup can ever
match. Taking the case literally would mean re-keying `retired_keys`,
a state-schema change affecting sync's `deriveKeyState` merge.

**Decided.** Match on **prefix**, leaving the storage shape alone.
`createProject` scans `retired_keys` for entries whose `prefix` equals
the new project's, takes the **highest** `next_number` among them, and
starts there; the matched entries are removed from `retired_keys` in
the same `saveState` as the new counter.

**Why prefix is the right key.** A task key is `<prefix><number>`, so
the prefix is precisely what decides whether two projects can mint the
same key — regardless of id, slug or name. Two projects that never
shared a prefix cannot collide; two that do, can. Matching on anything
else answers a different question than the one `retired_keys` exists
to answer.

**Why the highest, not the first.** More than one deleted project may
have used the prefix over a tracker's life. The high-water mark is the
only value below which no surviving `key_history` entry can be
shadowed.

**Scope.** Core only, so all three surfaces get it from one place —
`createProject` is called by `apps/cli/src/commands/project.ts:77`,
`apps/mcp/src/tools/project.ts:56` and `server.ts:1539`. No CLI or MCP
change was needed and none was made.

**To revert.** Restore the `startNumber = 1` hardcode in
`createProject` and drop the `retired_keys` write-back. Doing so
returns the tracker to reissuing keys that surviving tasks still
resolve, and re-contradicts `contracts/state.ts`.

### A131 · A partial remap reports the split and refuses to finish the delete

**Ticket:** M4.1 (PRU-34) · **Date:** 2026-09-03 · **Commit:** (this one)

**The situation.** PRU-34 requires that a delete-with-remap failing
partway through 12 tasks "reports the true split: 7 remapped, 5 not,
naming the 5 by key", leaves the project in `projects.yaml`, and
offers a Retry that is safe.

`replayTaskRemap` (`state/journal.ts`) returned `Promise<void>` and
`await writeTask(...)` inside a plain loop, so the first unwritable
file threw out of the loop. The count was lost, the remaining tasks
were never attempted, and the server surfaced whatever the exception
said under `REJECTED_WRITE_NO_RETRY` — which offers no Retry at all.

**Decided.** Three changes:

1. `replayTaskRemap` returns `TaskRemapResult` — `{remapped, skipped,
   failed}` — and **continues past a failed task write**, recording
   `{id, key, reason}`. `skipped` counts tasks needing no change,
   which is what makes a retry provably idempotent.
2. `deleteProject` throws a new `PartialRemapError` when `failed` is
   non-empty, **before** `applyProjectConfigDeletion` and **without**
   clearing the journal entry.
3. The server maps it to a 409 carrying `recovery: {kind: "retry"}`
   and per-key `failures[]`, rather than the non-retryable envelope.

**The return type is additive on purpose.** Nine other call sites
across sprints, labels, milestones and users ignore the result and are
unchanged; only `deleteProject` inspects it. A shared recovery
primitive is the wrong place to change behaviour for every caller at
once.

**`data_state: "saved"`, which reads oddly and is correct.**
`ErrorDataState` is `saved | not_saved | unknown` — there is no
`partially_saved`. Those 7 writes really did land, so `not_saved`
would send the user looking for tasks that have already moved. The
split lives in the message, which names both halves and the affected
keys. Adding a fourth `ErrorDataState` would touch the contract every
surface reads and was out of scope for a test-coverage pass.

**What the test proved that the case did not anticipate.** The journal
entry deliberately survives, so the *next* critical section's recovery
hook replays it and completes the delete. Retry and crash-recovery
therefore reach the same end state, which is what makes offering Retry
honest — but it also means "the project is still present" is a
statement about the moment of failure, not a steady state. The test
asserts the end state rather than which route reached it.

**To revert.** Restore `Promise<void>` and the throwing loop, drop
`PartialRemapError` and the server branch. Doing so returns the user
to a half-migrated tracker described only as a bare failure.

### A132 · PRU-16's "point at Settings" is appended to the shared no-project message

**Ticket:** M4.1 (PRU-16) · **Date:** 2026-09-03 · **Commit:** (this one)

**The situation.** PRU-16's third bullet asks the create modal's block
to point at Settings → Projects "as the place to set a workspace
default so this stops recurring". The first two bullets were already
built (`projectChoice.ts:47`, `CreateTaskModal.tsx:250-266`, `:819-843`).

`NO_PROJECT_MESSAGE` is shared with **NEW-19**, whose third bullet
quotes the existing text.

**Decided.** Append rather than rewrite. The constant now reads
"Pick a project — this workspace has no default. Set one in
Settings → Projects so this stops recurring."

**Why this does not break NEW-19.** NEW-19 quotes its sentence as a
parenthetical example of "naming what's needed and why", not as an
exact-match assertion; the existing sentence is untouched and leads.
Verified: all ten pre-existing `projectChoice` tests stayed green, and
the new PRU-16 test asserts the first sentence still contains "this
workspace has no default".

**To revert.** Drop the appended sentence. PRU-16's third bullet then
has no implementation.

### A133 · PRU-43's filesystem caveat moves from a source comment into the message

**Ticket:** M4.1 (PRU-43) · **Date:** 2026-09-03 · **Commit:** (this one)

**The situation.** PRU-43 requires that a project write hitting state-lock
contention "states that POSIX advisory locks are not reliable on
iCloud/Dropbox/NFS/SMB/OneDrive" and "recommends moving the tracker to
a local disk rather than only offering Retry".

Every one of those facts was already written down — as a **source
comment** on `withStateLock` (`state/lock.ts:162-164`). A grep across
`packages/*/src` and `apps/*/src` found no runtime string naming any of
those filesystems.

**Decided.** Append the caveat and the recommendation to
`StateLockedError`'s message. `recovery` stays `retry`.

**Why not a new recovery kind.** On a local disk the error genuinely is
transient and Retry is the right control; on a sync folder it is not,
and the server cannot tell which it is looking at. Naming both cases in
the message lets the user make the distinction the server cannot.

**Blast radius.** The message is shared by every state-locked write on
every surface, which is the point — the CLI and MCP hit the same lock.
No test asserted the old text (grepped); the 107 `state/` tests and the
16 `server.errors` tests stayed green.

**To revert.** Restore the two-clause message. The caveat returns to
being true, documented, and invisible to the person hitting it.

### A104 · `MenuItem` gained a declared `testId` prop rather than a spread

**Ticket:** M4.1 (PRU-8) · **Date:** 2026-09-03 · **Commit:** (this one)

**The situation.** PRU-8 needs to click a specific user in the header's
switch list. `MenuItem` (`ui/Menu.tsx:98`) destructures exactly
`{children, onSelect, className}` and renders its own `<button>`.

Writing `data-testid={...}` on the call site **type-checks** — JSX
permits any dashed attribute — and then silently never reaches the DOM.
That was caught here only by reading the component; it would otherwise
have surfaced as a locator timeout indistinguishable from a component
that failed to render.

**Decided.** Declare an explicit optional `testId` prop, applied as
`data-testid` on the button. Not a `...rest` spread: a spread on a
menu item invites arbitrary DOM props onto a `role="menuitem"` control
whose ARIA contract the component owns.

**To revert.** Remove the prop and the two `testId` call sites in
`Header.tsx`. PRU-8's switch-target click then has no stable selector.

### K18 · The browser crops, the server compresses — avatars stay 500px

**Date:** 2026-09-03 · **Ken's ruling — an agent may not revert this.**

**The situation.** Three sources disagreed about avatar processing.

- `copyAvatar` (`packages/core/src/users/avatar.ts`) **already**
  validates, honours EXIF orientation, resizes to a longest edge of
  **500px** and re-encodes via `sharp`. Built and working.
- **PRU-13** requires the browser to compress *before* POST, to a
  **256px** bound, and says the reduction is "verifiable from the
  request body size in devtools".
- **K14** ruled that crop-and-compress happens on the way in,
  server-side, **once — not per render**, plus a cropper tool.

So PRU-13 asks for a second pipeline, in a different place, at a
different size, doing what the server already does.

**Put to Ken as three options** — client-side per PRU-13; server-only
with PRU-13 reworded; or split. **His answer: the split, at 500px.**

**What that means concretely.**

1. **The browser crops.** The cropper produces a crop rectangle and a
   local preview. This is the half only the client can do, because it
   is the user choosing the framing (K14 point 3).
2. **The server compresses.** `copyAvatar` keeps ownership of the
   stored bytes: validation, EXIF, resize to **500px** longest edge,
   re-encode. One pipeline decides what lands on disk.
3. **500px, not 256.** The bound that exists stays. PRU-13's 256 is the
   number that is wrong.

**Why this over the alternatives.** A cropper makes client-side
*cropping* mandatory regardless, so the only question was whether to
duplicate the *compression* too. Two pipelines at two sizes is a pair
that drifts, and the server must validate anyway — a hostile client can
POST whatever it likes, so client compression can never be the
guarantee. This keeps exactly one place that decides what is stored.

**Consequence for the case.** PRU-13's second bullet — "the uploaded
payload is at most 256×256 … and is materially smaller than 2.1 MB" —
describes the client-side pipeline this ruling declines, and **must be
reworded by Ken**; an agent may not edit `docs/dev/ui-test-cases/`.
Its other three bullets (preview renders from the crop, the stored file
lands at `users/<id>/avatar.<ext>` with a matching extension recorded
in `profile.yaml`, and the avatar appears in the header, list and
detail) all hold as written and are buildable now.

**To revert.** Ken's, not an agent's.

### A105 · The project list column is shown/hidden by the active project scope

**Ticket:** M4.1 (PRU-3) · **Date:** 2026-09-04 · **Commit:** (this one)

**The situation.** PRU-3 requires the `project` list column to appear in
"all projects" mode and hide when exactly one project is scoped — and to
do so without permanently mutating the user's saved `list_columns`.

`resolveColumns` (`list/columns.ts`) took only `settings` and always
included `project` from `ALL_COLUMNS`; nothing consulted the active
`?project=` filter.

**Decided.** `resolveColumns` gained an optional `scope:
{activeProjectCount}`. In `ListView` it is passed
`search.project?.length ?? 0`. Exactly one scoped project drops the
`project` column; zero or several (all-projects) ensures it is present —
inserting it after `key` even when the user's saved order omits it,
because PRU-3 says it must "appear without the user having to add it via
column settings". The result is derived per render; the saved order is
never written back, so a scope toggle cannot lose it.

**Why the count, not the ids.** The only thing that decides the column
is "is the view constant in project?" — i.e. exactly one — so the count
is the whole input. Passing ids would couple column resolution to
identity it does not use.

**To revert.** Drop the `scope` parameter and the `applyProjectScope`
step, and the `activeProjectCount` argument in `ListView`. The column
then shows in every scope, constant and uninformative under a single
project.

### A106 · The create modal pre-fills the active switcher project, above the resolved default

**Ticket:** M4.1 (PRU-4) · **Date:** 2026-09-04 · **Commit:** (this one)

**The situation.** PRU-4 requires the create modal to pre-select the
top-bar switcher's project (the single `?project=` scope). The modal
seeded only from `effective_default` (the per-user / workspace default
core computes), so a user scoped to Web still opened the modal on their
default project.

**Decided.** `resolveProjectChoice` gained an optional `activeProjectId`
that, when it names a still-selectable project and more than one project
exists, returns `{kind: "prefilled"}` for it — ranking **above**
`effective_default` but below an explicit in-modal choice (protected by
the form's seed-once guard). The modal reads the scope route-agnostically
via `useRouterState` (it is mounted app-wide, so `useSearch({from:
"/list"})` would throw off `/list`), normalising `project` from either
the validated `string[]` or the raw comma-joined string.

**Why above the default, below explicit.** The switcher is the strongest
standing signal of where the user means to file; an explicit pick inside
the modal is stronger still and must win (NEW-14). Archived or unknown
scopes fall through to the existing chain rather than pre-filling a
destination the picker cannot show (NEW-16/17).

**To revert.** Drop the third argument to `resolveProjectChoice` and the
`activeProject` read in `CreateTaskModal`. The modal then ignores the
switcher and opens on `effective_default` alone.

### A107 · The sidebar projects group is searchable, pins "All projects", and truncates with "+N more"

**Ticket:** M4.1 (PRU-21) · **Date:** 2026-09-04 · **Commit:** (this one)

**The situation.** PRU-21 requires a 30-project switcher to stay usable:
a type-to-filter box, "All projects" reachable without scrolling, and
the group truncating with a count rather than pushing the rest of the
sidebar off-screen. The sidebar (which *is* the switcher — there is no
separate top-bar control; PRU-1/2/3 are driven by the URL) rendered
every project as a flat, unbounded list with no "All projects" item.

**Decided.** `ProjectsGroup` now renders a pinned "All projects" row
(active when nothing is scoped, clears the `project` facet), a
type-to-filter `<input>` shown past `PROJECT_SEARCH_THRESHOLD` (8)
filtering on **name and prefix**, and — when not searching — caps the
list at `PROJECT_COLLAPSE_LIMIT` (8) behind a "+N more" toggle. Search
and expand state are UI-local; they never touch the URL, so filtering
the switcher does not change what the list is scoped to until a project
is clicked.

**Why the sidebar, not a new top-bar switcher.** The projects group is
already the project-selection surface the covered PRU-1/2 cases exercise
(via `?project=`). Adding a second switcher would be scope the case does
not ask for.

**To revert.** Restore the flat `items.map(...)` render and drop the
"All projects" row, the search input and the "+N more" toggle. A
30-project tracker then scrolls the sidebar unboundedly.

### A108 · The header marks an archived current user and prompts a switch

**Ticket:** M4.1 (PRU-24) · **Date:** 2026-09-04 · **Commit:** (this one)

**The situation.** PRU-24: the current user can be archived while the UI
is open, and the header must stop presenting them as a normal active
user — an "(archived)" marker plus a prompt to switch. The data was
already available (`getCurrentUser` returns the archived profile
unchanged) but nothing consumed it.

**Decided.** `UserMenu` computes `currentArchived` from
`currentUser.archived` and renders: a dashed warning ring on the header
avatar, an "(archived)" marker beside the current-user name, and a
`role="alert"` prompt pointing at the switch list below it. Switching
clears the state through the existing `useSwitchUser` invalidation, with
no reload. `identityUnknown` takes precedence — an unknown identity is
not an archived one.

**On the scenario's reachability.** Core refuses to archive the *active*
user (`assertNotActiveUser`), so the reachable route to "current user is
archived" is switch-away → archive → switch-back, after which
`state.yaml`'s current points at an archived profile. The UI behaviour
PRU-24 specifies is faithful to that end state; the spec sets it up that
way rather than by the doc's literal single `archive` call.

**To revert.** Remove `currentArchived` and the three rendered pieces in
`Header.tsx`. Writes then still succeed with the archived actor (core's
behaviour), but the UI gives no acknowledgement — the silent-failure
PRU-24 forbids.

### A109 · The archived-reference guard message offers both next actions

**Ticket:** M4.1 (PRU-41) · **Date:** 2026-09-04 · **Commit:** (this one)

**The situation.** PRU-41 requires the archived-reference rejection to
offer "unarchive them, or pick a different assignee". The guard's scalar
message said only "unarchive it first". The `recovery` kinds
(`retry|reload|command|none`) cannot represent a two-way "unarchive or
choose", and adding a kind is a contract change touching every surface.

**Decided.** The message itself now reads `…; unarchive it first, or
choose a different <field>` (`config/archived-guard.ts`), matching the
remap-target messages the sprint/label/project/user/milestone managers
already emit. `recovery` stays `{kind: "none"}` — retrying the same
archived value fails identically (ERR-15), so the second action lives in
the message, not a control. Because the message is core's and all three
surfaces (detail, create, bulk) surface it verbatim, "identical text
across surfaces" holds by construction — and for an *archived* user the
name resolves via `displayNameFor(aux.users, …)`, so no ULID leaks.

**Layer.** Core, so all surfaces get it from one place. No CLI/MCP doc
quoted the old wording, so no reference-doc change was needed.

**To revert.** Restore `; unarchive it first` in the scalar branch of
`assertNotArchivedReferences`. PRU-41's "offers the next action" is then
unmet on every surface.

### A110 · PRU-25 and PRU-42 declined — the delete path cannot produce their precondition

**Ticket:** M4.1 (PRU-25, PRU-42) · **Date:** 2026-09-04 · **Commit:** (this one)

**The situation.** Both cases assert against a "(deleted user)" degraded
form on tasks that still carry a hard-deleted user's ULID. PRU-25 needs
it in the list's reporter cell; PRU-42's final bullet needs the 34
affected tasks to render it after a delete.

**Why declined, not built.** `deleteUser` (`users/lifecycle.ts`) refuses
to hard-delete a referenced user without `--remap-to`/`--unassign`, on
all three surfaces — so after a delete **no task carries the deleted
ULID**, and the "(deleted user)" state is unreachable through the
supported path. PRU-25 additionally asserts against a **reporter list
column and a reporter filter facet that do not exist**. The coverage
gate is per-case and binary; tagging either would assert a weaker claim
than the prose (silently dropping the unsatisfiable bullet), which the
build loop forbids. Both are written up in `known-gaps.md`. The earlier
"P-4 forbids a truncated ULID" framing was **corrected**: the app
already shows `id.slice(-6)` as a live-user disambiguation hint (PRU-23,
covered), so that is not the blocker — reachability and missing surfaces
are.

**To revert.** N/A — nothing was built to revert. Reversing the decline
requires Ken to rule on the delete semantics and list surfaces (see
`known-gaps.md`).

### K19 · Explicit list_columns wins over PRU-3's auto-inserted project column

**Date:** 2026-09-04 · **Ken's ruling — an agent may not revert this.**

**The conflict, surfaced by building PRU-3.** LST-6: "only the columns
listed in `list_columns` render, in that order." PRU-3: "switching to
All projects makes the project column appear without the user having to
add it via column settings." The app treats *no project filter* as
all-projects mode (`Sidebar.tsx:440`, "All projects is active exactly
when nothing is scoped"), so a user with `list_columns: [title, key]`
on a fresh `/list` got a project column auto-inserted (PRU-3) that
LST-6 says must not be there. LST-6 failed deterministically once PRU-3
shipped.

**Put to Ken as a product decision, not a mechanism.** His steer:
what makes the robust product call.

**Ruling: an explicit `list_columns` is honored verbatim; the
auto-insert applies only to the default column set.**

The governing principle is that a deliberate user choice is never
silently overridden. Auto-showing the project column is a helpful
default for a user who has *not* customised their columns — exactly
PRU-3's stated case ("without the user having to add it via column
settings"). The moment a user has set `list_columns`, the help becomes
interference. A single-project scope still *hides* the column (it is
constant and carries no information), but all-projects mode no longer
*inserts* it over an explicit list.

**Both cases hold as written, neither reworded.** PRU-3's own test uses
the default column set, so it is unaffected. LST-6 sets an explicit
subset and is now honored. PRU-3's spirit — a user who hasn't touched
columns can tell same-titled rows apart — survives, because the key
column already carries the prefix (`BACKEND-14` vs `WEB-3`).

**Rejected alternatives.** (b) auto-insert always, overriding the
explicit list — would make LST-6 false and needs it reworded; declined
because it overrides a deliberate choice. (c) distinguish "no filter
yet" from "explicitly picked All projects" via new URL state — declined
because those are the same view to the user, and adding user-visible
state to resolve an internal ambiguity is engineering avoiding the
decision.

**To revert.** Ken's, not an agent's.

### A111 · A label partial-remap reports the split; the other three siblings still throw

**Ticket:** M4.3 (MSL-33) · **Date:** 2026-09-04

**The situation.** MSL-33 requires a label delete-with-remap that fails
partway to "report honestly": how many tasks were updated, how many
failed (by key), whether the label entry was removed, and a retry path
— *not* a blanket abort. This is the same shape PRU-34/A131 gave the
project delete.

But two days earlier, the PRU-34 fix's collecting `replayTaskRemap` had
silently regressed four sibling deletes (sprints, LABELS, users,
milestones): they discarded the result and deleted their config anyway,
stranding tasks on a failed write (known-gaps, 2026-09-04). That was
fixed by routing all four through `replayTaskRemapStrict`, which throws
on any failed task. So labels were, correctly, on the strict throw —
and MSL-33 now needs the opposite for labels specifically.

**Decided.** Move **labels only** back to the reporting path, mirroring
`deleteProject`:

1. `deleteLabel`'s remap path calls the collecting `replayTaskRemap`,
   inspects `.failed`, and throws `PartialRemapError` (before
   `applyLabelConfigDeletion`, without clearing the journal) when
   non-empty. The label stays in `labels.yaml`; a retry is safe.
2. `PartialRemapError` gained an optional `noun` parameter
   (default `"project"`, so the existing call site and its test are
   untouched); the label path passes `"label"` so the message reads
   "The label has NOT been deleted".
3. The web route `handleDeleteLabel` gained a `PartialRemapError`
   branch → 409 with `recovery: {kind: "retry"}` and per-key
   `failures[]`, identical to `handleDeleteProject`.
4. **Sprints, users and milestones stay on `replayTaskRemapStrict`** —
   they have no "report the split" case, and weakening them would
   reintroduce the very stranding the 2026-09-04 fix closed. The
   guard test `aborts and keeps the sprint when a task rewrite fails
   partway` stays green and was re-run.

**Found in passing — the MCP surface swallowed the report.**
`PartialRemapError extends LocttError` directly, not
`ProjectError`/`LabelError`, so it was **not** in MCP's
`isKnownDomainError` allow-list — an agent's `delete_label` (or
`delete_project`) partial remap was rethrown as an opaque server fault
instead of surfacing the honest split. Added `PartialRemapError` to the
allow-list so both surface their message. This also closes the
pre-existing project-side gap (PRU-34 never reached MCP cleanly). The
classification is only observable at that layer (over stdio the SDK
renders a rethrow as `isError:true` too), so it is asserted in
`stale-body-error.test.ts` beside the K10 case, not end-to-end.

**Mutation-proven.** Core: reverting `deleteLabel` to a blanket
`LabelError` reddens the new `manage.test.ts` MSL-33 test; deleting the
config before the failure check reddens its "label still in yaml" half;
the sprint guard stays green throughout. Web: removing the route branch
drops the 409 to a 500. MCP: removing `PartialRemapError` from the
allow-list reddens the classification test.

**To revert.** Return `deleteLabel` to `replayTaskRemapStrict` and its
recovery handler likewise, drop the label branch in `handleDeleteLabel`,
remove `PartialRemapError` from `isKnownDomainError`, and drop the
`noun` parameter (the message reverts to hardcoded "project"). Doing so
returns a partial label remap to a bare abort with no honest split and
no retry, failing MSL-33.

### A115 · A dropped upload connection is framed as an incomplete, retryable failure — not a bare `Failed to fetch`

**Ticket:** M2.5b (REL-47) · **Date:** 2026-09-04 · **Commit:** <pending>

**The situation.** REL-47 kills the connection mid-upload of a large
file and requires: no partial file, no stray file under
`attachments/`, and a message that "names the file, says the upload did
not complete, and offers retry." The server half was already atomic —
`multipart.ts` writes to an OS temp dir and the route renames into
`attachments/` only on success, removing the temp dir in a `finally`
(proven by ERR-24's server test). But the **client** half was missing:
a dropped connection makes `postFile`'s `fetch` reject with a bare
`TypeError` ("Failed to fetch"), which reached the queue row verbatim —
no data-state, no recovery — and the failed-upload row had **no retry
control** at all (retry existed only for the 409 conflict case).

**What had to be decided.** How should a network-dropped upload be
reported to the panel, and does it get a retry or a reload?

**Options considered.**
- *Leave the raw `TypeError`.* Zero code, but fails REL-47 on three of
  four bullets (no file name, no "did not complete", no retry).
- *Treat it as the P4 "unknown" write case (reload, not retry).* Honest
  for a write whose outcome is genuinely unknown — but the upload route
  is atomic, so a dropped connection means the file was demonstrably
  **not** attached. Telling the user to reload-and-check would be
  needlessly alarming, and retry cannot duplicate a write that never
  landed (ERR-24 proves the retry lands exactly once).
- *Frame it as `not_saved` + `retry` and add a retry control.* Matches
  REL-47's bullets exactly and is safe given the atomic route.

**Decided.** `postFile` catches the network rejection and throws an
`ApiError` with `envelope: { code: "unknown", message: "the upload did
not complete", data_state: "not_saved", recovery: { kind: "retry" } }`;
the panel's failed-upload row keeps the `File`, phrases the message to
name the file and say it did not complete, and renders a `Retry` button
(absent only for the oversize refusal, which is caught before any bytes
are sent and has no File to resend).

**Why.** The atomic upload route makes the outcome knowable as "not
attached", so P4's rare "unknown" exception does not apply — the
stronger, truthful claim is that the file was not attached and retry is
safe. `code: "unknown"` (not a new code) because `ErrorCode` has no
`upload_incomplete` member and the network-failure path in `apiRequest`
already uses `"unknown"` for the same class of failure.

**To revert.** In `apps/web/src/client/api/client.ts`, drop the
`try/catch` around `postFile`'s `fetch` (return to letting the
`TypeError` propagate). In
`apps/web/src/client/attachments/AttachmentsPanel.tsx`, drop the
`incomplete`/`message` framing in `attempt`'s catch and the
`attachment-retry-upload` button in the failed-row branch. Doing so
returns a dropped upload to a bare "Failed to fetch" with no retry,
failing REL-47's third bullet.

### A116 · The migrate endpoint fails fast when the migration lock is held, instead of blocking or no-op-lying

**Ticket:** M4.3 (SET-38) · **Date:** 2026-09-04 · **Commit:** <pending>

**The situation.** SET-38: `loctt migrate` is running in a terminal
(holding the migration lock); the UI's Migrate must "fail fast rather
than blocking the UI for the 5-minute stale timeout", say a migration
is already running elsewhere, write nothing, and — once the CLI
finishes — show the schema as current on reload. Measured against the
built server: `POST /api/migrate` with the lock held returned **200
`{from:1,to:1,steps:[]}` in 8 ms** — because at `CURRENT_SCHEMA_VERSION
=== 1` `migrateToCurrent` takes its already-current no-op fast path
*before* it ever contends for the lock. So the UI's attempt neither
blocked nor detected the concurrent migration; it reported a success it
never performed.

**What had to be decided.** Should the web migrate route detect a held
lock and refuse, or leave `migrateToCurrent` to handle it?

**Options considered.**
- *Leave it.* At v1 the no-op path means the lock is never consulted;
  at a future v2 the call would block on the lock for up to the 5-minute
  stale window. Both contradict SET-38's "fail fast" and "say a
  migration is running".
- *Check `isMigrationLocked` in `handleMigrate` and 409 if held.*
  `isMigrationLocked` exists in core for exactly this ("writers that
  want to fail fast rather than block when a migration is in progress").
  Observable at every version, including v1.

**Decided.** `handleMigrate` calls `isMigrationLocked(locttDir)` up
front and, if held, returns 409 with `code: "conflict"`, `data_state:
"not_saved"`, `recovery: { kind: "reload" }` and a message naming the
concurrent process and the wait-then-reload action — before calling
`migrateToCurrent` at all.

**Why.** A held lock means another process is mid-migration (or
crashed); the honest answer is "someone else is migrating, I wrote
nothing, wait and reload", regardless of what version this build reads
on disk. This is the reachable, version-independent half of SET-38.

**Honest limit — the UI Migrate button is unreachable at v1.** SET-38
is a UI case, but the Migrate control renders only for schema status
`outdated` (SET-30), and `outdated` is unreachable while
`CURRENT_SCHEMA_VERSION === 1` (a `.schema-version` below 1 is rejected
as `unknown`, not `outdated` — see the NEW-20/NEW-41 notes in
`known-gaps.md`). So the fail-fast is verified where it is
reachable — the **API**, in
`apps/web/src/server/server.migrate.test.ts` (`@verifies SET-38`),
which holds the real lock via `withMigrationLock` and asserts the 409,
the message, `not_saved`, an unchanged version file, and a positive
control that a post-release migrate succeeds. The end-to-end UI banner
path (click Migrate while the CLI runs) needs a v2 schema to make the
button appear, exactly like SET-31/37.

**To revert.** Remove the `isMigrationLocked` guard at the top of
`handleMigrate` in `apps/web/src/server/server.ts` (and its import), and
delete the SET-38 test in `server.migrate.test.ts`. Doing so returns a
migrate-with-lock-held to a no-op 200 at v1 (and a lock-blocked call at
a future v2), failing SET-38.

### A117 · ERR-44's "Esc for toasts" is read as illustrative; the toast's keyboard path is its tab-stop dismiss control

**Ticket:** M4 (ERR-44) · **Date:** 2026-09-04 · **Commit:** <pending>

**The situation.** ERR-44 requires error surfaces to be
keyboard-reachable and announced, and parenthesises the keyboard
dismissal path as "(`Esc` for toasts and dialogs)". The toast component
(`ui/Toast.tsx`) has a focusable `toast-dismiss` button and a
`toast-action` button in the natural tab order, `role="status"` +
`aria-live="polite"` — but **no `Esc` handler**. Dialogs (`ui/Modal.tsx`)
do close on `Esc`.

**What had to be decided.** Does ERR-44 require adding `Esc`-to-dismiss
to toasts, or is the existing tab-stop dismissal a compliant keyboard
path?

**Options considered.**
- *Add a global `Esc`-dismisses-toast handler.* Matches ERR-44's
  parenthetical literally, but a global `Esc` for a non-modal toast is
  in real tension with A11Y-2's "`Esc` closes the topmost dismissible
  **layer**, one at a time" — a toast shown while a modal is open must
  not let `Esc` eat the toast before the modal. Building it correctly
  (yield to modals/dropdowns) is non-trivial and risks contradicting the
  Esc-layering contract.
- *Treat the tab-stop dismiss button as the keyboard path.* The
  authoritative toast contract in `flow-accessibility.md` (the A11Y-24
  toast case) states the toast is "reachable by keyboard without hunting
  — a documented key **or a tab stop that appears in the natural
  order**." So a tab stop is contract-compliant, and ERR-44's
  parenthetical is the compressed illustration in an error-focused case.

**Decided.** ERR-44 is verified against the tab-stop reading for toasts
(focus `toast-dismiss`, activate with the keyboard) plus `Esc` for the
dialog. No `Esc`-for-toasts handler is added.

**Why.** The detailed toast contract (flow-accessibility.md) is the
authority on toast keyboard behaviour and explicitly accepts a tab stop;
adding a global toast-`Esc` would risk contradicting A11Y-2's
Esc-layering. Where two docs appear to disagree, the specific one
governs its surface, and no behaviour is built that a case does not
unambiguously require.

**To revert.** If Ken rules that toasts must dismiss on `Esc`: add a
keydown handler to the `ToastProvider`/`ToastViewport` in
`ui/Toast.tsx` that dismisses the most recent toast on `Esc` **only
when no modal/dropdown layer is open** (respecting A11Y-2), and change
the ERR-44 test in `flow-task-create.spec.ts` to press `Escape` for the
toast rather than activating `toast-dismiss`.

### A118 · A broken saved view is represented as a `broken` sibling collection, listed on every surface, and clicking it in the UI shows the parse error rather than falling back

**Ticket:** VUE-22 · **Date:** 2026-09-04 · **Commit:** (this one)

**The situation.** `parseQueriesConfig`
(`packages/core/src/config/queries.ts`) mapped every entry in
`queries.yaml` and threw `QueriesConfigError` on the first `parseQuery`
failure. `handleListTasks` → `loadOptionalConfigs` → `loadQueriesConfig`
did not catch it, so one hand-broken entry 500'd `GET /api/tasks` for a
healthy view beside it and for no view at all (known-gaps: "One
unparseable saved view makes `GET /api/tasks` fail for *every* view").
VUE-22 wants the opposite: "the sidebar still lists the view, marked as
broken", "clicking it shows the parse error with the offending position",
"the advanced editor opens pre-populated with the broken query", "other
views and the rest of the sidebar render normally". North-star principle
5 (per-element degradation — DRAFT, awaiting Ken) names this exactly.

**What had to be decided.** How is a broken view represented in the
contract and on each surface, and specifically: (a) where does the
broken marker live in `QueriesConfig`; (b) does the CLI/MCP list broken
views by default or behind a flag; (c) what does the UI show when a
broken view is *clicked*.

**Options considered.**
- *(a) Represent broken entries in-band* — widen `SavedQuery` with an
  optional `broken`/`error` and keep them in `queries`. Cost: every
  existing consumer that iterates `queries` to run them must now filter
  out broken ones or risk handing an unparseable query to the evaluator;
  the healthy path is no longer byte-identical.
- *(a) A sibling `broken` collection* — `queries` stays all-good
  `SavedQuery[]`, broken entries go in a new optional
  `QueriesConfig.broken: BrokenSavedQuery[]`. Cost: a consumer that wants
  to *show* broken views has to read a second field; but no runnable-path
  consumer can accidentally execute a broken query.
- *(b) CLI/MCP behind a `--broken` flag* vs *listed by default, marked*.
  A flag hides a data-integrity problem behind a discovery step; an agent
  or user told "you have 2 views" over a file that holds 3 may recreate
  the third over the file that still holds it.
- *(c) On click, treat broken like missing* (XS-28 fallback: widen to
  unfiltered + `missing_view` banner) vs *a distinct `broken_view`
  error state carrying the parse error, position, and raw query*.

**Decided.** (a) A sibling `broken` collection: `QueriesConfig.broken?:
BrokenSavedQuery[]`, omitted when none are broken, never serialized to
disk. (b) CLI (`loctt views`) and MCP (`list_views`) list broken views
**by default, marked broken** with the parser's message (MCP also carries
`broken:true`/`error`/`position`). (c) The list route returns a non-fatal
`broken_view` field (sibling of `missing_view`/`warnings`) with `id`,
`name`, `query`, `error`, `position`; the sidebar lists broken views
marked broken, clicking one shows the error+position and a "Fix this
view" button that opens the advanced editor pre-populated via a new
`?edit=1` list-search param. A whole-file YAML failure, a missing
`queries` array/id/name/query, or a duplicate id stays object-fatal and
still throws.

**Why.** Principle 5 (per-element degradation) and principle 3 (strict
parity). The sibling collection keeps the runnable path from ever seeing
an unparseable query while still surfacing the fault — the safest reading
of principle 1 (never silently corrupt: a broken entry is preserved and
never written back). Listing by default follows the MCP tool's own
existing reasoning ("this is not the same as having none — do not create
or overwrite views until this file can be read"). A distinct `broken_view`
state (not the `missing_view` fallback) is what VUE-22's "shows the parse
error … rather than an empty list" requires — a widened list would read
as a legitimate result.

**To revert.** Remove `BrokenSavedQuery`/`BrokenSavedQuerySchema` and
`QueriesConfig.broken` from `packages/contracts/src/query.ts` (+ index
exports); restore the throw in `parseQueriesConfig`
(`packages/core/src/config/queries.ts`) — the pre-change body is one
`.map` that threw `QueriesConfigError` on a bad `parseQuery`; drop the
`broken`/`broken_view` handling in `apps/web/src/server/server.ts`
(`handleListTasks`), the broken-view rows in
`apps/web/src/client/shell/Sidebar.tsx` and
`apps/web/src/client/settings/SavedViewsPanel.tsx`, the `broken_view`
banner + `edit` param in `apps/web/src/client/list/ListView.tsx` /
`FilterBar.tsx` / `router/listSearch.ts`, and the broken-view lines in
`apps/cli/src/commands/views.ts` and `apps/mcp/src/tools/views.ts`.
Tests: the `per-entry degradation (VUE-22)` block in
`packages/core/src/config/queries.test.ts` and the VUE-22/26/27 specs in
`tests/ui/flow-list.spec.ts`.

### K20 · Avatar upload: 500px, confirmed against PRU-13

**Date:** 2026-09-04 · **Ken's ruling — an agent may not revert this.**

K18 set avatar processing at 500px (browser crops, server compresses).
PRU-13's spec still says "at most 256×256". Ken confirmed: **500px, and
PRU-13's 256 bullet is the one to reword** — the case is otherwise
correct (preview from the crop, stored file at users/<id>/avatar.<ext>
recorded in profile.yaml, avatar shown in header/list/detail).

Once PRU-13's second bullet is reworded from 256 to 500 (Ken's to edit;
agents may not touch docs/dev/ui-test-cases/), the seven avatar cases
(PRU-13, 27, 28, 29, 31, 39, 40) are buildable: the cropper UI + the
existing copyAvatar 500px server pipeline.

**To revert.** Ken's, not an agent's.

### K21 · A dangling user reference degrades gracefully, but delete never creates one

**Date:** 2026-09-04 · **Ken's ruling — an agent may not revert this.**

PRU-25 and PRU-42 assume a task can reference a hard-deleted user's
ULID (the "(deleted user)" state). `deleteUser` forbids this: it
requires `--remap-to` or `--unassign` when the user has references. So
the supported delete path never produces a dangling reference.

**Ken's ruling — both halves:**

1. **The guard stays absolute.** Delete always resolves references
   first; there is NO `--force` that skips it. You cannot casually
   orphan a reference through a LocTT command.
2. **The degradation is still built.** A dangling reference CAN arise
   out-of-band — a hand-edited `users.yaml`, a `git pull` that drops a
   user, a restore of tasks referencing a since-deleted user. Files are
   canonical and hand-editable (north-star principle 5), so the UI must
   degrade such a reference to the "(deleted user)" form (PRU-25) rather
   than breaking the row, and the delete confirmation must show the
   reference count and offer archive (PRU-42).

So PRU-25/42 are buildable, testing the degradation of an out-of-band
dangling reference — NOT one produced by delete (which cannot happen).
The test seeds the dangling state by hand-editing, exactly as the real
world would reach it.

This is the "external / missing reference" corruption kind the Phase 7
framework will formalize; PRU-25/42 are an early instance of it.

**To revert.** Ken's, not an agent's.
### A121 · Per-field git reconciliation: a conflict-detail model, and both-sides-same-field now opens the panel instead of silently merging

**Ticket:** reconcile batch (GIT-5..38 conflict cases) · **Date:** 2026-09-04 · **Commit:** (this one)

**The situation.** `three-way.ts` classified whole files; `merge.ts`
`mergeTask` resolved task frontmatter by last-write-wins (M2) and, for a
field history could not explain, wrote a `merge_resolved` audit entry and
picked the newer whole-record. `GitConflictError` carried only file
*paths*. So the conflict-resolution cases (GIT-6/7/11/13/14 …) had no
data model and no engine: a same-field two-sided edit was auto-resolved
silently, which GIT-6 explicitly forbids ("Sync stops and opens the
reconciliation panel instead of picking a winner").

**What was decided (and built).**

1. **A conflict-DETAIL model** (`packages/contracts/src/reconcile.ts`):
   `TaskConflictField` (task, field, `fieldLabel`, `kind` of
   scalar/enum/relationship_parent, `local`/`remote` `ConflictValue` with
   an optional `drift` marker, and enum/task-picker `options`),
   `ReconcilePlan` (conflicts + `autoMerged`), `ReconcileDecision`. The
   sentinel (`ReconcileStateSchema`) gained optional `decisions` and
   `applied` — the journal that makes the panel survive reload (GIT-26)
   and a partial Apply resumable (GIT-32).

2. **A REPORTING variant of the merge**
   (`git/reconcile-plan.ts` `computeTaskConflicts` /
   `computeReconcilePlan`). It reuses the merge's own classification —
   different-key → union (GIT-5), identical-both-sides → converged
   (GIT-17), same-key-different-value → conflict (GIT-6/11) — but a field
   is a conflict **only when both sides moved from the last-synced base**.
   A one-sided edit (local === base, or remote === base) is *not* a
   conflict and still merges silently, exactly as `planSync`/`mergeTask`
   would resolve it. Without a base (first sync, history rewritten) every
   divergence is treated as a conflict, because nothing can prove it was
   one-sided.

3. **Write-back** (`git/reconcile-apply.ts`, `git/reconcile-session.ts`):
   applies per-field picks grouped by task, reports the honest split
   (GIT-12/32/37), journals applied ids and keeps the sentinel on partial
   failure, and completes the original sync/publish on success. A
   `parent` resolution goes through `linkTask`/`unlinkTask` so the inverse
   `child` edge stays consistent (GIT-13, P-12) — never a hand-written
   edge.

4. **Surfaces**: `POST/GET /api/git/reconcile[/decisions|/apply|/abandon]`,
   the panel (`ReconcilePanel.tsx`), CLI `loctt git reconcile
   <status|apply|abandon>`, and MCP `get_reconcile_status` + reconcile-
   needed reporting on publish/sync.

**The behaviour change worth flagging.** Before this, a sync where both
sides set the same field to different values (including two hand-edits
with no history) resolved silently by last-write-wins with a
`merge_resolved` entry. It now **opens reconciliation**. Two tests in
`publish-sync.test.ts` asserted the old auto-merge ("names the conflicting
paths in the error", "writes the merge_resolved entry to history") — those
were green tests encoding the pre-reconciliation behaviour that GIT-6/11
override, and were rewritten to assert `GitReconcileNeededError` with the
conflicting field named. The `merge_resolved` fallback still runs for
genuinely one-sided edits (only one side moved the field), which is what
"keeps both sides' structured edits to different fields" exercises.

**Why (north-star).** Principle 1 (never lose or silently corrupt data)
and principle 5 (per-element degradation): a two-sided disagreement is the
user's to settle, not the merge's to guess. The one-sided case keeps M2's
convergence guarantee. Reused rather than rebuilt: `mergeTask`'s
classification, `planSync`'s three-way base, the `link`/`unlink`
relationship path.

**To revert.** Remove the reconcile-needed throw in `pullFromLocttBranch`
/ `publish` (the `computeReconcilePlan` block + `detectPublishReconcile`)
and the `GitReconcileNeededError`; sync/publish fall back to
`mergeTask`'s silent last-write-wins for two-sided field conflicts, and
the two rewritten tests revert to asserting `result.merged === 1` /
the `merge_resolved` entry. The contracts model, panel, and CLI/MCP
surfaces become dead but harmless. Reverting loses GIT-6/7/11/12/13/14/
15/17/26/31/32/37.

### A122 · GIT-14: keep-remote on a value referencing a deleted local status is allowed, with a drift warning

**Ticket:** reconcile batch (GIT-14) · **Date:** 2026-09-04 · **Commit:** (this one)

**The situation.** GIT-14: remote's `status` is `in_review`, deleted from
local `workflow.yaml`. The scope doc flagged this as the one candidate to
escalate — refuse keep-remote until the status is re-added, or allow it
with a warning?

**Decided.** The **case settles it**: "Choosing keep-remote is allowed
but warns that the task will render with a drift marker and appear in
Diagnostics", and "pick-value offers only the statuses that actually
exist locally". Built to that — not escalated, because it is a stated
requirement, not a new principle. `ConflictValue.drift` carries the
reason; the remote side renders the raw key with a `⚠ drift` marker
(never blank); keep-remote is selectable and shows a warning that the
task will appear in Diagnostics; the pick-value `options` exclude the
drift value. This is consistent with P-11/P-12's existing treatment of a
dangling reference (report as `inconsistent`, block nothing) rather than
the refuse-until-fixed reading.

**To revert.** Make the drift branch in `computeReconcilePlan` refuse
keep-remote (mark the conflict unresolvable when `remote.drift` is set);
the panel would then disable the keep-remote button on a drift row.
Reverting contradicts GIT-14's stated behaviour.

### K22 · P-4 softens for error states: a dangling reference may show its truncated ULID

**Date:** 2026-09-05 · **Ken's ruling — an agent may not revert this.**

PRU-25 requires a deleted user's reporter cell to show "the truncated
ULID plus (deleted user)". P-4 said a ULID is NEVER shown in UI content.
The current AssigneeCell sided with P-4 — "unknown user", no ULID.

**Ken's ruling: PRU-25 wins, and "never" softens.** In his words: this
is "an error state of sorts, so we want to give the user information to
help them debug". A dangling reference is precisely where names have
failed — the ULID is the only remaining handle on which referent broke,
so showing a truncated form is diagnostic, not vocabulary. P-4 is
amended with the exception (invariants.md).

Scope: the exception is for **degraded/error references** — a deleted
user on a task, a broken saved view's stored query — NOT for healthy
content (a live user still shows their name, a picker still lists names).
The truncated ULID appears only when the thing it names is gone.

Applies to PRU-25 (assignee/reporter cells) and consistently to any
other dangling-reference degradation (the broken-view case VUE-22 could
adopt the same form).

**To revert.** Ken's, not an agent's.

### A123 · PRU-25/42 build calls: a read-only user-usage capability across all three surfaces, a 6-char ULID tail, and the reporter column visible by default

**Ticket:** PRU-25 + PRU-42 (deleted-user degradation) · **Date:** 2026-09-05 · **Commit:** (this one)

**The situation.** K21 and K22 unblocked PRU-25/42. Building them
surfaced three calls the cases and rulings did not fully specify.

**What had to be decided.** (1) K22's example writes the truncated ULID
as `a1b2c3d4` — eight characters. What length does the degraded cell
actually use? (2) PRU-42 needs the reference count "split by role"
*before* the delete is confirmed; `deleteUser`'s count only surfaces as
an error. Where does that count come from? (3) A reporter column did not
exist; PRU-25 needs the reporter cell in the list. Is it visible by
default?

**Options considered.**
- ULID length: 8 chars (literal to K22's example) vs the 6-char tail the
  app already uses everywhere else it disambiguates a user by id
  (`UsersPanel` qualifier, `MetaPanel`/`comments` collision hints). Eight
  would make the deleted-user tail a different length from every other
  user-id hint in the product.
- Count source: reuse `deleteUser`'s error message (couples a read to a
  failed write, and the UI wants it before committing) vs a new
  read-only core query. A UI-only count in the web server would answer
  the same question differently from CLI/MCP — the drift CLAUDE.md warns
  about.
- Reporter column: visible by default (matches assignee, gives PRU-25 a
  cell to assert) vs opt-in via column settings (PRU-25 says "the other
  four columns are unaffected", implying it renders alongside them).

**Decided.** (1) 6-char tail (`raw.slice(-6)`), consistent with the
app's existing user-id disambiguation. (2) A new core
`countUserReferences(locttDir, userId) → {assignee, reporter}`, surfaced
on all three surfaces: web `GET /api/users/:ref/usage`, CLI `loctt user
references`, MCP `user_references`. (3) Visible by default, inserted
after assignee in `ALL_COLUMNS`.

**Why.** (1) K22 says "e.g." — the example is illustrative, and one
length across the product beats literal fidelity to a sample. (2)
CLAUDE.md: a capability in core is not done until CLI and MCP have it;
one read answers the count identically everywhere. (3) PRU-25's "the
other four columns are unaffected" reads the reporter cell as present in
the default table, and mirroring assignee is the least surprising.

**To revert.** (1) `raw.slice(-6)` in `apps/web/src/client/list/cells.tsx`
(and the matching `.slice(-6)` assertions in `cells.test.tsx`,
`FilterBar.test.tsx`, and the PRU-25 UI spec). (2) Remove
`countUserReferences` (`packages/core/src/users/lifecycle.ts` + exports),
`handleUserUsage`/`USER_USAGE_RE` in `apps/web/src/server/server.ts`, the
CLI `references` case in `apps/cli/src/commands/user.ts`, the MCP
`user_references` tool in `apps/mcp/src/tools/user.ts`, and
`useUserReferences` in `useUserMutations.ts` — the dialog would then need
another count source. (3) Drop the `reporter` entry from `ALL_COLUMNS`
in `apps/web/src/client/list/columns.ts` and the `reporter` case in
`ListView.tsx`'s `Cell`.

### A124 · Avatar cropper on the client, avatar removal in core (CLI+MCP+web), no client-side compression

**Ticket:** M4.1 (PRU-13, 27, 28, 29, 31, 39, 40) · **Date:** 2026-09-05 · **Commit:** (this one)

**The situation.** K18/K20 ruled the split: **the browser crops, the
server compresses to 500px.** The client that existed did the opposite —
`compressImage.ts` resized every avatar to a **256px** cap client-side
and re-encoded before POST (the CW-20 pipeline), which is precisely the
client-side *compression* K18 declined, at the wrong size. There was no
cropper, and no way to remove an avatar at all (no core function, no
route, no UI).

**Decided.**

1. **A hand-rolled canvas cropper — no dependency.** `AvatarCropper.tsx`
   overlays a draggable/resizable square on the decoded image with a
   live preview canvas, and `prepareAvatar.ts` `cropRectToBlob` does a
   `drawImage(sx,sy,sw,sh → 0,0,sw,sh)` at the crop's **source**
   resolution. It deliberately does **not** downscale — the server's
   `copyAvatar` owns the 500px resize (K18 point 2). The brief allowed a
   tiny lib or a hand-rolled canvas; the canvas is enough, so **no new
   dependency was added.**

2. **`compressImage.ts` + its test are deleted.** They encoded the
   declined 256px client-compression design; leaving them would be a
   second pipeline at the wrong size. Client validation they carried
   (SVG/non-image reject, corrupt-decode reject) moved into
   `prepareAvatar.ts`, plus animated-GIF detection (`isAnimatedGif`, a
   byte-level frame count) for PRU-29's still-frame notice.

3. **Avatar removal added to core and all three surfaces.** `removeAvatar`
   (`packages/core/src/users/avatar.ts`) deletes the stored file
   (basename-guarded, idempotent); `updateUser` gained a `removeAvatar`
   flag that also drops the `avatar` key from `profile.yaml`. Wired to:
   web `DELETE /api/users/:ref/avatar` (`handleRemoveAvatar`), CLI
   `user edit --remove-avatar`, and MCP `edit_user`'s `remove_avatar`.
   **Setting** an avatar stays off MCP (binary upload is a poor protocol
   fit, per the existing note); **removing** needs no binary, so the
   layer rule (core capability reaches CLI+MCP) applies to the clear.

**Why this over the alternatives.** A cropper is mandatory under K18
regardless, and a square canvas crop is the whole of "the user chooses
the framing" without a library's weight or supply-chain surface. Keeping
`compressImage` would have re-introduced the two-pipelines-at-two-sizes
drift K18 exists to prevent.

**To revert.** (1) Delete `apps/web/src/client/settings/AvatarCropper.tsx`
and `prepareAvatar.ts` (+ its test); restore `compressImage.ts` from
history if the client-compression design is reinstated. (2) In
`packages/core/src/users/avatar.ts` remove `removeAvatar`; in
`lifecycle.ts` drop the `removeAvatar` branch and `EditUserOptions`
field; un-export from `users/index.ts`. (3) Remove `handleRemoveAvatar`
+ the `DELETE USER_AVATAR_RE` route in `apps/web/src/server/server.ts`,
`useRemoveAvatar` in `useUserMutations.ts`, and the remove button in
`UsersPanel.tsx`. (4) Drop `--remove-avatar` from `apps/cli/src/commands/
user.ts` and `remove_avatar` from `apps/mcp/src/tools/user.ts`.

### K23 · A ghost project default degrades to the ask state, it does not fail the surface

**Date:** 2026-09-05 · **Ken's ruling — an agent may not revert this.**

`ProjectsConfigSchema.superRefine` (`packages/contracts/src/projects.ts:95`)
hard-rejected a `default:` naming a nonexistent project — so
`loadProjectsConfig` threw, `GET /api/projects` returned 400, and the
whole projects surface failed to load over one stale pointer.

**Ken's ruling: degrade.** A ghost default is ignored (resolution falls
through to the unique-single-project rung, then to NEW-19's ask state —
an empty, required project field), and the drift is surfaced as a
notice (banner or Settings), not a wall. This is the same per-element
degradation as K19-adjacent VUE-22 (a broken saved view is listed, not
fatal) and K22/PRU-25 (a dangling user ref degrades) — north-star
principle 5: one bad value never blanks the surface. A `default` is a
pointer that goes stale from a rename or a hand-edit, exactly the
out-of-band drift the framework tolerates.

**Scope.** The `default`-existence check moves from *reject* to
*ignore-and-flag*. The rest of ProjectsConfigSchema stays strict
(malformed structure, duplicate ids, etc. still throw) — only a
non-existent `default` pointer degrades. The drift is reported through
the same notice channel other post-hoc facts use (see K16), and
`doctor` should name it.

Makes NEW-20 buildable, as written.

**To revert.** Ken's, not an agent's.

### A125 · Implementing K23 — where the ghost-default check moved to

**Date:** 2026-09-05 · Agent · revertable.

K23 (Ken's) ruled a ghost workspace `default:` degrades rather than
failing. This records *how* it was implemented, because the check moved
across three layers and the moves are coupled:

1. **Schema (`packages/contracts/src/projects.ts`)** — the
   `superRefine` that rejected a `default` not in the projects list was
   removed (its now-dead `ids` set with it). The **archived-default**
   reject stays: an archived default names a project that *exists* but
   is hidden, so a task would silently land unseen — a different, worse
   failure that stays fatal. The asymmetry is commented in place.

2. **Resolver (`resolveProjectId`, `packages/core/src/projects/manage.ts`)**
   — the `config.default` rung now returns the default **only if it
   names a real project**; otherwise it falls through to the
   unique-single rung and then throws (the ask state). Before K23 this
   guard was unnecessary because the schema guaranteed existence;
   without it, a ghost default would be *returned* and a task filed into
   a nonexistent project, burning the wrong key counter (NEW-14's second
   bullet, not undoable). This is the load-bearing half — proven by
   mutation (forcing the old blind return reddens the NEW-20 resolver
   tests).

3. **Surface (`GET /api/projects`)** — `effectiveDefault` now
   initialises to `null` (was `cfg.default ?? null`): when resolution
   throws, the catch must leave "no defensible default", not the ghost.
   A `default_drift: { kind: "missing", default }` advisory rides the
   response and `projectDefaultIsGhost(cfg)` (new, exported from core)
   decides when to include it. `ProjectsPanel` renders it as a
   `role="alert"` warn banner naming the stale id.

Two green tests were asserting the *old* hard-reject and were rewritten
to assert tolerate-and-degrade (`config-validation.test.ts`,
`config/projects.test.ts`) — flagged per the repo's "editing a green
test means it encoded the bug" rule.

**To revert.** Restore the two `superRefine` issues (nonexistent +
keep archived), drop the resolver existence guard, restore
`effectiveDefault = cfg.default ?? null`, remove `projectDefaultIsGhost`,
the `default_drift` field, and the panel banner. Re-word NEW-20 to
assert the config-error surface. (But this is K23's implementation —
reverting the behaviour needs Ken.)

### K24 · The reporter column is opt-in, not a default list column

**Date:** 2026-09-05 · **Ken's ruling — an agent may not revert this.**

Commit `1ff660a` (PRU-25/42) added a **Reporter** column to
`DEFAULT_COLUMNS` in `apps/web/src/client/list/columns.ts`. That
contradicts **LST-2**, a blocker-severity M1 case that enumerates the
default list columns as exactly ten and does not include reporter:
*key, project, title, status, priority, type, assignee, labels, due,
updated*. The extra column also broke **LST-20** (an eleventh column
pushed the table into horizontal overflow past its 50px tolerance).
Both tests had been red since that commit; the break went unseen
because the full UI suite never ran green to completion (the
`Sidebar.test.tsx` wedge and CPU-starvation flakiness masked it).

The tension is a genuine cross-case contradiction: **PRU-25** requires
that a task whose reporter was hard-deleted shows a *degraded reporter
cell* in the list — which needs a reporter column to exist somewhere.

**Ken's ruling: reporter is opt-in.** It is removed from
`DEFAULT_COLUMNS` and kept as an **available** column the user can add
through `list_columns`. The default view is LST-2's exact ten. PRU-25's
degraded-cell behaviour still holds when the reporter column is shown —
its UI test seeds `list_columns` to include reporter before asserting
(a `tests/` edit, permitted; it does not touch the read-only cases).

**To revert.** Ken's, not an agent's.

### A126 · Implementing K24 — DEFAULT_COLUMNS split from the catalog

**Date:** 2026-09-05 · Agent · revertable.

K24 (Ken's) made reporter opt-in. Implementation:

- `apps/web/src/client/list/columns.ts` — `ALL_COLUMNS` stays the
  catalog (still includes reporter, for the future settings editor and
  PRU-25's opt-in cell). A new `DEFAULT_COLUMNS = ALL_COLUMNS without
  reporter` is the fallback base when a user has no `list_columns`.
  `resolveColumns` now falls back to `DEFAULT_COLUMNS`; it still
  resolves ids against the full catalog, so an explicit `list_columns`
  may name reporter. `DEFAULT_COLUMN_ORDER` derives from
  `DEFAULT_COLUMNS`.

- Three green tests encoded the reverted behaviour and were rewritten:
  `columns.test.ts` (default == catalog; "reporter defaulting visible")
  and `ListView.test.tsx` ("eleven column headers"). Now assert the ten
  and reporter's absence-by-default + opt-in resolution.

- `tests/ui/flow-settings-projects-users.spec.ts` — PRU-25's UI test
  seeds `list_columns` (via new `setActiveUserListColumns` helper)
  before asserting the degraded reporter cell, since reporter is no
  longer shown by default.

- Same file — `userIdByName` was silently failing to match an
  **archived** user, whose `user list --all` label is
  `Name (archived)  <email>`. Rewrote it to strip the email tail and
  the `(archived)` marker before comparing. This was the PRU-42
  failure: the product archived the user correctly (the row showed
  `data-archived`, the reference was kept), but the test helper could
  not find the archived profile and read it as "removed". A
  test-observation bug, not a data-loss defect.

**To revert.** Fold reporter back into a single `ALL_COLUMNS`-as-default
and restore the three tests. (K24's behaviour is Ken's.)

### K25 · Archiving an already-archived task is an idempotent no-op success, not an error (TSK-57)

**Date:** 2026-09-05 · **Ken's ruling — an agent may not revert this.**

The single-task `archiveTask` threw `TaskLifecycleError("task is already
archived")` (and `unarchiveTask` threw "task is not archived"). That
class extends plain `Error`, not `LocttError`, so the web layer could
not classify it and returned a **generic 500** ("Internal server
error") — the B16 fallout TSK-57 names. Meanwhile `bulkArchive` had
always treated an already-archived task as a **success** (reported apart
under `unchanged`, BLK-27). Two paths, two answers for the identical
situation.

**Ken's ruling: idempotent success.** Archiving a task that is already
archived — or unarchiving one that is not archived — leaves it in the
requested state, writes nothing, appends no history entry, and returns
the task. No error on any surface. This is the parity-preserving,
predictable-over-clever choice: archive is not destructive, the end
state the caller asked for is already true, and forcing every surface to
handle a non-error "error" (a 500, no less) served no one. It also
brings the single-task path into line with the bulk path that already
worked this way.

This **overturns a previously-documented deliberate split** (the old
`applyArchiveState` docblock said the throw-vs-success difference was on
purpose). That rationale is superseded and the docblock rewritten.

**To revert.** Ken's, not an agent's.

### A127 · Implementing K25 — idempotent archive/unarchive

**Date:** 2026-09-05 · Agent · revertable.

- `packages/core/src/task/lifecycle.ts` — `archiveTask` returns the task
  unchanged when it is already archived (was `throw
  TaskLifecycleError`); `unarchiveTask` mirrors it for the not-archived
  case. No write, no history append on the no-op. The
  `applyArchiveState` docblock (which had documented the throw as
  deliberate) was rewritten to state the new shared idempotency policy.
  `TaskLifecycleError` stays — `deleteTask` still throws it for the
  `--force` guard, and MCP still classifies it.
- CLI (`task-archive.ts`) and MCP (`tools/task-archive.ts`) call the
  core functions directly, so both inherit idempotency with no code
  change — the parity was free.
- Two green core tests asserted the old throw and were rewritten to
  assert no-op success + no new history entry (`lifecycle.test.ts`).
  One CLI integration test (`edges/delete.test.ts`) asserted the CLI
  surfaced a domain error; rewritten to assert exit 0 and the task
  still archived. A new web server test asserts the route returns 200
  (not the old 500) on a repeat archive.
- CLI and MCP reference docs updated to state the idempotency.

**To revert.** Restore the two throws and the four tests. (K25's
behaviour is Ken's.)

### A134 · `useVanishedViews` depends on a stable signature, not the array reference (fixes a render loop / test wedge)

**Date:** 2026-09-05 · Agent · revertable.

**The bug.** `Sidebar.tsx` calls `useVanishedViews([...views.data.queries,
...(views.data.broken ?? [])])` — a **new array on every render**. The
hook's `useEffect` depended on that array (`[current]`), so it ran every
render; each run calls `setVanished(gone)` with a freshly-built array,
which forces another render, which rebuilds `current`, which re-runs the
effect. An endless render loop. In production it is wasted renders; in
`Sidebar.test.tsx` a dismiss click tipped it into a sustained loop that
`cleanup()` could not unmount — the whole test file **hung at that test**,
past any `testTimeout` (the loop is synchronous re-rendering, not an
awaitable a timeout can interrupt), which is what made the file look like
an import-time wedge.

**The fix.** Depend on a stable content signature
(`current.map(v => `${v.id} ${v.name}`).join("")`) instead of the array
reference, so the effect runs only when the view set actually changes.
`current` is still read inside the effect (guarded eslint-disable).

**Proven.** Reverting the dep to `[current]` re-wedges the "stays
dismissed once dismissed" test (mutation-confirmed); with the fix the
whole file passes 30/30 and the entire web **client** suite runs green
under parallelism (84 files, 823 tests) with no exclusion — the gate
workaround the wedge forced is no longer needed. Scanned the rest of the
client for the same anti-pattern (an effect depending on a freshly-built
array/object): none found.

**To revert.** Restore `}, [current]);` and drop the `signature`. (But
that reintroduces the loop.)

### A135 · Corruption framework — agent-settled calls (Phase 7, step 2/3)

**Date:** 2026-09-05 · Agent · revertable. Settled by the approved
corruption brief, north star, and existing decisions — recorded so they
are not re-opened.

1. **Unrecognised frontmatter keys are surfaced to the UI as read-only
   strings with an X-to-remove.** Not a Ken decision — the approved brief
   §1/§4 already says exactly this. They travel in the `health` list, not
   in `frontmatter`, so `.passthrough()` and byte round-trip are
   unaffected. UI label: **"Not recognised"** for the `unrecognised`
   kind; "Needs attention" for wrong-typed / invalid-value; corrupt
   language is reserved for object-fatal.
   *To revert:* stop emitting `unrecognised` entries in `health`.

2. **Publishing a tracker that has field-local corruption is allowed, not
   gated.** Settled by `integrity.ts` (`malformed` is "reported, never
   blocking … unpublishable would be destruction by another route") and
   V2. The data is preserved, so nothing is at risk.
   *To revert:* add a `--force`-skippable warning that counts corrupt
   fields before publish.

3. **Structural fields (`relationships`, `fields`, `labels`,
   `key_history`) are field-local, not object-fatal.** Reverses the
   spike's boundary (`frontmatter.ts:129-131`). Principle 7's own
   `relationships`-as-object example settles it: the object opens
   (degraded), and only the operation that must interpret it refuses.
   *To revert:* add these keys back to the object-fatal set.

4. **Unlink/link over an object-fatal relationships value keeps the
   shipped refusal** (`relationships.ts:407-411`) — the framework does
   NOT reverse it. (Review S5/M2. If the P-12 tension here is ever judged
   load-bearing, it becomes a Ken decision; today it is a
   keep-what-shipped call.)
   *To revert:* allow unlink to proceed over a structurally-broken
   relationships array.

**Two decisions were escalated to Ken, NOT settled here:** the fatal-set
scope (`{id,key}` vs `{id,key,title,created_at,updated_at}`) and the
byte-preserved→value-preserved P7 rewording. Both are pending his ruling
before step-4 implementation of the parts they gate.

### A136 · Corruption framework — build-time calls (Phase 7, step 3/4)

**Date:** 2026-09-05 · Agent · revertable. Calls the proposal/§13 did not
spell out at the code level, settled while building.

1. **The write guard's "no new finding" (rule 1) is not exempt for
   whole-record writers; it compares reparse-health against what the Task
   *declares* in `after.health`.** § 13.1 B1 exempted "universal"
   (whole-record) writers from the whole guard. But a `createTask` with a
   malformed new value (a bad `due_date`) is a whole-record write that
   *introduces* corruption, and must be refused — not written as a corrupt
   task. So rule 1 fires for every writer: a finding present after the
   write must have existed *before*, or be explicitly declared on the
   `after.health` the writer handed in. Restore/merge declare their
   carried health (so they pass); create declares none (so a bad new value
   is refused as `CorruptWriteError` → `validation_failed` → 400). Only
   rule 2 (a finding may leave only for a touched field) keeps the
   whole-record exemption. `assertWriteSafe`, `io.ts`.
   *To revert:* exempt universal writers from rule 1 too (reintroduces the
   create-with-bad-value silent write).

2. **`writeTask`'s `touched` defaults to `ALL_FIELDS_TOUCHED` ("*").** The
   proposal has every writer *declare* its touched set. Rather than change
   `writeTask`'s 21 call sites at once, its `touched` parameter defaults to
   the whole-record sentinel; the mutation-style writers that must preserve
   others (`setField`/`setFields`/`unsetField`, archive/unarchive, link/
   unlink, bulk) pass an explicit narrow set. A caller that authors the
   whole record (create, restore) keeps the default.
   *To revert:* make `touched` required and thread it through all callers.

3. **`buildShowModel` gains an optional `health` arg** (`{workflow, aux}`)
   so extrinsic classification (`invalid_value`/`dangling`) runs where the
   surfaces already load configs, merged onto the model task. The three
   surfaces pass `loadArchivedGuardConfigs` as `aux` (it is a structural
   superset of `AuxConfigs`). Omitting the arg reports intrinsic health
   only. `show.ts`.
   *To revert:* drop the arg; classify extrinsic health at each surface
   instead.

4. **CLI `show` filters dangling relationship-target findings out of its
   health block and truncates any ULID in `rawText`.** A dangling
   relationship edge is already rendered (truncated) in the Relationships
   section; repeating it in "Needs attention" with the full 26-char target
   ULID both duplicated the row and leaked the ULID K22 truncates.
   `apps/cli/.../task-crud.ts`.
   *To revert:* stop filtering; print every health entry verbatim.

### K26 · Corruption fatal set is `{id, key}` — title and timestamps degrade

**Date:** 2026-09-05 · **Ken's ruling — an agent may not revert this.**

For the Phase-7 corruption framework: a wrong-typed frontmatter field
makes the whole task object-fatal **only** when the offending field is
`id` or `key` (the fields needed to *address* the task). `title`,
`created_at`, and `updated_at` are **field-local** — a task with a broken
title or timestamp loads in a degraded state (the bad field set aside in
`health`, the rest intact) rather than becoming unreadable. This fully
honors north-star principle 5 ("one bad field never blanks the object").

Ken's reasoning: shrink to `{id, key}` if feasible, use 5 only if the
shrink is never feasible. It is feasible — a bounded "thread `undefined`
through the consumers of these three fields" change, the same pattern
already applied to genuinely-optional fields — so it is done now, not
deferred.

**Cost accepted:** `title: string` (and the two timestamps) become
optional in `TaskFrontmatter` AND the `.strict()` public projection,
rippling into every list row, sort, export and API consumer at once.
Done in the framework build rather than as a later step, because
retrofitting the load path twice is worse.

**To revert.** Ken's, not an agent's. (Supersedes proposal § 12 item 1
and § 3.3's step-1 boundary, and the spike's `{id,key,title,created_at,
updated_at}` boundary.)

### K27 · North-star P7 is "value-preserved", not "byte-preserved"

**Date:** 2026-09-05 · **Ken's ruling — an agent may not revert this.**

North-star principle 7 said a corrupt/unknown field is left
"byte-preserved". It is reworded to **value-preserved (YAML-equivalent)**:
a field's *value* is never changed, but its YAML formatting (quote style,
spacing) may shift because every write re-serializes through
`stringifyYaml`.

Ken's reasoning: value-preservation is what matters for UX/product — a
user never perceives or depends on quote style, only on their data's
meaning, which is guaranteed. And the literal "byte-preserved" wording is
**already unmet today** (`frontmatter.ts:283` re-serializes every field
on every write, corruption or not), so this makes the principle honest
rather than weakening real behavior. Byte-identity would require a
CST-preserving writer that buys the user nothing.

**To revert.** Ken's, not an agent's. (Resolves the review's M1 and
proposal § 13.4's escalation.)

### A137 · The UI reads a per-field `{value?, health?}` view-model; the DATA stays split

**Date:** 2026-09-05 · Agent · revertable. (Coordinator call, at Ken's
request — "make the call, then have engineering agents review it".)

**Question (Ken).** Should a field become `{value, status}` end-to-end,
so the UI reads one uniform shape whether the field is valid or corrupt?

**Call.** No at the DATA layer, yes at the RENDER layer.

- **Data/wire unchanged** — healthy values stay bare in `frontmatter`
  (and in each config's valid entries); corrupt ones stay in the
  separate `health` / `broken` list. This is the framework's proven
  spine: putting the corrupt value back under its typed key gives every
  downstream consumer a typed lie, and a `{value,status}` envelope on
  *every* field would spread that lie to the ~50 readers of every field
  and tax the all-healthy path (99.99% of fields) forever. `FieldHealth`
  also models a richer status than valid/corrupt (wrong_type /
  missing_required / unrecognised / invalid_value / dangling) and
  per-element array faults that a flat `{value,status}` cannot.
- **UI reads one uniform shape** — a small client helper computes, per
  field, a view-model `{ field, value?, health? }` by merging
  `frontmatter[f]` with any `health` entry for `f`, AT THE RENDER EDGE.
  Every `Row` (`MetaPanel.tsx`) and every list cell reads that one shape
  and never special-cases "is this in health?" inline. This delivers
  Ken's `{value, status}` mental model where it is cheap (render time),
  not where it is costly (stored/wire). It is a view-model, not a stored
  shape — computed, never persisted.

The proposal § 8 already routes field rendering through one `Row` with an
`error` prop; A137 makes the "one uniform shape" explicit as a
view-model so the surface agents build it once, consistently, rather than
each re-deriving the two-place lookup.

**To revert.** Drop the view-model helper; Rows read `frontmatter`/
`health` directly (still works, just less uniform). The data model is
unaffected either way.

### A137.1 · View-model refinement after code-grounded review

**Date:** 2026-09-05 · Agent · revertable. Amends A137 after tracing how
`health` is actually emitted in core (verified against file:line, since
the Fable design-review agent failed to produce its file).

The naive `{ field, value?, health? }` (value XOR health) is **wrong** —
two real cases break it:

1. **A field can have BOTH a value and health at once.** Extrinsic
   findings (`classifyTaskHealth`) leave the value in `frontmatter` and
   add an **element-indexed** health entry (`labels[2]`,
   `relationships[1].target`, `fields.points[i]`). So `labels` can be a
   present, mostly-valid array AND carry a health entry for one bad
   element. `health` must therefore be a **list** on the view-model, and
   value and health **co-exist**, not exclude.
2. **Intrinsic vs extrinsic put the same field in different places.** An
   intrinsic wrong-typed `labels` collapses the WHOLE array into `health`
   (`field: "labels"`, value absent from `frontmatter`); an extrinsic
   dangling label leaves the array in `frontmatter` and indexes the bad
   element (`field: "labels[2]"`). The view-model must normalise both so
   a Row does not care which path produced the finding.

**Corrected view-model** (computed at the render edge, per top-level
field `f`):
```
{ field: f,
  value?:        frontmatter[f],                 // present unless intrinsic lifted it
  fieldHealth?:  health entry whose field === f, // whole-field fault
  elementHealth: health entries whose field starts with `${f}[` or `${f}.` } // per-element faults
```
A Row is "needs attention" if `fieldHealth` OR any `elementHealth`
exists. A cell/Row renders `value` when present and overlays element
markers from `elementHealth`; when `value` is absent it renders the
`fieldHealth.rawText`. This one shape covers scalar, whole-array,
per-element, unrecognised (a `fieldHealth` with kind `unrecognised`),
and config-entry-adjacent surfaces read the analogous `broken` list.

**Also recorded as gaps for the surface agents / a fix pass (NOT Ken):**
- The contract comment on `Task.health`/`frontmatter` ("corrupt fields
  are NOT in frontmatter") is only true for INTRINSIC findings; extrinsic
  element findings leave the value in place. The comment should be
  corrected (known-gaps).
- `rawForField`'s `fields.<key>[i]` branch returns the whole array, not
  the element (inconsistent with the `labels[i]` branch) — a real bug to
  fix in the sweep.
- `renderRawText` on a whole array/object is multi-line, despite the
  "one-line" contract promise — surface agents must not assume single
  line for whole-field raws.
- No test asserts an indexed `FieldHealth.field` through
  `classifyTaskHealth` — a coverage hole the relationship/label surface
  agents must close.

**To revert.** Same as A137.

### A138 · Corrupt config READ degrades; the WRITE/allocation path still refuses

**Date:** 2026-09-06 · Agent · revertable. Coordinator correction to O1,
settled by PRU-37 (a Ken-approved @verifies case).

O1's projects loader ran the "at least one project" rule (XS-62) over the
*collected-valid* set, so a tracker whose ONLY project is corrupt threw
"no projects" — one bad entry blanked the whole surface, the exact
regression Phase-7B removes and PRU-37 forbids ("tell broken from none").
Caught by coordinator verification (O1's own test used multiple projects
and never hit the empty-valid case).

**Rule.** A corrupt config entry is surfaced, never fatal to the READ:
- **Read** (`parseProjectsConfig`, `GET /api/projects`): degrades. A file
  with one broken project returns the good projects (here none) plus a
  `broken` list naming it. The emptiness rule fires only when the file has
  ZERO entries total (valid + broken) — a genuinely empty list, not a
  corrupt one.
- **Write / key allocation** (`resolveProjectIdForUser`, `createTask`):
  still refuses when there are zero VALID projects — verified it throws
  rather than silently filing a task against a broken project. So
  integrity holds (no key allocated against a corrupt project) without the
  read blanking the surface.

The same all-broken case was checked for sprints/labels/milestones — they
have no min-1 rule, so they already degraded correctly; only projects
needed the fix.

**Surface wire (Phase-7B integration).** `GET /api/projects`,
`/api/labels`, `/api/sprints`, `/api/milestones` now carry the `broken`
list (like VUE-22's `broken_view`), so the degradation is visible on the
wire. Full UI rendering of `broken` is the surface-agent wave; the wire
contract + "not empty, here is what's broken" lands now so no commit is a
net regression. Three web config-error tests (PRU-37, SPR-32, the
labels-don't-take-down case) asserted the old ≥400 mechanism and were
rewritten to assert 200-with-broken.

**Polish (known-gap, not blocking).** With zero valid projects,
`resolveProjectIdForUser` throws the generic "no default project" message
rather than a specific "your only project is broken — fix projects.yaml".
Safe, but could be clearer.

**To revert.** Restore XS-62 over the valid set (re-introduces the blank).

### A139 · A relationship edge reads corrupt vs missing vs healthy (S4)

**Date:** 2026-09-06 · Agent · revertable. Surface agent S4 of the
corruption sweep.

**Gap.** `resolveRelationships` (`core/task/show.ts`) collapsed three
target states into two signals. A target corrupt in a *field* (e.g. a
wrong-typed `title`) loaded via the tolerant `readTask` and rendered as an
ordinary untitled-but-fine row — a corrupt task disguised as healthy. An
*object-fatally* unreadable target (bad `id`/`key`, YAML syntax error)
was caught alongside a genuinely-absent one and both rendered `missing:
true` — the on-disk-but-broken file read as **deleted**.

**Call.** Add `targetCorrupt?: boolean` to the resolved edge
(`ResolvedRelationship` in core, `ResolvedRelationshipResponse` on the
wire, `RelationshipRow` in the client). Four states, from `missing` ×
`targetCorrupt`:
- resolved-healthy — `missing:false`, corrupt absent → plain link.
- resolved-but-corrupt — `missing:false`, `targetCorrupt:true` → the row
  STILL links (task opens, can be repaired), keeps its key/title, and
  wears a ⚠ "corrupt" affordance.
- corrupt-but-unreadable — `missing:true`, `targetCorrupt:true` → reads as
  corrupt (repair the file), not deleted.
- absent/deleted — `missing:true`, corrupt absent → the REL-24 "no task
  with id" dangling treatment, unchanged.

The corrupt signal is derived, not stored: `(target.health?.length ?? 0)
> 0` on the tolerant read, and the `UnreadableTaskError` vs
`TaskNotFoundError` split (already distinct classes) for the missing case.
Omitted (not `false`) on the healthy path so existing exact-shape edge
tests and the wire stay unchanged.

**Absent vs unreadable — distinguished, for free.** The two were already
separate exception classes caught in one block; the split cost nothing.

**Out-of-lane touch (flagged for coordinator).** The wire mapper in
`apps/web/src/server/server.ts` (not an S4-assigned file) needed a
one-line passthrough or the field would be dead on the wire — a thin
`...(r.targetCorrupt === true ? { targetCorrupt: true } : {})`.

**Cross-surface parity (for coordinator, NOT built here).** CLI `loctt
show` and MCP `get_task` render relationship targets too and should mirror
this corrupt-vs-missing distinction; S4's lane was web + core only. The
core signal is now on `ResolvedRelationship` for both to consume.

**To revert.** Drop `targetCorrupt` from the three shapes and the server
passthrough; edges collapse back to resolved/missing (corrupt-in-title
reads untitled, unreadable reads deleted).

### A140 · `UnreadableFileError` is a `LocttError` (`io_failed`); web init attributes fs/repair errors off the prefix (Phase Z web-server)

**Date:** 2026-09-06 · Agent · revertable. Phase Z correctness fix,
web-server findings 1–3 (adversarially verifier-confirmed).

**Gap.** (1, HIGH) `UnreadableFileError`
(`core/utils/read-state.ts`) was a plain `Error`, so the web
dispatcher's top-level catch (`server.ts` `handleRequest`) — which has
a `LocttError` branch — missed it and flattened it to `500
code:"unknown" recovery:"retry"`, white-screening `GET /api/tasks` and
`/api/search` and blaming the server for a file only the user can fix
(the ERR-31/SET-39 class). (2, MOD) `POST /api/init` mapped *every*
`initLoctt` failure — a raw `EACCES`/`ENOSPC`, an
`InitRepairNeededError` — to `400 validation_failed field:"prefix"`.
(3, LOW) `GET /api/search` used the plain `loadAllTasks` and silently
dropped unreadable tasks, unlike `/api/tasks` and export.

**Call.**
- **(1)** `UnreadableFileError extends LocttError` with
  `code:"io_failed"`, `recovery:{kind:"none"}` (retrying an unreadable
  file cannot help — the user must fix it), and the errno in `detail`.
  Chosen over a web-only handler branch because *every* surface's
  `LocttError` path then renders the actionable sentence: the CLI's
  `KNOWN_DOMAIN_ERRORS` already lists `LocttError` (so it now exits 1
  with the message instead of an opaque crash), and MCP's
  `isKnownDomainError` gained an explicit `UnreadableFileError` arm.
  This matches the existing `UnreadableTaskError`/`io_failed`+`none`
  convention that `server.unreadable-task.test.ts` already pins.
  - **Name collision resolved:** the raw errno moved from `.code` to
    `.fileErrno`, because `LocttError.code` is the envelope `ErrorCode`
    (`io_failed`), a different axis from the filesystem errno
    (`EACCES`). `read-state.test.ts` was updated to assert both.
- **(2)** The init catch now branches: an error whose `.code` matches
  `/^E[A-Z]+$/` → `500 io_failed data_state:"not_saved"` naming the
  real cause; `InitRepairNeededError` → `400 config_invalid` carrying
  its own message and the `loctt init --repair` route, **no** `field`;
  everything else (empty prefix, empty name, invalid timezone,
  already-exists) keeps `400 validation_failed field:"prefix"`. Repair
  kept at 400 (not 409) so the existing `server.init.test.ts`
  status assertions hold; the fix narrows the *attribution*, which
  those tests do not check. `InitRepairNeededError` is now exported
  from core.
- **(3)** `handleSearch` switched to `loadAllTasksDetailed` and emits
  the `unreadable` set as a body field, identical in shape and channel
  to `handleListTasks`.

**Tests.** `apps/web/src/server/server.phase-z-error-mapping.test.ts`
(10 cases, WS1/WS2/WS3), each mutation-proven: WS1 red when the class
is reverted to a plain `Error`, WS2 red when the init branches are
disabled, WS3 red when search reverts to `loadAllTasks`. `chmod 000`
cases self-skip where the process can read regardless (root/CI).

**Prefix format validation — NOT added (follow-up).** The verifier's
aside stands: `initLoctt`'s only prefix check is non-emptiness, so
`{"prefix":"bad prefix!!"}` is accepted end-to-end (201). Left as a
follow-up rather than scope-crept into an error-mapping fix — where a
prefix format rule should live (core `initLoctt`, the wizard, or
`InitRequestSchema`) is an unsettled design question, not a mapping
bug. Noted in `known-gaps.md`.

**To revert.** Make `UnreadableFileError extends Error` again with
`.code` = errno (and restore the `read-state.test.ts` assertion);
collapse the init catch back to the single
`400 validation_failed field:"prefix"`; switch search back to
`loadAllTasks` and drop its `unreadable` field; drop the MCP arm and
the `InitRepairNeededError` export.

### A141 · Phase Z correctness-fix calls: git divergence, config collision, and query DSL semantics

**Date:** 2026-09-06 · Agent · revertable. Four calls made while fixing
Phase Z Batch-1 findings (adversarially verifier-confirmed, then
fix-reviewed). Recorded because each chose one behaviour where another
was defensible.

**G1 — publish refuses on remote-only divergence (does NOT auto-merge).**
When the branch has advanced with work local has not incorporated (a
remote add, or a remote edit to a task local did not touch) and there is
no per-field conflict, publish could either (a) auto-merge like `sync`
then push, or (b) refuse and route the user through `sync`. **Chose (b)**
— a new `GitSyncFirstError` (`sync_needed`, 409). Auto-merging inside
publish would duplicate sync's merge/normalise/reconcile machinery on a
path the user asked to *publish*, not reconcile, and silently change
their working tree mid-publish; refusing is predictable (P-2) and reuses
the one code path that already merges. The refusal names ONLY genuinely-
remote paths: `branchDiffersFromBase` filters out a locally-deleted base
file (which `planSync` also labels `copy`) so a plain local delete still
publishes and is not resurrected by the sync it would otherwise be sent to
(caught in fix-review).

**C3 — a valid entry that reclaims a hidden broken key DROPS the broken
sibling (does NOT refuse the write).** In `mergeBrokenIntoPlain`, when a
now-valid workflow entry has the same key as a preserved broken one, the
options were to drop the broken entry (the valid one supersedes it) or
refuse the write. **Chose drop** — the user has effectively replaced the
broken entry with a valid one of the same key; keeping both writes a
duplicate key past the gate (the original bug) and keeping only the
broken one would discard the user's valid edit. This is narrower than
K28's preserve-others (which is about *untouched* siblings); a key
collision means the sibling was touched. Non-colliding broken entries are
still preserved (K28-WF stickiness holds).

**Q1 — date fields compare by calendar day in the evaluator (does NOT
tighten the contract to reject timestamps).** A date field may hold a
full ISO timestamp (the schema permits it, MCP advertises it), which made
equal-day boundary comparisons wrong under lexicographic compare. Could
have (a) forbidden timestamps in date fields or (b) made the evaluator
day-aware. **Chose (b)** — forbidding timestamps is a data-model change
that would reject existing valid data and break the MCP contract;
day-comparison fixes the query semantics without touching what may be
stored. Scoped to date-typed fields against date/`today` operands, so
event timestamps (`created_at` etc.) keep instant semantics.

**Q2 — the `text` alias rejects non-`~` operators (does NOT redefine `=`
as contains).** `text = x` evaluated inverted. Could have made `text =`
mean exact-match, but `text` is a substring alias with no exact/ordering
meaning; **chose to reject** `text` with any operator but `~` at
validation time. No first-party surface emits a non-`~` `text` filter, so
nothing breaks; a hand-written saved view with `text =` now errors at run
with a clear message instead of returning the complement silently.

**To revert.** G1: delete `GitSyncFirstError` + `sync_needed`, restore
`detectPublishReconcile` to return `undefined` when there are no field
conflicts (reinstating the data-loss bug — don't). C3: drop the
key-collision filter in `mergeBrokenIntoPlain`. Q1: remove the
`dateAware`/`compareDates` path in `evaluator.ts`. Q2: remove the `text`
operator check in `validate.ts`. Each has a regression test that reddens
on revert.

### A142 · Web backup/restore surface shape (F3 / K30)

**Ticket:** BUILD F3 (Phase Z Batch 2) · **Date:** 2026-09-06 · **Commit:** (this one)

**The situation.** K30 rules "build a web surface: a download endpoint
for export and an upload-restore, with an explicit confirm on the
destructive `overwrite` mode." It does not fix the endpoint shapes,
the confirm mechanism, or how a split backup is handled on the web.
Core `exportBackup` writes to a file path (it streams a task at a time)
and `restoreBackup` takes an array of file paths; the multipart parser
(`multipart.ts`) captures only file parts and drains non-file fields.

**What had to be decided.** (1) How does the confirm signal ride on the
restore request? (2) Does the web restore accept a split (multi-part)
backup? (3) How is the export streamed given core writes to a file?

**Options considered.**
- Confirm: a `confirm` field in a JSON body (needs a second field
  channel alongside the multipart file, which busboy drains) vs. a
  `?confirm=true` query param (read before the body is parsed, same as
  the attach endpoint's `?force=true`). The query param is free; the
  body field needs the parser to surface non-file parts.
- Split backup: accept multiple files (needs the client to send N file
  parts and the parser to keep them all) vs. single file only, defer
  split to the CLI. Multi-file upload is materially more client and
  server work for the rare large-tracker case.
- Export streaming: hold the whole backup in memory vs. write to an OS
  temp file and stream it back, deleting the temp dir in `finally`.

**Decided.** `?mode=`, `?confirm=true`, `?dry_run=true` on the query
string (mirroring `?force=true` on attach upload); the backup uploaded
as one multipart `file` part; **single file only** — a split backup is
restored with `loctt restore <part...>` (noted in the web reference and
the panel copy); export written to an OS temp file and streamed with
`pipeline`, temp dir removed in `finally` (mirroring the attach/avatar
temp-dir pattern). Export always passes `splitThresholdBytes:
Number.MAX_SAFE_INTEGER` so a single streamed download is never split.

**Why.** The query-param confirm reuses the exact shape hard delete /
attach-force already use, so the CSRF guard (X-Loctt-Client on the
POST) and the confirm gate compose without touching the multipart
parser. Single-file keeps the surface small for the common case
without dropping the split capability, which stays on the CLI where a
part list is natural. Temp-file streaming matches how core is built
(peak memory one task, not one tracker) and reuses the server's
established upload cleanup.

**To revert.** `apps/web/src/server/server.ts` — `handleExportBackup`,
`handleRestoreBackup`, and the two routes
(`GET /api/backup/export`, `POST /api/backup/restore`);
`apps/web/src/client/settings/BackupPanel.tsx`; the `backup` section in
`sections.ts` and its wiring in `SettingsShell.tsx`; tests
`server.backup.test.ts` and `BackupPanel.test.tsx`. Docs: the web-UI
"Backup and restore" section in `docs/user/ui/features.md` and the
cross-surface notes added to the CLI and MCP backup sections.

### K28 · Config writers must preserve untouched degraded siblings; aggregates must not silently undercount

**Date:** 2026-09-06 · **Ken's ruling — an agent may not revert this.**

Authoring the corruption cases surfaced two live P1 bugs — both
pre-existing known-gaps, both the sweep's own principle (never silently
lose or miscount corrupt data, P5/P7) violated. Ken: **fix both now.**

1. **Config preserve-others (data LOSS).** Every config loader now
   degrades a corrupt entry to `broken` (A138), but the *writers*
   re-serialize only the VALID entries — `serializeQueriesConfig` never
   emits `broken`, and `list-view`'s prune is the same shape. So a
   `broken` entry another process left is **silently dropped from disk**
   on any unrelated UI write (the `saveQueriesConfig` P1 known-gap,
   unfixed since 2026-09-04). This is the config analogue of the task
   write guard (K25/A136 B1). Fix: every config writer
   (queries/labels/milestones/sprints/projects/list-view) re-emits the
   degraded siblings it did not touch, so a corrupt-but-preserved entry
   survives an unrelated write, byte-for-byte.

2. **Aggregate undercount (wrong number).** Counts / milestone progress /
   burndown / export share `loadAllTasks`. A field-local-corrupt task
   must be *included* (it is a task); an unreadable one must be
   *reported*, not silently skipped (milestone progress "skips a
   malformed task" is a known-gap: a silent wrong total). Fix: a degraded
   task is counted; an unreadable one is surfaced, never dropped from a
   total with no indication.

Both are canonicalized as blocker DEG cases and gated by tests.

**Build status (2026-09-06).**
- Part 1, queries: landed (commit 7a8bbb1) via the shared
  `brokenEntriesToPlain` helper (`config/health.ts`); the remaining six
  writers (labels/milestones/sprints/projects/calendar/list-view) follow
  the same pattern. `workflow.yaml`'s `broken` is a keyed record, a
  different shape — handled separately.
  - **Residual loss (Phase Z finding C2, 2026-09-06 — fixed).** Unlike
    the six object-shaped configs, queries preserved via a *typed struct*
    (`BrokenSavedQuery`) whose `serializeBrokenQuery` re-emitted only
    `{id,name,query}`. A broken saved view (schema-valid, DSL unparseable)
    that also carried `sort`/`display`/`archived` therefore lost those
    three optional fields on any unrelated `queries.yaml` write
    (create/edit/archive/delete of another view). Fix: `BrokenSavedQuery`
    now carries `rawText` (the entry's full YAML, `renderRawText(item)` at
    parse time in `parseQueriesConfig`), and `serializeBrokenQuery`
    re-emits from it — the same `rawText` + re-parse mechanism the six
    object configs use, so every field (present and future) round-trips
    byte-value-for-value and the entry re-loads into `broken` (never
    promoted to valid). Files: `contracts/src/query.ts`
    (`BrokenSavedQuerySchema` gains `rawText`), `core/src/config/queries.ts`.
    Test: `queries.test.ts` "PRESERVES a broken entry's sort/display/archived
    on write (Phase Z C2)", mutation-verified.
- Part 2, aggregates: landed. `progress.ts` gains
  `milestoneProgressDetailed`/`sprintProgressDetailed` returning a
  `ProgressReport` `{ progress, unreadable }` — the readable corpus is
  counted honestly and unreadable tasks are reported at the tracker level
  (they cannot be attributed to a milestone, since the `milestone` field
  is exactly what failed to read). Threaded to all three surfaces: web
  `GET /api/{milestones,sprints}?progress=true` carries `unreadable`, CLI
  `milestone list --progress` warns to stderr, MCP `list_milestones`
  returns `unreadable`. Test: `progress-batch.test.ts` "reports an
  unreadable member rather than silently shortening the total (K28)".
- Part 3, workflow.yaml (K28-WF): landed. See below.
- **Sprint-progress parity + milestones-client unreadable (Phase Z F1,
  2026-09-06).** Part 2's "threaded to all three surfaces" sentence was
  accurate for *milestones* but over-broad for *sprints*: sprint
  progress reached only the web *server* (`sprintProgressDetailed`
  called from `server.ts`; no CLI flag, no MCP arg, no web *client*
  consumer). Its origin is `1f1bf22`, not K28 — Ken's ruling text is
  left unedited; this note records the correction (per K30 F1). Now
  landed: CLI `sprint list --progress` (mirrors `milestone list
  --progress`, warns unreadable to stderr), MCP `list_sprints` gains a
  `progress` arg returning per-sprint `progress` + top-level
  `unreadable`, and the web client consumes `/api/sprints?progress=true`
  via `useSprintsWithProgress`, rendered as a done/total readout (and an
  unreadable notice) on `SprintDetail`. Separately, the milestones web
  *client* was silently dropping the K28 `unreadable` the server already
  put on `/api/milestones?progress=true`: `useMilestonesWithProgress`
  narrowed the response to `.items`, so a milestone with an unreadable
  member showed a short done/total with nothing explaining it (a P-5
  violation). Fixed client-side only (data was already on the wire):
  the hook threads top-level `unreadable`, and `MilestonesView` renders
  the same count-naming notice `SprintsView` uses. Tests:
  `tests/integration/cli/sprint-progress.test.ts`,
  `tests/integration/mcp/list-sprints-progress.test.ts`,
  `apps/web/src/client/milestones/MilestonesView.test.tsx`,
  `apps/web/src/client/sprints/SprintDetail.test.tsx` — each
  mutation-verified. Docs: CLI + MCP references updated for the sprint
  `--progress`/`progress` additions.

**K28-WF · workflow.yaml preserve-on-write (Ken, 2026-09-06).**
Fixing Part 1 surfaced a third slice: `workflow.yaml` has the same
silent-drop bug but two things make it a design fork, not a mechanical
repeat. (1) Its `broken` is a *keyed record* (per sub-list), not a flat
array. (2) Its main writer is a whole-document PUT (`applyWorkflowEdit`
← the Settings form), so "thread `config.broken` forward" — how the six
flat writers preserve — does nothing: the client rebuilds the document
without the broken entries it never rendered, so the incoming `broken`
is empty on the common path.

Ken's ruling, with the fork put to him: **fix it now, Option B —
`saveWorkflowConfig` re-reads the on-disk broken sub-entries and merges
them at write time**, so preservation does not depend on the caller
carrying the data. And **broken entries are sticky: they survive every
write until the user fixes the file itself** (fix-the-file-to-clear) —
no discard gesture, matching how every other corrupt entry is treated.
The re-read is lock-safe (every caller holds the state lock). Test:
`workflow-write.test.ts` "keeps a broken status on disk after an
unrelated valid edit", mutation-verified. Canonicalized under DEG-24.

**To revert.** Ken's, not an agent's.

### K30 · Phase Z parity: build the missing surfaces to full parity (F1–F4, PRU-44)

**Date:** 2026-09-06 · **Ken's ruling — an agent may not revert this.**

Phase Z's strict-parity + data-flow review found five capabilities that
live on some surfaces but not all. Put the choice to Ken as "record the
exclusions as intentional (fast) vs. build them (robust)"; Ken chose
**robust + better UX — build all four**, plus fix PRU-44 which is the
same shape.

- **F1 · sprint progress** was web-API-only (`sprintProgressDetailed`
  called only from the web server; CLI `sprint list` had no `--progress`,
  MCP `list_sprints` no progress arg — and no web *client* even requested
  it). This is a straight parity **bug** (its origin is `1f1bf22`, not
  K28; K28's "all three surfaces" line was over-broad for sprints —
  corrected by a build-status note, not by editing the ruling). Fix:
  mirror milestone progress on CLI (`sprint list --progress`) and MCP
  (`list_sprints` progress arg + `unreadable`), and wire the web client
  to actually consume it.
- **F2 · saved-view management** (create/edit/delete/archive/unarchive)
  was web-only; CLI `views` was a read-only lister, MCP had only
  `list_views`. **Build** the CLI subcommands and MCP tools. Especially
  matters for MCP: an agent that can create tasks but not set up a saved
  view is arbitrarily limited.
- **F3 · backup/restore** was CLI+MCP-only, absent from web — the one
  operation that protects against data loss missing from a whole
  surface. **Build** a web surface: a download endpoint for export and an
  upload-restore, with an explicit confirm on the destructive
  `overwrite` mode. (Also fix `docs/user/cli/reference.md:1157`, which
  falsely claims backup is "on every surface".)
- **F4 · task CSV/JSON export** was web-only. The repo had *deliberately*
  scoped this (TSK-C7 "reachable — or documented as absent", with an
  integration test pinning the doc), so this ruling **overrides** that
  earlier call: **build** CLI + MCP task export. Update TSK-C7's
  doc/test accordingly.
- **PRU-44 · editable project prefix in the web UI** — wired in
  core/CLI/MCP/web-server, but `ProjectsPanel` renders the prefix
  `readOnly disabled`; the feature was never built in the UI, its
  `useSetProjectPrefix` hook is dead, and the panel's PRU-45 tag is
  hollow (unsatisfiable without an editable field). **Build** the
  editable-prefix control (with the rename confirmation PRU-44 specifies)
  and un-hollow the tags.

Each is built to the same bar as any ticket: fail-first tests on every
surface, reference-doc updates (CLI + MCP), and a fix-review pass before
commit. Recorded as decisions the user-docs cite, closing the
root-cause the review named — surface exclusions must live in
`decisions.md`, not only in user docs.

**To revert.** Ken's, not an agent's.

### K31 · Config-panel drag-reorder stays inline (an explicit exception to "inline is for tasks")

**Ken's ruling, 2026-09-09.** In the Workflow settings panels (Statuses,
Priorities, Task types), **dragging a row's handle to reorder stays a
direct inline gesture** — it is NOT moved behind the Edit dialog.

This is a deliberate exception to K1 / "inline is for tasks" (which
gated *value* edits — a row's label/category/default — behind an Edit
dialog on config panels). Reorder is carved out because:
- It cannot corrupt config data. The only thing a drag changes is order,
  which is visible and re-draggable in one gesture — not the accidental
  value-change the edit-model guard exists to prevent.
- Dragging IS the natural gesture, especially for priorities where order
  *is* the sort weight (`value` is recomputed from position,
  `(index+1)×10`), so drag is how you express "this matters more." For
  statuses/task types order is display-only, and equally safe inline.
- Drag-and-drop inside a modal you must first open is worse UX for no
  safety gain.

Keeps SET-6 / SET-21 / SET-28 / SET-34 as pinned (no case reversal). The
value-edit gating (Edit → dialog) is unchanged; only reorder is inline.

**To revert.** Ken's, not an agent's.

### K32 · No undo on board/timeline drop or bulk Set-field (only bulk-archive keeps its undo)

**Ken's ruling, 2026-09-09.** The optional "undo lane" (tracker
open-decision #2) is **not built.** Undo-after-bulk-archive (BLK-10)
stays; no undo is added to a board/timeline drag-drop or a bulk
Set-field.

**Why.** Bulk-archive undo exists as a safety net for a bulk
*destructive* action. A board drag or a bulk status change is not
destructive — it is a visible, single-gesture, trivially reversible edit
(drag it back; set it again). Jira offers no undo there and it is not
missed. Adding it would be ceremony around already-safe actions. This is
NOT a gap — it is a deliberate non-build.

**To revert (to build it).** Add undo affordances mirroring BLK-10's
(`ListView.tsx:371-405` — the undo control in the result banner, capturing
the touched refs and their prior state) to the board/timeline drop path
and the bulk Set-field path, restoring prior status+rank (board) / dates
(timeline) / field values (bulk) on undo.

**To revert.** Ken's, not an agent's.

### K33 · The task description is read-then-edit (Jira-style), not an always-live editor

**Ken's ruling, 2026-09-09.** The task **description** renders as
**read-only formatted output by default**, not as a live editor.

- **Default = rendered, read-only.** Formatted markdown (headings, lists,
  links, images), no toolbar. Reuses the read-only renderer that comments
  already use (`comments/renderMarkdown.tsx`).
- **Click anywhere on the rendered text → the whole description becomes
  editable** (the rich editor + toolbar appear; the existing
  `RichEditor`/`MarkdownEditor` in `BodyEditor.tsx`). This SUPERSEDES
  B3's TSK-64 (toolbar-collapses-until-focus) — it is the fuller form of
  the same idea, so TSK-64's behaviour folds into this.
- **In the RENDERED view only**, clicks on rich content OPEN rather than
  edit: a **link** opens in a new tab, an **image** opens in a lightbox.
  (In edit mode, links/images are ordinary editable content.)
- **The raw-markdown toggle stays**, but lives INSIDE edit mode (the
  rendered view has no toggle). LocTT's markdown-is-source / byte-identical
  design (TSK-17, K2) is unchanged.
- **Save:** click-away (blur) flushes the existing idle autosave (K2 /
  TSK-15 — already 1500ms idle); Escape cancels the edit and returns to
  the rendered view. *(This save/exit gesture is the agent-level detail
  under Ken's model; revertible.)*
- **Scope:** the **task description only.** Comments were NOT extended to
  this model in Ken's instruction; if a matching click-to-edit on posted
  comments is wanted, that is a separate decision, not assumed here.

This is a net-new interaction model (a scope addition, not a fix), so it
gets its own case(s) in B4 step 0 before any code, and lands in B4
(extending B3's editor work).

**To revert.** Ken's, not an agent's.

### A143 · The Projects panel adopts the Edit-gated inline-form model, matching Milestones/Labels

**Ticket:** B2 · **Date:** 2026-09-06 · **Commit:** (staged)

**The situation.** The Projects panel edited a project's name by an
always-visible input that saved on **blur** — inline auto-save. The
edit-model (Ken) requires config panels to be read-by-default and gate
field-value edits behind an explicit Edit. Milestones and Labels already
did this with an Edit-gated inline form (an "Edit" button reveals the
fields + Save/Cancel). Ken left the shape per-panel: "Edit-gated inline
form OR modal for low-risk fields — your call, be consistent."

**What had to be decided.** Inline-form or modal for the Projects row's
low-risk name edit?

**Options considered.**
- *Modal Edit dialog* (like the Users panel, PRU-47). Cost: a second
  dialog shape in the same lane, and it diverges from the two sibling
  panels in the same settings section.
- *Edit-gated inline form* (like Milestones/Labels). Cost: the row grows
  a small form region in edit mode; the immutable slug/prefix have to be
  shown inside it.

**Decided.** Edit-gated inline form, matching Milestones and Labels.

**Why.** Consistency within the Settings → Data/Projects section carries
more than matching the Users panel, which is a different section with a
richer per-user dialog (avatar, email, timezone). The name is a single
low-risk field; a full modal is heavier than it needs. The prefix keeps
its own confirm dialog (PRU-44) *inside* the form, since a prefix change
rewrites every task key and must never ride a blur or a plain Save.

**To revert.** `apps/web/src/client/settings/ProjectsPanel.tsx`
(`ProjectRow` `editing` state and the read/edit branches). The
vitest `ProjectsPanel.test.tsx` "edit-model (PRU-6)" block and the
`flow-settings-projects-users.spec.ts` PRU-6/PRU-20 specs assert the
inline form and would change with it.

### A144 · Set-default (PRU-48) rides the existing project PUT; no new endpoint

**Ticket:** B2 · **Date:** 2026-09-06 · **Commit:** (staged)

**The situation.** PRU-48 ("a project can be set as the default from the
Projects panel") notes "core `setDefaultProject` is called only
internally — this needs a new endpoint." But `PUT /api/projects/:id`
already maps `default: true` onto `setDefaultProject` (added for the
create/edit/delete flows; `server.ts` handleUpdateProject ~1705), and
`GET /api/projects` already returns the workspace `default` id at
top-level. So the plumbing the case predicted was missing already
existed.

**What had to be decided.** Add the new endpoint the case anticipated, or
use the existing PUT path?

**Options considered.**
- *New dedicated route* (e.g. `POST /api/projects/:id/default`). Cost: a
  redundant second write path onto the same core call; the case doc's
  prediction was written before the PUT gained `default`.
- *Ride the existing PUT with `{ default: true }`.* Cost: none observed —
  the handler, the core call, and the response marker are all present.

**Decided.** Ride the existing `PUT /api/projects/:id` with
`{ default: true }`. No server route was added in this lane.

**Why.** "A capability in core is not done until CLI and MCP have it" and
"check before claiming something does not exist" (CLAUDE.md): the
endpoint the case called for was already built. Adding a second one would
be drift. The set-default is the only server-adjacent concern in this
lane, and it needed no server touch.

**To revert.** `useSetDefaultProject` in
`apps/web/src/client/api/hooks/useProjectMutations.ts` and the
`project-set-default-*` / `project-default-marker-*` controls in
`ProjectsPanel.tsx`. If a dedicated route is later wanted, the handler at
`server.ts` handleUpdateProject already contains the mapping to copy.

### A145 · SET-28's Edit-dialog stale detection is a per-entry baseline diff, not a whole-document version check

**Ticket:** B2 (workflow settings panels) · **Date:** 2026-09-06 · **Commit:** (staged)

**The situation.** SET-28 (reworded, now the primary value-edit path):
"If an Edit dialog was open when the file changed underneath, the save is
refused with a message naming the file and offering to reload — the dialog
does not silently clobber the hand edit on Save." The existing
`useSaveWorkflowCollection` already re-reads the whole document before the
PUT and *merges* the panel's edit onto it (so hand-added rows survive).
That merge is right for reorder/create, but for an Edit dialog it would
silently overwrite a hand-edited version of the *same* row the dialog is
editing — exactly what SET-28 forbids.

**What had to be decided.** How does the Edit-dialog path detect that the
row it opened over changed on disk, given there is no per-document version
token or ETag on `/api/workflow`?

**Options considered.**
- *Whole-document hash / version token.* Cost: no such token exists on the
  route; adding one is a server change (out of lane — no new routes, and
  server.ts is off-limits), and it would refuse a save for an unrelated
  hand edit elsewhere in the file, which SET-28 does not ask for.
- *Per-entry baseline diff.* The Edit dialog captures the row as it was
  when opened; before the PUT, `apply(fresh)` compares the freshly-read
  version of that same key (`entryChangedOnDisk`, a `JSON.stringify`
  equality) and throws `ConcurrentWorkflowEditError` if it differs or the
  key vanished. Cost: a byte-identical rewrite (e.g. reordered keys within
  the row object) would false-positive; acceptable, since the honest
  answer to "the file moved under you" is to reload.

**Decided.** Per-entry baseline diff, thrown from inside `apply` so it
lands before the PUT (nothing is written) and surfaces as the dialog's
anchored `Callout` (shared with SET-51).

**Why.** It satisfies SET-28 without a server change or a new route, and it
scopes the refusal to the row actually being edited — a hand edit to a
*different* row still merges through the existing path, matching the "does
not silently clobber the hand edit" wording without over-refusing. Reorder
stays inline and unaffected (open decision #3).

**To revert.** `entryChangedOnDisk` in
`apps/web/src/client/settings/workflowForms.ts`, and the `staleBaseline`
branch of `commit`/`commitFields` in `EnumCollectionPanel.tsx`,
`RelationshipsSettingsPanel.tsx`, and `CustomFieldsPanel.tsx`. To drop the
check, remove the `staleBaseline` option and the throw; to strengthen it to
whole-document, a version token on `GET/PUT /api/workflow` would be needed.

### A146 · Deleting a whole custom field offers clear-only (no remap target), reusing RemapDeleteDialog

**Ticket:** B2 (workflow settings panels) · **Date:** 2026-09-06 · **Commit:** (staged)

**The situation.** SET-49 requires full custom-field CRUD, including
delete, and says "Delete goes through remap-or-clear (the SET-19 shape)
when tasks still hold the field's values." SET-19 (deleting an enum
*value*) offers remap-to-another-value or clear. But deleting the *whole
field* has no sibling to remap to — fields are not interchangeable the way
two enum values of one field are.

**What had to be decided.** What does "remap-or-clear" mean for a
field-level delete, where there is no meaningful remap target?

**Options considered.**
- *Offer remap to another field.* Cost: incoherent — moving a `number`
  field's values onto a `date` field is not a remap; the server's
  `remap.custom_fields` table is keyed value→value within one field, not
  field→field.
- *Clear-only.* Reuse `RemapDeleteDialog` with `alternatives={[]}`, so it
  degrades to a clear-or-cancel confirm, and send a per-value `null` remap
  table (`{ [fieldKey]: { [valueKey]: null, … } }`) for an enum field so
  the server clears the field on the tasks that hold it. Cost: the dialog's
  copy is value-oriented ("clear the field on them"), which reads correctly
  for a field delete too since a field-level clear empties the field.

**Decided.** Clear-only, reusing `RemapDeleteDialog` with no alternatives;
for an enum field the confirm sends every value key mapped to `null`.

**Why.** It honours SET-49's "remap-or-clear" intent (a choice is required
before anything is orphaned) with the only branch that is coherent at field
granularity, and it reuses the shared dialog B0b already fixed rather than
authoring a new one. The RemapDeleteDialog copy was not re-edited (it is
shared and out of lane); it is only *called* here.

**To revert.** The `deletingField` state and its `RemapDeleteDialog` block
in `apps/web/src/client/settings/CustomFieldsPanel.tsx`. If a
field-to-field remap is ever wanted, it would need a new server remap shape
(field→field), which does not exist today.

### A147 · SPR-8's Edit gate collects one draft and commits per-field on Save

**Ticket:** B2 (M4.7 / M4-settings) · **Date:** 2026-09-06 · **Commit:** (staged)

**The situation.** `SprintMetaHeader` committed each field on blur (and
`state` on change) in place. SPR-8 supersedes that framing: the header
is "read-by-default; an explicit Edit control opens the fields for
editing (name/start/goal/state) — they no longer commit-on-blur/
commit-on-change in place."

**What had to be decided.** With editing now behind Edit, does Save
send one combined request or one request per changed field, and what
happens to the draft on a rejected save?

**Options considered.**
1. **One PUT per changed field, sequential, stop on first error.**
   Reuses the existing `useUpdateSprintMeta` (single-field PUT, which
   the server's read-modify-write needs for SPR-28's concurrent-goal
   guarantee). Costs: N requests for N changed fields.
2. **One combined PUT of all changed fields.** One request. Costs: the
   server's `handleUpdateSprint` does apply a merge, but the existing
   client hook and its SPR-28 reasoning are per-field; a combined write
   would need a new hook and re-argue SPR-28. More surface for one save.

**Decided (superseded — see below).** Originally option 1: collect a
single draft, and on Save commit each changed field with the existing
per-field PUT, stopping on the first rejection.

**Switched to option 2 (combined PUT) — B2 fix-review.** Option 1 has a
cross-field defect that the fix-review caught: core's `editSprint`
validates the window rule (`end < start`) against the *merged* record.
A forward window move (new start after the old end) sends `{start_date}`
as PUT#1, which merges against the *old* `end_date` and 400s — an edit
that is valid as a whole is silently blocked, and a multi-field save
could land PUT#1 and then fail PUT#2, leaving a partial write. The
server's `handleUpdateSprint` already merges the whole body, so a single
`{name?,start_date?,end_date?,state?,goal?}` request validates against
the final record. `save()` now builds one combined patch of the changed
fields and issues **one** mutation; `useUpdateSprintMeta`'s
`SprintMetaPatch` already carried every field as optional, so no new
hook was needed. SPR-28 still holds — only the fields the user changed
are in the body, so a concurrent CLI edit to an untouched field is not
overwritten.

**Why option 2.** It removes the forward-move block and the
partial-save window, keeps SPR-33/SPR-37 (on rejection the disk keeps
the last accepted value and the editor stays open with an anchored
error), and is one request instead of N. The per-field reasoning
option 1 was meant to preserve turned out to be the thing causing the
bug, not protecting against it.

**State-error attribution (same fix).** The server stamps *every*
`SprintError` from `handleUpdateSprint` with `field: "end_date"`. The
header no longer trusts that blindly: `attributeSprintError` reads the
message so a `state transition … not allowed` rejection anchors under
the State control (now rendered — `errorFor("state")` was computed but
never shown before), the window rule keeps `end_date`, and anything
else falls back to the generic `Callout` — a state error is never
stapled under End date. Server-side attribution was left alone (server.ts
logic is out of this lane); the client correction is sufficient and the
message strings are core's, tested by the SPR-37 state-transition case.

**To revert.** `apps/web/src/client/sprints/SprintMetaHeader.tsx`
(`editing` draft state, `save` combined-PUT, `attributeSprintError`,
`ANCHORABLE`). The old commit-on-blur version is in git history. Tests:
`apps/web/src/client/sprints/SprintMetaHeader.test.tsx` and the SPR-7/
8/13/25/26/28/33/34/37 cases in `tests/ui/flow-sprints.spec.ts`, which
were updated from the commit-on-blur interaction to click Edit → fill →
Save (see A148's note that this is an interaction change, not a
bug-encoding test).

### A148 · The SPR-7/8/… e2e specs were updated for the Edit gate — an interaction change, not a bug fix

**Ticket:** B2 · **Date:** 2026-09-06 · **Commit:** (staged)

**The situation.** `tests/ui/flow-sprints.spec.ts` had ~10 tests that
drove the header by `fill()` + `blur()` on `sprint-meta-*` inputs and
read fields back via `toHaveValue`. SPR-8's move to read-by-default
means those inputs exist only in edit mode, and reads now target the
`sprint-meta-*-value` read elements.

**What had to be decided.** These are green tests being edited by a
change — is any of them encoding the old (superseded) behaviour as a
bug (per the CLAUDE.md rule "if a fix requires editing a green test,
that test was asserting the bug")?

**Decided.** No — this is an interaction-model change SPR-8 explicitly
mandates ("Supersedes the earlier commit-on-blur / commit-on-change
framing"), not a corrected bug. The specs were updated to: read the new
`*-value` elements in read mode; click `sprint-meta-edit` before
touching inputs; click `sprint-meta-save` to commit. SPR-33/SPR-37 were
reworked so the rejected draft stays in the open editor (the case's
"correct it without reloading") rather than reverting the field in
place, which was the old blur model's behaviour.

**Why.** The persistence guarantees each case asserts are unchanged;
only the trigger moved, exactly as SPR-8 states. `flow-sprints.spec.ts`
is normally the E2E lane's file — this cross-lane edit was unavoidable
because the SPR-8 component change breaks the old interaction; flagged
as a handoff so the E2E lane is not surprised.

**To revert.** The SPR-7/8/13/25/26/28/33/34/37 test bodies in
`tests/ui/flow-sprints.spec.ts`.

### A149 · Sprint archive/unarchive from the web is NOT built — no server route exists

**Ticket:** B2 (SPR-40) · **Date:** 2026-09-06 · **Commit:** (staged)

**The situation.** SPR-40 asks for "create / delete / archive /
unarchive … reachable from the Settings panel", and itself notes
"Archive needs `archived` on `handleUpdateSprint` (server) plus a
'show archived' toggle." Create (`POST /api/sprints`), delete
(`DELETE /api/sprints/:id`) and edit (`PUT /api/sprints/:id`) routes
exist. **No web route archives a sprint:** there is no
`/api/sprints/:id/archive`, and `handleUpdateSprint` does not accept
`archived` (core's `editSprint` preserves `archived` untouched and
never sets it). Core has `archiveSprint`/`unarchiveSprint`, unused by
the web layer. Labels/milestones/users/tasks all have `/archive` +
`/unarchive` routes; sprints are the one config object that does not.

**What had to be decided.** Build the archive/unarchive control by
adding the missing route (out of my lane — server.ts is owned
elsewhere and the ticket says "STOP and report" if a new route is
needed), or ship the buildable parts and flag the gap?

**Decided.** Shipped **create + delete + the "show archived" split**
(the split reads correctly today because `GET /api/sprints?counts=true`
returns archived sprints via `loadSprintsConfig`). Did **not** build
archive/unarchive controls, because wiring a button to a route that
does not exist would be a dead or lying control. Reported as a blocking
handoff.

**Why.** The instruction was explicit: do not add routes; STOP and
report if one is needed. SPR-40's archive bullet is not satisfiable
from the client alone.

**To revert / to complete.** Add either `POST /api/sprints/:id/archive`
+ `/unarchive` (mirroring labels) calling core `archiveSprint`/
`unarchiveSprint`, OR accept `archived` on `handleUpdateSprint`. Then
add a `useArchiveSprint` hook and an Archive/Unarchive button per row
in `apps/web/src/client/settings/SprintsPanel.tsx` (the archived-split
UI is already there). See `known-gaps.md`.

**RESOLVED (B2 follow-up, 2026-09-06, staged).** Took the first option:
added `POST /api/sprints/:id/archive` and `/unarchive` mirroring the
label routes (dedicated routes, not an `archived` field on PUT, because
core's `editSprint` preserves `archived` untouched). Added
`useArchiveSprint` (mirroring `useArchiveLabel`) and a per-row
Archive/Unarchive `Button` in `SprintsPanel`. Server round-trip +
CSRF + unknown-sprint tests in `server.data-delete.test.ts`; client
button tests in `SprintsPanel.test.tsx`, both shown red-first. CLI
(`sprint archive`/`unarchive`) and MCP already had this — web-only
parity, no CLI/MCP change. SPR-40 is now fully met.

**SPR-40 acceptance-criterion rewrite (B2 fix-review, verified).** The
SPR-40 case in `flow-sprints.md` originally read "Archive needs
`archived` on `handleUpdateSprint` (server) plus a 'show archived'
toggle." The follow-up rewrote that bullet to "Archive/unarchive are
their own routes — `POST /api/sprints/:id/archive` and `/unarchive`
(mirroring labels, since core's `editSprint` preserves `archived`
untouched) — with a per-row Archive/Unarchive button and a 'show
archived' toggle." The fix-review flagged this as a ticket editing its
own criterion. **Verdict: the rewrite is correct and is kept.** The old
criterion described a design that cannot work: `editSprint` never sets
`archived`, so an `archived` field on PUT would be silently ignored — a
lying control. The route-based design supersedes it, the routes exist
and match (`SPRINT_ARCHIVE_RE`/`SPRINT_UNARCHIVE_RE` → `handleArchiveSprint`
/`handleUnarchiveSprint`, dispatched in `createWebApp`), and the client
(`useArchiveSprint`, `SprintsPanel`) calls exactly those paths. The
"would ship a 404" staging split the fix-review warned of was already
resolved in the tree by the time of this pass: the server routes,
regex constants, imports, and dispatch entries are all staged alongside
the UI, so the committed index does not point a button at a missing
route.

### A150 · `sidebar_groups` shape (SHL-45): two ordered id lists, tolerant reader

**Ticket:** B2 (K-10 / SHL-45) · **Date:** 2026-09-06 · **Commit:** (staged)

**What had to be decided.** The stored shape of the per-user
`sidebar_groups` setting — one array of `{id, hidden}` vs two ordered
lists — and where corruption tolerance lives.

**Decided.** `sidebar_groups: { order?: SidebarItemId[]; hidden?:
SidebarItemId[] }` — two ordered id lists. `order` holds the ids the
user has an opinion about (any built-in not listed follows in default
position, still visible); `hidden` holds the ids to hide. Ids cover both
the built-in **groups** (`views`, `projects`, `saved-filters`,
`milestones`, `sprints`, `labels`, `recents`) and the built-in
**filters** (`assigned-to-me`, `reported-by-me`, `mentions-me`,
`due-this-week`, `overdue`, `high-priority`) — both hideable AND
reorderable per Ken's 2026-09-06 ruling. The catalog lives in
`@loctt/contracts` (`SIDEBAR_GROUP_IDS` / `SIDEBAR_FILTER_IDS` /
`SIDEBAR_ITEM_IDS`); the schema (`SidebarGroupsSchema`) is `.strict()`
and rejects duplicates so a clean save stays clean.

**Why two lists.** A single ordered `{id, hidden}` array cannot express
"hidden but remembered in this position", which reorder-then-hide-then-
show needs. Two lists can, and each degrades independently.

**Corruption model (per corruption-handling-guide).** Tolerance lives in
the *reader* (`core/users/sidebarGroups.ts`), not the schema, and it is
**field-local**: an unknown or duplicate id is dropped from its list, the
other valid ids in the list are kept, and only a wholly-unshaped value (a
scalar, a bare list — no `{ order?, hidden? }` structure to preserve)
becomes "no customization" (default order, all visible). The single
tolerance point is `salvageSidebarGroups`, which `readSidebarGroups`
delegates to.

**B2 fix (bug 5): the loader now salvages per-field too.** Originally
`sidebar_groups` was a KNOWN key in `settings.ts`'s `KNOWN_SETTINGS_KEYS`
that the tolerant loader (`parseSettingsTolerant`) dropped **whole** when
corrupt — so the reader's per-field salvage was dead on the loaded-
settings path, and this record + the docstrings claimed a per-group
degrade the code did not deliver. Fixed by option (a): `parseSettings-
Tolerant` runs a faulting `sidebar_groups` through `salvageSidebarGroups`
and keeps the salvaged value in-place (falling back to a full drop only
when nothing survives). Every other known key still degrades whole; only
`sidebar_groups` is salvaged per-field, because it holds two independent
id lists. Chosen over option (b) (correct the docs to whole-key drop)
because the guide's building blocks made it contained and it is what the
framework's field-local principle wants. The green test that asserted the
whole-key drop (`sidebarGroups.test.ts`) was one of the "green test
asserting the bug" class and was rewritten.

**Doctor (bug 6).** `checkDataIntegrity` now reports a salvaged
`sidebar_groups` per user: `collectSidebarGroupsDrops` reads the raw
settings and names each dropped id (`malformed`, non-blocking — the valid
ids still load and the sidebar renders). Built rather than deferred (the
guide's "what to add to doctor" made it small).

`resolveSidebarOrder` turns the stored setting into the ordered, hide-
annotated list every surface renders from; it is resolved against the
FULL item catalog (groups + built-in filters), so a hidden *filter*
round-trips through read on every surface (B2 bug 3).

**Parity.** Web (Settings → Personal → Sidebar groups panel +
Sidebar.tsx render), CLI (`loctt user sidebar-groups`), MCP
(`get_sidebar_groups` / `set_sidebar_groups`). All three resolve the full
catalog on read, and both write surfaces (CLI `--order`/`--hidden`, MCP
`set_sidebar_groups`) **reject** an unknown id with an error naming it
rather than silently dropping it (B2 bug 4) — a typo must not no-op.
Duplicates are de-duplicated silently. CLI + MCP reference docs updated.

**To revert.** Remove `sidebar_groups` from `UserSettingsSchema` and
`KNOWN_SETTINGS_KEYS`, delete `core/users/sidebarGroups.ts` (incl.
`salvageSidebarGroups` / `validateSidebarIds`) + its barrel/index/
package.json subpath export, the `collectSidebarGroupsDrops` collector in
`settings.ts` and its wiring in `diagnostics/integrity.ts`, the salvage
call in `parseSettingsTolerant`, the web `SidebarGroupsPanel.tsx` +
`settings/sidebarGroups.ts` + the section entry + the `SidebarGroups`
wrapper in `Sidebar.tsx` (restore the inline group list), the CLI
subcommand, and the two MCP tools (+ the e2e schema snapshot). The
setting degrades to absent, so any stored value is simply ignored.

### A151 · Header search (SHL-46) is a debounced dropdown + Enter-to-list

**Ticket:** B2 (K-10 / SHL-46) · **Date:** 2026-09-06 · **Commit:** (staged)

**What had to be decided.** How the dead header search box (Header.tsx,
input had no handler) should behave once wired to `/api/search`.

**Decided.** As-you-type (250ms debounce) fires `GET /api/search?q=…`
and shows a results dropdown; clicking a hit navigates to that task;
pressing Enter navigates to `/list?q=…` (the full result set, browsable
with the list's own tooling); `/` focuses the box from anywhere unless
already typing in a field (A11Y-2 reachable). Consumes the existing
`/api/search` endpoint unchanged.

**Why.** SHL-46 offers "shows results / navigates" as alternatives; the
dropdown gives the fast path (jump to a known task) and Enter gives the
thorough path (browse all matches) without a new results route. The
"+ New filter" entry in Sidebar.tsx (hardcoded disabled) was enabled in
the same lane to open the existing `SaveViewDialog` (create-view flow).

**B2 fix (bug 1): Enter must emit a valid DSL query, not raw text.** The
list's `q` is a DSL expression fed straight to `/api/tasks?query=…` (via
`tasksParamsFromSearch`) and parsed by core's query DSL — `buildDslFrom-
Search` even wraps it in parens as `(q)`. Enter used to route
`q: "<raw>"`, so a plain word (`hello`) or a parenthesised one (`(bug)`)
became `(hello)` / `((bug))` → ParseError → "Could not load tasks". SHL-
46's headline path was broken end-to-end. Fixed: `goToList` wraps the
text in the same `text ~ "<q>"` clause `/api/search` builds (server.ts
quotes with `JSON.stringify`), so a plain-word Enter resolves to the
identical substring match the dropdown just ran. "See all results" shares
`goToList`, so it is fixed by the same change.

**B2 fix (bug 2): one owner for `/`.** `/` → focus-search is owned solely
by the shell's global shortcut registry (AppShell → `useGlobalShortcuts`
→ the `focus-search` shortcut, which finds the box by `type="search"`).
Header had ALSO added its own `document` `keydown` for `/`, double-
binding the key and bypassing the registry's dialog/typing guard. Header's
listener was removed; the registry is the single owner (covered by
`useShortcuts.test.tsx` / `shortcuts.test.ts`, and end-to-end by the
A11Y-2/A11Y-8 test in `flow-accessibility.spec.ts`, which was un-blocked
now that the box is enabled).

**To revert.** Restore the disabled `<input>` in Header.tsx and remove
`HeaderSearch` + `api/hooks/useSearch.ts`; re-disable the "+ New filter"
button in Sidebar.tsx. (The Enter-DSL wrap and the `/`-listener removal
are corrections, not reversible design choices — reverting them
re-introduces the two bugs.)

### A154 · Workflow key-usage gains a whole-field count (`custom_fields`); the field-delete blast radius counts every type

**Ticket:** B2 (workflow settings — fix wave) · **Date:** 2026-09-06 · **Commit:** (staged)

**The situation.** `computeWorkflowKeyCounts` returned `custom_field_values`
(field key → enum-value key → task count) and the Custom fields panel drove
the whole-field delete confirm off `sumCounts(custom_field_values[field])`.
A number or boolean field has no enum values, so that sum is always 0 —
the destructive confirm told the user "affects nothing" while the server's
field-level sweep silently cleared the field from every task holding it
(the silent-loss shape). Confirmed by the B2 fix-review (Workflow bug #8).

**What had to be decided.** Where the whole-field blast radius is computed,
and how the surfaces report it.

**Decided.** Add `custom_fields: Record<string, number>` to
`computeWorkflowKeyCounts` — tasks holding *any* value for the field,
whatever its type (a non-empty array counts once; `null`/`undefined`/`[]`
do not). It is orthogonal to `custom_field_values`, which stays per enum
value. Surfaced for parity on all three read surfaces (P10): the web
confirm now reads `custom_fields[field]`; `loctt config usage` prints a
per-field total line with the enum breakdown nested under it; MCP
`get_workflow_key_usage` returns the new map (its description names it).
`WorkflowUsageResponse` gained the typed field.

**Why.** The count is a property of the tasks, not of any one surface, so
it belongs in core with one definition three surfaces read. Fixing it only
in the web panel would leave the CLI/MCP reporting the same blind spot.

**To revert.** Remove the `custom_fields` accumulator and `holdsFieldValue`
from `packages/core/src/config/workflow-write.ts` (`computeWorkflowKeyCounts`),
the field from `WorkflowUsageResponse`, the `fieldCounts` prop in
`CustomFieldsPanel.tsx` (restore `sumCounts`), the CLI per-field line in
`apps/cli/src/commands/config.ts`, and the MCP description note.

### A155 · Workflow Edit dialogs carry presentational fields (icon/color) through unedited

**Ticket:** B2 (workflow settings — fix wave) · **Date:** 2026-09-06 · **Commit:** (staged)

**The situation.** The Relationship and Custom-field Edit dialogs rebuilt
the saved row from the draft alone (`buildRelationship` / `buildCustomField`),
and neither renders an icon or color control. So editing a relationship's
label wiped its `icon`/`color`, and editing an enum field wiped every
value's `icon`/`color` — a silent drop of valid config. (The statuses /
priorities / task-types Edit path already spread `...target`, so it was
already safe; a regression test now locks that.) Confirmed by the B2
fix-review (Workflow bug #7).

**What had to be decided.** How a dialog that does not render a field
preserves it on save.

**Decided.** Seed the dropped fields into the draft from the row being
edited and re-emit them: `RelationshipDraft` and `CustomFieldDraft.values`
carry optional `icon`/`color`; the dialogs seed them from `initial`, and
the `build*` helpers spread them back onto the written row (only when
present, to respect `exactOptionalPropertyTypes`).

**Why.** It matches the pattern the statuses path already used (preserve
the original, edit the fields the dialog owns) and keeps the fix in the
pure form helpers, where the wire shape is pinned by unit tests, rather
than in the panels.

**To revert.** Drop the `icon`/`color` fields from `RelationshipDraft` and
`CustomFieldDraft.values` in `workflowForms.ts` and stop seeding/spreading
them in `RelationshipEditDialog.tsx` / `CustomFieldEditDialog.tsx`.

### A156 · The workflow panels surface the tolerant `broken` config as an error pane (fixes K32 / SET-33)

**Ticket:** B2 (workflow settings — fix wave) · **Date:** 2026-09-06 · **Commit:** (staged)

**The situation.** `loadWorkflowConfig` degrades a hand-broken entry
tolerantly: `GET /api/workflow` returns 200 with the bad entry omitted
from its sub-list and recorded under `broken`, never a 400. But
`WorkflowPanelFrame` only rendered its error pane on a hard `isError`
(a 400), so a broken `workflow.yaml` rendered an empty list — exactly
SET-33's forbidden outcome ("not an empty list, which would read as you
have no statuses"). Recorded as K32, pre-existing, and the
flow-settings-workflow spec's SET-33 failed on it.

**What had to be decided.** Whether to reword SET-33 to the tolerant
reality or make the panel surface `broken`.

**Decided.** Make the panel surface it. When `workflow.data.broken` has
any entry, `WorkflowPanelFrame` renders the same `workflow-panel-error`
surface an unparseable config would (`data-workflow-error="config-invalid"`,
a `workflow-broken-list` naming each entry's validator error, the file
path, and a `workflow-reload` button that re-reads without a server
restart), and does not render the collection list.

**Why.** The flow doc is the spec, and SET-33 is right that an empty list
is the wrong signal for a broken file. The tolerant degrade is the correct
*data* behavior (P5); the panel's job is to make it visible, the same way
`SavedViewsPanel` already surfaces its own `broken` list.

**To revert.** Remove the `brokenEntries` branch from
`apps/web/src/client/settings/WorkflowPanelFrame.tsx`.

### A157 · DEG-7's green coverage is a *core* round-trip, not a client render — the "Not recognised" group is untested on any surface

**Ticket:** B3 (step 0 — cases before code) · **Date:** 2026-09-07 · **Commit:** (staged)

**The situation.** `cases:coverage` reports DEG-7 **covered**, but its only
`@verifies` tag is a *core* round-trip test
(`packages/core/src/task/frontmatter.test.ts:171`). No **client** file
renders any "Not recognised" unrecognised-field group — a grep of
`apps/web/src/client` finds only `cells.tsx:107`'s sr-only
"(unrecognised)". So DEG-7's green tag does not mean the surface exists:
the "shown in a 'Not recognised' group, read-only, with a remove control"
bullet has no test on any UI surface. This is a coverage-tool blind spot —
a core `@verifies` can satisfy a UI case.

**What had to be decided.** Whether to treat DEG-7 as done (its tag is
green) or to record that its client rendering is unbuilt and untested, and
bind the fix to a specific lane.

**Options considered.**
- Trust the green tag and move on — costs a false "covered" that hides a
  missing UI surface, exactly the failure mode `tools/README.md` warns
  about.
- Record the blind spot and require B3's Task-meta / UX-7 lane to tag DEG-7
  from a *client* test that renders the group on the task-detail page —
  costs one recorded gap now, closes it deliberately later.

**Decided.** Record it (here + `known-gaps.md`) and fold the client-facing
requirement into DEG-29's new bullet: an unrecognised preserved field is
visible on the task-detail page in DEG-7's "Not recognised" group,
rendered by a client component. B3's Task-meta lane must tag DEG-7 from a
client test, not lean on the core round-trip.

**Why.** A core `@verifies` satisfying a UI case is precisely the "case
that stops at the boundary" pattern this repo has already been bitten by.
Leaving the green tag unqualified would let the UI inherit the omission.

**To revert.** If DEG-7 is judged adequately covered by the core test
alone, drop the DEG-29 "Also:" bullet in
`docs/dev/ui-test-cases/flow-degradation.md` and this note's requirement
that the DEG-7 tag come from a client test.

### A158 · MetaPanel renders corrupt/unrecognised fields from the existing `TaskResponse.health` payload — no server/core change (DEG-29 / DEG-7)

**Ticket:** B3 (Task-meta / degradation) · **Date:** 2026-09-08 · **Commit:** (staged)

**The situation.** `MetaPanel.tsx` rendered a corrupt field (its value
lifted into `health` by the tolerant parse) as a bare "—", and rendered
no unrecognised-field group at all. DEG-29/UX-7 want the corrupt value
shown with a warning + clear/repair, and DEG-7's "Not recognised" group
rendered by a client.

**What had to be decided.** Where the field-health + unrecognised data
comes from, and whether the server/core needed a change.

**Decided.** Render entirely from the payload the API *already* delivers.
`GET /api/tasks/:ref` (`handleGetTask`) has carried `health` — including
`kind: "unrecognised"` entries — since Phase-7B; the client view-model
helpers (`fieldView`, `unrecognisedHealth`, `WireHealth` in
`apps/web/src/client/health/fieldHealth.ts`) already existed. So this lane
needed **no server or core change**: `TaskDetail` passes `task.data.health`
into `MetaPanel` (one additive line at the existing call site), and the
panel computes `corruptFor(field)` per row and lists `unrecognisedHealth`
in a new "Not recognised" group.

Two smaller calls inside that:
- **The corrupt notice sits *above* the still-usable editor**, not
  instead of it. The editor is the "repair" affordance (set a valid
  value); an explicit **Clear** beside it removes the field. Both write
  through the existing `onUnset`/`onSet` — core's `unsetField` already
  has a health-only branch that drops the raw value + its health entry,
  so Clear/Remove round-trips correctly with no new endpoint.
- **The "Not recognised" group render stays inside `MetaPanel`**, not a
  shared helper in `list/cells.tsx`. `cells.tsx` is owned by B4's
  Toolbar/List lane; the reusable primitives already live in the shared
  `health/fieldHealth.ts`, so no cross-lane file was touched.

**Why.** "A capability in core is not done until CLI and MCP have it" —
but here core/CLI/MCP already surface `health` (the CLI `show`/JSON and
MCP `get_task` carry it); the gap was purely that the web *client* did
not render it. Adding a server field would have been drift; rendering
from the existing payload is the honest fix.

**To revert.** Remove `UnrecognisedGroup` + `CorruptFieldNotice` and the
`health`/`corrupt`/`onClearCorrupt` props from `MetaPanel.tsx`, and drop
the one `health` passthrough line in `TaskDetail.tsx`. The API keeps
serving `health` regardless.

### A159 · Editor toolbar adds strikethrough/superscript/subscript buttons; math + mention buttons scoped out (TSK-65)

**Ticket:** B3 (Rich-text editor) · **Date:** 2026-09-08 · **Commit:** (staged)

**The situation.** TSK-65 (ED-1): "Strikethrough / superscript /
subscript / math / mention have toolbar buttons in rich mode, **or the
flow doc scopes them out.** These marks/nodes round-trip already; only
the toolbar affordance is missing." All five already survive save+reload
through `markdown.ts` and `extensions.ts`; the case is purely about the
toolbar affordance and explicitly permits a scope-out.

**What had to be decided.** Which of the five get a toolbar button now,
and which are scoped out.

**Options considered.**
- *All five.* Strike/sup/sub are one-line `toggle*` commands. But math
  and mention are atomic nodes that need a *value* to insert — a math
  button needs an expression-entry surface (a prompt or inline field);
  a mention button needs a user-picker. Mention already has a working
  `@`-trigger picker (`MentionMenu`), so a toolbar button would be a
  second, redundant entry path; math has no entry UI at all, and
  building one is a mark-vs-node insertion surface, not a toggle.
- *The three cheap marks now, math + mention scoped out.* Strike, sup
  and sub are pure toggles reachable via `toggleStrike` /
  `toggleMark("superscript"|"subscript")`, so they cost a button each
  and nothing more.

**Decided.** Add strikethrough, superscript and subscript toolbar
buttons; scope out the math and mention buttons.

**Why.** The three added are genuinely free (a toggle command already in
the schema). Math needs an expression-entry affordance and mention
already has its `@`-picker, so a mention *button* would duplicate an
existing path and a math button would front a UI that does not exist —
both are new affordances, not "the missing button", which is more than
TSK-65 asks for and would be scope creep. The case sanctions the
scope-out in its own text.

**To revert.** In `apps/web/src/client/editor/Toolbar.tsx`, add a
`math` button (needs an expression-entry surface — a `window.prompt`
inserting an `inlineMath`/`blockMath` node, or an inline field) and a
`mention` button (insert a `mention` node, or open `MentionMenu`
programmatically). The marks/nodes already round-trip, so no
`markdown.ts` or `extensions.ts` change is required.

### A160 · GFM pipe-table left as-is for now; TSK-66 scoped out (fix belongs in core `lossy.ts`, another lane's file)

**Ticket:** B3 (Rich-text editor) · **Date:** 2026-09-08 · **Commit:** (staged)

**The situation.** TSK-66 (ED-2): "A GFM pipe-table in the body is
either parsed to a table or forces raw mode via lossy-content detection
— never shown as literal paragraph text." Today `fromMarkdown`
(`apps/web/src/client/editor/markdown.ts`) has no table branch, so a
pipe table becomes literal paragraph text in the rich editor; and
`findLossyConstructs` (`packages/core/src/markdown/lossy.ts`) does not
list tables, so raw mode is not forced either. `@tiptap/extension-table`
is installed but **not** registered in `LOCTT_EXTENSIONS`.

**What had to be decided.** Which of the two sanctioned outcomes to
build — parse-to-table, or force-raw-via-detection — within the B3
editor lane's file ownership (`editor/*.tsx` + `markdown.ts`), and
whether either is cheap enough to land now.

**Options considered.**
- *Force raw mode via lossy detection.* The smaller, safer fix, but it
  edits `packages/core/src/markdown/lossy.ts` — a **core** file owned by
  a different lane (the K-10 / degradation / core tracks), not the B3
  editor lane. Reaching into it here is cross-lane drift, and the case
  also wants the CLI/MCP to agree (lossy detection is shared), so it is
  genuinely a core change with its own surface-doc obligations.
- *Parse to a table.* Stays in `markdown.ts`, but is substantial:
  register `Table`/`TableRow`/`TableHeader`/`TableCell`, add a table
  branch to `fromMarkdown` **and** a byte-faithful `toMarkdown`
  serializer, all without regressing TSK-17's round-trip invariant
  (pipe-table alignment rows, escaped pipes, and column padding are all
  many-to-one spellings — the exact hazard `markdown.ts`'s header
  comment warns about). High risk for a P7 minor.

**Decided.** Scope TSK-66 out of B3; do not tag it. Leave the pipe-table
behaviour unchanged for now and record the fix as belonging to the core
lossy-detection track.

**Why.** The cheap, correct fix (force raw mode) lives in a core file
this lane does not own and carries CLI/MCP parity obligations, so it is
not a contained editor-lane change. The in-lane alternative (full table
parse+serialize) is a real risk to the TSK-17 byte-identical invariant
for a minor case. Neither is the "contained, cheap, reversible" shape
that §8 sanctions doing silently, and the case explicitly allows a
documented scope-out. The current behaviour is not data-loss: a pasted
or typed pipe table is shown as its literal source text (visible, not
dropped), and a user can edit it in raw mode.

**To revert (i.e. to implement TSK-66).** Preferred: add a `gfm_table`
kind to `LossyConstruct` and a pipe-table branch to `findLossyConstructs`
in `packages/core/src/markdown/lossy.ts` (a header row followed by a
`| --- | --- |` delimiter row), so `BodyEditor`'s existing `forcedRaw`
path fires; update `docs/user/cli/reference.md` + `docs/user/mcp/reference.md`
per the "core capability" rule, and add a `doctor`/schema note if
warranted. Alternative (in-lane): register the four table extensions in
`apps/web/src/client/editor/extensions.ts`, add table branches to
`fromMarkdown`/`toMarkdown` in `markdown.ts`, and extend
`markdown.test.ts` with a round-trip that proves TSK-17 still holds for
tables.

### A164 · The MetaPanel corrupt-field notice fires only for value-lifted health kinds

**Ticket:** B3 fix-review (Task-meta / degradation) · **Date:** 2026-09-07 · **Commit:** (staged)

**The situation.** The B3 fix-review found `fieldView`'s `fieldHealth`
(`apps/web/src/client/health/fieldHealth.ts`) was
`list.find(h => h.field === field)` with **no kind filter** — despite its
own docstring saying it returns only the whole-field-lifted faults. So an
*extrinsic* fault whose value is still on `frontmatter` — a `dangling`
assignee (deleted user) or an `invalid_value` (enum/custom-field-type
drift) — rendered a `⚠ corrupt: ghost` notice with a **Clear** control
directly ABOVE the field's own picker, which still held `ghost`. A double,
mislabelled signal for a value that is not actually lost.

**What had to be decided.** Which health kinds get the "⚠ corrupt +
Clear/repair" inline notice in the meta panel?

**Options considered.**

1. **Only value-lifted kinds** (`wrong_type`, `missing_required`,
   `unrecognised`). These are the faults where the tolerant parse lifted
   the value OFF `frontmatter`, so the row would otherwise show a bare "—"
   hiding a real stored value — which is the whole reason DEG-29's notice
   exists. Extrinsic faults keep the value on `frontmatter`, so the
   field's own picker renders it (with its own orphaned/missing marker).
   Matches the function's long-standing docstring.
2. **Every whole-field kind, including extrinsic.** A dangling user or an
   out-of-vocabulary enum also gets the corrupt notice + Clear. Costs the
   double signal above, and a "corrupt" label for a value that is a valid
   scalar the workflow simply no longer recognises.

**Decided.** Option 1 — filter `fieldHealth` to
`{wrong_type, missing_required, unrecognised}` (a `VALUE_LIFTED_KINDS`
set). This is a UX judgment about degradation surfacing, made at the
agent level to match the documented intent and remove the mislabel;
flagged for Ken as the one B3 fix-review item that is a taste call rather
than a defect. If Ken wants extrinsic faults (a dangling assignee, enum
drift) ALSO surfaced with the corrupt notice + a one-click Clear — instead
of only their picker's own orphaned indicator — this is where to change
it.

**Ken delegated this PM call to the agent, 2026-09-09 — KEPT as shipped.**
A dangling assignee or a dropped enum value is a valid value whose
referent changed, not corruption: the field's own picker already signals
"unknown" there, and a second red "⚠ corrupt + Clear" banner would
mislabel a recoverable state and push "Clear" (wipe the field) over the
real fix (reassign / pick a valid value). The notice earns its place only
where the value is otherwise invisible — the value-lifted faults.

**To revert.** Drop `VALUE_LIFTED_KINDS` and restore
`const fieldHealth = list.find(h => h.field === field)` in
`fieldView` (`apps/web/src/client/health/fieldHealth.ts`), and adjust the
MetaPanel custom-field corrupt test back to an extrinsic `invalid_value`
kind.

### A165 · SPR-39's "mini-burndown or equivalent" on the overview is a progress mini-bar, not a per-sprint burndown fetch

**Batch:** B4 · Sprints overview lane · **Type:** agent decision (UX + cost).

SPR-39 asks each sprint card on the `/sprints` overview to surface
progress (done/total), the date range, days-remaining/overdue, and **"a
mini-burndown or equivalent"**. The overview is a *board of columns*; the
"card" is each column's header.

**What had to be decided.** What renders as the "mini-burndown or
equivalent" on a column header.

**Options considered.**

1. **A real per-sprint burndown sparkline.** Reuse `useBurndown` +
   `buildGeometry` per column. Faithful to the word "burndown", but it is
   one `GET /api/sprints/:id/burndown` per visible sprint on every
   overview load — and core's `computeBurndown` replays every task's
   history. The detail page pays this once, for one sprint, deliberately
   as its own query (see `useSprintDetail.ts`). Paying it N-up on the
   overview is the cost the board-pages-to-exhaustion note already frets
   about, multiplied.
2. **A progress mini-bar** derived from the same core `Progress`
   (`?progress=true`, `progressState`) already surfaced on the detail
   page (F1/K30). One list fetch the view already makes, the same
   done/total math, rendered as a compact fill bar in the header. This is
   the case's explicit "or equivalent".

**Decided.** Option 2. The mini-bar reuses `useSprintsWithProgress` +
`progressState` (the milestones-shared readout), so the number on the
overview equals the number on the detail page by construction, at no new
per-sprint request. The literal burndown chart stays on the detail page,
one Open-away.

**To revert.** Swap the header's `SprintMiniProgress` for a per-column
`useBurndown` sparkline (accept the N-fetch cost) in `SprintsView.tsx`.

### A166 · SPR-40's overview affordances = a "show archived" toggle + a Manage-in-Settings link; lifecycle CRUD stays in the Settings panel

**Batch:** B4 · Sprints overview lane · **Type:** agent decision (scope).

SPR-40's case text pins create/delete/archive/unarchive **to the Settings
panel**, and B2 built exactly that (`SprintsPanel`, `useCreateSprint` /
`useDeleteSprint` / `useArchiveSprint`; `@verifies SPR-40` on
`SprintsPanel.test.tsx` and `server.data-delete.test.ts`;
`cases:coverage --require SPR-40` already passes). The B4 lane brief asks
for archive/unarchive **parity from the overview** too.

**What had to be decided.** How much lifecycle UI the *overview* grows,
without duplicating the Settings panel or inventing scope past the case.

**Decided.** The overview gains the two affordances SPR-1 and SPR-40
imply but that were missing from `SprintsView`:

- a **"Show archived (N)"** toggle — SPR-1's own last bullet ("Archived
  sprints do not appear unless an explicit 'show archived' affordance is
  enabled") had no implementation on the overview; `deriveSprintColumns`
  already took a `showArchived` option that nothing passed. This is the
  overview's half of archive/unarchive parity: seeing archived sprints
  where the work is.
- a **"Manage sprints in Settings →"** link, so create/delete/archive
  are reachable *from* the overview (one click) rather than only by
  navigating the settings tree — mirroring `MilestonesView`'s
  Settings link.

The lifecycle *writes* (create/delete/archive) are NOT duplicated onto
the overview: two archive buttons on two surfaces is the drift SPR-40's
"same shared dialog … cannot drift" note guards against, and the case
locates them in Settings. The overview surfaces + links; Settings acts.

**To revert.** Remove the `showArchived` state + toggle and the
Settings link from `SprintsView.tsx`; the columns revert to
non-archived-only.

### A167 · SPR-31 un-fixme'd: the correct surface is the per-entry `sprints-broken-config` alert, not the whole-file `sprints-config-error`

**Batch:** B4 · Sprints overview lane · **Type:** agent decision (test fix).

The quarantined `SPR-31` fixme (and the known-gap "read-only views do not
surface degraded entries") asserted a `sprints-config-error` alert for a
single sprint whose `end_date` precedes `start_date`. It never rendered —
but not because the loader degrades silently. Core's `parseSprintsConfig`
runs `SprintDefSchema` per entry through `collectValidEntries`, and the
window rule is a **per-entry `superRefine`**, so a single bad sprint
becomes a `BrokenEntry` on the response's `broken[]`, not a whole-file
`SprintsConfigError`. `SprintsView` already surfaces that list as the
`sprints-broken-config` alert (built for A138, covered by
`SprintsView.test.tsx`). The fixme asserted the *wrong testid*: a
whole-file parse failure, for what core reports as one degraded entry.

**Decided.** Rewrite the SPR-31 spec to assert `sprints-broken-config`
(names the file, the offending sprint by id, and the validator's
`must not be before start_date` message; not the `sprints-empty` state),
which satisfies SPR-31's bullets against behaviour that already exists,
and un-fixme it. The overview's broken-config copy gained an explicit
"reload" + "will not repair" line so bullet 2 ("fix the file and reload —
no silent repair") reads on the surface, not only in the test.

Only the `sprints-config-error` whole-file branch remains for the
genuinely object-fatal cases (non-list `sprints:`, duplicate ids), which
`SprintsConfigError` still throws.

**To revert.** Restore the `test.fixme` on SPR-31 and its
`sprints-config-error` assertions; drop the "reload"/"will not repair"
line from the `sprints-broken-config` block in `SprintsView.tsx`.

### A169 · Priority's first-click sort defaults to descending (Critical-first)

**Ticket:** B4 Toolbar/List lane · **Date:** 2026-09-09 · **Commit:** (staged, uncommitted)

**The situation.** LST-54 (UX-2): "Clicking Priority sorts Critical-first
on the first click (not Low-first) … decide deliberately per the
workflow's documented priority order." The server (`packages/core/src/
query/list.ts:397`) orders priority by the workflow's numeric `value`
(critical=4 … low=1), and `ListView.onSort` used a single rule — first
click on any new column → ascending — which for priority surfaces Low
first and buries Critical. The case names Priority explicitly but frames
it as "priority (and due)" without stating due's direction.

**What had to be decided.** Which columns get a non-ascending first-click
default, and does due_date change?

**Options considered.**
1. **Per-column default map, priority→desc only** (chosen). Priority's
   first click lands Critical-first; every other column (due, title,
   updated, key, project, type, assignee) keeps ascending. Cost: one more
   column would need a decision to join the map.
2. **Also flip due_date** to some non-default. Cost: due ascending is
   already the most-useful first read (soonest-due first), so flipping it
   would be worse, and the case does not ask for it — it only names
   Priority's concrete outcome.

**Decided.** Option 1 — a `DEFAULT_SORT_DIR` map in `ListView.tsx` with
`priority: "desc"`; all other columns fall through to `asc`. The
toggle-on-repeat-click behaviour is unchanged.

**Why.** The case's only concrete assertion is Priority→Critical-first,
and the workflow's documented value order (critical highest) makes `desc`
the faithful reading. Ascending stays the most-useful first read for
dates/text/timestamps, so a blanket change would regress those. Contained
(one column, one map, trivially reversible).

**To revert.** Delete the `DEFAULT_SORT_DIR` map in
`apps/web/src/client/list/ListView.tsx` and restore
`const nextDir = sortField === colId && sortDir === "asc" ? "desc" : "asc"`
in `onSort`; drop the LST-54 unit test in `ListView.test.tsx` and the
LST-54 Playwright test in `tests/ui/flow-list.spec.ts`.

### A170 · A dedicated `--bg-row-hover` token, distinct from `--bg-muted`, for the list row hover

**Ticket:** B4 Toolbar/List lane · **Date:** 2026-09-09 · **Commit:** (staged, uncommitted)

**The situation.** K-15 (Ken's report): "project ID column bg doesn't
highlight, label colour disappears into hover; don't make the hover
colour so bright." The list row used `hover:[&>td]:bg-bg-muted`, but (a)
the key column is a `<th scope="row">`, so a `td`-only selector never
reached the ID/Project cells, and (b) the chips inside a row (`ProjectChip`
and a pending `StatusBadge`) paint themselves with `--bg-muted`, so a
row-hover reusing that exact token made every chip's own background vanish
into the hover. There was no separate row-hover token — only `--bg-muted`
(where the chips sit) and the *stronger* `--bg-muted-hover` (the button
active press).

**What had to be decided.** What colour is the list row hover, given it
must (a) differ from the chip background so chips stay legible, and (b)
stay subtle per Ken ("not so bright")?

**Options considered.**
1. **Reuse `--bg-muted-hover`** for the row. Cost: it is the button-press
   colour, deliberately a full step stronger — "so bright" is exactly
   what Ken rejected, and it still collides with a chip that later moves
   to `--bg-muted-hover`.
2. **New `--bg-row-hover` token** (chosen), a faint accent-tinted wash a
   step off the surface, defined once per theme, distinct from both
   `--bg-muted` and `--bg-muted-hover`; hover the whole row via `[&>*]`
   (covering the row-header th and the tds). Cost: one more token to keep
   in the scale.

**Decided.** Option 2 — add `--bg-row-hover` (`#F0F3FA` light / `#191A1D`
dark) to `tokens.css`, wire `--color-bg-row-hover` in `index.css`, and
change the row to `hover:[&>*]:bg-bg-row-hover`.

**Why.** A row hover and a chip background are two different surfaces and
need two tokens; sharing one is the root cause of the vanish. The exact
hex is a UI-taste call (subtle, per Ken) made at the agent level. `[&>*]`
rather than `[&>td]` is required so the `<th scope="row">` key cell is
included in the highlight (A11Y-26 made it a th).

**To revert.** Remove `--bg-row-hover` from both scopes in
`apps/web/src/client/styles/tokens.css` and `--color-bg-row-hover` from
`index.css`; restore `hover:[&>td]:bg-bg-muted last:[&>td]:border-b-0` on
the row in `apps/web/src/client/list/ListView.tsx`; drop the K-15
regression test in `ListView.test.tsx`.

### A171 · K33 read-then-edit: BodyEditor splits into a rendered view + an edit surface; the image lightbox needs a task-body renderer, not `renderCommentBody` verbatim

**Ticket:** B4 Description read-then-edit lane (K33) · **Date:** 2026-09-09 · **Commit:** (staged, uncommitted)

**The situation.** K33 (Ken, §9) makes the task description
read-then-edit. `BodyEditor.tsx` was an always-live editor. It is
reshaped into two states: a default RENDERED read view
(`editor/BodyRenderedView.tsx`, new) and the pre-K33 edit surface
(mode toggle + `RichEditor`/`MarkdownEditor` + `SaveIndicator` +
autosave + `BodyConflictDialog`), now mounted only while editing. A
click on the rendered text enters edit; blur flushes+returns, Escape
cancels, a failed save keeps the editor open (TSK-48). The
`data-testid="body-editor"` wrapper is present in BOTH states (one at a
time). The `BodyEditor` prop contract to `TaskDetail` is UNCHANGED — no
`TaskDetail.tsx` edit was needed.

**What had to be decided.** Three agent-level calls under Ken's model:

1. **How to reuse `comments/renderMarkdown.tsx` for the read view.**
   K33 says reuse the read-only renderer comments use. But
   `renderCommentBody` renders an image embed (`![alt](url)`, which
   `fromMarkdown` turns into an `attachmentEmbed` node) as a *text
   reference*, not an `<img>` — deliberately, because a comment
   attachment is an M2.5 reference with no URL to trust. TSK-70 needs a
   real `<img>` to click for the lightbox.

2. **How the lightbox dismisses**, and whether to reuse `ui/Modal`.

3. **The save/exit gesture** — settled by K33 itself (blur autosaves,
   Escape cancels), not re-decided here.

**Options considered.**
- *Call `renderCommentBody` verbatim.* Cost: no real `<img>`, so
  TSK-70's image→lightbox bullet is untestable — the image is a text
  span. Rejected.
- *A markdown→HTML pass with `dangerouslySetInnerHTML`.* Cost: exactly
  the injection surface `renderCommentBody` was built to not have.
  Rejected.
- *A small task-body renderer (chosen)* in `BodyRenderedView` that
  parses with the SAME shared `fromMarkdown` and reuses the SAME
  exported `isSafeHref` for the link/image scheme allowlist, rendering
  every node the way the comment reader does EXCEPT an image embed with
  a safe `http(s)`/relative `src`, which becomes a real clickable
  `<img>`. An unsafe scheme falls back to reference-text.
- *Reuse `ui/Modal` for the lightbox.* Cost: `Modal` forces a titled,
  `max-w-md` panel — the wrong shape for "show this image bigger". A
  minimal `<div role=dialog aria-modal>` overlay is used instead.

**Decided.** (1) `BodyRenderedView` is a small renderer that reuses
`fromMarkdown` + `isSafeHref` and adds the one node the comment reader
omits (image → `<img>`); links come through identically
(`target=_blank rel=noreferrer noopener`, unsafe schemes refused).
(2) The lightbox is a bespoke full-viewport overlay that dismisses on a
click anywhere and on Escape. (3) A blur that leaves the editor sets a
`wantsLeave` flag and flushes; an effect watching the save state
performs the actual return to rendered once the write settles to a
clean state, and holds the editor open if it settled `failed` or in
conflict (TSK-48) — this avoids reading a stale post-`await flush()`
closure.

**Why.** The image adaptation is the minimum that keeps K33's "same
renderer" intent (one parser, the same link/security handling, no
`dangerouslySetInnerHTML`) while satisfying TSK-70. The duplication is
one node (`attachmentEmbed`), documented in the file header. The
lightbox shape and dismiss gestures are UI-taste calls at the agent
level. The `wantsLeave` effect is load-bearing for TSK-48/71 being
correct rather than racy.

**To revert.** Restore `BodyEditor.tsx` to the single always-live
editor (git history), delete `editor/BodyRenderedView.tsx` and its
test, and drop the `BodyEditor.test.tsx` orchestration test. In
`tests/ui/flow-tasks.spec.ts`, delete the "TSK — K33 read-then-edit
description" describe block, the `enterEdit` helper, and revert the
B3-test migrations (TSK-59/61/62/63/64/67) to click `rich-editor`
directly on load. TSK-64's test was migrated (see A172).

### A172 · TSK-64's e2e test was migrated (not deleted) into TSK-68's stronger assertion; `flow-task-body.spec.ts` is left for the editor lane to migrate

**Ticket:** B4 Description read-then-edit lane (K33) · **Date:** 2026-09-09 · **Commit:** (staged, uncommitted)

**The situation.** K33 makes the whole description surface read-only
until entered, which SUPERSEDES TSK-64 (toolbar-collapses-until-focus).
Two consequences for the existing green Playwright specs:

1. **TSK-64's own test** asserted the collapse-on-focus behaviour — a
   now-superseded model. Per CLAUDE.md ("a fix requiring an edit to a
   green test means that test was asserting the old behaviour"), it was
   MIGRATED, not deleted: renamed `TSK-64/TSK-68` and rewritten to
   assert the stronger TSK-68 fact (no editor and no toolbar at all
   while viewing; both appear only after entering edit). Also in the
   owned file, the B3 editor tests (TSK-59/61/62/63/67) gained an
   `enterEdit(page)` gesture because they reach for `rich-editor`, which
   no longer exists on load.

2. **`tests/ui/flow-task-body.spec.ts`** (NOT this lane's file — the
   editor lane owns it) breaks wholesale: its `typeInBody` helper and
   ~15 tests click `body-editor › rich-editor` immediately after
   `goto`, and that surface is now absent until the rendered view is
   clicked.

**What had to be decided.** Migrate `flow-task-body.spec.ts` here too,
or leave it for the editor lane?

**Options considered.**
- *Migrate it here.* Cost: ~15 tests in another lane's file, edited
  while that lane has uncommitted work in the same tree (SprintsView is
  dirty; parallel work is live). The enter-edit helper shape is a
  decision that belongs to the file's owner, and a heavy cross-lane
  edit risks a merge clobber — exactly the stacking the ownership
  boundary prevents.
- *Leave it, record the breakage and the mechanical fix (chosen).*

**Decided.** Left `flow-task-body.spec.ts` untouched; recorded the
breakage in `known-gaps.md` with the exact mechanical fix (add an
`enterEdit` gesture / thread it through the `typeInBody` helper). The
owned split-gate (`flow-tasks.spec.ts` editor+K33 tests) is green.

**Why.** The K33 change is correct and its consequence for that file is
real, but *how* those ~15 tests enter edit is the editor lane's call,
and editing their file mid-flight is the load-bearing cross-lane risk
condition-4 warns against. The fix is mechanical and fully specified in
known-gaps, so the handoff loses nothing.

**To revert.** Not applicable — no code was written for this decision;
it records what was deliberately NOT edited. The migration itself, when
the editor lane does it, mirrors the `enterEdit` helper in
`flow-tasks.spec.ts`.

### A173 · R2 mobile sidebar: overlay driven by a window-event collapse signal, not a new AppShell prop

**Ticket:** B4 Sidebar lane (R2) · **Date:** 2026-09-09 · **Commit:** (staged, uncommitted)

**The situation.** R2 (responsive review) is that below 900px the sidebar
force-collapsed to an unlabelled 56px icon rail with the header toggle
*disabled* (`canToggle = !narrow`), so a phone showed icons with no way
to read or dismiss them. The R2 fix direction: make it a dismissible
overlay (toggle enabled on mobile, opening an off-canvas drawer) — "at
minimum, re-enable `canToggle`". This lane owns only `Sidebar.tsx` and
`useSidebarCollapse.ts`; the full off-canvas drawer as described touches
`AppShell.tsx`'s grid and `Header.tsx`, which this lane does NOT own.

**What had to be decided.** How to make the mobile rail dismissible
(tap-away / navigate-to-close) without editing `AppShell` or `Header`.

**Options considered.**
- *Thread a `requestCollapse` callback from the hook, through `AppShell`,
  down to `Sidebar`.* The natural shape, but `AppShell.tsx` and
  `Header.tsx` are out of this lane's ownership, and the dismiss triggers
  (a route change, a backdrop tap) are observed *inside* the router in
  `Sidebar`, below where the hook lives. Rejected on ownership.
- *A second `useSidebarCollapse` instance inside `Sidebar`.* Rejected —
  two instances do not share state, so the overlay a `Sidebar`-local hook
  opened would not be the one the Header toggle controls.
- *A window-event collapse signal (chosen).* `useSidebarCollapse` now:
  (a) returns `canToggle: true` always (R2 minimum) and a new `narrow`
  flag; (b) models the mobile overlay as transient session state
  (`mobileOpen`), never persisted, so opening the rail on a phone does
  not overwrite the desktop preference in `localStorage`; (c) listens for
  a `loctt:sidebar-collapse` window event. `Sidebar` reads the viewport
  itself (`useIsNarrow`, mirroring the 900px breakpoint), renders the
  expanded-at-narrow state as a `fixed` overlay + a tap-away backdrop, and
  fires `requestSidebarCollapse()` on a backdrop tap and on a route
  change. A window event is the app's existing cross-tree signal (the
  theme repaint and the shortcut registry use the same shape), so no new
  prop, context, or `AppShell` edit was needed.

**Why this is safe.** On a wide viewport `narrow` is false, `mobileOpen`
is unused, and `collapsed` is still the persisted preference — desktop
behaviour, incl. the `[` shortcut and SHL-12 persistence, is unchanged
(A11Y-6 and the SHL narrow-viewport e2e both stay green). The default
narrow render is still the collapsed rail; the overlay appears only once
the user opens it.

**Scope note.** This is the R2 *minimum-plus*: toggle re-enabled +
tap-away/navigate dismiss + a floating overlay. It is NOT the full drawer
animation/slide-in from the header, which would require the `AppShell`
grid change this lane cannot make. R2 has no ingested acceptance case
(it is a responsive-review item), so the new tests reference it in prose
("Covers R2"), not with a `@verifies` tag (the coverage tool rejects a
non-case id). Same for the S-8/S-11 tests.

**To revert.** Restore `canToggle: !narrow` and drop the `narrow` field,
the `mobileOpen` state, the `COLLAPSE_EVENT` listener and
`requestSidebarCollapse` export from `useSidebarCollapse.ts`; remove
`useIsNarrow`, the overlay branch, the backdrop and the route-change
effect from `Sidebar.tsx`. The sidebar returns to the permanent mobile
rail.

### A174 · The sidebar count Badge is NOT migrated to the B1 Chip; the TextField and sprint-state pill are

**Ticket:** B4 Sidebar lane (Chip/TextField migration) · **Date:** 2026-09-09 · **Commit:** (staged, uncommitted)

**The situation.** B4 asks the Sidebar to adopt the B1 primitives. The
`Chip` doc names "Sidebar counts" as a migration target. But the sidebar
count `Badge` models three states (a numeric value, a `pending` "···"
affordance, and an `unavailable` "—") and reserves a fixed min-width slot
(ONB-14/SHL-23) so a click aimed mid-load does not shift. Its
`data-pending` / `data-unavailable` attributes are asserted by the SHL-23
tests (`link.querySelector("[data-pending]")`).

**What had to be decided.** Whether to route the count `Badge` through
`Chip`.

**Options considered.**
- *Render the `Badge` as a `Chip`.* `Chip` forwards only `title` and
  `testId` — it cannot carry `data-pending`/`data-unavailable`, so the
  migration would either drop the SHL-23 state hooks or force widening the
  B1 `Chip` API, which is a B1 file this lane does not own. Rejected.
- *Keep `Badge` bespoke (chosen).* The count badge stays a specialised
  component; the genuine B1 adoptions in this file are: the project-search
  `<input type="search">` → `TextField` (a clean win — `TextField`
  supports `type`, `size`, `leadingIcon`, `data-testid`), and the plain
  sprint-state text → `Chip variant="neutral"`. S-11 ColorDots move to
  CSS-variable tokens (`--text-tertiary`, `--status-active-fg`,
  `--feedback-success-fg`) and both `★` stars become `ICON.star` (S-8).

**To revert.** Restore the raw `<input>` for project search, the plain
`<span>{s.state}` for the sprint state, the hex ColorDot colours
(`#8A94A6`, `#1E6FCB`, `#1F8A4C`) and the `★` glyphs. The `Badge`
component is unchanged either way.

### A175 · New-task modal Status/Type default pre-fill applied by a field-scoped effect, not by re-seeding the form (NEW-42 / UX-14)

**Lane:** B4 New-task modal. **Files:** `apps/web/src/client/create/CreateTaskModal.tsx`, `create/formState.ts` (+ tests), the create-task portions of `tests/ui/flow-task-create.spec.ts`.

NEW-42's residual (narrowed) has two parts: make the disabled Create a *visible* cue, and pre-fill Status/Type with the `workflow.yaml` defaults instead of "—".

Calls made:

- **Defaults resolved through contracts' `defaultStatus`, never a hardcoded "first status".** New pure helper `defaultsFromWorkflow(wf)` in `formState.ts` returns `{ status: defaultStatus(wf)?.key, task_type: wf.task_types[0]?.key }`. Status honours the `default: true` mark (may be any position) so the form shows what the CLI/MCP/core create path would actually write; type has no per-entry default flag, so its default is the first configured task type (configured order). Returns only the keys it can resolve, so an unloaded/typeless workflow pins no guess.
- **Pre-fill is applied by a separate, field-scoped effect — the form is NOT re-seeded on workflow arrival.** The first attempt gated the main seed effect on `workflow.isSuccess` so the seeded form carried the defaults. That regressed **NEW-4**: the seed's `setForm(initial)` then fired *after* the title focused and the user's first keystroke landed, clobbering it (measured: "typed" → "yped"). Instead the main seed stays gated only on projects/user (title focuses and takes typing immediately), and a second effect folds the two defaults in when the workflow lands — only into `status`/`task_type`, and only while each is still unset, so a board-column NEW-3 status or a user's own pick is never overwritten. `initial` still includes `defaultsFromWorkflow(wf)` (via its `wf` dep) so `hasUserContent`/`dirty` converges once workflow loads and NEW-27's "untouched modal closes immediately" holds.
- **The disabled cue is delivered by migrating Create/Cancel/Discard to the B1 `Button`.** The B1 Button base carries `disabled:opacity-50 disabled:cursor-not-allowed`, so an empty-title Create reads as unavailable rather than a live-looking dead button. This also removed the `text-white` on the Discard button (B1 CI-guard win). The close `×` icon button was left as-is (no `text-white`, out of NEW-42's narrow scope).
- **Edited the green, tagged NEW-11 test's picker locator (per CLAUDE.md's "editing a green test" rule).** Pre-filling Type means its OptionPicker now leads with a "None"/clear option, so NEW-11's `getByRole("option").first()` selected Clear and produced a task with no `task_type` — a stale-locator failure, not a behaviour regression. Changed NEW-11 to pick a concrete, *different* type by name ("Bug") and priority "High", which makes "type carried over" a stronger assertion (the chosen value survived, not the default merely reappearing). NEW-11's on-disk assertions are unchanged.

**To revert.** Delete `defaultsFromWorkflow` (and its tests), the pre-fill effect and its `defaultsApplied` state, and the `...defaultsFromWorkflow(wf)` spread in `initial`; restore Status/Type to opening unset ("—"). Revert the Create/Cancel/Discard buttons to their raw `<button>` spellings (Discard back to `text-white`). Restore NEW-11's `getByRole("option").first()` type/priority picks and drop the NEW-42 spec test + `defaultsFromWorkflow` unit tests.

### A176 · Board card blocked/epic/subtask markers derived from the card's own relationships + workflow config (BRD-50 / UX-5); pill toggle affordance (BRD-51 / UX-6)

**Lane:** B4 Board. **Files:** `apps/web/src/client/board/relationshipBadges.ts` (+ tests), `board/BoardCard.tsx` (+ tests), `board/BoardView.tsx`, `tests/ui/flow-board.spec.ts`.

Calls made (none change scope, invent a requirement, or touch a P-principle — recorded here per the run workflow's "decide and record" rule):

- **BRD-50 signals are computed from `task.relationships` alone — no second API read, no traversal.** A board card already receives the task's frontmatter (via the list feed's `TaskListRow extends TaskFrontmatterPublic`), which carries `relationships`. LocTT writes both sides of every edge (P-12), so the *blocked* task itself holds the `is_blocked_by` edge and the *epic* itself holds the `child` edges. `boardCardBadges(task, workflow)` reads them directly. No new endpoint, no board-specific relationship fetch.
- **The relationship type keys are resolved from config, not hardcoded.** `resolveBadgeKeys(workflow)`: the blocked axis is the inverse of `timeline.dependency_relationship` (defaulting to `blocks` → `is_blocked_by`); the hierarchy axis is the first `graph: "tree"` relationship — its own `key` (e.g. `parent`, held by a subtask) and its inverse (e.g. `child`, held by an epic). Falls back to the shipped defaults when the config is absent so a stock board still marks blocked/epic cards.
- **"Unresolved blocker" is taken as "has a blocker".** BRD-50's UX-5 text says "is_blocked_by with an unresolved blocker". The board feed does not cheaply carry each blocker's status, and resolving it per card would be a second read per edge. The card marks blocked when it holds ≥1 `is_blocked_by` edge and names the blocker *count* in the marker's title; whether a given blocker is itself done is surfaced in task detail, not on the card. **To revert this narrowing:** thread each blocker's status into the feed and gate `blocked` on an unresolved one.
- **Badges are computed once in `BoardView` (memoized `badgesFor`) and threaded into `BoardCard` as a `badges` prop**, keeping the card presentational and not re-reading config per card. The drag preview gets the same badges.
- **BRD-51: the visibility pills stay `<button aria-pressed>` toggles (BRD-3's shape) and gain the discoverability affordance** — an eye/blocked glyph, plus a `title`/`aria-label` that names the action ("Hide column X" / "Show column X") rather than the bare label. The BRD-19 disambiguator is folded into that name, not replaced.
- **S-11 (design-spec, no case id): board column width degrades `w-[280px]` → `w-[min(85vw,280px)] sm:w-[280px]`.** On tablet/desktop the width is the pinned 280px; on a phone-width viewport a column caps at 85vw so the next column peeks in at the edge — the horizontal-scroll affordance — instead of a fixed 280px column crushing the pane. The board region's existing `overflow-x-auto` (BRD-15) is unchanged.
- **Chip migration (item 4): the new card markers are built on the B1 `Chip` primitive** (blocked/subtask `neutral`, epic `accent`). The WIP **count** span is deliberately NOT migrated — it carries at-cap/over-cap colour + `data-wip-state` state logic, which `Chip` (a plain def-less pill) does not model; per `Chip.tsx`'s own docstring it is not a Chip target. `list/cells.tsx` was **consumed as-is and not edited** (owned by the Toolbar/List lane).

**To revert.** Delete `relationshipBadges.ts` (+ its unit tests) and the BRD-50 marker block in `BoardCard.tsx` (+ its render tests); drop the `badges` prop and `badgesFor` memo and the drag-preview `badges`. Restore the ChipsBar pill's `title` to the disambiguator-only form and remove `aria-label`/the eye glyph. Restore the column width to `w-[280px]`. Drop the BRD-50/BRD-51 spec tests.

### A177 · SettingsShell stacks to a full-width section bar below `md`; two-pane rail restored at `md`+ (R1, responsive-remainder lane)

**Lane:** B4 responsive remainder. **Files:** `apps/web/src/client/settings/SettingsShell.tsx` (+ new `SettingsShell.test.tsx`). R1 is a design-spec item with **no case id** — no `@verifies` tag was added.

R1's premise held: the Settings two-pane layout was an unconditional horizontal `flex` with a `w-56 shrink-0` (224px) nav rail at *every* width. On a 375px phone that rail swallowed 60% of the width and crushed the panel pane, and nothing capped the shell's overflow. Calls made (none change scope or touch a P-principle — recorded per the run workflow's "decide and record" rule):

- **Breakpoint is Tailwind's default `md` (768px)**, matching the app's existing responsive convention (`Header.tsx` uses `sm:`; the sidebar's own R2 keys off its `narrow` media state). Below `md` the shell is `flex-col` (section bar stacked above the pane); at `md`+ it is `flex-row` (the side-by-side rail it was). No custom breakpoint added — Tailwind v4 default screens.
- **The nav becomes a full-width bar on mobile, the fixed rail at `md`+.** `w-full … md:w-56 md:shrink-0`. `shrink-0` is now gated behind `md` so the mobile bar can be full width; the border flips from bottom (bar) to right (rail): `border-b … md:border-r md:border-b-0`.
- **The mobile bar is height-capped and scrolls** (`max-h-[40vh] overflow-y-auto … md:max-h-none`) so the ~20-section list cannot push the pane off-screen; the rail keeps its natural height at `md`+. The pane keeps its own `overflow-auto` (unchanged).
- **The shell clips its own overflow** (`overflow-hidden`) so a wide panel cannot force horizontal *body* scroll — overflow lives inside the panes, not the page. This is the "nothing forces horizontal body scroll" half of R1.
- **Verified by unit test, not e2e.** `flow-app-shell.spec.ts` (the settings/app-shell Playwright spec) is owned by the Sidebar lane (its R2 additions were already staged in the shared tree), so per the ticket this lane kept to a unit test. jsdom has no layout engine, so the test pins the responsive *class contract* (`flex-col`/`md:flex-row` on the shell, `w-full`/`md:w-56`/`md:shrink-0` on the nav, `overflow-hidden` on the shell) rather than measuring pixels. Red-first proven: reverting to the pre-R1 classes turns all three assertions red.

**To revert.** In `SettingsShell.tsx`, restore the nav `className` to `"w-56 shrink-0 border-r border-border-subtle bg-bg-surface p-3"`, the outer shell `className` to `"flex h-full bg-bg-canvas font-sans text-text-primary"`, and the group `div` to `"mb-4"` (drop `last:mb-0 md:last:mb-0`). Delete `SettingsShell.test.tsx`.

### A178 · B4 primitive-migration remainder lane — controls deliberately left bespoke

**Lane:** B4 primitive-migration remainder. This lane swapped hand-rolled
`<button>`/`<input>`/`<select>`/radio/checkbox controls for the B1
primitives (`Button`, `Checkbox`, `Radio`, `Select`, `TextField`,
`ToolbarButton`) across the files no other lane owns, and unified the
S-8 icon glyphs (`×`→`ICON.close`, `▾`/`▸`→`ICON.caretDown`/`caretRight`,
`⚠`→`ICON.warning`) in those files. It is a behaviour-preserving
migration — every `data-testid`, `aria-label`, and behaviour was carried
verbatim, verified by the existing behaviour tests of every touched file
staying green. No new `@verifies` tag was added (a migration is not a
new case). The following controls were **deliberately NOT migrated**,
each because a B1 primitive would change its look or cannot model its
shape (the SHL-23 "leave-it-bespoke" pattern):

- **Custom listboxes / menus** — `task/editors/OptionPicker.tsx` (the
  `Select.tsx` docstring explicitly says to skip it: a deliberate
  listbox, not a `<select>`), the `BulkBar.tsx` `BulkPicker` dropdown
  (`role="menu"` trigger + `role="menuitem"` items — a menu, not a
  Button), and `task/editors/LabelsField.tsx`'s find/create listbox
  input + `role="option"` rows. Only their glyphs were unified.
- **Colour-tinted / degradation pills** — `LabelsField.tsx` label pills
  (arbitrary user-hex `color-mix` tint via inline `style`, which `Chip`
  cannot express) and `CustomFields.tsx` MultiEnum chips (conditional
  `text-warn-fg` on an unknown value). Left bespoke; `×`→`ICON.close`.
- **Inline task-field editors** — `task/editors/TextField.tsx` and
  `DateField.tsx` (view-trigger → inline `<input>`/`<input type=date>`
  with tuned commit-on-blur, `aria-describedby`, and
  `requestAnimationFrame` focus-return). These are bespoke inline editors
  at `text-[13px] px-1.5 py-0.5`, not standard form fields; the risk of
  perturbing their focus/blur behaviour outweighs the primitive gain.
  No glyphs.
- **Link-styled text actions** — `CommentItem.tsx` Edit/Delete (compact
  `text-[12px]` inline actions with a delete-specific `hover:text-danger-fg`
  that is not a Button variant), `SidebarPinsPanel.tsx` Unpin/Pin/Delete-view
  and `CardLayoutPanel.tsx` "Reset to the default layout" (`text-accent
  hover:underline` links), and `LabelsField.tsx`/`CustomFields.tsx`
  inline "Clear"/"Dismiss" links. A boxed `Button` would look wrong
  inline; none carries `text-white` or an ad-hoc glyph.
- **Pressed-toggle pills that are not facet-sized** —
  `CardLayoutPanel.tsx` `card-field-toggle-*` (`aria-pressed`
  `text-[12px] px-2 py-0.5` accent/muted pill; `ToolbarButton`'s `h-8`
  border box would misfit the tiny inline pill). (The `PreferencesPanel`
  theme picker and `TimelineView` zoom pills, which ARE facet-sized, WERE
  migrated to `ToolbarButton active`.)
- **Native file input** — `BackupPanel.tsx` `<input type="file">` (no B1
  primitive models a file input).
- **Chart-positioned controls** — `TimelineChart.tsx` band-header /
  bar / anomaly buttons (`absolute`-positioned custom chart elements).
  Only their glyphs were unified.
- **Anchor styled as a button** — `BackupPanel.tsx`
  `backup-export-link` (`<a download>`, a native download, not a
  `<button>`).
- **Timeline drag-error banner buttons** — `TimelineView.tsx`
  `timeline-drag-retry`/`timeline-drag-dismiss` (outlined-danger inline
  actions inside a danger banner; a filled `Button variant="danger"`
  reads too heavy for a Dismiss and the secondary variant would drop the
  danger tint that ties them to the banner). Left bespoke.

`ui/Modal.tsx` had no raw controls or ad-hoc glyphs to migrate (its
inertness/focus-trap logic is untouched). Where an outlined-danger
*primary* action was a clean primitive target — `BulkBar` Delete,
`RemapDeleteDialog`/`DeleteViewDialog`/`DeleteConfirmDialog`/`DeleteTaskDialog`/
`DeleteCommentDialog` confirm buttons, `ReconcilePanel` Apply/Abandon —
it WAS migrated to `Button variant="danger"`/`"primary"`, which also
removed the seven `text-white` defect sites in these files.

**To revert.** Revert each migrated file to its hand-rolled control
markup; the swaps are mechanical and 1:1. The glyph unifications
(`ICON.*` imports) revert to the literal glyphs.

### A179 · TSK-32's "panel ignores the unknown key" bullet is superseded by DEG-7 (surface it, don't hide it)

**Ticket:** B4 merge (found by the primitive-migration lane running flow-task-meta) · **Date:** 2026-09-09 · **Commit:** (this one)

**The situation.** `flow-task-meta.spec.ts` TSK-32 failed after B3: it
asserted `meta-panel` does NOT contain an unknown key (`x_experiment`),
but B3's DEG-7/DEG-29 work renders unrecognised preserved keys in a
read-only "Not recognised" group. A genuine case-vs-case contradiction.

**What had to be decided.** Which case wins — TSK-32's "the panel ignores
the key and does not invent a row for it" (minor, P1, pre-degradation-
framework) or DEG-7's "preserved AND **surfaced** in a 'Not recognised'
group, read-only, with a remove control" (major, P5)?

**Decided.** DEG-7 wins; TSK-32's first bullet is revised to match.

**Why.** DEG-7 is major, newer, and the direct expression of Ken's
degradation direction (P7 "value-preserved", K26/K27) — a
preserved-but-unknown field must be *visible*, never silently hidden, so
the user can see and remove it. TSK-32's "ignores / does not invent a
row" predates that framework and encoded the older silently-hide model.
TSK-32's SECOND bullet — the key survives an edit byte-for-byte — is the
actual P1/P7 data-loss guard this case exists for, and is unchanged.
TSK-32 now reads: the unknown key gets no *editable field row* (no
`meta-edit-<key>` trigger) but IS shown in DEG-7's Not-recognised group,
and still survives an edit. This is a case reversal (a minor case's stale
bullet, reconciled to an already-ruled major requirement), not a new
product decision — flagged for Ken but not blocking, since the direction
(surface degraded/unknown fields) was already his ruling.

**Ratified by Ken, 2026-09-09: "go with your call."** DEG-7 wins, unknown
keys are shown. No longer just an agent call.

**To revert.** Restore TSK-32's original first bullet ("the panel ignores
the key and does not invent a row for it"), revert the flow-task-meta
TSK-32 test to `not.toContainText("x_experiment")`, and remove DEG-7's
"Not recognised" client group (which would also revert DEG-7 itself and
its A157 client-render tag) — i.e. this revert is only coherent if DEG-7
is also reverted, which contradicts the degradation framework.

### A180 · An external image in the task description is a click-to-open link, not an auto-loaded `<img>` (privacy)

**Ticket:** B4 fix-review (K33 BodyRenderedView) · **Date:** 2026-09-09 · **Commit:** (this one)

**The situation.** B4's K33 read-then-edit added a real `<img>` to the
task description's rendered view (the comment renderer deliberately shows
images as text references; TSK-70 wants a clickable image → lightbox, so a
real `<img>` was needed). The fix-review flagged that `isSafeHref` allows
`http(s)` and protocol-relative `//host/…`, so `![](//evil.example/p.png)`
became an auto-loading `<img src>` — fetching a remote resource the instant
a task is *viewed*, leaking the viewer's IP/referrer to an arbitrary host
and acting as a tracking pixel, with no interaction.

**What had to be decided.** Should the description auto-load external
image URLs inline (like GitHub/Jira markdown) or not?

**Decided (agent level, flagged for Ken).** Only a **local** src
(same-origin `/…`, or a bare relative path — LocTT's own attachments)
becomes an auto-loading, clickable `<img>` → lightbox. An **external**
image URL (`http(s)://other-host/…`, or protocol-relative `//host/…`)
renders as a **click-to-open link** (`target=_blank rel=noreferrer
noopener`), NOT an `<img>` — so nothing off-origin is fetched just by
opening a task. An unsafe scheme (`javascript:`/`data:`) stays plain text.
This matches the comment renderer's long-standing stance (images as
references, never auto-loaded) and TSK-70's letter (the image "opens" —
here via the link). **Flagged for Ken** as a privacy-vs-inline-render
taste call: GitHub/Jira do auto-load external images; if Ken wants inline
external images, this is where to change it (accepting the tracking-pixel
exposure, ideally behind a proxy or a per-tracker opt-in).

**To revert (auto-load external images inline).** In
`BodyRenderedView.tsx` `attachmentEmbed`, drop the `isLocal` gate and
render any `isSafeHref(src)` as the `<img>` (as it briefly did), removing
the `body-image-link` branch and its test.

**REVERSED by Ken, 2026-09-09.** Ken's ruling: load external images
inline, like GitHub/Jira — users expect it. So the `isLocal` gate is
dropped: ANY safe-scheme image (`http(s)`/relative, local OR external)
now renders as an inline, clickable `<img>` → lightbox; the
`body-image-link` branch is gone. The `javascript:`/`data:` refusal
STAYS (that is an XSS guard, not the privacy gate). `referrerPolicy=
"no-referrer"` is set on the `<img>` to withhold the referrer from the
remote host — but this does NOT stop the fetch, so the accepted tradeoff
stands: an external `src` is loaded the instant a task is viewed, so a
description can carry a tracking pixel / leak the viewer's IP to an
arbitrary host. **Accepted knowingly.** Future hardening if wanted: proxy
or cache external images through the LocTT server so the viewer never
contacts the third party directly. Tests updated: external image asserts
an inline `<img>` with `referrerPolicy=no-referrer` + lightbox; a
separate test pins that `javascript:`/`data:` still do NOT render an
`<img>`.

### A181 · `--root` + `--cwd` given together with different values is a usage error, not a silent winner (B5)

**Ticket:** B5 (CLI-1) · **Date:** 2026-09-09 · **Commit:** (this one)

**The situation.** K34 (Ken, § 9) makes `--root` canonical and keeps
`--cwd` as an alias. Ken's ruling did not spell out what happens if a
caller passes *both* with different directories.

**Decided (agent level).** A conflict is a **usage error (exit 2)**, not a
defined-winner silent pick. Rationale: the two flags are aliases for one
thing, so passing them with different values is almost certainly a mistake,
and picking one silently would run a mutating command against the wrong
tracker — a data hazard (the same reasoning as P1). Consistent duplicates
(`--root X --cwd X`) are accepted, since there is no ambiguity. Precedence
otherwise: explicit flag > `LOCTT_ROOT` > `process.cwd()`.

**Why not "--root wins".** Letting the canonical name win reads clean but
is a silent pick when the values disagree — exactly the case where the user
does not know which tracker they hit. Erroring costs one retry; a silent
wrong-tracker write costs data.

**To revert (make `--root` win over `--cwd`).** In `resolveRoot`
(`apps/cli/src/index.ts`), remove the `r !== c` throw and return `r`
whenever `rootFlag !== undefined`; delete the "given together with
different values errors" test in `cli.test.ts`.

### K34 · `--root` is the canonical tracker-root flag; `--cwd` is a kept alias; `LOCTT_ROOT` is accepted (CLI-1)

**The situation.** The same "which tracker" concept had two different
names across surfaces and was undocumented: the CLI global was `--cwd`
(no `--root`, no `LOCTT_ROOT`), while the web server used `--root` /
`LOCTT_ROOT` — a different name for the same thing. `loctt ui --root`
and `loctt mcp --root` failed with "unknown option", and neither flag
was documented in `docs/user/`.

**Ruling (Ken, this session — "--root sounds better").** `--root` is the
canonical flag name for pointing a surface at a tracker directory.
`--cwd` is **kept as a working alias — not removed** — so existing
scripts do not break. The `LOCTT_ROOT` env var is accepted as a
fallback. One vocabulary across CLI, `loctt ui`, `loctt mcp`, and the web
server.

**This is Ken's, not an agent's — not revertible by an agent.** (The
batches doc said B0 was to record it; it was not recorded until now, so
this entry lands in B5 with the build.)

**Built (B5):**
- CLI global (`apps/cli/src/index.ts`): `--root <dir>` canonical plus the
  `--cwd` alias, both stripped from argv before the subcommand (via
  `stripRootArgs` in `runtime/args.ts`) so `loctt ui` / `loctt mcp` accept
  them directly instead of rejecting them. `LOCTT_ROOT` is read as a
  fallback. MCP inherits this root through `loctt mcp` (it has no
  standalone entrypoint), so `loctt mcp --root <dir>` now targets that
  tracker.
- Web server (`apps/web/src/server/main.ts`): `--cwd` added as an alias of
  the existing `--root` / `LOCTT_ROOT` so the names match across surfaces.
- **Precedence:** an explicit flag > `LOCTT_ROOT` > `process.cwd()`.
  Relative paths resolve against the cwd.
- **Both flags given:** they must resolve to the **same** directory; a
  genuine conflict is a **usage error (exit 2)**, not a silent pick-one —
  operating on the wrong tracker is a data hazard, so an ambiguous target
  fails loudly. Consistent duplicates (`--root X --cwd X`) are accepted.

**Minor call (agent, revertible — recorded in § 8 intent):** the
both-given-conflict → *error* rather than defining a winner. An
alternative (let `--root` win over `--cwd`) would be a silent pick; given
the data hazard, erroring is the safer default. **To revert to "--root
wins":** in `resolveRoot` (`apps/cli/src/index.ts`), drop the
`r !== c` throw and return `r` whenever `rootFlag` is present. (See § 8
companion note.)

**Docs:** `docs/user/cli/reference.md` gains a "Global options" section and
the `loctt mcp` entry documents `--root`; `docs/user/mcp/reference.md`
Agent Guidelines explain how the server resolves its root; `usage.ts`
help now shows `--root` canonical with `--cwd` as alias.

### K71 · The dialog focus-trap a11y gap is a publish blocker

**The situation.** The 2026-09-11 design review found that ~7 dialogs
(including the primary create flow) set `role`/`aria-modal` and handle
Escape by hand but call neither `useFocusTrap` nor `useInertBackground` —
so keyboard focus escapes the modal into the page behind, and is not
restored to the trigger on close. Cross-confirmed by the primitive-
consistency and a11y audits independently. Full roster and fix:
`docs/dev/design-review.md` §A1.

**Ruling (Ken, 2026-09-11): this blocks publishing — fix before ship.**
Not a fast-follow. It is a real keyboard/screen-reader regression, and
the README's a11y claims are partly untrue until it is fixed. The
sanctioned fix is a shared `ConfirmDialog`/`TypedConfirmDialog` primitive
over `Dialog`/`Modal`, which closes the delete-dialog divergence (§B1) at
the same time. Closes only when codified as a case + `@verifies` test.

**This is Ken's, not an agent's — not revertible by an agent.**

### K72 · CLI, MCP and UI are three independently-installable packages

**The situation.** Publish packaging was open (release-readiness B4). The
question was whether the installed CLI serves the web UI or the surfaces
ship separately.

**Ruling (Ken, 2026-09-11): all three are meant to be separate — the
user can install CLI, MCP, and UI independently.** The CLI does not serve
the UI. They share the on-disk data model, so CLI/MCP can CRUD things
(labels, custom fields, milestones, relationships) that only *render* in
the UI — that is expected and correct, not drift.

**Consequence for packaging.** `@loctt/web` must become independently
installable: it needs a `bin` launcher and a server build (today only
`dist/client` is built by `vite build`; `dist/server` is declared as
`main` but never produced). See release-readiness.md B4 for the full
gap. CLI and MCP already bundle core and are installable as-is.

**This is Ken's, not an agent's — not revertible by an agent.**

### K73 · The whole TEMP-TODO backlog is pre-publish work, not "build later"

**The situation.** `TEMP-TODO.md` was written 2026-09-09 as a "track now,
build later" list — gaps deferred from v1 with recorded reasons. On
review (2026-09-11) Ken judged that framing wrong for publishing: the
list contains silent correctness defects (`field != null` returns
everything; MSL-C1 burndown ignores name-assigned tasks), a P1 data-loss
(broken-view write drops a concurrent broken view), the malformed-on-disk
robustness gap (BLK-44), the core-parity embarrassment the docs
themselves cite (`unarchiveView`), and WCAG AA failures — alongside the
genuinely-large features.

**Ruling (Ken, 2026-09-11): treat the entire backlog as required before
publishing.** Not a post-launch queue. `TEMP-TODO.md` is reframed as the
pre-publish work list.

**Consequence.** This is weeks-scale, and the ~13 open rulings in the
backlog are now the **critical path** — items blocked on a ruling cannot
close no matter how much building happens, so the rulings should be
cleared first. Each item still closes only as a case + `@verifies` test +
a `decisions.md` entry, per the standing bar.

**This is Ken's, not an agent's — not revertible by an agent.**

### K74 · Every WCAG AA failure is a publish blocker

**The situation.** Beyond K71 (dialog focus traps), the backlog and design
review list more AA failures: `--text-tertiary` at 3.67:1 (A11Y-40),
checkbox/radio and `--border-subtle` borders below 3:1 (DS-A11Y40,
DS-BORDER-SUBTLE), and Menu arrow-key navigation (A11Y-9, design-review
§A2). The README claims strong accessibility.

**Ruling (Ken, 2026-09-11): all WCAG AA failures block publishing.** The
README's a11y claims must be true at launch, not aspirational. Each of
these is bounded; they ship before the UI package does.

**This is Ken's, not an agent's — not revertible by an agent.**

### K75 · NEW-20 — a `default:` project that doesn't exist is a hard error, handled per surface

**The situation.** A project config `default:` can name a project that no
longer exists. Today that is a hard config-load error everywhere. NEW-20
asked whether to keep that or tolerate it as drift the resolver skips.

**Ruling (Ken, 2026-09-11): keep it a hard error on the config, but
handle the *consequence* per surface rather than dead-ending the user.**
- **CLI / MCP:** do not silently proceed. Force a project to be specified
  on task creation, and emit a warning that the default config is broken.
- **GUI:** do not default to any project; the user MUST select one to
  create a task. Show a UI warning nudging them to fix the config, with a
  **deep link** to the exact settings section where the default is
  configured.

**Consequence.** The GUI half depends on deep-linking, which does not yet
exist — see K76 and the new deep-linking workstream in TEMP-TODO. NEW-20's
non-GUI half (force-select + warning on CLI/MCP) is buildable now; the
deep-link nudge lands with the deep-linking work.

**This is Ken's, not an agent's — not revertible by an agent.**

### K76 · Deep-linking is an in-scope pre-publish workstream (needs its own audit + plan)

**The situation.** K75's GUI nudge wants a link straight to a specific
settings section. Ken generalised this: the app should support **deep
linking to locations within pages** — scroll to a settings section, and
further to a particular field; and by analogy to Jira, scroll to the
comments section of a task, or to a particular comment (with copy-link-to-
comment). None of this exists as a surveyed capability today.

**Ruling (Ken, 2026-09-11): treat deep-linking as an in-scope pre-publish
workstream, starting with an AUDIT + PLAN step, then implementation.**
The audit enumerates *where* deep links should exist across all pages
(settings sections + scroll-to-field; task comments section + scroll-to-
comment + copy-link; and any other page sections worth targeting), and
the plan sequences the build. Implementation follows the normal build
loop with cases + tests.

**This is Ken's, not an agent's — not revertible by an agent.**

### K77 · Query DSL gains `is empty` / `is not empty`; `= null`/`!= null` become errors (B-1)

**The situation.** `field != null` returned every task — a silent filter
failure (`evaluator.ts:244`: unset fields match `!=` anything; and `null`
was tokenized as the string `"null"`). The fix requires defining how the
DSL expresses a presence test.

**Ruling (Ken, 2026-09-11): add `is empty` / `is not empty` operators,
one canonical keyword.** Modelled on JQL's `IS [NOT] EMPTY`. `field is
not empty` = the field has a value; `field is empty` = unset. `= null`,
`!= null`, `= none` become **parse errors** with a message pointing at
`is empty` (did-you-mean). **No `is null` SQL synonym** — one keyword to
document. The query builder (K-tbd/B-6) exposes this as a per-field
has-value / is-empty toggle.

**Scope.** Tokenizer (recognise `empty` keyword), parser (the operator),
evaluator (presence semantics), user docs (query-language.md), and a
case + `@verifies` test. Shared core → owes CLI, MCP, web.

**This is Ken's, not an agent's — not revertible by an agent.**

### K78 · SET-45 — a filesystem write error is io_failed/500, not config_invalid/400 (B-2)

**The situation.** On a workflow-config write, an EACCES/disk error
(`FsAccessError`, which extends `Error` not `LocttError`) was swallowed by
`handlePutWorkflow`'s inner catch (`server.ts:1513`) and reported as
`400 config_invalid` — blaming the user's input for a machine fault. The
correct mapping exists at the top-level handler but the inner catch
intercepts first.

**Ruling (Ken, 2026-09-11): fix it and write the case.** Add an
`FsAccessError` branch → `500 io_failed` in the workflow-write handler.
Write a SET-45 case (none exists yet). Rationale: ERR-1 forbids
misattributing a fault to the user. Small — `statusForCode` already maps
`io_failed`→500.

**This is Ken's, not an agent's — not revertible by an agent.**

### K79 · Task-key prefix rule: `^[A-Z]{1,10}$`, validated at creation only (B-3)

**The situation.** The CLI accepted any non-empty prefix, so
`--prefix "web/x"` created keys like `web/x1` that break the task's own
URL (`/tasks/web/x1`). The web wizard validated format; core did not —
a core-parity violation. Tightening core risked rejecting prefixes in
trackers already on disk.

**Ruling (Ken, 2026-09-11):**
- **Format: uppercase letters only, length 1–10 — `^[A-Z]{1,10}$`.** No
  lowercase, no digits, no punctuation. (Stricter than Jira, which allows
  trailing digits; Ken chose pure uppercase letters. Max 10 matches
  Jira's project-key cap.)
- **Applied at creation only** — `init` and `setProjectPrefix`. Existing
  trackers are **not** migrated or retro-validated (no key rewrite; keys
  are identity). `doctor` surfaces a legacy non-conforming prefix as a
  report, not a block.

**Scope.** A core validator in `packages/core/src/init/init.ts` +
`setProjectPrefix`, matching the existing web-wizard intent (which can be
tightened to the same rule so the surfaces agree). Case + `@verifies`
test. Note: reconcile the web wizard's current narrow rule (A80) to this
stricter one.

**This is Ken's, not an agent's — not revertible by an agent.**

### K80 · The query DSL adopts a JQL-like function/operator set, shipped with the query builder (B-1 extension)

**The situation.** Ken asked whether to copy JQL. The DSL is already
~JQL-shaped (field=value clauses, AND/OR/NOT, nesting; `is empty` added in
K77). The open question was which JQL functions fit a single-machine,
markdown-backed tracker with no org/groups/workflow-history model.

**Ruling (Ken, 2026-09-11): adopt the JQL-like set below, all pre-publish
(nothing deferred), shipped WITH the visual query builder as one feature.**
The text DSL is the power-user layer; the builder is the non-developer
layer over the same DSL.

**In scope (all four):**
- **Date functions** — `now()`, `startOfDay/Week/Month`, `endOfDay/Week/
  Month`, with offset args (e.g. `endOfWeek("+1w")`). Enables Overdue /
  due-this-week / this-month views. Needs a **stubbable clock** so tests
  are deterministic.
- **`currentUser()`** — `assignee = currentUser()` = "my tasks". Uses the
  existing user/assignee model.
- **`IN (a, b, c)`** operator — multi-value match, e.g. `status IN
  (active, blocked)`.
- **`contains` / `~`** — substring match on text fields (title/body).

**Explicitly NOT built** (org/history-shaped, no concept to map onto):
`membersOf`, `watchedIssues`, `votedIssues`, `currentLogin/lastLogin`,
`projectsLeadByUser`, `WAS`/`CHANGED` history queries, ScriptRunner
`issueFunction`. `linkedIssues()` and sprint functions deferred (not
"never" — just not this scope; recorded so a later agent doesn't read the
omission as a rejection).

**Reconciliation the implementer MUST handle:** `contains`/`~` overlaps
the existing header search. Do NOT build a second text-match path — route
both through one core matcher so DSL search and header search agree
(core-parity). Same for `currentUser()` and the "switch user" concept.

**Scope.** Tokenizer + parser + evaluator + `validateQuery` wiring + user
docs (query-language.md) + the builder UI exposing each; cases +
`@verifies` tests; owes CLI/MCP/web. Part of the query-builder feature
(K-tbd/B-6).

**This is Ken's, not an agent's — not revertible by an agent.**

### K81 · Checkbox/radio get a dedicated `--border-control` token at ≥3:1 (B-4)

**Ruling (Ken, 2026-09-11).** The unchecked/resting checkbox and radio
border fails WCAG 3:1 (`--border-strong` is 2.16:1 light / 1.88:1 dark).
Add a dedicated **`--border-control`** token at ≥3:1 (both themes), used
only by `ui/Checkbox.tsx` and `ui/Radio.tsx`, rather than darkening the
shared `--border-strong` (which would shift every strong border). Case +
`@verifies` contrast test. **Ken's, not agent-revertible.**

### K82 · Real dividers move to `--border-default`; `--border-subtle` stays decorative (B-5)

**Ruling (Ken, 2026-09-11).** `--border-subtle` (~1.30:1) is correct for
decorative hairlines but is used at some real structural dividers that owe
3:1. Keep `--border-subtle` decorative; migrate the meaningful dividers
(`ListView.tsx:778`, `BulkBar.tsx:110`, section separators) to
`--border-default`. Split by role rather than darkening the shared token.
Case + test. **Ken's, not agent-revertible.**

### K83 · Query-builder design: refuse-on-unrenderable, coexist with chips, defer NOT to v2 (B-6)

**Ruling (Ken, 2026-09-11), the three query-builder design calls:**
- **(i)** When a DSL query is too complex for the visual builder to
  represent, the builder **refuses to open the visual view and shows only
  the text box** — it never silently renders a query that isn't what the
  user wrote.
- **(ii)** The builder **coexists** with the chip-bar filters as an
  "Advanced" affordance beside them — the common two-click filter stays
  fast; the builder is the power path.
- **(iii)** **`NOT` / negation is deferred to v2.** v1 ships and/or +
  nesting; nested negation (where these UIs get confusing) comes later.
  Recorded as deferred-not-rejected.

Part of the query-builder feature alongside K77 (`is empty`) and K80 (the
JQL-like function set). **Ken's, not agent-revertible.**

### K84 · TSK-58 — build the Duplicate & Move UI affordances (parity, no defer)

**Ruling (Ken, 2026-09-11).** Duplicate (TSK-20) and Move exist in
core/CLI/MCP but have no web-UI affordance. Build them into the task-detail
UI: Duplicate with a confirm, Move with a target/project picker. Full
surface parity; not scoped out. Cases + `@verifies` tests; the UI cases
join `flow-tasks.md`. **Ken's, not agent-revertible.**

### K85 · MSL-11 — the Settings label count uses the same denominator as progress

**Ruling (Ken, 2026-09-11).** A label's Settings count and its milestone
progress fraction must agree. Settings excludes **archived and discarded**
(the same rule `computeProgress` uses), rather than showing an
archived-inclusive total. This finally states the archived rule MSL-C1
left unstated: **archived tasks are excluded from label/milestone
reference counts.** Align `countTasksByReferences` (`core/src/task/
counts.ts:62`) to exclude archived, and reconcile MSL-11's case wording to
name the axis. Cases + tests; owes CLI/MCP/web. **Ken's, not
agent-revertible.**

### K86 · SET-43 — add the config read-back endpoint

**Ruling (Ken, 2026-09-11).** `GET /api/config/:key` currently 404s, so a
settings panel cannot confirm what it wrote. Add the read-back endpoint so
the panel renders from the source of truth and cannot drift from disk.
Write the SET-43 case (none exists). Small new API surface; owes the
read-side of the config contract. **Ken's, not agent-revertible.**

### K87 · BAK-C13 — use `mergeTask`'s existing `displaced` return, NOT a new record kind

**The situation.** TEMP-TODO proposed a "new backup record kind" for
carrying a displaced body — a load-bearing storage-format change. On
inspection the BAK-C13 case itself (`flow-backup-restore.md:187-201`) says
`mergeTask` (`git/merge.ts`) **already** returns the displaced body
(`displaced: { label, content }`) and `merge.test.ts:186` already asserts
the mechanism.

**Decision (agent-level, flagged — no new format).** The restore/overwrite
path **uses the existing `displaced` return**: preserve the losing body and
name it in the report. No new on-disk record kind. This is a wire-up +
case + test, not a storage change. **To revert:** if a case later needs a
displaced body carried across a *chain* of backups (not just one
overwrite), revisit — but BAK-C13 as written does not. Recorded in §8
because it reverses a load-bearing proposal down to a wire-up.

### A-PRESCAN-1 · PRU-46 — keep auto-recovery, retag + delete the dead banner code

**Decision (agent-level, per Ken's "decide where one option is clearly
best").** PRU-46's pending-rename banner is unreachable: recovery runs as
middleware before any handler, so the mid-rename state the banner would
show cannot occur. "Boot-only recovery" would reintroduce an observable
stale-key state the case (K16) forbids. So: keep the auto-recovery,
delete the dead banner component, retag PRU-46. **To revert:** if
recovery is ever moved out of the pre-handler path, the banner's state
becomes reachable and must come back. Case + test that the mid-rename
state is unreachable.

### A-PRESCAN-2 · Read-only degraded entries (ERR-10/LST-51/TML-48) — alert in place, where the user is

**Decision (agent-level).** A degraded-but-loadable config entry on a
read-only view alerts **at the point of use** (the view naming the
file/field and degrading in place), not only in Settings. ERR-10, LST-51,
TML-48 already require naming the file/field and in-place degradation;
surfacing at point-of-use is the more discoverable, robust reading
consistent with all three. **To revert:** if it proves too noisy on
read-only surfaces, fall back to a single settings-level alert with a
count. Cases already exist; wire the alert + tests.

### A-PRESCAN-3 · MSL-C1 "referenceCount exists nowhere" — stale claim, verify not rebuild

**Decision (agent-level).** The backlog/known-gaps note that milestone
reference counting "exists nowhere" is a false positive of the kind
lessons.md warns about — `countTasksByReferences` (`counts.ts:62`) and
`computeProgress` exist. Verify + strike the stale note; do not rebuild.
Folds into K85 (the denominator alignment). No new code beyond K85.

### A-LST33 · Dangling filter-chip detection is gated on the facet's successful load

**LST-33 fix (agent-level, decided during the build).** A filter chip is
marked "dangling" (value names a since-deleted entity) only when the
value fails to resolve **and** its facet's option source has successfully
loaded (`isSuccess`). Gating on load-state, not merely "option not found",
is required: `buildChips` runs on every render including before the
`useMilestones`/`useUsers`/… queries resolve, and on query error — so an
ungated "not found → dangling" would render valid chips as
"(no longer exists)" during the fetch window, and permanently if the
source errored. This mirrors the existing `failedFacets`/`isError`
pattern in the same component. Custom-field chips gate on
`workflow.isSuccess`.

`buildChips` (+ `FacetKey`, `FacetOptions`) is now exported so the
dangling logic is unit-tested directly — the loading-race is a pure-
function property, more robustly asserted there than waited-out through
Playwright. The dangling chip reuses cells.tsx's deleted-reference
vocabulary (truncated 6-char id + a parenthetical + a `title`), warn-toned.

**To revert:** drop the `loadedFacets`/`customFieldsLoaded` params and the
`isSuccess` sets; chips fall back to raw-value rendering (the pre-fix
bug). **Found in review:** the first cut used non-existent
`feedback-warn-*` Tailwind classes (correct names are `warn-*`) and
lacked the load-gate — both fixed before commit.

### A-DEG4PROV · Repair provenance stamps history from `health`; corrupt labels get an extra field_change entry

**DEG-4-PROV built (agent-level).** `buildSetFieldHistory` now takes the
pre-write `task.health`. When the written field has a health finding (the
write repairs a corrupt field), the emitted entry carries `before` = the
finding's `raw` (the corrupt value, absent from frontmatter) and
`meta.was_corrupt: true`. Scalar built-in and custom fields wrap their
single entry via `withRepairProvenance`.

**Labels (found in review).** The `labels` branch emits N per-element
`label_added`/`label_removed` entries, onto which a single raw `before`
does not map. Rather than lose the provenance (the reviewer's HIGH
finding) or invent a dubious per-element before, a **corrupt labels
repair also emits one `field_change` entry on `labels`** carrying the raw
corrupt value as `before` and `meta.was_corrupt` — the element diffs say
what the array became; this entry records that a corruption was repaired
and what it held. **To revert:** drop the `if (repaired !== undefined)`
push in the labels branch; provenance for corrupt-labels repair is then
lost again (the pre-fix state). Non-labels behaviour is unaffected.

Verified: `update.test.ts` "repair provenance (DEG-4-PROV)" (scalar +
labels red-proven; healthy-task negative). No new surface code — history
`meta` flows to CLI/MCP/web generically. Closed the known-gaps entry and
updated DEG-4 in flow-degradation.md.

### A-CONTRAST · axe-core is the contrast gate for A11Y-40; a static token test is the fast supplement

**Approach (Ken, 2026-09-11 — asked "which is industry standard?").**
`@axe-core/playwright` (already a dependency, already used in
`flow-accessibility.spec.ts`) is the primary contrast gate — axe-core is
the industry standard (it underlies Lighthouse, DevTools, Storybook a11y).
A11Y-40 gets its own scoped `color-contrast` scans across the surfaces the
case names (header, sidebar active/inactive, rows/zebra/hover, chips,
pills, disabled, placeholder, schema banner), both themes, following the
existing scoped-scan discipline (never whole-page "zero violations").

A **static WCAG-ratio unit test** on the token values is added as a fast,
deterministic supplement — it makes K81/K82/text-token regressions fail in
ms without a browser. Supplement, not the gate.

**Ken ruled: fix ALL contrast violations axe finds**, not only the ruled
tokens (consistent with K74 — all WCAG AA failures block). Given the
design review's token-adoption debt, this may be a real batch; each fixed
properly, no shortcuts.

**Stale note to clear:** known-gaps/flow-accessibility cite
`--text-tertiary` at 3.67:1 (#7b8699) as A11Y-40's subject — but the token
is now #5C6675 (5.81:1 light / 5.81:1 dark, verified), so that specific
finding is already resolved. A11Y-40's remaining substance is the in-situ
axe scan + K81/K82 (checkbox/divider borders).

**This records the approach; K81/K82 keep their own rulings.**

### A-K82-REOPEN · K82's `--border-default` fix is insufficient for 3:1 — re-ruling needed

**Found while building the contrast harness (2026-09-11).** K82 ruled
that real dividers move from `--border-subtle` to `--border-default` to
meet 3:1. The harness proved `--border-default` is only ~1.39:1 (light) /
~1.36:1 (dark) vs surface — it does NOT meet 3:1. So K82 as stated cannot
achieve its goal. A true 3:1 divider needs ~#7C8598 (a prominent
gridline), which is a real visual change K82 did not contemplate.

**State:** structural dividers (row separators, footers, header cells in
ListView/BulkBar) were migrated subtle→default — a genuine visibility
improvement and harmless, so kept — but the 3:1 target is unmet. The
contrast harness marks the divider assertions `.todo`. K81 (control
border) is unaffected and passes.

**Parked for Ken (NEEDS-OWNER):** (a) accept table row separators as
decorative and drop the 3:1 divider target (WCAG 3:1 for non-text is for
indicators *required* to understand content; row separators arguably
aren't when the grid layout already reads); or (b) add a real ≥3:1
`--border-divider` and accept darker gridlines app-wide. Recorded so the
run continues on everything else per park-don't-halt.

### K82-REV · Divider 3:1 applies only where a border carries required meaning (hybrid)

**Ruling (Ken, 2026-09-11 — re-ruling K82 after A-K82-REOPEN showed
`--border-default` doesn't reach 3:1).** WCAG's 3:1 for non-text applies
to indicators *required* to understand content, not to decoration. So:
- **Decorative dividers stay decorative** — table/list row separators,
  hairlines between rows, card outlines. The tabular alignment (columns,
  spacing, zebra) already conveys row structure; the hairline is polish
  and is NOT held to 3:1. (`--border-subtle`/`--border-default` fine.)
- **A ≥3:1 `--border-divider` is added and used ONLY where a border is
  the sole signal separating two semantically distinct regions** — e.g. a
  region boundary that, without the line, would read as one region. These
  are few and identified case-by-case.

**Consequence.** The contrast harness asserts 3:1 for `--border-control`
(K81) and for `--border-divider` where used; it does NOT assert 3:1 for
`--border-subtle`/`--border-default` (decorative). The subtle→default
migration from the K81/K82 commit stays (a visual improvement), reframed
as decorative-not-accessibility. This is Ken's, not agent-revertible.

### A-A11Y40-CONTRAST · Palette brought to zero color-contrast violations (A11Y-40 in situ)

**Built (agent-level, 2026-09-11).** The axe `color-contrast` sweep + the
static harness found three AA text failures in the light palette (all 12px
chip text): `--status-active-fg` #1E6FCB (4.35:1), `--status-completed-fg`
and `--feedback-success-fg` #1F8A4C (3.88:1). Per K74 (all AA blocks) +
Ken's "fix all it finds": darkened to `--status-active-fg` #175FB4
(5.47:1) and the two greens to #18743F (5.16:1). `--priority-medium` keeps
#1E6FCB — it sits on canvas (not the chip bg) and axe did not flag it.

The in-situ A11Y-40 gate is a whole-page axe `color-contrast` scan across
/list, /board, /milestones, /sprints, /settings/workflow in both themes
(`@verifies A11Y-40`), now at zero violations. The static harness
(`contrast.test.ts`) additionally asserts every text token, chip pair,
control border and region divider — it caught the two green failures axe
missed (the completed/success chips weren't rendered on the scanned
pages), which is why both layers exist. **To revert:** restore the
original fg hexes (reintroduces the AA failures).

### A-K71 · Shared ConfirmDialog/TypedConfirmDialog; 5 of 7 §A1 dialogs migrated

**K71 (P0 a11y blocker) — partial, agent-level build.** Added
`ui/ConfirmDialog.tsx`: `ConfirmDialog` (title/body/confirmLabel/variant/
confirmDisabled + children slot + optional testIds) and
`TypedConfirmDialog` (adds type-to-confirm friction), both over
`Dialog`→`Modal`, so every consumer inherits focus-trap (A11Y-14), inert
background, Escape/backdrop close, and focus restoration (A11Y-15).

Migrated: DeleteViewDialog, DeleteCommentDialog (→ConfirmDialog),
DeleteConfirmDialog (→TypedConfirmDialog), MoveTaskDialog (→Dialog, has a
picker), BodyConflictDialog (→useFocusTrap+useInertBackground directly —
its two-column diff is too wide for Modal's max-w-md).

**Note on a Dialog structure gotcha found in test:** Modal renders the
`<h2>` title as a sibling ABOVE the `testId`-wrapped body, so a spec
doing `getByTestId(dialog).toContainText(name)` misses a name that lives
only in the title. DeleteViewDialog now also names the view in its body
(natural copy). A cleaner fix — scoping Dialog's testId to the whole
panel — is deferred; noted for the AdvancedQueryEditor/CreateTaskModal
remainder.

Verified: real-browser focus-trap+restore e2e (K71 test) + behavior specs
BLK-11/CMT-6/XS-12/XS-65/TSK-44/VUE-38, all green. **Remaining (K71 not
closed):** AdvancedQueryEditor and CreateTaskModal + its DiscardDialog.
**To revert:** the dialogs' pre-migration hand-rolled overlays are in git.
