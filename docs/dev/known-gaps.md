# Known gaps

Defects and documentation holes that are real, understood, and not yet
fixed, plus the roster of cases that cannot be satisfied on the current
build. Each says what is wrong, where the fix belongs, and how to
reproduce it, so it can be picked up without rediscovering it.

This file is not a feature backlog, and not a place for things that
merely might be wrong. **Check here before reporting a defect or an
untestable case as new**, and delete an entry the moment it is fixed.
Diagnostic war-stories about the test harness (flakes, contention,
machine-state traps) live in `lessons.md`, not here.

## Code defects

### REL-15 · Escape does not cancel a keyboard relationship reorder — FIXED

**Fixed** (2026-09-19). `FlatGroup` now uses a pickup buffer: arrow keys
move the picked-up row *visually only* (a local `{origin, current}`
state that overrides the rendered order), the rerank is committed as a
single `onMove(origin, current)` on drop (Enter/Space), and Escape drops
the buffer to restore the origin with no write. Covered by
`RelationshipsPanel.test.tsx` (arrows buffer without writing; Escape
restores + zero rerank calls; Enter commits exactly one) — all three
red-proven against the old write-per-arrow code — and the `tests/ui`
REL-15 spec was extended with the Escape case (asserts position 1 and
zero `/rerank` requests). The `moveUp`/`moveDown` e2e helpers were
updated to press Enter to commit (they previously waited for a write per
arrow).

Original report follows.

`apps/web/src/client/relationships/RelationshipsPanel.tsx`. Two problems
make REL-15's third bullet ("Escape restores the original position
without a write ever leaving") unmet:

1. `keyboardMove` calls `onMove(from, to)` on **every** arrow press, so
   each keystroke is a real rerank write — there is no pickup buffer.
2. The Escape branch only sets `grabbed = null` and announces "Move
   cancelled"; it performs **no restoring move**, and `grabbed` was
   overwritten with the current position on the first arrow, so the
   origin it would need is already gone. The comment above the branch
   describes a restore that the code never does.

**Reproduce:** open a task with three ranked relationships, focus a
reorder handle, press ArrowDown twice, then Escape. Expected: the row
returns to position 1. Actual: it stays at position 3, and the file on
disk has two rerank writes.

**The trap for whoever fixes this:** a test asserting only the "Move
cancelled" announcement passes against the broken code. Assert the row's
position *and read the task file* — the writes are the half that escaped.
The existing REL-15 test (`tests/ui/flow-relationships.spec.ts`) is not
vacuous, just partial: it never presses Escape, so it covers bullets 1
and 2 and needs extending, not replacing.

### REL-33 · A stale-page rerank is not refused — FIXED

**Fixed** (2026-09-19). `reorderRelationship` now resolves the
relationship definition from workflow config (loading it itself when the
caller does not pass `workflowConfig`, as `reorderBoardRank` already
does) and throws a `ReorderError` naming the kind when the definition is
absent or not `ranked`. The guard therefore fires on every surface — the
web route maps `ReorderError` to a 400, and CLI `rerank` / MCP inherit
the same refusal — without the server route (owned elsewhere) needing to
thread the config through. Covered by two tests in `reorder.test.ts`
("refuses a rerank when the kind is no longer ranked", red-proven by
disabling the ranked guard; "refuses … not declared in workflow.yaml").
The existing `tests/ui` REL-33 spec (handles disappear, ranks preserved)
is unaffected. There was no literal `test.fixme` in the tree for the
core refusal; a proper red-proven test was added instead.

Original report follows.

REL-33's second bullet — "a drag against a stale page is refused with a
message that the kind is no longer ranked" — needs a check that exists at
no layer. `reorderRelationship` (`packages/core/src/rank/reorder.ts`)
never loads the workflow config and never reads the relationship's
`ranked` flag. (The `loadWorkflowConfig` + `ranked` logic nearby belongs
to `reorderBoardRank`, a different function for board columns.) Measured:
set `blocks` to `ranked: false`, then
`POST /api/tasks/T-1/relationships/blocks/T-3/rerank {"before":"T-2"}`
answers **200** and writes the rank.

The other two bullets are built and tested (handles come from live
config so they disappear on refresh; existing rank values are untouched).

**Why not built:** the guard would make `reorderRelationship` start
loading and enforcing workflow config — a new refusal on a shared core
path the CLI's `loctt rerank` and any future MCP tool inherit (a scope
change, stopped rather than invented). The fix: give
`reorderRelationship` the `workflowConfig` its sibling `linkTask` already
takes, and throw a `ReorderError` naming the kind when the definition is
absent or not `ranked`. The web route already maps `ReorderError` to a
400. The spec is `test.fixme` — it runs, expects to fail, and starts
passing loudly when core is fixed.

### `createTask` hard-codes the tree relationship key, and `parent` is dead plumbing — FIXED

**Fixed** (2026-09-19). (1) `create.ts` now resolves the tree axis with
`workflowConfig?.relationships.find(r => r.graph === "tree")?.key`,
falling back to `"parent"` only when no config is supplied. (2) `--parent`
is exposed on CLI `create` and `parent` on the MCP `create_task` tool.
Covered by `create.test.ts` (uses the config's renamed tree key, not a
hard-coded `parent` — red-proven; and the no-config fallback) and by two
CLI/MCP parity cases in `tests/integration/cli/create-field-parity.test.ts`.
CLI and MCP reference docs updated. The web create route/modal are owned
by other agents and were not touched.

Original report follows.

Two related gaps found in the Jira-comparison review:

1. **`createTask` hard-codes `"parent"`.** `packages/core/src/task/
   create.ts` pushes `{ type: "parent", target: options.parent }` instead
   of resolving the `graph: "tree"` relationship from `workflow.yaml`.
   Invisible only because the shipped default tree axis is *named*
   `parent`; wrong for a renamed tree axis. A P3 (config-driven, not
   hard-coded) violation. Fix:
   `workflow.relationships.find(r => r.graph === "tree")?.key`.
2. **`CreateTaskRequest.parent` is dead plumbing on every surface.** Core
   accepts `parent` (`packages/contracts/src/service.ts`,
   `create.ts`) but no surface sends it: CLI `create` does not, MCP
   `task-crud` create has no `parent` param, and the web create
   route/modal never send it. A create-pre-linked "+ New child" needs
   this plumbed through all three surfaces.

### `ProgressReadout` hard-codes `aria-label="Milestone progress"`

**Fixed** (2026-09-20, L4). `ProgressReadout` now takes a `label` prop
(default `"Milestone progress"`, so the milestone/sprint callers are
unchanged), and the new tree-child-progress caller
(`RelationshipsPanel`) passes `label="Child progress"`. Covered by
`apps/web/src/client/milestones/ProgressReadout.test.tsx` (default and
override, red-proven against the old literal). Fixed as part of the L4
child-progress-meter work, exactly as this note asked.

Original report follows.

`apps/web/src/client/milestones/ProgressReadout.tsx` sets a literal
`aria-label="Milestone progress"`. Not a live bug — both current callers
are milestone surfaces — but the label must become a `label` prop
(default "Milestone progress") **before** a tree-child-progress or
sprint caller is added, or that caller will announce "Milestone
progress". Fold into the work that adds the new caller.

### ~~The server's private `dslAtom` copy under-quotes grammar-colliding values~~ RESOLVED (2026-09-20, A227)

The server's private `dslAtom` in `apps/web/src/server/server.ts` was
deleted and replaced with `import { dslAtom } from "@loctt/core"` (the
tokenizer-checked one). One quoter across all producers; a bare
keyword/number/date-shaped filter value now quotes so it round-trips to
one token. Covered by `server.tasks.test.ts` ("Fix 1" cases,
red-proven).

### ~~An attachment name that differs only by case aliases on macOS~~ RESOLVED (2026-09-20, A224)

Fixed in core (`packages/core/src/task/attachments.ts`), so CLI/MCP/web
all inherit it:
- `detachFile` now resolves the ACTUAL on-disk dirent case-insensitively
  (`findRealAttachmentName`), unlinks that file, and records the real
  name in history — never a casing that was never on disk.
- `attachFile` REFUSES a name that collides case-insensitively (but not
  exactly) with an existing attachment, throwing the new
  `AttachmentCaseCollisionError` regardless of `force` — deterministic
  across case-sensitive and -insensitive filesystems.
- The refusal is a parity change: a case-colliding attach now refuses on
  CLI and MCP too. Registered in both surfaces' KNOWN_DOMAIN_ERRORS and
  the web attach route (409). Red-proven in `attachments.test.ts`.

### ~~A displaced body is not carried by a later backup (BAK-C13)~~ RESOLVED (2026-09-20, A226)

The exporter now carries any `displaced-body-*.md` files in a task's
directory on the task record (`displacedBodies`, an optional
`{name, content}[]` — task-dir content alongside task.md/comments/
history/attachments, NOT a new top-level record kind), and restore
re-lands them through the same staged swap. "Overwrite-restore → backup
→ restore elsewhere" now preserves the text. Names validated up front in
`assertBackupContained`. Red-proven in `restore.test.ts` (BAK-C13
carry).

### A saved view whose `conditions` block is missing/corrupt is object-fatal, not per-field-degraded

Since saved views gained a structured `conditions` tree (Stage 1 of the
structured-conditions work), `SavedQuerySchema` requires `conditions`. A
hand-edited `queries.yaml` entry that is missing or has a malformed
`conditions` block therefore fails schema validation as a whole. A broken
**DSL `query`** still degrades gracefully to a `BrokenSavedQuery` marker
(the entry is listed, marked, still clickable), but a broken/missing
**`conditions`** block does not yet have that per-field degradation — it
takes the entry out at the object level.

To reproduce: hand-edit a `.loctt/config/queries.yaml` entry to delete its
`conditions:` key (or make it a non-tree value) and load the tracker. Per
the corruption-handling guide this should degrade like a bad `query`
string does (mark the one entry broken, keep the rest), not fail the
entry's schema. Deferred out of Stage 1 scope; revisit alongside the
`BrokenSavedQuery` path so both a bad `query` and a bad `conditions`
degrade identically.

### A211 · Value pickers over growable sets still on native `Select`/radio/pill controls

A211 standardised the searchable picker (`ui/Combobox`) and migrated the
task meta fields, the labels editor and the query builder's value
controls. These sites still pick from a set the user can grow with a
control that does not search, and were left because Playwright specs
(outside the ticket's run scope) drive them with `selectOption` /
`.check()` / direct pill clicks:

- `settings/UsersPanel.tsx` (`user-edit-timezone-<id>`) and
  `settings/CalendarPanel.tsx` (`calendar-timezone`) — ~400 IANA zones in
  a native `Select`. The clearest remaining offender.
- `settings/PreferencesPanel.tsx` (`default-project-select`),
  `settings/DeleteProjectDialog.tsx` (`project-delete-remap`),
  `task/MoveTaskDialog.tsx` ("Destination project") — projects.
- `settings/ReconcilePanel.tsx` (`git-reconcile-pick-value`) — enum
  values of the conflicting field (`flow-git-reconcile.spec.ts` asserts
  `tagName === "SELECT"`). **Evaluated 2026-09-20 (A218) and deliberately
  left:** the control's accessible name comes from the field heading via
  `aria-labelledby`, and the Batch-2 a11y unit test (`ReconcilePanel.test.tsx`)
  asserts `getByRole("combobox", { name: "Status" })`. A `<button>`-based
  `ComboboxButton` has role "button" (not "combobox") and takes `aria-label`,
  not `aria-labelledby`, so the swap needs the shared primitive's aria
  contract extended — out of that lane. Do this alongside a ComboboxButton
  `aria-labelledby` prop + updating the a11y test and the Playwright spec.
- ~~`settings/UserDeleteDialog.tsx` (`user-delete-remap-<id>`) — one radio
  per other user~~ — DONE (A218): migrated to `Combobox` (trigger
  `user-delete-remap`, per-option testids kept `user-delete-remap-<id>`),
  mirroring DeleteProjectDialog. `settings/RemapDeleteDialog.tsx`
  (`remap-to-<key>`) — one radio per alternative entry — still open.
- `create/CreateTaskModal.tsx` multi custom enum — one toggle pill per
  value (`create-field-<key>-<v>`); the detail panel's `MultiEnum` uses
  OptionPicker and so already searches past 12.
- `list/FilterDropdown.tsx` — searchable already (≥12), but on the
  `Menu`/`menuitemcheckbox` model rather than `Combobox`; its option
  lists are the 1000-capped sidebar fetches, not `?q=`.
- `list/QueryBuilder.tsx` entity values — client-filtered over the same
  capped lists; K90 parity needs `searchUsers`/`searchLabels`/… threaded
  into `BuilderConfig`.

**To fix:** swap each for `Combobox` (`ComboboxButton` trigger, keep the
testid on the trigger) and update the named specs from `selectOption` to
click-trigger → click-option.

## Security / hardening (agent-facing surface + local server)

The threat model is an agent driving MCP (possibly auto-approved,
possibly steered by untrusted task content) and a human viewer of
agent-authored content, against a 127.0.0.1-bound server. The must-fix
path-confinement and packaging findings from the 2026-09-19 audits are
resolved (decisions.md A205–A207); what remains open is below.

### ~~F1's confinement boundary is the project root, not `.loctt/`~~ RESOLVED (2026-09-20, A225, Ken-approved)

The MCP `attach_file` handler now confines the source to the RESOLVED
DATA DIR via `confineToRoot: resolveLocttDir(root)` (not a hardcoded
`.loctt` — it follows the `LOCTT_DIR` constant), narrowing the safe zone
from the project root to `.loctt/`. A secret sitting **beside** `.loctt/`
(e.g. `<root>/credentials.txt`) is now refused, closing the auto-commit
exfil path. `attachFile`'s `confineToRoot` option stays a generic
directory; the surface picks the boundary. The legitimate agent workflow
already stages the file inside the tracker first (the tool description
now says `.loctt/`), so it lands inside the data dir and still passes —
no legitimate attach broke. Red-proven in `mcp.test.ts` (attach beside
`.loctt/` refused; staged-inside attach works) and in
`attachments.test.ts` (data-dir boundary at the core level).

### ~~The local server has no Host/Origin validation (DNS-rebinding)~~ — FIXED 2026-09-19

`handleRequest` now validates the `Host` header on **every** request
(GET included) before any routing or data access, via `requireAllowedHost`
in `apps/web/src/server/server.ts`. The allowlist is the loopback names
the server legitimately serves — `127.0.0.1`, `localhost`, `[::1]`, each
with an optional `:port` (the port is not pinned; only the hostname is the
rebinding lever). Anything else returns **403** before touching data, so a
DNS-rebound hostile page — which carries its own hostname in `Host` — is
refused. There is no configurable bind host (`main.ts` always binds
127.0.0.1; only the port varies), so no external host is legitimate.
Red-proven test in `server.host-guard.test.ts`: with the guard removed a
foreign-`Host` GET routes to `/api/info` and returns 200; with it, 403,
while loopback-host GETs stay 200.

### ~~The multipart upload route has no direct hostile-filename tests~~ — FIXED 2026-09-19

Direct route-level tests added in `server.attachments.test.ts` ("hostile
filenames") for `..`, `../../etc/passwd`, backslash, absolute-path, empty,
and truncated-multipart names. Confirmed the route degrades safely (no
code change needed — **not a path escape**): `..` and empty are rejected
400 with nothing written; `../../etc/passwd` and backslash names are
stored under a safe basename (`passwd`, `evil`) inside the task's
`attachments/` dir. The tests assert the invariant directly: every
hostile name is either rejected with no attachment written, or stored
under a plain basename that never escapes `.loctt/`.

### ~~No size cap on the markdown render path~~ — N/A (client-side render)

Checked 2026-09-19: the markdown render path is **client-side** (React
elements built in `apps/web/src/client`, no server render — the server
only notes it as XSS-safe-by-construction at `server.ts` ~L1297). There
is nothing to cap server-side, so no server change was made. If a cap is
wanted it belongs in the client renderer, out of the server's scope.

## Editor / description surface (2026-09-19 review)

The `.prose-body` typography root cause is fixed (it is now defined in
`styles/index.css`). The following data-loss and correctness bugs in the
body editor are **not** fixed and were verified from source + Node
round-trips:

- **Escape while the conflict dialog or mention menu is open discards
  unsaved text.** `BodyEditor.tsx`'s window-level Escape listener cancels
  the whole edit; the dialog/menu do not `stopPropagation`. TSK-48 /
  XS-12 are meant to protect exactly this.
- **Parser rewrites prose on save.** No CommonMark flanking rules and no
  escape handling (`editor/markdown.ts`): `my_var_name` →
  `my*var*name`, `5 * 3 * 2` → italic, `\*escaped\*` → italic. A dev tool
  where snake_case is everywhere.
- **Nested / ordered lists flattened and renumbered on rich edit** — the
  parser never produces nesting and the `start` attr is lost.
- **Failed save + in-app navigation loses text.** The unmount flush only
  fires with a pending idle timer, and `hasUnsavedWork` has no consumer
  (`useBodyAutosave.ts`).
- **Rendered description is `role="button"` wrapping links** — invalid
  nested interactives, content invisible to a screen reader (an a11y
  regression against the AA posture).

**Needs Ken's ruling before building the exit gesture:** (A) keep
autosave; Escape / Cmd+Enter / "Done" all exit-keeping and drop "cancel"
semantics (keeps the K2 conflict machinery); or (B) real Save/Cancel with
local buffering, autosave demoted to draft-only. The a11y restructure
(content region + explicit Edit button) also wants a decisions.md §8
entry.

## Mobile / responsive (2026-09-19 live-UI review)

A responsive pass (GROUPS A/B/C) landed, and a subsequent full live-UI
review at 1440 + 390 found the desktop close to publish-ready but mobile
still blocked. Open items:

- **Mobile blockers:** the task-detail metadata panel renders at the
  **bottom** (below comments), so Status/Assignee are unreachable on a
  phone (`TaskDetail.tsx` grid order — a cheap `order-first
  lg:order-none`); the List Export button is clipped off-screen and the
  DSL panel wraps one word per line (needs `min-width:0` + overflow on
  the advanced surface); the sidebar collapses to a rail of emoji/dots with no tooltips;
  the mobile drawer covers its own toggle with no scrim/focus-trap/close
  and is not a `dialog`.
- **Desktop major:** the bulk-actions bar renders inline
  below a 25-row table (off-screen) rather than sticky; the query
  builder/DSL shows a parser error before any input and is unstyled.
- **Icon migration missed surfaces (A208 was incomplete):** the header
  theme switcher (`☀ ☾ ◑` ASCII), sidebar saved-filter icons, board
  visibility chips and the `⛔ Blocked` badge (red clashes with
  Critical-priority red), the `+ text` prefixes, and the query-builder
  `×`. Keep ★ (ruled) and ⚠.
- **Consistency debt:** several control heights in one viewport; Settings
  has four create patterns and two row-action patterns across sibling
  sections; tap targets below the WCAG 2.5.8 24px minimum (and 44px
  touch) on checkboxes, ×-removes, chips and metadata editors.

**Closed by the timeline redesign (2026-09-20).** Two of the above are no
longer open: the Timeline chart vanishing with data at 390 (mobile
blocker) and the chart not filling the viewport / Month zoom rendering
~128px wide (desktop major). The chart now owns the viewport with a
minimum-height floor, the unscheduled tasks moved into a collapsible
footer drawer that can no longer squeeze it, and `fillRange` widens the
date range to fill the panel at every zoom. Covered by TML-53/TML-54 and
`TimelineChart.test.tsx` ("owns the viewport"). No timeline-specific
mobile blocker remains: the drawer's phone surface is the shared `Sheet`
(`role="dialog" aria-modal`, focus-trap, inert background, Escape /
backdrop close). The "mobile drawer covers its own toggle" blocker above
is the app-shell navigation drawer, a separate component.

## Cannot be satisfied yet (unsatisfiable-case roster)

These cases have no @verifies tag on purpose — the capability they assert
cannot exist on the current build. Do not tag them; do not re-report them
as uncovered gaps. The authoritative uncovered set is whatever
`npm run cases:coverage` prints; as of this writing it is exactly the nine
cases named below (the six schema cases, ERR-23, ERR-32, and
MSL-35, which has its own section above). A11Y-9 was in this roster and
is now covered — see below.

### Schema-migration cases wait on the first schema bump

`CURRENT_SCHEMA_VERSION` is still **1**, so there is no real migration to
run. **SET-15, SET-31, SET-37, XS-36, XS-38, XS-48** describe behaviour
during or after a schema migration and become testable for free the
moment `CURRENT_SCHEMA_VERSION` first advances past 1. Not a phase item —
a natural unblock. (XS-43/44/45 were once grouped here but depend on the
rekey engine, which shipped; they are now covered by
`tests/ui/flow-git-rekey.spec.ts`.)

### A11Y-9 · full keyboard operation of the task list — COVERED 2026-09-20

Built and tagged (`@verifies A11Y-9`). The four bullets that live in the
list are satisfied and asserted, three in a real browser
(`tests/ui/flow-accessibility.spec.ts`, the "list → open → change status
→ save → back cycle" test) and the ListView-local logic in
`apps/web/src/client/list/ListView.a11y.test.tsx`:

- **Row keyboard-activatable.** The premise "rows are click-only" was
  only half true — the key cell already rendered a real `<Link>` (an
  `<a href>`), which is a native Tab stop that navigates on Enter, so the
  row was reachable by keyboard all along. What was missing was the
  focus-restore, not the activation. The row keeps the `<tr onClick>` for
  the mouse and the key link as its single, ARIA-correct keyboard action
  (no `tabIndex` on the `<tr>` — that would double the Tab stop and make
  a reader announce the row twice).
- **Status dropdown arrow traversal.** The old note said `OptionPicker`
  had no arrow handling; that is stale. OptionPicker now renders
  `ui/Combobox` (the A211 refactor), which opens on Enter/Space, traverses
  options with ArrowDown/Up/Home/End, commits on Enter and closes on
  Escape returning focus to the trigger — proven in `Combobox.test.tsx`
  and driven end-to-end (with the committed value checked on disk) in the
  A11Y-9 Playwright test. Status editing lives on the task **detail**, not
  in a list row.
- **Focus restore on return.** New: opening a task records its key in
  `sessionStorage` (bridging the list's unmount), and on returning to
  `/list` focus is restored to that row's key-link anchor. The restore
  wins over the generic route-change focus move (`useRouteAnnouncement`
  lands focus on `#main-content`; the restore treats body and that pane
  as default landings it may override, but never a focus the user placed).

**Remaining dependency (A11Y-24, not A11Y-9's to fix here):** a
successful field save on the detail page is still silent — `MetaPanel`'s
write path does not call the shell announcer (the `announcer-polite`
region exists and theme changes use it). A11Y-9's fourth bullet ("the
save outcome is announced (A11Y-24)") therefore rides on A11Y-24 landing.
The A11Y-9 Playwright test documents this with a negative assertion
(`announcer-polite` does **not** contain "saved") so the day A11Y-24 is
built for field saves, that test goes red and this note must be
revisited. A11Y-24 is itself untagged/unbuilt and is a separate publish
blocker.

### ERR-23 · no multi-step create flow exists to interrupt

ERR-23 wants a create-task submit interrupted **after** the task is
written but **before** a follow-up link/label write lands. The web create
modal makes **one** atomic `POST /api/tasks` carrying every field, so the
partial state ERR-23 describes cannot arise — creation is all-or-nothing.
The guarantee ERR-23 wants is provided more strongly than the case
assumes. It becomes live only if a future create flow gains a distinct
follow-up write.

### ERR-32 · an audit, not a @verifies test

ERR-32 asks that no routine failure lands in a developer-facing error
channel — a codebase audit of error vocabulary, not a behaviour a single
spec can assert. It is tracked as audit work, not as a coverable case.

### Toolbar redesign (A210) — e2e specs assert the OLD toolbar structure — FIXED 2026-09-20

The list-toolbar redesign (A210) removed the leading `advanced-query-toggle`
pill (advanced querying now lives at the end of the "+ Add filter" menu,
testid `advanced-open`) and made the visible-filter set configurable (only
Project/Status/Priority/Assignee show by default; the rest are added via the
picker). The unit/component suite (`src/client/list`) was updated to match
and is green.

**Resolved.** The Playwright e2e specs were updated to the new flow
(structural fix only — no assertion weakened):

- `tests/ui/flow-list.spec.ts` — added module-level `openAdvanced(page)`
  (opens `add-filter` → `advanced-open`) and `addFacet(page, id)` helpers,
  mirroring the FilterBar unit test. All six `advanced-query-toggle` clicks
  now use `openAdvanced`. The removed `advanced-query-editor` testid
  assertion (VUE-8) now asserts `advanced-query-surface` and switches to
  `advanced-query-surface` and, for the empty-`q` VUE-8 case, asserts the
  surface opens directly in `data-mode="text"` (by design: an empty query
  is "no query yet" → text box) so `dsl-input` is reachable with no mode
  switch. Label facet added via `add-filter-labels` (note the FacetKey is
  `labels`, plural, though the label reads "Label") before its pill is
  clicked (MSL-7, MSL-19).
- `tests/ui/flow-settings-projects-users.spec.ts` — Reporter facet added via
  `add-filter-reporter` before the "Filter Reporter" pill (PRU-25).
- `tests/ui/flow-task-meta.spec.ts` — two more "Filter Label" pill clicks
  (found in the same audit; same staleness) fixed the same way (TSK-11,
  TSK-55).

Export/Refresh locators were unchanged (aria-labels kept: `Export`,
`Refresh`). Typechecked clean via `npx tsc -p tests/ui/tsconfig.json`, and
every edited test was RUN headless against the built app (`apps/web/dist`)
with the per-spec tracker fixture and passed: VUE-8, the five K83 tests,
MSL-7 (both), MSL-19, PRU-25, TSK-11, TSK-55.
