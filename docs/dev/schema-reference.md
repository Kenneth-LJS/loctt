# Schema Reference

File formats for LocTT's data and configuration files. Every on-disk file LocTT reads or writes is documented below: a brief intro, a concrete YAML example, then a field-by-field table.

All YAML files are written atomically (via `writeFileAtomically` / `writeYamlAtomically`) — readers never see partial content. State-mutating writes serialize through a lockfile (`withStateLock`).

## Directory Layout

```
<root>/
  .gitignore                  # appended with ".loctt.backup-*"
  .loctt/
    .gitignore                # ignores .current-user and users/*/settings.yaml
    .schema-version           # current schema version (positive integer)
    .schema-migration-in-progress  # sentinel, present only mid-migration
    .current-user             # per-checkout active user id (gitignored)
    state.yaml                # key allocation counters
    config/
      workflow.yaml           # statuses, priorities, task types, relationships, custom fields, estimation
      projects.yaml           # projects, default project
      labels.yaml             # labels (optional)
      milestones.yaml         # milestones (optional)
      sprints.yaml            # sprints (optional)
      calendar.yaml           # workspace timezone & working week (optional)
      queries.yaml            # saved views
    tasks/
      <ulid>/
        task.md               # frontmatter + body
        _history.yaml         # change log (see history docs)
        attachments/          # arbitrary task-attached files
    users/
      <ulid>/
        profile.yaml          # user identity
        settings.yaml         # per-user UI settings (gitignored)
    local/                    # per-checkout state (typically not committed)
      sync.yaml               # git-backed sync configuration
      reconcile.yaml          # mid-reconcile sentinel
      key-index.yaml          # cached key→id index
    docs/                     # on by default; pass `loctt init --no-docs` to skip
```

## Brand Types

A handful of refined string primitives are reused across schemas. They run as zod `regex` / `superRefine` checks at the YAML boundary, but the inferred TypeScript type is plain `string`.

| Brand | Pattern / Rule | Example |
|---|---|---|
| `IsoDate` | `YYYY-MM-DD` calendar date | `2026-05-10` |
| `SlugKey` | Starts with a lowercase letter, then lowercase letters / digits / `-` / `_` | `backend`, `owner_team` |
| `SprintKey` | Starts with lowercase letter or digit, then any of `a-z 0-9 . - _` | `sprint_2026.q1`, `2026-iter-3` |
| `HexColor` | `#?` followed by 3 or 6 hex digits (mixed case allowed) | `#1e6fcb`, `#f00`, `1E6FCB` |
| `IanaTimezone` | Validated against `Intl.supportedValuesOf("timeZone")` when available; otherwise a coarse `Region/City` regex. `UTC` is always accepted | `Asia/Singapore`, `America/Los_Angeles`, `UTC` |

Slug keys for projects/labels/milestones/users must start with a letter. Sprint keys are looser because typical sprint names start with a year (`2026.q1`).

---

## task.md

Each task is stored at `.loctt/tasks/<ulid>/task.md` with YAML frontmatter and a markdown body.

```md
---
id: 01HSV6TQ3Y7M8K9N4R5S6A7B8C
key: BACKEND-123
title: Add loctt init flow
created_at: 2026-04-16T14:30:00Z
updated_at: 2026-04-17T09:15:22Z
project: backend
status: in_progress
status_updated_at: 2026-04-17T09:15:22Z
task_type: task
priority: medium
labels:
  - infra
  - dx
assignee: 01HKQA8C2WV4Z9X1Y3M6N7P0Q5
reporter: 01HKQA8C2WV4Z9X1Y3M6N7P0Q5
start_date: 2026-04-15
due_date: 2026-04-30
estimate: "5"
milestone: v1
sprint: sprint_2026.q2
board_rank: "0|hzzzzz:"
relationships:
  - type: parent
    target: 01HSV71FJ1M3R4K8V2N6P7T9AB
  - type: blocks
    target: 01HSV70CX2M4R8P1N9J3K5Q6WW
    rank: "0|i00007:"
key_history:
  - T-42
fields:
  owner_team: platform
  risk_score: 3
---

Implement the initial `loctt init` experience.

[2026-04-16 14:30] Created task and started outlining init behavior.
```

### Frontmatter

The top of every `task.md` is a YAML block delimited by `---`. The schema is `passthrough` (unknown keys are preserved, not rejected). Optional fields are omitted entirely when unset — never written as `null`.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | ULID, assigned at creation; immutable |
| `key` | string | yes | User-facing key (e.g. `BACKEND-123`); unique per tracker |
| `title` | string | yes | Task title (non-empty) |
| `created_at` | ISO 8601 timestamp | yes | Creation timestamp |
| `updated_at` | ISO 8601 timestamp | yes | Last modification timestamp |
| `project` | string | no | Project key the task belongs to |
| `status` | string | no | Workflow status key (defaults to first `pending` status when absent) |
| `status_updated_at` | ISO 8601 | no | Set automatically when `status` changes |
| `task_type` | string | no | Task type key from workflow |
| `priority` | string | no | Priority key from workflow |
| `labels` | string[] | no | Label keys (must exist in `labels.yaml` if that file is used) |
| `assignee` | string | no | User ID (ULID) of assignee |
| `reporter` | string | no | User ID (ULID) of reporter |
| `start_date` | string | no | Planned start date. Conventionally `YYYY-MM-DD`; the schema only requires a string |
| `due_date` | string | no | Due date. Conventionally `YYYY-MM-DD`; the schema only requires a string |
| `estimate` | string \| number | no | Effort estimate. A number is coerced to a string at parse time |
| `completed_date` | string | no | Auto-set to today (`YYYY-MM-DD`) when status enters a `completed`-category status; auto-cleared on exit. Not user-editable |
| `milestone` | string | no | Milestone key |
| `sprint` | string | no | Sprint key (zero-or-one; no carryover) |
| `archived` | boolean | no | When `true`, the task is hidden from default lists |
| `archived_at` | string | no | ISO timestamp when `archived` was flipped to `true` |
| `relationships` | array | no | Typed edges to other tasks (see below) |
| `key_history` | string[] | no | Previous keys after rekeying (e.g. project rename) |
| `fields` | object | no | Custom-field values keyed by custom-field key |
| `board_rank` | string | no | Lexorank string for manual ordering within a board column. Cards without rank sort below ranked ones |

Date-shaped fields (`start_date`, `due_date`, `completed_date`) are typed as plain strings in the schema rather than `IsoDate`. Tools that produce frontmatter (CLI, MCP, web) write `YYYY-MM-DD`, but the parser does not refuse hand-edited values that don't match — convention, not enforcement.

Field write order in serialized output: `id`, `key`, `title`, `created_at`, `updated_at` first, then the optional fields in the order listed above. `board_rank` is written last (after `fields`), matching the table.

### Relationships

Stored as a flat list of typed edges. Each edge has a `type` (relationship key from workflow config), a `target` (task ULID), and an optional `rank`.

```yaml
relationships:
  - type: parent
    target: 01HSV71FJ1M3R4K8V2N6P7T9AB
  - type: blocks
    target: 01HSV70CX2M4R8P1N9J3K5Q6WW
    rank: "0|i00007:"
```

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | string | yes | Relationship type key (must be defined in workflow.yaml) |
| `target` | string | yes | Target task ID (ULID) |
| `rank` | string | no | Lexorank string. Only set when the relationship type is configured `ranked: true`. Targets without rank sort below ranked ones |

### Custom Fields

User-defined fields live under a `fields:` map, keyed by the custom field's `key`:

```yaml
fields:
  owner_team: platform
  risk_score: 3
  tags:
    - frontend
    - urgent
```

The schema accepts any value type at the YAML layer; semantic validation against the workflow's custom-field definitions runs separately.

### Body

The markdown body below the second `---` is free-form. Lightweight comments use a timestamped convention:

```
[2026-04-16 14:30] Started outlining init behavior.
```

There is no enforced body schema.

---

## workflow.yaml

Located at `.loctt/config/workflow.yaml`. Defines all configurable workflow values for the tracker. All sections except `key` are arrays. Missing `priorities`, `relationships`, and `custom_fields` are filled with `[]` on read for back-compat.

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
  - key: wont_do
    label: Won't do
    category: discarded

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
  - key: bug
    label: Bug

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
    ranked: true
  - key: relates_to
    label: Relates to
    inverse: relates_to
    inverse_label: Relates to

custom_fields:
  - key: owner_team
    label: Owner team
    type: string
    multi: false
    searchable: true
  - key: risk
    label: Risk
    type: enum
    multi: false
    searchable: true
    values:
      - key: low
        label: Low
        value: 1
      - key: high
        label: High
        value: 2

estimation:
  enabled: true
  unit: points
  scale: fibonacci
  preset_values: [1, 2, 3, 5, 8, 13]
```

### Top-level fields

| Field | Type | Required | Description |
|---|---|---|---|
| `key` | object | yes | Task-key prefix configuration (legacy single-project field) |
| `statuses` | array | yes | Status definitions |
| `priorities` | array | yes | Priority definitions |
| `task_types` | array | yes | Task-type definitions |
| `relationships` | array | yes | Relationship-type definitions |
| `custom_fields` | array | yes | Custom-field definitions |
| `estimation` | object | no | Estimation configuration |

### `key`

| Field | Type | Required | Description |
|---|---|---|---|
| `prefix` | string | yes | Default key prefix (e.g. `T-`). Per-project prefixes in `projects.yaml` take precedence |

### `statuses[]`

| Field | Type | Required | Description |
|---|---|---|---|
| `key` | string | yes | Status key (stored in task frontmatter) |
| `label` | string | yes | Display label |
| `category` | enum | yes | One of `pending`, `active`, `completed`, `discarded` |

| Category | Meaning |
|---|---|
| `pending` | Not yet started |
| `active` | In progress |
| `completed` | Finished successfully (triggers `completed_date` on tasks) |
| `discarded` | Abandoned or won't do |

### `priorities[]`

| Field | Type | Required | Description |
|---|---|---|---|
| `key` | string | yes | Priority key |
| `label` | string | yes | Display label |
| `value` | number | no | Numeric weight for sort. Without it, sort falls back to alphabetical by `key` |

### `task_types[]`

| Field | Type | Required | Description |
|---|---|---|---|
| `key` | string | yes | Task-type key |
| `label` | string | yes | Display label |

### `relationships[]`

| Field | Type | Required | Description |
|---|---|---|---|
| `key` | string | yes | Forward relationship key |
| `label` | string | yes | Forward display label |
| `inverse` | string | yes | Inverse relationship key |
| `inverse_label` | string | yes | Inverse display label |
| `structural` | boolean | no | When `true`, used for tree display (e.g. `parent`/`child`). At most one structural relationship pair |
| `ranked` | boolean | no | When `true`, edges of this type carry a `rank` lexorank string for ordering |

### `custom_fields[]`

| Field | Type | Required | Description |
|---|---|---|---|
| `key` | string | yes | Field key |
| `label` | string | yes | Display label |
| `type` | enum | yes | One of `string`, `number`, `date`, `boolean`, `enum` |
| `multi` | boolean | yes | Whether the field accepts multiple values |
| `searchable` | boolean | yes | Whether the field is exposed to the query DSL |
| `values` | array | no | Required for `type: enum`. Each entry has `key`, `label`, optional numeric `value` for sorting |

### `estimation`

Two modes:
- Numeric (`points`, `hours`, `days`, `custom_numeric`): values are numbers, aggregated as a sum.
- Enum (`custom_enum`): values are categorical, aggregated as counts per category.

| Field | Type | Required | Description |
|---|---|---|---|
| `enabled` | boolean | yes | Master toggle. UI hides the estimate field when `false` |
| `unit` | enum | yes | One of `points`, `hours`, `days`, `custom_numeric`, `custom_enum` |
| `unit_label` | string | conditional | Required when `unit` is `custom_numeric` or `custom_enum` |
| `scale` | enum | no | One of `free`, `linear`, `fibonacci` |
| `preset_values` | (number\|string)[] | conditional | Suggested values. Required and non-empty when `unit` is `custom_enum` |

---

## queries.yaml

Located at `.loctt/config/queries.yaml`. Defines saved query views. `id` is the stable reference; `name` is just a display label and can be renamed without breaking pinning. Each query string is parsed through the DSL at load time — invalid queries fail the whole config.

```yaml
queries:
  - id: 01HV3JQX5R7Y8Z2N4M6P8K0T1A
    name: recent-open
    query: archived != true and status != done
    sort:
      - field: updated_at
        direction: desc

  - id: 01HV3JR1WV9N2K4M6P8R0T1Y3B
    name: blocked
    query: archived != true and status = blocked
    sort:
      - field: priority
        direction: desc
      - field: updated_at
        direction: desc

  - id: 01HV3JR4Y3K8M2N5P7R9T0V2W4
    name: stale
    query: archived = true
    archived: true
```

### `queries[]`

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | Stable unique identifier (ULID). Duplicate ids across queries are rejected |
| `name` | string | yes | Display label |
| `query` | string | yes | Query DSL string. The parser tokenizes and parses every `query` at load time, so a malformed entry rejects the whole file. See [query-language.md](../user/common/query-language.md) |
| `sort` | array | no | Ordered list of sort specifiers |
| `archived` | boolean | no | Hide from default lists. Still runnable by id |

### `queries[].sort[]`

| Field | Type | Required | Description |
|---|---|---|---|
| `field` | string | yes | Field name to sort by |
| `direction` | enum | yes | One of `asc`, `desc` |

---

## projects.yaml

Located at `.loctt/config/projects.yaml`. A LocTT tracker hosts one or more projects, each with its own key prefix and counter. Tasks belong to exactly one project (via `TaskFrontmatter.project`).

```yaml
projects:
  - key: backend
    label: Backend
    prefix: BACKEND-
  - key: web
    label: Web
    prefix: WEB-
  - key: legacy
    label: Legacy
    prefix: LEG-
    archived: true
default: backend
```

The schema enforces:
- At least one project entry.
- `key` and `prefix` are unique across all projects.
- `default` (if set) must point at an existing project key.

### Top-level

| Field | Type | Required | Description |
|---|---|---|---|
| `projects` | array | yes | Project definitions; at least one required |
| `default` | string | no | Project key used when CLI/MCP callers omit `--project` |

### `projects[]`

| Field | Type | Required | Description |
|---|---|---|---|
| `key` | SlugKey | yes | Immutable internal identifier |
| `label` | string | yes | Human display name (editable) |
| `prefix` | string | yes | Task-key prefix (e.g. `BACKEND-`); immutable after creation |
| `archived` | boolean | no | When `true`, project is hidden but tasks remain accessible |

Hard-deleting a project moves its counter to `state.yaml`'s `retired_keys` so re-creating it resumes numbering.

---

## labels.yaml

Located at `.loctt/config/labels.yaml`. Optional. When absent, the loader returns `{ labels: [] }`. Labels are referenced by `key` from a task's `labels` array.

```yaml
labels:
  - key: bug
    label: Bug
    color: "#d73a4a"
  - key: dx
    label: Developer Experience
    color: "#1e6fcb"
  - key: legacy
    label: Legacy
    archived: true
```

The parser enforces uniqueness of `key` (in addition to the schema-level shape check).

### `labels[]`

| Field | Type | Required | Description |
|---|---|---|---|
| `key` | SlugKey | yes | Immutable identifier referenced from tasks |
| `label` | string | yes | Display label |
| `color` | HexColor | no | Optional hex color (`#1e6fcb`, `#f00`, etc.). Stored as written, no normalization |
| `archived` | boolean | no | Hide from default lists/pickers |

---

## milestones.yaml

Located at `.loctt/config/milestones.yaml`. Optional. Milestones are named checkpoints with an optional target date — release markers, not time-boxes.

```yaml
milestones:
  - key: v1
    label: v1.0 Release
    target_date: 2026-06-30
  - key: v0_9_beta
    label: 0.9 Beta
    target_date: 2026-04-15
    archived: true
```

The parser enforces uniqueness of `key`.

### `milestones[]`

| Field | Type | Required | Description |
|---|---|---|---|
| `key` | SlugKey | yes | Immutable identifier |
| `label` | string | yes | Display label |
| `target_date` | IsoDate | no | Target date (`YYYY-MM-DD`) |
| `archived` | boolean | no | Hide from pickers without breaking historical references |

---

## sprints.yaml

Located at `.loctt/config/sprints.yaml`. Optional. Tasks belong to zero or one sprint via `TaskFrontmatter.sprint`. `state` is a free-form field the user edits — there is no start/complete lifecycle ceremony and no carryover.

```yaml
sprints:
  - key: sprint_2026.q1
    label: Q1 Iteration 1
    start_date: 2026-01-06
    end_date: 2026-01-19
    state: completed
    goal: Ship the new editor.
  - key: sprint_2026.q2
    label: Q2 Iteration 1
    start_date: 2026-04-07
    end_date: 2026-04-20
    state: active
  - key: sprint_archive_2025
    label: 2025 Archive
    start_date: 2025-01-01
    end_date: 2025-12-31
    state: completed
    archived: true
```

The schema enforces `end_date >= start_date`. The parser additionally enforces uniqueness of `key`.

### `sprints[]`

| Field | Type | Required | Description |
|---|---|---|---|
| `key` | SprintKey | yes | Immutable identifier (allows dots, e.g. `sprint_2026.q1`) |
| `label` | string | yes | Display label |
| `start_date` | IsoDate | yes | Sprint window start |
| `end_date` | IsoDate | yes | Sprint window end (must not be before `start_date`) |
| `state` | enum | yes | One of `active`, `completed`, `future` |
| `goal` | string | no | Free-text goal note |
| `archived` | boolean | no | Hide from default lists |

---

## calendar.yaml

Located at `.loctt/config/calendar.yaml`. Optional, but written by `loctt init`.

`first_day_of_week`, `working_days`, and `holidays` are cosmetic — they drive timeline/Gantt shading and there is no business-day math anywhere.

**`timezone` is not cosmetic.** It defines what `today` means in queries (`due_date < today`) and what date is stamped on `completed_date`, across the CLI, MCP, and web UI. Because this file is workspace-shared and committed, everyone on a tracker resolves those the same way regardless of which machine runs the command.

When the file is absent the loader returns UTC, Monday-first week, Mon–Fri working days, no holidays. The UTC default is deliberate: deriving it from the reading machine would make the same saved view return different results for different people. `loctt init` writes the initializing machine's zone into the file, so the fallback only affects trackers created before that or with the file removed.

```yaml
timezone: Asia/Singapore
first_day_of_week: 1
working_days: [1, 2, 3, 4, 5]
holidays:
  - date: 2026-01-01
    label: New Year's Day
  - date: 2026-02-17
    label: Lunar New Year
```

Weekday indices are `0..6` with `0 = Sunday`. `holidays` must be present (use `[]` to mean no holidays).

### Top-level

| Field | Type | Required | Description |
|---|---|---|---|
| `timezone` | IanaTimezone | yes | Workspace-shared IANA timezone. Resolves `today` in queries and `completed_date`, plus the timeline today-marker. Per-user timezones live on user profiles and do not affect queries |
| `first_day_of_week` | integer 0..6 | yes | First column in week views; `0 = Sunday` |
| `working_days` | integer[] | yes | Each entry is `0..6`; entries are the weekdays considered working days |
| `holidays` | array | yes | List of non-working dates |

### `holidays[]`

| Field | Type | Required | Description |
|---|---|---|---|
| `date` | IsoDate | yes | The date (`YYYY-MM-DD`) |
| `label` | string | yes | Human-readable name (used in tooltips) |

---

## state.yaml

Located at `.loctt/state.yaml`. Tracks per-project key-allocation counters. Updated whenever a new task is created. Writes go through the state lock so concurrent CLI invocations cannot collide. In git-backed mode the file is published and synced.

```yaml
keys:
  backend:
    prefix: BACKEND-
    next_number: 124
  web:
    prefix: WEB-
    next_number: 87
retired_keys:
  experiments:
    prefix: EXP-
    next_number: 42
```

`retired_keys` holds counters for hard-deleted projects. Re-creating a project with the same key restores numbering from where it left off, so historical references in `key_history` cannot be re-used by a fresh task.

### Top-level

| Field | Type | Required | Description |
|---|---|---|---|
| `keys` | map | yes | Active counters keyed by project key |
| `retired_keys` | map | no | Counters preserved after hard-delete. Omitted when empty |

### Each entry (`keys.<project>` and `retired_keys.<project>`)

| Field | Type | Required | Description |
|---|---|---|---|
| `prefix` | string | yes | The project's key prefix (mirrors `projects.yaml`) |
| `next_number` | integer | yes | Positive integer; the next number to allocate |

---

## local/sync.yaml

Located at `.loctt/local/sync.yaml`. Records git-backed sync configuration for this checkout.

```yaml
git:
  enabled: true
  branch: loctt
  remote: origin
  auto_push: true
  auto_fetch: true
  last_synced_commit: 4f1c2a9c83a13d6f1c0ed9e2b7a8f5d2c4e6a1b8
```

`loctt git enable` writes the full object on first activation. All fields are required (only `last_synced_commit` is optional, as the first sync hasn't happened yet).

### `git`

| Field | Type | Required | Description |
|---|---|---|---|
| `enabled` | boolean | yes | Whether git-backed sync is active |
| `branch` | string | yes | Branch name used for the sparse worktree (default `loctt`) |
| `remote` | string | yes | Git remote name (default `origin`) |
| `auto_push` | boolean | yes | Push changes after each mutating operation |
| `auto_fetch` | boolean | yes | Fetch from remote at the start of operations |
| `last_synced_commit` | string | no | SHA of the last commit successfully reconciled |

---

## local/reconcile.yaml

Located at `.loctt/local/reconcile.yaml`. Sentinel file: present only while a publish/sync reconciliation is in progress. Removed on successful completion. Its presence on startup signals a recovery path.

```yaml
mode: sync
base_commit: 8a1b3c5d7e9f0a2b4c6d8e0f2a4b6c8d0e2f4a6b
remote_commit: 4f1c2a9c83a13d6f1c0ed9e2b7a8f5d2c4e6a1b8
started_at: 2026-05-10T13:42:01Z
```

| Field | Type | Required | Description |
|---|---|---|---|
| `mode` | enum | yes | One of `publish`, `sync` |
| `base_commit` | string | yes | Commit SHA the reconciliation started from |
| `remote_commit` | string | yes | Remote commit SHA being reconciled against |
| `started_at` | ISO 8601 | yes | When reconciliation began |

---

## local/key-index.yaml

Located at `.loctt/local/key-index.yaml`. Cached map from task key (current and historical) to task ID. Rebuildable from scratch by scanning all tasks; treat as a derived index, not authoritative state.

```yaml
entries:
  BACKEND-1: 01HSV6TQ3Y7M8K9N4R5S6A7B8C
  BACKEND-2: 01HSV70CX2M4R8P1N9J3K5Q6WW
  T-42: 01HSV6TQ3Y7M8K9N4R5S6A7B8C   # historical key in key_history
  WEB-1: 01HSV71FJ1M3R4K8V2N6P7T9AB
```

| Field | Type | Required | Description |
|---|---|---|---|
| `entries` | map | yes | Object mapping `key → task_id`. Includes both the current key and any entries from `key_history` |

If the file is missing, malformed, or has the wrong shape, the loader returns `undefined` and callers rebuild the index.

---

## users/&lt;id&gt;/profile.yaml

Located at `.loctt/users/<ulid>/profile.yaml`. One file per registered user. The user's `id` (a ULID) is generated, never user-supplied, and matches the directory name. `assignee` and `reporter` task fields reference user IDs (not names — names are not unique).

```yaml
id: 01HKQA8C2WV4Z9X1Y3M6N7P0Q5
name: Ken Loh
timezone: Asia/Singapore
email: ken@example.com
avatar: avatar.png
```

The serializer writes fields in this order: `id`, `name`, `timezone`, then optional `email`, `avatar`, `archived`. The loader rejects a profile whose `id` does not match its containing directory.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | ULID; must match the directory name |
| `name` | string | yes | Non-empty display name (not unique; truncated id is shown when ambiguous) |
| `timezone` | IanaTimezone | yes | Per-user timezone |
| `email` | string (email) | no | Validated as an email address |
| `avatar` | basename | no | Filename of the avatar inside the user's folder. The schema rejects path separators, leading slashes, and `.` / `..`, so a hand-edited `profile.yaml` cannot point the avatar at a file outside the user dir |
| `archived` | boolean | no | Hide from default pickers; existing assignments still display the name |

---

## users/&lt;id&gt;/settings.yaml

Located at `.loctt/users/<ulid>/settings.yaml`. Per-user, per-checkout UI settings. Schema-less by design — keys are owned by the UI (theme, default view, sort prefs, card layout, sidebar pins, default project override, etc.). Stored as YAML for hand-editability. Returned as `{}` when absent or empty. **Gitignored** via `.loctt/.gitignore`.

```yaml
theme: dark
default_view: 01HV3JQX5R7Y8Z2N4M6P8K0T1A
default_project: backend
sidebar:
  pinned_views:
    - 01HV3JQX5R7Y8Z2N4M6P8K0T1A
    - 01HV3JR1WV9N2K4M6P8R0T1Y3B
card_layout:
  show_assignee: true
  show_due_date: true
```

No fields are required; no schema is enforced. The writer round-trips the value through YAML to ensure it produces a valid YAML object.

---

## .schema-version

Located at `.loctt/.schema-version`. A single positive integer (newline-terminated) recording the schema version this tracker is on. Bumped whenever any on-disk schema changes. Migrations (in `packages/core/src/schema/migrations.ts`) run sequentially to bring an older tracker up to `CURRENT_SCHEMA_VERSION` (currently `1`).

```
1
```

| Constraint | Rule |
|---|---|
| Format | Integer text with optional trailing newline |
| Value | Positive integer (`>= 1`) |
| Empty file | Rejected with `SchemaVersionError` |
| Missing | Returns `null` (treated as legacy / fresh directory) |
| Larger than `CURRENT_SCHEMA_VERSION` | Throws `SchemaTooNewError`; the user must update LocTT |

---

## .schema-migration-in-progress

Located at `.loctt/.schema-migration-in-progress`. Recovery sentinel. Written before a migration begins and removed after it succeeds. Its presence on startup signals an interrupted migration; the user is directed to the sibling backup at `<root>/.loctt.backup-v<from>-<timestamp>-<rand>/`.

The file's contents are advisory — only its presence/absence matters.

---

## .current-user

Located at `.loctt/.current-user`. A single line containing the active user's ULID, newline-terminated. Per-checkout — every clone/worktree maintains its own active user. **Gitignored** via `.loctt/.gitignore`.

```
01HKQA8C2WV4Z9X1Y3M6N7P0Q5
```

| Constraint | Rule |
|---|---|
| Format | Single line, optional trailing newline |
| Value | A registered user ID (must match a `users/<id>/` directory) |
| Empty / missing | Treated as "no current user"; the next tool invocation may self-heal by picking the first user |

---

## .loctt/.gitignore

Written by `loctt init` inside `.loctt/`. Excludes per-checkout pointers and per-user UI settings from version control while keeping shared content (tasks, workflow, projects, user profiles) tracked.

```
# Per-checkout pointers and per-user UI settings — do not commit.
.current-user
users/*/settings.yaml
```

This file is committed; it is the per-tracker gitignore that keeps the shared directory clean.

---

## Root .gitignore (appended by `loctt init`)

When `loctt init` runs at a project root, it appends a `.loctt.backup-*` entry to the project's root `.gitignore` (creating the file if absent). Migration backups land as siblings of `.loctt/` (`<root>/.loctt.backup-v<from>-<timestamp>-<rand>/`), so the ignore rule has to live in the project root, not inside `.loctt/`.

```
# LocTT migration backups
.loctt.backup-*
```

The init step is idempotent: the entry is added only if no existing line in the root `.gitignore` matches `.loctt.backup-*` exactly.
