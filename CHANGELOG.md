# Changelog

All notable changes to LocTT are documented here. The format is loosely
based on [Keep a Changelog](https://keepachangelog.com/); versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### 0.4.0: run `loctt migrate` once

`loctt` 0.4.0 changes the tracker format to `0.4.0`. **Run `loctt migrate`
(or press **Upgrade** in the web UI) once on each tracker**; until then
every command, MCP tool and the web UI say "This tracker needs upgrading
from 0.3.0 to 0.4.0." The upgrade backs `.loctt/` up first, then moves each
person's sidebar settings to the one **Views** section: built-in and saved
views keep the order and the hidden choices they had, pinned views lead
the saved views, and the retired pinned-views setting is removed. Only
the per-user `settings.yaml` files change. A tracker at 0.1.0 is upgraded
through 0.3.0 to 0.4.0 in the same run.
See [Upgrading](docs/user/common/upgrading.md).

- Sidebar settings written before this release are no longer converted
  each time they are read. One left in a settings file after the upgrade
  (a hand edit, a restored copy) is ignored: the sidebar shows the default
  layout, and `loctt doctor` names the file and says to reset the layout
  (Settings → Customize sidebar → Reset to default, or
  `loctt user sidebar-groups --reset`). A `sidebar_pins` line is likewise
  ignored and reported, and goes the next time the settings are saved.
- Restoring a backup taken at an older format (0.1.0 or 0.3.0) upgrades
  the restored data as part of the restore, with the steps
  `loctt migrate` runs, on the CLI, over MCP and in the web UI. The
  preview (`--dry-run`, `dry_run`, **Preview (dry run)**) lists the steps
  and what each changes, and the result says the data was upgraded. The
  steps run on a copy of the backup's data first, so if one fails nothing
  is restored. A backup from a newer format is still refused. See
  [Upgrading](docs/user/common/upgrading.md#restoring-a-backup-taken-at-an-older-format).

### Format 0.3.0 (ordered links)

This release changes the tracker format (to `0.3.0`). **Before you use it
on a tracker made by `loctt` 0.2.x or earlier, change
`.loctt/.schema-version` from `1` to `0.1.0` once** (on every machine and
clone), then run `loctt migrate` (or press **Upgrade** in the web UI) to
upgrade the tracker, which backs it up first.
See [Upgrading](docs/user/common/upgrading.md).

### Breaking

- `.loctt/.schema-version` now holds a format version, the `loctt`
  release that introduced the format (`0.3.0`), instead of a counter. A
  file holding `1`, anything else that is not a format version, or
  nothing is refused with a message saying what it must contain. A
  tracker in a newer format is refused with "This tracker needs loctt
  <version> or newer."
- The `ranked` setting on relationships is gone: every kind of link is
  ordered. `loctt relationship add/edit` no longer take `--ranked`, MCP
  `edit_workflow_entity` ignores `fields.ranked`, and the setting is gone
  from Settings → Relationships. A `ranked:` line left in
  `workflow.yaml` is ignored and reported by `loctt doctor`.
- A backup written by `loctt` 0.2.x or earlier records its format as `1`,
  which this release doesn't read. Change `"schema_version":1` in the
  backup's first line to `"schema_version":"0.1.0"`, then restore it: it
  is upgraded as part of the restore.

### Fixed

- `loctt rerank … --after`/`--before` (and MCP `reorder_relationship`, and
  dragging on the task page) put the link in the wrong place among
  siblings that had never been reordered; every link now keeps its place,
  so a move lands exactly where asked, on every kind of link.

- `loctt create --parent` (and MCP `create_task` with a parent) stored the
  parent's key instead of linking properly; `loctt doctor --fix` repairs
  trackers affected by it. A create with a parent now stores the parent's
  id and adds the child link on the parent, exactly as `loctt link` does,
  and a parent that doesn't exist or is archived is refused with nothing
  created.
- Deleting a task left every task it was linked to with a link pointing at
  nothing. Delete now removes the other side of each link in the same
  operation and records it in that task's history.
- A link stored as a task key that more than one task has held could not
  be removed; `unlink` (CLI, MCP and the web) now removes it by that key.
- `loctt set` could not write number, boolean or multi-value custom
  fields, or change a task's labels: it now converts the value by the
  field's type, takes comma-separated lists, and accepts `fields.<key>`.
- `loctt show` printed the assignee and reporter as IDs; it prints names.
- `loctt doctor` warned about the key index after an ordinary create or
  delete; both now keep it in sync.
- A query naming a label, user, milestone, sprint or project
  (`labels = urgent`) matched nothing; names now resolve on every
  surface, and a name that matches nothing, or several things, is an
  error rather than an empty result.

- `loctt init --repair` over a tracker that had lost `config/` made a new
  project, so every surviving task pointed at a project that no longer
  existed; it now rebuilds `projects.yaml` with the ids the tasks and
  `state.yaml` still use.
- `loctt doctor` said a task file that won't parse was missing from the
  key index and told you to rebuild it, which could not help; that file
  is reported once, as unreadable.
- On a tracker you can't write to, every change waited about four seconds
  before saying so; it now says at once that it's a permission problem.
- Dropping a card on a sprint deleted elsewhere showed the sprint's
  internal ID; the sprints board now says the sprint no longer exists.

### Changed

- Git sync refuses a branch whose `.schema-version` is `1` (or anything
  else that isn't a format version), and ranks links that arrive without
  a place, so `loctt doctor` has nothing left to report after a sync.
- A value that isn't shaped like an ID is only ever read as a name; it is
  no longer tried as an exact ID when no name matches.
- Every link keeps its place: a new link goes to the end of its kind's
  list, and `loctt show`, MCP `get_task` and the task page list links in
  that order until you move them. Every group on the task page (except
  the Children tree) has drag handles, `Relates to` included.
- `loctt doctor` reports a link with no stored place (a hand-edit), and
  `--repair-relationships` gives it one.
- Names and IDs are told apart by shape: a value shaped like an ID is an
  ID, anything else is a name. Creating or renaming a label, user,
  milestone, sprint, project or saved view with an ID-shaped name is
  refused. An ambiguous name is refused listing each match with its ID.
- The CLI prints names (`log`, `sprint burndown`, edit confirmations);
  MCP results add names beside the IDs they return (`assignee_name`,
  `label_names`, `actor_name`, …) without changing existing fields.

### Added

- Intentional format upgrades: a tracker in an older format is refused on
  every surface with "This tracker needs upgrading from 0.1.0 to 0.3.0.
  Run `loctt migrate` (a backup is made first)." and nothing is written
  until you upgrade it. `loctt migrate` shows a preview (each step in
  plain words and where the backup goes) and asks before upgrading
  (`--yes` for scripts, `--dry-run` to preview only; without a terminal
  and without `--yes` it refuses). The web UI shows an **Upgrade** screen
  in place of the app, whose button backs up, upgrades and reloads. MCP
  tools return the same message, and the MCP instructions tell agents to
  ask you before calling `migrate_schema`. `loctt doctor` and `info` (and
  MCP `doctor`/`info`) report the pending upgrade and write nothing;
  doctor's repairs are skipped until the tracker is upgraded.
- `loctt doctor --repair-relationships` (MCP `doctor` with
  `repair_relationships`, and a **Repair relationships** button in
  Settings → Diagnostics): changes links stored as a task key to the
  task's id, adds the missing side of one-sided links (refusing one that
  would create a loop), and merges duplicate links. It never removes a
  link.
- `loctt doctor --fix` (MCP `doctor` with `fix`, and **Fix all** in
  Diagnostics) runs every safe repair, then reports what is left.
- `loctt show` and MCP `get_task` list relationships in the same order as
  the web task page, and MCP returns each link's `rank`.
- `loctt set WEB-1,WEB-2 labels --add urgent` (and `--remove`,
  `--create`), and MCP `bulk_update_tasks` with `add` / `remove` /
  `create_missing`: one list edit on many tasks, reported like bulk set.
  Every task that can change does, and each one that can't is listed.

## [0.1.0] — Initial release

First public release of LocTT — a local-first, single-user task tracker
that stores tasks as plain markdown + YAML files under `.loctt/`, with
three surfaces over one shared core: a CLI, an MCP server, and a web UI.

### One package: `loctt`

- **Install one package and get all three surfaces.**
  `npm install -g loctt` gives you the `loctt` command: the CLI,
  `loctt ui` for the web UI and `loctt mcp` for the MCP server. They
  always run the same version, so two surfaces can never disagree about
  the on-disk format.
- **Replaces `@loctt/cli` and `@loctt/mcp`.** Early builds were published
  under those names. If you installed one, run
  `npm uninstall -g @loctt/cli @loctt/mcp` and then `npm install -g loctt`.
  In MCP client configs, use the command `loctt` with the argument
  `mcp`, or `npx -y loctt mcp`. See
  [docs/user/common/upgrading.md](docs/user/common/upgrading.md).

### Core

- **File-backed data model** — tasks are `task.md` (YAML frontmatter +
  markdown body); workflow, projects, labels, milestones, sprints, saved
  views and calendar live in `.loctt/config/`. Stored enum values use
  config keys, not labels.
- **Task identity** — a stable internal ULID `id` plus a user-facing
  `key` (e.g. `T-123`); a renumbered key stays resolvable via
  `key_history`.
- **Configurable workflow** — statuses, priorities, task types and
  relationship kinds are defined in `workflow.yaml`; custom fields can be
  scoped to task types.
- **Degrade, don't crash** — a corrupt field is surfaced and kept,
  never silently dropped or allowed to take down a read; `loctt doctor`
  reports integrity findings.

### Query language

- Jira-inspired DSL: field/operator/value with `and`/`or`/`not`,
  parentheses, `in`/`not in`, `~` substring, `is empty`/`is not empty`.
- `currentUser()` and date functions (`today`, `now()`,
  `startOf`/`endOf` Day/Week/Month with signed offsets), resolved against
  the workspace timezone.
- Relationship queries (`has_link`, `link_count`, `parent`) and a
  `comment_mentions` field.
- `text ~` searches titles, bodies, searchable custom fields, and retired
  keys.
- Saved views; a visual query builder in the web UI over the same DSL.

### Web UI

- List, board, and timeline views; the timeline virtualizes large
  datasets. Task detail with a rich markdown body editor (including GFM
  tables), comments with @-mentions, attachments with inline image
  previews, relationships, and milestones/sprints.
- Settings for every config surface, with broken entries surfaced and
  repairable rather than hidden.
- A global data-integrity badge linking to Diagnostics.
- Deep-linking, keyboard navigation, and WCAG-AA-oriented accessibility.

### CLI & MCP

- Full task CRUD, querying, config management, history, and git
  operations across both surfaces (core/surface parity).
- MCP exposes structured tools for agent use; corruption/health travels
  through the CLI and MCP task shapes, not only the web UI.

### Git Sync (optional)

- Publishes tasks to a configurable branch via a temporary worktree.
  Off by default; enable per tracker.
- Three-way (base/local/remote) sync that never blindly deletes
  local-only tasks; per-field conflict reconciliation; a delete-vs-edit
  reconcile row.
- Key-collision rekeying with a preview + confirm in the UI (CLI/MCP
  auto-apply and report); old keys preserved in `key_history`.
- Data-safety guards: no `--force` push (LocTT can never clobber a
  remote), force-push / history-rewrite detection (detect + refuse),
  newer-remote-schema refusal, foreign-branch refusal, named
  missing-worktree and malformed-remote errors, and push/fetch error
  classification (auth vs non-fast-forward vs unreachable).
- A proactive advisory when the tracker sits on a filesystem where POSIX
  advisory locks are unreliable (iCloud Drive, Dropbox, OneDrive, NFS,
  SMB) — see [docs/user/common/git-sync.md](docs/user/common/git-sync.md).

### Security model

- Single-user, local-first: the web server binds to `127.0.0.1` only,
  with no authentication and no multi-user model. See
  [SECURITY.md](SECURITY.md).

### Polish and refinements (pre-publish waves 3–4)

- **Keyboard shortcuts have off switches.** Settings → Personal →
  Keyboard, and the `?` dialog's in-dialog settings view, let you turn
  single-key shortcuts off entirely, or one at a time, with a "Reset to
  default" option. No rebinding — the keys are fixed, but every one can
  be switched off if it collides with something else on your machine.
- **The description editor saves only on Save.** Editing a task's body no
  longer autosaves on every keystroke; Save commits it, clicking away
  keeps you in the editor, and Escape cancels the edit. An unsaved draft
  is kept for the tab (not written to disk) so a reload doesn't lose your
  work.
- **Sprints and milestones dropped the countdown and overdue styling.**
  Sprint cards and milestone rows no longer show "N days left" / "N days
  overdue" countdowns or red overdue badges — LocTT tracks state changes
  you make explicitly rather than nudging you about dates. Sprint state
  (future/active/completed) can also now move freely in either direction
  on every surface; task due dates in the list and board no longer turn
  red when overdue, either.
- **Clearer messages throughout.** An app-wide pass rewrote error,
  confirmation, and status messages to state the outcome plainly without
  editorializing — including delete confirmations, timed-out-save
  warnings (which now say plainly whether it's safe to retry), and a
  "several unreadable candidates" error that now gives each file its own
  reason instead of repeating one path.
- **Sidebar customization gained a "Filters" group.** The built-in
  sidebar filters (Assigned to me, Overdue, etc.) are now grouped under
  one collapsible "Filters" row in the Customize-sidebar panel, while
  staying individually reorderable and hideable underneath it.
- **Accessibility fixes:** dialogs consistently trap and restore focus,
  menus can be driven with the arrow keys, loading regions announce
  themselves to screen readers, and disabled switches now look visibly
  disabled in dark mode as well as light.
