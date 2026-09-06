# Flow: data degradation (corruption handling)

Cross-cutting behaviour for a tracker whose files have been hand-edited,
half-migrated, or partly corrupted. Corruption is not a single view's
concern — it reaches core, every config loader, the wire, and every
surface — so it earns its own flow rather than being scattered across
the domain docs. Where a behaviour is already sliced by an existing case
(TSK, PRU, REL, VUE, TML, CMT, GIT, SPR), the DEG case is the
cross-cutting hub: its bullets pin only what the flow case does not, and
cite the flow case for the rest.

The CLI/MCP halves of these behaviours live in the surface tree, at
[../surface-test-cases/flow-degradation.md](../surface-test-cases/flow-degradation.md)
(prefix `DEG-C`), per the `ui-test-cases/` scope rule (web UI only; CLI
and MCP appear only where they collide with the UI).

**Two degradation kinds run through every case.** *Field-local* (a
wrong-typed or unrecognised key) is lifted into a health finding and the
object still loads. *Object-fatal* (a bad `id`/`key`, unparseable YAML,
an unreadable file) means the object cannot be addressed and is reported
unreadable — never silently skipped, never read as "not found". The
distinction is the spine of this flow.

**Deliberately excluded.** Identity/directory mismatch (a task whose
on-disk directory disagrees with its stored `id`) is a framework probe,
not a decided behaviour — it is named here so the next author does not
re-derive it as a case.

**A note on principles.** The proposal drafted some of these cases with
a "P11" tag (never publish/overwrite content nobody read). There is no
P11 — the principle set is P1–P10 ([README](README.md#first-principles),
which the index parser enforces). Those cases are tagged **P1** (the
files are the truth; never silently lose or overwrite data) and, where
the point is the designed handling of a broken state, **P6**. The
"P-11" seen in some test comments is informal shorthand for the same
data-integrity concern, not an eleventh principle.

## A. The task record (field-local and object-fatal)

### DEG-1 · M4 · blocker · P1 P5
**An object-fatal task is reported unreadable and attributed, and blocks nothing else.** Hand-edit one task's `task.md` to remove its `id` (or to make the YAML unparseable), leaving the rest of the tracker intact.

- The task is reported unreadable with the file path and the parse reason; it is never read as "task not found".
- Every other task still loads; the list and board render the readable ones and name the unreadable one in an affordance rather than crashing the view.
- Object-fatal is exactly a bad `id`/`key` or unparseable YAML; a broken `title`/`created_at`/`updated_at` is not fatal and degrades instead (DEG-2).
- Known coverage gap: no wire test seeds an object-fatal *task* and asserts the API attributes it "unreadable" rather than "not found" — see the note at the foot of this doc. The CLI/MCP halves are [DEG-C1](../surface-test-cases/flow-degradation.md).

### DEG-2 · M4 · blocker · P5
**A wrong-typed known field degrades to a health finding; the task still loads.** Hand-edit a task to `due_date: 42` (a number where a date is required).

- The task opens; the corrupt field is lifted off the frontmatter into a health finding that carries its stored value; the rest of the frontmatter is intact.
- Only `id`/`key` are object-fatal — a broken `title`, `created_at`, or `updated_at` degrades the same way (K26), including a YAML-null (`~`) in a required field.

### DEG-3 · M4 · blocker · P7
**Editing one field preserves an untouched corrupt sibling byte-for-byte.** On a task whose `due_date` is corrupt, set `status`.

- The corrupt `due_date` value survives on disk, value-preserved (K27); only the edited field changes.
- The same holds through the web `POST …/set`, `loctt set`, and MCP `set_field` — the repair/preserve path through the surfaces is a known gap ([DEG-C4](../surface-test-cases/flow-degradation.md)).

### DEG-4 · M4 · major · P5
**A valid write over a corrupt field repairs it; an unset removes it.** Write a valid value to the corrupt field, or unset it.

- A valid write clears the finding — even a strict re-read then succeeds.
- Unset drops the field from health and from disk; an unrecognised key is removable the same way.
- Cannot be satisfied yet: the repair is *not* recorded in history as repairing corruption. The decided provenance (`before` = the raw corrupt value, `meta.was_corrupt`) is unbuilt — `buildSetFieldHistory` reads only the frontmatter, where the lifted field is already absent, so `before` is null for a repaired field. See [known-gaps.md](../known-gaps.md). Do not author a test for provenance until it is built.

### DEG-5 · M4 · blocker · P1 P7
**The write guard never introduces corruption and never silently drops it.** Attempt a write that would make a field newly corrupt; separately, attempt a merge-style write that omits an existing corrupt field.

- A write that would make a field newly corrupt is refused (rule 1). This binds a whole-record author too: `createTask` with a bad `due_date` is refused as a validation failure, never written as a corrupt task.
- A merge-style write (`fields ?? {}`) may not drop an untouched corrupt field it does not name (rule 2); only a whole-record author (`touched = '*'`) may author the record freely.

### DEG-6 · M4 · major · P7
**The operation rule: a read-to-compute refuses over a corrupt field; a read-for-idempotency repairs.** Attempt `link`/`unlink` over a task whose `relationships` array is wrong-typed; separately, archive a task whose `archived` field is wrong-typed.

- `link`/`unlink` must read the `relationships` array to compute the new edge, so they refuse with a corrupt-field error naming the field.
- Archive reads `archived` only for an idempotency check, so it never refuses and never persists the corrupt value — it proceeds and repairs.
- `setField` of a custom field over a wrong-typed `fields` map follows the read-to-compute branch (refuses), not the idempotency branch.
- The refusal reaches the web/CLI/MCP surfaces as a clear error, not a 500 ([DEG-C4](../surface-test-cases/flow-degradation.md)).

### DEG-7 · M4 · major · P5
**An unrecognised frontmatter key is preserved and surfaced, not dropped.** Hand-add `jira_id: ABC-1` to a task.

- It round-trips byte-for-byte (passthrough via health) and is shown in a "Not recognised" group, read-only, with a remove control.
- Preservation across a write is the P1/P7 data-loss guard; only the "Not recognised" rendering is polish, which is why this is major, not minor.

### DEG-8 · M1 · major · P5
**An untitled task shows its key, never a blank.** Load a task whose title is absent or corrupt.

- The list, board, timeline, and detail render the key where the title would go — never blank, never "undefined".
- The CLI `show`/`list` and MCP `get_task`/`list_tasks` do the same ([DEG-C2](../surface-test-cases/flow-degradation.md)).

## B. Config objects (per-entry and object-fatal)

### DEG-9 · M4 · blocker · P5
**A corrupt config entry degrades to a broken marker; the rest of the file loads.** Hand-edit one project/label/milestone/sprint/holiday entry so it is wrong-typed, missing a required key, or carrying an unknown per-entry key.

- The good entries load; the bad one becomes a broken marker (index + stored text + the validator's message); `broken` is omitted entirely when every entry parsed.
- Applies to projects, labels, milestones, sprints, calendar holidays, list-view chip arrays, and each workflow sub-list (statuses, priorities, types, relationships, custom fields).
- An unknown per-entry key degrades the same way in every loader — never refused in one file and silently accepted in another.
- A sub-field that is individually salvageable degrades finer than the whole entry: a label whose hex colour is malformed stays a live label with its colour dropped to a default, rather than becoming a broken entry (MSL-22). An 8-digit hex is dropped rather than rejecting the file.

### DEG-10 · M4 · blocker · P5
**A structurally-broken config file refuses, attributed, without taking down unrelated surfaces.** Give a config file a non-array root, an unknown top-level key, or a duplicate id/prefix.

- It throws an error naming the file and the offending rule — not a bare Zod dump, not a generic 500.
- A duplicate id/prefix stays object-fatal (the reference is ambiguous). Surfaces that do not read that file keep working.

### DEG-11 · M4 · major · P5
**"Broken" is distinct from "empty" and from "failed to load" on the surfaces.** Load a config file whose only entry is corrupt.

- The surface shows the broken entry — distinct from a genuinely-empty list and from a fetch failure; it is not reported as "none".
- `GET /api/{projects,labels,milestones,sprints}` carries `broken` on the wire; the sprints view renders it as a notice naming the broken rule.
- Known coverage gap: the labels/milestones/projects settings panels do not yet render a per-entry `broken` marker (index + text + validator message). The CLI/MCP `list` halves are also a gap ([DEG-C3](../surface-test-cases/flow-degradation.md)).

### DEG-12 · M4 · blocker · P1 P5
**state.yaml is object-fatal by necessity, with an attributed error.** Hand-edit `state.yaml` to a wrong-typed key counter.

- It refuses with a `config_invalid` error naming the file and the counter — it does not degrade, because dropping a counter risks re-issuing a live task's key (unrecoverable).

### DEG-13 · M4 · major · P5
**A user profile degrades every field but `id`.** Hand-corrupt `profile.yaml` with an unknown timezone and an unknown key.

- The profile loads with the bad field set aside (only `id` is fatal); a nameless user shows their id everywhere a name would appear.
- The unrecognised key is preserved with its value, not dropped.

### DEG-28 · M4 · major · P5
**Settings drop a bad known key to default yet keep unknown passthrough keys; a load never overwrites an unreadable file.** Hand-corrupt `settings.yaml` with `theme: 42` and an unknown key.

- A wrong-typed known setting falls back to its default for reading; the rest of the settings are kept.
- Unknown settings keys survive untouched (the passthrough is load-bearing).
- Cannot be satisfied yet: whether a corrupt known setting's stored value survives a load→save round-trip (rather than being re-emitted as the default) is not pinned by any test, and an unparseable `settings.yaml` has no read/write test. The risk is a save that re-emits defaults over a file the load could not read — the same data-loss shape as DEG-24. Flag it here; do not author until the round-trip behaviour is decided.

## C. References and cross-object

### DEG-14 · M4 · major · P4 P7
**A dangling reference degrades to a marked value — never blank, never a full ULID.** Point a task's assignee/reporter/label/milestone at a deleted entity.

- The cell shows a truncated-ULID + "(deleted …)" marker, never blank, never the raw full ULID; the row still renders and other columns are unaffected.
- A dangling element *inside* an array field is reported at the element (`labels[2]`), leaving the healthy elements in place — the co-existence rule (A137.1) is why the row still renders.
- Filtering offers only live entities; the dangling id is not offered.

### DEG-15 · M4 · major · P5
**A relationship edge distinguishes healthy / corrupt-but-present / corrupt-unreadable / genuinely-absent.** Link a task to a target in each of the four states.

- Healthy links normally; a corrupt-but-present target links and is marked ⚠ corrupt (it opens, is repairable); an unreadable (object-fatal) target is marked corrupt, not "deleted"; a genuinely-absent target is the "broken link — no task with id" state.
- Cannot be satisfied yet: removing a dangling/corrupt edge from the row routes through `unlinkTask` so the inverse is removed too, and over an object-fatal `relationships` array the removal refuses (A135.4). No test pins the edge-repair path.
- The CLI/MCP relationship display mirrors the distinction ([DEG-C5](../surface-test-cases/flow-degradation.md)).

### DEG-16 · M4 · major · P5
**An invalid enum / workflow-drifted value keeps its raw key and is marked.** Put a task on a status/priority key that is no longer in `workflow.yaml`.

- The cell shows the raw key with a drift marker (never blank); the picker offers only valid options; editing clears the marker.
- A drifted relationship *type* — a link whose type workflow.yaml no longer declares — is likewise surfaced under its raw key, its links still render, and a removed kind is not offered in the picker while its links stand; a duplicated edge is listed once with a count of copies.
- The CLI marks the value and the MCP surfaces a `Known: …` hint — the same requirement on three surfaces ([DEG-C6](../surface-test-cases/flow-degradation.md)).

## D. Surface-specific degradation

### DEG-17 · M4 · major · P5
**A corrupt-dated task is distinguished from an undated one on the timeline.** Give a task a `due_date`/`start_date` that is corrupt (lifted to health, absent from frontmatter).

- It routes to the unscheduled affordance MARKED as corrupt (⚠ + raw value), distinct from a deliberately-undated task, is still counted under every grouping, and is never dropped.
- The corrupt classification is distinct from the `invalid` classification (an unparseable date string kept verbatim, TML-48) and both differ from undated — the corrupt branch is preferred over the value branches, and health on an unrelated field never fakes a date problem.

### DEG-18 · M4 · major · P5 P6
**A malformed history/comment row is reported incomplete and kept in place; object-fatal blocks.** Hand-break one row of a task's `history.jsonl`, then separately make the whole file unparseable.

- The activity feed reports "N entries could not be read" (an incomplete notice with a count), keeps the readable ones, and does not silently show a shorter history — nor does it show the empty message when every row is malformed.
- The doctor reports a field-local malformed row as non-blocking `malformed`, naming the file and entry position; an unreadable (whole-file) history blocks publish, because a publish would mirror content nobody read.
- The MCP half — `get_history` / comments output carrying the incomplete count — is a known gap ([DEG-C7](../surface-test-cases/flow-degradation.md)).

### DEG-19 · M4 · blocker · P5
**Backup/restore preserves dropped fields and never overwrites an unreadable destination.** Restore a backup containing a corrupt task; separately, restore over a file that cannot be read.

- A dropped/unrecognised field round-trips verbatim through export + restore.
- Restore never overwrites an unreadable destination (P-11) and refuses a partial set, naming the missing part and writing nothing.

### DEG-20 · M4 · major · P5
**The attachments section degrades independently of task health.** Open the attachments panel of a corrupt task; separately, make the attachments directory unreadable.

- A corrupt task's attachments panel opens normally — attachments are orthogonal to frontmatter health — and shows the genuine empty state when the task simply has no attachments.
- An unreadable attachments dir shows an error affordance, NOT the "no attachments" empty state; the rest of the task stands (REL-49).

### DEG-21 · M4 · blocker · P1 P5
**Reconcile marks a corrupt side of a conflict so it is not merged as empty.** Run a git reconcile where one side's field value is corrupt.

- The corrupt side shows the stored bytes + a ⚠ corrupt marker (not the degraded blank), so the user does not merge a corrupt value believing it is empty. Merging a corrupt value as empty is a silent write-path data loss, which is why this is a blocker.
- Cannot be satisfied yet: the reconcile *UI* corrupt-side rendering has no test (`ReconcilePanel.tsx` exists, no test file); and `mergeTask`'s health union on a 3-way merge — what the *merged file* contains when a side carries health — is unpinned.
- Cannot be satisfied yet: a conflict where corruption is the ONLY difference (no conflict row forms) is not yet surfaced.

### DEG-22 · M4 · major · P5
**A saved view referencing a dropped field/entity stays listed and runnable.** Save a view whose query names a removed field or a deleted entity, then reload.

- It stays listed (marked), remains editable, and runs with a warning — not dropped, not shown as an empty result.
- Cannot be satisfied yet (write half): a UI view write must not drop a concurrently-present *broken* sibling view from `queries.yaml`. That is the queries-specific case of DEG-24; `queries.yaml` itself is now fixed (see DEG-24), but the end-to-end UI-write assertion is not yet written.

### DEG-23 · M4 · major · P5
**Health travels on the wire only when present, and never leaks the raw object.** Fetch `GET /api/tasks/:ref` and the list responses for a corrupt and a clean task.

- `health` is present when the task is corrupt, omitted when clean; `raw` is never sent (only `rawText`); the list rows carry the same shape.
- The MCP `get_task`/`list_tasks` shape must match — present-when-corrupt, omitted-when-clean, `raw` never sent ([DEG-C1](../surface-test-cases/flow-degradation.md)). Every ⚠/`(broken)` marker on every surface depends on `health` travelling and `raw` not leaking, which is why this is major, not polish.

## E. Aggregates, config-write preservation, publish gate

### DEG-24 · M4 · blocker · P1 P7
**A config write never drops a sibling entry it did not touch, broken or not.** Hand-break one sprint entry, then create a second sprint through the UI/CLI/MCP; re-read `sprints.yaml`.

- The broken entry's raw text is still in `sprints.yaml` after the write — a writer that re-serialises only the valid set silently destroys a user's broken-but-present entry.
- The same holds for labels, milestones, projects, views, and list-view filters — each writer must preserve an untouched broken sibling.
- Partly built: `queries.yaml` is fixed — a view write preserves a broken view (`serializeQueriesConfig` never emits `broken`, and the writer re-attaches untouched broken entries). The other six writers are being fixed in a parallel task; those bullets are satisfied by that work, not by a new test here.

### DEG-25 · M4 · major · P1 P5
**Aggregates count a degraded task and name an unreadable one; a total is never silently short.** Put a done task and an object-fatally-unreadable task in one milestone, then request progress with detail.

- Milestone/sprint progress includes a field-local-corrupt task (it is a task) and counts the readable corpus honestly.
- An unreadable member is REPORTED at the top level (the file is named), not silently skipped — a wrong number with nothing to explain it is the failure this forbids.
- Built but a surface-test gap: the web `GET /api/milestones?progress=true` carries `unreadable`, the CLI `milestone list --progress` warns, and MCP `list_milestones` carries `unreadable` — none has a surface test yet.

### DEG-26 · M4 · blocker · P1 P6
**Publish gates on object-fatal corruption but proceeds through field-local corruption, reporting both.** Run doctor / publish on a tracker with a field-local-corrupt task, then an object-fatal task.md or history file, then both.

- Field-local task.md corruption → doctor reports `malformed`, non-blocking; publish proceeds (A135.2).
- An object-fatal task.md or history file → doctor reports `unreadable`, which blocks publish and names the path — a publish would otherwise mirror content nobody read.
- Both present → both are reported, not collapsed into one.

### DEG-27 · M4 · major · P5
**Duplicate and merge over a corrupt task carry health correctly, not a raw corrupt value.** Duplicate a task with a corrupt field; separately, merge two sides where one carries health.

- Cannot be satisfied yet (duplicate): `duplicateTask` copies only healthy frontmatter and refuses when `project` itself is corrupt — but it does not report which fields it dropped ([known-gaps.md DUP-H1](../known-gaps.md)). Two bullets (healthy-only copy; refuse on corrupt project) are satisfiable today but uncased; the dropped-fields notice cannot be.
- Cannot be satisfied yet (merge): what the merged file contains when a side carries health — a union of raws, with the winning side's healthy value overriding — is a write path with no test (cross-ref DEG-21).

---

## Known coverage gaps

Behaviours these cases assert that no test yet backs. Distinct from the
"cannot be satisfied yet" bullets above (which name decided-or-unbuilt
behaviour): these are built behaviours simply missing a test, or a test
that lives on the wrong surface.

- **DEG-1 wire attribution.** No web-API test seeds an object-fatal
  *task* and asserts the response attributes it "unreadable" rather than
  "not found". Core (`corruption-audit.test.ts`) and web-UI
  (`ListView.test.tsx`) back the behaviour; the wire does not.
- **DEG-11 settings panels.** The labels/milestones/projects settings
  panels do not render a per-entry `broken` marker
  (`dataPanels.test.tsx` covers load-failure vs empty vs duplicate, not
  a per-entry broken marker).
- **DEG-21 reconcile UI + mergeTask health union.** `ReconcilePanel.tsx`
  has no test; the merged-file health union is unpinned.
- **DEG-25 surfaces.** The web/CLI/MCP `unreadable` reporting on
  aggregate endpoints is built but has no surface test.
- **`classifyTaskHealth` element-indexed finding** (`labels[2]`,
  `relationships[1].target`) — supports DEG-14/15/16, decided (A137.1),
  no test asserts an indexed `FieldHealth.field`.
- **Bulk over an object-fatal member** must land in `failed` with a
  "could not be read: <path>" message (distinct from "not found" and
  from the `unchanged`/K25 outcome) — the existing bulk tests use
  dangling refs, not an on-disk object-fatal member.
