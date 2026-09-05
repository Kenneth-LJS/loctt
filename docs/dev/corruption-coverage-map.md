# Corruption coverage — UPDATED after the Phase-7B full sweep (2026-09-06)

The full sweep (Ken-requested) is landed. What was "load-safe only" or
"not covered" below is now health-aware or degrades. Current state:

## Objects — ALL config loaders degrade per-entry now
projects, labels, milestones, sprints, calendar(holidays), list-view,
users(profile per-field; settings passthrough preserved), workflow(five
sub-lists) — a corrupt entry becomes a `BrokenEntry`, the rest loads, and
`broken` rides the read endpoints. state.yaml stays object-fatal by
necessity (key-counter integrity) with improved attribution.

## Task surfaces — now health-AWARE (show corruption, not just load it)
- task detail (web/CLI/MCP) + repair: ✅ (Phase 7)
- list: ✅ ⚠/rawText/(broken) cells + untitled→key; per-row health on wire
- board: ✅ inherits list cells + untitled→key
- relationships: ✅ 4 states (healthy/corrupt/corrupt-unreadable/deleted)
- sprints: ✅ broken-config notice; corrupt tasks stay on cards
- timeline: ✅ corrupt-dated distinguished from undated
- activity: ✅ already-correct + coverage; malformed-history IncompleteNotice
- attachments: ✅ orthogonal + REL-49 confirmed
- reconcile: ✅ corrupt side marked ⚠ (not merged as empty)

## Known boundaries (documented, not gaps-in-hiding)
- List rows carry INTRINSIC health only (wrong-typed fields); EXTRINSIC
  (dangling refs / invalid enum) is on the detail view — the list stays a
  cheap corpus scan. See wireHealth() in server.ts.
- Reconcile: the "corruption is the ONLY difference between sides" edge
  (no conflict row forms) is not yet surfaced — a bounded follow-up.
- BrokenEntry has wire + hook types; per-surface RENDERING of config
  `broken` is done for sprints (notice) and consumed where hooks expose it;
  a settings-panel "broken entries" list for labels/milestones/projects is
  a thin follow-up (the data is on the wire).

---

# Corruption framework — what is actually covered (honest map, 2026-09-05)

Written after Ken pushed on thoroughness. The Phase-7 framework covers
**task frontmatter, field-local corruption**, and only some surfaces
*show* it. This maps covered vs. not, grounded in code, so scope is a
decision, not an assumption.

## Corruption KINDS

| Kind | Tasks | Other objects |
|---|---|---|
| wrong-typed known field | ✅ framework (`health`) | ❌ still `Schema.parse` → throws |
| missing required field | ✅ (K26: only `id`/`key` fatal; title/timestamps degrade) | ❌ throws |
| unrecognised/extra key | ✅ (lifted to `health`, "Not recognised") | partial: labels drop bad colours; passthrough elsewhere |
| dangling reference | ✅ extrinsic `classifyTaskHealth` (+ PRU-25) | n/a mostly |
| invalid enum value | ✅ extrinsic (`invalid_value`) | ❌ |
| object-fatal (bad id/key, broken YAML) | ✅ throws `UnreadableTaskError` (attributed) | throws (varies: some named, some bare) |

## Task SURFACES — three tiers

**Tier 1 — health-aware (opens AND shows the corruption):** verified by
direct probe.
- task detail: web `GET /api/tasks/:ref`, CLI `show`, MCP `get_task` ✅
- repair: set-over + unset/X on web, CLI, MCP ✅
- doctor: field-local → non-blocking `malformed` ✅

**Tier 2 — load-safe but NOT health-aware (opens, corruption invisible):**
these go through tolerant `readTask`/`loadAllTasks` so they do not crash,
but they render the corrupt task with the bad field simply absent and no
"needs attention" marker.
- **list** (web/CLI/MCP) — corrupt task appears, no health column. Probed:
  loads, no marker.
- **kanban board** (`board/columns.ts` → `loadAllTasks`) — card renders,
  no marker. Inferred from shared load path; not shown-as-corrupt.
- **sprints** (`sprints/burndown.ts`, `manage.ts` → `loadAllTasks`) — same.
- **timeline**, **milestone progress**, **export**, **counts** — same
  shared path.
- **relationship target** — PROBED: source task opens; a related task
  corrupt in `due_date` resolves fine; corrupt in `title` shows
  `resolvedTitle: undefined` (looks title-less, not corrupt); an
  object-fatal related task shows `missing: true` (looks deleted, not
  broken). No crash, but health is not propagated to the edge.

**Tier 3 — NOT verified:** activity/history feed rendering of a corrupt
task, attachments panel, git reconcile UI showing a corrupt side.

## OTHER OBJECTS — not in the framework at all

Each loads via `<Schema>.parse(raw)` and **throws on any wrong-typed
field**, taking down that whole surface (`config/projects.ts:45`,
`labels.ts:78`, `milestones.ts:41`, `sprints.ts:41`, and users' profile/
settings, workflow.yaml, calendar, list-view.yaml, state.yaml). Existing
*ad-hoc* partial tolerance, NOT the framework:
- saved queries: `BrokenSavedQuery` (VUE-22) — the closest precedent.
- labels: `dropInvalidColors`.
- history: `MalformedHistoryEntry` (skips bad rows).
- ghost project default: K23 (tolerated + drift notice).

A wrong-typed field in `milestones.yaml` / `projects.yaml` / a user's
`profile.yaml` still blanks that surface. The framework's `health`
mechanism was built for tasks only.

## The honest bottom line

**Covered well:** task frontmatter, field-local, on the task-detail
surfaces + repair + doctor — verified by mutation and direct probe.

**Covered as load-safe only (no crash, corruption invisible):** board,
sprints, list, timeline, relationship edges — they inherit tolerant
`readTask` but do not surface `health`.

**Not covered:** every non-task object (projects, labels, milestones,
sprints-config, users, workflow, calendar, views, state) — still
strict-parse-throws, with only the pre-existing ad-hoc exceptions.

This is one corruption *kind* (field-local task frontmatter) generalised
across the task read/write core and shown on the task-detail surfaces —
which is exactly what the brief's spike + first framework scoped. It is
NOT "all corruption kinds on all objects on all surfaces."
