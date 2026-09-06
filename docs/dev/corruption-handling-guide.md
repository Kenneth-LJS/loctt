# Corruption handling — engineering guide

**Durable reference.** When you add a new field, a new config object, or
a new surface, this is the checklist for making it degrade correctly
instead of crashing — and the principles behind why. Unlike the sweep
working docs (`corruption-*-plan.md`, `-audit.md`, `-coverage-map.md`,
`degradation-*.md`), this outlives the sweep and is meant to be read
before you write the code.

Companions:
- `docs/dev/north-star.md` § Operating principles — the *values* (1, 3,
  5, 6, 7 are the corruption-relevant ones). This guide is the *system*
  that makes them repeatable.
- `docs/dev/ui-test-cases/flow-degradation.md` (DEG-) +
  `docs/dev/surface-test-cases/flow-degradation.md` (DEG-C) — the
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
base command mutates nothing. Its **only** write is opt-in:
`--rebuild-index`, which repairs the key-index cache after out-of-band
`key`/`key_history` edits. So: *preview is the default; acting is the
flag.* Exit code is 1 if any check is `error`; warnings exit 0.

Doctor is exempt from the schema boot-guard, so it can report a version
mismatch when every other command refuses to run.

**It covers** (`diagnostics/doctor.ts` + `integrity.ts`):
- config **parse errors** (object-fatal) on every config file → error
- **task field-health** (malformed, non-blocking) + **unreadable
  task.md** (blocks publish)
- **comment** and **history** malformed entries + unreadable files
- **label hex-color** drop (read raw, since the loader drops it)
- **workflow drift** (a task holding a value workflow.yaml no longer
  defines), **dangling task references**, **relationship cycles**,
  **cross-file inverse disagreement** (principle 1 / P-12 consistency)
- **config per-entry `broken` markers** — the A138/K28 degrade for
  projects, labels, milestones, sprints, saved views, list-view chips,
  and workflow sub-lists. `checkDataIntegrity` runs each loader and
  emits a `malformed` finding per degraded entry, naming it by id (or
  position). **When you add a new config object, add its
  `collectConfigBroken(...)` call** — the loop is right there in
  `integrity.ts` and a new config that skips it makes its degrades
  invisible again.
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

---

## 7. The five rules that catch the real bugs

1. **When in doubt, degrade.** Fatal is the rare exception, justified
   only by "operating on it risks worse corruption."
2. **A writer preserves what it did not touch.** The single most-missed
   step (K28). Every write path — task, flat config, keyed config —
   round-trips a corrupt sibling untouched.
3. **Corruption is never *silently* rewritten, but it is not sticky.** A
   validated write to the corrupt field itself repairs it (principle 7).
4. **Report, don't hide.** A preserved broken entry that nothing
   surfaces is invisible forever. Doctor, the surface affordance, and
   the wire all have to name it.
5. **A new test must be shown to fail.** Break the behaviour, watch the
   test go red, restore. A corruption test that passes with the
   handling deleted asserts nothing.
