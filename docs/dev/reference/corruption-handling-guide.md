# Corruption handling — engineering guide

**Durable reference.** When you add a new field, a new config object, or
a new surface, this is the checklist for making it degrade correctly
instead of crashing — and the principles behind why. Read it before you
write the code.

Companions:
- `docs/dev/reference/north-star.md` § Operating principles — the *values* (1, 3,
  5, 6, 7 are the corruption-relevant ones). This guide is the *system*
  that makes them repeatable.
- `tests/cases/ui-test-cases/flow-degradation.md` (DEG-) +
  `tests/cases/surface-test-cases/flow-degradation.md` (DEG-C) — the
  canonical acceptance cases. A new field's corruption behaviour is not
  done until it maps onto these.
- `docs/dev/decisions.md` K21–K28 — the rulings this guide encodes.

---

## 1. The two failure modes — decide which one your thing is

Every corruption is one of exactly two kinds, and the whole design turns
on which:

| | **Field-local (degrade)** | **Object-fatal (throw)** |
|---|---|---|
| Meaning | one field is bad; the record is still identifiable and usable | the record cannot be identified or safely written at all |
| Load behaviour | lift the bad field into `health`, load the rest | throw a typed parse error |
| Surface behaviour | render the record, mark the field corrupt | render an "unreadable" affordance in place, never blank the neighbours |
| Publish/doctor | `malformed` — reported, **non-blocking** | `unreadable` — reported, **blocks publish** |
| Example | `due_date: "not-a-date"` on a task | `id`/`key` missing or unparseable YAML |

**The fatal set is deliberately tiny.** For a task, only `id` and `key`
are object-fatal (K26); a broken `title`, `created_at`, or `updated_at`
degrades. For a config entry, only what makes the entry unidentifiable
or the whole file unparseable is fatal. When in doubt, **degrade** —
principle 1 (never lose or silently corrupt data) says preserve and
report, never destroy. Make something fatal only when operating on it
would risk *worse* corruption (e.g. reusing a task key → two tasks with
one key).

**`state.yaml` is the one deliberate exception (K/DEG-12):** it is
object-fatal by necessity, because dropping a counter risks re-issuing a
live task's key. It refuses with a named `config_invalid` error rather
than degrading.

---

## 2. The building blocks (don't reinvent them)

All in `packages/core/src`:

| Concern | Use | Where |
|---|---|---|
| A task field degraded | `FieldHealth` `{field, kind, raw, rawText, error, repair}` | `contracts/health.ts`, produced in `task/frontmatter.ts` |
| A config entry degraded | `BrokenEntry` `{id?, index, rawText, error}` | `contracts/health.ts` |
| Per-entry tolerant collect | `collectValidEntries(rawEntries, schema, label, idOf?)` | `config/health.ts` |
| Re-emit degraded entries on write | `brokenEntriesToPlain(broken)` | `config/health.ts` |
| Report unreadable/malformed to doctor + publish | `checkDataIntegrity` | `diagnostics/integrity.ts` |
| Read all tasks, keeping failures | `loadAllTasksDetailed` → `{tasks, unreadable}` | `task/load-all.ts` |

`kind` is one of `wrong_type | missing_required | unrecognised |
invalid_value | dangling`. `raw` is the parsed value and is **never sent
on the wire**; `rawText` (= `renderRawText(raw)` = stringified YAML) is
what a surface renders.

**The `{value, status}` view-model is frontend-only** (A137). Core and
the wire carry `value?` + `health`/`broken` separately; the client
composes them into `fieldView(field, value, health)` at the render edge
(`apps/web/src/client/health/fieldHealth.ts`). Do **not** push a
`{value, status}` object into core or the API shape.

---

## 3. Checklist — adding a new **task field**

1. **Schema (`contracts`).** Add the field. Decide: is a bad value
   field-local (almost always yes) or object-fatal (only if the field
   is part of identity)?
2. **Loader (`task/frontmatter.ts`).** A wrong-typed / unrecognised
   value must lift into `health`, not throw. The tolerant path already
   does this for known fields via the degrade helper — confirm your
   field flows through it, and add a test that a bad value degrades
   (see `frontmatter.test.ts`).
3. **Write guard.** A write that targets another field must leave yours
   untouched, value-preserved (K27, principle 7). A validated write
   *to* your field replaces a corrupt value (repair). A merge-style
   write may never drop your field if it did not name it. Covered by
   the core write-guard tests (`corruption-audit.test.ts`); extend them.
4. **Derived reads.** If any operation must *read* your field to do its
   job (an idempotency check, a structural walk), decide: safe to
   proceed over a corrupt value, or must it refuse? Refuse only when
   reading the corrupt value would risk worse corruption (principle 7).
5. **Surfaces (parity — principle 3).**
   - **Web:** the cell renders the value, or the corrupt affordance
     (⚠ + `rawText`) when `fieldHealth` is present; editing repairs it.
   - **CLI `show`/`list` + MCP `get_task`/`list_tasks`:** surface the
     health, don't hide it. (This is a known parity gap for several
     fields today — see DEG-C cases; don't add to it.)
6. **Wire.** Health rides on the wire only when present, and `raw` is
   never serialized (`wireHealth`, `server.ts`). Add it to the list-row
   shape too, not just the detail.
7. **Doctor + publish.** A task field-health finding is already picked
   up by `checkDataIntegrity` (it walks `task.health`). Confirm your
   field's finding reads well; no new doctor code needed for task
   fields.
8. **Cases + tests.** Map onto a DEG- case; every new assertion must be
   shown to fail (break the behaviour → red → restore).

**Keep the schema tolerant of pre-existing files.** A `.strict()` schema
rejects every older file on load, or destroys unknown keys on save.
`UserSettings.passthrough()` is load-bearing: every panel saves
`{...stored, ...next}`, so `.strict()` there would destroy the sidebar layout
when editing an unrelated card layout — a data-loss bug that looks like
drift to remove. Add a write-path check for the new field
(`schema-coverage.test.ts` enumerates the schema at runtime and fails
naming an unhandled field), or exempt it with a one-line reason.

## 4. Checklist — adding a new **config object** (list-shaped)

For a new sibling of labels/sprints/milestones/projects:

1. **Schema (`contracts`).** Per-entry schema + a `broken?: BrokenEntry[]`
   on the config type (omitted when clean, never `[]`).
2. **Loader.** Extract the array (object-fatal if the file is not a
   list), then `collectValidEntries(raw, EntrySchema, label, idOf)` for
   the per-entry degrade. Cross-entry checks (duplicate ids) stay
   object-fatal. Emptiness must count `valid.length + broken.length`, so
   a lone corrupt entry degrades rather than reading as "none" (A138 /
   DEG-11).
3. **Writer — THIS IS THE ONE PEOPLE FORGET (K28).** The writer must
   re-emit the degraded siblings it did not touch:
   `[...valid.map(serialize), ...brokenEntriesToPlain(config.broken)]`.
   Validate only the valid entries before writing. **Add a preserve
   test** (break one entry, do an unrelated write, assert the broken one
   survives, byte-value-for-value) and mutation-verify it. Without this,
   any UI write silently deletes a broken sibling — P1 data loss.
4. **Thread `broken` through manage.ts.** Every load-mutate-save writer
   must carry `...(config.broken ? { broken: config.broken } : {})`
   forward, or step 3 has nothing to preserve.
5. **Wire.** The list endpoint carries `broken` (present only when
   non-empty), parallel to how milestones/sprints do it in `server.ts`.
6. **Surfaces (parity).** Web renders the broken entry as a marked,
   read-only row distinct from empty and from a failed fetch (DEG-11).
   CLI/MCP surface it too (DEG-C).
7. **Doctor — ADD YOUR CALL.** `checkDataIntegrity` reports config
   `broken` markers, but only for the configs wired into it. Add a
   `collectConfigBroken(findings, <yourPath>, () => load(...).then(c =>
   c.broken), "<entry label>")` call (see § 6), or your degrades are
   invisible to doctor.
8. **Cases + tests.** DEG-9/10/11/24 are the templates.

**Keyed-record config (workflow.yaml) is different.** Its `broken` is
per-sub-list, and its writer is a whole-document PUT, so "thread
`config.broken`" does nothing — the client can't resubmit broken entries
it never rendered. Its writer re-reads on-disk broken and merges per
sub-list at write time (K28-WF, `mergeBrokenIntoPlain`). If you add
another keyed-record config, follow that pattern, not the flat one.

## 5. Checklist — cross-object references & aggregates

1. **A dangling reference degrades to a marked value** (K21/K22/DEG-14):
   never blank, never the raw full ULID — a truncated-id + "(deleted …)"
   marker. The row still renders; other columns are unaffected.
2. **A relationship edge distinguishes four states** (A139/DEG-15):
   healthy / corrupt-but-present (links, marked, repairable) /
   unreadable target (marked corrupt, not "deleted") / genuinely-absent
   (broken-link state).
3. **Aggregates never silently undercount** (K28/DEG-25). Counts,
   progress, burndown, export share `loadAllTasks`. A field-local
   corrupt task **is included** (it is a task). An **unreadable** task
   must be **reported, not skipped** — use `loadAllTasksDetailed` and
   surface the `unreadable` list at the level you can attribute it to
   (tracker-level when you can't tie it to the entity, as milestone
   progress does).

---

## 6. What `doctor` does — and does not — cover

`loctt doctor` is **read-only by default** (it only reads and reports).
There is no separate preview command and no `--dry-run` flag because the
base command mutates nothing. Its writes are opt-in flags:
`--rebuild-index`, which repairs the key-index cache after out-of-band
`key`/`key_history` edits; `--repair-relationships` (K141), which
rewrites key-valued link targets to ids, adds the missing side of
one-sided links (refusing a loop), merges identical links and ranks
links that have no rank (K143), never deleting one; and `--fix`, which runs every repair in core's
`SAFE_FIXES` (those two). `restore-missing` (`init --repair`) is not
"safe": it writes default config in place of the user's. So: *preview
is the default; acting is the flag.* A new repair is a `DiagnosticFix`
value, a doctor check carrying it as `fix`, a CLI flag, an MCP `doctor`
option and a Diagnostics button (`POST /api/doctor/repair`), and runs
**before** the checks so the report shows what is left. Exit code is 1 if any check is `error`; warnings exit 0.

Doctor is exempt from the schema boot-guard (CLI and MCP), so it can
report a version mismatch when every other command refuses to run. It
never writes to a tracker whose schema is not current (K154): for an
older tracker it says it needs upgrading and to run `loctt migrate`, and
every requested repair is skipped, saying why. `.schema-version` itself is object-fatal for the
whole tracker, never guessed at: a value that is not a format version
(including 0.2.x's `1`) or an empty file is refused with what the file
must hold (`readSchemaVersion`), newer is refused naming the release, and
the crash sentinel is fatal until the backup is restored.

**It covers** (`diagnostics/doctor.ts` + `integrity.ts`):
- config **parse errors** (object-fatal) on every config file → error
- **task field-health** (malformed, non-blocking) + **unreadable
  task.md** (blocks publish)
- **comment** and **history** malformed entries + unreadable files
- **label hex-color** drop (read raw, since the loader drops it)
- **workflow drift** (a task holding a value workflow.yaml no longer
  defines), **dangling task references**, **relationship cycles**,
  **cross-file inverse disagreement** (principle 1 / P-12 consistency),
  **key-valued link targets**, **duplicate links** and **links with no
  rank** (K143) — all repaired by `--repair-relationships` (K141; planner
  in `task/relationship-repair.ts`, findings in `task/traversal.ts`
  `relationshipFindings`, so doctor reports exactly what the repair does).
  A missing `rank` is field-local: the edge still loads and lists after
  the ranked ones (P-7); it is reported, never a refusal.
- **retired config keys** — a `ranked:` line on a relationship (K143) is
  dropped on read by the schema's preprocess (it never fails the strict
  parse, so the kind is not reported `broken`), and doctor warns
  (`workflow.yaml retired settings`, `config/retired-keys.ts`) so it can
  be removed. A future retired key goes in `RETIRED_RELATIONSHIP_KEYS`
  (contracts) and is reported and stripped by the same code.
- **config per-entry `broken` markers** — the A138/K28 degrade for
  projects, labels, milestones, sprints, saved views, list-view chips,
  calendar holidays, and workflow sub-lists. `checkDataIntegrity` runs
  each loader and emits a `malformed` finding per degraded entry, naming
  it by id (or position). **When you add a new config object, add its
  `collectConfigBroken(...)` call** — the loop is right there in
  `integrity.ts` and a new config that skips it makes its degrades
  invisible again.
- **user-profile field-health** — a profile degrades per-field like a
  task (bad timezone, wrong-typed/unrecognised key; only `id` is fatal,
  K13). `checkDataIntegrity` reports each degraded field as `malformed`
  and each unreadable profile as `unreadable`, via
  `loadAllUsersDetailed`.
- **per-user `sidebar_groups` salvage** (SHL-45, K158) — a hand-edited
  unknown or duplicate id (or an unknown `version`) is lifted out on load
  so the sidebar still renders (P7). Since format 0.4.0 (K160) a pre-K158
  value (no `version`) is corrupt: ignored whole for the default layout,
  and reported as the older layout with the remedy that fits the tracker
  (`loctt migrate` when its format is older, a layout reset otherwise); a
  stray `sidebar_pins` is dropped on load and reported the same way;
  `collectSidebarGroupsDrops` (in `users/settings.ts`) reads the raw
  settings and `checkDataIntegrity` emits a `malformed` finding naming
  each dropped id (and one for a wholly-unshaped value). Non-blocking —
  the valid ids still load.
- **unparseable per-user `settings.yaml`** (K160) — `loadUserSettings`
  throws on it and the 0.3.0 → 0.4.0 step leaves it as it is, so
  `collectUnreadableSettings` names it (`malformed`: the file is
  gitignored and never published, so it must not block a publish).
- **per-user `keyboard_shortcuts` salvage** (K133) — a hand-edited unknown
  shortcut id, a duplicate, or a non-boolean `single_key` is lifted out on
  load so single-key shortcuts fail open (on); `collectKeyboardShortcutsDrops`
  (in `users/settings.ts`) reads the raw settings and `checkDataIntegrity`
  emits a `malformed` finding naming each dropped part (and one for a
  wholly-unshaped value). Non-blocking.
- key-index drift, interrupted prefix-rename / reconciliation / migration

**It does NOT currently cover (known gaps — fix when you touch them):**
- **The aggregate `unreadable` list** (K28/DEG-25) is surfaced by the
  progress APIs but doctor's own task scan reports unreadable task.md
  separately; there is no "milestone X's totals are short by N
  unreadable tasks" line. Low priority — the per-task unreadable finding
  already fires.

**The two severities are load-bearing** (`integrity.ts`): `unreadable`
blocks a publish (LocTT cannot vouch for the bytes); `malformed` and
`inconsistent` are reported but never block (the data is intact and
preserved — blocking would be destruction by another route). Any new
finding must pick the right one: **can we safely publish this?** If yes,
`malformed`; if the bytes are unread, `unreadable`.

### Coverage check (RR-H1, light pass, 2026-09-27)

This month's additions, walked against the checklists above:

| Field / object | Field-local or fatal? | Reader degrades? | In doctor? | Gap found |
|---|---|---|---|---|
| `keyboard_shortcuts` (K133) | field-local | yes — `salvageKeyboardShortcuts`, fails open (all on) | yes — `collectKeyboardShortcutsDrops` → `checkDataIntegrity` | had zero test at the doctor/integrity layer (only unit-level `shortcuts.test.ts`); added two `integrity.test.ts` cases |
| `sidebar_groups` incl. `filters` group id (K125) | field-local | yes — `salvageSidebarGroups`, degrades to "no customization" | yes — `collectSidebarGroupsDrops` → `checkDataIntegrity`, tested | none — the `filters` group id is just one more entry in the closed `SIDEBAR_ITEM_IDS` set the existing salvage already walks; no separate code path to miss |
| `sidebar_groups` version 2: one `views` group, `view:<id>` children (K158, A370) | field-local | yes — `salvageSidebarGroups` (2 = the K158 set; any other version reported and read as 2); a malformed, duplicate or stray part drops alone | yes — the same `collectSidebarGroupsDrops` path, tested for a malformed `view:` id | a `view:<id>` whose view is gone is not a finding: it is a stale reference the resolver skips (a deleted view drops out of the order), not corruption |
| Pre-K158 `sidebar_groups` (no `version`) after format 0.4.0 (K160, A372) | field-local | yes — `salvageSidebarGroups` flags `olderLayout` and returns the default; not salvaged per id (its ids meant other things) | yes — `collectSidebarGroupsDrops` → `checkDataIntegrity`, remedy chosen by the tracker's recorded format (`loctt migrate` if older, reset otherwise); `integrity.test.ts` | the upgrade step converts only a clean value; a dirty one is left for this finding rather than approximated (rule 3) |
| Body draft (`sessionStorage`, A338) | field-local (per-tab, ephemeral) | yes — `readBodyDraft` drops an unparseable/wrong-shaped entry and a blocked/throwing `Storage` degrades to "no draft" everywhere it's touched | n/a — not on-disk tracker state, so outside doctor's scope by design | none — `bodyDraft.test.ts` already covers the malformed-JSON, wrong-type, and blocked-storage cases |
| Link `rank` (K143, B41) | field-local (an edge without one) | yes — sorts after the ranked edges; reorder ranks its siblings first | yes — `relationshipFindings` "has no rank", repaired by `--repair-relationships` | none; tested in `task/traversal.test.ts` and `relationship-repair.test.ts` |
| Retired `ranked` on a relationship (K143) | field-local (a key that no longer means anything) | yes — dropped on read, the kind loads | yes — `workflow.yaml retired settings` warn | none; `config/retired-keys.test.ts` |
| Retired `sidebar_pins` per-user setting (K159, K160) | field-local (a key that no longer means anything) | yes — the loader lifts it out (`RETIRED_SETTINGS_KEYS`), whatever it holds, so the next settings write leaves it behind; only the 0.3.0 → 0.4.0 step reads it, to order the saved views, and deletes it | yes — `collectSidebarGroupsDrops` (`retiredPins`), same remedy rule as the older layout | none; `users/settings.test.ts`, `diagnostics/integrity.test.ts`, `schema/upgrade-0.4.0.test.ts` |
| Unparseable `settings.yaml` (K160) | object-fatal for that user's settings (the loader throws) | no — pre-existing; the settings surfaces fail for that user | yes — `collectUnreadableSettings`, `malformed` | the loader itself still throws (a known gap, not new): only doctor reports it |
| `.schema-version` as semver (K142) | object-fatal (for the tracker) | n/a — refused with what it must hold, by design | yes — the `schema version` check names the problem | none; `schema/version.test.ts`, `upgrade-0.3.0.test.ts` |
| Unique view names (B21/K129) | write-time refusal (not stored corruption) | n/a — a duplicate name already on disk (pre-K129, or hand-edited) keeps loading and running by id; only a *new write* to a taken name is refused | n/a — nothing to salvage on read | none — this is a write guard, not a degrade-on-load case; `views/manage.test.ts` covers the refusal |

Everything else in `known-gaps.md`'s roster and the guide's own list
still holds; this pass only checked the fields/objects listed above plus
their obvious siblings, not a full re-audit (Ken: "we already done one
round of it").

---

## 7. The five rules that catch the real bugs

1. **When in doubt, degrade.** Fatal is the rare exception, justified
   only by "operating on it risks worse corruption."
2. **A writer preserves what it did not touch.** The single most-missed
   step (K28). Every write path — task, flat config, keyed config —
   round-trips a corrupt sibling untouched.
3. **Corruption is never *silently* rewritten, but it is not sticky.** A
   validated write to the corrupt field itself repairs it (principle 7).
   Refuse rather than approximate when a wrong conversion would fail
   silently: a false conversion costs wrong data with no signal, while a
   false refusal costs a visible "can't". Advanced→Basic DSL conversion
   accepts only the exact shape the generator emits and names the
   construct otherwise; config is refused when malformed (a definition
   other data references), while event records degrade in place.
4. **Report, don't hide.** A preserved broken entry that nothing
   surfaces is invisible forever. Doctor, the surface affordance, and
   the wire all have to name it.
5. **A new test must be shown to fail.** Break the behaviour, watch the
   test go red, restore. A corruption test that passes with the
   handling deleted asserts nothing.
