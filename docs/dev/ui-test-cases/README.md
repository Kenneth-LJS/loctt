# Web UI test cases

Acceptance criteria for the LocTT web UI, written for a human (or an
agent) to verify by using the app. These are **not** Playwright scripts —
they describe observable behaviour, not selectors, so they survive the UI
being built. E2E scripts are transcribed *from* these at each milestone's
review gate.

Scope is the web UI only (`apps/web`). The CLI and MCP appear only where
they collide with the UI — a task edited in the CLI while the UI has it
open, config rewritten underneath a live session, and so on.

## How to use this

- Docs are split **by flow**, one per domain. Building the sprints
  feature? Read [flow-sprints.md](flow-sprints.md) and nothing else.
- Each flow doc runs **happy path → edge cases → error cases**, in that
  order. Stop after the happy path if you're scoping; read on when
  you're hardening.
- Every case is tagged with the **principles** it defends (`P1`–`P10`).
  A case that defends no principle probably isn't worth writing.
- Every case is tagged with the **milestone** it becomes verifiable in
  (`M1`–`M4`, from the v1 build ticket roster).
  Cases for later milestones are listed anyway so earlier work doesn't
  paint itself into a corner.
- Case IDs are stable and prefixed per flow (`TSK-1`, `SPR-4`, …). Don't
  renumber on insert — append.
- **Severity**: `blocker` (ship-stopping), `major` (bad but shippable
  with a known issue), `minor` (polish).

## Flow docs

### Domain flows

| Flow | Covers | Milestones |
|---|---|---|
| [flow-onboarding.md](flow-onboarding.md) | First run, init wizard, empty tracker, uninitialized directory | M1, M4 |
| [flow-list.md](flow-list.md) | List view: columns, sort, filter, URL state, pagination | M1 |
| [flow-tasks.md](flow-tasks.md) | Task detail: read, inline edits, body editor, duplicate, move, archive, delete | M2 |
| [flow-task-create.md](flow-task-create.md) | Create modal from every entry point, project resolution | M3 |
| [flow-bulk.md](flow-bulk.md) | Selection, bulk edits, bulk archive/delete, export | M1 |
| [flow-board.md](flow-board.md) | Board columns, cards, drag-and-drop, WIP | M3 |
| [flow-timeline.md](flow-timeline.md) | Timeline bars, zoom, grouping, drag-resize, dependency arrows | M3 |
| [flow-relationships.md](flow-relationships.md) | Links, inverse edges, ranked reorder, parent trees, attachments | M2 |
| [flow-comments-activity.md](flow-comments-activity.md) | Comments, mentions, activity feed, history pagination | M2 |
| [flow-sprints.md](flow-sprints.md) | Sprint views, sprint detail, burndown, assignment | M3, M4 |
| [flow-milestones-labels.md](flow-milestones-labels.md) | Milestones, progress, labels, label filtering | M1, M4 |
| [flow-saved-views.md](flow-saved-views.md) | Built-in filters, saving views, basic + advanced DSL editor | M1, M4 |
| [flow-projects-users.md](flow-projects-users.md) | Project switching + CRUD, user switching + CRUD, avatars | M1, M4 |
| [flow-settings.md](flow-settings.md) | Settings shell, workflow panels, custom fields, calendar, diagnostics | M4 |
| [flow-git-sync.md](flow-git-sync.md) | Enable/disable, publish, sync, reconciliation, rekeying | M4 |

### Cross-cutting flows

These span every domain and can't sensibly live in one of them.

| Flow | Covers |
|---|---|
| [flow-app-shell.md](flow-app-shell.md) | Shell layout, sidebar, theme, navigation, schema banner, routing |
| [flow-cross-surface.md](flow-cross-surface.md) | CLI/MCP writing underneath the UI, concurrency, config drift, schema migration |
| [flow-accessibility.md](flow-accessibility.md) | Keyboard reachability, focus management, screen-reader semantics |
| [flow-error-handling.md](flow-error-handling.md) | Cross-cutting error quality bar, including P4's rare exception |

---

# First principles

Ten principles derived from what LocTT is: a local-first, file-backed,
config-driven tracker with three concurrent front-ends. Each is written
so it can be *violated* — that's what makes it able to generate test
cases. Where a principle names violations, those are real failure modes
to test for, not illustrations.

## Writing a case that asserts a write

**A case asserting a write must assert the far end** — the file on
disk, or a read-back through a different surface. Asserting that the UI
*sent* something is not asserting that anything *happened*.

Two live bugs hid in exactly that gap:

- **LST-16** checked that `field.team=platform` reached the URL and a
  chip appeared. It never checked the result set narrowed.
  `useTasks.ts` stripped every `field.*` key, so the case passed while
  the filter did nothing.
- **VUE-6** checked that `queries.yaml` gained an entry and the view
  ran. It never re-read the file. `config/queries.ts` rejects the
  **entire file** on one bad entry, so a malformed save silently
  destroyed every other view.

This was inconsistency rather than house style — adjacent cases got it
right. TML-9 and TML-11 read the file and TML-10 did not; BRD-9 checked
disk and BRD-10 checked only the payload; PRU-13 checked disk and
PRU-27 checked only the request.

## P1 — The files are the truth; the UI is a lens

`.loctt/` is the source of truth, and the CLI and MCP can write to it
while the UI is open. The UI must never present a stale view as
authoritative, never silently overwrite a change it didn't make, and
never hold state that exists only in the browser.

**Violations:** a task edited in the CLI still showing old values ten
minutes later; a body save clobbering a teammate's paragraph; a saved
view that exists in the UI but not in `queries.yaml`.

**Optimistic rendering is allowed, with two conditions.** Dragging a
card should feel immediate, so the UI may render an unsaved change
before the server confirms it. But it must be **visually distinct**
while pending, and it must **not survive a reload** — a reload always
shows server truth. Rendering unsaved state as though it were saved is
the actual violation, and a case that permits "tentative" rendering
without requiring the visual distinction also passes when that happens.
See BRD-43, BRD-48, TML-44.

## P2 — The URL is the view

Any view reachable by clicking is reachable by pasting a URL — filters,
sort, pagination, active project, archived toggle. Back and forward
behave.

**Violations:** a filter that lives in React state only; the back button
jumping out of the app instead of undoing a filter; a shared link that
opens someone else's default view.

## P3 — The user's vocabulary, not ours

Statuses, priorities, types, relationship kinds, and custom fields come
from `workflow.yaml`. The UI renders the labels the user chose, stores
the `key`s, and never hardcodes "To Do / In Progress / Done" or assumes
three priorities.

**Violations:** a board that breaks with seven statuses; a hardcoded
colour map; a status shown by its raw key instead of its label.

## P4 — Errors name the thing, the reason, and the next action

Every failure states what failed, why, and what the user can do — in
their terms, at the place it broke. No bare toasts, no swallowed
failures.

**The rare exception:** sometimes the cause genuinely cannot be
determined (an opaque runtime fault, a truncated response, an unknown
error shape from a dependency). An unattributable error is permitted
*only* then, and even then it must still be honest about three things:
what was attempted, what state the user's data is now in (saved? not
saved? partially?), and what the user can do next (retry, reload, check
the file). A message that omits those is a violation regardless of how
unknown the cause was. This exception is the edge case, never the
general case — if it fires on a routine path, that's a bug in the error
handling, not an acceptable outcome. See
[flow-error-handling.md](flow-error-handling.md) § F.

**Violations:** a red toast with a stack trace; a query error that
returns zero results instead of highlighting the bad token; a save that
fails silently and looks like it worked; "Something went wrong" on a
path where the cause was known.

## P5 — Destructive actions are proportionate to their blast radius

Reversible actions (archive, unarchive, field edits) happen immediately
and are undoable. Irreversible ones (delete, bulk delete) demand
deliberate confirmation scaled to what's being destroyed. Nothing
irreversible ever happens on a single misclick.

**Violations:** bulk-delete of 40 tasks behind one OK button; archive
demanding a typed confirmation it doesn't need; a confirm dialog whose
default focus is the destructive button.

## P6 — Empty, loading, partial, and broken are designed states

A fresh tracker, a filter matching nothing, a slow request, an
unreachable server, and a malformed task file each have an intentional
presentation that says what's happening and what to do.

**Violations:** a blank white pane; a spinner with no timeout; one
corrupt task file taking down the whole list.

## P7 — Configuration drift is surfaced, not crashed on

Users edit YAML by hand and upgrade LocTT between sessions. Schema
mismatches, deleted statuses still referenced by tasks, archived users
assigned to work, and stale saved-view references degrade gracefully
with a visible explanation.

**Violations:** a task referencing a deleted status rendering as blank;
the sidebar crashing because a pinned view was removed from
`queries.yaml`; a pinned view *vanishing silently* because it was
removed from `queries.yaml`.

**No carve-out for per-user preference drift.** "Surfaced" means the
same thing whether the drift is in shared config or in one user's
settings: a pinned view deleted from `queries.yaml` tells the user it
was removed rather than disappearing. Silently pruning a preference is
still drift the user cannot account for. This resolves the
SHL-32 / SET-13 / SET-27 / XS-28 disagreement in favour of the
explaining cases — SHL-32, PRU-14 and NEW-16 asserted silent dropping
and are corrected.

## P8 — Frequent paths are fast and keyboard-reachable

The things done fifty times a day — create, search, filter, change
status, open a task — are reachable without hunting and don't require a
round-trip through a modal when inline would do.

**Violations:** create-task buried three clicks deep; no `Esc` to close a
panel; a status change requiring a full page load.

## P9 — Scale is a first-class case

The tracker holds 10 tasks on day one and 5,000 in year two. Lists
paginate, counts are honest, long titles and 20-label tasks don't break
layout, and bulk operations report partial success accurately.

**Violations:** a label row pushing the due date off-screen; "Showing
1–50 of 128" when the filter matched 1,280; a bulk archive that
half-fails and reports success.

## P10 — Three front-ends, one mental model

A concept means the same thing in the UI as in the CLI and MCP. Same
query language, same field names, same key semantics, same
archive/delete distinction. The UI may present things more richly but
must not invent divergent concepts.

**Violations:** a UI-only "Done" filter that doesn't correspond to any
status category; a search box that accepts syntax `loctt list` rejects.

---

## Principle → flow index

Reverse lookup: change something, find what it might break.

| Principle | Flows that lean on it hardest |
|---|---|
| P1 Files are truth | [cross-surface](flow-cross-surface.md), [tasks](flow-tasks.md), [git-sync](flow-git-sync.md) |
| P2 URL is the view | [list](flow-list.md), [app-shell](flow-app-shell.md), [saved-views](flow-saved-views.md) |
| P3 User's vocabulary | [settings](flow-settings.md), [board](flow-board.md), [tasks](flow-tasks.md) |
| P4 Errors | [error-handling](flow-error-handling.md) — and every flow's § C |
| P5 Destructive | [bulk](flow-bulk.md), [tasks](flow-tasks.md), [projects-users](flow-projects-users.md) |
| P6 Designed states | [onboarding](flow-onboarding.md), [error-handling](flow-error-handling.md) |
| P7 Config drift | [cross-surface](flow-cross-surface.md), [settings](flow-settings.md) |
| P8 Fast paths | [accessibility](flow-accessibility.md), [task-create](flow-task-create.md) |
| P9 Scale | [list](flow-list.md), [board](flow-board.md), [bulk](flow-bulk.md) |
| P10 One mental model | [cross-surface](flow-cross-surface.md), [saved-views](flow-saved-views.md) |
