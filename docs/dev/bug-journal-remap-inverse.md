# Bug: any workflow save on a tracker with a directional link poisons the journal and bricks every write

**Diagnosed 2026-09-06.** Read-only diagnosis; nothing here has been fixed.
Reproduced on a throwaway tracker with no hand-seeding (§ 5).

## 1. Symptom

On the seeded demo tracker, every task write on every surface failed with

```
internal: missing relationships remap for "is_blocked_by" on task DEMO-4
```

— board drag (`POST /api/tasks/*/board-move` → 500), `loctt set DEMO-1
priority low`, setting status on an unrelated task. Reads kept working.
`.loctt/local/journal.yaml` held one stuck `remap_workflow` entry (saved
copy: `/tmp/poisoned-journal.yaml`).

## 2. Verdict

**Shipped-code bug, not an interrupted-operation artifact.** No crash,
kill, or hand-edit is needed. The sequence is:

1. `loctt link A blocks B` writes a `blocks` edge on A **and** an
   `is_blocked_by` edge on B (`packages/core/src/task/relationships.ts:354-359`).
   That inverse edge is legitimate: the task validator accepts it
   (`config/validation.ts:43`, via `relationshipTypeKeys`).
2. Any Settings → Workflow save (`PUT /api/workflow` → `applyWorkflowEdit`)
   appends a `remap_workflow` journal entry (`workflow-write.ts:720-729`),
   then runs `executeWorkflowRemap`, which walks every task.
3. `applyRelationshipsRemap` (`workflow-write.ts:563-616`) checks each
   stored edge's `type` against `nextRelKeys`, which is built from
   `next.relationships.map(r => r.key)` (`:776`) — **forward keys only**.
   `is_blocked_by` is an inverse name, never a key, so it misses; the
   remap table has no entry for it either, so the function throws
   `internal: missing relationships remap …`.
4. The throw escapes `applyWorkflowEdit` before `clearJournalEntry`
   (`:733`) runs. The entry stays.
5. Every later `withStateLock` (`state/lock.ts:262`) runs
   `recoverPendingJournal` first, which dispatches the entry to the
   `remap_workflow` handler (`workflow-write.ts:838-850`), which calls
   the same `executeWorkflowRemap` on the same data and throws again,
   before the caller's work starts. Every write on every surface fails
   with the same message. Reads do not take the lock, so they succeed.

The journal did exactly what it was designed to do — replay an
"in-flight" op until it completes. The op can never complete because
the remap is wrong for real data, so the replay is a permanent
deterministic failure.

## 3. Q1 — why was the entry written, and why was it never cleared?

**What wrote it.** `applyWorkflowEdit` has exactly one production
caller: `handlePutWorkflow` in `apps/web/src/server/server.ts:1472-1514`,
which the Settings → Workflow panels reach through
`useSaveWorkflowCollection` (`apps/web/src/client/api/hooks/useWorkflowMutations.ts:99`).
Nothing in the seeding list touches it: `init` writes the default YAML
directly (`init/defaults.ts`), `createMilestone`/label/sprint/user go to
their own config files, `doctor --rebuild-index` only rewrites the key
index, and the corruption hand-edit is a task.md + labels.yaml. The CLI
and MCP have no workflow-edit command at all (grep for
`applyWorkflowEdit`/`saveWorkflowConfig` in `apps/cli`, `apps/mcp`: none).

So the entry came from the web UI during the review. The entry's `next`
tells us which panel: it is byte-for-byte the default workflow
(`init/defaults.ts:19-109`, prefix `DEMO-`) **except** that
`relationships` lists `parent` before `blocks`, whereas the default
lists `blocks` first. That is a drag-reorder in the Relationships
settings panel (`RelationshipsSettingsPanel.tsx:66-93` — `commit` fires a
PUT of the whole document with `remap: {}` on drop). A reviewer walking
the Settings screens and dragging one row is enough. (`started_at`
`07:34:07Z` should line up with the review session.)

**Why it was not cleared.** Not an interrupt. The PUT ran to the throw
at step 3 above: task loop reached the first task holding an inverse
edge (`DEMO-4`), threw, unwound out of `withStateLock`, and the
`clearJournalEntry` at `:733` was never reached. `saveWorkflowConfig`
was also never reached — the reorder itself was lost (workflow.yaml on
disk still has `blocks` first). The web route then reported it as a
`400 config_invalid` with `data_state: not_saved` and `recovery: retry`
(`server.ts:1508-1512`) — wrong on all three counts: the error is
internal, the journal *was* written, and retrying reproduces it.

**Is some operation silently journaling a remap it shouldn't?** No.
Only `applyWorkflowEdit` journals `remap_workflow`, and it should: it is
about to rewrite tasks. The defect is that the rewrite pass cannot
handle the data every `link` of a directional relationship produces.

## 4. Q2 — why can't `applyRelationshipsRemap` handle `is_blocked_by`?

Answer (a): **inverse type names are not in `nextRelKeys`.** Answer (b)
is also true but secondary: a remap whose `next` equals `prev` still
walks every task and still validates every edge — but even a
*meaningful* edit (reorder, label change, estimation toggle) has to
walk tasks, so "skip when nothing changed" would only narrow the
trigger, not remove it.

The root asymmetry: three places build the relationship vocabulary from
both sides of each definition —

- task validation: `validation.ts:43` — `flatMap(relationshipTypeKeys)`
- `linkTask`'s type check: `relationships.ts:249` — same
- `linkTask`'s inverse write: `relationships.ts:263,358` —
  `findInverseType` / `effectiveInverseKey`

— and the remap path builds it from `r.key` only, in **two** places:

- `executeWorkflowRemap` `:776` — `nextRelKeys` (what the loop trusts)
- `validateRemapCoversDeletions` `:332-356` — `nextRelKeys`/`prevRelKeys`
  and the remap-source check (what the user is allowed to say)

`computeWorkflowKeyUsage` (`:435-438`) *does* record inverse types as
in-use, but the validator only iterates `prev.relationships` by key, so
"is `is_blocked_by` still valid in `next`?" is never asked, and "you
must remap it" is never demanded. The apply pass then hits the edge
cold and throws the "internal bug" error — which, per its own comment
(`:462-465`), is what it does when "validation upstream allowed an
in-use key through without a remap". The comment is right; upstream did.

The workaround a user might reach for is also blocked: supplying
`remap.relationships["is_blocked_by"] = null` is rejected by the source
check at `:335-340` (`remap source 'is_blocked_by' is not a key in the
previous config`) — reproduced.

**Why every test is green.** All relationship fixtures in
`workflow-write.test.ts` (`makeLinkedPair`, `:469-490`, and `:560-580`)
write a **one-sided forward edge via `writeTask`** instead of calling
`linkTask`, so no test has ever held an inverse edge. `journal.test.ts`'s
`remap_workflow` cases (`:697-842`) seed tasks with no relationships.
The code outgrew the fixtures: the tests assert the remap works on data
LocTT never produces.

**The same defect breaks the intended delete/rename path**, not just
no-op saves. Reproduced in § 5: deleting `blocks` with
`remap {blocks: null}` drops A's forward edge, then throws on B's
inverse edge — leaving A with no edge, B with a dangling
`is_blocked_by`, workflow.yaml unchanged (still declares `blocks`), and
the journal poisoned. Renaming (`blocks → depends_on`) fails the same
way. So the feature's headline promise — "remap on delete keeps tasks
valid" — has never worked for any bilaterally-linked relationship.

Also affected: **renaming only the `inverse` field** of a definition
(e.g. `is_blocked_by → blocked_by`, key unchanged) would, even with the
`nextRelKeys` fix, orphan stored inverse edges unless the remap derives
old-inverse → new-inverse from the shared key. The fix must cover that
too.

**Cross-reference.** `docs/dev/phase-z-findings-correctness-git.md`
contains no inverse-relationship finding (grep: none); the config-state
findings mention inverse only in the collision validator. The closest
recorded relative is `known-gaps.md` § "`loctt link` rejects the inverse
side" — the same class of bug (a code path built its vocabulary from
`r.key` where core uses `relationshipTypeKeys`), in the CLI rather than
core. `decisions.md` A19 (unlink of a missing target) touches the
inverse write but is unrelated.

## 5. Q3 — blast radius and severity

Confirmed on a scratch tracker (`packages/core/dist` + `apps/cli/dist`
as built at HEAD `59d55e0`):

| Step | Result |
|---|---|
| `init --prefix DEMO-`, create ×3, `link DEMO-1 blocks DEMO-2` | DEMO-2 holds `type: is_blocked_by` |
| `applyWorkflowEdit(dir, unchangedConfig, {})` (what a no-op Settings save sends) | throws `missing relationships remap for "is_blocked_by" on task DEMO-2`; journal now has the entry |
| same, with `parent` reordered above `blocks` (the demo's actual edit) | same throw; workflow.yaml order unchanged |
| `loctt set DEMO-3 priority low` (unrelated task) | same error |
| `loctt create "D"` | same error |
| `loctt unlink DEMO-1 blocks DEMO-2` (the one write that would remove the edge) | same error |
| `loctt show DEMO-3` | works |
| `loctt doctor` | **all green** — doctor never reads the journal |
| `rm .loctt/local/journal.yaml`, then `set` | works |
| `link DEMO-3 parent DEMO-1` + no-op save | throws on `"child"` on DEMO-1 |
| `link relates_to` (symmetric, no inverse) + no-op save | OK — control |
| delete `blocks` with `remap {blocks: null}` | throws on DEMO-2 **after** rewriting DEMO-1; DEMO-1's edge gone, DEMO-2's inverse orphaned, config unsaved, journal left |
| `remap {blocks: null, is_blocked_by: null}` | rejected: `remap source 'is_blocked_by' is not a key` |

- **Every write, not board-only.** Anything that takes `withStateLock`:
  set/create/link/unlink/archive/comment, board-move, bulk, sprint/milestone
  deletes, git publish. Core → CLI, MCP, web all inherit it because the
  replay runs inside the lock helper itself.
- **Persists until the journal is deleted by hand.** Recovery is retried
  on every lock; it is deterministic, so it fails forever. No surface
  exposes the journal; `doctor` does not check it; `unlink`, the one
  operation that would remove the offending edge, is itself blocked.
  The only exit is `rm .loctt/local/journal.yaml` — and the user is
  never told that file exists.
- **Diagnosis is hostile.** The error names an unrelated task and says
  "internal"; the web reports the triggering save as "config invalid,
  not saved, retry"; a later board drag gives a 500 with the same
  message; `doctor` says everything is fine.
- **Data damage on the delete path** (last two rows): partial task
  rewrite with no rollback.

**Severity: HIGH (blocker for anyone using Settings → Workflow).**
Real-user reproduction is two ordinary actions: link two tasks with any
directional relationship (`parent`/`child` is the most common kind of
link in a tracker, `blocks` the second) and then save *anything* in
Settings → Workflow — reorder a status, rename a priority label, toggle
estimation. From that moment the tracker is read-only on all surfaces
until someone finds and deletes a gitignored file under `.loctt/local/`.
No crash or interruption is involved. The three `remap_workflow`
recovery tests and eleven relationship-remap tests are green because
none of them ever creates a real link.

## 6. Q4 — fix direction (not implemented)

**Layer: core, `packages/core/src/config/workflow-write.ts`.** The
replay handler and the live edit share `executeWorkflowRemap`, so one
fix covers both; a fix in the web route or in the journal would leave
the replay path — and CLI/MCP once they gain a workflow command — broken.

1. **Build the relationship vocabulary from both sides**, as the rest of
   core already does. In `executeWorkflowRemap` (`:776`) and in
   `validateRemapCoversDeletions` (`:332-333`), replace
   `relationships.map(r => r.key)` with `flatMap(relationshipTypeKeys)`.
   With this alone, every edge whose type still exists in `next` —
   forward or inverse — is preserved, and a no-op/reorder/label save
   stops walking into the throw. This is the minimal change and it fixes
   the bricking.

2. **Expand the user's key-level remap into a type-level table before
   applying it.** The user says `blocks → depends_on` or `blocks → null`
   in terms of keys, which is right (a definition is the unit of
   editing). Derive the inverse rows mechanically:
   `effectiveInverseKey(prevDef) → target === null ? null :
   effectiveInverseKey(nextDefFor(target))`. And for a definition whose
   key survives but whose `inverse` name changed, add
   `oldInverse → newInverse` automatically — no remap directive is
   needed because key identity carries the mapping. Symmetric
   definitions contribute one row. Keep the `:335-340` source check on
   *keys* so users still cannot name inverses directly; the expansion
   makes that unnecessary.

3. **Tests must seed edges through `linkTask`**, not one-sided
   `writeTask` (`workflow-write.test.ts:469-490,560-580`;
   `journal.test.ts:697-842`). Per the testing rule in `CLAUDE.md`, each
   of the existing green relationship tests should be shown to go red
   once the fixture writes real bilateral data and before the fix lands —
   they are currently asserting the bug. Add: no-op save with a
   `blocks` link; reorder with a `parent` link; delete-with-null
   removes both sides; rename remaps both sides; inverse-only rename
   remaps the inverse edges; replay of each of those.

Secondary, separately decidable (not required to fix this bug):

- **Recovery should not be able to block a tracker forever on a
  deterministic failure.** A replay that throws could be surfaced as a
  named `LocttError` ("a previous workflow edit could not be completed;
  entry <id> at `.loctt/local/journal.yaml`") rather than the bare
  internal message, and `doctor` should list pending journal entries
  (it currently reports green). Whether recovery should ever *give up*
  is a P-11 question for Ken — auto-discarding an entry is how a crash
  becomes silent corruption, which is exactly what the journal exists to
  prevent — so record it in `decisions.md` § 9 rather than deciding it
  in the fix.
- `handlePutWorkflow`'s fallback (`server.ts:1508-1512`) labels any
  non-`LocttError` as `config_invalid` / `not_saved` / `retry`. For an
  `internal:` throw all three are false. Once core raises a typed error
  this branch stops lying on its own; until then it is a known
  misattribution.
- `known-gaps.md` should carry this entry until the fix lands; the
  temporary workaround for an affected tracker is
  `rm .loctt/local/journal.yaml` (safe here because the interrupted op
  wrote nothing before throwing — **except** on the delete/rename path,
  where the orphaned inverse edge must also be removed by hand).

## 7. Files

- `packages/core/src/config/workflow-write.ts` — `:332-356`
  (`validateRemapCoversDeletions` relationships block), `:563-616`
  (`applyRelationshipsRemap`), `:687-736` (`applyWorkflowEdit`,
  journal write at `:720-729`, clear at `:733`), `:754-820`
  (`executeWorkflowRemap`, `nextRelKeys` at `:776`), `:838-850`
  (recovery handler)
- `packages/core/src/state/journal.ts` — `:129-135` (entry schema),
  `:538-574` (`recoverPendingJournal`)
- `packages/core/src/state/lock.ts` — `:262` (recovery runs before every
  locked op)
- `packages/core/src/task/relationships.ts` — `:249` (accepts both
  sides), `:354-359` (writes the inverse edge)
- `packages/core/src/config/validation.ts` — `:43` (accepts both sides)
- `packages/contracts/src/workflow.ts` — `:196-216`
  (`effectiveInverseKey`, `relationshipTypeKeys`)
- `apps/web/src/server/server.ts` — `:1472-1514` (`handlePutWorkflow`)
- `apps/web/src/client/settings/RelationshipsSettingsPanel.tsx` —
  `:66-93` (the drag that produced the demo's entry)
- `packages/core/src/config/workflow-write.test.ts` — `:469-490`,
  `:560-580` (one-sided fixtures)
- `packages/core/src/state/journal.test.ts` — `:697-842`
