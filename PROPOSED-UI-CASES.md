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

Each item states the finding behind it inline. (The audit document these
were extracted from was deleted once its blockers were fixed; see
`git log` for `FEATURE-AUDIT.md` if the original wording is needed.)

---

## 1. Contradictions to resolve

### SET-3 vs SET-6 — `flow-settings.md`

SET-3 asserts workflow panels are read-only: *"No status is presented as
editable — no inline text inputs, no delete buttons."* SET-6 asserts
drag-reorder persists to `workflow.yaml`, and SET-17/SET-19 assert
in-panel deletion with remap.

Both cannot hold. The API (`PUT /api/workflow`) supports the **editable**
reading, and `workflow-write.ts` (822 lines, full per-collection remap)
was clearly built for it. Recommendation: **drop SET-3**, keep the
editable reading.

### Body save: `markdown-extensions.md` vs TSK-15 — `flow-tasks.md`

`markdown-extensions.md:110-120` mandates explicit-Save and no autosave.
TSK-15 mandates 1.5s idle autosave. The 15-minute `body_edited`
coalescing window in core only makes sense under the autosave reading —
under explicit-Save it silently merges two deliberate saves.

Recommendation: **pick autosave**, and correct `markdown-extensions.md`.
Note this interacts with B5 (no concurrency control): autosave without a
precondition header makes lost updates more likely, not less.

### `?project=web` URLs — `flow-projects-users.md` PRU-2 / PRU-6

The flow doc assumes project slugs in URLs. `ProjectDefSchema` is
`.strict()` with `{id, name, prefix, archived?}` — there is **no** `key`
or slug field, and `state.keys` is indexed by ULID.

Either URLs carry ULIDs (`?project=01KZYW…`, which is ugly but honest and
matches P2), or a slug field is reintroduced to the schema. This is a
product decision that blocks writing the case correctly.

---

## 2. Existing cases that will fail as written

| Case | File | Why it fails today |
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
| **REL-40** | `flow-relationships.md` | The 20-file drop is unimplemented at the API layer: `multipart.ts:69` drains all parts after the first. |
| **SPR-26** | `flow-sprints.md` | Unreachable from the UI: `handleUpdateSprint` has no `archived` field and there is no archive/unarchive route (B17). |
| **MSL-1, MSL-2, and 8 others** | `flow-milestones-labels.md` | Milestone progress does not exist anywhere in `packages` or `apps` (B20). |
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

## Proposed: the threshold in BLK-30's "proportionate" confirmation

**Raised 2026-08-28 while covering BLK-30. Nothing here is decided.**

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

## Proposed: whether CSV export should resolve ULIDs to names

**Raised by the M1 gate 2026-08-28 as F7 (minor). Not built — this
needs a decision, not a patch.**

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
