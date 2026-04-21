# LocTT TODO

Tracked items for the next phase of development. Clean up before release.

## Frontend Development

The frontend is being prototyped in a separate repo (`~/Documents/PDev/task-tracker/`)
with its own design doc (`task-tracker/design-doc.md`). LocTT itself is used to plan and
track that work (dogfooding). Once the frontend is stable, it gets migrated into this repo
under `apps/web`.

### Core changes needed before migration

- [ ] **Relationship ranking** — add ordering support to relationships within a
      `(task, type)` group. task-tracker uses lexorank on a `rank` column; loctt currently
      stores relationships as an unordered array. Options:
  - Array position as implicit rank (simplest, fragile across concurrent edits)
  - Explicit `rank` field on `TaskRelationship` (matches task-tracker design)
- [ ] **Reorder API** — expose reorder operations through web API and MCP so the frontend
      can persist drag-and-drop ordering
- [ ] **Web API alignment** — review task-tracker's REST API surface against loctt's
      `apps/web` API; identify gaps (pagination envelope, query params, link
      create/reorder/remove in PATCH, etc.)
- [ ] **Attachment support** — task-tracker has file uploads; loctt stores attachments as
      sibling files in the task directory but has no upload API yet
- [ ] **Activity log** — task-tracker logs field changes; loctt has no activity tracking

### Frontend migration steps

- [ ] Confirm frontend is feature-complete enough in task-tracker
- [ ] Map task-tracker API calls to loctt web API equivalents
- [ ] Build/adapt API client layer for loctt's data model (markdown files, not SQLite)
- [ ] Move React app into `apps/web`, wired to loctt core
- [ ] Remove task-tracker repo (or archive it)

### Frontend features (tracked in task-tracker, listed here for reference)

- List view with filtering and sorting
- Kanban board with drag-and-drop status changes
- Task detail page (metadata sidebar, TipTap editor, relationships, activity)
- Timeline / Gantt view
- Relationship sections with drag-to-reorder within type groups
- Light/dark theme
