# Phase Z Batch 2 — STRICT PARITY findings

North-star principle 3: a capability lives in core and **all three**
surfaces (CLI, MCP, web) expose it — or it is not done. This review
enumerated the mutating/query exports of `packages/core/src/index.ts`
and grepped each against CLI (`apps/cli/src/commands/`), MCP
(`apps/mcp/src/tools/`), and web (`apps/web/src/server/server.ts` +
client). Read-only; no source/test edits.

Method note: grep was by core-symbol AND by surface route/flag/tool
name, because a surface can reach a capability through a different core
function (e.g. web reaches milestone-archive via `deleteMilestone(hard:false)`,
not `archiveMilestone`). Every gap below was confirmed by checking the
surface cannot reach the capability by any route, not merely that the
one symbol was absent.

Known documented exceptions treated as NOT findings: UI-only
cropper/profile-pictures (K18); CLI/MCP-only `--json` per-command output.

---

## Summary

**4 findings.** 1 major (contradicts a recorded decision), 3
major/minor capability gaps. Plus a documented-exceptions list and the
verified-clean grid.

| # | Capability | CLI | MCP | web | Severity | Kind |
|---|---|---|---|---|---|---|
| F1 | **Sprint progress** (`sprintProgress[Detailed]`) | ✗ | ✗ | ✓ | **major** | missing-caller (2 surfaces) |
| F2 | **View management** create/edit/delete/archive/unarchive (`createView`/`editView`/`deleteView`/`archiveView`/`unarchiveView`) | ✗ | ✗ | ✓ | **major** | missing-caller (2 surfaces) |
| F3 | **Backup / restore** (`exportBackup`/`restoreBackup`) | ✓ | ✓ | ✗ | major | missing-caller (web) |
| F4 | **Task CSV/JSON export** (`exportTasksToCSV`/`exportTasksToJSON`/`filterForExport`) | ✗ | ✗ | ✓ | minor | missing-caller (2 surfaces); K4-adjacent |

---

## F1 — Sprint progress is web-only (contradicts a recorded decision) — MAJOR

**Core capability:** `sprintProgress`, `sprintProgressDetailed`
(`packages/core/src/task/index.ts`, exported at `index.ts:427-433`).
The milestone twin (`milestoneProgress[Detailed]`) is on all three
surfaces; the sprint twin is on one.

**Evidence — web has it:**
- `apps/web/src/server/server.ts:1927` — `withProgress(...)` calls
  `sprintProgressDetailed(locttDir, ids, workflow)` for `field === "sprint"`.
- `:1948` — `handleListSprints` threads `?progress=true` through it.
- `grep -c "sprintProgressDetailed\|progress" server.ts` → 10 hits.

**Evidence — CLI does NOT:**
- `grep -c "progress" apps/cli/src/commands/sprint.ts` → **0**.
- `ACCEPTED_FLAGS` in `sprint.ts:34` = `["--all","--end","--force","--format","--goal","--ids","--name","--remap-to","--start","--state","--yes"]` — **no `--progress`** (the milestone command at `milestone.ts:33` has `--progress`).
- `case "list"` (`sprint.ts:41-53`) prints name/state/dates/goal only.
- `docs/user/cli/reference.md:331` documents `milestone list [...] [--progress]`; there is no sprint equivalent.

**Evidence — MCP does NOT:**
- `apps/mcp/src/tools/sprint.ts` `list_sprints` (line 28) has
  `inputSchema: {}` and returns `loadSprintsConfig(locttDir)` raw — no
  `progress` arg. `grep "sprintProgress\|progress"` on that file → **0 hits**
  (contrast `list_milestones` in `milestone.ts:38` which has
  `progress: z.boolean().optional()` and calls `milestoneProgressDetailed`).

**Why it is a real user capability, not an internal helper:** it is the
same feature as milestone progress — "how far along is this
sprint/milestone" — already exposed as a first-class flag/arg/param on
the milestone side of all three surfaces.

**Why this is the sharpest finding:** `docs/dev/decisions.md` (the K28
progress entry, ~line 8434) states the aggregate progress work was
"**Threaded to all three surfaces**". It then lists the CLI and MCP
proofs for **milestones only** (`milestone list --progress`,
`list_milestones` returns `unreadable`). `sprintProgressDetailed` was
added to core and wired to web `GET /api/sprints?progress=true`, but the
CLI flag and MCP arg for sprints were never added. The decision's own
claim of three-surface parity is false for sprints.

**Kind:** missing-caller (CLI + MCP). **Fix shape:** add `--progress` to
`loctt sprint list` (mirror `milestone.ts`) and a `progress` arg to MCP
`list_sprints` (mirror `list_milestones`); both call the existing
`sprintProgressDetailed`.

---

## F2 — Saved-view management is web-only — MAJOR

**Core capability:** `createView`, `editView`, `deleteView`,
`archiveView`, `unarchiveView`, `findView`
(`packages/core/src/views/manage.ts`, exported at `index.ts:483-491`).

**Evidence — web has the full set:**
- `apps/web/src/server/server.ts`: `handleCreateView` (`:1381` → `createView`),
  `handleUpdateView` (PUT → `editView`, `:1405`), `handleDeleteView`
  (`:1420` → `deleteView`, `?soft=true` archives), `handleUnarchiveView`
  (`:1448` → `unarchiveView`). Routes at `:4664-4667`.

**Evidence — CLI is read-only:**
- `apps/cli/src/commands/views.ts` is 38 lines: `ACCEPTED_FLAGS = []`,
  lists `queriesConfig.queries` and broken entries, nothing else. No
  `case`/subcommand dispatch, no `createView`/`editView`/`deleteView`/
  `archiveView`/`unarchiveView` import.
- `grep -rl "saveQueriesConfig\|createView\|editView\|deleteView\|archiveView" apps/cli/src` → **nothing** (excluding tests).

**Evidence — MCP is read-only:**
- `apps/mcp/src/tools/views.ts` exposes only `list_views` (line 20).
  The file also defines `get_workflow_config` and `get_calendar` — all
  reads. No create/edit/delete/archive view tool.

**Why a real user capability:** saved views are a first-class,
user-authored, git-committed artifact (`queries.yaml`). Web users can
create/rename/archive/delete them; a CLI-first or agent-driven user
cannot create or modify one at all — they can only *run* and *list*
existing ones. This is exactly the `unarchiveView` class the review
targets, one layer up: the whole view-write surface exists in core and
reaches only one of three surfaces.

**Kind:** missing-caller (CLI + MCP). Not documented anywhere in
`decisions.md`/`known-gaps.md` as an intentional web-only capability.
**Fix shape:** `loctt views create|edit|archive|unarchive|delete` and MCP
`create_view`/`edit_view`/`archive_view`/`unarchive_view`/`delete_view`
tools over the existing core functions.

*(Sub-note: `unarchiveView` itself, the CLAUDE.md exemplar, is no longer
dead — `server.ts:1448-1451` calls it, and `sprints/columns.ts:18`
references the pattern. So the original zero-caller defect is fixed; the
parity problem is now that the write side lives only on web.)*

---

## F3 — Backup / restore has no web surface — MAJOR

**Core capability:** `exportBackup`, `restoreBackup`, `readBackupHeader`,
`resolveBackupSet` (`packages/core/src/backup/`, exported at
`index.ts:14-24`).

**Evidence — CLI has it:** `apps/cli/src/commands/backup.ts` — `backup`
(`:50` → `exportBackup`) and `restore` commands; dispatched in
`index.ts:99-100` (`backup`, `restore`).

**Evidence — MCP has it:** `apps/mcp/src/tools/backup.ts` exists and
imports the backup core.

**Evidence — web does NOT:**
- `grep "exportBackup\|restoreBackup\|/api/backup\|/api/restore" apps/web/src/server/server.ts` → **nothing**.

**Why a real user capability:** the JSONL backup is the *actual* backup
of the tracker (K4 explicitly contrasts it with the lossy CSV report —
`decisions.md:2015`, "JSONL is the backup"). A web-only user has no way
to take or restore the canonical backup.

**Severity — major not blocker:** the capability is fully reachable on
two surfaces, and a web user could drop to the CLI; but it is a
first-class data-safety capability entirely absent from a surface, and
no decision records the omission as intentional. Worth a ruling: is
web-omission deliberate (backup is an operator/CLI concern) or an
oversight? If deliberate, record it in `decisions.md`; that is the exact
gap this review exists to force.

**Kind:** missing-caller (web).

---

## F4 — Task CSV/JSON export is web-only — MINOR (K4-adjacent)

**Core capability:** `exportTasksToCSV`, `exportTasksToJSON`,
`filterForExport`, `DEFAULT_EXPORT_COLUMNS`
(`packages/core/src/task/index.ts`, exported at `index.ts:417-422`).

**Evidence — web has it:** `handleExportTasks`
(`apps/web/src/server/server.ts:3531`) → `exportTasksToJSON` (`:3601`)
/ `exportTasksToCSV` (`:3609`, `Content-Type: text/csv`); route
`GET /api/tasks/export` (`:4691`).

**Evidence — CLI/MCP do NOT:**
- `grep -rl "exportTasksToCSV\|exportTasksToJSON\|filterForExport\|DEFAULT_EXPORT_COLUMNS" apps/cli/src apps/mcp/src` → **nothing** (excluding tests).
- No `export` command in the CLI dispatch table (`index.ts`), no MCP export tool.

**Why classified MINOR / borderline:** `decisions.md:2015` (K4) frames
the CSV as "a report for a human in a spreadsheet" — which reads as a
UI-facing feature. But K4 settles *CSV-vs-JSONL semantics and which
columns*, **not** surface exclusivity; it never says "web-only, not
CLI/MCP". The CLI `--json` documented exception covers *per-command*
JSON output, not this dedicated bulk CSV/JSON export. So the asymmetry
is real but plausibly the intended shape.

**Recommendation:** either (a) extend K4 (or a new decision) to state
explicitly that bulk task export is a UI report and CLI/MCP are not
expected to carry it — closing this as a documented exception — or (b)
add `loctt export`/MCP `export_tasks` over `filterForExport` +
`exportTasksToCSV/JSON`. Right now it is an undocumented one-surface
capability.

**Kind:** missing-caller (CLI + MCP).

---

## Verified clean — checked and NOT a parity gap

These were suspected but shown to be reachable on all surfaces, an
internal helper legitimately core-internal, or a documented exception.

| Capability | Finding | Why not a gap |
|---|---|---|
| `unarchiveView` (CLAUDE.md exemplar) | reachable | Now called by web `server.ts:1451`; the original zero-caller defect is fixed (the write-side parity issue is captured as F2). |
| `checkDataIntegrity`, `blockingFindings` | internal | Called only inside `diagnostics/doctor.ts:551` and `git/publish-sync.ts`; reach every surface transitively via `runDoctor` (CLI `doctor`, MCP `tracker`, web `DiagnosticsPanel`/route) and publish/sync. Legitimately core-internal. |
| `runDoctor` / doctor + config-broken reporting | all three | CLI `doctor.ts`, MCP `tools/tracker.ts`, web `server.ts` route + `client/settings/DiagnosticsPanel.tsx`. |
| `getTrackerInfo` | all three | CLI `info.ts`, MCP `tracker.ts`, web `server.ts`. |
| `GitSyncFirstError` (Phase-Z G1) | all three | MCP explicit `tools/git.ts:96`; web explicit `server.ts:498`; CLI handles it via the top-level handler (`index.ts:175-183` prints `err.message`, which is the full "run `loctt git sync` first" guidance, with `EXIT.RUNTIME`). CLI is generic-path vs MCP/web explicit-branch, but the user-facing outcome (clean message + non-zero exit) matches. |
| K28 milestone progress `unreadable` | all three | CLI `milestone list --progress` (stderr warn, `milestone.ts:59-63`), MCP `list_milestones` `unreadable` (`milestone.ts:55`), web `?progress=true` (`server.ts:1936-1940`). *(The sprint twin is the F1 gap.)* |
| Reconcile apply/abandon | documented | MCP intentionally exposes only `get_reconcile_status` + reconcile-needed reporting; CLI `git reconcile <status\|apply\|abandon>` and web routes carry apply/abandon. Recorded in `decisions.md:7491-7501` §4 "Surfaces". Not a finding. |
| Milestone archive/unarchive | reachable | Web reaches archive via `DELETE ?soft=true` → `deleteMilestone(hard:false)` (`server.ts:2098`) and unarchive via `PUT {archived:false}` → `editMilestone` (`handleUpdateMilestone`). Different shape from CLI/MCP but reachable. |
| `loadListViewConfig`/`saveListViewConfig` | UI-only | List-column layout is per-UI presentation state (analogous to K18), web-only by nature. |
| `getConfigValue` (web=0) | reachable | Web reads config via `GET /api/config` (`handleConfig`, route `:4625`), not the single-key core fn. Config get/set/unset otherwise on all three. |
| Bulk archive/delete/link (`bulkArchive`/`bulkDelete`/`bulkLink`) | reachable | Web uses the bulk core fns directly; CLI/MCP achieve the same user operations by looping single ops (`archiveTask`/`deleteTask`/`linkTask`) — same capability, different implementation. The genuinely shared bulk fns (`bulkSetFields`, `bulkMoveTasksToProject`) are on all three. Not a capability gap. |
| enable/disable git, publish, sync, migrate, plan-migrate, duplicate, attach/detach, move-to-project, board-move, reorder (board + relationship), comments (list/post/edit/delete), users (create/switch/archive/unarchive), projects (prefix/archive/default), labels (create/edit/delete/archive/unarchive), calendar, burndown | all three | Confirmed present on CLI, MCP, and web. |
