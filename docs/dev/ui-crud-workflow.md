# UI CRUD test — Settings → Workflow panels + BUG-1 confirmation

Tracker under test: **crud-3** at `/tmp/loctt-crud-3` (private seeded instance, served on
`http://localhost:7763`). Seed holds a directional relationship: **DEMO-1 `blocks` DEMO-2**,
so DEMO-2 carries the inverse `is_blocked_by` edge. Driven through the real browser
(mcp__Claude_Browser__*).

> Environment note: multiple concurrent CRUD trackers share the browser pane (crud-2 on 7762,
> another on 7761). Tests here were pinned to a dedicated tab (`tab-2`) always targeting 7763.
> All findings below are from 7763 / crud-3, verified by the `/tmp/loctt-crud-3/...` path shown
> in each panel footer and by per-request URLs in the network log.

---

## PRIORITY 1 — BUG-1 confirmed through the UI: **YES**

### What was done
1. Navigated to **Settings → Estimation** (the one Workflow panel with an explicit **Save**
   button — chosen as the least destructive save trigger).
2. Made a harmless edit: changed **Unit label** from `pts` to `pts2`.
3. Clicked **Save**.

### What the UI showed
The save was rejected. An inline error appeared in red directly above the Save button:

> **Not saved to .loctt/config/workflow.yaml: internal: missing relationships remap for
> "is_blocked_by" on task DEMO-2**

The raw internal error string is surfaced verbatim to the user (no friendly rewrite).

### The underlying request
`PUT /api/workflow` → **400 Bad Request**, body:

```json
{
  "code": "config_invalid",
  "message": "internal: missing relationships remap for \"is_blocked_by\" on task DEMO-2",
  "error":   "internal: missing relationships remap for \"is_blocked_by\" on task DEMO-2",
  "data_state": "not_saved",
  "recovery": { "kind": "retry" }
}
```

This matches the diagnosis in `docs/dev/bug-journal-remap-inverse.md` exactly: any
Settings→Workflow save on a tracker holding a directional relationship throws
`missing relationships remap for "is_blocked_by"`.

### Does it brick the tracker? — **YES**
After the failed workflow save, I attempted an **unrelated write on another surface**: on the
**DEMO-3** task detail page, changed **Status** Backlog → In progress.

`POST /api/tasks/DEMO-3/set` → **500 Internal Server Error**, body:

```json
{
  "code": "unknown",
  "message": "The server failed while handling POST /api/tasks/DEMO-3/set.",
  "error":   "The server failed while handling POST /api/tasks/DEMO-3/set.",
  "data_state": "unknown",
  "recovery": { "kind": "reload" },
  "detail": "internal: missing relationships remap for \"is_blocked_by\" on task DEMO-2"
}
```

The status did **not** change (still reads "Backlog" after the attempt). The `detail` shows the
SAME poisoned `remap_workflow` journal entry now failing an operation that has nothing to do
with workflow config or relationships — confirming every subsequent write replays the poisoned
journal and dies. The tracker is **wedged for all writes** until the journal
(`/tmp/loctt-crud-3/.loctt/local/journal.yaml`) is cleared.

The UI presentation of the bricked write (on DEMO-3):

> **Status on DEMO-3: The server failed while handling POST /api/tasks/DEMO-3/set.**
> **LocTT cannot tell whether this was saved. Reload the page, or run `loctt show` in a
> terminal to see what the file holds.**
> [Reload] [Dismiss]

Observations on the error UX:
- The workflow-save error (400 / `not_saved` / `retry`) is handled *well*: "Not saved" is
  accurate and the config was genuinely not written. But "retry" is useless advice — every
  retry re-poisons the journal.
- The follow-on write error (500 / `unknown` / `reload`) degrades to the generic
  uncertain-write banner. Honest ("cannot tell whether this was saved") but the real cause
  (poisoned journal) is invisible, and reloading does not help — the tracker stays wedged.

---

## PRIORITY 2 — Workflow-panel CRUD inventory

Nav confirms the Workflow group: **Statuses, Priorities, Task types, Relationships,
Custom fields, Estimation**. Per task, **Calendar** (under TRACKER) is included too.

The overriding pattern: **statuses / priorities / task types / relationships are auto-save
inline-edit surfaces** — no "Add" button, no "Save" button. Labels are live `<textbox>`es,
categories/types are live `<combobox>`es, order is changed by keyboard reorder buttons, and
each row has an inline **Delete**. Every edit persists on change/blur via `PUT /api/workflow`,
which means **every one of these surfaces triggers BUG-1 on any edit** on this tracker. The
edit-model review's INLINE-EDIT flag is confirmed for all four.

Estimation and Calendar are the exceptions: they batch changes behind an explicit **Save**.

### Statuses — `/settings/statuses`
Rows: backlog, in_progress, done, wont_do.

| Control | Behavior | Verdict |
|---|---|---|
| Label | inline `textbox` "Label for <key>" | INLINE-EDIT (violation) |
| Key | read-only ("A key is permanent…") | WORKS (intentional) |
| Category | inline `combobox` pending/active/completed/discarded | INLINE-EDIT (violation) |
| Default | inline `radio` per row | INLINE-EDIT (violation) |
| Reorder | keyboard "Reorder …, position N of M" button | WORKS (a11y-friendly; no drag tested) |
| Delete | inline `button` per row | WORKS (control present; not exercised — would brick) |
| **Create** | none — no "Add status" affordance | **MISSING** |
| Save | none — auto-save on change | (auto-save → BUG-1) |

### Priorities — `/settings/priorities`
Rows: critical(4), high(3), medium(2), low(1). "value is recomputed from its position."

| Control | Behavior | Verdict |
|---|---|---|
| Label | inline `textbox` | INLINE-EDIT (violation) |
| Key | read-only | WORKS (intentional) |
| Value | auto-computed from position (not editable) | WORKS (by design) |
| Reorder | drag handle (⠿) | WORKS (present) |
| Delete | inline `button` per row | WORKS (present; not exercised) |
| **Create** | none — no "Add priority" | **MISSING** |
| Save | none — auto-save | (auto-save → BUG-1) |

### Task types — `/settings/task-types`
Rows: story, bug, task, spike, feature. "carry no built-in behaviour."

| Control | Behavior | Verdict |
|---|---|---|
| Label | inline `textbox` | INLINE-EDIT (violation) |
| Key | read-only | WORKS (intentional) |
| Reorder | drag handle (⠿) | WORKS (present) |
| Delete | inline `button` per row | WORKS (present; not exercised) |
| **Create** | none — no "Add task type" | **MISSING** |
| Save | none — auto-save | (auto-save → BUG-1) |

### Relationships — `/settings/relationships`
Rows: Blocks (`blocks`/`is_blocked_by`, **1 task** — the DEMO-1→DEMO-2 edge),
Parent (`parent`/`child`), Clones, Duplicates, Causes, Relates to (symmetric).
Richest inline surface:

| Control | Behavior | Verdict |
|---|---|---|
| Label | inline `textbox` | INLINE-EDIT (violation) |
| Key | read-only | WORKS (intentional) |
| Symmetric | inline `checkbox` | INLINE-EDIT (violation) |
| Graph type | inline dropdown acyclic/tree/none | INLINE-EDIT (violation) |
| Ranked | inline `checkbox` | INLINE-EDIT (violation) |
| Inverse key | inline `textbox` (hidden/"same as forward" when symmetric) | INLINE-EDIT (violation) |
| Inverse label | inline `textbox` | INLINE-EDIT (violation) |
| Delete | inline `button` per row | WORKS (present; not exercised) |
| **Create** | none — no "Add relationship" | **MISSING** |
| Reorder | none observed | MISSING (or n/a) |
| Save | none — auto-save | (auto-save → BUG-1; this panel's data is what triggers the bug) |

### Custom fields — `/settings/custom-fields`
Empty: *"This tracker declares no custom fields. Add them under custom_fields in
workflow.yaml."*

| Control | Behavior | Verdict |
|---|---|---|
| List | read-only lens on `custom_fields` | WORKS (read) |
| **Create** | none in UI — explicitly directs user to edit YAML | **MISSING** |
| Edit / Delete / Reorder | none (no rows to test; no affordance) | **MISSING** |

### Estimation — `/settings/estimation`
Has an explicit **Save**.

| Control | Behavior | Verdict |
|---|---|---|
| Enabled | `checkbox` toggle | WORKS (control present) |
| Unit | dropdown points/hours/days/custom_numeric/custom_enum | WORKS (control present) |
| Unit label | `textbox` | WORKS (editable) |
| **Save** | explicit `button` → `PUT /api/workflow` | **BROKEN on this tracker** — returns 400 `config_invalid` (BUG-1). The save path itself works structurally, but is unusable while any directional relationship exists. |

### Calendar — `/settings/calendar` (TRACKER group)
Has an explicit **Save** and an **Add holiday** button.

| Control | Behavior | Verdict |
|---|---|---|
| Timezone | large dropdown (full IANA list) | WORKS (control present) |
| First day of week | dropdown Sun…Sat | WORKS (control present) |
| Working days | 7 toggles Sun…Sat | WORKS (control present) |
| Holidays | list ("0 entries") + **Add holiday** button | WORKS (create affordance present) |
| **Save** | explicit `button` | Not clicked (would likely `PUT /api/workflow` and brick like Estimation). Untested to preserve tracker state after BUG-1. |

---

## Verdict tally (workflow panels)

- **WORKS** (control present/functional): reorder handles/buttons, read-only keys, auto-value,
  delete controls, Estimation/Calendar field controls, Add-holiday — collectively the majority
  of individual controls.
- **BROKEN**: the **save path itself** on every workflow surface — inline auto-save (statuses,
  priorities, task types, relationships) and explicit Save (Estimation) — all route to
  `PUT /api/workflow`, which is **400 `config_invalid`** on any tracker holding a directional
  relationship (BUG-1). This is one root cause with system-wide blast radius: it also bricks
  every non-workflow write (verified: task status change → 500).
- **MISSING**: in-UI **create** for statuses, priorities, task types, relationships, and custom
  fields (custom fields have no edit/delete/reorder either — YAML only).
- **INLINE-EDIT (violation)**: statuses, priorities, task types, relationships — all fields
  edit in place with no save/confirm step (matches the edit-model review's flag).

> Delete controls and the Estimation/Calendar explicit Saves were left largely unexercised on
> purpose after BUG-1 wedged the tracker — further writes fail regardless, and exercising them
> would only re-poison the journal.
