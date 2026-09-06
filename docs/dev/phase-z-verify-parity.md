# Phase Z Batch 2 — adversarial verification of the strict-parity findings

Verifies the four findings in `phase-z-findings-parity.md`. Read-only:
every grep below was re-run against the working tree at `099f0c4`
(2026-09-06); nothing in source, tests, or docs was edited. Where the
report's claim survives, it says CONFIRMED; where the report missed a
caller or a record, it says so — the "REFUTED" search was run in earnest
for each (alternate tool names, shared flags, alternate core routes,
user-doc absence lists).

| # | Verdict | Class | One-line reason |
|---|---|---|---|
| F1 sprint progress | **CONFIRMED** (severity nuance) | **BUG** | No CLI flag, no MCP arg, and — the report missed this — no web *client* consumer either; K28's "all three surfaces" sentence is over-broad, not literally false. Neither CLI nor MCP doc records the absence. |
| F2 view management | **CONFIRMED** asymmetry; **REFUTED** "undocumented" | **NEEDS-RULING** | Write side is web-only; but both user references already say so under "Not on this surface" (agent-recorded 2026-08-16, never put to Ken). |
| F3 backup/restore | **CONFIRMED**, plus a doc defect the report missed | **NEEDS-RULING** | Zero web route/client; no decision records the omission; and `cli/reference.md:1157` says the backup "is on every surface", which is false. |
| F4 CSV/JSON export | **CONFIRMED** asymmetry; **REFUTED** "undocumented" | **NEEDS-RULING** (lean: record as intentional) | Both references list export under "Not on this surface" with a reason, and an integration test pins that text. K4 does not settle surfaces; the doc list does, at agent authority. |

---

## F1 — Sprint progress: CONFIRMED, BUG

### What the surfaces actually have

Callers of the core symbols, non-test, non-dist (`grep -rn "sprintProgress" apps packages`):

```
apps/web/src/server/server.ts:191   sprintProgressDetailed,          (import)
apps/web/src/server/server.ts:1928  : await sprintProgressDetailed(locttDir, ids, workflow);
packages/core/src/index.ts:431-432  sprintProgress, sprintProgressDetailed   (barrel)
packages/core/src/task/progress.ts:118,148                              (definitions)
```

The milestone twin, same grep: web `server.ts:1927`, MCP
`tools/milestone.ts:47`, CLI `commands/milestone.ts:52`. Three surfaces
vs one — the asymmetry is real.

**CLI, adversarial check for a shared flag.** `grep -i progress
apps/cli/src/commands/sprint.ts` exits 1 (zero hits). `ACCEPTED_FLAGS`
at `sprint.ts:34` is `--all --end --force --format --goal --ids --name
--remap-to --start --state --yes`; `--format` there belongs only to
`sprint burndown` (`sprint.ts:181-186`, `table|json`), not to `list`. The
`case "list"` body (`sprint.ts:41-53`) prints name/id/state/dates/goal.
The only `--progress` in the CLI is `milestone.ts:33,43`. `rejectUnknownFlags`
means `loctt sprint list --progress` is a usage error, not a silent no-op.

**MCP, adversarial check for another tool.** Full tool inventory
(`grep -rh 'name: "' apps/mcp/src/tools/*.ts`) contains `list_sprints`,
`create/edit/delete/archive/unarchive_sprint`, `get_sprint_burndown` and
nothing else sprint-shaped. `list_sprints` (`tools/sprint.ts:28-34`) has
`inputSchema: {}` and returns `loadSprintsConfig` raw. The file's `@loctt/core`
import list (`sprint.ts:10-19`) contains no progress symbol. `grep -rin
progress apps/mcp/src` hits only `milestone.ts` and the `in_progress`
field of `git.ts`. `get_sprint_burndown` is a different computation
(per-day remaining series via `readBurndownSeries`), not done/total.

**Web — the report overstated this side.** The API route exists
(`handleListSprints`, `server.ts:1943-1948`, `?progress=true`), but
`grep -rn "progress=true" apps/web/src/client` hits only the milestones
code (`useMilestoneProgress.ts:44`, `MilestonesView.tsx`, `model.ts`,
`ProgressReadout.tsx`). Every client fetch of `/api/sprints` is
`?limit=` (`sidebarData.ts:160`), `?counts=true` (`useDataMutations.ts:60`),
or `/burndown`. `docs/user/ui/features.md:80-84` describes the Sprints
view with no progress bar. So sprint progress is a **web-API-only**
capability with zero UI consumer — effectively one and a half surfaces
short of three, not one.

**User docs.** `cli/reference.md:375` documents `sprint list [--all]
[--ids]`; `mcp/reference.md:721-723` says `list_sprints` takes "No
parameters". Neither "Not on this surface" section
(`cli/reference.md:1151`, `mcp/reference.md:846`) mentions sprint
progress. Per TSK-C7 (`surface-test-cases/flow-tasks.md:140`) an
absence is permitted only when the surface doc states it — this one is
silent, which is the failure mode that case names.

### The K28 contradiction — real but narrower than the report says

`decisions.md:8434-8442` (K28 build status, Part 2):

> Threaded to all three surfaces: web `GET /api/{milestones,sprints}?progress=true`
> carries `unreadable`, CLI `milestone list --progress` warns to stderr,
> MCP `list_milestones` returns `unreadable`.

Read strictly, the sentence claims the *unreadable-reporting* reached
each surface through whatever progress route that surface had, and the
proofs it lists are accurate: sprints appear only under web. It does not
assert `sprint list --progress` or a `list_sprints` progress arg exists.
So "the decision's own claim of three-surface parity is false for
sprints" is an over-reading; "the sentence lets a reader believe sprint
progress is on three surfaces when it is on one" is the fair charge.

The gap also predates K28. `git log -S sprintProgress`:

- `1f1bf22` (2026-08-15, "feat(progress): milestone and sprint progress
  (item 11)") added `sprintProgress` to core and `withProgress(...,
  "sprint", ...)` to `server.ts`, touched `apps/cli/src/commands/milestone.ts`
  and `apps/mcp/src/tools/milestone.ts` only, and its message says
  "Opt-in on all three surfaces" — true of milestones, silent about
  sprints. That commit created the asymmetry.
- `a4991c2` (K28) swapped `sprintProgress` → `sprintProgressDetailed` in
  the same web spot and did not widen the surface set.

Both commits and the K28 note share the pattern: the author wrote
"all three surfaces" while looking at the milestone side. K28 is Ken's
ruling ("an agent may not revert this"), so the fix should *append* a
clarifying build-status line, not rewrite his text.

### Fix shape (BUG)

1. `apps/cli/src/commands/sprint.ts`: add `--progress` to `ACCEPTED_FLAGS`;
   in `case "list"`, mirror `milestone.ts:43-63` — call
   `sprintProgressDetailed(locttDir, shown.map(s => s.id), workflow)`,
   print `done/total (n discarded, excluded)` per row, warn `unreadable`
   to stderr. Integration test alongside `tests/integration/cli/milestone-progress.test.ts`,
   shown red by removing the flag.
2. `apps/mcp/src/tools/sprint.ts`: `list_sprints` gains
   `progress: z.boolean().optional()`, mirrors `milestone.ts:38-55`
   (attach `progress` per sprint, return `unreadable`). Description
   updated the same way.
3. Docs: `cli/reference.md:375` → `sprint list [--all] [--ids] [--progress]`
   with a paragraph like `:346`; `mcp/reference.md:721` gains a
   parameter table. `decisions.md` K28 build status: append one line
   under Part 2 noting sprint progress reached CLI/MCP on this date
   (Phase Z F1) — do not edit the existing sentence.
4. Optional, separate: the web client has no sprint-progress consumer.
   That is a UI-scope question (does the Sprints view want a done/total
   readout?), not a parity defect — note it, don't fold it in.

---

## F2 — Saved-view management: asymmetry CONFIRMED, "undocumented" REFUTED, NEEDS-RULING

### Grep

Non-test callers of `createView|editView|deleteView|archiveView|unarchiveView|saveQueriesConfig`
across `apps/`: every hit is under `apps/web/` — server `server.ts:85,94,103,205`
(imports), `:1384` `createView`, `:1405` `editView`, `:1429` `deleteView`
(`hard: !soft` — `?soft=true` is the archive path, so `archiveView` itself
is uncalled but reachable), `:1451` `unarchiveView`; client
`SaveViewDialog.tsx`, `SavedViewsPanel.tsx`, `SidebarPinsPanel.tsx`.

**CLI, adversarial.** `apps/cli/src/commands/views.ts` (38 lines) is
exactly as reported: `ACCEPTED_FLAGS = []`, one code path, lists valid
and `broken` views. Dispatch table `index.ts:94-146` has `views` only —
no `view`, `query`, `queries`, `save-view`. No other command file
imports a view-writing symbol.

**MCP, adversarial.** Tool inventory has `list_views` and nothing else
view-shaped. `sweep_sidebar_pins` (`tools/user.ts:88-89`) *reads*
`queriesConfig.queries` for ids to prune pins; it does not write
`queries.yaml`. `task-crud.ts:151,181` passes `queriesConfig` into
`list_tasks` for `view:` resolution — read-only.

So: a CLI-first or agent-driven user can run and list views, and cannot
create, rename, re-sort, archive, unarchive, or delete one without
hand-editing `queries.yaml`. Asymmetry CONFIRMED.

### What the report missed: the absence *is* documented, and by whom

`docs/user/cli/reference.md:1151-1164` and `docs/user/mcp/reference.md:846-854`
both carry a "Not on this surface — deliberately absent" section:

> **Creating and editing saved views** — web only. `loctt views` lists
> them and `list --view <name>` runs them, so a view saved in the UI is
> usable here; authoring one means editing `queries.yaml` or using the
> web editor.

`git blame`: commit `6be19ce` (2026-08-16, "test: cover PRU-C1 and
QRY-C1"). Its message: "Views are read-only on CLI and MCP: the web
authors them. Recorded in both references under 'Not on this surface',
same as export, so the absence is stated rather than inferred." That is
an **agent** recording a surface exclusion in user docs while writing a
test — not a Ken ruling, and it never went into `decisions.md` § 8 or
§ 9 (`grep -in "not on this surface\|deliberately absent"
docs/dev/decisions.md` → no view/export entry; the only hits are
unrelated A89/A-series prose). The report's "Not documented anywhere in
`decisions.md`/`known-gaps.md`" is literally true and materially
misleading: the exclusion is documented, at the wrong authority level.

### Classification

This is not K18-class. K18 (avatar cropping) is a capability only a
browser *can* perform. Authoring a saved view is `{name, query, sort?,
display?}` → YAML — trivially expressible as `loctt views create <name>
--query "..." [--sort f:asc]` or an MCP `create_view`. The "Which layer"
rule (`TEMP-RUN-WORKFLOW.md:1147-1175`) says a core capability owes a
CLI command and an MCP tool, and "If a surface genuinely should *not*
expose it, say so in the ticket and why. Silence is not a decision." An
agent said so in a user doc with a one-clause reason ("the web authors
them"). That is more than silence and less than a decision.

The strongest argument *for* the exclusion is the one the agent gave:
the UI is the natural authoring surface because a view is built by
filtering the list and pressing Save, and `queries.yaml` is editable
text. The strongest argument *against*: MCP agents are told in
`mcp/reference.md:191-192` "Do not create or overwrite views in response
to a broken entry" — advice that only makes sense if an agent might want
to, and agents building a workflow for a user plausibly do want to save
a view. Also, the write side already exists in core, tested; the CLI/MCP
cost is two thin wrappers each.

**NEEDS-RULING.** Put to Ken as: (a) keep web-only and promote the
existing user-doc text to a `decisions.md` § 9 entry so it stops being an
agent's call; or (b) add `loctt views create|edit|archive|unarchive|delete`
and MCP `create_view|edit_view|archive_view|unarchive_view|delete_view`
over the existing core functions, and delete the two "Not on this
surface" bullets. The doc-line's cost of (a): a headless user must
hand-write ULID ids into `queries.yaml` (the `6be19ce` message itself
notes fixtures were "silently wrong" for exactly that reason).

---

## F3 — Backup/restore has no web surface: CONFIRMED, NEEDS-RULING (with a doc defect)

### Grep

`exportBackup|restoreBackup|readBackupHeader|resolveBackupSet` non-test
callers: `apps/cli/src/commands/backup.ts:5,7,50,106` (dispatched at
`index.ts:99-100` as `backup` / `restore`); `apps/mcp/src/tools/backup.ts:14,15,42,78`
(tools `backup`, `restore`, both in the inventory). **Web:** zero. A
case-insensitive `backup|restore` sweep of `server.ts` hits only
`:1444` (a comment about unarchiving a view) and `:4605`
(`backupPath` in the *migration* response — the `.loctt.backup-v…`
directory copy, a different mechanism). Client hits
(`SchemaBanner.tsx`, `InterruptedMigration.tsx`, `AppBootstrap.tsx`) are
all the migration backup path. No `/api/backup`, `/api/restore`, no
download or upload affordance. CONFIRMED.

### Is the omission recorded anywhere?

- `decisions.md` K4 (`:2015-2045`) ruling 3: "A structured export …
  **is the backup**, and it is **its own ticket after M4**." Surfaces
  unspecified. K17 (`:6191`) scopes what the backup carries. Neither says
  web-only-omitted.
- `known-gaps.md` backup entries (`:2897`, `:2939`) are about dangling
  refs and displaced bodies, not surfaces.
- `docs/dev/ui-test-cases/`: every `backup` hit (`flow-app-shell.md:303`,
  `flow-accessibility.md:386`, `flow-cross-surface.md:289,296`) is the
  migration backup path. No UI case describes taking or restoring the
  JSONL backup. `docs/user/ui/features.md` has no backup section.
- `TEMP-WEB-TICKETS.md`: no ticket owes a web backup.

So the web omission was never decided; the backup ticket (`1d6516a`,
2026-09-02) shipped CLI + MCP and did not say why not web. Under "Which
layer", that is the "silence is not a decision" case.

### Doc defect the report missed

`docs/user/cli/reference.md:1157-1158`, inside "Not on this surface":

> The **backup** is a different thing and is on every surface — see
> `loctt backup` above.

False — it is on two of three. (`mcp/reference.md:850-851` says
"available here", which is true.) Whatever Ken rules, that sentence
needs to change: to "on the CLI and MCP" if web stays out.

### Classification

**NEEDS-RULING**, agreeing with the report's framing. A browser backup is
a materially different UX: `exportBackup` writes size-split JSONL files
to a path and `restoreBackup` takes a file list plus `merge|overwrite|skip`
modes with collision reports — mapping that onto download/upload,
multipart parts, and a confirm flow is real design work, not two
wrappers. It is also the one capability where "drop to the CLI" is a
reasonable answer, because the person restoring a tracker is at a
terminal by definition. The ruling to request: (a) record web-omission as
intentional in `decisions.md` § 9 with the reason (operator concern;
CLI/MCP suffice), fix the "every surface" line, and add a "Not on this
surface" bullet to the *UI* doc so the rule is symmetric; or (b) open a
ticket for `GET /api/backup` (download) at minimum, with restore deferred
or CLI-only. If (b), restore-via-upload deserves its own ruling because
`overwrite` mode can lose work (`mcp/reference.md:830-833`).

---

## F4 — Task CSV/JSON export web-only: CONFIRMED asymmetry, "undocumented" REFUTED, NEEDS-RULING (lean: intentional)

### Grep

`exportTasksToCSV|exportTasksToJSON|filterForExport|DEFAULT_EXPORT_COLUMNS`
non-test callers: `apps/web/src/server/server.ts:105-107` (imports),
`:3578,3601,3609` (`handleExportTasks`); client `list/ExportMenu.tsx`.
CLI dispatch table has no `export`; MCP inventory has no export tool.
CONFIRMED.

### What the report missed

1. **Both references document the absence, with a reason**
   (`cli/reference.md:1155-1158`, `mcp/reference.md:848-851`):
   > **Export (CSV / JSON)** — web only, via the list view's export menu.
   > The CLI's `list --format json` covers scripting; export exists for
   > the spreadsheet round-trip, which is a UI workflow.
   Blame: `0f6168e` (2026-08-16, "docs+test: TSK-C7 — capabilities
   reachable, or documented as absent"). Its message: "Export is the
   real gap — built and wired to the web only … Both references gain a
   'Not on this surface' section naming export … with the reason."
2. **A test pins it.** `tests/integration/cli/task-capability-reach.test.ts:72-85`
   "documents export as absent rather than leaving it unexplained": runs
   `loctt export`, asserts non-zero exit, and asserts both docs match
   `/Not on this surface/` and `/Export/`. Any fix that adds a CLI export
   must edit a green test — which, per the CLAUDE.md rule, means saying
   in the commit that the test was asserting the exclusion.
3. **The governing case permits it.** TSK-C7
   (`surface-test-cases/flow-tasks.md:140-148`, blocker, CLI+MCP) is
   titled "Duplicate, move, bulk, and export are reachable — **or
   documented as absent**". Export was resolved on the "documented as
   absent" branch. So this is the *one* finding of the four where the
   repo's own acceptance criterion explicitly allows the asymmetry.

### Classification

The report is right that K4 settles CSV semantics, not surfaces. But
the surface question was answered — under TSK-C7, by an agent, in the
user docs, with a test. Whether that authority level suffices is the
only open question. Substantively the exclusion holds up: `loctt list
--format json` and MCP `list_tasks` already return structured task
data, so the marginal capability is "CSV with name-resolved columns for a
spreadsheet", which K4 itself frames as a human-in-a-spreadsheet report.
The one soft spot in the doc's reasoning is the phrase "spreadsheet
round-trip" — K4 (`decisions.md:2036-2040`) says outright "There is no
CSV import anywhere in the codebase", so there is no round-trip; the
bullet should say "spreadsheet report".

**NEEDS-RULING, lean intentional.** Ask Ken to either bless the existing
"Not on this surface" text as a § 9 decision (and fix "round-trip" →
"report"), or order `loctt export` + MCP `export_tasks`. Do not rank it
above F2: the two are the same shape (agent-recorded surface exclusion
on 2026-08-16, same commit pair), and F4 has the weaker case for
building because the data is already reachable on both surfaces in
structured form.

---

## Cross-cutting observation

F2 and F4 share one root: on 2026-08-16 an agent, working TSK-C7 and
QRY-C1, recorded two surface exclusions in *user* docs under "Not on this
surface" and never wrote them into `decisions.md`. The "Which layer" rule
(2026-08-29) post-dates that by two weeks and says such a call must be
stated "in the ticket and why". F1 and F3 are the opposite failure: no
one stated anything, and in F1's case two commit/decision texts said
"all three surfaces" while looking at one twin. The single ruling that
would close all four: **any surface exclusion is a § 9 (Ken) or § 8
(agent, with revert path) entry in `decisions.md`, and the user-doc
"Not on this surface" bullet cites it.** Then F1 is a bug to fix, F2/F3/F4
are three yes/no questions for Ken, and the "every surface" line in
`cli/reference.md:1157` gets corrected either way.
