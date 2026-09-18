# Changelog

All notable changes to LocTT are documented here. The format is loosely
based on [Keep a Changelog](https://keepachangelog.com/); versions follow
[Semantic Versioning](https://semver.org/).

## [0.1.0] — Initial release

First public release of LocTT — a local-first, single-user task tracker
that stores tasks as plain markdown + YAML files under `.loctt/`, with
three surfaces over one shared core: a CLI, an MCP server, and a web UI.

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
- **Degrade, don't crash (P-11)** — a corrupt field is surfaced and kept,
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
