# Flow: structured backup and restore

Acceptance criteria for M5.1, the structured JSONL backup. Written per
K17 ruling 3 — drafted, reviewed by three independent agents, iterated
to convergence, then built. Round 3 returned "buildable, no blockers".

Grounded in K4 and K17 (§ 9), A96 (§ 8), and measurement:
`DEFAULT_EXPORT_COLUMNS` is 18 (`task/export.ts:8`); a task directory
holds `task.md`, `_history.yaml`, `_comments.yaml`, `attachments/`
(`paths/index.ts:9-12`); config entities are `{id, name, …}`;
`move.ts:91-92` already does `allocateKey` + `appendKeyHistory`;
`state.yaml` is `{keys, retired_keys}` (`contracts/state.ts:19`).

**On principle tags.** Headers carry `P1`–`P10` from
`ui-test-cases/README.md`, per house format. Invariants from
`invariants.md` are referenced in prose as "invariant P-7", hyphenated
and named, so the two series are never confused. v1 conflated them.

## A. Export — what must survive

### BAK-C1 · blocker · P1 P4 · CLI MCP
**A round-trip loses none of the seven things the CSV drops.** Seed a
tracker with **at least three tasks**, two of them related, one
archived, one with an attachment. Export, restore into an empty
tracker, and compare.

- These exact fields survive, each asserted by name, not as a group:
  `body`, `relationships`, `fields`, `key_history`,
  `archived`/`archived_at`, `rank`, `board_rank`.
- **Multi-task properties are asserted, not just per-task ones**: a
  relationship's inverse exists on its target (invariant P-12), and no
  two restored tasks share a key.
- **Read the far end**: compare `task.md`, `_history.yaml`,
  `_comments.yaml` and `attachments/` on disk, not an API response.
- **A backup taken on the CLI restores through MCP, and the reverse.**
- Anything excluded is listed by the export itself, and the case names
  the **whole** list so a new exclusion cannot be added silently:
  `.loctt/local/` (all five files, A96), each user's `settings.yaml`
  and `recents.yaml` (invariant Q22), and `.schema-migration-in-progress`.
  `.schema-version` is *recorded* rather than restored — see BAK-C21.

> v1 said "byte-identical where the format allows", which let the
> implementer decide what the format allows, and seeded "a task with
> every field", which one all-fields task satisfies while losing
> everything that only exists between tasks.

### BAK-C2 · blocker · P4 · CLI MCP
**The backup carries values, and the CSV is untouched by it.**

- For each of the seven fields, the restored **value equals** the
  source's. An empty string or an empty array does not pass.
- The CSV still emits its 18 columns and no more (K4 ruling 1).
- `DEFAULT_EXPORT_COLUMNS` is still exactly 18 after the backup ships,
  so the report did not become a backup by accident (K4 ruling 1).

> `exportTasksToJSON` *can* emit `body` via `includeBody`
> (`export.ts:62`), so the CSV/JSON exporter's gap is
> `relationships`, `fields` and `key_history` — not the body. v1 said
> otherwise and overstated the contrast.

### BAK-C3 · major · P1 · CLI MCP
**A malformed line is reported and skipped; nothing else is lost.**
Corrupt one line by hand, then restore.

- Every other task restores.
- The bad line is named in the report with its line number.
- The count in the report equals what is actually on disk afterwards.
- **The mirror, which is where invariant P-11 has teeth**: restoring
  into a tracker whose `_comments.yaml` is unreadable does **not**
  overwrite it. P-11's worked example is precisely the 2026-08-17 bug
  where a failed read preceded a write and a three-comment thread
  became one.

### BAK-C4 · major · P4 · CLI MCP
**History is in by default and can be opted out** (K17 ruling 1).

- With no flag, the restored `_history.yaml` has the **same entry count
  and the same first and last entries** as the source.
- With the opt-out flag, the file is absent, and the export's report
  says history was excluded.
- Opting out of history changes neither comments nor attachments.

### BAK-C5 · blocker · P9 · CLI MCP
**A binary attachment survives byte-for-byte.** Attach a PNG containing
non-UTF8 bytes.

- The restored file's bytes equal the original's — compared as bytes,
  not as a decoded string.
- A task with no attachments carries no empty attachment structure.
- Two tasks attaching files of the same name keep them separate.

### BAK-C6 · minor · P9 · CLI MCP
**The export reports its own size cost.** Export a tracker with a large
attachment.

- The report states the output size in bytes.

### BAK-C7 · minor · P9 · CLI MCP
**A tracker above the threshold splits and reconstructs.** Export a
tracker seeded past the recorded threshold.

- The output is numbered parts.
- Restoring the full set reconstructs every task.

> **Blocked on the threshold decision.** The number is an agent call
> recorded at step 1 with a revert path (as BLK-30's was). Until it is
> recorded this case cannot be written into the spec, since otherwise
> whatever number the implementer picks satisfies it by construction.

### BAK-C8 · blocker · P4 P5 · CLI MCP
**A partial set is refused, not half-restored.** Restore with one part
of the set missing.

- Nothing is written. Exit non-zero.
- The error names which part is missing.

> Split from v1's BAK-C6. A half restore reporting success is a
> blocker; the splitting itself is a minor. One severity could not
> honestly cover both.

## B. Restore — the three modes (K17 ruling 2)

### BAK-C9 · blocker · P4 P5 · CLI MCP
**Bare restore refuses a non-empty tracker.** Restore into a tracker of
42 tasks.

- Nothing is written; exit non-zero.
- The error states the count and names both flags.

### BAK-C10 · blocker · P4 · CLI MCP
**`--merge` adds absent ids and edits nothing else.**

- Tasks whose `id` is absent are created.
- Tasks whose `id` is present are **byte-identical afterwards** —
  compared on disk.
- Restores a task the destination **hard-deleted** since the backup:
  the recover-my-deleted-tasks journey, where the destination has moved
  on (later `updated_at`, keys since reallocated).
- The report gives created and skipped counts separately.

### BAK-C11 · blocker · P1 P7 · CLI MCP
**A key collision reallocates and the old key still resolves.** Two
trackers independently allocated `T-4` to different tasks.

- The restored task takes a fresh key from the destination project's
  counter.
- Its original key is appended to `key_history` and **resolves by
  lookup after the restore** (invariant P-7).
- **`key-index.yaml` is rebuilt, and resolves the old key too** — not
  merely a `key_history` scan. A96 excludes the index from the backup
  precisely so a stale one cannot be restored.
- The destination's existing `T-4` is untouched.
- The observable consequences of `move.ts`'s path are all present:
  `key_history` appended, the destination counter advanced, and a
  history entry written. Asserting "it calls the same function" is a
  code-review item, not a case; these are what that path *does*.

### BAK-C12 · blocker · P1 · CLI MCP
**Key counters merge by max, so no key is ever reissued.** Merge a
backup whose project counter is behind the destination's.

- Each project's counter afterwards is
  **`max(backup counter, destination counter, highest key in use + 1)`**.
  Seed a fixture where **both counters are behind the tasks** — a
  hand-edited `state.yaml`, or one restored from an older backup — so
  a max-of-counters-only implementation fails here rather than passing
  and colliding later.
- Creating a task immediately after the restore yields a key that
  **collides with nothing**, on either side's tasks.
- **`retired_keys` survives and still guards.** A project deleted on
  either side keeps its high-water mark, so a key still live in some
  task's `key_history` is never reissued. It is `.optional()`
  (`contracts/state.ts:19`), so absent-on-one-side is a real input.
- On a bare restore, the backup's counters are used as-is — subject to
  the same highest-key-in-use ceiling.

> **This is `deriveKeyState` (`git/merge.ts:332`), which already exists
> and already does all of the above** — `max(derived, floor)` where
> `derived` is highest-in-use + 1. Sync solved this problem; restore is
> the same problem. A second key-merge path is how the two drift, which
> is the argument C11 makes about `move.ts`.

> The reviewer's largest finding, and absent from v1 entirely. Without
> it a bare-machine restore corrupts on the first `task create`, and
> nothing before that point looks wrong.

### BAK-C13 · blocker · P4 P5 · CLI MCP
**`--overwrite` replaces the ids it carries and says what it
destroyed.**

- Ids in the backup are replaced; ids absent from it are untouched.
- **A displaced body is preserved, not discarded** (K17 ruling 6).
  Overwrite a task whose destination body differs from the backup's:
  the destination's text is recoverable afterwards and is named in the
  report. `mergeTask` (`git/merge.ts:73`) already returns it for
  exactly this, and `merge.test.ts:186` already asserts the mechanism.
- Asserting only the count of overwrites passes while the text is gone,
  which is the failure `mergeTask`'s own comment calls the one that
  costs most.
- The report names how many were overwritten — this is the only mode
  that can lose work done since the backup.

### BAK-C14 · blocker · P9 · CLI MCP
**Restore is atomic at every kill point.** Kill the process at three
stated points: after config is written, mid-task-write, and after N of
M tasks.

- At each, the tracker is either fully restored or unchanged.
- **Two further kill points**: after the writes complete but before the
  journal entry is cleared, and during the `key-index.yaml` rebuild
  C11 requires.
- **The restore is journalled** (`state/journal.ts`,
  `.loctt/local/journal.yaml`). A `withStateLock` alone is not enough:
  SIGKILL takes the lock with the process, so an unjournalled restore
  leaves a half-written tracker with nothing to recover from — and
  would pass a case that only checked the lock.
- The next boot **resumes or reports** the journalled restore; it is
  never silently ignored.

> `JournalEntrySchema` (`state/journal.ts:165`) is a closed
> discriminated union of seven kinds and none is a restore, so this
> needs an eighth variant and a `registerRecoveryHandler`. Better known
> now than discovered at build time.

> v1 said "interrupt partway" with no point named, which an
> implementation atomic only at the final rename would pass.

### BAK-C15 · major · P4 · CLI MCP
**`--dry-run` predicts accurately and changes nothing, in all three
modes.**

- For **each** mode, the predicted counts equal what the real run then
  produces.
- The tracker is byte-identical after a dry run.

## C. Config (K17 ruling 2: tasks + config)

### BAK-C16 · blocker · P1 · CLI MCP
**Config restores with its values, so a bare machine works.**

- Projects, labels, milestones, sprints, users and workflow config all
  exist afterwards **with their fields equal to the source's** — an id
  that resolves to a nameless stub does not pass.
- No task carries a dangling reference (V9 refuses these rather than
  keeping them).
- Stored enum values resolve to their configured keys.
- **Queries and list-view config**: `queries.yaml` and `list-view.yaml`
  are either restored, or named in the export's exclusion list. Silence
  is not a decision.
- **Users are not config**: they live at `users/<id>/profile.yaml`
  alongside `settings.yaml`, `recents.yaml` and avatar files. The
  profile and avatar travel. **`settings.yaml` and `recents.yaml` do
  not**, and both are named in the exclusion list — `recents.yaml` is
  invariant **Q22**, "machine-local and gitignored, never published".
  The obvious implementation (copy `users/<id>/`, skip `settings.yaml`)
  violates Q22 while passing every other bullet, so this must be
  asserted by *absence of the file after restore*, not by prose.

### BAK-C17 · blocker · P4 · CLI MCP
**A name collision keeps both and renames the incoming one.** Both
trackers hold a label named "bug" with different ULIDs — already a
legal state, since `LabelsConfigSchema` dedupes on `id`
(`contracts/labels.ts:32`).

- Both survive with their own ids (K17 ruling 4).
- The incoming one is renamed to a **non-colliding** name: `bug (2)`,
  and `bug (3)` if `bug (2)` is taken. A second merge does not produce
  two `bug (2)`s.
- Every rename is named in the report.
- Tasks from the backup point at the renamed label; the destination's
  tasks still point at theirs.
- The non-default `remap` mode, if built, is **per entity type**:
  remapping two same-named sprints onto one id discards a
  `start_date`, `end_date` and `state`, which labels do not have.

### BAK-C18 · blocker · P4 · CLI MCP
**A reference that cannot be satisfied fails with the thing named.**

- A task whose project is missing, with config restore disabled: the
  error names the project.
- A relationship whose target is in neither backup nor destination:
  **the task restores and the dangling edge is reported**, not blocked
  (K17 ruling 7). `doctor` and sync pre-flight already surface it as
  `inconsistent`.
- The edge is **kept, not stripped**. Dropping it to leave a tidy
  tracker is what invariant P-11 calls "destruction wearing leniency's
  clothes".

> **This case said the opposite until 2026-09-02**, and it was wrong
> against two recorded invariants. P-12 says cross-file dependency
> validation is "reported by `doctor` and sync pre-flight as
> `inconsistent`, **blocking neither**"; P-11 says leniency keeps. The
> original wording — "nothing partial is written" — would have let one
> stale reference from a task deleted months ago on another machine
> cost someone their whole restore. The build agent escalated rather
> than adjudicating, which is what `build-loop.md` asks for; Ken ruled
> for the invariants.

## D. Format

### BAK-C19 · major · P9 · CLI MCP
**The file streams — it is read without parsing the whole of it.**

- Restore emits its **first per-task report line before the file has
  been fully consumed** — mechanically checkable, unlike peak memory.
- A file whose size exceeds Node's string limit restores rather than
  throwing, which a whole-file `readFileSync` implementation cannot do.

> v2 asserted "peak memory well under the file size". There is no
> `memoryUsage`/`heapUsed` anywhere in `packages/` or `apps/`, heap
> under vitest is contaminated by the runner and GC timing, and "well
> under" has no number — so the implementer picks a threshold that
> passes. That is the case that gets skipped in month two. Note core
> has no `createReadStream`/`readline` today, so this is new ground.

## E. Cases added in v3, from review round 2

### BAK-C20 · blocker · P1 · CLI MCP
**Colliding project prefixes are resolved, not left to double-issue
keys.** Two independently `init`ed trackers both minted prefix `T-`
for different projects; merge one into the other.

- Both projects survive with their own ULIDs (invariant P-1).
- One prefix is reassigned so the two do not both issue `T-n`, and the
  reassignment is named in the report.
- Every task of the reassigned project has its key rewritten, with the
  old key in `key_history` and still resolving (invariant P-7).
- **The slug collides too, and that failure is harder.** Two `init`ed
  trackers both derive slug `tasks`, and `ProjectsConfigSchema`
  **rejects** the duplicate — so the merged `projects.yaml` does not
  load at all. `assignProvisionalSlugs` (`merge.ts:462`) is the
  sibling fix and must run alongside.
- `key-index.yaml` is rebuilt after the rewrite, per BAK-C11.
  Reassigning the prefix in `state.yaml` and `projects.yaml` and
  rewriting keys only in frontmatter passes every other bullet while
  leaving the index stale.
- **`assignProvisionalPrefixes` (`git/merge.ts:411`) already exists for
  exactly this** — sync hit it first. Restore is the same collision.
  Order matters: prefixes are reassigned **before** keys are
  allocated, or keys are minted against a prefix that then changes.

> C11 says "two trackers independently allocated `T-4`", which *needs*
> colliding prefixes to be the interesting case, then never says what
> happens to the prefix. This is that missing half.

### BAK-C21 · blocker · P4 P6 · CLI MCP
**A backup carries its schema version, and a mismatch is refused with
both versions named.**

- The export records the `.schema-version` it was taken at **in the
  first line of the file**, so the check does not require reading to
  the end. A footer would satisfy this case and contradict BAK-C19.
- Restoring a backup from a **newer** schema refuses and names both
  versions — `SchemaTooNewError` already exists for this shape.
- Restoring from an **older** schema either migrates or refuses; which
  one is a decision to record, not an implementation detail to leave
  to whoever writes it first.
- Nothing partial is written in either case.

> The likeliest real-world failure for a file whose whole purpose is
> travelling between machines, and v2 had nothing on it.

### BAK-C22 · major · P4 P6 · CLI MCP
**Restoring into a tracker that is itself mid-operation refuses.**

- A destination holding a `prefix-rename.yaml` sentinel: the restore
  refuses rather than interleaving with a half-finished rename.
- A destination holding `.schema-migration-in-progress`: the restore
  refuses, matching the boot behaviour that screen already has
  (SHL-37, A11Y-49).
- Each refusal names the sentinel and what to run.

### BAK-C23 · blocker · P9 · CLI MCP
**The four merge hazards, together.** Merge two active trackers where
*simultaneously*: both hold tasks, keys collide, prefixes collide,
label names collide, and the counters have diverged.

- The outcome satisfies C11, C12, C17 and C20 **at once**.
- No key is issued twice afterwards, across either side's tasks.
- Every task points at a label and project that exist.
- The report accounts for every task in both inputs — nothing silently
  dropped.

> Each piece passing alone does not make the combination work, and the
> combination is what "merge two machines" actually is.

### BAK-C24 · blocker · P4 P10 · CLI MCP
**Restore's merge is sync's merge, not a second implementation.**
`git/merge.ts` exports eight functions, and `--merge` needs nearly all
of them. Each is already built, tested, and carries a rule someone
decided:

| Function | What restore needs it for |
|---|---|
| `mergeById` (`:510`) | **`--merge`'s exact rule** — "incoming first, so a local entry with the same id overwrites it": add what is absent, never edit what is present. Local-wins, settled by Ken 2026-08-16. |
| `deriveKeyState` (`:332`) | counters, including the highest-key-in-use ceiling (BAK-C12) |
| `assignProvisionalPrefixes` (`:411`) | prefix collision (BAK-C20) |
| `assignProvisionalSlugs` (`:462`) | slug collision, ordered by id so two machines agree (K3, A60) |
| `mergeComments` (`:285`) | two edits to one comment, resolved by `updated_at` |
| `mergeHistory` (`:235`) | one timeline, sorted by timestamp |
| `mergeTask` (`:78`), `laterWins` (`:61`) | **Not for restore's merge.** Both are three-way last-writer-wins resolution; restore's three modes are deliberately not that. `mergeTask`'s *displaced-body* half is used by `--overwrite` (K17 ruling 6) — the resolution half is not. |

Assert the **behaviour** each encodes, not the call — a case that
asserts "it calls `mergeById`" is a code-review item, which is why
BAK-C11's equivalent bullet was rewritten:

- Merging a comment edited on both sides keeps the later `updated_at`
  and loses neither (invariant P-11).
- Merged history is one timeline in timestamp order, not two
  concatenated.
- A slug collision resolves the same way whichever side runs the
  restore — ordering by id is what makes that true.
- A restored entity present on both sides is the **local** one.

> **This is the finding, and it is the run's most repeated shape.**
> Fourteen capabilities so far were found already built and uncalled,
> `unarchiveView` with no caller at all. Sync and restore are the same
> problem — two trackers, divergent state, one result — and v1 through
> v3 of these cases treated all of it as new work. A second merge
> implementation would not merely duplicate; it would silently disagree
> with sync about a rule Ken already settled.

## F. Deliberately not covered

- **"Appendable" and "diffable"** (the ticket's own words) have no
  case. Appending to a backup is not a described operation, and
  diffability follows from one-task-per-line, which BAK-C3 asserts.
  Named here so the omission is a decision rather than a gap.
