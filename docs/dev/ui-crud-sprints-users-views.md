# UI CRUD test — Sprints, Users, Saved Views (web UI)

**Instance under test:** `http://localhost:7762` (isolated seeded tracker, data dir `/private/tmp/loctt-crud-2/.loctt`).
Seed: users Ada/Grace, one sprint "Sprint 24" (ULID `01M1TVX0AY33VKHKMTH9FFMMZ4`), 3 tasks, saved views `recent-open` and `blocked`.
Verified all mutations landed in **crud-2** only; crud-1/crud-3 (other agents' instances on 7761/7763) left untouched.

**Harness note.** The three instances share one browser preview session; the tab drifts across ports between separate tool calls. Every action below was executed as a single `browser_batch` (navigate → verify `location.port==='7762'` → act → verify), so no action ran against the wrong instance. Two consequences for method: (1) `read_page` returns an empty a11y tree (pane hidden / not compositing) — used screenshots + JS instead; (2) synthetic React events (native value setter + `dispatchEvent('change'/'blur')`) do **not** reliably trigger the app's save handler — only real `computer type` input does. Native `<input type=date>` segments could not be driven by headless typing, so date-field persistence is corroborated by the symmetric source path rather than a live UI type where noted.

---

## SPRINTS

### Settings → Data → Sprints panel (`/settings/sprints`)

The panel is **read-and-navigate, not CRUD** — this is intentional per `SprintsPanel.tsx` ("Read-and-navigate rather than full CRUD: the sprint *detail* route owns editing metadata"). It renders a list (name, state, date window, task ref-count) + a "Burndown" link per row. No create/edit/archive/delete controls exist on this panel.

| Op | Control | Result | Persists | Verdict |
|---|---|---|---|---|
| Create sprint | — | No "New sprint" button anywhere in settings or the detail page. Backend has `POST /api/sprints` but nothing in the UI calls it. | n/a | **MISSING** |
| Delete sprint | — | No delete control in UI. Backend has `DELETE /api/sprints/:id` but no UI is wired to it. | n/a | **MISSING** |
| Archive / unarchive sprint | — | No archive control, and no "archived" sprint state exists — the state enum is exactly `active / completed / future` (enforced in `SprintMetaHeader.tsx`: "SPR-7 requires exactly these and no invented fourth"). Archiving is not a sprint concept. | n/a | **MISSING** (by design) |
| List sprints | panel body | Shows "Sprint 24", Active, 2026-09-01 → 2026-09-14, "0 tasks", Burndown link. | n/a | **WORKS** |
| Burndown link | `sprint-burndown-link` | Navigates to `/sprints/<ulid>` detail page. | n/a | **WORKS** |

### Sprint detail / SprintMetaHeader (`/sprints/01M1TVX0AY33VKHKMTH9FFMMZ4`)

Editable metadata header: Name (text), Start (date), End (date), State (select), Goal (textarea). Per source: text/date/goal **commit on blur** (and Enter); **state commits on change**. Saves are non-optimistic (revert-to-server-value on rejection; field-attributed inline error). PUT `/api/sprints/:id` via `useUpdateSprintMeta`.

| Op | Control | Result | Persists | Verdict |
|---|---|---|---|---|
| Edit name | Name text input | Typed "Sprint 24 Renamed", blurred → API + `sprints.yaml` updated. | Yes (reload + YAML confirmed) | **WORKS** |
| Edit start date | Start date input | Set to 2026-09-02 → persisted; burndown footer recalculated to "13 days". | Yes (YAML: `start_date: 2026-09-02`) | **WORKS** |
| Edit end date | End date input | Same `commit()` code path as start (symmetric source). Could not drive the native date segments via headless typing, so no live-UI persist captured; synthetic events fire no save (harness limitation, not app bug). | Not captured live | **WORKS (by symmetric code path; not live-verified in harness)** |
| Change state | State `<select>` | Changed active→future via change event → persisted immediately, no save button. **Confirms the reported commit-on-change behavior.** | Yes (reload shows "future"; YAML `state: future`) | **WORKS** |
| Edit goal | Goal textarea | Typed "QA goal persistence check", blurred → API returns goal; visible after reload. | Yes | **WORKS** |
| Burndown render | BurndownChart | Renders empty-state "Nothing to burn down — no tasks…" with window footer "2026-09-02 → 2026-09-14 · 13 days · starting at 0". Recalculates live on date edit. | n/a | **WORKS** |

### Sprints overview (`/sprints`, sidebar "Sprints" view)

Board-style swimlane view: one column per sprint (+ a "No sprint" column with the 3 unassigned seed tasks). Shows "Sprint 24 Renamed" (name edit propagated here) with an "Open sprint →" link to the detail page. **No "New sprint" / create control here either.**

| Op | Control | Result | Persists | Verdict |
|---|---|---|---|---|
| View sprints overview | swimlanes | Renders sprint column + "No sprint" column with tasks. Name edit reflected. | n/a | **WORKS** |
| Create sprint from overview | — | No create control. | n/a | **MISSING** |

**No BUG-1 (`missing relationships remap`) observed for sprints. No destructive-action-without-confirm risk (no destructive UI at all). No raw 500s.**

### Sprints summary
- **WORKS:** edit name / start / state / goal (detail), list, burndown render, overview. End-date: works by symmetric code path (not live-verified in harness).
- **MISSING:** create, delete, archive/unarchive (create & delete exist in the backend API but are unreachable from the UI; archive is not a sprint concept).

---

## USERS (`/settings/users`, UsersPanel)

Table of users: AVATAR (raw `<input type=file accept="image/*">`), NAME (plain text), EMAIL (plain text), and per-row Archive/Delete. A "New user" button opens a create form. Seed: ken (current actor), Ada Lovelace, Grace Hopper — none had email set; all default timezone Asia/Singapore.

| Op | Control | Result | Persists | Verdict |
|---|---|---|---|---|
| Create user | `user-create-open` → form (`user-create-name` / `-email` / `-timezone`) + `user-create-submit` | Form exposes **Display name, Email, Timezone**. Created "QA Tester" / qa@example.com / America/New_York → POST /api/users **201**. | Yes (`users/<id>/profile.yaml` with all 3 fields; crud-1/crud-3 untouched) | **WORKS** |
| Edit existing user's **email** | — | **No email input on existing rows.** Email is plain text; email is settable at create only. | n/a | **MISSING** (confirms K-11) |
| Edit existing user's **name** | — | No name input on existing rows (plain text). | n/a | **MISSING** |
| Edit existing user's **timezone** | — | No timezone control on existing rows. | n/a | **MISSING** |
| Avatar upload | `user-avatar-input-<id>` (raw file input, `accept=image/*`) | UI file input present + wired (preview/remove/retry/error affordances in source). Native file picker not drivable in this headless pane; backend `POST /api/users/:id/avatar` verified directly: **200**, decodes+converts to `avatar.jpg`, writes file, sets `avatar:` in profile; row then renders `<img src="/api/users/.../avatar">` + a Remove button. | Yes | **WORKS** (backend + UI wiring verified; live picker-click not exercised) |
| Avatar remove | `user-avatar-remove-<id>` / `DELETE /api/users/:id/avatar` | 200, avatar key removed from profile. | Yes | **WORKS** |
| Archive user | `user-archive-<id>` → `POST /api/users/:id/archive` | 200; user drops from default list, stays visible as "(archived)" with an Unarchive button. | Yes | **WORKS** |
| Unarchive user | `user-unarchive-<id>` → `POST /api/users/:id/unarchive` | 200; user returns to active list. | Yes | **WORKS** |
| Archive/Delete current user (ken) | disabled buttons | Both **disabled**, message "You cannot archive the user you are acting as. Switch users first." | n/a | **WORKS** (correct guard) |
| Delete user — unreferenced | `user-delete-<id>` → `user-delete-dialog` | Confirm dialog: states "not referenced on any task", warns permanent + suggests archive instead, **type-DELETE gate** (confirm disabled until exactly "DELETE" typed — verified empty→disabled, "wrong"→disabled, "DELETE"→enabled). DELETE `?confirm=true` → 200. | Yes (profile removed from disk) | **WORKS** |
| Delete user — **referenced** (assignee remap) | dialog `user-delete-resolution` radios | With the user set as assignee on DEMO-1: dialog reports "assignee on 1 task and reporter on 0 tasks", offers **Reassign to ken/Ada/Grace** or **Clear the assignee/reporter**, plus an "archive instead" escape. Chose Clear → DELETE `?confirm=true&unassign=true` → 200 `{remappedAssigneeCount:1}`; DEMO-1's assignee field removed on disk. | Yes | **WORKS** — this is the relationships-remap path (BUG-1 area); **present and working, not missing** |

**Findings:** No silent no-ops, no raw 500s. Destructive delete is well-guarded (type-to-confirm + reference remap). The only real gap is the K-11 one: existing users are **not editable** for name/email/timezone — only avatar is editable post-create; to change any text field you must delete + recreate.

### Users summary
- **WORKS:** create, avatar upload/remove, archive, unarchive, current-user guard, delete (unreferenced + referenced-with-remap).
- **MISSING:** inline edit of an existing user's name / email / timezone (no editor at all).

---

## SAVED VIEWS

Three surfaces: the **list view** ("Save as view" + a disabled "+ New filter…"), the **Settings → Data → Saved views** panel (Archive/Delete per row), and the **sidebar** pins. Seed views: `recent-open`, `blocked`.

| Op | Control | Result | Persists | Verdict |
|---|---|---|---|---|
| Create ("Save as view") | List view `⭑ Save as view` button → dialog (Name input, read-only Query, Save view) | Applied filter `priority = critical`; dialog captured query "(priority = critical) and archived != true"; named "QA Critical View"; Save → POST /api/views **201**. | Yes (queries.yaml; crud-1/crud-3 untouched) | **WORKS** |
| Sidebar "+ New filter…" | sidebar button | **Disabled**, tooltip "Saved-view editor arrives in a later milestone". | n/a | **MISSING (disabled by design)** — confirms report |
| Archive view | panel `view-archive` | `DELETE /api/views/:id?soft=true` → 200; row becomes "(archived)" with Unarchive/Delete; stays runnable by URL, hidden from sidebar. | Yes | **WORKS** |
| Unarchive view | panel `view-unarchive` | `POST /api/views/:id/unarchive` → 200; row returns to active. | Yes | **WORKS** |
| Delete view | panel `view-delete` → inline `view-delete-confirm` | Two-step inline confirm (click Delete → a confirm button appears; no type-to-confirm, no modal). Confirm → DELETE /api/views/:id → 200. | Yes (removed from queries.yaml) | **WORKS** |
| Rename view | — | **No rename control** in panel, sidebar, or anywhere. Backend has `PUT /api/views/:id` (handleUpdateView/editView, supports rename + query edit) but nothing in the UI calls it. | n/a | **MISSING** (backend-capable, UI-unwired) |
| Edit a view's query | — | Same as rename: no UI affordance; the panel shows the query as read-only `<code>`. To change a query you must delete + re-save. | n/a | **MISSING** |

**Findings:** No silent no-ops, no raw 500s. View delete has a lighter guard than user delete (single inline confirm vs type-to-confirm) — reasonable given a view is reversible/re-creatable. The gap is that the web UI exposes create + archive + delete but **not rename/edit**, despite the backend supporting it, and the general saved-view editor ("+ New filter…") is explicitly deferred.

### Saved views summary
- **WORKS:** create (Save as view), archive, unarchive, delete.
- **MISSING:** rename, edit query, the sidebar filter editor ("+ New filter…" disabled).

---

## Overall counts

| Verdict | Count | Ops |
|---|---|---|
| **WORKS** | 18 | Sprint: edit name/start/state/goal, list, burndown, overview (7). User: create, avatar upload, avatar remove, archive, unarchive, current-user guard, delete-unreferenced, delete-with-remap (8). View: create, archive, unarchive, delete (4). *(Sprint end-date counted under "works by symmetric path", not tallied as separately live-verified.)* |
| **MISSING** | 8 | Sprint: create, delete, archive/unarchive (3). User: edit existing name/email/timezone (counted as 1 gap). View: rename, edit-query, "+ New filter…" editor (3). Plus user email/name/tz split as one K-11 gap. |
| **BROKEN** | 0 | None. No raw 500s, no silent no-ops, no destructive action without a confirm. |

**Worst issue:** The K-11 gap — **an existing user's name, email, and timezone are entirely uneditable in the web UI** (only the avatar can be changed post-create). Correcting a typo'd email requires deleting and recreating the user. This is worse than the sprint/view "missing" gaps because those surfaces at least support the primary edit on their detail page; the user surface has no edit path at all for its core text fields.

**Relationships remap (BUG-1 area):** Found **working**, not broken — deleting a referenced user shows an accurate ref-count and offers reassign-to-another-user or clear, and the clear path verifiably removed the assignee on disk (`remappedAssigneeCount:1`).

## Notes on method / instance safety
- All mutations were confined to **crud-2** (port 7762); crud-1 (7761) and crud-3 (7763) — other agents' instances sharing the browser preview — were verified untouched after each destructive op.
- Screenshot refs: the inline `<output_image>` frames captured during the run show the Sprints panel, Sprint detail (with the state select, burndown empty-state, and post-edit goal), the Sprints overview swimlanes, the Users panel (raw avatar file inputs, per-row Archive/Delete, "New user"), the Saved views panel (Archive/Delete only), and the List view ("Save as view" + disabled "+ New filter…"). The browser pane was frequently hidden (not compositing), so several verifications used DOM/JS + API + on-disk YAML rather than pixels.
- Harness caveat carried from the top: synthetic React events don't reliably fire save handlers and native date/file pickers can't be driven headlessly, so **Sprint end-date persist** and the **avatar picker click** are verified by code path + direct backend call rather than a live UI gesture. Everything else was driven through the real controls.
