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

**Two cautions recorded at the time of the decision:**

1. Changing MCP's error output is a breaking change to the agent-facing
   surface, and MCP has no version negotiation. Worth doing once,
   deliberately — not as a side effect of a refactor.
2. Whether the code set is the *right* set is only answerable once a UI
   renders it. Designing an error taxonomy in the abstract risks
   discovering it has the wrong shape at M2. Prefer extending the web's
   existing `ErrorCode` union over inventing a parallel one.

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
