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
   drift with a good address, which `TEMP-RUN-WORKFLOW.md` § "Which
   layer" rules out.
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
server code and no documented contract. Also recorded in
`PROPOSED-UI-CASES.md`.

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

**To revert.** Delete the M2.6 ticket from `TEMP-WEB-TICKETS.md` and
choose one of options 2–4. Nothing is built on this decision beyond
the ticket's own existence.

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

**Why.** The case offers "or flagged in place" explicitly, and what it
actually requires is met: the task is named, the offending field is
named, the constraint is stated, and no `Invalid Date` appears. The
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

### K10 · The body-write precondition ships on every surface, not just the web

**Date:** 2026-08-30 · **Ken's ruling — an agent may not revert this.**

**The situation.** K2 ruled that the body-write precondition ships with
the editor, on the stated grounds that autosave without one "silently
overwrites a concurrent CLI or MCP edit every 1.5 idle seconds,
unattended, which is exactly what P1 forbids". It was then built
**web-only**: `bodyToken` / `expectedToken` appear in
`apps/web/src/server/server.ts` and in neither `apps/cli/src` nor
`apps/mcp/src` (grep with positive control). Core's own docstring says
"Omit for last-write-wins, which is what every existing caller gets."

So the guard protects the web editor from itself, while the two surfaces
K2 named as *the threat* write unguarded. The M2 gate raised this as a
blocker, correctly.

**The usability case Ken ruled on.** The failure without it: a task is
open in the web UI; the user edits the body in their terminal with
`loctt body --set`; the browser autosaves 1.5s after the next keystroke
and **silently destroys the terminal edit** — no warning, no conflict, no
trace. That is the worst shape a data-loss bug can take: invisible,
unattended, and it discards work the user did deliberately in favour of
work they may have done by accident.

**Ruling: (a) — CLI and MCP acquire a token on read and pass it on
write.** Plus a `--force` escape hatch (MCP: `force: true`).

Rejected: an opt-in `--if-unchanged` flag, because it leaves the unsafe
behaviour as the default and only protects users already being careful.
Rejected: warn-but-still-write, because the data is gone by the time the
warning prints and scrollback is easy to miss.

**The accepted cost, stated before the ruling.** `loctt body --set`
starts refusing where it always succeeded — a real behaviour change to
two published surfaces. A script looping `--set` over tasks an agent is
also editing will begin failing. `--force` is the deliberate way
through; it is not the default, so the safe path is what you get by
not thinking about it.

`--force` is not a new convention: it already means exactly this on
`sprint` (`apps/cli/src/commands/sprint.ts:34`) and on attachments
(`task-files.ts:20`), and MCP already takes `force: z.boolean()`.

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
