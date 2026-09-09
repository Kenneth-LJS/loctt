# Proposed changes to `docs/dev/ui-test-cases/`

The audit did **not** edit the 18 UI flow docs. Everything the ten slices
found that bears on them is collected here for you to accept, reject, or
reword before anything is applied.

Three kinds of item:

1. **Contradictions** — two existing cases that cannot both be satisfied.
   These need a decision, not an edit.
2. **Cases that will fail as written** — the case is reasonable but
   describes behaviour the code does not have, sometimes because a
   *different* component is missing.
3. **Proposed new cases** — gaps with suggested IDs, appended to each
   file's existing numbering. No renumbering anywhere.

**Six items here are now DECIDED** — see `docs/dev/decisions.md` § 9
(Ken's rulings, 2026-08-29): the SET-3/SET-6 contradiction, the
body-save question, project URL slugs, BLK-30's threshold, and the CSV
export. Their sections below are marked and kept for the reasoning,
not because they are still open.

Each item states the finding behind it inline. (The audit document these
were extracted from was deleted once its blockers were fixed; see
`git log` for `FEATURE-AUDIT.md` if the original wording is needed.)

---

## 1. Contradictions to resolve

### ✅ DECIDED (K1) · SET-3 vs SET-6 — `flow-settings.md`

SET-3 asserts workflow panels are read-only: *"No status is presented as
editable — no inline text inputs, no delete buttons."* SET-6 asserts
drag-reorder persists to `workflow.yaml`, and SET-17/SET-19 assert
in-panel deletion with remap.

Both cannot hold. The API (`PUT /api/workflow`) supports the **editable**
reading, and `workflow-write.ts` (822 lines, full per-collection remap)
was clearly built for it. Recommendation: **drop SET-3**, keep the
editable reading.

### ✅ DECIDED (K2) · Body save: `markdown-extensions.md` vs TSK-15

`markdown-extensions.md:110-120` mandates explicit-Save and no autosave.
TSK-15 mandates 1.5s idle autosave. The 15-minute `body_edited`
coalescing window in core only makes sense under the autosave reading —
under explicit-Save it silently merges two deliberate saves.

**Ken's ruling: autosave**, and correct `markdown-extensions.md` — **and
the precondition ships with the body editor**, not as a follow-up. There
is no concurrency control anywhere today (no `If-Match`, no `412`, no
version on any write path), so autosave without one silently overwrites
a concurrent CLI or MCP edit every 1.5 idle seconds. See K2.

(The "B5" attribution above is **wrong** — B5 is the lossy-content
guardrail. The concurrency gap has no B-number.)

### ✅ DECIDED (K3) · `?project=web` URLs — PRU-2 / PRU-6

The flow doc assumes project slugs in URLs. `ProjectDefSchema` is
`.strict()` with `{id, name, prefix, archived?}` — there is **no** `key`
or slug field, and `state.keys` is indexed by ULID.

**Ken's ruling: reintroduce the slug field.** URLs carry the slug, not
the ULID. This is a core schema change and needs slug generation,
uniqueness, and a rename policy — M-ticket work, not settled here.

---

## 2. Existing cases that will fail as written

> **✅ RESOLVED-BY-BUILD (2026-09-05).** Every case in this section is now
> covered — they were built during the M-phases and after, so the
> "fails today" descriptions below are historical. Verified with
> `cases:coverage --require` against each of: SET-14/16/18/22/24/28/33,
> SET-10, LST-13/15/16/44/45, REL-40, VUE-1/16/31/32/33/34, ERR-30,
> XS-33/34/35, PRU-18/31/33, SPR-26, and the MSL-progress family. Kept
> for the reasoning trail; no action remains here. (TSK-57 from Section 3
> was decided as K25; TSK-58's Duplicate/Move cases — TSK-20/21/51 — are
> also built and covered.)

| Case | File | Why it failed when this was written (all built since) |
|---|---|---|
| **SET-14, SET-18, SET-33** | `flow-settings.md` | All three depend on Diagnostics reporting workflow-key drift. `doctor.ts:263-270` explicitly filters workflow-key errors out (B10). SET-14's "the check set matches what `loctt doctor` reports" would make the UI *inherit* the omission — reword so the UI is not bound to doctor's current blindness. |
| **SET-16** | `flow-settings.md` | "No request that would change `type` is accepted server-side either" is false: `assertCustomFieldTypeChangesAreSafe` allows `number → string` when no task data is incompatible (`workflow-write.test.ts:895`). Either the case or the guard moves. |
| **SET-28** | `flow-settings.md` | Hand-edit underneath an open panel has no mechanism to test against — there is no optimistic concurrency anywhere (B5). Fails by construction until B5 is fixed. |
| **SET-22, SET-10** | `flow-settings.md` | Working-day assertions have no consumer: nothing in the codebase reads `working_days` or `holidays`. |
| **SET-24** | `flow-settings.md` | `IanaTimezone` rejects at parse time, so an unresolvable timezone surfaces as `CalendarConfigError` → a bare 500, not the "shows the stored value, marks it unresolvable" state described. |
| **LST-13** | `flow-list.md` | Honest `total` is computed and returned (`server.ts:363-375`) but never rendered. |
| **LST-15** | `flow-list.md` | "`searchable: false` is excluded from `text`" — the `text` alias searches `id`/`key`/body and ignores `searchable: false`. |
| **LST-16** | `flow-list.md` | `list-view.yaml` filter visibility is parsed and served, and FilterBar ignores it. The case also stops at the URL write, so it passes while results never change (`useTasks.ts:53-69` drops every `field.*` key). |
| **LST-44, LST-45** | `flow-list.md` | Structured query-parse errors — a DSL error propagates to the generic 500 (B16), discarding position and suggestions that `validate.ts` deliberately carries. |
| **REL-40** | `flow-relationships.md` | ~~The 20-file drop is unimplemented at the API layer: `multipart.ts:69` drains all parts after the first.~~ **Re-read 2026-08-29: not a server gap.** The parser does take one file per request, but REL-40 asks for *per-file outcome* — "each file gets its own tile or its own failure line", "one failure does not abort the remaining uploads" — and never for one request. Twenty sequential POSTs to the existing single-file route give exactly that, and it already enforces REL-35's size cap, REL-36's traversal refusal and REL-39's collision check per file. A batch endpoint would be the *harder* route: it would have to invent a partial-failure shape and re-derive errors the single-file route already returns. **Client-side; do not change `multipart.ts`.** **Built in M2.5b** as twenty sequential POSTs from `AttachmentsPanel`; `multipart.ts` unchanged. |
| **SPR-26** | `flow-sprints.md` | Unreachable from the UI: `handleUpdateSprint` has no `archived` field and there is no archive/unarchive route (B17). |
| **MSL-1, MSL-2, and 8 others** | `flow-milestones-labels.md` | ~~Milestone progress does not exist anywhere in `packages` or `apps` (B20).~~ **This is wrong, verified 2026-08-29.** `computeProgress` is at `packages/core/src/task/progress.ts:45`, the CLI has `milestone list --progress`, and MCP has a milestone tool. The gap is the **web view only**, which is M4 work. Whether MSL-1's per-milestone rollup needs more than the generic function provides is a separate, smaller question. |
| **VUE-31…34** | `flow-saved-views.md` | Three blockers depend on a DSL validation endpoint. `validateQuery` is exported from core with no caller and no route. |
| **VUE-1, VUE-16** | `flow-saved-views.md` | Count-only query mode for sidebar badges does not exist. |
| **PRU-33** | `flow-projects-users.md` | Specifies a refusal that the code contradicts — the "cannot delete the only project" guard never fires over HTTP, because DELETE never passes `hard:true` (B17). |
| **PRU-18** | `flow-projects-users.md` | Counter restoration on recreate: `manage.ts:176-188` explicitly states retired counters are *not* auto-restored — the deliberate opposite of the case and of `schema-reference.md:440`. |
| **PRU-31** | `flow-projects-users.md` | Avatar removal is unimplementable — no `removeAvatar` exists and `updateUser` offers no null-clear, so avatars are write-once-permanent. |
| **ERR-30** | `flow-error-handling.md` | Names "Something went wrong" as a failing result; the generic 500 returns literally `"Internal server error"` (B16). The whole file is structurally unsatisfiable until the error envelope changes. |
| **ONB-1…7** | `flow-onboarding.md` | The init wizard is unbuilt (M4) — expected, listed for completeness. |
| **XS-33, XS-34, XS-35** | `flow-cross-surface.md` | Schema `future` / missing-file cases: reachable, but note `/api/info` itself 409s on a cold load, so the banner may have no payload to render from. |

---

## 3. Proposed new cases

Appended to each file's existing numbering. Bodies are sketched, not
finished prose — reword freely.

### `flow-tasks.md` (currently ends at TSK-56)

- **TSK-57 · blocker · P4** — Archiving an already-archived task shows a
  real message, not a generic failure. Covers the server returning 4xx
  with "task is already archived" rather than a 500 (B16 fallout).
- **TSK-58 · blocker · P10** — Duplicate and move are reachable from the
  UI, or the flow doc scopes them out. TSK-20/21/43/51 are M2 blockers
  with no API behind them (B19).

### `flow-list.md`

- **LST-48 · major · P4 P6** — The list shows an explicit **error** state
  when `/api/tasks` returns 4xx/5xx, distinct from LST-8's empty and
  LST-47's unreachable-server. `ListView.tsx:119` currently collapses all
  three into "No tasks match these filters".
- **LST-49 · major · P3** — A custom-field chip actually **narrows
  results**, not merely appears in the URL. LST-16 stops at the URL write,
  which is why the dropped `field.*` keys went unnoticed.

### `flow-saved-views.md`

- **VUE-37 · blocker · P1 P7** — A view saved from the UI is re-readable
  by `parseQueriesConfig`; the write cannot poison the whole file. VUE-6
  checks CLI/MCP runnability but not that the file still loads, and
  `config/queries.ts:42` rejects the **entire** file on one bad query.
  This is the case that would have caught B8's Save-as-view path.
- **VUE-38 · major · P5** — Unarchiving a view from the UI. VUE-25 covers
  archived-but-runnable; nothing covers restoring, and `unarchiveView`
  has no caller.

### `flow-settings.md`

- **SET-43 · blocker · P10** — Config **read** parity: a settings panel
  can read back a value it just wrote. `GET /api/config/:key` returns 404
  today; the surface is write-only (B-CFG).
- **SET-44 · major · P4 P7** — A duplicate status key is rejected on
  write with a message naming the collision. `PUT /api/workflow` currently
  returns 200 and writes the duplicate to disk (B9).
- **SET-45 · minor · P4** — An I/O failure (EACCES) is distinguished from
  a validation failure. `handlePutWorkflow` catches everything as 400, so
  a permissions problem reads as client error.

### `flow-git-sync.md` (currently ends at GIT-38)

The CLI/MCP-reachable cases are written out in
[`docs/dev/surface-test-cases/flow-git-sync.md`](docs/dev/surface-test-cases/flow-git-sync.md)
as GIT-C1…C9. Note that the four data-loss blockers in that area are now
**fixed** — see `packages/core/src/git/three-way.ts` and the regression
tests in `packages/core/src/git/publish-sync.test.ts` — so what remains is
field-level merge, rekeying, error quality, and status detail.

The UI-facing subset worth lifting into this flow doc once a git UI exists:

- **Sync reports what it changed**, not just that it succeeded. The CLI and
  MCP now emit counts ("3 updated, 1 removed"); a UI should render the same.
- **A failed push does not advance `last_synced_commit`** (still open).
- **Git status renders drift.** `getGitStatus` returns a config echo plus
  `isGitRepo`, so no UI built on it can show reconciliation state — this
  blocks the flow doc's reconciliation cases regardless of UI work.

---

## 4. A note on the UI test-case tree itself

The tree is good — the P1–P10 principles are genuinely generative, and
several cases in it describe behaviour the code gets wrong, which is
exactly what a spec should do.

Two structural observations:

**The tree assumes the API it needs exists.** 7 of 18 flows cannot be
backed today. That is not a flaw in the docs —
they were written as a target — but the M-tags imply a build order that
the API gaps do not currently support. Worth a pass to check each flow's
milestone against whether its endpoints are in that milestone too.

**Cases that stop at the UI boundary can pass while the feature is
broken.** LST-16 (chip appears in URL) and VUE-6 (view is CLI-runnable)
both stop one step short of the assertion that would have caught a real
bug. The pattern to watch for: a case that checks the UI *emitted*
something, without checking the far end *accepted* it. This is the same
failure mode as the three test suites that encode bugs as expectations
that the 2026-08-14/15 sessions found.

---

## ✅ DECIDED (K6) · the threshold in BLK-30's "proportionate" confirmation

**DECIDED 2026-08-29 — see `decisions.md` § 9 K6.**

**The ruling:** two tiers at 10, as built. Above ten, type the count.
**Not configurable** — a config key would let the threshold be set to
10,000, turning P5's guarantee into an opt-out; and the constant is
exported, so moving it is one edit if ten proves wrong. Bullet 3's
optional refusal stays unimplemented: a local tracker has no server to
protect, and refusing to delete the user's own files is paternalism.

The original framing follows.

BLK-30 requires that "the confirmation string required is
proportionate — deleting 1,280 tasks must not require the same
keystroke as deleting 2", but names no boundary. The implementation
had to pick one, so it picked: **above 10 tasks, the user types the
count instead of the word `DELETE`.**

The reasoning: a fixed word is muscle memory by the third use, and ten
is roughly where a selection stops being something you can see and
verify at a glance. Typing the number cannot be done without reading
it.

What is genuinely open, and is Ken's rather than mine:

- **The number.** 10 is a guess. 25 and 50 are equally defensible.
- **The escalation shape.** Two tiers, or three? Something harder
  again above, say, 500?
- **Whether the count is the right string.** "1280" is short. Some
  apps ask for the project name instead, which is longer and less
  guessable but also less obviously tied to the thing being deleted.

`LARGE_DELETE_THRESHOLD` and `deleteConfirmWord()` in
`DeleteConfirmDialog.tsx` are the two places any of this changes.

---

## ✅ DECIDED (K4) · whether CSV export should resolve ULIDs to names

**DECIDED 2026-08-29 — see `decisions.md` § 9 K4. The four options
below are closed.**

**The ruling:** the CSV is a **report for a human in a spreadsheet**, so
reference columns resolve to **names**; `id` stays (nothing scripted
against the export breaks, and BLK-36's column count is unchanged); a
size-split **JSONL** export is the backup, on its own ticket after M4.

**Two things measured after these options were written, both of which
change them.** First, **there is no CSV import anywhere in the
codebase** — so "an id round-trips and a name does not" defends a
round-trip that does not exist. Second, the CSV **cannot** be a backup:
18 columns against 27 frontmatter fields, missing the body, every
relationship, custom fields, `key_history`, archived state and ranks.

The original framing follows.

`project`, `assignee`, `reporter`, `milestone` and `sprint` export as
raw ULIDs (`01M13T6YWDXHB52P65P2BNAV8D`), so someone opening the CSV
in Excel gets opaque ids in every reference column.

**Why it was not simply fixed:**

- **No case requires it.** BLK-33 through BLK-37 cover escaping,
  scale, empty results, custom fields and URL reproducibility. None
  says anything about how a reference column is rendered.
- **P-4 does not obviously reach it.** It governs "UI **content** —
  labels, pickers, prose, error messages". A CSV is a data file, and
  the invariant already carves out URLs on the grounds that an
  addressing mechanism is not something LocTT displays.
- **It is core's export, not the web app's.** `DEFAULT_EXPORT_COLUMNS`
  is shared with `loctt export`, where the current columns are the
  documented contract. Changing it for a UI complaint changes CLI
  output too.

**The real tension:** an id round-trips and a name does not. Names are
neither unique nor immutable, so a CSV of names cannot be re-imported
or joined reliably — which is what a data export is *for*. But a CSV
nobody can read defeats the point just as thoroughly.

**Options, none chosen:**

1. Leave it. The export is a data interchange format; ids are correct.
2. Add resolved-name columns alongside (`project`, `project_name`).
   Round-trips *and* readable, at the cost of width.
3. Resolve in place, and accept the export is for reading, not
   re-importing.
4. Make it a UI-side choice — an "export for reading" toggle in the
   export menu.

Option 2 is the only one that does not lose something, but it is also
the only one that changes the column count, which BLK-36 pins.

---

# ═══════════════════════════════════════════════════════════════
# UI-RELEASE PASS (2026-09-06) — cases-before-code gate
# ═══════════════════════════════════════════════════════════════

Drafted for the single UI release (`ui-review-tracker.md` +
`ui-implementation-batches.md`). This is the **cases-before-code gate**
(`build-loop.md` step 1 / run-workflow step 0): a lane opens only once
its cases are accepted here into the flow docs. **Everything in this
section is PROPOSED — awaiting Ken.** Nothing has been applied to the
locked `docs/dev/ui-test-cases/*.md` files.

Two Ken rulings (2026-09-06) drive the reversals below and are treated as
decided; the case text is drafted to match them:
- **BUG-2 → fix the copy.** "Leave it" clears the field (that is what the
  server does); the dialog must say so. Reverses SET-17 (+ SET-19).
- **A task's relationships → inline kebab (⋯) + confirm** (not a dialog,
  not hover-remove). Reverses REL-12.
- **Config panels → view + Edit-dialog** (supersedes K1). Genuinely
  reverses/rewords the inline-edit assertions in **SET-16/17/19/28** and
  **SPR-8**; **PRU-44** is preserved (not reversed).

**Review-2 correction — SET-6 and SET-34 are NOT superseded.** Both are
reorder-only in the current flow doc (SET-6: drop indicator + `workflow.yaml`
order + cold reload + board columns + priority `value`; SET-34: a reorder
write failure). Neither asserts inline *value* editing, so neither
contradicts the edit model — superseding them would redden four green
tagged tests. The Edit-gated value-edit behaviour is therefore in **new
additive IDs SET-50 (value edits behind Edit) and SET-51 (a failed dialog
Save stays open)**, leaving SET-6/34 intact. That also makes decision #3
(reorder stays inline) a one-line `decisions.md §9` record rather than a
case rewrite. So the true reversals in this section are six:
**SET-16, SET-17, SET-19, SET-28, SPR-8, REL-12**.

Format follows the house shape: `### PREFIX-N · M· sev · P-principles`,
a bold one-line claim, then bullets. Milestone tags reuse the flow doc's
own (`M4` for settings/sprints/projects, `M2` for relationships/editor,
`M2`/`M4` as the original case carried). New IDs continue each file's
existing numbering; **no renumbering** (and no `-N#` placeholders — every
new ID is a real next-free number that the case-index parser can ingest).

---

## A. Reversals of approved cases (supersede)

### SET-50 · M4 · major · P1 P8 — NEW (additive; SET-6 stays intact)
**A status's value edits are gated behind an explicit Edit control →
dialog.** Statuses panel.

*(Review-2 correction: the current SET-6 is reorder-only — drop indicator,
`workflow.yaml` order, cold reload, board columns, priority `value`. It
asserts nothing about inline value editing and so contradicts nothing;
superseding it would redden four green tagged tests
(`flow-settings-workflow.spec.ts:146,183,1011,1099`,
`server.workflow-panels.test.ts:116`). So SET-6 is left untouched and the
Edit-gated value-edit behaviour lives in this new ID instead.)*

- **All edits to a status (label, category, default, delete) are
  view-by-default and happen behind an explicit Edit control → dialog**,
  never by an inline text input auto-saving on blur. (This is the K1
  supersession; the panel no longer auto-saves a field edit in place.)
- **Reorder is unaffected and stays inline** (Ken, open decision #3 — plan
  default keep): reorder is a position change, not a value edit, so SET-6's
  drag-reorder behaviour continues to hold exactly as written.

> Additive, not a reversal. `decisions.md §9 K1` made the panel
> inline-editable; Ken's 2026-09-06 edit-model ruling gates *value* edits
> behind Edit. Recording decision #3 (reorder stays inline) is a one-line
> `decisions.md §9` note, not a SET-6 rewrite.

### ✅ APPLIED (B2 step 0, 2026-09-06) · SET-16 · M4 · blocker · P3 P7 — SUPERSEDES the current SET-16
**A custom field's type is locked after creation, inside the Edit
dialog.** Field `story_points` exists as `number` with values on 40 tasks.

- Opening the field's **Edit dialog**, the type control is disabled (not
  merely validated on submit) and states why: existing task values were
  stored under this type.
- Label, `searchable`, and (where safe) `multi` remain editable in the
  same dialog, so the lock reads as targeted.
- No request that would change `type` is accepted server-side either —
  re-enabling the control in devtools and submitting is rejected.
- The dialog offers the honest alternative: create a new field and
  migrate, rather than pretending the change is possible.

> Supersedes: current SET-16 (describes the lock on an inline field row).
> Same guarantees; the surface moves from an inline form to the Edit
> dialog. Note the existing SET-16 caveat that `number → string` is
> allowed when no task data is incompatible still applies to the "where
> safe" wording.

### ✅ APPLIED (BUG-2, 2026-09-06) · SET-17 · M4 · major · P5 P7 — SUPERSEDES the current SET-17
**Deleting a status still referenced by tasks; the "leave" option clears
the field.** `in_review` is the status of 9 tasks.

- The delete dialog shows the reference count before the delete is
  confirmed.
- The confirm requires either a remap target (another status) **or the
  explicit choice to clear the status on those tasks** — no silent
  orphaning.
- Choosing remap moves all 9 tasks and reports the count moved.
- **Choosing to clear is allowed; the dialog states plainly that the
  status field will be cleared on those 9 tasks (they become
  status-less), and after confirming, the field is cleared on disk — no
  dangling reference is created and no drift marker or Diagnostics warning
  results.** The old copy promised a dangling ref + drift marker; that was
  never the behaviour (the server clears the field), so the copy is
  corrected to match. (BUG-2, decided 2026-09-06: fix the copy.)

> Supersedes: current SET-17 (bullet 4 promised "render with a drift
> marker and appear in Diagnostics as a failing check — and after
> confirming, they do"). That branch was never exercised by a test
> (`flow-settings-workflow.spec.ts` runs only the remap branch; SET-18
> reaches the dangling state by hand-editing YAML), and the server clears
> the field. Reworded to the real behaviour.

### ✅ APPLIED (BUG-2, 2026-09-06) · SET-19 · M4 · major · P3 — SUPERSEDES the current SET-19 (BUG-2 sibling)
**Deleting an enum value that tasks still hold; the "clear" option clears
it.** Custom enum value `sprint_1` is set on 12 tasks.

- The value row shows its own reference count.
- Deleting demands remap-or-**clear** the same way statuses do; the count
  is repeated in the confirm.
- **Choosing clear removes the value from those 12 tasks' frontmatter (the
  field is emptied), stated plainly in the dialog; after confirming, the
  value is gone from disk with no dangling key and no drift marker.**

> Supersedes: current SET-19 (bullet 3 said cleared tasks "render it as
> the raw key with a drift marker and are surfaced by Diagnostics").
> Same BUG-2 correction as SET-17.

### ✅ APPLIED (B2 step 0, 2026-09-06) · SET-28 · M4 · major · P1 P7 — SUPERSEDES the current SET-28
**`workflow.yaml` is rewritten by hand while a settings panel is open,
with edits gated behind a dialog.**

- The panel does not save a stale copy over the new file; it re-reads
  before writing or detects the change and says so.
- **If an Edit dialog was open (or a drag-reorder in flight) when the file
  changed underneath, the save is refused with a message naming the file
  and offering to reload the panel** — the dialog does not silently
  clobber the hand edit on Save.
- After reloading, the panel shows the hand-edited content, not a merged
  hybrid.

> Supersedes: current SET-28 (frames the in-flight edit as a drag-reorder
> only). Broadened to the Edit-dialog save path, which is now the primary
> value-edit surface.

### ✅ APPLIED (B2 step 0, 2026-09-06) · SET-51 · M4 · major · P4 — NEW (additive; SET-34 stays intact)
**A failed Edit-dialog Save stays open with an anchored error.** The
Edit-dialog Save (the new primary value-edit surface) hits a write error.

*(Review-2 correction: the current SET-34 is a drag-reorder write failure
(snap-back, file-named error, re-draggable) — it is not a value edit and
contradicts nothing. Superseding it would redden the tagged test that
guards the reorder-failure path. So SET-34 is left untouched and the
dialog-Save-failure behaviour lives in this new ID.)*

- The dialog **stays open with the value un-committed** — the field is not
  written and the panel is not left showing a value that did not persist.
- The error is shown **anchored in the dialog** (the `-edit-error`
  `Callout`), not as a bare toast, and names the next action.
- **Cancel still closes cleanly**, discarding the un-committed edit.

> Additive, not a reversal. SET-34's reorder-failure behaviour is unchanged
> (reorder stays inline per open decision #3); this ID covers the
> Edit-dialog Save-failure path SET-34 never described.

### ✅ APPLIED (B2 step 0, 2026-09-06) · SPR-8 · M4 · blocker · P1 — SUPERSEDES the current SPR-8
**Editing sprint metadata behind an Edit control persists to
`sprints.yaml`.** Sprint detail header.

- The detail header is **read-by-default**; an explicit Edit control opens
  the fields for editing (name/start/goal/state) — they no longer
  commit-on-blur/commit-on-change in place.
- Changing `name` and saving writes the new name; reloading shows it.
- The sprint's `id` is unchanged by any edit — tasks referencing it stay
  attached and their cards still appear.
- `loctt sprint list` shows the edited values.
- Changing `state` to `completed` re-collapses that column on the overview
  per SPR-2.

> Supersedes: current SPR-8 (commit-on-blur / commit-on-change). Same
> persistence guarantees; the trigger moves behind Edit per "inline is
> for tasks". (Config surfaces, including sprint config, are gated;
> sprint config is not a task field.)

### ✅ APPLIED (B3 step 0, 2026-09-07) · REL-12 · M2 · major · P5 P8 — SUPERSEDES the current REL-12 (K-4)
**Removing a link is a deliberate, aligned action: a kebab menu with a
confirm.**

- Each relationship row exposes a **persistent kebab (⋯) control in a
  fixed slot** — not a hover-only affordance — so the row's label/status
  pill align correctly and the control is reachable by mouse and by
  keyboard focus.
- Opening the kebab offers **Remove** (with room for future per-link
  actions).
- **Removal asks for a brief confirm** ("Remove this link?" Remove /
  Cancel) — a single deliberate step, not a typed confirmation. This
  guards against the accidental one-click removal the old hover-`✕`
  allowed.
- The confirm/kebab is the only remove path; there is no stray hover-`✕`.

> Supersedes: current REL-12 (bullets: "remove control on hover and on
> keyboard focus", "does not require a typed confirmation", "undoable from
> the confirmation message"). Ken's 2026-09-06 ruling: inline kebab +
> confirm. Undo-from-message is dropped in favour of a pre-action confirm;
> re-adding a link in one action still holds via "+ Add link". Note this
> reverses the no-confirm bullet deliberately — the confirm is the point.

### PRU-44 · (existing) — PRESERVE, re-home into the Projects Edit dialog
**The editable project prefix keeps its confirm-dialog shape when the
Projects panel becomes view + Edit-dialog.** (PRU-44 is already built —
editable prefix via a confirm dialog; slug is the readOnly field.)

- The Projects Edit dialog carries the prefix control; editing the prefix
  **does not save on blur** — it goes through the existing confirm dialog
  that states the blast radius in numbers (keys to rewrite).
- The slug remains the read-only field.
- **PRU-44/45 are already tagged and green** — `server.test.ts:779`
  (`@verifies PRU-44, PRU-45, PRU-46`) and `ProjectsPanel.test.tsx:10`
  (`@verifies PRU-44, PRU-45`); `cases:coverage --require PRU-44,PRU-45`
  passes. The real risk is the opposite of the earlier "no tags exist"
  claim (false, corrected review-2): `ProjectsPanel.test.tsx` is a **green,
  tagged** test the Projects restructure will *edit*. Per CLAUDE.md's
  "editing a green test" rule, that edit must be named in the B2 Projects
  commit message.

> Not a reversal — a preservation note. No new capability; the pinned
> PRU-44/45 behaviour must survive the Projects-panel restructure. The
> tests that guard it already exist and are green; the restructure edits
> `ProjectsPanel.test.tsx`, so name it in the commit.

---

## B. New cases for un-cased items

### `flow-tasks.md` / editor (K-7, K-7b, ED-1/2/3) — new IDs — ✅ APPLIED (B3 step 0, 2026-09-07): TSK-59…67
*(the body/editor cases live in `flow-tasks.md`, which ends at TSK-56)*

- **TSK-59 · M2 · major · P3 P8** — **The heading control offers every
  level, not just H2.** The description/comment toolbar exposes a level
  picker (Paragraph, H1…H6). Selecting a level applies it
  (`setHeading({level})` / `setParagraph()`); the control shows the
  current block's level; each level round-trips through save+reload
  (`#`×level serialised, `#{1,6}` parsed). (K-7, the reported P1 — only
  H2 is reachable today.)
- **TSK-60 · M2 · major · P8** — **Applying a block type to a whole-
  paragraph selection leaves the caret in the transformed block**, so the
  control reflects the new state immediately and repeated toggles do not
  accumulate trailing empty blocks. (K-7 caret quirk.)
- **TSK-61 · M2 · major · P3** — **An ordered-list button exists and
  round-trips.** The toolbar can create an ordered list (`1.` items);
  `fromMarkdown`/`toMarkdown` already support it. (K-7b.)
- **TSK-62 · M2 · minor · P8** — **The rich editor shows a placeholder
  when empty**, matching the raw CodeMirror editor's "Describe this
  task…", so an empty rich editor does not read as broken/blank. (K-7b.)
- **TSK-63 · M2 · major · P1 P8** — **Pasting markdown into the rich
  editor parses it**, not inserts it as literal text. Pasting
  `# Heading\n\n- item\n- item` yields a heading + list, not three literal
  paragraphs. (K-7b — markdown paste is the common case for this
  audience.)
- **TSK-64 · M2 · minor · P8** — **The description toolbar is collapsed in
  view mode** and appears only when the field is focused/edited; no format
  button renders in an active state while merely viewing. (UX-9.)
- **TSK-65 · M2 · minor · P8** — *(scope-call, ED-1)* Strikethrough /
  superscript / subscript / math / mention have toolbar buttons in rich
  mode, or the flow doc scopes them out. These marks/nodes round-trip
  already; only the toolbar affordance is missing.
- **TSK-66 · M2 · minor · P7** — *(ED-2)* A GFM pipe-table in the body is
  either parsed to a table or forces raw mode via lossy-content detection
  — never shown as literal paragraph text.
- **TSK-67 · M2 · minor · P8** — *(ED-3, test-hygiene)* The description
  and comment editors carry **distinct** test-ids so the DOM is
  unambiguous (both are `rich-editor` today).

### `flow-relationships.md` (UX-8) — new ID — ✅ APPLIED (B3 step 0, 2026-09-07): REL-51

*(REL ends at REL-50 in the flow doc; continue at 51. This is the case
the batch plan flagged as "UX-8 has no proposed case yet".)*

- **REL-51 · M2 · major · P8** — **Each relationship group header uses the
  side's own directional label — the label of the edges shown under it, not
  its inverse.** On an epic, the group of its children is headed by the
  **child-side** label ("Child" / "Children"), and on a child the group
  holding its parent is headed by the **parent-side** label ("Parent") —
  the header names what the listed tasks ARE to the current task. This must
  hold for a structural pair (`parent`/`child`, distinct `label` /
  `inverse_label` in `workflow.yaml`) exactly as it already does for a
  non-structural directional pair like `blocks` ("Is blocked by" reads
  correctly today). The bug being fixed: the structural group picks the
  label from the wrong side, so children show under "Parent" and the parent
  under "Child" (UX-8, ux §4.2). A connective form ("Blocked by…",
  "Parent of…") is permitted but not required; the required property is that
  the side is correct and consistent across all relationship types.

### `flow-comments-activity.md` (UX-10) — new ID — ✅ APPLIED (B3 step 0, 2026-09-07): CMT-39

*(CMT ends at CMT-38 in the flow-comments-activity doc; continue at 39.)*

- **CMT-39 · M2 · minor · P8** — **A relationship activity entry reads with
  the relationship's human label and the correct article, never the raw
  config key.** Adding an `is_blocked_by` link records an entry that reads
  "added an Is blocked by link" (label from `workflow.yaml`, article agreeing
  with the label's first sound), not "added a is_blocked_by link" (raw key +
  wrong article). Removal reads symmetrically. The label is resolved through
  the same workflow lookup the relationship panel uses, so a renamed label
  updates the activity text too (UX-10, ux §4.5).

### `flow-saved-views.md` (K-8, u3) — new IDs — ✅ APPLIED (B2 step 0, 2026-09-06): VUE-40/41

*(VUE ends at VUE-39 in the flow doc; continue at 40)*

- **VUE-40 · M4 · major · P2 P10** — **A saved view can be created from
  the UI.** The sidebar "+ New filter" (disabled today,
  `Sidebar.tsx:715`) opens a create-view flow (name + query, reusing the
  advanced query editor); the created view is written to `queries.yaml`,
  appears in the sidebar, and is runnable via `loctt views` (P10 parity).
  The write cannot poison the file (cf. VUE-37).
- **VUE-41 · M4 · major · P1 P2** — **A saved view can be renamed and its
  query edited from the UI**, via an Edit dialog on the Saved views panel
  (`PUT /api/views/:id` / core `editView`). Reloading shows the new
  name/query; `loctt views` agrees.

### `flow-settings.md` — workflow create + custom-field CRUD (new IDs) — ✅ APPLIED (B2 step 0, 2026-09-06): SET-46/47/48/49

- **SET-46 · M4 · major · P3 P4** — **A status can be created from the
  panel.** The Create dialog takes key + label + category + default; the
  key is validated for uniqueness and the "key is permanent" copy is
  shown; on Save the new status is written to `workflow.yaml` and renders
  in file order. Creating a duplicate key is rejected before `PUT` with a
  message naming the collision (cf. SET-44).
- **SET-47 · M4 · major · P3 P4** — **A priority / task-type can be
  created** the same way (key + label; priority gets a computed `value`).
- **SET-48 · M4 · major · P3 P4** — **A relationship type can be created**
  — key + label + symmetric/inverse + inverse_label + graph + ranked
  (`RelationshipDef`) — written to `workflow.yaml` and usable when linking.
- **SET-49 · M4 · major · P3 P4** — **Custom fields have full CRUD in the
  UI** (create/edit/delete), not YAML-only. Create takes key + label +
  type + multi + searchable + enum values with weights; `type`/`multi`
  lock after create (SET-16 shape); delete goes through remap-or-clear
  (SET-19 shape).

### `flow-projects-users.md` (K-11, p1) — new IDs — ✅ APPLIED (B2 step 0, 2026-09-06): PRU-47/48

- **PRU-47 · M4 · major · P1 P8** — **An existing user's name, email and
  timezone can be edited from the UI**, via a per-row Edit → dialog
  (`PUT /api/users/:id`). Today email is shown read-only and settable only
  in the create form, so a blank email cannot be fixed in-app (K-11). The
  avatar is set through a proper control, not a raw `<input type="file">`.
  Reloading shows the edited values; `loctt user` agrees (P10).
- **PRU-48 · M4 · major · P1 P8** — **A project can be set as the default
  from the Projects panel.** Today only a personal default exists and core
  `setDefaultProject` is called only internally — this needs a new
  endpoint. Setting default writes to config, the marker moves, and the
  new default is where new tasks land / the default filter opens.

### `flow-sprints.md` (K-14, u2 create/delete/archive) — new IDs — ✅ APPLIED (B2 step 0, 2026-09-06): SPR-39/40

*(Review-2 correction: SPR-27 and SPR-28 already exist in the index — SPR
max is 38 — so the proposed IDs collided. Renumbered to the next free
SPR-39/40.)*

- **SPR-39 · M4 · major · P8** — **The sprints overview surfaces
  at-a-glance data per card.** Each sprint card shows progress (done /
  total), the date range, days-remaining (or overdue), and a mini-burndown
  or equivalent; the whole card is clickable → detail. (K-14 — the data
  exists on the detail page only today.)
- **SPR-40 · M4 · major · P10** — **Sprint create / delete / archive /
  unarchive are reachable from the Settings panel**, reaching parity with
  the CLI (`sprint archive`, `--all`). Archive needs `archived` on
  `handleUpdateSprint` (server) + a "show archived" toggle; the CLI and
  MCP already have the concept, so this is web reaching parity (P10).

### `flow-app-shell.md` (K-10 sidebar editor, UX-12 header search) — new IDs — ✅ APPLIED (B2 step 0, 2026-09-06): SHL-45/46 (SHL-45 shape DECIDED 2026-09-06: per-user, hideable+reorderable, web+CLI+MCP)

*(Review-2 correction: SHL-N1/SHL-N2 were unindexable — the case-index
parser (`tools/case-index/parse.ts:67`) and the coverage scanner
(`tools/coverage/scan.ts:27`) require digits after the dash
(`[A-Z][A-Z0-9]*-C?\d+`), so a `-N#` heading is silently skipped and
`cases:coverage --require SHL-N1` fails as unknown. Renumbered to the next
free SHL-45/46. SHL max is 44.)*

- **SHL-45 · M4 · major · P2 P8** — **The sidebar's top-level groups can
  be shown/hidden and reordered.** A settings editor lets the user hide or
  reorder the built-in groups (Projects, Milestones, Sprints, Labels,
  Recently viewed) and built-in filters; the choice is a **per-user
  setting** (mirrors `sidebar_pins`), persists across reload, and — per
  the which-layer rule — is exposed on CLI + MCP with both reference docs
  updated, and degrades on an unknown/duplicate group id per the
  corruption-handling guide. Note this needs a carve-out against SHL-9
  bullet 4 / SHL-5 / SHL-10 ("a group whose config file has no entries
  renders an explicit empty affordance rather than vanishing"): "hidden by
  the user" is not "vanished". **(K-10 — Ken open decision #5 must settle
  the shape before this is final: per-user vs tracker-wide; whether
  built-in filters and "Recently viewed" may be hidden. PM proposes
  per-user + built-ins hideable; escalate only if that forks.)**
- **SHL-46 · M1 · blocker · P2 P8** — **The global header search works.**
  Typing in the header "Search tasks…" box and pressing Enter (or as-you-
  type) queries `/api/search` and shows results / navigates; a real
  network request fires. The box is not a dead input. (UX-12 — the input
  has no handler today.) Once wired, `/` focuses it (A11Y-2 becomes
  reachable).

### Degradation visible in working surfaces (UX-11, UX-7, UX-13) — new IDs — ✅ APPLIED (B3 step 0, 2026-09-07): DEG-29/30/31 (+ DEG-7 blind-spot recorded in decisions.md §8 A157 / known-gaps.md)

These belong in `flow-degradation.md` (and cross-ref detail/list/labels).
They are the signature-feature gap: corruption is loud in doctor/Timeline
and silent where users work.

*(Review-2 corrections: (1) the `-N#` IDs were unindexable — renumbered to
the next free DEG-29..31 (DEG max is 28). (2) The proposed DEG-N2
("unrecognised preserved fields are visible") **duplicated the existing
DEG-7** (`flow-degradation.md:81-85`: an unrecognised key "is shown in a
'Not recognised' group, read-only, with a remove control"), so it is
dropped as a standalone case; the UX-7 unrecognised-field-in-detail
behaviour folds into a client-facing bullet on DEG-29 instead — see the
DEG-7 blind-spot note below.)*

> **DEG-7 coverage blind spot (record in `decisions.md §8` +
> `known-gaps.md`).** `cases:coverage` reports DEG-7 **covered**, but its
> only `@verifies` tag is a *core* round-trip test
> (`packages/core/src/task/frontmatter.test.ts:171`). No **client** file
> renders any "Not recognised" unrecognised-field group (a grep of
> `apps/web/src/client` finds only `cells.tsx:107`'s sr-only
> "(unrecognised)"). So DEG-7's green tag must **not** be mistaken for the
> surface existing: the UX-7 lane must tag DEG-7 from a *client* test that
> renders the group on the task-detail page. This is a coverage-tool blind
> spot — a core `@verifies` can satisfy a UI case — worth its own
> `decisions.md §8` + `known-gaps.md` note.

- **DEG-29 · M2 · major · P7** — **A corrupt field renders with an inline
  warning on the task-detail page, not as an empty "—".** A task with
  `due_date: 42` shows `Due ⚠ corrupt: 42` (with a tooltip and a
  clear/repair action), distinguishable from a legitimately empty due
  date; saving an unrelated field does not silently drop the bad value.
  **Also: an unrecognised preserved field (e.g. `jira_id: ABC-123`) is
  visible on the task-detail page in DEG-7's "Not recognised" group,
  rendered by a client component (closing the DEG-7 client blind spot
  above), so the person editing the task can see it exists.** (UX-7.)
- **DEG-30 · M4 · major · P7** — **An unreadable label is shown and
  repairable in Settings → Labels, not omitted.** A label with a
  non-string name (`l_broken`, `name: 999`) renders as a disabled/error
  row ("⚠ l_broken — couldn't be read (name must be text)") with a
  Repair or Delete action, rather than vanishing from the list with no
  notice. (UX-13.)
- **DEG-31 · M1 · major · P7 P8** — **A global data-integrity indicator
  points users to Diagnostics.** When doctor/Diagnostics would report
  warnings, a lightweight badge (header or sidebar) shows the count and
  links to Diagnostics, so corruption is discoverable without three
  clicks behind a manual Run; the corrupt task also carries a marker in
  the List view. (UX-11 — the cross-cutting fix.) **Sizing note:** a badge
  that polls `/api/doctor` runs a full `runDoctor(root)` scan per page load
  (`server.ts:1288` `handleDoctor`); this case needs a cheap data source
  (a cached/summary warning-count endpoint or a count derived from what the
  list already returns) — that is server work the lane must budget for.

### Board / list / create polish (UX-5, UX-6, UX-14) — new IDs — ✅ APPLIED (B4 step 0, 2026-09-09): BRD-50/51, NEW-42

*(Review-2 corrections: the `-N#` IDs were unindexable — renumbered to the
next free BRD-50/51 (BRD max is 49) and NEW-42 (NEW max is 41). NEW-42 is
narrowed — see its note.)*

- **BRD-50 · M3 · major · P3 P8** — **Board cards surface "blocked" and
  "epic".** A blocked card shows a blocked marker/pill; an epic card shows
  a child-count badge (e.g. "◇ 3"); a subtask shows a "belongs to epic"
  hint. (UX-5.)
- **BRD-51 · M3 · minor · P8** — **The board header status pills read as
  visibility toggles.** Each pill has a tooltip/label ("Hide/show column")
  or an explicit eye/checkbox affordance, so a dimmed pill next to a
  missing column is not misread as "no tasks". **Extends BRD-3** (which
  pins that the pills *are* toggles); this adds the discoverability
  affordance. (UX-6.)
- **NEW-42 · M3 · major · P4 P3** — **The New-task modal shows the empty-
  title block as a visible cue and pre-fills configured defaults.**
  *(Review-2 correction: UX-14's premise is half-false — Create is
  **already disabled** on an empty title (`CreateTaskModal.tsx:181,265,665`)
  and **NEW-2 (tagged, passing) already pins** submit-enabled-only-when-
  title-non-empty. So this case does NOT re-assert the disable; it would
  fail step 1 as a duplicate of NEW-2 if it did.)* The residual, narrowed:
  the disabled Create is a **visible** cue (`disabled:opacity-60`, not a
  live-looking button), and Status and Type **pre-fill** from the
  `workflow.yaml` defaults (`backlog` etc.) rather than showing "—".
  (UX-14.)

### List / sidebar polish (UX-1, UX-2, UX-3, UX-4) — new IDs — ✅ APPLIED (B4 step 0, 2026-09-09): LST-53/54/55/56
*(LST ends at LST-52 in the flow doc; continue at 53)*

- **LST-53 · M1 · major · P2 P4** — **A free-query (`q=`) filter shows a
  chip and a Clear-all.** Landing on a `q=` URL (as every sidebar saved
  filter does) renders a removable chip (the saved-filter name or
  "Filtered query ✕") and/or highlights Advanced, and exposes Clear all —
  so a short list is explained and reversible in-page, matching how facet
  chips already work. (UX-1.)
- **LST-54 · M1 · minor · P8** — **The first click on a priority (and due)
  sort header sorts the most-useful direction.** Clicking Priority sorts
  Critical-first on the first click (not Low-first); the sort-arrow
  direction is legible. (UX-2 — decide deliberately per the workflow's
  documented priority order.)
- **LST-55 · M1 · minor · P2** — **Sidebar links do not silently carry the
  ambient sort** (or, if they deliberately do, that is documented and
  consistent). A saved "blocked" filter does not open Low-first because
  the user happened to be sorting ascending. (UX-3.)
- **LST-56 · M1 · minor · P8** — **Facet dropdown items show a multi-select
  affordance before the first click** — empty checkboxes (using the B1
  Checkbox) or a hover state — so multi-select is discoverable. (UX-4.)

---

## C. Existing cases — corrected scope (review-2: NOT "unsatisfied")

*(Review-2 correction: the earlier "tag-only, currently-unsatisfied" claim
was false for **both** named cases. CMT-18 and MSL-1 are already **tagged
and passing**, so K-5 and K-9 are re-scoped to what is actually missing.)*

- **CMT-18** (`flow-comments-activity.md`) is **tagged and green**
  (`tests/ui/flow-comments.spec.ts:1308` — the test's own comment notes the
  sections are "stacked (not tabs)"). It is **not** unsatisfied. So K-5's
  real scope is the **Comments/Activity tab split** — a shape CMT-18
  permits either way — which means K-5 **edits the green CMT-18 test**
  rather than tagging a fresh one. Per CLAUDE.md's "editing a green test"
  rule, name that edit in the K-5 (B3 Activity) commit. No new case.
- **MSL-1** (`flow-milestones-labels.md`) is **tagged and green**
  (`flow-milestones.spec.ts:78` plus 9 unit tags): it asserts the `4 / 8`
  readout + `data-fill`, and **the progress bar K-9 wants already renders**
  (`MilestonesView.tsx` → `ProgressReadout`). So K-9's real scope is
  **full-card click + countdown/overdue + status breakdown** — not the
  progress bar, which exists. Those three need the new MSL IDs **now** (not
  "when the lane opens" — step 0 forbids deferring the case). Drafted as
  MSL-39/40/41 below.
- **A11Y-2** (`/` focuses the search input) becomes reachable once SHL-46
  wires the header search — tag it when UX-12 lands.

### K-9 milestones-overview residual — new IDs — ✅ APPLIED (B4 step 0, 2026-09-09): MSL-39/40/41
*(MSL max is 38; continue at 39. The progress bar is MSL-1, already green;
these are the residual K-9 items.)*

- **MSL-39 · M4 · major · P8** — **A milestone card is fully clickable →
  detail.** The whole card (not only a sub-target) opens the milestone.
  (K-9(a).)
- **MSL-40 · M4 · minor · P8** — **Each milestone card shows target date +
  countdown/overdue.** A dated milestone shows days-remaining or an overdue
  marker; an undated one degrades cleanly. (K-9(b).)
- **MSL-41 · M4 · minor · P8** — **Each milestone card shows a task-count
  breakdown by status**, plus the K28 `unreadable` notice where present, so
  the overview reads at a glance rather than "very plain". (K-9(b).)

### UX-15 milestones-copy residual — new ID — ✅ APPLIED (B4 step 0, 2026-09-09): MSL-42
*(Review-2 correction: UX-15's premise is **false at HEAD** — the sidebar
**does** link the Milestones view (`Sidebar.tsx:749-751`
`sidebar-milestones-link`; routed at `router/index.tsx:183`). So the
"points at a view the nav never links to" framing is wrong; the residual
is copy/discoverability only.)*

- **MSL-42 · M4 · minor · P4** — **Settings → Milestones copy points where
  milestone progress actually renders.** The copy names the reachable
  Milestones view (which the sidebar already links), or a progress display
  is added to the filtered-list header — not a "view" the user cannot find.
  (UX-15, narrowed to copy after the nav-link premise was corrected.)

---

## D. Still-open decisions this pass could NOT resolve (Ken)

These are carried in `ui-review-tracker.md` § "Still-open decisions" and
`ui-plan-revision-summary.md`. They gate parts of the build and are not an
agent's to make:

These are carried in `ui-review-tracker.md`. Status as of 2026-09-09:

1. All newly-ingested UX/editor findings in this release? — **RESOLVED
   yes** ("ingest them all").
2. Undo on board/timeline drop + bulk Set-field — **RESOLVED: OUT** (K32).
   Not built; bulk-archive undo stays.
3. Config-row **reorder** — **RESOLVED: stays inline** (K31). SET-6/21/28/34
   kept intact.
4. "Edit → dialog" modal vs Edit-gated inline form — **RESOLVED** (A143):
   an Edit-gated inline form satisfies it.
5. **K-10 sidebar-groups shape** — **RESOLVED/locked** (per-user, hideable
   built-ins, CLI/MCP parity); built in B2.
6. Design-system open decisions 1–6 — folded into B1 (done).
7. Doctor/journal **P-11** — out of the UI-batch scope; unchanged.

---

## C. New cases for K33 — description read-then-edit (Ken, 2026-09-09) — ✅ APPLIED (B4 step 0, 2026-09-09): TSK-68/69/70/71

*(`flow-tasks.md` ends at TSK-67; continue at 68. K33 is the Jira-style
read-then-edit model for the task description — a scope addition, not a
fix. It supersedes TSK-64's toolbar-collapse.)*

- **TSK-68 · M2 · major · P1 P8** — **The description renders read-only by
  default, not as a live editor.** On opening a task with a body, the
  description shows as formatted output (headings/lists/links/images
  rendered) with **no toolbar and no editable field** — the same read-only
  renderer comments use. An empty body shows the placeholder in the same
  read state. Supersedes TSK-64 (toolbar no longer merely collapses — the
  whole surface is read-only until entered).
- **TSK-69 · M2 · major · P1 P8** — **Clicking anywhere on the rendered
  description text enters edit mode.** A click on the body text (not on a
  link or image — see TSK-70) swaps the rendered view for the editor
  (rich editor + toolbar, the existing `BodyEditor`), ready to type. The
  raw/rich toggle is available here, inside edit mode, and only here.
- **TSK-70 · M2 · major · P4 P8** — **In the rendered view, a link opens
  and an image opens — neither enters edit mode.** Clicking a link in the
  rendered description opens its URL in a new tab
  (`target=_blank rel=noreferrer noopener`, unsafe schemes refused as in
  comments); clicking an image opens it in a lightbox. Neither switches to
  edit mode. (In edit mode these are ordinary editable content.)
- **TSK-71 · M2 · minor · P8** — **Leaving edit mode returns to the
  rendered view; the body is saved, not lost.** Clicking away (blur)
  flushes the existing idle autosave (TSK-15/K2) and returns to the
  rendered view showing the saved content; pressing Escape cancels the
  edit and returns to the rendered view showing the last-saved content.
  Nothing is silently lost, and a failed save keeps the editor open in its
  unsaved state (TSK-48), not dropped back to a stale render.
