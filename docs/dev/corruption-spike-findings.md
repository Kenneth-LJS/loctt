# Phase-7 corruption spike — findings

The spike built ONE cell end to end: a task with a **wrong-typed
`due_date`** (a bare number where a `YYYY-MM-DD`/ISO string is required),
editing `status`. Core → lookup → web GET → repair, plus the CLI/MCP
surfaces inherit the core primitives. This is the concrete artifact the
Phase-7 framework proposal reviews. It is deliberately narrow — one field
(`due_date`), one corruption kind (wrong-typed known optional field),
field-local severity — so the framework decides the general shape rather
than the spike presuming it.

## What was built

- `contracts`: `FieldCorruption { field, raw, error }` (mirrors VUE-22's
  `BrokenSavedQuery`); `Task.corruptions?`; `TaskResponse.corruptions?`.
- `core/task/frontmatter.ts`: `parseFrontmatterTolerant` — strict parse
  first (clean tasks cost nothing); on a violation, degrade **only** when
  every issue is a wrong-typed value on a field in
  `SPIKE_DEGRADABLE_FIELDS` (= `{ due_date }`); lift those fields out,
  parse the rest, re-attach the raw values, record corruptions. Anything
  else — a required field, a structural field, a mix with a
  non-degradable field, or a YAML syntax error — still throws, identical
  to `parseFrontmatter`.
- `core/task/io.ts`: `readTaskTolerant`, `writeTaskTolerant` (validates
  the serialized result through the tolerant parser, so a preserved
  corrupt value round-trips but an object-fatal write is still refused),
  and `bodyToken` switched to the tolerant parse.
- `core/task/lookup.ts`: `lookupTaskTolerant` (+ `resolveRefToId`, which
  turns a ref into an id without fully parsing the task).
- `web`: `GET /api/tasks/:ref` falls back to the tolerant read **only**
  when the strict read throws `UnreadableTaskError` AND the tolerant read
  succeeds; otherwise the original well-attributed error is preserved.
  The corrupt fields are stripped before the public projection (which
  re-parses) and reported in `corruptions`.
- Tests: `core/task/corruption-spike.test.ts` (7, mutation-verified),
  `web/server.corruption-spike.test.ts` (2).

## Findings for the framework proposal

1. **Strict frontmatter parsing is embedded at (at least) four
   independent points on ONE read path**: `readTask`/`parseFrontmatter`,
   `rebuildKeyIndex` → `loadAllTasks` (which reads strictly per task),
   `projectTaskFrontmatter` (re-parses for the public projection), and
   `bodyToken` (re-parses for the token). Each threw on the same corrupt
   `due_date`. **The framework's central decision is where the single
   tolerant load primitive lives** so surfaces stop re-validating
   independently — patching four call sites (as the spike did) is not a
   framework, it is four patches.

2. **Corruption breaks key resolution, not just the detail view.** A
   corrupt task drops out of the key index because `rebuildKeyIndex`
   reads strictly, so **by-key lookup 404s** while the file is on disk.
   The spike demonstrates the detail-view fallback **by id** (which
   resolves without the index). The framework must decide whether the
   index/list load is tolerant too — otherwise a corrupt task is
   invisible to every list, filter and by-key link.

3. **The public projection re-parses.** `projectTaskFrontmatter` runs
   `.parse()`, so it cannot carry a raw corrupt value out to a client.
   The spike strips corrupt fields before projecting and reports them
   separately. The framework should decide whether the projection gets a
   tolerant mode, or whether corrupt fields are always surfaced only
   through the `corruptions` channel (never as a frontmatter value).

4. **Object-fatal error quality must be preserved.** The first fallback
   attempt collapsed a well-attributed `UnreadableTaskError` (path +
   parse line + `recovery:none`, TSK-54) into a generic 500 when the
   tolerant read also failed. The fix: recover **only** when the tolerant
   read succeeds; re-throw the original error otherwise. The framework's
   detection/repair rules must keep object-fatal corruption's existing,
   good error surface.

## Open framework questions the spike did not decide (left to the proposal)

- The full **taxonomy** (internal / missing-critical vs optional / extra
  / external) and the full membership of "field-local degradable" — the
  spike hard-coded `{ due_date }`.
- **Detection point** — lazily at read (what the spike does), a
  `doctor`-style scan, or both.
- **Repair provenance** — whether setting-over or removing a corrupt
  field records a distinct history/activity event. The spike's
  override-on-direct-write clears the corruption silently (an ordinary
  edit); the proposal decides if that is right.
- **UI field-meta** — unrecognised → string + X-to-remove; wrong-typed →
  string + X-reverts-to-entry. The spike proved the API carries the
  corruption; the widget itself is framework work.
- **The load abstraction** — the extractable, single load/save the
  finding-1 four-point strictness argues for.

## Reconcile against shipped code (principles 5–7)

The spike confirms shipped read paths are strict-all-or-nothing for a
field-local corruption — i.e. they do NOT yet meet principle 5 ("one bad
field must not blank the whole object") for tasks. The audit (step 4)
classifies every CRUD × corruption-kind cell against the approved
framework and records each gap.
