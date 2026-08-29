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

**Consequence.** M3.5 needs no server work of any kind. The earlier
claim in `TEMP-BUILD-PLAN.md` that M3.5 and M4.9 "carry server work"
is wrong on both counts — see the note there.

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
condition 2 in `TEMP-RUN-WORKFLOW.md`. The gate identified a genuine
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

---

## 9. Ken's rulings, 2026-08-29

**These are Ken's, not an agent's.** Unlike § 8, they carry the
authority of sections 1–7 and are not revertible on an agent's
judgment. Recorded here because several were open in
`PROPOSED-UI-CASES.md` and were blocking M2.

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

Note: `PROPOSED-UI-CASES.md` attributes this gap to "B5". **That is
the wrong ID** — B5 is the lossy-content guardrail. The concurrency
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
not exist. The four options in `PROPOSED-UI-CASES.md` are closed by
this entry.

### K5 · Robustness is a standing rule, not a one-off

Ken, on the ~25 cases that fail as written: *"make sure this stays
robust (this is a general rule, should this go into our workflow)"*.

Written into `TEMP-RUN-WORKFLOW.md` § "Cases that cannot be satisfied
yet".

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

### A? · The activity response reports how many history rows it could not read

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

### A? · The activity feed never sorts; it renders the server's order

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
