# TEMP — Core/CLI/MCP changes required to support mockup features

This file captures backend changes implied by the mockup audit and the user's
decisions on 2026-05-11. Delete after each item is either implemented or
filed as a tracked task.

Companion files:
- `temp-ui-mockups/` — mockup HTML being updated to match these decisions
- `TEMP-UI-FEATURE-FLOW.md` — broader UI flow spec
- `~/.claude/plans/tranquil-tinkering-mochi.md` — original audit

## 1. Body editor: lossy-feature serialization [DECIDED]

**Decision.** WYSIWYG editor (TipTap) is the default. Markdown source mode is
the toggle. For features that vanilla CommonMark can't express (subscript,
superscript, KaTeX, footnotes, task lists with checkbox state, etc.), use a
LocTT-internal markdown extension so the file on disk is still readable as
markdown but round-trips losslessly.

### Wire format (proposed)

Stick to GitHub-flavored markdown for everything that's representable. For
the long tail, use a single fenced-block convention rather than HTML tags so
agents reading the file see something obvious:

| Feature | Source representation |
|---|---|
| superscript | `^text^` (Pandoc-style) |
| subscript | `~text~` (Pandoc-style; conflicts with strikethrough `~~` — keep single-tilde for sub) |
| KaTeX inline | `$expr$` |
| KaTeX block | `$$\nexpr\n$$` |
| GFM task list | `- [ ] todo` / `- [x] done` (already standard) |
| Footnotes | `[^1]` references + `[^1]: text` definitions (already standard) |
| Tables | GFM pipe tables |
| Code blocks with language | ` ```ts ` fences |
| Embedded image attachment | `![alt](attachments/<name>)` resolved by `attachments/` directory |
| Strikethrough | `~~text~~` (GFM) |
| Mention | `@user:<uuid>` (LocTT extension; renders display name) |
| Task reference | `T-123` autolinked at render time (no on-disk syntax) |
| Code block w/ line highlight | ` ```ts {3,5-7} ` info-string convention |
| Non-image file embed | `![[attachments/spec.pdf]]` (Obsidian-style, LocTT extension) |

### Attachment embedding flow (Jira-style)

On disk, all embeds reference `attachments/<name>` in the task's folder. The
renderer dispatches by MIME (§12):
- `image/*` → inline `<img>` from `![alt](attachments/x.png)`
- `video/*` → inline `<video>` from `![](attachments/x.mp4)`
- `audio/*` → inline `<audio>` from `![](attachments/x.mp3)`
- everything else → inline file chip from `![[attachments/x.pdf]]` (icon +
  filename + size + download)

Authoring flows:
- **Drag-drop / paste into the editor:** upload via existing
  `POST /api/tasks/:ref/attachments`, wait for response, then insert the
  appropriate markdown at the cursor. Upload failure → insert nothing +
  toast the error.
- **Insert existing attachment:** editor toolbar button opens a picker
  listing the task's existing attachments → pick → inserts the markdown.
- **Attach without embedding:** the existing Attachments panel on task
  detail still accepts uploads independently. No body insertion. Same
  backend endpoint.

### Editor features dropped

- Text color, font size, font family — not representable in markdown, not
  worth a custom syntax.
- Arbitrary HTML — outside the allowlist triggers the lossy-content
  guardrail (forces source mode).

For any token the WYSIWYG editor produces that doesn't have a clean markdown
equivalent (e.g. user pastes arbitrary HTML), the editor refuses to enter
WYSIWYG mode on that body and forces source mode, per the spec's
lossy-content guardrail.

### Backend impact

- **No file-format change.** Bodies stay as plain `.md` text. The parser/
  serializer lives in the frontend (TipTap with marked-md extensions). The
  backend continues to `replace_task_body` / `append_task_body` with raw text.
- Add a doc page: `docs/dev/markdown-extensions.md` listing the conventions
  above so contributors / agents know what to expect.

### Open question (defer; don't invent)

Does autosave on the editor map to one `replace_task_body` per debounce tick,
or do we add an explicit "save draft" buffer? See section 11 below.

## 2. Subtasks panel — REMOVED [DONE — spec-only; no backend change]

Per user: "we don't have parent/child concept, we don't need it. Relationships
already give us this." Mockup task-detail will drop the Subtasks panel; the
Relationships panel becomes a dynamic grouped list keyed by relationship type
declared in `workflow.yaml`. Backend has no change required — this is purely
a UI/mockup correction.

Also: remove the **Parent task** field from `create-task.html` and remove the
`parent ↔ child (structural, locked)` row from `settings.html#relationships`.

## 3. WIP limits on board columns [DECIDED]

### Behavior

Passive indicator only. No enforcement, no modals.
- Column header: `In Progress · 2/3` (neutral) or `In Progress · 5/3` (red) when over.
- Hover tooltip on red badge: "WIP limit is 3 — currently 5 cards."
- Drag-drop into a grouped-status column: first status in the list wins
  silently. To land on a non-first status, edit the card.

**What WIP limits mean (Kanban term).** "Work In Progress" limit: a cap on
how many cards a single column can hold at once. The mockup shows `5 / 3` in
red — 5 cards currently in the column, limit is 3, over budget.

The UI shows it as a passive indicator (red badge); it does not prevent the
user from dropping more cards. It's a flag for the team to notice.

### Where it'd live in core

- `workflow.yaml` gains an optional `boards.columns` block:
  ```yaml
  boards:
    columns:
      - { key: doing, label: "In Progress", statuses: [doing, in_review], wip: 3 }
  ```
- If absent: 1 status = 1 column (today's behavior).
- If present: a column may group multiple statuses, optional `wip` int.
- Backend only needs to read this — no enforcement. UI computes
  `cardCount > wip` and styles accordingly.

### CLI/MCP

No new commands. The block is configured via `workflow.yaml` edits (or a
future Settings panel that calls `PUT /api/workflow`).

### Decision needed

Confirm we want this. If yes: add `boards` to the `WorkflowConfig` zod schema
in `packages/contracts/src/workflow.ts`, plumb through `saveWorkflowConfig`.
The settings panel mockup will assume this exists.

## 4. Dependency arrows on timeline [DECIDED]

### Relationship key immutability

Relationship `key` is immutable after creation, matching status / priority /
type / project / sprint keys. To "rename" a relationship, delete and recreate
(existing remap-on-delete flow handles task rewrites). Verify the workflow
writer enforces this; tighten if not.

### Auto-clear on delete

When the relationship referenced by `timeline.dependency_relationship` is
deleted, `saveWorkflowConfig` clears the field in the same atomic write.
No doctor warning, no error — timeline renders zero arrows until the user
picks a new relationship in Settings.

The same auto-clear pattern applies to filter-chip references (§10) when a
custom field is deleted.

**What it means.** On a Gantt-style timeline, when task A blocks task B
(or "is precondition for"), a thin SVG arrow draws from A's right edge to
B's left edge. Visualizes the chain of dependencies so you can see at a
glance which late task is breaking which downstream task.

### Why a config option

Relationship types are user-defined in `workflow.yaml`. One workspace might
use `blocks`/`is_blocked_by`, another might use `dependsOn`/`required_by`,
another might not have any precedence relationship. The timeline needs to
know which relationship type to render as arrows.

### Where it'd live in core

- `workflow.yaml` gains `timeline.dependency_relationship: <key>`:
  ```yaml
  timeline:
    dependency_relationship: blocks   # or null/absent for no arrows
  ```
- If absent and the workflow has a `blocks` relationship, default to that.
- If neither: timeline shows no arrows.

### CLI/MCP

No new commands. Configured via `workflow.yaml`. The UI reads it from
`get_config` / `GET /api/workflow`.

### Decision needed

Same as section 3 — confirm and we'll add the `timeline` block to the
workflow contract.

## 5. Visible fields per task type — REMOVED [DONE — spec-only; no backend change]

Per user: "we don't have varied task types." Drop `visible_fields` from the
Task types settings panel and from the spec. No backend change needed (it
was never implemented in the schema). The `TEMP-UI-FEATURE-FLOW.md`
"Visible fields per task type" section should also be removed when that
file is cleaned up later.

## 6. Icons on statuses / priorities / task types [DECIDED — Lucide]

Per user: "we want icons too, allowing either icons from a set (we can
import a library) as well as let the user type an emoji for the icon."

### Contract additions

In `packages/contracts/src/workflow.ts`, extend statuses, priorities, task
types (and relationship types — see mockup) with optional fields:

```ts
icon?: string;   // Either a Lucide icon name ("circle", "check") or an emoji ("🚀")
color?: string;  // Hex string, e.g. "#1E6FCB"
```

Backend treats both as opaque metadata — no validation beyond "is string".
UI side discriminates: if the value matches a known Lucide name, render the
icon; otherwise render as text (emoji fallback works because emoji are
strings).

For labels: `color` is already supported. Add `icon` for symmetry (optional).

### Library choice (frontend)

Use **Lucide** (already widely used in shadcn ecosystem, MIT licensed,
~1.5k icons). Bundle the subset of icon names we expose in the picker as a
const list so the UI doesn't need to scrape Lucide's catalog at runtime.

### Migration

None needed — both fields are optional, existing data still validates.

### CLI/MCP

`loctt config workflow` edits go through `saveWorkflowConfig`, which already
passes through unknown keys. Just expose `icon` and `color` in any
status/priority/type editor flow on the UI. No new CLI command.

## 7. Bulk-edit operations on list

Per user: "sure we need this."

### Backend approach

**Don't add batch endpoints.** Keep it as a UI-driven loop over per-task
calls. Reasons: each individual operation already has full validation and
history-entry generation; a batch endpoint would either duplicate that
logic or transactionally rewrite N files (which is hard to make atomic
without inventing a unit-of-work layer).

What the UI needs from the backend (all of these already exist):

- `POST /api/tasks/:ref/set` — used for bulk-set
- `POST /api/tasks/:ref/unset` — used for bulk-clear
- For multi-value (labels, multi-select custom fields): the UI computes the
  new array client-side and sends `set` with the full value. Three modes
  (add / replace / remove) are pure UI concerns.
- `POST /api/tasks/:ref/link` — used for bulk-link
- `POST /api/tasks/:ref/archive` / `unarchive` — used for bulk archive
- `DELETE /api/tasks/:ref` — used for bulk delete

### UI semantics to land in the mockup

- Selection model: checkboxes on each row + "select all on page" in header.
- Action bar: appears at the bottom (sticky) when ≥1 row is selected. Shows
  count + buttons for each bulk action.
- Per-action confirm dialog with progress (e.g. "Updating 12 of 47 tasks…").
- Partial-failure UX: list which keys failed and why; offer "retry failed".
- **Not supported in bulk:** title, body, completed_date (auto), rank fields.

### CLI/MCP

No additions. CLI/MCP users already loop. (Could add a future
`loctt bulk-set <query> <field> <value>` convenience, but defer.)

## 8. User preferences: theme, date format, default view, default sort, card layout

Per user: "let's support this."

### Storage

These live in the existing per-user `settings.yaml`:
`.loctt/users/<id>/settings.yaml` (already gitignored, already readable +
writable via `GET/PUT /api/user-settings`).

### Contract additions

In `packages/contracts/src/users.ts`, extend `UserSettings`:

```ts
theme?: "light" | "dark" | "system";
date_format?: "iso" | "us" | "eu";          // YYYY-MM-DD / MM-DD-YYYY / DD-MM-YYYY
default_view?: "list" | "board" | "timeline";
default_sort?: { field: string; direction: "asc" | "desc" };
card_layout?: {
  show_priority?: boolean;
  show_assignee?: boolean;
  show_labels?: boolean;
  show_type?: boolean;
  show_due_date?: boolean;
  show_estimate?: boolean;
  show_milestone?: boolean;
  show_relationship_count?: boolean;
};
sidebar_pins?: string[];   // ordered list of saved-view IDs / built-in filter IDs
default_project?: string;  // per-user default project key (overrides workspace default)
```

All optional. Backend treats this as a typed bag — `loadUserSettings` /
`saveUserSettings` round-trip the whole object atomically.

### Migration

None (additive optional fields).

### CLI/MCP

Not exposed via CLI — these are UI prefs. Already accessible via
`GET/PUT /api/user-settings` for the UI.

## 9. Sprint — follow backend (not custom field) [DONE — backend complete]

Per user. Mockup will be updated to:

- Remove "Sprint" from the Custom Fields settings panel
- Add a dedicated Sprints settings panel with CRUD: key, label, start_date,
  end_date, state (active/completed/future), goal, archived flag
- Update create-task.html to use a real Sprint picker (not a custom-field
  dropdown)
- Update task-detail.html sidebar to show Sprint with link to the sprint
  view (future)

### Backend status

Already complete. `sprints.yaml`, CLI `loctt sprint …`, MCP `sprint_*`,
HTTP `/api/sprints` all exist. No change needed.

### Future: sprint burndown view

Spec calls for a burndown chart. Mark as out of scope for the mockup round;
add a placeholder section in the Sprints panel saying "Burndown — to come".

## 10. Filter chips — match the core query DSL [DECIDED — layered config]

### Two surfaces

1. **Settings → List View panel** (workspace-level admin). Checkboxes for
   every built-in field + every declared custom field. Toggles write to
   `.loctt/config/list-view.yaml`.
2. **Per-user override on the list page**. The "+ Filter" chip-bar popover
   shows the same list with the workspace default as baseline; user toggles
   write to `users/<id>/settings.yaml#list_view.filter_chips`.

### New file: `list-view.yaml`

```yaml
filters:
  visible: [status, priority, assignee, labels, milestone, severity]
  hidden:  []
```

If `visible` is absent → show everything by default. `hidden` always takes
precedence over `visible`.

### User-level shape (in `users/<id>/settings.yaml`)

```yaml
list_view:
  filter_chips:
    show: [reporter, custom_field_team]
    hide: [type]
```

### Resolution order (highest precedence first)

1. User `hide` → hidden
2. User `show` → shown
3. Workspace `hidden` → hidden
4. Workspace `visible` (if set) → shown if listed, else hidden
5. Default → all built-ins + all custom fields shown

### Cleanup on delete

When a custom field is deleted, the workflow writer also prunes any matching
entries in `list-view.yaml#filters.visible/hidden` (atomic, same write). User
settings are NOT touched server-side — stale refs are harmless and pruned
lazily by the UI on next load.

Per user: "match the core."

Mockup list view will expand filter chips from
`Status / Priority / Type / Assignee / Label / Milestone`
to also include:
- `Project`
- `Sprint`
- `Reporter`
- `Has` / `Has no` (for required/optional fields)
- Custom fields (declared in workflow.yaml under `custom_fields`)
- `Archived` toggle (already present)

Backend already supports all of these via the query DSL. The UI just builds
a query string from the chip selections and calls `GET /api/tasks?query=…`.

## 11. Body autosave — DROPPED, explicit Save button instead [DECIDED]

No autosave. Editor has an explicit Save button. One click → one
`POST /api/tasks/:ref/body` → one `body_edited` history entry. No coalescing,
no debounce, no window question.

UX:
- Standard "unsaved changes" indicator while typing.
- Warn-on-navigate-away when there are unsaved changes.
- Ctrl/Cmd+S keyboard shortcut as a save accelerator.

No backend change needed — `appendHistory` semantics are already correct
for explicit saves.

### Original autosave proposal (kept for reference)



Per user: "on autosave, we update on the backend?"

**Decision.** Yes. The editor debounces typing (~1s of idle) and on tick
sends `POST /api/tasks/:ref/body` with the full markdown. Same on
focusOut / page-nav-away. Save indicator UX:

- After a keystroke: dot → "Unsaved".
- After successful save: checkmark → "Saved · just now".
- On network error: red dot → "Save failed — retry". Surface retry inline.

The backend writes one history entry per `body_edited` call. For chatty
typing this means many entries; backend should **coalesce** consecutive
`body_edited` entries within a short window (~5 min) into a single entry
per session. Currently `appendHistory` writes every call.

### Backend change

In `packages/core/src/task/io.ts`, `writeTaskBody` should coalesce: when
the most recent history entry is `body_edited` by the same user within the
last N minutes (config: maybe 5), update its `timestamp` rather than
appending a new entry. Field `before`/`after` are not stored for bodies
(we don't diff bodies; would be too noisy) — only the timestamp is updated.

### Open question (defer; don't invent)

Coalesce window length — 5 min? 30 min? Per-session?

## 12. Attachments — return mimetype [DECIDED — filename-extension table only]

Per user: "can backend also return some sort of mimetype?"

### Contract change

In `packages/contracts/src/task.ts`, attachment shape:

```ts
// Before
{ name: string; size: number }
// After
{ name: string; size: number; mime?: string }
```

### Backend change

- In `packages/core/src/task/attachments.ts`, when listing attachments,
  detect MIME via filename extension. Use a small built-in table (no
  external dep needed for common types) or `node:mime` if added; defer to
  filename-only detection in v1 — no need to read file bytes.
- `GET /api/tasks/:ref/attachments/:name` already serves with
  Content-Type; ensure that header is also derived from extension.
- Add `mime` field in the response shape from `get_task` and
  `attach_file`.

### Migration

None. New optional field.

### CLI/MCP

`get_task` MCP tool already returns `attachments: [{name, size}]`. Add
`mime?: string` to the same array. No new tool needed.

### UI semantics (for the mockup)

Render thumbnails by MIME group:
- `image/*` → render `<img>` from the attachment URL
- `video/*` → render `<video>` poster or first-frame placeholder
- `application/pdf` → PDF icon
- `audio/*` → music icon
- everything else → generic file icon

The mockup will update the attach-thumb grid to demonstrate each case.

## 13. board_rerank — expose via CLI and MCP [PARTIAL — core + HTTP done; CLI + MCP still pending]

Per user. Currently exposed only over HTTP. Spec earlier said hide it; user
overrides — expose it everywhere for symmetry with relationship rerank.

### CLI

```
loctt board-rerank <task> [--before <task> | --after <task>]
```

`--before` and `--after` are mutually exclusive. Without either, the task is
moved to the end of its column. Add to:
- `apps/cli/src/index.ts` — new case `"board-rerank"` mirroring the existing
  `"rerank"` case for relationships
- `docs/cli-reference.md` — new section under `Relationships and Ranks`

### MCP

New tool `reorder_board`:

```ts
{
  ref: z.string().describe("Task key or ID"),
  before: z.string().optional().describe("Task to position before"),
  after: z.string().optional().describe("Task to position after"),
}
```

Same mutual-exclusion rule as `reorder_relationship`. Returns the new ordering
of the affected column as JSON (analogous to `reorder_relationship`).

Add to:
- `apps/mcp/src/index.ts` — tool registration + handler that calls
  `reorderBoardRank` (already exists in core)
- `docs/mcp-reference.md` — new section under "Relationships and Ranks"

### Core

`reorderBoardRank` already exists in `packages/core/src/rank/`. No core
change.

## 14. Init wizard — add UI surface [DECIDED — no presets, smart defaults only]

Presets dropped. The init wizard uses today's `loctt init` output as the
single smart default for `workflow.yaml`. No `workflow_preset` flag, no
presets directory, no migration.

UI fields for the wizard:
- Starting project key + prefix (defaults: `tasks` / `T-`)
- Skip starter docs (checkbox; equivalent to `--no-docs`)

### Backend change

None — `initLoctt()` already accepts these. No `--workflow-preset` flag
to add.

The CLI `loctt init` already exists. Mockup will add an `init.html` page
covering:

- Empty-state when `.loctt/` doesn't exist (the "you have no tracker"
  landing)
- Required fields per spec: starting project key + prefix; skip starter
  docs (checkbox); workflow preset dropdown (Default / Minimal / Agile)
- Submit → POST /api/init → reload into list view

### Backend change

`POST /api/init` already exists. Verify it accepts a `workflow_preset`
parameter — if not, add it. Today's `initLoctt(options)` takes prefix,
project key, project label, and a docs toggle. Add an optional
`workflow_preset: "default" | "minimal" | "agile"` and ship preset
workflow files under `packages/core/src/init/presets/`.

### CLI

Add `--workflow-preset <name>` flag to `loctt init`.

## 15. Doctor — add Settings panel [DONE — backend complete; UI-only work remains]

`loctt doctor` already exists CLI+MCP+HTTP. Mockup will surface it under
Settings → Doctor as a panel that fetches `GET /api/doctor` and renders the
checks with their pass/warn/fail state. "Re-run" button hits the endpoint
again.

No backend change.

## 16. Sync (git) — add Settings panel [DONE — backend complete; UI-only work remains]

`loctt git enable/disable/status/publish/sync` already exists. Mockup adds
Settings → Sync covering:
- Enable / disable toggle (with confirm dialog per spec)
- Configured branch + remote (display + edit via config endpoints)
- auto_push / auto_fetch toggles
- Last synced commit display
- Publish / Sync action buttons
- Status line ("up to date", "X local changes", "behind remote")

No backend change required beyond what already exists.

## 17. Saved views CRUD — add Settings panel [DONE — backend complete; UI-only work remains]

`/api/views` GET/POST/PUT/DELETE already exists. Mockup adds Settings →
Saved Views panel showing the existing views with edit/delete and a
"+ Create view" form. The view editor lets the user type a query DSL
string and pick a sort.

No backend change.

## 18. Projects management panel + project picker [DONE — backend complete; UI-only work remains]

Backend already complete. Mockup will:
- Add Settings → Projects panel (CRUD on `projects.yaml`)
- Add Projects section to the left sidebar (one entry per project,
  click-to-filter)
- Add Project picker to create-task modal
- Add Project filter chip to list filter bar
- Add project key prefix to task keys consistently in sample data
- Add project info to sidebar footer (workspace default, next key)

No backend change.

## 19. Users management + switcher + reporter [DONE — backend complete; UI-only work remains]

Backend already complete. Mockup will:
- Replace the static `T` brand mark with an avatar-menu component in the
  header (current user's avatar, click → switcher menu with Switch user,
  Settings → Users link, etc.)
- Add Settings → Users panel (list, create, edit, archive, delete with remap)
- Add Reporter field to create-task modal (defaults to current user)
- Show Reporter on task detail (already shown; make it editable / picker)

No backend change.

## 20. My Preferences panel [PARTIAL — settings.yaml read/write done; typed UserSettings schema still pending (see §8)]

## 21. Estimation weights for enum units [DECIDED — optional weights map]

For burndown to work on `custom_enum` estimation (e.g. T-shirt sizes), add an
optional `weights` map to `EstimationConfig`:

```yaml
estimation:
  unit: custom_enum
  unit_label: "size"
  preset_values: [XS, S, M, L, XL]
  weights:
    XS: 1
    S:  2
    M:  3
    L:  5
    XL: 8
```

Behavior:
- `weights` absent → burndown Y axis = count of incomplete tasks.
- `weights` present → burndown Y axis = sum of weights of incomplete tasks.
- List-view aggregations stay categorical when weights absent
  ("3 S · 2 M · 1 XL"); show both categorical + total when weights present
  ("3 S · 2 M · 1 XL · total 13").
- Weights are optional, never forced. Numeric units (points/hours/days/
  custom_numeric) ignore the field.

### Contract change

`packages/contracts/src/workflow.ts` — add
`weights?: Record<string, number>` to `EstimationConfigSchema`. Validation:
when present, every key must appear in `preset_values`; every value must
be a finite non-negative number. Only meaningful for `unit: custom_enum`.

## 22. Sprint burndown view [DECIDED]

Dedicated page at `/sprints/:key`. Burndown is the main visual.

### Rendering rules

- X axis: days in sprint window (`start_date` → `end_date` from
  `sprints.yaml`).
- Y axis depends on `workflow.yaml#estimation`:
  - Numeric unit → sum of `estimate` of incomplete tasks.
  - Enum unit with `weights` → sum of weights of incomplete tasks (§21).
  - Enum unit without `weights`, or estimation disabled → count of
    incomplete tasks.
- "Incomplete" = task's status `category` is not `completed` or `discarded`.
- Ideal line: straight diagonal from start total → 0 at end.
- Today marker uses workspace timezone from `calendar.yaml`.
- Weekend / holiday shading from `calendar.yaml`.

### Data source — reconstruct from history

No daily snapshots. The burndown reader walks each task's `history` entries
(status changes, estimate changes, sprint join/leave) and replays them to
compute the remaining total at end-of-day for each day in the sprint window.
History already contains every event needed. Cache the reconstructed series
keyed by sprint id; invalidate on any task write within the sprint window.

### Scope changes shown as steps

When a task is added to or removed from the sprint mid-run, the total line
shows a visible step (up or down). Don't smooth. Hiding scope creep defeats
the chart.

### Backend additions

- `packages/core/src/sprints/burndown.ts` (new): reconstruct-from-history
  reader. Pure function over (sprint, tasks, history) → series.
- `GET /api/sprints/:key/burndown` (new) returning the series.
- No CLI/MCP surface for the chart itself; agents can query the same data
  via `get_sprint` + `get_task` history if needed.

Settings → My Preferences for per-user settings. See section 8 for fields.
Backend exists (`/api/user-settings`).

---

## Summary of files that need edits when this work happens

### Contracts
- `packages/contracts/src/workflow.ts`
  - add `icon`, `color` on `StatusDef`, `PriorityDef`, `TaskTypeDef`,
    `RelationshipDef`, `CustomFieldValueDef`
  - add `boards.columns[]` (key, label, statuses[], wip?)
  - add `timeline.dependency_relationship: string | null`
  - add `estimation.weights?: Record<string, number>` (§21)
  - enforce relationship `key` immutability in the writer (§4)
- `packages/contracts/src/service.ts` — add `mime?: string` to
  `AttachmentResponse`
- `packages/contracts/src/users.ts` (new typed `UserSettings`) — extend with
  `theme`, `date_format`, `default_view`, `default_sort`, `card_layout`,
  `sidebar_pins`, `default_project`, `list_view.filter_chips.{show,hide}`
- `packages/contracts/src/list-view.ts` (new) — `ListViewConfigSchema`
  for the workspace-level `list-view.yaml`

### Core
- `packages/core/src/task/attachments.ts` — derive MIME from extension on
  list/get (filename-extension table; no file sniff)
- `packages/core/src/config/workflow-write.ts` — auto-clear
  `timeline.dependency_relationship` and prune
  `list-view.yaml#filters.visible/hidden` entries when a relationship or
  custom field is deleted (atomic, same write)
- `packages/core/src/config/list-view.ts` (new) — atomic read/write of
  `list-view.yaml`
- `packages/core/src/sprints/burndown.ts` (new) — reconstruct-from-history
  reader returning the burndown series
- `packages/core/src/users/settings.ts` — replace untyped
  `Readonly<Record<string, unknown>>` with the new typed `UserSettings`
  shape

### CLI
- `apps/cli/src/index.ts` — new `board-rerank` command mirroring `rerank`

### MCP
- `apps/mcp/src/index.ts` — new `reorder_board` tool mirroring
  `reorder_relationship`

### HTTP
- `apps/web/src/server.ts`
  - `GET /api/list-view`, `PUT /api/list-view` (workspace list-view config)
  - `GET /api/sprints/:key/burndown` (series)

### Docs
- `docs/user/cli/reference.md` — board-rerank section
- `docs/user/mcp/reference.md` — reorder_board section
- `docs/dev/markdown-extensions.md` (new) — lossy-feature conventions,
  attachment-embedding flow (`![[...]]` for non-image), drag-drop / paste
  behavior, mention + task-reference autolink rules
- `docs/dev/schema-reference.md` — `boards.columns`,
  `timeline.dependency_relationship`, icon+color fields, estimation
  `weights`, `list-view.yaml`

### Open questions

_None at this time._ All decisions resolved 2026-05-11.
