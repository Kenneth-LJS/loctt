# Schema Reference

File formats for LocTT's data and configuration files.

## task.md

Each task is stored at `.loctt/tasks/<ulid>/task.md` with YAML frontmatter and a markdown body.

### Required Fields

| Field | Type | Description |
|---|---|---|
| `id` | string | ULID, assigned at creation |
| `key` | string | User-facing key, e.g. `T-123` |
| `title` | string | Task title |
| `created_at` | ISO 8601 | Creation timestamp |
| `updated_at` | ISO 8601 | Last modification timestamp |

### Optional Fields

| Field | Type | Description |
|---|---|---|
| `status` | string | Workflow status key (defaults to `not_started`) |
| `status_updated_at` | ISO 8601 | When status was last changed |
| `task_type` | string | Task type key |
| `priority` | string | Priority key |
| `parent` | string | Parent task ID (shorthand for a `parent` relationship) |
| `labels` | string[] | Arbitrary labels |
| `assignee` | string | Assigned person |
| `reporter` | string | Reporter |
| `start_date` | string | Start date |
| `due_date` | string | Due date |
| `estimate` | string | Effort estimate |
| `completed_at` | ISO 8601 | Completion timestamp |
| `milestone` | string | Milestone name |
| `archived` | boolean | Whether the task is archived |
| `archived_at` | ISO 8601 | When the task was archived |
| `relationships` | array | Typed edges to other tasks |
| `key_history` | string[] | Previous keys (after rekeying) |
| `fields` | object | Custom field values (see below) |

Optional fields are omitted entirely when not set — they are not stored as `null`.

### Relationships

Stored as a flat list of typed edges:

```yaml
relationships:
  - type: parent
    target: 01HSV71FJ1M3R4K8V2N6P7T9AB
  - type: blocks
    target: 01HSV70CX2M4R8P1N9J3K5Q6WW
```

Each edge has a `type` (relationship key from workflow config) and a `target` (task ID).

### Custom Fields

User-defined fields live under a `fields:` map, separate from built-in fields:

```yaml
fields:
  sprint: sprint_2
  owner_team: platform
```

### Body

The markdown body is free-form. Lightweight comments use a timestamped convention:

```
[2026-04-16 14:30] Started outlining init behavior.
```

### Full Example

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

## workflow.yaml

Located at `.loctt/config/workflow.yaml`. Defines all configurable workflow values.

### Structure

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

### Status Categories

Every status must have a `category`:

| Category | Meaning |
|---|---|
| `pending` | Not yet started |
| `active` | In progress |
| `completed` | Finished successfully |
| `discarded` | Abandoned or won't do |

### Priority Sorting

Priorities use an optional numeric `value` for sort ordering. Without it, sorting falls back to alphabetical by `key`.

### Relationship Definitions

| Property | Description |
|---|---|
| `key` | Relationship type key |
| `label` | Display label |
| `inverse` | The inverse relationship key |
| `inverse_label` | Display label for the inverse |
| `structural` | If `true`, used for tree display (e.g., `parent`/`child`) |

### Custom Field Types

Supported types: `string`, `number`, `date`, `boolean`, `enum`.

Enum fields define `values` with `key`/`label` (and optional `value` for sorting). Fields are `searchable` by default.

## queries.yaml

Located at `.loctt/config/queries.yaml`. Defines saved query views.

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
```

Each query has a `name`, a `query` string (see [query-language.md](../query-language.md)), and an optional `sort` with `field` + `direction` (`asc` or `desc`).

## state.yaml

Located at `.loctt/state.yaml`. Tracks key allocation.

```yaml
keys:
  task:
    prefix: T-
    next_number: 124
```

This file is updated whenever a new task is created. In git-backed mode, it is published and synced.
