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

### REL-15 · Escape does not cancel a keyboard relationship reorder

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

### REL-33 · A stale-page rerank is not refused (deliberate decline)

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

### `createTask` hard-codes the tree relationship key, and `parent` is dead plumbing

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

`apps/web/src/client/milestones/ProgressReadout.tsx` sets a literal
`aria-label="Milestone progress"`. Not a live bug — both current callers
are milestone surfaces — but the label must become a `label` prop
(default "Milestone progress") **before** a tree-child-progress or
sprint caller is added, or that caller will announce "Milestone
progress". Fold into the work that adds the new caller.

### The server's private `dslAtom` copy under-quotes grammar-colliding values

`apps/web/src/server/server.ts` defines its own `dslAtom` with a plain
regex (`^[A-Za-z_][A-Za-z0-9_.-]*$` → bare, else quoted), separate from
core's `packages/core/src/query/serialize.ts`, whose `dslAtom` delegates
to `isBareSafe` — a re-tokenize check that guarantees the atom round-trips
to a single token. So a facet whose value is a bare keyword/number/
date-shaped string (`"true"`, `"123"`, `"and"`, …) would still
under-quote on the server copy and break on reparse.

**Latent, low-risk:** no current facet feeds such a value (facet values
are ULIDs and config-controlled enum keys), so it is not a live defect —
but it is the class core already fixed for its own producer.

**Fix:** replace the server's private `dslAtom` with an import of core's
(the browser-bundle constraint that kept them separate does not apply
server-side), giving one tokenizer-checked quoter across all producers.

### An attachment name that differs only by case aliases on macOS

`DELETE /api/tasks/:ref/attachments/DROP.TXT` deletes `drop.txt` on a
default macOS volume, because APFS is case-insensitive: `unlink` resolves
the alias and core's `detachFile` reports success, writing an
`attachment_removed` history entry naming `DROP.TXT` — a name never on
disk. Symmetrically, uploading `README.md` over an existing `readme.md`
throws `AttachmentExistsError` on macOS but on a case-sensitive Linux
volume keeps both as distinct files. The behaviour differs by
filesystem, which is the problem.

Not fixed: the honest fix is core normalising or refusing names that
collide case-insensitively with an existing attachment, which changes
what the CLI and MCP accept too. No REL case covers case-folding.

### A displaced body is not carried by a later backup (BAK-C13)

`restore --overwrite` preserves the body it displaces as
`.loctt/tasks/<id>/displaced-body-<ulid>.md`, named in the report. That
file is **not** picked up by a subsequent `loctt backup`: the export
(`packages/core/src/backup/export.ts`) carries `task.md`,
`_comments.yaml`, `_history.yaml` and the contents of `attachments/`,
and a displaced body is none of those (it is written into the task dir,
not `attachments/`). So "overwrite-restore, then back up, then restore
elsewhere" loses the preserved text.

**Not fixed, deliberately** — the alternatives each need a decision (a
dedicated record kind is the clean fix but adds a format shape no case
describes). **Mitigation today:** the path is in the restore report and
the file stays on disk, so it survives everything except a round-trip
through a backup.

**Reproduce:** restore with `--overwrite` over a task whose body
differs, confirm `displaced-body-*.md` exists, then `loctt backup` and
grep the JSONL for its text — absent.

### MSL-35 · Milestone progress cannot fail per row (documented ceiling)

MSL-35's last bullet wants a failed progress computation to show an error
in place of the numbers for one milestone **while other milestones' rows
keep rendering their own progress**. That last part cannot happen as the
server stands: progress is computed from **one shared corpus scan**
(`milestoneProgress` / `referenceProgress`), which either succeeds for
every milestone or throws for all of them — there is no per-milestone
failure mode.

The client half is fully built and unit-tested: `progressState(undefined)`
returns `kind: "unavailable"`, and `ProgressReadout` renders a named,
retryable error in place of `0 / 0`. The whole-list failure path has a
`(MSL-35, partial)` UI test. Building a `progress | {error}` per-row
shape would be building for a failure that cannot occur, so this is left
as documented-partial rather than a speculative per-milestone endpoint.
Revisit only if a real per-milestone computation is ever introduced.

## Security / hardening (agent-facing surface + local server)

The threat model is an agent driving MCP (possibly auto-approved,
possibly steered by untrusted task content) and a human viewer of
agent-authored content, against a 127.0.0.1-bound server. The must-fix
path-confinement and packaging findings from the 2026-09-19 audits are
resolved (decisions.md A205–A207); what remains open is below.

### F1's confinement boundary is the project root, not `.loctt/`

`attach_file` confines the source read to the tracker root (the project
working dir), so `~/.ssh/id_rsa` (outside root) is blocked — but a
steered agent can still attach a non-dotfile secret sitting **beside**
`.loctt/` (e.g. `credentials.txt`, `config/prod.json`) and, under
git-backed mode, auto-commit it to the loctt branch. This is within the
stated "confine into the repo" boundary (A205), not a bypass.

**Ken's call / should-fix:** narrow the MCP safe zone to `.loctt/`
(`confineToRoot: locttDir`) if in-repo-but-outside-`.loctt/` secrets are
in scope for the threat model.

### The local server has no Host/Origin validation (DNS-rebinding)

Binding 127.0.0.1 defeats direct off-machine access (verified: the LAN IP
refuses) but **not** DNS rebinding. `requireCsrfHeader` only guards
non-GET methods, and `handleRequest` never validates the `Host` or
`Origin` header (confirmed by inspection: no Host allowlist anywhere in
`apps/web/src/server/server.ts`). A public page the user visits could
rebind its hostname to 127.0.0.1 and issue **GET** requests to
`/api/tasks`, `/api/config`, `/api/doctor`, etc.; because the page is now
same-origin with the rebound host, SOP no longer protects the response
and the CORS default-deny does not help. Result: an off-machine page
reads the whole tracker as long as the port is known and open.

**Not yet reproduced end-to-end** (rebinding needs a controlled DNS
record); the code path is confirmed by inspection. **Mitigation to
decide + test:** validate `Host` against `127.0.0.1` / `localhost[:port]`
on every request before routing (a few lines), with a red-proven test
that a GET carrying a foreign `Host` header returns 403. Lower severity
(needs the user to visit a hostile page); deferred to Ken.

### The multipart upload route has no direct hostile-filename tests

The path-confinement testers exercised core `attachFile` directly, not
the HTTP route. Probing the route empirically shows it degrades safely —
`basename('..')` → `'..'` makes the temp path a directory that
`attachFile` rejects; backslash names stay inside the per-request mkdtemp
dir; the final stored name goes through `assertSafeBasename`. **Not a
path escape.** Should-add (not must-fix): direct route tests for `..`,
backslash, empty, and truncated multipart names.

### No size cap on the markdown render path

The markdown renderer is O(n) with no size cap, so a multi-MB body could
jank (not crash) the view. Minor; note only.

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
  the advanced surface); the Timeline chart disappears entirely with data
  at 390; the sidebar collapses to a rail of emoji/dots with no tooltips;
  the mobile drawer covers its own toggle with no scrim/focus-trap/close
  and is not a `dialog`.
- **Desktop major:** the Timeline chart does not fill the viewport —
  Month zoom renders ~128px wide and titles truncate to 1–2 chars (only
  Day zoom is usable), because "zoom = column width" clamps the range to
  the data span instead of filling; the bulk-actions bar renders inline
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

## Cannot be satisfied yet (unsatisfiable-case roster)

These cases have no @verifies tag on purpose — the capability they assert
cannot exist on the current build. Do not tag them; do not re-report them
as uncovered gaps. The authoritative uncovered set is whatever
`npm run cases:coverage` prints; as of this writing it is exactly the ten
cases named below (the six schema cases, A11Y-9, ERR-23, ERR-32, and
MSL-35, which has its own section above).

### Schema-migration cases wait on the first schema bump

`CURRENT_SCHEMA_VERSION` is still **1**, so there is no real migration to
run. **SET-15, SET-31, SET-37, XS-36, XS-38, XS-48** describe behaviour
during or after a schema migration and become testable for free the
moment `CURRENT_SCHEMA_VERSION` first advances past 1. Not a phase item —
a natural unblock. (XS-43/44/45 were once grouped here but depend on the
rekey engine, which shipped; they are now covered by
`tests/ui/flow-git-rekey.spec.ts`.)

### A11Y-9 · full keyboard operation of the task list

The `ui/Menu` half is built (roving arrow-key focus + type-ahead). What
remains is the list itself: task rows in `ListView.tsx` are still
click-only (a bare `<tr>` with `onClick`, no `role`/`tabIndex`/key
handler), the status dropdown lacks arrow traversal, and nothing restores
focus to the opened row on Back. A11Y-9 stays uncovered until row
focusability is built — an a11y feature, and a11y blocks publish (K74).

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
