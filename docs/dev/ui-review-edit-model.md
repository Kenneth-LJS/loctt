# Web UI edit-model audit

**Purpose.** Inventory every editable/mutating control on every screen of the
web app and classify each against Ken's principle:

> **"view" and "view-all" / list surfaces should NOT permit inline editing of
> records.** Inline edits risk *accidental* changes, and created config
> (projects, labels, milestones, sprints, users, workflow, relationships) is not
> meant to change frequently. Editing should live behind an explicit **Edit**
> button that opens a dialog / edit view. Once created, changes should be
> deliberate, not a stray click.

**Verdicts.**

- **OK** — editing is behind an explicit Edit affordance (button → dialog), or
  the surface is legitimately an editor (task detail, New/Create forms).
- **VIOLATION** — a view / list / read surface lets you mutate a saved record
  inline (a click, a dropdown, an inline field that commits on blur/change, an
  inline remove/delete, a hover-reveal control) where an accidental edit is
  plausible.
- **JUDGEMENT** — genuinely debatable; PM reasoning given both ways.

**Read-only.** No code was changed. `data-testid`s and key line numbers are
preserved throughout so a later refactor can trace each control and keep its
tests green.

---

## ⚠ Prior ruling in tension — must be reconciled first

This audit's principle **partly contradicts a standing Ken ruling** already on
record. Flagging before recommending anything, per the repo's
"disagree/record" rules:

> **decisions.md § 9, K1 (Ken, 2026-08-29): "SET-3 is dropped; workflow panels
> are editable."** SET-3 originally asserted workflow panels are read-only ("no
> inline text inputs, no delete buttons"). K1 *dropped* SET-3 and ruled the
> panels editable — inline drag-reorder and in-panel delete-with-remap — because
> `PUT /api/workflow` and `workflow-write.ts` were built for it.

So the settings panels were **deliberately built to edit inline** under K1. The
principle in this audit (that config should edit behind an Edit affordance, not
inline) reverses the *spirit* of K1 for the config panels. **That is a decision
for Ken, not an agent** — this doc classifies against the new principle and
records the conflict; it does not assume K1 is void. Where a panel is marked
VIOLATION below, read it as "violates the *new* principle; was intended under
K1" and treat the PM recommendation as the proposed reconciliation, pending
Ken's ruling.

(K1 says nothing about **relationships**, **sprint metadata**, board/timeline
drag, or bulk actions — those verdicts stand on the new principle alone.)

---

## Control inventory — core views

Files under `apps/web/src/client/`.

| Screen | Control (file:line) | Current behavior | Verdict | Recommended model |
|---|---|---|---|---|
| **List view** | Row click → open task (`list/ListView.tsx:716`) | Whole `<tr>` navigates to `/tasks/$key`; the row is not editable | **OK** | Keep. Rows are read + navigate. |
| List view | Status / Priority / Assignee / Type / Labels cells (`list/cells.tsx`; rendered `ListView.tsx:948-958`) | Read-only badges. Same components as everywhere else; **no dropdown, no quick-edit** in the row. Label pills only *filter* (`cells.tsx:316`), stopping row nav | **OK** | Keep. No inline field edit exists here — good. |
| List view | Row select checkbox (`list/ListView.tsx:731`, `data-testid` per-row) | The one hit area that does not navigate (BLK-1); `stopPropagation` on click; toggles selection only | **OK** | Keep. Selection is not a record mutation. |
| List view | Header "select all" checkbox (`list/ListView.tsx:586`) | Selects the page; no mutation | **OK** | Keep. |
| List view | **Bulk bar** — Set status / priority / assignee / milestone / sprint / Move-to-project pickers, Archive, Delete (`list/BulkBar.tsx:137-204`) | Appears only after explicit selection (absent from DOM at 0 selection, BLK-2). Each picker is a click-to-open one-shot menu. Archive is one click **with Undo** (`BulkBar.tsx:71` resultAction). Delete goes through a typed-confirm dialog (`DeleteConfirmDialog.tsx`) | **OK** (JUDGEMENT on Set-status/assignee having no undo) | Keep the model — mutation is deliberate (select → act). *Consider* extending the Undo affordance (already on Archive) to the bulk **Set** actions, since a mis-picked status on 50 tasks has no one-click reversal. |
| List view | Sort by column header (`list/ListView.tsx:621`) | Writes URL sort param; no record mutation | **OK** | Keep. |
| List view | "Save as view" (`list/FilterBar.tsx:239` → `SaveViewDialog.tsx`) | Explicit button opens a dialog; creates a saved view | **OK** | Keep (create flow, dialog-gated). |
| List view | Advanced query editor (`list/FilterBar.tsx:166`, `?edit=1` opens it) | Editing a saved view's DSL opens an explicit editor (not inline on a list of views) | **OK** | Keep. |
| **Board** | Card click → open task (`board/BoardCard.tsx:113-115`) | Click (below drag threshold) opens the task | **OK** | Keep. |
| Board | **Card drag between columns → status change** (`board/useBoardDrag.ts`; `runMove` `board/BoardView.tsx:141`) | Drag commits a status (and rank) change. Has a 4px threshold (BRD-37), snapshot, `Esc`-cancel, no-op detection, optimistic + rollback, and **error + retry** (BRD-41/43/44) — but **no Undo after a *successful* move** | **JUDGEMENT** | *Keep drag* — a kanban board's whole point is drag-to-progress, and this is a deliberate gesture (press-hold-move past threshold), not a stray click. **But add an Undo** on a successful move (a toast "Moved T-12 to Doing · Undo"), matching bulk-archive. Accidental drops are otherwise only reversible by dragging back and guessing the old column. |
| Board | Ctrl/Cmd + arrow → move card (`board/BoardCard.tsx:120-133`) | Keyboard equivalent of the drag; plain arrows untouched | **JUDGEMENT** (same as drag) | Same as drag: add Undo. Modifier-gated, so not a stray keypress. |
| Board | Card field cells (status/priority/type/assignee/labels/dates) (`board/BoardCard.tsx:renderField`) | Read-only display; label pills filter only | **OK** | Keep. No inline field edit on the card. |
| **Timeline** | Bar click → open task (`timeline/TimelineView.tsx:337` `openTask`) | Click (drag-tail suppressed, TML-17) opens the task | **OK** | Keep. |
| Timeline | **Bar drag / resize → start_date / due_date change** (`timeline/useBarDrag.ts`; `runDrop` `TimelineView.tsx:241`) | Drag body shifts both dates; drag an edge resizes one. 4px threshold, day-snap, `Esc`-cancel, no-op detection, **error + retry** (TML-42-49) — but **no Undo after a successful drop** | **JUDGEMENT** | *Keep drag* (Gantt editing is the point; threshold-gated). **Add Undo** on a successful drop, same as board. A one-day mis-drag silently rewrites a scheduled date with no one-click reversal. |
| Timeline | Bar keyboard adjust (arrow keys on a focused bar) (`TimelineView.tsx:317` `onBarKeyAdjust`) | Routed through the same single-write `runDrop` | **JUDGEMENT** (same as drag) | Same: add Undo. |
| Timeline | Zoom / Group-by / Dependencies toggle / Today (`TimelineView.tsx:665` Toolbar) | Display state → URL params; no record mutation | **OK** | Keep. |
| Timeline | Unscheduled lane rows (`TimelineView.tsx:746`) | Read + navigate only | **OK** | Keep. |
| **Sprints view** (`/sprints`) | Sprint header collapse, links to sprint/settings (`sprints/SprintsView.tsx:610,670`) | Read + navigate only; **no inline sprint mutation on the board view** | **OK** | Keep. Correct: the list-of-sprints surface is read-only, mutation lives on the detail. |
| **Milestone detail** (`/milestones/$id`) | Whole page (`milestones/MilestoneDetail.tsx`) | Read-only — progress readout + scoped task list; **no mutation hooks**. Milestone edits live only in Settings → Milestones | **OK** | Keep. Consistent with the principle: milestone config is edited in Settings, not on its view page. |
| **Sidebar** (`shell/Sidebar.tsx`) | View/project links, expand toggle, vanished-view dismiss (`:704`) | Navigation + local UI state; reads pins from settings. **No inline rename / pin / delete of saved views** (pin mgmt is a Settings panel) | **OK** | Keep. |

---

## Control inventory — task detail (this surface *is* an editor)

The task detail (`task/TaskDetail.tsx`, `task/MetaPanel.tsx`) is the app's
primary record editor. Inline editing here is legitimate **by the principle's
own carve-out** ("or the surface is legitimately an editor"). The relevant
question is only which parts still deserve a confirm.

| Control (file:line) | Current behavior | Verdict | Note |
|---|---|---|---|
| Meta fields: Status / Type / Priority / Assignee / Reporter / Milestone / Sprint / Estimate (`task/MetaPanel.tsx:166-294`) | Each is an `OptionPicker` — a **click-to-open listbox** (`editors/OptionPicker.tsx`), then a deliberate select. One field = one `POST …/set`. Not a bare `<select>` that changes on hover/arrow | **OK** | Two-step (open → pick) makes a stray one-click mutation unlikely. Editor surface. |
| Dates: Start / Due (`task/MetaPanel.tsx:265-289`, `editors/DateField.tsx`) | Commit-on-change date fields; inverted-range warning shown | **OK** | Editor surface. |
| Labels add/remove (`task/MetaPanel.tsx:227`, `editors/LabelsField.tsx`) | In-editor label picker with inline create | **OK** | Editor surface. Distinct from *relationships* remove — see below. |
| Title `<h1>` (`task/TaskDetail.tsx:369`) | **Read-only** — not inline-editable | **OK** | Title is not editable in the web UI at all — see parity gap PG-1. |
| Body (`editor/BodyEditor.tsx`, mounted `TaskDetail.tsx:508`) | Rich editor, **1.5s idle autosave** with `updated_at` precondition (K2) | **OK** | Editor surface; autosave is a Ken ruling (K2). |
| Project (Meta) (`task/MetaPanel.tsx:197`) | **Read-only** — a project change rekeys, so it is the Move dialog's job; `setField` refuses it | **OK** | Correctly gated behind the Move dialog. |
| Completed date (`task/MetaPanel.tsx:301`) | **Read-only** — auto-managed by status | **OK** | Correct. |
| Actions menu: Copy key/link, Duplicate, Move…, Archive/Unarchive, Delete… (`task/TaskDetail.tsx:393-475`) | Duplicate & Archive are one-click (reversible / non-destructive, TSK-23). **Move → dialog** (`MoveTaskDialog`), **Delete → typed-confirm dialog** (`DeleteTaskDialog`) | **OK** | Friction proportionate to consequence. |

### Relationships (task detail → "Related") — Ken's known concern

| Control (file:line) | Current behavior | Verdict | Recommended model |
|---|---|---|---|
| **Relationship remove** (`relationships/RelationshipRow.tsx:166-181`, `data-testid="relationship-remove"`) | **Hover-reveal one-click Remove.** The button is `opacity-0` and appears on `group-hover/row` / focus-visible (`:174`). One click unlinks (two file writes) with **no confirm**. There *is* an Undo (`RelationshipsPanel.tsx:353`, `data-testid="relationship-undo-button"`) | **VIOLATION** | **Ken's explicit concern.** Ken wants relationships edited via an **Edit button → dialog**, not inline hover-remove. Recommended: the Related list is read-only rows; a per-section (or per-panel) **Edit** button opens a dialog listing links with explicit remove controls (and confirm on remove, since a link is two writes). The hover-to-reveal pattern is the exact accidental-click risk the principle targets. Keep the Undo regardless. |
| Add link (`relationships/RelationshipsPanel.tsx:395` `+ Add link` → `LinkPicker.tsx`) | Explicit "+ Add link" button opens a create picker (kind → target). Add-only, not editing an existing edge | **OK** (create flow) | Keep, or fold into the same Edit dialog. Creation behind an explicit button is fine. |
| Reorder ranked links — drag handle / arrow keys (`RelationshipsPanel.tsx:488-524`, `data-testid="drag-handle"`) | Drag or keyboard reorder of ranked relationships; per-group error, snap-back on failure | **JUDGEMENT** | Reorder is a deliberate handle-drag, lower accidental-risk than the hover-remove. If relationships move behind an Edit dialog, reordering belongs there too. Otherwise acceptable to keep with the handle. |

---

## Control inventory — Settings panels (config)

These are the panels the principle names directly. **Three interaction models
coexist today:** (A) *draft-then-Save* (Calendar, Estimation), (B) *Edit-button
→ scoped form → Save/Cancel* (Labels, Milestones), and (C) *auto-save inline*
(Projects name, Custom fields, Enums, Relationship-settings). Models A and B
align with the principle; **model C is where the violations cluster.** Recall
these panels were built editable under **K1** — see the tension note at the top.

| Panel | Control (file:line) | Current behavior | Verdict | Recommended model |
|---|---|---|---|---|
| **Projects** | Name input, save on blur (`settings/ProjectsPanel.tsx:332-339`, `commitName:320`) | Inline text in the list row; `useUpdateProject` on blur, no confirm | **VIOLATION** | Read-only name + per-row **Edit** → dialog with explicit Save. A stray click+tab renames a project today. |
| Projects | Slug input (`ProjectsPanel.tsx:346`) | Read-only, disabled, explains why | **OK** | Keep. |
| Projects | Prefix edit → "Change" → confirm Modal (`ProjectsPanel.tsx:226-244`, confirm `255-298`) | Field alone never saves; "Change" opens a confirm Modal stating blast radius | **OK** (JUDGEMENT-lean-OK) | Already deliberate — the dialog is the gate. Keep. Closes parity gap PRU-44. |
| Projects | Archive / Unarchive (`ProjectsPanel.tsx:364-373`) | Inline one-click toggle, no confirm | **JUDGEMENT** | Reversible; one-click defensible. Optional undo-toast. |
| Projects | Delete (`ProjectsPanel.tsx:374-385`) → `DeleteProjectDialog` | Confirm + required remap | **OK** | Keep. |
| Projects | New project (create Modal `ProjectsPanel.tsx:517`, `CreateProjectForm:34`) | Create form in a Modal | **OK** | Keep (creation). |
| **Labels** | Edit button → inline edit form (`settings/LabelsPanel.tsx:167-174`; form `75-138`; Save `112`) | Read-only row until **Edit**; then name/color with explicit Save/Cancel, Save blocked on invalid | **OK** | **This is the target pattern.** Keep. |
| Labels | Archive / Unarchive (`LabelsPanel.tsx:175-183`) | Inline one-click | **JUDGEMENT** | Reversible; defensible. |
| Labels | Delete (`LabelsPanel.tsx:184-191`) → `RemapDeleteDialog` | Confirm/remap dialog | **OK** | Keep. |
| Labels | Create form (`CreateLabelForm:230-317`) | Inline create with duplicate-ack | **OK** | Keep (creation). |
| **Milestones** | Edit button → inline edit form (`settings/MilestonesPanel.tsx:141-148`; form `52-116`; Save `83`) | Read-only row until **Edit**; name/date with explicit Save/Cancel | **OK** | Target pattern. Keep. |
| Milestones | Delete (`MilestonesPanel.tsx:149-156`) → `RemapDeleteDialog` | Confirm/remap | **OK** | Keep. |
| Milestones | Create form (`MilestonesPanel.tsx:239-274`) | Inline create | **OK** | Keep (creation). |
| **Sprints (settings)** | Whole panel (`settings/SprintsPanel.tsx:29-120`) | Read-only list; state/dates/refcount are display spans; only a "Burndown" link navigates | **OK** | Keep — settings list defers editing to the sprint detail route. *(But see the sprint-detail VIOLATION below — that deferral lands on an ungated inline editor.)* |
| **Users** | Name / Email cells (`settings/UsersPanel.tsx:330-343`) | Read-only display | **OK** | Keep. *(No name/email/tz editing exists at all — parity gap PG-2 / K-11.)* |
| Users | Avatar file input (`AvatarUpload`, `UsersPanel.tsx:121-131`) | Bare file input in the row → cropper → POST on confirm | **JUDGEMENT** | Cropper-confirm is a gate, but a file input sitting in a list row is easy to trip. Consider moving avatar mgmt behind Edit. |
| Users | Avatar Remove (`UsersPanel.tsx:132-146`) | Inline one-click remove of a saved avatar, no confirm | **VIOLATION** (mild) | Add a confirm, or gate behind Edit. One click destroys the saved avatar. |
| Users | Archive / Unarchive (`UsersPanel.tsx:347-360`) | Inline one-click, disabled for self | **JUDGEMENT** | Reversible; defensible. |
| Users | Delete (`UsersPanel.tsx:365-379`) → `UserDeleteDialog` | Refcount, remap/unassign choice, **typed-word** confirm, archive-instead | **OK** (strongest confirm in the app) | Keep. |
| Users | New user (create Modal `UsersPanel.tsx:407`, `CreateUserForm:197`) | Create form in Modal | **OK** | Keep (creation). |
| **Custom fields** | Label input, save on blur (`settings/CustomFieldsPanel.tsx:182-194`) | Inline text on existing field, commits on blur | **VIOLATION** | Edit-gate or explicit Save. Blur-save on `workflow.yaml`. |
| Custom fields | type select / multi checkbox (`CustomFieldsPanel.tsx:202-222`) | Disabled (locked), explains why | **OK** | Keep. |
| Custom fields | searchable checkbox (`CustomFieldsPanel.tsx:225-234`) | Inline one-click toggle, saves immediately | **VIOLATION** (mild) | Gate behind Edit/Save. |
| Custom fields | enum-value weight input, save on blur (`CustomFieldsPanel.tsx:271-290`) | Inline number, commits on blur | **VIOLATION** (mild) | Gate behind Edit/Save. |
| Custom fields | enum-value Delete (`CustomFieldsPanel.tsx:299-312`) → `RemapDeleteDialog` | Confirm/remap; disabled at one value | **OK** | Keep. |
| **Statuses / Priorities / Types** | Label input, save on blur (`settings/EnumCollectionPanel.tsx:263-275`) | Inline text on existing row, commits on blur | **VIOLATION** | Edit-gate or explicit Save. |
| Statuses/Priorities/Types | Key (`EnumCollectionPanel.tsx:278`) | Read-only code, immutable | **OK** | Keep. |
| Statuses | Category select (`EnumCollectionPanel.tsx:286-302`) | Inline dropdown in row, saves on change | **VIOLATION** | Archetypal stray-change. Gate behind Edit. |
| Statuses | Default radio (`EnumCollectionPanel.tsx:314-329`) | Inline one-click sets tracker-wide default status | **VIOLATION** (mild) | Consider confirm/Edit — this changes where every new task lands. |
| Statuses/Priorities/Types | Delete (`EnumCollectionPanel.tsx:338-347`) → `RemapDeleteDialog` | Confirm/remap; disabled at one row | **OK** | Keep. |
| Statuses/Priorities/Types | Drag / keyboard reorder (`ReorderableRows` via `183-207`; `onMove:137`) | Inline reorder, each move saves (optimistic, reverts on fail) | **JUDGEMENT** | Order is load-bearing (board columns, sort). Direct-manipulation is hard to gate; optimistic-revert softens it. PM call — see recommendation. |
| **Relationship settings** | symmetric checkbox (`settings/RelationshipsSettingsPanel.tsx:209-218`, `130`) | Inline one-click; drops/restores inverse fields, saves immediately | **VIOLATION** | Meaningful shape change on one click. Gate behind Edit. |
| Relationship settings | graph select (`RelationshipsSettingsPanel.tsx:222-234`) | Inline dropdown, saves on change | **VIOLATION** | Gate behind Edit. |
| Relationship settings | ranked checkbox (`:236-245`) | Inline one-click, saves | **VIOLATION** (mild) | Gate behind Edit/Save. |
| Relationship settings | inverse / inverse-label inputs, save on blur (`:282-308`) | Inline text, commit on blur | **VIOLATION** | Gate behind Edit. |
| Relationship settings | Delete (`:254-262`) → `RemapDeleteDialog` | Confirm/remap | **OK** | Keep. |
| Relationship settings | Drag reorder (`ReorderableRows:116-149`) | Inline, each move saves | **JUDGEMENT** | Same as enum reorder. |
| **Calendar** | Whole editor (`settings/CalendarPanel.tsx`; Save `340-351`) | **Draft-then-Save** — every field (tz, first-day, working-days, holidays add/remove) edits local draft; nothing persists until Save | **OK** | **Cleanest model in the app.** Keep. |
| **Estimation** | Whole editor (`settings/EstimationPanel.tsx`; Save `182-195`) | Draft-then-Save — enabled/unit/label/presets stage locally, persist on Save | **OK** | Keep. |
| **Card layout** | Visible/Hidden toggle, drag reorder, Reset (`settings/CardLayoutPanel.tsx:143-169`) | Inline one-click / drag, saves immediately (optimistic-revert) | **JUDGEMENT** → OK | **Personal per-user setting, not shared created config.** Outside the principle's target. Inline direct-manipulation is appropriate. Keep. |
| **Reconcile** | Per-field / bulk choices, Apply, Abandon (`settings/ReconcilePanel.tsx`; Apply `254`, Abandon confirm `264`) | Staged conflict-resolution; choices persist to `reconcile.yaml` but tasks unchanged until **Apply** | **OK** | Not a config-list surface — a transactional merge with an explicit Apply. Keep. |
| **Saved views** | Name / query cells (`settings/SavedViewsPanel.tsx:59-77`) | Read-only display (query editing deferred to M4.5) | **OK** | Keep. No inline field-edit of existing views exists. |
| Saved views | Archive / Unarchive (`SavedViewsPanel.tsx:81-101`) | Inline one-click, no confirm | **JUDGEMENT** → OK | Reversible soft-delete. |
| Saved views | Delete → **inline** two-button confirm span (`SavedViewsPanel.tsx:103-135`) | Two-step confirm rendered *in the row*, not the dedicated dialog | **JUDGEMENT** | Has a confirm (good), but see dead-code finding: `DeleteViewDialog.tsx` (a proper dialog that also warns about dropped sidebar pins) exists and is **not wired in**. Either wire it up (surfaces the pin-drop warning) or delete it. |

### Sprint detail — the deferral target (from SprintsPanel) is itself ungated

| Control (file:line) | Current behavior | Verdict | Recommended model |
|---|---|---|---|
| **Sprint meta header** — Name / Start / End / Goal / **State** (`sprints/SprintMetaHeader.tsx:135-249`, `data-testid` `sprint-meta-*`) | The sprint detail page (`/sprints/$key`) renders its metadata as a **live editable header**: text/date fields commit on blur (`:151`), the **State `<select>` commits on change** (`:199`). No Edit toggle, no confirm. Draft-revert on failure, error at the field | **VIOLATION** | Sprints are a named config category. The header *reads* like a view but every field is one stray change from mutating — the state select especially (a mis-arrow changes a sprint's lifecycle). Recommended: read-only header + an **Edit** button opening a dialog (matching Labels/Milestones), or at minimum move State behind a confirm ("Mark this sprint Completed?"). Note: `SprintsPanel` (settings) is read-only *because* editing was deferred here — so the deferral currently lands on an ungated inline editor. |

---

## Parity-gap sublist (capability exists in core/CLI/MCP, web edit-UI missing)

These are not inline-edit violations — they are places where the web app offers
*no* edit affordance at all for a field that core/CLI/MCP can change. Called out
because the fix for several violations above ("move editing behind an Edit
dialog") is also where these missing editors would land.

| Gap | What is missing in web | Where it exists | Notes |
|---|---|---|---|
| **PG-1 / title** | Task **title** is read-only on the detail page (`task/TaskDetail.tsx:369` renders `<h1>`, no editor) | CLI/MCP `set title`, core `setField` | The one core-editable task field with no web control. A future title editor should live in the detail editor (inline is fine there — it is the editor surface), not on a list. |
| **PG-2 / K-11 user profile** | No edit of an existing user's **name / email / timezone** (`settings/UsersPanel.tsx` cells are read-only; only create + avatar + archive + delete) | CLI/MCP user update | When built, use the Edit-button → dialog pattern (not inline), matching Labels/Milestones. |
| **PG-3 / PRU-44 project prefix** | *Present and correctly gated* — prefix edit + "Change" confirm Modal (`ProjectsPanel.tsx:226-298`) | core rekey | Listed for completeness: this parity gap is **closed**, and closed the right way (deliberate, dialog-gated). |
| **PG-4 / K-8 new saved filter** | No in-panel **create** of a saved view/filter from Settings (`SavedViewsPanel` has no create; creation is only via list "Save as view") | `SaveViewDialog` on the list, CLI/MCP | Creation exists on the list surface; the Settings panel is manage-only. Decide whether Settings should also create. |
| **PG-5 / add config rows** | Custom fields, Enums (statuses/priorities/types), and Relationship kinds have **no in-app add-row** affordance (add is out-of-band via `workflow.yaml`) | `PUT /api/workflow`, CLI | Separate from the inline-edit concern, but the same panels. If in-app creation is expected, it belongs in the same redesign. |

---

## PM recommendation — a consistent edit-model pattern

The app already contains the two patterns it needs; the fix is to **apply them
consistently**, not to invent anything. Proposed house rules:

**1. Three surface roles, three rules.**

- **View / list / "view-all" surfaces** (List, Board columns, Timeline,
  Sprints-view, Milestone-detail, Sidebar, and the *rows* of every Settings
  list): **read + navigate + select only.** No field on a saved record mutates
  from these surfaces. Bulk actions are allowed **after an explicit selection**
  (the List bulk bar is the reference implementation).
- **Editor surfaces** (Task detail, the New/Create forms, and any future
  per-record Edit dialog): inline editing is expected and fine. Prefer
  **two-step controls** (click-to-open picker, then select — as `OptionPicker`
  does) over one-step `<select onChange>`/blur-save, so no *single* stray
  interaction commits.
- **Config records** (projects, labels, milestones, sprints, users, workflow
  enums, custom fields, relationship kinds): edited only via an explicit
  **Edit → dialog/form**, per one of the two aligned patterns below.

**2. Two blessed edit patterns for config; pick per panel, don't mix within one.**

- **Pattern B — Edit-button → scoped form → Save/Cancel** (as Labels,
  Milestones). Best when rows are edited one at a time.
- **Pattern A — Draft-then-Save** (as Calendar, Estimation). Best for a whole
  config object with several fields. **The enum, custom-field, and
  relationship-settings panels fit Pattern A naturally** — they already re-read
  the fresh document on save.
- Retire **Pattern C (auto-save inline)** for shared config: blur-save text,
  in-row dropdowns, and in-row checkboxes are the accidental-change risk the
  principle targets.

**3. create ≠ edit ≠ view.**
- *Create* stays where it is (explicit New/Add button → form/Modal). Creation
  cannot be "accidental" the way an edit can, so an inline create form in a
  panel is fine.
- *Edit* is always behind an explicit affordance for config records.
- *View* never mutates.

**4. Confirms vs Undo — proportional to reversibility (the app already does this
for tasks; extend it).**
- **Destructive / irreversible** (delete a record, remove a relationship link,
  remove a saved avatar) → **confirm dialog**. The relationship hover-remove and
  the avatar remove are the current gaps.
- **Reversible** (archive/unarchive, bulk archive, board/timeline drag,
  bulk set-field) → **no confirm, but offer Undo.** Undo exists for bulk-archive
  and relationship-remove; it is **missing for board drag, timeline drag, and
  bulk set-status/assignee**, which are the reversible-but-unrecoverable-by-one-
  click cases. Add it there.
- **Lifecycle changes on config** (sprint State, default-status radio) → a light
  confirm, because they change behavior tracker-wide or move a sprint's phase.

**5. Reordering (JUDGEMENT, one ruling needed).** Drag-reorder of enum rows,
relationship kinds, and card-layout is intrinsically direct-manipulation and
hard to put behind an Edit gate. It already optimistic-reverts on failure. The
consistent call: **keep reorder inline everywhere it appears** (it changes
*order*, not a record's content, and a mis-drop is visible and immediately
re-draggable), and instead spend the safety budget on the field edits and
removes above. If Ken wants order locked too, it moves inside the Pattern-A
Save.

**One-line model:** *view surfaces read and navigate; a saved record changes
only through an explicit Edit (dialog for config, in-place for the task editor);
destructive actions confirm, reversible actions offer Undo.*

---

## Count

**VIOLATIONs: 14**, all "a saved record mutates inline where a stray change is
plausible":

1. Projects — name field, blur-save (`ProjectsPanel.tsx:332`)
2. Users — avatar Remove, one-click no-confirm (`UsersPanel.tsx:132`) *(mild)*
3. Custom fields — label, blur-save (`CustomFieldsPanel.tsx:182`)
4. Custom fields — searchable checkbox, toggle-save (`:225`) *(mild)*
5. Custom fields — enum-value weight, blur-save (`:271`) *(mild)*
6. Enums — label, blur-save (`EnumCollectionPanel.tsx:263`)
7. Statuses — category select, change-save (`:286`)
8. Statuses — default radio, one-click tracker-wide default (`:314`) *(mild)*
9. Relationship settings — symmetric checkbox (`RelationshipsSettingsPanel.tsx:209`)
10. Relationship settings — graph select (`:222`)
11. Relationship settings — ranked checkbox (`:236`) *(mild)*
12. Relationship settings — inverse / inverse-label, blur-save (`:282`)
13. **Relationships (task detail)** — hover-reveal one-click Remove
    (`relationships/RelationshipRow.tsx:166`) — *Ken's named concern*
14. **Sprint detail** — inline meta header incl. State `<select>` commit-on-change
    (`sprints/SprintMetaHeader.tsx:199`)

Plus **6 JUDGEMENT** calls (board drag, timeline drag, config-row reorder,
one-click archives, default-status radio overlap, saved-view inline confirm)
and **5 parity gaps** (PG-1 title, PG-2/K-11 user profile, PG-3/PRU-44 project
prefix *[closed]*, PG-4/K-8 new saved filter, PG-5 add config rows).

Two non-principle findings also surfaced: **`DeleteViewDialog.tsx` is dead code**
(a proper confirm dialog with a pin-drop warning that `SavedViewsPanel` never
imports — it uses an inline confirm instead), and the config panels lacking any
**add-row** affordance (PG-5).

