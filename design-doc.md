# LocTT Design Doc

## Confirmed Scope

LocTT is a local task tracker.

Confirmed capabilities:

- tasks with arbitrary nesting and hierarchy
- relationships
- status
- deadlines
- search/query with filtering
- MCP interface
- CLI interface
- GUI with search, navigation between tasks, and timeline/Gantt-style views

## Core Product Direction

Confirmed decisions:

- `.loctt/` is the LocTT data directory
- one repo/workspace should map to one LocTT tracker
- implementation should use Node/TypeScript
- the repository should use a monorepo structure
- shared LocTT logic should live in `packages/core`
- shared API/contracts should live in `packages/contracts`
- interface apps should live in `apps/`
- intended app split should be:
  - `apps/cli`
  - `apps/mcp`
  - `apps/service`
  - `apps/web`
- CLI, MCP, and service should all operate on `packages/core` rather than going through each other
- the web GUI should talk to the local service layer rather than touching tracker files directly
- human-readable is important
- task content should be free markdown
- LocTT should work without Git
- LocTT should also work with Git
- Git integration should not depend on GitHub, Bitbucket, or a separate repo
- configuration should live under `.loctt/config/`
- configuration should use fixed file names rather than arbitrary discovered config files
- key prefix should be user-configurable, defaulting to `T-`
- LocTT should ship with light defaults and allow users or LLMs to extend configuration later
- saved queries should live in `.loctt/config/queries.yaml`
- performance should rely on indexing/caching and avoiding brute-force rescans, not on language choice alone

## Git Direction

Confirmed decisions:

- `publish` is an explicit LocTT operation
- `sync` is an explicit LocTT operation
- the canonical Git branch name is `.loctt`
- users should treat branch `.loctt` as internal and should not touch it manually
- commit IDs should be used for sync/reconciliation state
- sparse worktree is the preferred Git backend approach
- Git-backed mode should be easy to toggle on or off
- Git-backed mode should remain optional even when LocTT is used inside a Git repository
- Git-backed mode should be controlled through explicit CLI commands:
  - `loctt git enable`
  - `loctt git disable`
  - `loctt git status`

## Identity

Confirmed decisions:

- tasks have both `id` and `key`
- `key` is the user-facing reference, for example `T-123`
- deconfliction should be by `id`
- if keys clash, the later `created_at` item should be pushed to a later key number
- old keys should remain searchable
- `publish` and `sync` should warn the user when rekeying happens
- key-number allocation should use a separate state file rather than being stored directly in config
- published key-number allocation state should live in `.loctt/state.yaml`
- `.loctt/local/` should remain for machine-local non-published state only
- `.loctt/state.yaml` should stay narrow and currently only needs canonical key allocation state
- prior keys should be retained in optional `key_history` metadata so older keys remain searchable
- suggested published state shape is:
  ```yaml
  keys:
    task:
      prefix: T-
      next_number: 124
  ```

## Data Model

Confirmed decisions:

- the core entity is `task`
- tasks can nest indefinitely through hierarchy
- use `tasks` rather than `tickets`
- separate `ticket` and `epic` entities are not required
- `task_type` should be constrained, but configurable
- `status`, `priority`, `task_type`, and similar workflow values should be configurable in `.loctt/config/`
- top-level `.loctt/` structure should include `tasks/`, `local/`, and `config/`
- task queries/saved query strings can live in `.loctt/config/`
- a separate audit-trail/events directory is not required
- each task should live in its own folder under `tasks/`
- the task markdown file should be `task.md`
- attachments should live close to the task inside that task folder
- workflow values and relationship definitions should live together in one config file
- fixed config file names should include:
  - `workflow.yaml`
  - `queries.yaml`

## Content Model

Confirmed decisions:

- task body is free markdown
- acceptance criteria should not be schema-enforced
- task content should stay plain text / markdown rather than being forced into a Jira-specific structure
- LocTT should not have first-class comments
- lightweight updates/comments can be written directly in the markdown body using a simple timestamped convention with date and time, such as `[2026-04-16 14:30] comment...`

## Task Metadata

Confirmed decisions:

- structured task metadata should exist in `task.md`
- required fields are:
  - `id`
  - `key`
  - `title`
  - `created_at`
  - `updated_at`
- `status` may be omitted and should default to `Not started` when a task is first defined
- `status`, `task_type`, and similar workflow values should be configurable in `.loctt/config/`
- all other structured fields are optional
- built-in optional fields should be stored as top-level fields when present and omitted entirely when absent
- relationships should be stored as structured frontmatter data
- relationship shape should be a flat list of typed edges
- attachments should be regular files in the task folder and should not be listed explicitly in frontmatter
- new tasks should be allowed with only the minimum required fields and an otherwise empty markdown body
- task markdown can link to attachments directly

## Task Lifecycle

Confirmed decisions:

- LocTT should support both archive and hard delete
- archive should be the default and safer path
- hard delete should be an explicit stronger action
- archive should be represented separately from `status`
- archive fields should use `archived` and `archived_at`

Examples of optional structured fields include:

- `status`
- `status_updated_at`
- `task_type`
- `priority`
- `parent`
- `labels`
- `assignee`
- `reporter`
- `start_date`
- `due_date`
- `relationships`
- `estimate`
- `completed_at`
- `milestone`

## Query Language

Confirmed decisions:

- the query language should be Jira-like in feel
- it does not need to be strict JQL compatibility
- most queries should use real field names from the task metadata
- the only special query aliases currently confirmed are:
  - `text`
  - `parent`
- attachment contents and attachment filenames should not be part of default text search
- additional explicit task fields may still participate in full-text search
- saved queries should support `name`, `query`, and sort order
- saved query sorting should allow explicit priority/order when multiple sort fields are defined
- saved query sort order should use object entries rather than string shorthand
- minimum query operators should include:
  - `=`
  - `!=`
  - `<`
  - `<=`
  - `>`
  - `>=`
  - `in`
  - `not in`
  - `and`
  - `or`
  - `not`
  - `~`
- query grouping should support parentheses
- query strings should support quoted strings
- basic literals should include:
  - `true`
  - `false`
  - `today`
- traversal syntax should not be part of the initial query language
- default full-text search should include all built-in searchable/textual fields except attachments
- custom fields should participate in full-text search according to their declared `searchable` setting
- queries should support relationship-based filtering
- relationship-based querying should cover the relationship edge itself, such as relationship type and target task
- querying per-relationship metadata fields should be deferred until relationship-level metadata is actually used in the product

## Relationships

Confirmed decisions:

- relationships are stored as structured frontmatter data
- relationship entries use the flat typed-edge shape
- relationship entries may include optional relationship-level metadata fields
- relationship types should be fully configurable in `.loctt/config/`
- LocTT should provide sane default relationship types
- structured task references should be stored by task `id`
- user-facing queries should allow task `key` references where appropriate, such as for `parent`
- tree display should default to `parent` / `child` relationships
- tree-style display and traversal should also be usable with other relationship types
- relationship definitions should support labels/metadata for user-facing display
- relationship-level metadata should be supported in schema but should not drive core product behavior initially

## Custom Fields

Confirmed decisions:

- user-defined fields should be globally declared in config before use
- declared custom fields should support different field types
- declared custom fields should support single-value and multi-value behavior
- enum-style custom fields should allow user-defined allowed values
- declared custom fields should be able to control whether they participate in full-text search
- custom fields should default to searchable unless configured otherwise
- custom fields in `task.md` should live under a dedicated `fields:` map rather than mixing with built-in top-level fields

## Workflow Configuration

Confirmed decisions:

- status definitions should use a required semantic `category`
- allowed status categories should be:
  - `pending`
  - `active`
  - `completed`
  - `discarded`
- priorities should be configurable rather than heavily predefined
- LocTT can ship with light starter defaults, but users should be able to add or change priorities through CLI/MCP/LLM-assisted setup
- task types should start light, with `task` as the main default
- additional task types should be easy to add later through configuration
- enum-like workflow values should support user-facing labels
- priority definitions may need optional numeric values for sortable semantics; otherwise sorting can fall back to string behavior
- configurable workflow entries should use `key` + `label`
- priorities should use optional `value` as the standard sortable numeric field
- if a priority has no numeric `value`, sorting can fall back to alphabetical `key`
- enum-style custom field values should use `key` + `label` and may also include optional sortable `value`
- `workflow.yaml` should use the proposed structured object shape rather than a looser alternative
- stored enum-like task values should use config `key`s rather than human-facing labels
- shipped default statuses should be:
  - `not_started`
  - `in_progress`
  - `blocked`
  - `done`
- shipped default priorities should be:
  - `low`
  - `medium`
  - `high`
- shipped default task types should be:
  - `task`
- shipped default relationships should include:
  - `parent` / `child` with `structural: true`
  - `blocks` / `is_blocked_by`
  - `relates_to` / `relates_to`
- additional built-in workflow semantics beyond status `category` should be deferred for now

## Canonical Schema Examples

Confirmed decisions:

- one canonical `task.md` example should be used as an official schema reference
- one canonical `workflow.yaml` example should be used as an official schema reference
- one canonical `queries.yaml` example should be used as an official schema reference
- one canonical `.loctt/state.yaml` example should also be used as an official schema reference

### Canonical `task.md`

```md
---
id: 01HSV6TQ3Y7M8K9N4R5S6A7B8C
key: T-123
title: Add loctt init flow
created_at: 2026-04-16T14:30:00Z
updated_at: 2026-04-16T14:30:00Z
status: in_progress
status_updated_at: 2026-04-16T14:30:00Z
task_type: task
priority: medium
relationships:
  - type: parent
    target: 01HSV71FJ1M3R4K8V2N6P7T9AB
  - type: blocks
    target: 01HSV70CX2M4R8P1N9J3K5Q6WW
fields:
  sprint: sprint_2
  owner_team: platform
---

Implement the initial `loctt init` experience.

[2026-04-16 14:30] Created task and started outlining init behavior.
```

### Canonical `workflow.yaml`

```yaml
key:
  prefix: T-

statuses:
  - key: not_started
    label: Not started
    category: pending
  - key: in_progress
    label: In progress
    category: active
  - key: blocked
    label: Blocked
    category: active
  - key: done
    label: Done
    category: completed

priorities:
  - key: low
    label: Low
    value: 1
  - key: medium
    label: Medium
    value: 2
  - key: high
    label: High
    value: 3

task_types:
  - key: task
    label: Task

relationships:
  - key: parent
    label: Parent
    inverse: child
    inverse_label: Child
    structural: true
  - key: blocks
    label: Blocks
    inverse: is_blocked_by
    inverse_label: Is blocked by
  - key: relates_to
    label: Relates to
    inverse: relates_to
    inverse_label: Relates to

custom_fields:
  - key: sprint
    label: Sprint
    type: enum
    multi: false
    searchable: true
    values:
      - key: sprint_1
        label: Sprint 1
        value: 1
      - key: sprint_2
        label: Sprint 2
        value: 2
  - key: owner_team
    label: Owner team
    type: string
    multi: false
    searchable: true
```

### Canonical `queries.yaml`

```yaml
queries:
  - name: recent-open
    query: archived != true and status != done
    sort:
      - field: updated_at
        direction: desc

  - name: blocked
    query: archived != true and status = blocked
    sort:
      - field: priority
        direction: desc
      - field: updated_at
        direction: desc

  - name: init-work
    query: text ~ "init"
    sort:
      - field: key
        direction: asc
```

### Canonical `state.yaml`

```yaml
keys:
  task:
    prefix: T-
    next_number: 124
```

## Notes

Any architecture details, schema proposals, file layout proposals, merge logic proposals, or other LLM-generated suggestions that were discussed but not explicitly confirmed should live in a separate document.

## Initialization

Confirmed decisions:

- LocTT should provide a `loctt init` command
- `loctt init` should set up the `.loctt/` folder structure and starter config
- `loctt init` should be able to configure Git-backed mode optionally
- `loctt init` should be able to configure helper docs for humans/LLMs optionally
- `loctt init` should be able to configure MCP support optionally
- `loctt init` should let the user decide whether to generate helper docs, with the default set to yes
- `loctt init` should support a one-shot setup mode with sane defaults, similar in spirit to `npm init`
- interactive `loctt init` should prompt for:
  - whether to enable Git-backed mode
  - whether to generate helper docs, default yes
  - whether to configure MCP support
  - key prefix, default `T-`
- one-shot `loctt init --yes` should create the full `.loctt/` structure with sane defaults
- `loctt init --yes` should not enable Git-backed mode unless explicitly requested
- `loctt init --yes` should not enable MCP unless explicitly requested
- intended init flags should include:
  - `--git`
  - `--no-git`
  - `--docs`
  - `--no-docs`
  - `--mcp`
  - `--no-mcp`
  - `--prefix`
  - `--yes`

## Helper Docs

Confirmed decisions:

- optional helper docs should live under `.loctt/docs/`
- helper docs should use multiple files plus an index/readme
- intended helper docs should include:
  - `.loctt/docs/README.md`
  - `.loctt/docs/workflow.md`
  - `.loctt/docs/git-sync.md`
  - `.loctt/docs/agents.md`
- `.loctt/docs/README.md` should explain the basics and link to the other docs
- `workflow.md` should explain statuses, task types, priorities, relationships, and lifecycle conventions
- `git-sync.md` should explain `.loctt` branch usage, publish/sync, reconcile flow, and the rule not to touch the branch manually
- `agents.md` should explain MCP/agent guardrails, including not editing frontmatter directly and not bypassing validation failures

## CLI Direction

Confirmed decisions:

- the CLI command list below is the intended product CLI surface, not a phased subset
- `loctt list` should be the main browsing command
- `loctt list` without an explicit query should return the most recent 30 tasks by default
- the default `list` output can be lightweight, for example `key + title`
- `list` should support additional filtering and sorting behavior
- `list` should support ad hoc queries via `--query`
- `list` should support saved queries via `--view`
- explicit `archive` and `unarchive` commands should be used rather than a reversal flag such as `archive -u`
- structured field updates should be handled through `set` and `unset` first, without separate convenience commands
- `create` should allow initial field values to be supplied at creation time
- `show` should display a structured summary plus markdown body by default
- `show` can later support flags to alter output shape
- `delete` should mean hard delete
- hard delete should require an explicit force flag

Intended CLI surface:

- `loctt init`
- `loctt info`
- `loctt doctor`
- `loctt git enable`
- `loctt git disable`
- `loctt git status`
- `loctt create`
- `loctt list`
- `loctt show <task>`
- `loctt set <task> <field> <value>`
- `loctt unset <task> <field>`
- `loctt link <task> <relationship> <target>`
- `loctt unlink <task> <relationship> <target>`
- `loctt archive <task>`
- `loctt unarchive <task>`
- `loctt delete <task> --force`
- `loctt publish`
- `loctt sync`
- `loctt reconcile status`
- `loctt reconcile continue`
- `loctt reconcile abort`

## Git Sync Semantics

Confirmed decisions:

- `.loctt/local/` should contain machine-local, non-published Git sync state
- `.loctt/local/sync.yaml` should track whether Git-backed mode is enabled, the canonical branch, and the last synced canonical commit
- `.loctt/local/reconcile.yaml` should exist only for in-progress or blocked reconciliation flows
- `publish` and `sync` should use a 3-way comparison model:
  - base = state at `last_synced_commit`
  - local = current local `.loctt/` state
  - remote = current canonical `.loctt` branch state
- both `publish` and `sync` should reconcile local and canonical state rather than silently overwriting
- no silent destructive overwrite should be allowed

### Suggested Local Sync Metadata Shape

```yaml
git:
  enabled: true
  branch: .loctt
  last_synced_commit: abc123
```

### Suggested Reconcile Metadata Shape

```yaml
mode: publish
base_commit: abc123
remote_commit: def456
started_at: 2026-04-16T14:30:00Z
```

### Sync Behavior

- `sync` should pull canonical `.loctt` state into the local workspace
- if the canonical head has not changed since `last_synced_commit`, `sync` should no-op
- if local tracker state has not changed since `last_synced_commit`, canonical state should be applied locally
- if both local and canonical state changed, `sync` should reconcile them
- after successful sync, `last_synced_commit` should be updated

### Publish Behavior

- `publish` should push local `.loctt` state into the canonical `.loctt` branch
- if local tracker state has not changed, `publish` should no-op
- if both local and canonical state changed since `last_synced_commit`, `publish` should reconcile them
- if publish causes rekeying, local state should be updated accordingly
- after successful publish, `last_synced_commit` should be updated

### Conflict Policy

- if only one side changed a given task field relative to base, that side should win
- if both sides changed a given field to the same value, the shared value should win
- if both sides changed the same field differently, the change should be treated as a conflict unless it falls under an allowed merge rule

Allowed merge rules:

- `relationships` can merge by union of `(type, target)` pairs
- `key_history` can merge by union
- custom fields can merge automatically only when different custom field keys were changed

Default conflict fields when changed differently on both sides:

- `title`
- `status`
- `parent`
- `task_type`
- `priority`
- `start_date`
- `due_date`
- the same custom field key

### Rekeying

- after reconciliation, if multiple tasks still claim the same `key`, a rekey pass should run
- collision groups should be formed by current `key`
- within a collision group:
  - earlier `created_at` keeps the key
  - lexical `id` breaks ties
- remaining tasks in the collision group should be assigned the next available key numbers from `.loctt/state.yaml`
- old keys should be preserved in key history

### Warning Behavior

- both `publish` and `sync` should warn before:
  - rekeying tasks
  - applying reconciled changes after divergence
  - overwriting or discarding conflicting local edits

## MCP Guardrails

Confirmed decisions:

- MCP should use structured tools for metadata operations
- task frontmatter should not be edited directly through arbitrary content editing
- markdown body content should remain editable
- if a structured metadata operation fails validation, agents should not bypass that failure by editing frontmatter directly
- `get_task` should support a parameter controlling whether the markdown body is included, defaulting to include the body
- agents should use MCP rather than editing LocTT task files directly in normal operation

Intended MCP surface:

- `get_task`
- `list_tasks`
- `list_views`
- `get_view`
- `get_config`
- `create_task`
- `update_task`
- `append_task_body`
- `replace_task_body`
- `archive_task`
- `unarchive_task`
- `delete_task`
- `link_tasks`
- `unlink_tasks`
- `publish`
- `sync`

Additional MCP behavior:

- `list_tasks` should support the same conceptual inputs as CLI `list`, including default browse mode, `query`, `view`, `limit`, and `sort`
- `get_task` should include attachment paths/metadata rather than requiring a separate attachment-read tool
- validation should be enforced by write tools rather than exposed as a separate MCP validate tool
