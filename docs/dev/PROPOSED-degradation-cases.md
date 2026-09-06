# PROPOSED canonical cases for data degradation (corruption handling)

Authored from `degradation-test-inventory.md` (25 behaviors B1–B25, its
gap lists and KIND×OBJECT grid) to give the corruption framework the same
case → @verifies → test traceability every other feature has. **Proposal
— under review before anything lands in `docs/dev/ui-test-cases/`.**

**Home:** a new flow doc `flow-degradation.md`, prefix `DEG-`. Corruption
is cross-cutting (core + every surface), so it earns its own flow rather
than being scattered. Where a behavior is already sliced by an existing
case, the DEG case cross-references it rather than duplicating.

**Format** matches the house style: `### DEG-N · M· severity · P-principles`,
bold behavior, setup, then bullets. `[T]` after a bullet = already tested
(tag the existing test `@verifies DEG-N`); `[NEW]` = needs a new test.

Each case notes the inventory behavior(s) it canonicalizes.

---

## A. The task record (field-local corruption)

### DEG-1 · M4 · blocker · P5 P11 — Object-fatal task corruption is attributed, blocks nothing else
_B1._ A task.md with a bad `id`/`key` or unparseable YAML.
- The task is reported unreadable with the file path and the parse line; it is not read as "task not found". [T core B1 #17-18; web-UI #275] [NEW — no WIRE test attributes an object-fatal *task* as unreadable]
- Every other task still loads; the list/board render the readable ones and name the unreadable one in an affordance. [T list #16-18; #275]
- CLI `loctt show`/`list` and MCP `get_task`/`list_tasks` over the corrupt task attribute the failure the same way. [NEW — CLI/MCP parity gap #1]

### DEG-2 · M4 · blocker · P5 — A wrong-typed known field degrades; the task still loads
_B2._ A hand-edited `due_date: 42` (a number where a date is required).
- The task opens; the corrupt field is lifted out and reported as a health finding carrying its stored value; the rest of the frontmatter is intact. [T core B2]
- Only `id`/`key` are fatal; a broken `title`/`created_at`/`updated_at` degrades too (K26). [T frontmatter #3,#8]

### DEG-3 · M4 · blocker · P7 — Preserve-others: editing one field keeps an untouched corrupt field byte-for-byte
_B3._ Set `status` on a task whose `due_date` is corrupt.
- The corrupt `due_date` value survives on disk, value-preserved (K27); only the edited field changes. [T core B3]
- Through the web `POST …/set`, `loctt set`, and MCP `set_field` alike. [T core; NEW wire/CLI/MCP repair-path gap]

### DEG-4 · M4 · major · P5 — Set-over repairs a corrupt field; unset removes it
_B4, B5._ Write a valid value to the corrupt field, or remove it.
- A valid write clears the finding (even a strict read then succeeds). [T core B4]
- Unset drops the field from health and disk; an unrecognised key is removable the same way. [T core B5]
- The repair is recorded in history: the entry's `before` is the raw corrupt value and it is marked as repairing corruption (`meta.was_corrupt`). [NEW — decided-but-untested #1]

### DEG-5 · M4 · blocker · P1 P7 — The write guard never introduces or silently drops corruption
_B6._ 
- A write that would make a field newly corrupt is refused. [T core B6]
- A merge-style write (`fields ?? {}`) may not drop an untouched corrupt field it does not name; only a whole-record author may. [T core B6]

### DEG-6 · M4 · major · P7 — An operation that must READ a corrupt structural field refuses
_B7, B8._ 
- `link`/`unlink` over a wrong-typed `relationships` array refuses with a corrupt-field error naming the field. [T core #23,#24]
- An op that only reads a field for an idempotency check (archive over a corrupt `archived`) never refuses and never persists the corrupt value. [T core lifecycle]
- The refusal reaches the web/CLI/MCP surfaces as a clear error, not a 500. [NEW — derived-op parity gap]

### DEG-7 · M4 · minor · P5 — An unrecognised frontmatter key is preserved and surfaced, not dropped
_B9._ A hand-added `jira_id: ABC-1`.
- It round-trips byte-for-byte (passthrough) and is shown in a "Not recognised" group, read-only with a remove control. [T core #5; UI]

### DEG-8 · M1 · major · P5 — An untitled task shows its key, never a blank
_B10._ A task whose title is absent/corrupt.
- The list, board, timeline, and detail render the key where the title would go; never blank, never "undefined". [T web #241,#273,#3,#8]
- CLI `show`/`list` and MCP do the same. [NEW — parity gap #2]

## B. Config objects (per-entry corruption)

### DEG-9 · M4 · blocker · P5 — A corrupt config entry degrades; the rest of the file loads
_B11._ One project/label/milestone/sprint/holiday/etc. is wrong-typed.
- The good entries load; the bad one becomes a broken marker (index + stored text + the validator's message); `broken` is omitted when every entry parsed. [T core B11 across 9 loaders]
- Applies to projects, labels, milestones, sprints, calendar holidays, list-view chip arrays, and each workflow sub-list (statuses/priorities/types/relationships/custom-fields). [T]
- A sub-field that is individually salvageable (a label's malformed hex color) is dropped to a default while the entry itself still loads — a finer degrade than dropping the whole entry. [T core labels #85-86]

### DEG-10 · M4 · blocker · P5 — A structurally-broken config file still refuses, attributed, without taking down unrelated surfaces
_B12._ A non-array root, unknown top-level key, or duplicate id.
- It throws an error naming the file and the offending rule (not a bare Zod dump, not a generic 500). [T core B12; wire config-errors]
- A duplicate id/prefix stays fatal (ambiguous). Surfaces that don't read that file keep working. [T]

### DEG-11 · M4 · major · P5 — "Broken" is distinct from "empty" and from "failed to load"
_B13._ 
- A file whose only entry is corrupt is NOT reported as "none" — the surface shows the broken entry, distinct from a genuinely-empty list and from a fetch failure. [T projects #… ; sprints notice]
- `GET /api/{projects,labels,milestones,sprints}` carries `broken` on the wire; the sprints view renders it as a notice. [T wire; sprints UI]
- The labels/milestones/projects settings panels list their broken entries too. [NEW — documented boundary #10]

### DEG-12 · M4 · blocker · P5 P11 — state.yaml is object-fatal by necessity, with an attributed error
_B22._ A wrong-typed key counter in state.yaml.
- It refuses with a `config_invalid` error naming the file and the counter — it does NOT degrade, because dropping a counter risks re-issuing a live task's key (unrecoverable). [T core B22]

### DEG-13 · M4 · major · P5 — A user profile degrades every field but id; settings drop bad known keys yet keep passthrough
_B23._ A hand-corrupted `profile.yaml` / `settings.yaml`.
- The profile loads with the bad field set aside (only `id` is fatal); a nameless user shows their id everywhere a name would appear. [T core #54-59; web]
- A wrong-typed known setting falls back to default; unknown settings keys survive untouched (the passthrough is load-bearing). [T core #61-64]

## C. References and cross-object

### DEG-14 · M4 · major · P4 P7 — A dangling reference degrades to a marked value, never blank, never a full ULID
_B14._ A task whose assignee/reporter/label/milestone points at a deleted entity.
- The cell shows a truncated-ULID + "(deleted …)" marker, never blank, never the raw full ULID; the row still renders and other columns are unaffected. [T core #36,#39,#43; PRU-25]
- Filtering offers only live entities; the dangling id is not offered. [T]

### DEG-15 · M4 · major · P5 — A relationship edge distinguishes healthy / corrupt / corrupt-unreadable / deleted
_B15._ A task linking to a target that is healthy, field-local-corrupt, object-fatally unreadable, or absent.
- Healthy links normally; a corrupt-but-present target links and is marked ⚠ corrupt (opens, repairable); an unreadable target is marked corrupt (not "deleted"); a genuinely-absent target is the "broken link — no task with id" state. [T core show.ts; web RelationshipRow; A139]
- CLI/MCP relationship display mirrors the distinction. [NEW — parity]

### DEG-16 · M4 · major · P5 — An invalid enum / workflow-drifted value keeps its raw key and is marked
_B16._ A task on a status/priority key not in workflow.yaml.
- The cell shows the raw key with a drift marker (never blank); the picker offers only valid options; editing clears it. [T core #150-155; web/CLI/MCP #285,#295,#300]
- A drifted relationship *type* (a link whose type is no longer in workflow.yaml) is likewise marked, not dropped. [T web group.test #250-252]

## D. Surface-specific degradation

### DEG-17 · M4 · major · P5 — A corrupt-dated task is distinguished from an undated one on the timeline
_B17._ A task whose `due_date`/`start_date` is corrupt.
- It routes to the unscheduled affordance MARKED as corrupt (⚠ + raw), distinct from a deliberately-undated task, is still counted, and is never dropped. [T web timeline B17]

### DEG-18 · M4 · major · P5 P6 — A malformed history/comment row is reported incomplete, kept in place, refused on merge, skipped on restore
_B18._ A hand-broken history.jsonl / comments row.
- The feed reports "N entries could not be read" (incomplete), keeps the readable ones; it does not silently show a shorter history. [T core #182-193; web ActivityPanel.test.tsx IncompleteNotice — ALREADY TESTED, grounding-review correction: inventory never scanned that file]
- On git merge the malformed row is refused; on restore it is skipped; object-fatal (whole file unreadable) blocks, distinct from a single malformed row. [T core]

### DEG-19 · M4 · major · P5 — Backup/restore preserves dropped fields and never overwrites an unreadable destination
_B19._ Restoring a backup that contains a corrupt task / restoring over an unreadable file.
- A dropped/unrecognised field round-trips verbatim through export+restore; restore never overwrites an unreadable destination; a broken/partial backup set is refused. [T core B19; backup.test]

### DEG-20 · M4 · minor · P5 — The attachments section degrades independently of task health
_B20._ A corrupt task, and separately an unreadable attachments dir.
- A corrupt task's attachments panel opens normally (attachments are orthogonal to frontmatter health). [T web #… attachments]
- An unreadable attachments dir shows an error affordance with retry, NOT the "no attachments" empty state; the rest of the task stands (REL-49). [T]

### DEG-21 · M4 · major · P1 P5 — Reconcile marks a corrupt side of a conflict so it is not merged as empty
_B21._ A git reconcile where one side's field value is corrupt.
- The corrupt side shows the stored bytes + a ⚠ corrupt marker (not the degraded blank), so the user does not merge a corrupt value thinking it is empty. [T core reconcile-plan #176; web ReconcilePanel — NEW UI test gap]
- (Known follow-up: a conflict where corruption is the ONLY difference — no conflict row forms — is not yet surfaced.)

### DEG-22 · M4 · major · P5 — A saved view referencing a dropped field/entity stays listed and runnable
_B24._ A saved view whose query names a removed field or a deleted entity.
- It stays listed (marked), remains editable, and runs with a warning — not dropped, not shown as an empty result. [T core queries; VUE-22]

### DEG-23 · M4 · minor · P4 — Health travels on the wire only when present, and never leaks the raw object
_B25._ The `GET /api/tasks/:ref` and list responses.
- `health` is present when the task is corrupt, omitted when clean; `raw` is never sent (only `rawText`); the list rows carry the same. [T wire B25; server.health.test]

---

## Cases that need a NEW test (from the inventory gaps), by DEG case

- **DEG-1, DEG-8:** CLI `show`/`list` + MCP `get_task`/`list_tasks` render a corrupt field's health / untitled→key / unreadable affordance. (parity gaps #1, #2)
- **DEG-3, DEG-4, DEG-6:** repair (set-over/unset) and derived-op refusal through the web API / `loctt set|unset` / MCP `set_field|unset_field` over a corrupt field. (parity gap "repair"/"derived-op")
- **DEG-4:** the repair-provenance history entry (`before` = raw, `meta.was_corrupt`). (decided-but-untested #1)
- **DEG-11:** labels/milestones/projects settings panels render `broken`. (boundary #10)
- ~~DEG-18: web activity IncompleteNotice~~ — REMOVED (grounding review: already tested in `ActivityPanel.test.tsx`, 3 passing tests; the inventory never scanned that file). Tag those tests `@verifies DEG-18` instead.
- **DEG-21:** reconcile-UI corrupt-side rendering. (parity gap)
- **classifyTaskHealth** producing an element-indexed finding (`labels[2]`, `relationships[1].target`). (decided-but-untested #4 / A137.1) — supports DEG-14/15/16.
- **Bulk over an object-fatal member** reports "could not be read", not "not found". (all-surface gap) — likely its own case DEG-24 under bulk, or a bullet on DEG-1.

## Open question for review
- Is a single `flow-degradation.md` / `DEG-` prefix the right home, or should some cases live in their existing flow (LST/REL/SET/GIT)? The inventory says most behaviors are cross-cutting, which argues for one doc; the review should confirm.
- Severity/milestone tags above are first-pass (mostly M4/major) — the review should sanity-check.
